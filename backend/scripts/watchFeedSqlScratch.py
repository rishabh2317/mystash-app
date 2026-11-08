#!/usr/bin/env python3
"""Exercise the Watch read policy in an isolated Unix-socket PostgreSQL cluster."""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
BIN = Path('/opt/homebrew/opt/postgresql@17/bin')


def main():
    env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
    with tempfile.TemporaryDirectory(prefix='mystash-watch-', dir='/private/tmp') as directory:
        path = Path(directory)

        def run(tool, *args, sql=None):
            result = subprocess.run([str(BIN / tool), *map(str, args)], input=sql,
                                    text=True, capture_output=True, env=env)
            if result.returncode:
                raise RuntimeError(result.stderr[-3000:] or result.stdout[-3000:])
            return result.stdout

        run('initdb', '-D', path / 'data', '-U', 'postgres', '-A', 'trust', '--no-locale')
        try:
            run('pg_ctl', '-D', path / 'data', '-l', path / 'postgres.log', '-w', 'start',
                '-o', f"-k {path} -p 55443 -c listen_addresses='' -c unix_socket_permissions=0700")
            connection = ('-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', path, '-p', '55443', '-U', 'postgres')

            def sql(source):
                return run('psql', *connection, sql=source)

            sql('''
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE TABLE public.collections (
  id uuid PRIMARY KEY, status text, visibility text, moderation_state text,
  deleted_at timestamptz, feed_eligible boolean
);
CREATE TABLE public.videos (
  id uuid PRIMARY KEY, collection_id uuid REFERENCES public.collections(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY videos_select_public ON public.videos FOR SELECT USING (true);
GRANT SELECT ON public.collections, public.videos TO anon, authenticated;
INSERT INTO public.collections VALUES
 ('11111111-1111-4111-8111-111111111111','published','public','clear',NULL,true),
 ('22222222-2222-4222-8222-222222222222','published','private','clear',NULL,true),
 ('33333333-3333-4333-8333-333333333333','unpublished','public','clear',NULL,true),
 ('44444444-4444-4444-8444-444444444444','published','public','takedown',NULL,true),
 ('55555555-5555-4555-8555-555555555555','published','public','clear',NULL,false);
INSERT INTO public.videos(id,collection_id) SELECT id,id FROM public.collections;
INSERT INTO public.videos(id) VALUES ('66666666-6666-4666-8666-666666666666');
''')
            sql((ROOT / 'supabase/migrations/20261106120000_watch_feed_visibility.sql').read_text())
            for role in ('anon', 'authenticated'):
                result = sql(f"SET ROLE {role}; SELECT count(*) FROM public.videos; RESET ROLE;")
                if result.strip() != '1':
                    raise AssertionError(f'{role} sees unexpected feed count: {result!r}')
            sql("UPDATE public.collections SET visibility='private' WHERE id='11111111-1111-4111-8111-111111111111';")
            result = sql('SET ROLE anon; SELECT count(*) FROM public.videos; RESET ROLE;')
            if result.strip() != '0':
                raise AssertionError(f'Unpublished feed row remained readable: {result!r}')
            index = sql("SELECT count(*) FROM pg_indexes WHERE indexname='videos_watch_feed_order_idx';")
            if index.strip() != '1':
                raise AssertionError('Watch ordering index missing')
            print('Watch feed visibility and ordering index checks passed.')
        finally:
            run('pg_ctl', '-D', path / 'data', '-m', 'immediate', '-w', 'stop')


if __name__ == '__main__':
    main()
