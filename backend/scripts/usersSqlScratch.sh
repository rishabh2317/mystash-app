#!/usr/bin/env bash
# Applies user-domain migrations plus client-access lockdown on throwaway local Postgres.
# Never connects to a remote database.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIGRATIONS=(
  "$ROOT/supabase/migrations/20260806200000_user_domain.sql"
  "$ROOT/supabase/migrations/20260806201000_fix_username_reservation_index.sql"
  "$ROOT/supabase/migrations/20260922180000_commerce_country.sql"
  "$ROOT/supabase/migrations/20261015200000_users_client_access.sql"
)
CHECKS="$ROOT/backend/scripts/sql/users_client_access_checks.sql"
PORT="${USERS_SCRATCH_PG_PORT:-55433}"

for bin in initdb pg_ctl psql; do
  command -v "$bin" >/dev/null || { echo "users-sql: $bin not found on PATH" >&2; exit 2; }
done

DIR="$(mktemp -d "${TMPDIR:-/tmp}/mystash-users-pg.XXXXXX")"
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
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    COALESCE(
      current_setting('request.jwt.claim.sub', true),
      CASE
        WHEN current_setting('request.jwt.claims', true) IN ('', 'missing') THEN NULL
        ELSE current_setting('request.jwt.claims', true)::json->>'sub'
      END
    ),
    ''
  )::uuid;
$$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
SQL

for m in "${MIGRATIONS[@]}"; do
  "${PSQL[@]}" -f "$m"
  echo "applied $(basename "$m")"
done
# Re-applying the lockdown migration must be safe.
"${PSQL[@]}" -f "${MIGRATIONS[3]}"
echo "re-applied $(basename "${MIGRATIONS[3]}")"

OUT="$DIR/checks.txt"
psql -h "$DIR" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 \
  -f "$CHECKS" \
  -c '\pset format unaligned' -c '\pset tuples_only on' \
  -c "SELECT CASE WHEN ok THEN 'PASS ' ELSE 'FAIL ' END || label || COALESCE(' -- ' || detail, '') FROM t.results ORDER BY n" \
  >"$OUT" 2>&1 || {
  cat "$OUT"
  echo "users-sql: check script errored" >&2
  exit 1
}
grep -E '^(PASS|FAIL)' "$OUT" | sed 's/^/  /'
FAILS=$(grep -c '^FAIL' "$OUT" || true)
PASSES=$(grep -c '^PASS' "$OUT" || true)
echo "users-sql: $PASSES passed, $FAILS failed"
[ "$FAILS" -eq 0 ]
