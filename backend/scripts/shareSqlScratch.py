#!/usr/bin/env python3
"""Share migrations in a disposable, Unix-socket-only PostgreSQL. Never loads env files."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json, os, shutil, subprocess, tempfile, uuid

def main():
    root=Path(__file__).resolve().parents[2]
    work=Path(tempfile.mkdtemp(prefix='mystash-share-sql-',dir='/private/tmp'))
    env={k:v for k,v in os.environ.items() if not k.startswith('PG')}
    pg=Path('/opt/homebrew/opt/postgresql@17/bin')
    started=False
    def run(name,*args,sql=None,allow_error=False):
        r=subprocess.run([str(pg/name),*map(str,args)],input=sql,text=True,capture_output=True,env=env)
        if r.returncode and not allow_error:raise RuntimeError(r.stderr[-2400:])
        return r
    try:
        run('initdb','-D',work/'data','-U','postgres','-A','trust','--no-locale')
        run('pg_ctl','-D',work/'data','-l',work/'postgres.log','-w','start','-o',f"-k {work} -p 55443 -c listen_addresses='' -c unix_socket_permissions=0700")
        started=True
        def sql(s,allow_error=False):return run('psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h',work,'-p','55443','-U','postgres',sql=s,allow_error=allow_error)
        sql('''CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE content_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),platform text,external_id text,canonical_url text,media_kind text,processing_status text,pipeline_version text,UNIQUE(platform,external_id));
CREATE TABLE user_imports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES auth.users(id),raw_input text,source_url text,normalized_url text,dedupe_key text,platform text,status text,content_source_id uuid REFERENCES content_sources(id),hidden_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(user_id,dedupe_key));
CREATE TABLE content_source_products(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),content_source_id uuid REFERENCES content_sources(id));''')
        for file in ['20261102120000_share_acceptance.sql','20261102130000_share_intent.sql','20261102140000_share_reviews.sql']:
            sql((root/'supabase/migrations'/file).read_text())
        owner,other=str(uuid.uuid4()),str(uuid.uuid4())
        sql(f"INSERT INTO auth.users VALUES('{owner}'),('{other}');")
        def accept(capture,external='video',digest='a'*64):
            return f"SELECT share_accept('{owner}','{capture}','{digest}','https://www.youtube.com/watch?v={external}','{external}','youtube','{external}','VIDEO','fixture');"
        capture=str(uuid.uuid4())
        with ThreadPoolExecutor(max_workers=12) as pool:
            replies=list(pool.map(lambda _:json.loads(sql(accept(capture)).stdout),range(24)))
        assert len({r['importId'] for r in replies})==1
        imported=replies[0]['importId'];assert sum(not r['replayed'] for r in replies)==1
        assert sql('SELECT count(*) FROM user_imports').stdout.strip()=='1'
        assert sql(accept(capture,digest='b'*64),True).returncode!=0
        extra=str(uuid.uuid4());sql('BEGIN;'+accept(extra,'rollback')+'ROLLBACK;')
        assert sql(f"SELECT count(*) FROM share_acceptance_receipts WHERE capture_id='{extra}';").stdout.strip()=='0'
        result=json.loads(sql(f"SELECT share_capture_intent('{owner}','{capture}','product','brown handbag',NULL);").stdout)
        assert result=={'state':'saved','revision':1}
        sql(f"SELECT share_update_intent('{owner}','{imported}','place','café',1);")
        sql(f"SELECT share_capture_intent('{owner}','{capture}','product','brown handbag',NULL);")
        assert sql(f"SELECT interest_note FROM user_imports WHERE id='{imported}';").stdout.strip()=='café'
        assert sql(f"SELECT share_update_intent('{other}','{imported}',NULL,NULL,2);",True).returncode!=0
        assert sql(f"SELECT share_update_intent('{owner}','{imported}',NULL,NULL,1);",True).returncode!=0
        with ThreadPoolExecutor(max_workers=2) as pool:
            updates=list(pool.map(lambda _:sql(f"SELECT share_update_intent('{owner}','{imported}','both',NULL,2);",True),range(2)))
        assert sum(r.returncode==0 for r in updates)==1
        # Claims are disjoint across replicas; lease expiry makes durable work recoverable.
        with ThreadPoolExecutor(max_workers=2) as pool:
            claims=list(pool.map(lambda _:sql(f"SELECT count(*) FROM share_claim_dispatch('{uuid.uuid4()}',25);").stdout.strip(),range(2)))
        assert sorted(claims)==['0','1']
        sql("UPDATE share_acceptance_receipts SET dispatch_after=now()-interval '1 minute';")
        assert sql(f"SELECT count(*) FROM share_claim_dispatch('{uuid.uuid4()}',25);").stdout.strip()=='1'
        assert sql('SET ROLE authenticated; SELECT * FROM share_acceptance_receipts;',True).returncode!=0
        assert sql(f"SET ROLE authenticated; {accept(str(uuid.uuid4()))}",True).returncode!=0
        source=sql(f"SELECT content_source_id FROM user_imports WHERE id='{imported}'").stdout.strip()
        product=str(uuid.uuid4());key='f'*64
        sql(f'''INSERT INTO content_source_products(id,content_source_id,match_assessment) VALUES('{product}','{source}','{{"suggestions":[{{"key":"{key}"}}]}}');''')
        lease=str(uuid.uuid4())
        assert json.loads(sql(f"SELECT share_review_claim('{owner}','{imported}','{product}','{key}','{lease}',false);").stdout)['state']=='accepting'
        assert sql(f"SELECT share_review_claim('{owner}','{imported}','{product}','{key}','{uuid.uuid4()}',false);",True).returncode!=0
        assert sql(f"SELECT share_review_claim('{other}','{imported}','{product}','{key}','{uuid.uuid4()}',false);",True).returncode!=0
        print(json.dumps({'passed':True,'concurrentDeliveries':24,'checks':['rollback','payload conflict','intent replay','stale revision','concurrent intent','owner isolation','dispatch leases','role grants','review concurrency']}))
    finally:
        if started:run('pg_ctl','-D',work/'data','-m','fast','-w','stop')
        shutil.rmtree(work)

if __name__=='__main__':main()
