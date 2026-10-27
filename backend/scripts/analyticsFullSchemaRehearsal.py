#!/usr/bin/env python3
from pathlib import Path
import os,subprocess,json,tempfile,sys,hashlib,argparse
os.umask(0o077)
parser=argparse.ArgumentParser(description='Offline, network-denied PostgreSQL 17 analytics migration rehearsal; never connects to production.')
parser.add_argument('--archive',required=True,type=Path)
parser.add_argument('--role-inventory',required=True,type=Path)
parser.add_argument('--release-sql',type=Path)
parser.add_argument('--pg-bin',type=Path,default=Path('/opt/homebrew/opt/postgresql@17/bin'))
args=parser.parse_args()
root=Path(__file__).resolve().parents[2]
archive=args.archive.resolve();private=archive.parent;pg=args.pg_bin.resolve()
roles=json.loads(args.role_inventory.read_text())['rows'][0]['role_inventory']
if not archive.is_file() or not (pg/'pg_restore').is_file():raise SystemExit('A private backup and PostgreSQL 17 binaries are required.')
work=Path(tempfile.mkdtemp(prefix='rehearsal-',dir=private));data=work/'data';sock=Path(tempfile.mkdtemp(prefix='mystash-rehearsal-socket-'))
log=(work/'runner.log').open('w')
def run(args,input=None):
 r=subprocess.run([str(a) for a in args],input=input,text=True,stdout=log,stderr=log)
 if r.returncode:raise RuntimeError('Local rehearsal step failed; inspect private runner.log without exposing records.')
psql=[pg/'psql','-X','-q','-h',sock,'-p','55439','-U','rehearsal_admin','-d','postgres','-v','ON_ERROR_STOP=1']
def sql(s):run(psql,input=s)
def ident(s):return '"'+s.replace('"','""')+'"'
def snapshot():
 query="""CREATE FUNCTION pg_temp.business_counts() RETURNS jsonb LANGUAGE plpgsql AS $$
 DECLARE t record;n bigint;r jsonb:='{}';BEGIN FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE s.nspname='public' AND c.relkind IN ('r','p') AND c.relname NOT LIKE 'analytics_%' AND c.relname NOT IN ('engagement_counter_projections','engagement_counter_baselines','engagement_reconciliation_runs') ORDER BY c.relname LOOP EXECUTE format('SELECT count(*) FROM public.%I',t.relname) INTO n;r:=r||jsonb_build_object(t.relname,n);END LOOP;RETURN r;END $$;
 SELECT jsonb_build_object('counts',pg_temp.business_counts(),'collection_mirrors',(SELECT md5(string_agg(concat_ws(':',id,views_count,saves_count,shares_count,product_clicks_count),'|' ORDER BY id)) FROM public.collections),'user_mirrors',(SELECT md5(string_agg(concat_ws(':',id,followers_count,following_count),'|' ORDER BY id)) FROM public.users));"""
 r=subprocess.run([str(a) for a in psql]+['-At'],input=query,text=True,capture_output=True)
 if r.returncode:raise RuntimeError('Local business-record parity capture failed.')
 return json.loads(r.stdout.strip())
started=False
try:
 run([pg/'initdb','-D',data,'-U','rehearsal_admin','-A','trust','--encoding=UTF8','--locale=C'])
 # Disable all IP egress from the server, including any restored external webhook function.
 # Only a private Unix socket accepts connections. No platform worker/cron is started.
 profile='(version 1) (allow default) (deny network-outbound (remote ip "*:*"))'
 run(['/usr/bin/sandbox-exec','-p',profile,pg/'pg_ctl','-D',data,'-o',f"-p 55439 -k {sock} -c listen_addresses='' -c shared_buffers=32MB",'-l',work/'postgres.log','-w','start']);started=True
 commands=[]
 for r in roles['roles']:
  opts=['SUPERUSER' if r['superuser'] else 'NOSUPERUSER','INHERIT' if r['inherit'] else 'NOINHERIT','CREATEROLE' if r['createrole'] else 'NOCREATEROLE','CREATEDB' if r['createdb'] else 'NOCREATEDB','BYPASSRLS' if r['bypassrls'] else 'NOBYPASSRLS','NOLOGIN']
  commands.append('CREATE ROLE '+ident(r['name'])+' '+' '.join(opts)+';')
 for m in roles['memberships']:commands.append('GRANT '+ident(m['role'])+' TO '+ident(m['member'])+(' WITH ADMIN OPTION' if m['admin'] else '')+';')
 sql('\n'.join(commands)+'\nALTER DATABASE postgres OWNER TO '+ident(roles['database_owner'])+';\nDROP SCHEMA public;')
 lines=(private/'archive-index.txt').read_text().splitlines()
 schemas=[l for l in lines if not l.startswith(';') and ' SCHEMA ' in l and ' ACL ' not in l and ' COMMENT ' not in l]
 rest=[l for l in lines if l not in schemas]
 (work/'schemas.list').write_text('\n'.join(schemas)+'\n');(work/'restore.list').write_text('\n'.join(rest)+'\n')
 restore=[pg/'pg_restore','--exit-on-error','--single-transaction','--host',sock,'--port','55439','--username','rehearsal_admin','--dbname','postgres']
 run(restore+['--use-list',work/'schemas.list',archive])
 sql('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;')
 run(restore+['--use-list',work/'restore.list',archive])
 before=snapshot()
 migrations=sorted((root/'supabase/migrations').glob('20261027*.sql'))
 if args.release_sql:sql(args.release_sql.read_text())
 else:
  for p in migrations:sql('SET ROLE postgres;\n'+p.read_text()+'\nRESET ROLE;')
 sql("SET ROLE postgres; SELECT public.engagement_counter_preflight(); SELECT public.engagement_prepare_counter_baselines(); SELECT public.engagement_reconcile(); RESET ROLE;")
 sql("SET ROLE service_role; SELECT public.engagement_counter_preflight(); SELECT public.analytics_maintenance(); SELECT public.analytics_rollup_creators(false); SELECT public.analytics_rollup_admin(false); RESET ROLE;")
 sql("DO $$ BEGIN IF has_table_privilege('anon','public.analytics_events','SELECT') OR has_table_privilege('authenticated','public.analytics_events','SELECT') OR has_function_privilege('authenticated','public.analytics_interest_read(uuid)','EXECUTE') THEN RAISE EXCEPTION 'private analytics privileges exposed'; END IF; END $$;")
 after=snapshot()
 if before!=after:raise RuntimeError('Rehearsal changed authoritative row counts or business mirrors; rollout blocked.')
 summary={'business_row_counts_and_mirrors':'unchanged','archive_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'work_directory':str(work),'postgres_major':17,'migrations_applied':len(migrations),'ip_egress':'denied','restore':'passed','migration_role':'postgres','rpc_role':'service_role','private_role_checks':'passed','counter_preparation':'passed','managed_platform_workers':'not started','production_changed':False}
 (private/'rehearsal-summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
except Exception as e:
 print(str(e));print('Private rehearsal directory: '+str(work));sys.exit(1)
finally:
 if started:subprocess.run([str(pg/'pg_ctl'),'-D',str(data),'stop','-m','fast'],stdout=log,stderr=log)
 log.close()
 try:sock.rmdir()
 except OSError:pass
