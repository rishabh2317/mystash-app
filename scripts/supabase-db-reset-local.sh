#!/usr/bin/env bash
# Destructive: drops and recreates the LOCAL Supabase database from supabase/migrations.
# Refuses anything that could reach a hosted project.
set -euo pipefail

cd "$(dirname "$0")/.."

for arg in "$@"; do
  case "$arg" in
    --linked|--db-url|--db-url=*|--project-ref|--project-ref=*)
      echo "Refusing: '$arg' would reset a remote database. This command only resets the local stack." >&2
      exit 2
      ;;
  esac
done

if [[ "${NODE_ENV:-}" == "production" ]]; then
  echo "Refusing: NODE_ENV=production" >&2
  exit 2
fi

api_url="$(supabase status -o env 2>/dev/null | sed -n 's/^API_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' | head -n1)"
case "$api_url" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *)
    echo "Refusing: local Supabase is not running (API_URL='${api_url:-none}'). Run 'supabase start' first." >&2
    exit 2
    ;;
esac

exec supabase db reset --local "$@"
