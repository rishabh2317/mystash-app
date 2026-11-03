#!/usr/bin/env python3
"""Offline publication concurrency/rollback checks in a disposable PostgreSQL.

Uses existing local binaries, an isolated Unix socket and a fresh temp cluster.
Never loads dotenv, contacts Supabase or touches an existing PostgreSQL service.
"""
from concurrent.futures import ThreadPoolExecutor
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin', default='/opt/homebrew/opt/postgresql@17/bin')
    args = parser.parse_args()
    binaries = Path(args.pg_bin)
    for name in ('initdb', 'pg_ctl', 'psql'):
        if not (binaries / name).is_file():
            raise SystemExit(f'Missing existing PostgreSQL tool: {name}. Nothing was installed.')
    root = Path(__file__).resolve().parents[2]
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    env['PGOPTIONS'] = '-c client_min_messages=warning'
    work = Path(tempfile.mkdtemp(prefix='mystash-publication-', dir='/private/tmp'))
    started = False

    def run(name, *args, sql=None, fail=False):
        result = subprocess.run([str(binaries / name), *map(str, args)], input=sql,
                                text=True, capture_output=True, env=env, timeout=45)
        if result.returncode and not fail:
            raise RuntimeError(result.stderr[-2500:] or result.stdout[-2500:])
        return result

    try:
        run('initdb', '-D', work / 'data', '-U', 'postgres', '-A', 'trust', '--no-locale')
        run('pg_ctl', '-D', work / 'data', '-l', work / 'log', '-w', 'start',
            '-o', f"-k {work} -p 55441 -c listen_addresses='' -c unix_socket_permissions=0700")
        started = True
        connection = ('-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', work, '-p', '55441', '-U', 'postgres')

        def sql(text, fail=False):
            result = run('psql', *connection, sql=text, fail=fail)
            if fail:
                assert result.returncode, 'Expected a database rejection'
                return result.stderr
            return result.stdout.strip()

        # videos predates the repository's migration history. Its existing core
        # columns are the only bootstrap fixture; publication tables use real DDL.
        sql('''
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
CREATE TABLE public.videos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),url text NOT NULL,thumbnail text,
 creator_name text,stash_score numeric,product_name text,embed_url text);
''')
        for name in ('20260511000000_curation_pipeline.sql', '20260728200000_product_intelligence_catalog.sql',
                     '20260806000000_collection_domain.sql', '20260812000000_videos_collection_id.sql'):
            sql((root / 'supabase/migrations' / name).read_text())
        sql("INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111');")
        sql((root / 'supabase/migrations/20261028140000_publication_concurrency.sql').read_text())
        print(sql((root / 'backend/scripts/sql/publication_checks.sql').read_text()))

        user = '11111111-1111-4111-8111-111111111111'

        def draft():
            identity = str(uuid.uuid4())
            sql(f"INSERT INTO ingest_requests(id,user_id,source_url,status) VALUES('{identity}','{user}','https://fixture.invalid','ready_for_review');")
            return identity

        def scope(identity, attempt):
            return "SELECT set_config('request.headers','" + json.dumps({
                'x-mystash-publish-ingest': identity, 'x-mystash-publish-attempt': attempt
            }) + "',false); SET ROLE service_role;\n"

        def claim(identity, attempt):
            return sql(f"SET ROLE service_role; SELECT publication_claim('{identity}','{user}','{attempt}');")

        def release(identity, attempt):
            sql(f"SET ROLE service_role; SELECT publication_release('{identity}','{attempt}');")

        def create(identity, attempt, slug):
            return sql(scope(identity, attempt) + f"INSERT INTO collections(slug,creator_id,status) VALUES('{slug}','{user}','ready_for_review') RETURNING id;").splitlines()[-1]

        # Independent psql connections represent replicas, not a shared JS mutex.
        ingest = draft()
        attempts = [str(uuid.uuid4()) for _ in range(12)]
        with ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(lambda a: claim(ingest, a), attempts))
        assert results.count('t') == 1, results
        winner = attempts[results.index('t')]
        canonical = create(ingest, winner, 'concurrent-winner')
        assert sql(f"SELECT collection_id FROM ingest_requests WHERE id='{ingest}';") == canonical
        release(ingest, winner)
        retry = str(uuid.uuid4())
        assert claim(ingest, retry) == 't'
        assert 'already owns a Collection' in sql(scope(ingest, retry) +
            f"INSERT INTO collections(slug,creator_id) VALUES('duplicate-blocked','{user}');", fail=True)
        assert sql("SELECT count(*) FROM collections WHERE slug='duplicate-blocked';") == '0'
        release(ingest, retry)
        print('PASS 12 concurrent replica claims, one canonical Collection, retry identity preserved')

        # Full request sequence across distinct connections/transactions: claim,
        # optional legacy creation, unchanged published-Collection checkpoint,
        # atomic projection, release. Acknowledgement loss retries the same IDs.
        def publish_request(identity, discard=False):
            token = str(uuid.uuid4())
            if claim(identity, token) != 't':
                return {'busy': True}
            try:
                row = json.loads(sql(f"SELECT row_to_json(i) FROM ingest_requests i WHERE id='{identity}';"))
                if row['status'] == 'published':
                    return {'videoId': row['video_id'], 'collectionId': row['collection_id']}
                if row['status'] == 'rejected':
                    return {'discarded': True}
                if discard:
                    sql(scope(identity, token) + f"UPDATE ingest_requests SET status='rejected' WHERE id='{identity}';")
                    return {'discarded': True}
                collection = row['collection_id'] or create(identity, token, 'request-' + token)
                sql(scope(identity, token) + f"UPDATE collections SET status='published',content_revision=1 WHERE id='{collection}';")
                video = json.dumps({'id': str(uuid.uuid4()), 'url': 'https://fixture.invalid', 'product_name': 'Fixture'})
                products = json.dumps([{'name': 'Fixture', 'price': '10', 'image': '', 'provider': 'catalog',
                                        'sort_order': 0, 'resolution_status': 'UNRESOLVED'}])
                result = sql(scope(identity, token) +
                             f"SELECT publication_finalize('{identity}','{collection}','{video}','{products}');")
                return json.loads(result.splitlines()[-1])
            finally:
                release(identity, token)

        for linked in (False, True):
            ingest = draft()
            if linked:
                token = str(uuid.uuid4()); assert claim(ingest, token) == 't'
                existing_collection = create(ingest, token, 'existing-' + token)
                release(ingest, token)
            with ThreadPoolExecutor(max_workers=12) as pool:
                responses = list(pool.map(lambda _: publish_request(ingest), range(12)))
            successful = [r for r in responses if not r.get('busy')]
            assert successful
            identities = {(r['collectionId'], r['videoId']) for r in successful}
            assert len(identities) == 1, identities
            collection, video = identities.pop()
            if linked:
                assert collection == existing_collection
            before = sql(f"SELECT jsonb_agg(to_jsonb(p)) FROM video_products p WHERE video_id='{video}';")
            retry_result = publish_request(ingest)
            assert (retry_result['collectionId'], retry_result['videoId']) == (collection, video)
            assert before == sql(f"SELECT jsonb_agg(to_jsonb(p)) FROM video_products p WHERE video_id='{video}';")
            assert sql(f"SELECT count(*) FROM videos WHERE collection_id='{collection}';") == '1'
            assert sql(f"SELECT count(*) FROM moderation_actions WHERE ingest_request_id='{ingest}' AND action='publish';") == '1'
            assert sql(f"SELECT status='published' AND collection_id='{collection}' AND video_id='{video}' FROM ingest_requests WHERE id='{ingest}';") == 't'
        print('PASS concurrent full publication requests for unlinked/linked drafts; lost-ack retries; one video/projection/fact')

        ingest = draft()
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda discard: publish_request(ingest, discard), (False, True)))
        row = json.loads(sql(f"SELECT row_to_json(i) FROM ingest_requests i WHERE id='{ingest}';"))
        if row['status'] == 'published':
            assert row['collection_id'] and row['video_id']
            assert publish_request(ingest, True)['videoId'] == row['video_id']
        else:
            assert row['status'] == 'rejected' and row['collection_id'] is None and row['video_id'] is None
            assert publish_request(ingest)['discarded']
        print('PASS concurrent Publish/Discard has one terminal outcome and cannot revive a discarded draft')

        # Failure of the link write rolls back the Collection insert itself.
        ingest = draft(); attempt = str(uuid.uuid4()); assert claim(ingest, attempt) == 't'
        sql(f"""CREATE FUNCTION fail_fixture_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.id='{ingest}'::uuid AND NEW.collection_id IS NOT NULL THEN RAISE EXCEPTION 'fixture link failure'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER fail_fixture_link BEFORE UPDATE ON ingest_requests FOR EACH ROW EXECUTE FUNCTION fail_fixture_link();""")
        assert 'fixture link failure' in sql(scope(ingest, attempt) +
            f"INSERT INTO collections(slug,creator_id) VALUES('rolled-back-creation','{user}');", fail=True)
        assert sql("SELECT count(*) FROM collections WHERE slug='rolled-back-creation';") == '0'
        assert sql(f"SELECT collection_id IS NULL FROM ingest_requests WHERE id='{ingest}';") == 't'
        sql('DROP TRIGGER fail_fixture_link ON ingest_requests; DROP FUNCTION fail_fixture_link();')
        release(ingest, attempt)
        successor = str(uuid.uuid4()); assert claim(ingest, successor) == 't'
        create(ingest, successor, 'creation-retry'); release(ingest, successor)
        print('PASS Collection+link rollback and safe same-draft retry')

        # Expiry does not allow takeover to pass a transaction already writing.
        ingest = draft(); attempt = str(uuid.uuid4()); successor = str(uuid.uuid4())
        assert claim(ingest, attempt) == 't'; canonical = create(ingest, attempt, 'fencing')
        sql(f"UPDATE ingest_publication_leases SET expires_at=clock_timestamp()+interval '500 milliseconds' WHERE ingest_id='{ingest}';")
        process = subprocess.Popen([str(binaries / 'psql'), *map(str, connection)], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
        process.stdin.write(scope(ingest, attempt) + f"BEGIN; UPDATE collections SET title='in-flight winner' WHERE id='{canonical}';\n\\echo MUTATION_LOCKED\nSELECT pg_sleep(1.2); COMMIT;\n")
        process.stdin.close()
        while process.stdout.readline().strip() != 'MUTATION_LOCKED':
            if process.poll() is not None:
                raise RuntimeError(process.stderr.read())
        # Wait for expiry using a separate DB request; no application clock assumption.
        sql('SELECT pg_sleep(0.6);')
        assert claim(ingest, successor) == 't'
        assert process.wait(timeout=10) == 0, process.stderr.read()
        assert 'PUBLICATION_STALE' in sql(scope(ingest, attempt) +
            f"UPDATE collections SET title='stale overwrite' WHERE id='{canonical}';", fail=True)
        release(ingest, attempt)
        assert sql(f"SELECT attempt_id FROM ingest_publication_leases WHERE ingest_id='{ingest}' AND active;") == successor
        assert sql(f"SELECT title FROM collections WHERE id='{canonical}';") == 'in-flight winner'
        release(ingest, successor)
        print('PASS in-flight write versus expired-lease takeover, stale-write fencing, token-safe release')
    finally:
        if started:
            run('pg_ctl', '-D', work / 'data', '-w', 'stop', '-m', 'immediate')
        shutil.rmtree(work)


if __name__ == '__main__':
    main()
