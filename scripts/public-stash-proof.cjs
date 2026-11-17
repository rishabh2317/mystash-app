/** Phase-0 only: isolated SDK-54 export, Express serving, and Node-22 packaging.
 * Uses fixture/public dummy configuration. Never reads dotenv or production data. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.public-stash-proof', 'web');
function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} failed (${result.status})`);
}
function escape(value) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function serve(directory = output) {
  const express = require(path.join(root, 'backend/node_modules/express'));
  const app = express();
  app.get('/health', (_req, res) => res.json({ ok: true, fixture: true }));
  app.use(express.static(directory, { index: false, immutable: true, maxAge: '1y' }));
  app.get(['/', '/stash/proof', '/stash/proof/products/catalog/:productId', '/stash/proof/places/:placeId'], (req, res) => {
    const head = '<title>Public Stash technical proof</title><meta property="og:title" content="Public Stash on Mystash">'
      + `<link rel="canonical" href="https://mystash.in${escape(req.path)}"><meta name="robots" content="noindex,nofollow">`;
    const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8').replace(/<title>.*?<\/title>/s, '').replace('</head>', head + '</head>');
    res.set('Cache-Control', 'private, no-store, max-age=0').type('html').send(html);
  });
  app.use((_req, res) => res.status(404).set('Cache-Control', 'private, no-store').type('html').send('<h1>Stash unavailable</h1>'));
  const port = Number(process.env.PORT || 8793);
  app.listen(port, process.env.PROOF_CONTAINER === 'true' ? '0.0.0.0' : '127.0.0.1', () => process.stdout.write(`Local fixture: http://127.0.0.1:${port}/stash/proof\n`));
}
function stage() {
  const staging = path.join(root, '.public-stash-proof', 'container');
  fs.mkdirSync(path.join(staging, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(staging, 'scripts'), { recursive: true });
  fs.cpSync(output, path.join(staging, 'web'), { recursive: true });
  for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(root, 'backend', name), path.join(staging, 'backend', name));
  fs.copyFileSync(__filename, path.join(staging, 'scripts/public-stash-proof.cjs'));
  fs.writeFileSync(path.join(staging, 'Dockerfile'), `FROM node:22.18.0-bookworm-slim\nWORKDIR /app/backend\nCOPY backend/package.json backend/package-lock.json ./\nRUN npm ci --omit=dev\nWORKDIR /app\nCOPY web ./web\nCOPY scripts ./scripts\nENV PROOF_CONTAINER=true PORT=8787\nUSER node\nCMD ["node","scripts/public-stash-proof.cjs","serve","/app/web"]\n`);
  process.stdout.write(`Staged Node-22/Express proof at ${staging}\n`);
}
if (require.main === module) {
  const command = process.argv[2];
  if (command === 'export') run(process.execPath, ['node_modules/expo/bin/cli', 'export', '--platform', 'web', '--output-dir', output], { env: { ...process.env, MYSTASH_PUBLIC_WEB_PROOF: 'true', EXPO_PUBLIC_PUBLIC_STASH_PROOF: 'true', EXPO_NO_DOTENV: '1', CI: '1', EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'public-proof-key' } });
  else if (command === 'serve') serve(process.argv[3]);
  else if (command === 'stage') stage();
  else throw new Error('Expected export, serve, or stage');
}
module.exports = { escape };
