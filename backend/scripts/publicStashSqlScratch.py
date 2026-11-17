"""Real PostgreSQL tests on a disposable, Unix-socket-only cluster. No remote access."""
from pathlib import Path
import os, subprocess, tempfile, shutil, concurrent.futures
ROOT=Path(__file__).resolve().parents[2]
work=Path(tempfile.mkdtemp(prefix='mystash-public-stash-pg-'))
env={**os.environ,'PGOPTIONS':'-c client_min_messages=warning'}
port='55439'
def command(args,**kw): return subprocess.run(args,check=True,text=True,env=env,**kw)
def sql(text): return command(['psql','-X','-q','-t','-A','-h',str(work),'-p',port,'-U','postgres','-v','ON_ERROR_STOP=1'],input=text,capture_output=True).stdout
try:
 command(['initdb','-D',str(work/'data'),'-U','postgres','-A','trust'],stdout=subprocess.DEVNULL)
 command(['pg_ctl','-D',str(work/'data'),'-o',f"-p {port} -k {work} -c listen_addresses=''",'-l',str(work/'log'),'-w','start'],stdout=subprocess.DEVNULL)
 sql('''CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE TABLE public.users(id uuid PRIMARY KEY REFERENCES auth.users(id),username text,profile_photo_url text,account_status text DEFAULT 'ACTIVE',deleted_at timestamptz);
 CREATE TABLE catalog_products(id uuid PRIMARY KEY,name text,brand text,image_url text,status text DEFAULT 'ACTIVE',merged_into_id uuid);
 CREATE TABLE content_sources(id uuid PRIMARY KEY);CREATE TABLE user_imports(id uuid PRIMARY KEY,user_id uuid,content_source_id uuid,hidden_at timestamptz);
 CREATE TABLE content_source_products(id uuid PRIMARY KEY,content_source_id uuid);
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
 GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
 ''')
 for name in ['20260811120000_cart_domain.sql','20260920180000_discovered_products.sql','20260930150000_places.sql']:
  sql((ROOT/'supabase/migrations'/name).read_text())
 sql('''ALTER TABLE cart_items ADD COLUMN removed_at timestamptz,ADD COLUMN explicit_action_at timestamptz;
 ALTER TABLE user_place_saves ADD COLUMN removed_at timestamptz,ADD COLUMN explicit_action_at timestamptz;
 ALTER TABLE content_source_places ADD COLUMN retired_at timestamptz;
 CREATE TABLE place_save_redirects(old_save_id uuid PRIMARY KEY,save_id uuid REFERENCES user_place_saves(id));
 CREATE TABLE user_place_save_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),save_id uuid,user_id uuid,content_source_place_id uuid,content_source_id uuid,user_import_id uuid);
 CREATE FUNCTION import_work_assert() RETURNS void LANGUAGE sql AS $$SELECT$$;
 REVOKE INSERT,UPDATE,DELETE ON cart_items,user_place_saves FROM PUBLIC,anon,authenticated;
 ''')
 foundations=(ROOT/'supabase/migrations/20261103120000_find_foundations.sql').read_text()
 for name in ['find_catalog_survivor','find_cart_put','find_cart_remove']:
  start=foundations.index('CREATE FUNCTION public.'+name+'(');end=foundations.index('$$;',start)+3
  sql(foundations[start:end])
 sql((ROOT/'supabase/migrations/20261117120000_public_stash.sql').read_text())
 sql((ROOT/'backend/scripts/sql/public_stash_checks.sql').read_text())
 sql("""CREATE TABLE product_clicks(id uuid PRIMARY KEY,event_id uuid UNIQUE,user_id uuid,created_at timestamptz);
 CREATE TABLE collections(id uuid PRIMARY KEY,creator_id uuid,status text,visibility text,moderation_state text,deleted_at timestamptz);
 CREATE TABLE collection_product_tags(id uuid,collection_id uuid,catalog_product_id uuid,discovered_product_id uuid);
 CREATE FUNCTION engagement_commit(p_fact jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT p_fact$$;
 """)
 sql((ROOT/'supabase/migrations/20260807120000_engagement_domain.sql').read_text())
 sql((ROOT/'supabase/migrations/20261027130000_behavioral_measurement.sql').read_text())
 sql((ROOT/'supabase/migrations/20261117130000_public_stash_measurement.sql').read_text())
 sql((ROOT/'backend/scripts/sql/public_stash_measurement_checks.sql').read_text())
 # Separate real transactions must serialize rather than resurrect an unsaved selection.
 sql("UPDATE cart_items SET removed_at=NULL WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';")
 def race(q):
  try:sql(q);return True
  except subprocess.CalledProcessError:return False
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  results=list(pool.map(race,["SELECT public_stash_publish('11111111-1111-4111-8111-111111111111','product','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true,(SELECT publication_version FROM cart_items WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));", "SELECT find_cart_remove('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',NULL);"]))
 sql("DO $$ BEGIN IF EXISTS(SELECT 1 FROM cart_items WHERE removed_at IS NOT NULL AND published_at IS NOT NULL) THEN RAISE EXCEPTION 'Race resurrected publication';END IF;END $$;")
 if not results[1]:raise AssertionError('Concurrent unsave failed')
 # Even an already-unpublished desired state is an explicit, versioned decision.
 sql("UPDATE cart_items SET removed_at=NULL WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';")
 initial=int(sql("SELECT publication_version FROM cart_items WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';").strip())
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  decisions=list(pool.map(race,[f"SELECT public_stash_publish('11111111-1111-4111-8111-111111111111','product','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{decision},{initial});" for decision in ['true','false']]))
 if sum(decisions)!=1:raise AssertionError('Conflicting publication versions did not serialize')
 final=int(sql("SELECT publication_version FROM cart_items WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';").strip())
 if final!=initial+1:raise AssertionError('Explicit decision did not advance version')

 print('Public Stash SQL: privacy, grants, explicit selection, unsave, restore, direct Place save, version conflict, soft deletion and concurrent unsave checks passed.')
except subprocess.CalledProcessError as e:
 print(e.stdout or '');print(e.stderr or '');raise
finally:
 subprocess.run(['pg_ctl','-D',str(work/'data'),'stop','-m','immediate'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 shutil.rmtree(work)
