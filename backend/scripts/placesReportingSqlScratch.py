#!/usr/bin/env python3
"""Validate Places reporting migration in a disposable Unix-socket-only PostgreSQL.

No dotenv, URLs, Supabase CLI, remote database, or existing cluster is used.
Only this invocation's temporary directory is removed on exit.
"""
from concurrent.futures import ThreadPoolExecutor
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin', default='/opt/homebrew/opt/postgresql@17/bin')
    parser.add_argument('--milestone2', action='store_true')
    args = parser.parse_args()
    binaries = Path(args.pg_bin)
    for name in ('initdb', 'pg_ctl', 'psql'):
        if not (binaries / name).is_file():
            raise SystemExit(f'Missing local PostgreSQL tool: {name}; nothing was installed or run.')
    root = Path(__file__).resolve().parents[2]
    env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
    env['PGOPTIONS'] = '-c client_min_messages=warning'
    work = Path(tempfile.mkdtemp(prefix='mystash-places-', dir='/private/tmp'))
    started = False

    def run(name, *arguments, sql=None):
        result = subprocess.run([str(binaries / name), *map(str, arguments)], input=sql,
                                text=True, capture_output=True, env=env)
        if result.returncode:
            raise RuntimeError(result.stderr[-3000:] or result.stdout[-3000:])
        return result.stdout

    try:
        run('initdb', '-D', work / 'data', '-U', 'postgres', '-A', 'trust', '--no-locale')
        run('pg_ctl', '-D', work / 'data', '-l', work / 'postgres.log', '-w', 'start',
            '-o', f"-k {work} -p 55439 -c listen_addresses='' -c unix_socket_permissions=0700")
        started = True
        connection = ('-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', work, '-p', '55439', '-U', 'postgres')

        def sql(source):
            return run('psql', *connection, sql=source)

        sql('''
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Match Supabase default grants, proving the migration explicitly removes them.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
''')
        for name in ('20260920120000_user_imports.sql', '20260920140000_content_sources.sql',
                     '20260922140000_user_import_timeout.sql', '20260930150000_places.sql',
                     '20260930160000_place_pending_resolution.sql'):
            sql((root / 'supabase/migrations' / name).read_text())
        sql('''
INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111');
INSERT INTO public.content_sources(id, platform, external_id, canonical_url, media_kind, processing_status, pipeline_version)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','youtube','fixture','https://example.invalid','VIDEO','READY','fixture');
INSERT INTO public.user_imports(id,user_id,raw_input,source_url,normalized_url,dedupe_key,platform,status,content_source_id)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111',
 'fixture','https://example.invalid','https://example.invalid','fixture','youtube','RECEIVED','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO public.content_source_places(id,content_source_id,extracted_name,resolution_state,unresolved_reason,hypothesis_key)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fixture cafe','unresolved','ambiguous','fixture');
INSERT INTO public.user_place_saves(user_id,content_source_place_id,content_source_id,user_import_id)
VALUES ('11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
CREATE TABLE public.before_milestone AS SELECT to_jsonb(i) AS row FROM public.user_imports i;
''')
        sql((root / 'supabase/migrations/20261028120000_user_import_result_reporting.sql').read_text())
        output = sql('''
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM before_milestone b WHERE NOT EXISTS(
  SELECT 1 FROM public.user_imports i WHERE to_jsonb(i)-'hidden_at'-'attempt_started_at'=b.row))
 THEN RAISE EXCEPTION 'Migration changed existing import data'; END IF;
 IF (SELECT count(*) FROM public.user_place_saves)<>1 THEN RAISE EXCEPTION 'Lost place save'; END IF;
 IF has_table_privilege('anon','public.content_source_import_progress','SELECT')
  OR has_table_privilege('authenticated','public.content_source_import_progress','SELECT')
  OR has_table_privilege('authenticated','public.content_source_import_progress','INSERT')
 THEN RAISE EXCEPTION 'Private progress grants leaked'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.content_source_import_progress'::regclass)
 THEN RAISE EXCEPTION 'RLS missing'; END IF;
END $$;
SET ROLE service_role;
INSERT INTO public.content_source_import_progress(content_source_id,attempt_id,started_at,product_status,place_status) VALUES (
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','dddddddd-dddd-4ddd-8ddd-dddddddddddd',now(),'complete','failed');
UPDATE public.content_source_import_progress SET attempt_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
 product_status='running',place_status='running';
UPDATE public.content_source_import_progress SET product_status='complete'
 WHERE attempt_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
DO $$ BEGIN
 IF (SELECT product_status FROM public.content_source_import_progress)<>'running'
 THEN RAISE EXCEPTION 'Stale branch overwrote a newer attempt'; END IF;
 BEGIN
  UPDATE public.content_source_import_progress SET place_status='invented';
  RAISE EXCEPTION 'Invalid status accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;
-- Existing API operation becomes a visibility update, preserving the restrictive FK.
UPDATE public.user_imports SET hidden_at=now();
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.user_imports WHERE hidden_at IS NULL)
 THEN RAISE EXCEPTION 'History not hidden'; END IF;
 IF (SELECT count(*) FROM public.user_place_saves)<>1 THEN RAISE EXCEPTION 'History hide lost save'; END IF;
 BEGIN
  DELETE FROM public.user_imports;
  RAISE EXCEPTION 'Restrictive provenance FK disappeared';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
UPDATE public.user_imports SET hidden_at=NULL,attempt_started_at=now(),timed_out_at=NULL;
-- Old timeout with the pre-retry NULL generation must not freeze the new retry.
UPDATE public.user_imports SET timed_out_at=now() WHERE attempt_started_at IS NULL;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.user_imports WHERE timed_out_at IS NOT NULL OR hidden_at IS NOT NULL)
 THEN RAISE EXCEPTION 'Old timeout froze retry or history stayed hidden'; END IF;
 IF (SELECT count(*) FROM public.user_place_saves)<>1 THEN RAISE EXCEPTION 'Retry lost save'; END IF;
END $$;
SELECT 'PASS migration preserves imports/saves; private grants/RLS; service-role writes; stale-attempt fencing; status constraints; history hide/restore; provenance FK; retry timeout CAS';
''')
        print(output.strip())
        if args.milestone2:
            sql((root / 'supabase/migrations/20260920160000_content_source_products.sql').read_text())
            # Minimal support-table fixtures exercise the same statement guard used
            # on real Cart/catalog/cache/discovered tables, without unrelated migrations.
            sql("CREATE TABLE public.cart_items(id uuid PRIMARY KEY,value int); CREATE TABLE public.video_extraction_cache(id uuid PRIMARY KEY,value int); CREATE TABLE public.discovered_products(id uuid PRIMARY KEY,value int); CREATE TABLE public.catalog_products(id uuid PRIMARY KEY,value int);")
            sql((root / 'supabase/migrations/20261028130000_places_reliability.sql').read_text())
            checks = sql((root / 'backend/scripts/sql/places_milestone2_checks.sql').read_text())
            print('\n'.join(line.strip() for line in checks.splitlines() if line.strip().startswith('PASS ')))
            def parallel(commands):
                with ThreadPoolExecutor(max_workers=2) as pool:
                    return list(pool.map(lambda command: run('psql', *connection, '-At', sql=command), commands))

            source_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'
            attempts = ['66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777']
            claimed = parallel([f"SELECT (public.import_work_claim('{source_id}','{attempt}','race') IS NOT NULL)::int;" for attempt in attempts])
            assert sorted(result.strip() for result in claimed) == ['0', '1'], 'Concurrent lease claims admitted two owners'
            winner = run('psql', *connection, '-At', sql=f"SELECT attempt_id FROM public.content_source_import_progress WHERE content_source_id='{source_id}';").strip()
            headers = json.dumps({'x-mystash-import-source': source_id, 'x-mystash-import-attempt': winner})
            parallel([f"BEGIN; SET LOCAL request.headers='{headers}'; UPDATE public.content_source_import_progress SET {column}='complete' WHERE content_source_id='{source_id}'; COMMIT;" for column in ['product_status', 'place_status']])
            assert run('psql', *connection, '-At', sql=f"SELECT (product_status='complete' AND place_status='complete')::int FROM public.content_source_import_progress WHERE content_source_id='{source_id}';").strip() == '1'
            print('PASS concurrent claims admit one owner and concurrent branch completions both persist')

            # A takeover must wait for the previous owner's write transaction. It
            # cannot become owner and then receive a commit from that old transaction.
            sql(f"UPDATE public.content_source_import_progress SET lease_expires_at=clock_timestamp()+interval '500 milliseconds' WHERE content_source_id='{source_id}';")
            process = subprocess.Popen([str(binaries / 'psql'), *map(str, connection), '-At'],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
            process.stdin.write(f"BEGIN; SET LOCAL request.headers='{headers}'; UPDATE public.content_sources SET candidate_count=42 WHERE id='{source_id}'; SELECT 'M2_FENCE_LOCKED'; SELECT pg_sleep(0.8); COMMIT;\n")
            process.stdin.close()
            while True:
                line = process.stdout.readline()
                if 'M2_FENCE_LOCKED' in line:
                    break
                if not line:
                    raise RuntimeError(process.stderr.read())
            successor = '88888888-8888-4888-8888-888888888888'
            takeover = run('psql', *connection, '-At', sql=f"SELECT (public.import_work_claim('{source_id}','{successor}','race') IS NOT NULL)::int;")
            process.wait(timeout=10)
            assert process.returncode == 0 and takeover.strip() == '1', 'Takeover did not serialize with the in-flight write'
            assert run('psql', *connection, '-At', sql=f"SELECT candidate_count FROM public.content_sources WHERE id='{source_id}';").strip() == '42'
            print('PASS lease takeover waits for prior write transaction before admitting its successor')

            commands = []
            for i, sid, iid in [(3, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
                                (4, source_id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc')]:
                row = json.dumps({'content_source_id': sid, 'extracted_name': 'Concurrent venue', 'hypothesis_key': f'concurrent-{i}', 'unresolved_reason': 'pending_resolution'})
                place = json.dumps({'provider': 'fixture', 'provider_place_id': 'concurrent-provider-id', 'name': 'Concurrent venue'})
                commands.append(f"SELECT public.place_attach_import('11111111-1111-4111-8111-111111111111',(public.place_resolve_hypothesis('{row}','{place}')->>'id')::uuid,'{sid}','{iid}');")
            parallel(commands)
            assert run('psql', *connection, '-At', sql="SELECT count(*) FROM public.user_place_saves s JOIN public.places p ON p.id=s.place_id WHERE p.provider_place_id='concurrent-provider-id';").strip() == '1'
            assert run('psql', *connection, '-At', sql="SELECT count(*) FROM public.user_place_save_sources x JOIN public.user_place_saves s ON s.id=x.save_id JOIN public.places p ON p.id=s.place_id WHERE p.provider_place_id='concurrent-provider-id';").strip() == '2'
            print('PASS concurrent provider identity promotion keeps one card and two source links')

    finally:
        if started:
            run('pg_ctl', '-D', work / 'data', '-w', 'stop', '-m', 'immediate')
        shutil.rmtree(work)


if __name__ == '__main__':
    main()
