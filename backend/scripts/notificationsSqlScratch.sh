#!/usr/bin/env bash
# Runs the notification migrations and SQL behaviour checks on a throwaway local Postgres.
# Never connects to a remote database: the cluster lives in a temp dir and listens on a unix
# socket only. Needs initdb/pg_ctl/psql (Postgres 14+) on PATH.
#
# This does not replace `supabase db reset`: the full migration history cannot replay from an
# empty database yet (20260511000000_curation_pipeline.sql needs public.videos). Only the
# notification migrations are applied, on top of stubs for the Supabase objects they reference.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIGRATIONS=(
  "$ROOT/supabase/migrations/20261012120000_notifications_inbox.sql"
  "$ROOT/supabase/migrations/20261013120000_notifications_push.sql"
  "$ROOT/supabase/migrations/20261014120000_notifications_push_revocation.sql"
  "$ROOT/supabase/migrations/20261015120000_notifications_campaigns.sql"
)
CHECKS=(
  "$ROOT/backend/scripts/sql/notifications_push_checks.sql"
  "$ROOT/backend/scripts/sql/notifications_revocation_checks.sql"
  "$ROOT/backend/scripts/sql/notifications_campaign_checks.sql"
)
PORT="${NOTIFICATIONS_SCRATCH_PG_PORT:-55432}"

for bin in initdb pg_ctl psql; do
  command -v "$bin" >/dev/null || { echo "notifications-sql: $bin not found on PATH" >&2; exit 2; }
done

DIR="$(mktemp -d "${TMPDIR:-/tmp}/mystash-ntf-pg.XXXXXX")"
cleanup() {
  pg_ctl -D "$DIR/data" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DIR"
}
trap cleanup EXIT

initdb -D "$DIR/data" -U postgres -A trust >/dev/null
pg_ctl -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log.txt" -w start >/dev/null

export PGOPTIONS='-c client_min_messages=warning'
PSQL=(psql -h "$DIR" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  account_status text NOT NULL DEFAULT 'ACTIVE',
  deleted_at timestamptz
);
GRANT USAGE ON SCHEMA public, auth TO service_role, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
SQL

for m in "${MIGRATIONS[@]}"; do
  "${PSQL[@]}" -f "$m"
  echo "applied $(basename "$m")"
done
# Re-applying must be safe (IF NOT EXISTS / CREATE OR REPLACE throughout).
for m in "${MIGRATIONS[@]:1}"; do
  "${PSQL[@]}" -f "$m"
  echo "re-applied $(basename "$m")"
done

OUT="$DIR/checks.txt"
psql -h "$DIR" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 \
  -f "${CHECKS[0]}" -f "${CHECKS[1]}" -f "${CHECKS[2]}" \
  -c '\pset format unaligned' -c '\pset tuples_only on' \
  -c "SELECT CASE WHEN ok THEN 'PASS ' ELSE 'FAIL ' END || label || COALESCE(' -- ' || detail, '') FROM t.results ORDER BY n" \
  >"$OUT" 2>&1 || {
  cat "$OUT"
  echo "notifications-sql: check script errored" >&2
  exit 1
}
grep -E '^(PASS|FAIL)' "$OUT" | sed 's/^/  /'
FAILS=$(grep -c '^FAIL' "$OUT" || true)
PASSES=$(grep -c '^PASS' "$OUT" || true)
echo "notifications-sql: $PASSES passed, $FAILS failed"
[ "$FAILS" -eq 0 ]
