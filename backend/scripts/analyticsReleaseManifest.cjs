#!/usr/bin/env node
// Read-only: fingerprint the exact analytics migration allowlist. Never runs SQL or deployments.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const names = [
  '20261027120000_engagement_atomic_foundations.sql',
  '20261027130000_behavioral_measurement.sql',
  '20261027140000_creator_analytics.sql',
  '20261027150000_admin_analytics.sql',
  '20261027160000_interest_profiles.sql',
  '20261027170000_analytics_readiness.sql',
];
const git = (...args) => cp.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const migrations = names.map(name => {
  const relative = `supabase/migrations/${name}`;
  const bytes = fs.readFileSync(path.join(root, relative));
  return { file: relative, version: name.slice(0, 14), sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
});
process.stdout.write(JSON.stringify({
  release_commit: git('rev-parse', 'HEAD'),
  branch: git('branch', '--show-current'),
  migrations,
  invariant: 'Preserve business records and counters; no analytics reset; no playback analytics.',
  deployment_gate: 'Require verified restore point, isolated rehearsal, drained writers and counter preflight. This command deploys nothing.',
}, null, 2) + '\n');
