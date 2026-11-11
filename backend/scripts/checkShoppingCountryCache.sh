#!/usr/bin/env bash
set -euo pipefail
# Dedicated disposable PostgreSQL cluster. Never uses app credentials or a remote DB.
task_dir=$(mktemp -d /private/tmp/mystash-shopping-country-sql.XXXXXX)
repo_root=$(cd "$(dirname "$0")/../.." && pwd)
initdb -D "$task_dir/data" --auth=trust --no-locale > "$task_dir/init.log"
trap 'pg_ctl -D "$task_dir/data" -m fast -w stop > "$task_dir/stop.log" 2>&1 || true' EXIT
pg_ctl -D "$task_dir/data" -l "$task_dir/postgres.log" -o "-k $task_dir -p 55439 -h ''" -w start > "$task_dir/start.log"
psql -X --host="$task_dir" --port=55439 --dbname=postgres --set=ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
CREATE TABLE public.catalog_products(id uuid PRIMARY KEY,metadata jsonb,name text);
CREATE TABLE public.discovered_products(id uuid PRIMARY KEY,metadata jsonb);
INSERT INTO catalog_products(id,metadata) VALUES ('00000000-0000-4000-8000-000000000001','{"original":"preserved"}');
INSERT INTO discovered_products VALUES ('00000000-0000-4000-8000-000000000002','{}');
SQL
psql -X --host="$task_dir" --port=55439 --dbname=postgres --set=ON_ERROR_STOP=1 --file="$repo_root/supabase/migrations/20261111150000_shopping_country_offer_cache.sql"
psql -X --host="$task_dir" --port=55439 --dbname=postgres --set=ON_ERROR_STOP=1 --file="$repo_root/supabase/migrations/20261111160000_shopping_cache_trigger_permissions.sql"
psql -X --host="$task_dir" --port=55439 --dbname=postgres --set=ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE a jsonb;b jsonb;token uuid;fixture_id uuid:='00000000-0000-4000-8000-000000000001';
BEGIN
 a:=shopping_country_offer_cache('catalog',fixture_id,'IN');token:=(a->>'token')::uuid;
 ASSERT (a->>'claimed')::boolean,'first caller owns lease';
 b:=shopping_country_offer_cache('catalog',fixture_id,'IN');
 ASSERT NOT (b->>'claimed')::boolean,'second caller cannot duplicate discovery';
 b:=shopping_country_offer_cache('catalog',fixture_id,'IN','[]',gen_random_uuid());
 ASSERT b->'metadata'->'shopping_country_offers'->'IN'->'evidence' IS NULL,'stale writer cannot publish';
 b:=shopping_country_offer_cache('catalog',fixture_id,'IN','[]',token);
 ASSERT b->'metadata'->>'original'='preserved','unrelated metadata survives';
 a:=shopping_country_offer_cache('catalog',fixture_id,'IN');
 ASSERT NOT (a->>'claimed')::boolean,'negative lookup is cached';
 a:=shopping_country_offer_cache('catalog',fixture_id,'GB');token:=(a->>'token')::uuid;
 ASSERT (a->>'claimed')::boolean,'different country has independent discovery';
 b:=shopping_country_offer_cache('catalog',fixture_id,'GB','[{"url":"https://fixture.invalid/product"}]',token);
 ASSERT b->'metadata'->'shopping_country_offers' ? 'IN','country write preserves another country';
 ASSERT b->'metadata'->'shopping_country_offers' ? 'GB','country result is stored';
 UPDATE catalog_products SET metadata='{"newMetadata":"kept"}' WHERE catalog_products.id=fixture_id;
 SELECT metadata INTO b FROM catalog_products WHERE catalog_products.id=fixture_id;
 ASSERT b->'shopping_country_offers' ? 'IN' AND b->'shopping_country_offers' ? 'GB','ordinary enrichment cannot erase other countries or leases';
 ASSERT b->>'newMetadata'='kept','other metadata updates still work';
 UPDATE catalog_products SET name='New identity' WHERE catalog_products.id=fixture_id;
 SELECT metadata INTO b FROM catalog_products WHERE catalog_products.id=fixture_id;
 ASSERT NOT b ? 'shopping_country_offers','identity changes invalidate country cache';
 ASSERT NOT has_function_privilege('anon','shopping_country_offer_cache(text,uuid,text,jsonb,uuid)','EXECUTE'),'anonymous cannot populate cache';
 ASSERT NOT has_function_privilege('anon','shopping_preserve_country_offer_cache()','EXECUTE'),'anonymous cannot call trigger helper';
 ASSERT NOT has_function_privilege('authenticated','shopping_preserve_country_offer_cache()','EXECUTE'),'client cannot call trigger helper';
 ASSERT NOT has_function_privilege('authenticated','shopping_country_offer_cache(text,uuid,text,jsonb,uuid)','EXECUTE'),'client cannot inject merchant URLs';
 ASSERT has_function_privilege('service_role','shopping_country_offer_cache(text,uuid,text,jsonb,uuid)','EXECUTE'),'only backend executes cache';
 a:=shopping_country_offer_cache('discovered','00000000-0000-4000-8000-000000000002','IN');
 ASSERT (a->>'claimed')::boolean,'Find/discovered path uses same policy';
END $$;
SQL
echo "Shopping-country cache SQL integration passed in isolated cluster: $task_dir"
