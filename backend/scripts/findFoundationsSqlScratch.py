#!/usr/bin/env python3
"""Find phase 1 checks in a fresh Unix-socket-only PostgreSQL. No dotenv or live services."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import os
import shutil
import subprocess
import tempfile


def main(verify_queries=False, verify_images=False, verify_delivery=False, verify_readiness=False):
    root = Path(__file__).resolve().parents[2]
    binaries = Path('/opt/homebrew/opt/postgresql@17/bin')
    for name in ('initdb', 'pg_ctl', 'psql'):
        if not (binaries / name).is_file():
            raise SystemExit(f'Missing existing PostgreSQL tool: {name}; nothing installed.')
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    work = Path(tempfile.mkdtemp(prefix='mystash-find-foundations-', dir='/private/tmp'))
    started = False

    def run(name, *args, sql=None):
        result = subprocess.run([str(binaries / name), *map(str, args)], input=sql,
                                text=True, capture_output=True, env=env, timeout=60)
        if result.returncode:
            raise RuntimeError(result.stderr[-4000:] or result.stdout[-4000:])
        return result.stdout.strip()

    try:
        run('initdb', '-D', work / 'data', '-U', 'postgres', '-A', 'trust', '--no-locale')
        run('pg_ctl', '-D', work / 'data', '-l', work / 'postgres.log', '-w', 'start',
            '-o', f"-k {work} -p 55443 -c listen_addresses='' -c unix_socket_permissions=0700")
        started = True
        connection = ('-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', work, '-p', '55443', '-U', 'postgres')

        def sql(text):
            return run('psql', *connection, sql=text)

        sql('''
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
CREATE TABLE catalog_products(id uuid PRIMARY KEY,status text NOT NULL DEFAULT 'ACTIVE',merged_into_id uuid,image_url text);
''')
        for migration in ('20260811120000_cart_domain.sql', '20260920120000_user_imports.sql',
                          '20260920140000_content_sources.sql', '20260920160000_content_source_products.sql',
                          '20260920180000_discovered_products.sql', '20260922140000_user_import_timeout.sql',
                          '20260930150000_places.sql', '20260930160000_place_pending_resolution.sql',
                          '20261028120000_user_import_result_reporting.sql', '20261028130000_places_reliability.sql'):
            sql((root / 'supabase/migrations' / migration).read_text())
        sql('''
INSERT INTO auth.users VALUES('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
INSERT INTO catalog_products(id) VALUES('33333333-3333-4333-8333-333333333333'),('44444444-4444-4444-8444-444444444444');
INSERT INTO content_sources(id,platform,external_id,canonical_url,media_kind,processing_status,pipeline_version)
 VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','youtube','fixture','https://fixture.invalid','VIDEO','READY','fixture');
INSERT INTO user_imports(id,user_id,raw_input,source_url,normalized_url,dedupe_key,content_source_id)
 VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','fixture','https://fixture.invalid','https://fixture.invalid','fixture','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO cart_items(user_id,catalog_product_id) VALUES('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333');
''')
        sql((root / 'supabase/migrations/20261103120000_find_foundations.sql').read_text())
        output = sql((root / 'backend/scripts/sql/find_foundations_checks.sql').read_text())
        print(output)
        user = '11111111-1111-4111-8111-111111111111'
        product = '44444444-4444-4444-8444-444444444444'
        imported = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
        source = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
        attribution = json.dumps({'source_surface': 'USER_IMPORT', 'source_content_source_id': source, 'source_user_import_id': imported})
        put = f"SELECT find_cart_put('{user}','{product}',NULL,'{attribution}',true);"
        remove = f"SELECT find_cart_remove('{user}','{product}',NULL);"
        sql(f"UPDATE user_imports SET hidden_at=NULL WHERE id='{imported}';")
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(sql, [put, remove]))
        sql(put)
        assert sql(f"SELECT count(*) FROM cart_items WHERE user_id='{user}' AND catalog_product_id='{product}' AND removed_at IS NULL;") == '0'
        print('PASS concurrent automatic add/remove remains removed after replay')
        # Independent replicas must not claim the same delivery or acknowledge another lease.
        sql(f"UPDATE user_imports SET stash_sync_state='pending',stash_sync_lease=NULL,stash_sync_until=NULL,stash_sync_after=now() WHERE id='{imported}';")
        with ThreadPoolExecutor(max_workers=2) as pool:
            claims = list(pool.map(sql, [f"SELECT count(*) FROM find_claim_stash_sync('{lease}');" for lease in
                                       ['66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777']]))
        assert sorted(claims) == ['0', '1']
        print('PASS concurrent recovery claims admit exactly one owner')
        if verify_queries:
            # Metadata columns from the existing creator-library schema; unrelated tables stay stubbed.
            sql('ALTER TABLE content_sources ADD COLUMN title text, ADD COLUMN thumbnail_url text;')
            for migration in ('20261102120000_share_acceptance.sql', '20261102130000_share_intent.sql', '20261102140000_share_reviews.sql', '20261103130000_find_queries.sql'):
                sql((root / 'supabase/migrations' / migration).read_text())
            corpus = subprocess.run(['node', '--import', './backend/node_modules/tsx/dist/loader.mjs',
                                     'backend/src/user-import/find/outcomeParityFixtures.ts'], cwd=root, text=True,
                                    capture_output=True, check=True, timeout=30).stdout
            mismatch = sql("SELECT count(*) FROM jsonb_array_elements($fixtures$" + corpus + "$fixtures$::jsonb) c WHERE find_project_outcome(c->'row',(c->>'now')::timestamptz) IS DISTINCT FROM c->'expected';")
            assert mismatch == '0', f'Outcome parity mismatches: {mismatch}'
            print(f'PASS {len(json.loads(corpus))} SQL/reference outcome parity cases')
            print(sql((root / 'backend/scripts/sql/find_queries_checks.sql').read_text()))
            owner = '55555555-5555-4555-8555-555555555555'
            imported = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
            source = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
            product_row = sql(f"SELECT id FROM content_source_products WHERE content_source_id='{source}' ORDER BY position LIMIT 1;")
            sql(f"UPDATE user_imports SET hidden_at=NULL WHERE id='{imported}';")
            automatic = f"SELECT find_cart_put('{owner}','{product}',NULL,'{{\"source_surface\":\"USER_IMPORT\",\"source_user_import_id\":\"{imported}\",\"source_content_source_id\":\"{source}\"}}',true);"
            removal = f"SELECT find_result_action('{owner}','{imported}','product','{product_row}',false,'c:{product}');"
            with ThreadPoolExecutor(max_workers=2) as pool:
                list(pool.map(sql, [automatic, removal]))
            sql(automatic)
            assert sql(f"SELECT find_detail('{owner}','{imported}')->'outcome'->>'savedProducts';") == '0'
            print('PASS Find result removal races automatic delivery without resurrection')
            hypothesis = sql(f"SELECT id FROM content_source_places WHERE content_source_id='{source}' LIMIT 1;")
            canonical = sql("INSERT INTO places(provider,provider_place_id,name) VALUES('find-race','one','Fixture cafe') RETURNING id;")
            with ThreadPoolExecutor(max_workers=2) as pool:
                list(pool.map(sql, [f"SELECT find_result_action('{owner}','{imported}','place','{hypothesis}',false);",
                                    f"SELECT place_mark_resolved('{hypothesis}','{canonical}');"]))
            sql(f"SELECT place_attach_import('{owner}','{hypothesis}','{source}','{imported}');")
            assert sql(f"SELECT find_detail('{owner}','{imported}')->'outcome'->>'savedPlaces';") == '0'
            print('PASS concurrent place promotion/removal retains removal and provenance')
            def toggle():
                for _ in range(8):
                    sql(f"SELECT find_result_action('{owner}','{imported}','product','{product_row}',true,'c:{product}');")
                    sql(removal)
            def read_consistent():
                for _ in range(8):
                    detail = json.loads(sql(f"SELECT find_detail('{owner}','{imported}');"))
                    assert detail['outcome']['savedProducts'] == int(any(p['saved'] for p in detail['products']))
            with ThreadPoolExecutor(max_workers=2) as pool:
                a = pool.submit(toggle)
                b = pool.submit(read_consistent)
                a.result(); b.result()
            def update_intent():
                try:
                    return sql(f"SELECT share_update_intent('{owner}','{imported}','place','fixture note',0);")
                except RuntimeError as error:
                    assert 'revision_conflict' in str(error)
                    return 'conflict'
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda _: update_intent(), range(2)))
            assert sorted(results) == ['1', 'conflict']
            print('PASS snapshot-consistent details during mutations and existing intent revision concurrency')
            integration = subprocess.run(['node', '--import', './backend/node_modules/tsx/dist/loader.mjs',
                                           'backend/src/user-import/find/queryIntegrationRunner.ts'], cwd=root,
                                          env={**env, 'FIND_TEST_PG_SOCKET': str(work)}, text=True,
                                          capture_output=True, timeout=60)
            if integration.returncode:
                raise RuntimeError(integration.stderr[-5000:] or integration.stdout[-5000:])
            print(integration.stdout.strip())


        if verify_images:
            sql("""CREATE TABLE public.users(id uuid PRIMARY KEY,deleted_at timestamptz,account_status text DEFAULT 'ACTIVE');
CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO anon,authenticated,service_role; GRANT ALL ON storage.objects TO anon,authenticated,service_role;
INSERT INTO users(id) SELECT id FROM auth.users;
""")
            sql((root / 'supabase/migrations/20261103150000_find_private_images.sql').read_text())
            sql((root / 'supabase/migrations/20261103170000_find_import_work_assert_fix.sql').read_text())
            print(sql((root / 'backend/scripts/sql/find_import_work_assert_fix_checks.sql').read_text()))
            print(sql((root / 'backend/scripts/sql/find_images_checks.sql').read_text()))
            image_test = subprocess.run(['node', '--import', './backend/node_modules/tsx/dist/loader.mjs',
                                         'backend/src/user-import/media/integrationRunner.ts'], cwd=root,
                                        env={**env, 'FIND_TEST_PG_SOCKET': str(work)},text=True,capture_output=True,timeout=60)
            if image_test.returncode:
                raise RuntimeError(image_test.stderr[-5000:] or image_test.stdout[-5000:])
            print(image_test.stdout.strip())

        if verify_delivery:
            sql((root / 'backend/scripts/sql/find_delivery_fixture.sql').read_text())
            for migration in ('20261012120000_notifications_inbox.sql', '20261013120000_notifications_push.sql',
                              '20261014120000_notifications_push_revocation.sql', '20261015120000_notifications_campaigns.sql',
                              '20261027130000_behavioral_measurement.sql', '20261027140000_creator_analytics.sql',
                              '20261027150000_admin_analytics.sql', '20261103160000_find_notifications_measurement.sql'):
                sql((root / 'supabase/migrations' / migration).read_text())
            print(sql((root / 'backend/scripts/sql/find_delivery_checks.sql').read_text()))
            with ThreadPoolExecutor(max_workers=2) as pool:
                list(pool.map(sql, ['SELECT find_reconcile_delivery(true,true,25);'] * 2))
            print(sql("SELECT find_test_assert((SELECT count(*)=1 FROM notification_outbox WHERE payload->>'findId'='dddddddd-4444-4444-8444-444444444444'),'concurrent terminal reconciliation creates one capture notification');"))
            print('PASS concurrent Find delivery through the existing notification outbox')
            owner = '77777777-7777-4777-8777-777777777777'
            sql(f"SELECT find_test_empty('{owner}','dddddddd-8888-4888-8888-888888888888','cccccccc-8888-4888-8888-888888888888');")
            with ThreadPoolExecutor(max_workers=2) as pool:
                list(pool.map(sql, ['SELECT find_reconcile_delivery(true,true,25);',
                                    f"SELECT analytics_set_preferences('{owner}',false,false);"]))
            print(sql(f"SELECT find_test_assert(NOT EXISTS(SELECT 1 FROM analytics_events WHERE actor_id='{owner}') AND (SELECT find_measurement_revision IS NULL FROM user_imports WHERE id='dddddddd-8888-4888-8888-888888888888'),'concurrent withdrawal fences operational measurement');"))
            print('PASS concurrent consent withdrawal and terminal reconciliation')

        if verify_readiness:
            assert verify_queries and verify_images and verify_delivery
            integrated = subprocess.run(['node', '--import', './backend/node_modules/tsx/dist/loader.mjs',
                                         'scripts/findReadinessIntegration.cjs'], cwd=root,
                                        env={**env, 'FIND_TEST_PG_SOCKET': str(work)},
                                        text=True, capture_output=True, timeout=120)
            if integrated.returncode:
                raise RuntimeError(integrated.stderr[-6000:] or integrated.stdout[-6000:])
            print(integrated.stdout.strip())



    finally:
        if started:
            run('pg_ctl', '-D', work / 'data', '-m', 'immediate', '-w', 'stop')
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    main()
