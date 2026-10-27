#!/usr/bin/env bash
# Isolated local Postgres only. Never reads application credentials or connects remotely.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
for bin in initdb pg_ctl psql; do command -v "$bin" >/dev/null || exit 2; done
DIR="$(mktemp -d "${TMPDIR:-/tmp}/mystash-engagement-pg.XXXXXX")"
PORT="${ENGAGEMENT_SCRATCH_PG_PORT:-55434}"
cleanup() { pg_ctl -D "$DIR/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
initdb -D "$DIR/data" -U postgres -A trust >/dev/null
pg_ctl -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
export PGOPTIONS='-c client_min_messages=warning'
PSQL=(psql -h "$DIR" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$ROOT/backend/scripts/sql/engagement_fixture.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20260807120000_engagement_domain.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20260908120000_reel_likes.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261027120000_engagement_atomic_foundations.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261027120000_engagement_atomic_foundations.sql"
"${PSQL[@]}" -f "$ROOT/backend/scripts/sql/engagement_checks.sql"
# Genuine separate-connection concurrency: repeated state changes and independent increments.
pids=()
for i in $(seq 1 12); do
  "${PSQL[@]}" -c "SELECT public.engagement_commit(jsonb_build_object('event_id',gen_random_uuid(),'interaction_type','save','object_type','collection','object_id','00000000-0000-0000-0000-000000000003','actor_user_id','00000000-0000-0000-0000-000000000001'));" >"$DIR/save-$i" &
  pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
pids=()
for i in $(seq 1 20); do
  "${PSQL[@]}" -c "SELECT public.engagement_commit(jsonb_build_object('event_id',gen_random_uuid(),'interaction_type','view','object_type','collection','object_id','00000000-0000-0000-0000-000000000003','collection_id','00000000-0000-0000-0000-000000000003','anonymous_id','scratch-concurrent'));" >"$DIR/view-$i" &
  pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
"${PSQL[@]}" <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM public.engagement_interaction_facts WHERE interaction_type='save')<>1 THEN RAISE EXCEPTION 'concurrent save duplicated'; END IF;
 IF (SELECT views_count FROM public.collections WHERE id='00000000-0000-0000-0000-000000000003')<>21 THEN RAISE EXCEPTION 'lost view increment'; END IF;
 IF (public.engagement_reconcile()->>'collection_mismatches')::int<>0 THEN RAISE EXCEPTION 'counter drift'; END IF;
END $$;
SQL
"${PSQL[@]}" <<'SQL'
DO $$ DECLARE old_event uuid; r jsonb; BEGIN
 SELECT event_id INTO old_event FROM public.engagement_interaction_facts WHERE interaction_type='save' LIMIT 1;
 PERFORM public.engagement_commit(jsonb_build_object('event_id',gen_random_uuid(),'interaction_type','unsave','object_type','collection',
  'object_id','00000000-0000-0000-0000-000000000003','actor_user_id','00000000-0000-0000-0000-000000000001'));
 r:=public.engagement_commit(jsonb_build_object('event_id',old_event,'interaction_type','save','object_type','collection',
  'object_id','00000000-0000-0000-0000-000000000003','collection_id','00000000-0000-0000-0000-000000000003',
  'actor_user_id','00000000-0000-0000-0000-000000000001'));
 PERFORM public.test_assert(NOT (r->>'inserted')::boolean,'old save retry remains deduplicated');
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.engagement_relationship_edges WHERE edge_type='SAVE' AND state='ACTIVE'),'old save cannot reactivate');
 PERFORM public.engagement_commit(jsonb_build_object('event_id',gen_random_uuid(),'interaction_type','save','object_type','collection',
  'object_id','00000000-0000-0000-0000-000000000003','actor_user_id','00000000-0000-0000-0000-000000000001'));
END $$;
INSERT INTO public.catalog_products(id) VALUES('00000000-0000-0000-0000-000000000006');
INSERT INTO public.collection_product_tags VALUES('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000006');
INSERT INTO public.videos VALUES('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003');
DO $$ DECLARE r jsonb; BEGIN
 r:=public.engagement_commit(jsonb_build_object('event_id',gen_random_uuid(),'interaction_type','merchant_click','object_type','catalog_product',
  'object_id','00000000-0000-0000-0000-000000000006','catalog_product_id','00000000-0000-0000-0000-000000000006',
  'collection_id','00000000-0000-0000-0000-000000000003','collection_product_tag_id','00000000-0000-0000-0000-000000000007',
  'actor_user_id','00000000-0000-0000-0000-000000000001','metadata',jsonb_build_object('destinationUrl','https://shop.invalid/private?secret=x','destinationHost','shop.invalid')));
 PERFORM public.test_assert(NOT (r->'fact'->'metadata' ? 'destinationUrl'),'destination URL stripped');
 PERFORM public.test_assert((SELECT product_clicks_count=1 FROM public.collections WHERE id='00000000-0000-0000-0000-000000000003'),'click mirror');
 BEGIN
  PERFORM public.engagement_commit(jsonb_build_object('event_id',gen_random_uuid(),'interaction_type','merchant_click','object_type','catalog_product',
   'object_id','00000000-0000-0000-0000-000000000006','catalog_product_id','00000000-0000-0000-0000-000000000006',
   'collection_id','00000000-0000-0000-0000-000000000003','collection_product_tag_id','00000000-0000-0000-0000-000000000099','anonymous_id','test'));
  RAISE EXCEPTION 'invalid tag accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 r:=public.engagement_commit(jsonb_build_object('event_id','10000000-0000-0000-0000-000000000004','interaction_type','like','object_type','reel',
  'object_id','00000000-0000-0000-0000-000000000004','actor_user_id','00000000-0000-0000-0000-000000000001'));
 PERFORM public.test_assert((r->>'inserted')::boolean,'like committed');
 r:=public.engagement_commit(jsonb_build_object('event_id','10000000-0000-0000-0000-000000000004','interaction_type','like','object_type','reel',
  'object_id','00000000-0000-0000-0000-000000000004','actor_user_id','00000000-0000-0000-0000-000000000001'));
 PERFORM public.test_assert(NOT (r->>'inserted')::boolean,'like retry');
END $$;
SET ROLE service_role;
SELECT public.test_assert((public.engagement_creator_summary('00000000-0000-0000-0000-000000000002')->'totals'->>'views')::int=21,'service-role summary');
RESET ROLE;
SQL
# Exercise the soft-delete trigger, followed by a real auth hard delete, only in this disposable database.
"${PSQL[@]}" <<'SQL'
UPDATE public.users SET account_status='DELETED' WHERE id='00000000-0000-0000-0000-000000000001';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.engagement_interaction_facts WHERE actor_user_id='00000000-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'actor not erased'; END IF;
 IF EXISTS(SELECT 1 FROM public.engagement_relationship_edges WHERE user_id='00000000-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'edges not erased'; END IF;
 IF (public.engagement_reconcile()->>'collection_mismatches')::int<>0 THEN RAISE EXCEPTION 'deletion drift'; END IF;
END $$;
DELETE FROM auth.users WHERE id='00000000-0000-0000-0000-000000000001';
SQL
echo 'engagement-sql: transactional, retry, authorization, rollback, concurrency, reconciliation and deletion checks passed'
