#!/usr/bin/env bash
# Local throwaway Postgres only; never loads application credentials.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
for bin in initdb pg_ctl psql; do command -v "$bin" >/dev/null || exit 2; done
DIR="$(mktemp -d "${TMPDIR:-/tmp}/mystash-analytics-pg.XXXXXX")"
PORT="${ANALYTICS_SCRATCH_PG_PORT:-55435}"
cleanup(){ pg_ctl -D "$DIR/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
initdb -D "$DIR/data" -U postgres -A trust >/dev/null
pg_ctl -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
export PGOPTIONS='-c client_min_messages=warning'
PSQL=(psql -h "$DIR" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$ROOT/backend/scripts/sql/engagement_fixture.sql"
"${PSQL[@]}" <<'SQL'
CREATE TABLE public.discovered_products(id uuid PRIMARY KEY,internal_status text DEFAULT 'ACTIVE');
CREATE TABLE public.cart_items(id uuid PRIMARY KEY,user_id uuid,discovered_product_id uuid);
ALTER TABLE public.cart_items ADD COLUMN catalog_product_id uuid,ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.user_place_saves ADD COLUMN place_id uuid;
ALTER TABLE public.product_clicks ADD COLUMN created_at timestamptz;
ALTER TABLE public.collection_product_tags ADD COLUMN discovered_product_id uuid;
ALTER TABLE public.users ADD COLUMN creator_status text DEFAULT 'APPROVED';
ALTER TABLE public.users ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.collections ADD COLUMN hero_thumbnail_url text;
ALTER TABLE public.catalog_products ADD COLUMN name text,ADD COLUMN image_url text;
ALTER TABLE public.catalog_products ADD COLUMN category text;
ALTER TABLE public.discovered_products ADD COLUMN name text,ADD COLUMN image_url text;
ALTER TABLE public.discovered_products ADD COLUMN category text;
CREATE TABLE public.ingest_requests(id uuid PRIMARY KEY,status text,created_at timestamptz DEFAULT now());
CREATE TABLE public.content_sources(id uuid PRIMARY KEY,processing_status text,candidate_count int DEFAULT 0,created_at timestamptz DEFAULT now());
CREATE TABLE public.user_imports(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users ON DELETE CASCADE,content_source_id uuid REFERENCES public.content_sources,timed_out_at timestamptz,created_at timestamptz DEFAULT now());
CREATE TABLE public.places(id uuid PRIMARY KEY);
CREATE TABLE public.content_source_products(id uuid PRIMARY KEY,content_source_id uuid REFERENCES public.content_sources,catalog_product_id uuid,discovered_product_id uuid);
CREATE TABLE public.content_source_places(id uuid PRIMARY KEY,content_source_id uuid REFERENCES public.content_sources,resolution_state text);
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
SQL
for m in 20260807120000_engagement_domain.sql 20260908120000_reel_likes.sql 20261027120000_engagement_atomic_foundations.sql 20261027130000_behavioral_measurement.sql 20261027140000_creator_analytics.sql 20261027150000_admin_analytics.sql 20261027160000_interest_profiles.sql 20261027170000_analytics_readiness.sql; do
 "${PSQL[@]}" -f "$ROOT/supabase/migrations/$m"
done
"${PSQL[@]}" -f "$ROOT/backend/scripts/sql/analytics_readiness_checks.sql"
# A held relation lock must fail boundedly inside the actual maintenance RPC.
PGAPPNAME=mystash-readiness-lock "${PSQL[@]}" -c "BEGIN; LOCK public.analytics_events IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(4); COMMIT;" >"$DIR/held-lock" &
lock_pid=$!
for i in $(seq 1 60); do
 if [[ "$("${PSQL[@]}" -At -c "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name='mystash-readiness-lock' AND l.relation='public.analytics_events'::regclass AND l.mode='AccessExclusiveLock' AND l.granted;")" = 1 ]]; then break; fi
 sleep 0.05
done
if "${PSQL[@]}" -c "SELECT public.analytics_maintenance();" >"$DIR/lock-deadline" 2>&1; then echo 'FAIL: lock deadline not enforced'; exit 1; fi
rg -q 'lock timeout' "$DIR/lock-deadline"
wait "$lock_pid"
# Simulate PostgREST's transaction-hoisted statement deadline in a direct PG connection.
if PGOPTIONS='-c statement_timeout=30ms' "${PSQL[@]}" -c "SELECT pg_sleep(1);" >"$DIR/statement-deadline" 2>&1; then echo 'FAIL: statement deadline not enforced'; exit 1; fi
rg -q 'statement timeout' "$DIR/statement-deadline"
echo 'readiness-sql: R1/R2/R3/R5 guards, scoped SQL settings and actual lock/statement cancellation passed'
"${PSQL[@]}" -f "$ROOT/backend/scripts/sql/analytics_checks.sql"
# Separate connections exercise duplicate delivery and withdrawal racing an insert.
"${PSQL[@]}" <<'SQL'
INSERT INTO auth.users VALUES('90000000-0000-4000-8000-000000000001'),('90000000-0000-4000-8000-000000000002');
INSERT INTO public.users(id) SELECT id FROM auth.users WHERE id::text LIKE '90000000%';
INSERT INTO public.collections(id,creator_id) VALUES('90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000002');
SELECT (public.analytics_set_preferences('90000000-0000-4000-8000-000000000001',true,true)).user_id IS NOT NULL AS ready;
CREATE TABLE public.scratch_event AS SELECT public.test_event('90000000-0000-4000-8000-000000000010','collection.opened','collection','90000000-0000-4000-8000-000000000003') AS value;
SQL
pids=()
for i in $(seq 1 8); do
 "${PSQL[@]}" -c "SELECT public.analytics_ingest('90000000-0000-4000-8000-000000000001',(SELECT revision FROM public.analytics_preferences WHERE user_id='90000000-0000-4000-8000-000000000001'),jsonb_build_array((SELECT value FROM public.scratch_event)));" >"$DIR/duplicate-$i" &
 pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
"${PSQL[@]}" -c "SELECT public.test_assert((SELECT count(*) FROM public.analytics_events WHERE event_id='90000000-0000-4000-8000-000000000010')=1,'concurrent duplicate count');"
"${PSQL[@]}" -c "UPDATE public.scratch_event SET value=jsonb_set(value,'{event_id}','\"90000000-0000-4000-8000-000000000011\"');"
"${PSQL[@]}" -c "SELECT public.analytics_ingest('90000000-0000-4000-8000-000000000001',(SELECT revision FROM public.analytics_preferences WHERE user_id='90000000-0000-4000-8000-000000000001'),jsonb_build_array((SELECT value FROM public.scratch_event)));" >"$DIR/race-ingest" &
ingest_pid=$!
"${PSQL[@]}" -c "SELECT public.analytics_set_preferences('90000000-0000-4000-8000-000000000001',false,false);" >"$DIR/race-withdraw" &
withdraw_pid=$!
wait "$ingest_pid"
wait "$withdraw_pid"
"${PSQL[@]}" -c "SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_events WHERE actor_id='90000000-0000-4000-8000-000000000001'),'concurrent withdrawal cannot leave actor linkage');"
# Merchant identity is locked against withdrawal in both stores, even with context=false.
"${PSQL[@]}" -c "CREATE TABLE public.scratch_merchant_revision AS SELECT (public.test_set_preferences('90000000-0000-4000-8000-000000000001',true,true)).revision;"
"${PSQL[@]}" -c "SELECT public.analytics_record_legacy_click('90000000-0000-4000-8000-000000000001',(SELECT revision FROM public.scratch_merchant_revision),jsonb_build_object('event_id',gen_random_uuid()));" >"$DIR/legacy-withdraw-race" &
legacy_pid=$!
"${PSQL[@]}" -c "SELECT public.engagement_commit(jsonb_build_object('event_id',gen_random_uuid(),'interaction_type','merchant_click','object_type','catalog_product','object_id','30000000-0000-4000-8000-000000000001','catalog_product_id','30000000-0000-4000-8000-000000000001','actor_user_id','90000000-0000-4000-8000-000000000001','measurement_context',false,'measurement_revision',(SELECT revision FROM public.scratch_merchant_revision)));" >"$DIR/merchant-withdraw-race" &
merchant_pid=$!
"${PSQL[@]}" -c "SELECT public.analytics_set_preferences('90000000-0000-4000-8000-000000000001',false,false);" >"$DIR/merchant-withdraw" &
merchant_withdraw_pid=$!
wait "$legacy_pid"
wait "$merchant_pid"
wait "$merchant_withdraw_pid"
"${PSQL[@]}" -c "SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.product_clicks WHERE user_id='90000000-0000-4000-8000-000000000001') AND NOT EXISTS(SELECT 1 FROM public.engagement_interaction_facts WHERE actor_user_id='90000000-0000-4000-8000-000000000001' AND interaction_type='merchant_click'),'merchant withdrawal race cannot leave actor linkage');"
echo 'analytics-sql: consent, isolation, idempotency, result attribution, deletion, expiry and player-exclusion checks passed'
"${PSQL[@]}" -f "$ROOT/backend/scripts/sql/creator_analytics_checks.sql"
"${PSQL[@]}" -c "CREATE TABLE public.scratch_creator_expected AS SELECT sum(value) AS total FROM public.analytics_creator_daily;"
pids=()
for i in $(seq 1 4); do
 "${PSQL[@]}" -c "SELECT public.analytics_rollup_creators(false);" >"$DIR/rollup-$i" &
 pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
"${PSQL[@]}" -c "SELECT public.test_assert((SELECT sum(value) FROM public.analytics_creator_daily)=(SELECT total FROM public.scratch_creator_expected),'concurrent rollups remain idempotent');"
echo 'creator-analytics-sql: rollup, coverage, ownership, retention, reporting and permissions checks passed'
"${PSQL[@]}" -f "$ROOT/backend/scripts/sql/admin_analytics_checks.sql"
"${PSQL[@]}" -c "CREATE TABLE public.scratch_admin_expected AS SELECT sum(value) AS total FROM public.analytics_admin_daily;"
pids=()
for i in $(seq 1 4); do
 "${PSQL[@]}" -c "SELECT public.analytics_rollup_admin(false);" >"$DIR/admin-rollup-$i" &
 pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
"${PSQL[@]}" -c "SELECT public.test_assert((SELECT sum(value) FROM public.analytics_admin_daily)=(SELECT total FROM public.scratch_admin_expected),'concurrent admin rollups remain idempotent');"
echo 'admin-analytics-sql: authorization, aggregate metrics, cohorts, coverage, dedupe, privacy and retention checks passed'
"${PSQL[@]}" -f "$ROOT/backend/scripts/sql/interest_checks.sql"
pids=()
for i in $(seq 1 4); do
 "${PSQL[@]}" -c "INSERT INTO public.scratch_interest_claims VALUES($i,public.analytics_interest_claim(1));" >"$DIR/interest-claim-$i" &
 pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
"${PSQL[@]}" -c "SELECT public.test_assert((SELECT sum(jsonb_array_length(ids)) FROM public.scratch_interest_claims)=1,'concurrent workers lease one account once');"
"${PSQL[@]}" -c "SELECT public.analytics_interest_store('40000000-0000-4000-8000-000000000009',(SELECT epoch FROM public.scratch_interest_epoch),'[]');" >"$DIR/interest-store" &
store_pid=$!
"${PSQL[@]}" -c "SELECT public.analytics_set_personalization('40000000-0000-4000-8000-000000000009',false);" >"$DIR/interest-withdraw" &
withdraw_pid=$!
wait "$store_pid"
wait "$withdraw_pid"
"${PSQL[@]}" -c "SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.analytics_interest_profiles WHERE user_id='40000000-0000-4000-8000-000000000009'),'withdrawal race cannot restore profile');"
echo 'interest-sql: separate consent, isolation, input minimization, reset/withdrawal races, leases, current-state enforcement and expiry passed'
