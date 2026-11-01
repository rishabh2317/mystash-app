/* global __dirname */
const { spawn } = require('node:child_process');
const path = require('node:path');

// Set before index.ts loads dotenv. Never write these overrides to shared .env files.
function apiOnlyEnvironment(inherited = process.env) {
  const port = inherited.PORT ?? '8788';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535 || Number(port) === 8787) {
    throw new Error('API-only development requires a valid PORT other than supervised port 8787');
  }
  const env = {
    ...inherited,
    PORT: String(Number(port)),
    NODE_ENV: 'development',
    INGEST_WORKER_EMBEDDED: 'false',
    // Also suppress the API diagnostics flush timer outside the embedded-worker gate.
    ANALYTICS_ENABLED: 'false',
    ANALYTICS_MAINTENANCE_ENABLED: 'false',
    ANALYTICS_ROLLUPS_ENABLED: 'false',
    ANALYTICS_ADMIN_ROLLUPS_ENABLED: 'false',
    ANALYTICS_INTEREST_WORKER_ENABLED: 'false',
    NOTIFICATIONS_PUSH_ENABLED: 'false',
    SEARCH_ENV: 'development',
    SEARCH_INDEX_BACKEND: 'memory',
    EMBEDDING_PROVIDER: 'local',
  };
  // dotenv 16 treats even the string "false" as truthy for this option.
  delete env.DOTENV_CONFIG_OVERRIDE;
  return env;
}

function main(args = process.argv.slice(2)) {
  if (args.some(arg => arg !== '--no-watch') || args.length > 1) {
    throw new Error('Usage: npm run dev:api-only [-- --no-watch]');
  }
  const env = apiOnlyEnvironment();
  const watch = !args.includes('--no-watch');
  const child = spawn(process.execPath, [
    ...(watch ? ['--watch'] : []), '--import', require.resolve('tsx'), 'src/index.ts',
  ], { cwd: path.resolve(__dirname, '..'), env, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('error', error => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
  });
}

module.exports = { apiOnlyEnvironment };
if (require.main === module) main();
