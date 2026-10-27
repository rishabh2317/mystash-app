#!/usr/bin/env node
// Generates one reviewed transaction. Does not connect to a database or deploy anything.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const manifest = JSON.parse(cp.execFileSync(process.execPath, [path.join(__dirname, 'analyticsReleaseManifest.cjs')], { encoding: 'utf8' }));
const git = (...args) => cp.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const quote = value => `'${value.replaceAll("'", "''")}'`;
const baseline = git('ls-files', 'supabase/migrations').split('\n').map(f => path.basename(f).slice(0, 14))
  .filter(v => /^\d{14}$/.test(v) && !manifest.migrations.some(m => m.version === v)).sort();
const migrations = manifest.migrations.map(m => {
  const source = fs.readFileSync(path.join(root, m.file), 'utf8');
  if (cp.execFileSync('git', ['show', `HEAD:${m.file}`], { cwd: root, encoding: 'utf8' }) !== source) throw new Error(`Uncommitted migration: ${m.file}`);
  return { ...m, source };
});
const snapshot = `CREATE FUNCTION pg_temp.analytics_release_snapshot() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE t record;n bigint;r jsonb:='{}'; BEGIN
 FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE s.nspname='public' AND c.relkind IN ('r','p') AND c.relname NOT LIKE 'analytics_%' AND c.relname NOT IN ('engagement_counter_projections','engagement_counter_baselines','engagement_reconciliation_runs') ORDER BY c.relname LOOP
 EXECUTE format('SELECT count(*) FROM public.%I',t.relname) INTO n;r:=r||jsonb_build_object(t.relname,n);END LOOP;
 RETURN jsonb_build_object('counts',r,'collection_mirrors',(SELECT md5(string_agg(concat_ws(':',id,views_count,saves_count,shares_count,product_clicks_count),'|' ORDER BY id)) FROM public.collections),'user_mirrors',(SELECT md5(string_agg(concat_ws(':',id,followers_count,following_count),'|' ORDER BY id)) FROM public.users));
END $$;`;
const lines = [
  `-- Generated from release ${manifest.release_commit}; target identity must be verified separately.`,
  '-- Execute only with a verified restore point, successful isolated rehearsal and drained writers.',
  'BEGIN;', "SET LOCAL lock_timeout='2s';", "SET LOCAL statement_timeout='30s';", 'SET LOCAL ROLE postgres;',
  `DO $$ BEGIN IF (SELECT array_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations) IS DISTINCT FROM ARRAY[${baseline.map(quote).join(',')}]::text[] THEN RAISE EXCEPTION 'Migration history changed; stop and review'; END IF; END $$;`,
  "DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend' AND state<>'idle' AND xact_start IS NOT NULL) THEN RAISE EXCEPTION 'Other active transactions; writers not drained'; END IF; END $$;",
  'LOCK TABLE public.users,public.collections,public.engagement_interaction_facts,public.engagement_relationship_edges,public.engagement_counter_projections,public.product_clicks,auth.users IN SHARE ROW EXCLUSIVE MODE;',
  snapshot,
  'CREATE TEMP TABLE analytics_release_before ON COMMIT DROP AS SELECT pg_temp.analytics_release_snapshot() value;',
];
for (const m of migrations) lines.push(`-- ${m.file}\n${m.source}`);
lines.push(
  "DO $$ BEGIN IF (public.engagement_counter_preflight()->>'blocking_drift')::bigint<>0 THEN RAISE EXCEPTION 'Counter drift; release rolled back'; END IF; END $$;",
  'SELECT public.engagement_prepare_counter_baselines();',
  "DO $$ DECLARE r jsonb:=public.engagement_counter_preflight(); BEGIN IF (r->>'blocking_drift')::bigint<>0 OR (r->>'missing_projections')::bigint<>0 OR (r->>'missing_baselines')::bigint<>0 THEN RAISE EXCEPTION 'Incomplete counter cutover; release rolled back'; END IF; IF pg_temp.analytics_release_snapshot() IS DISTINCT FROM (SELECT value FROM analytics_release_before) THEN RAISE EXCEPTION 'Business row counts or mirrors changed; release rolled back'; END IF; END $$;",
);
for (const m of migrations) {
  const tag = `$analytics_${m.version}$`;
  if (m.source.includes(tag)) throw new Error('Unexpected SQL delimiter');
  const name = path.basename(m.file).slice(15, -4);
  lines.push(`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(m.version)},${quote(name)},ARRAY[${tag}${m.source}${tag}]);`);
}
lines.push("NOTIFY pgrst,'reload schema';", 'COMMIT;');
process.stdout.write(lines.join('\n') + '\n');
