import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

// Exercise real event-loop lifetime after all startup RPCs settle, with no live database.
describe('standalone analytics worker lifetime', () => {
  for (const mode of ['maintenance', 'reconciliation']) {
    it(`stays alive for ${mode} scheduling and drains on shutdown`, { timeout: 10000 }, async t => {
      const root = resolve(__dirname, '../../..');
      const source = `
        const {startAnalyticsMaintenance}=require(${JSON.stringify(resolve(root, 'backend/src/analytics/worker.ts'))});
        const {startEngagementReconciliation}=require(${JSON.stringify(resolve(root, 'backend/src/engagement/reconciliationWorker.ts'))});
        const db={rpc:async()=>({data:null,error:null})};
        const maintenance=startAnalyticsMaintenance(db,{keepAlive:${mode === 'maintenance'}});
        const reconciliation=startEngagementReconciliation(db,{keepAlive:${mode === 'reconciliation'}});
        process.once('SIGTERM',()=>{maintenance.close();reconciliation.close();});
        setImmediate(()=>process.stdout.write('ready\\n'));
      `;
      const child = spawn(process.execPath, ['--import', require.resolve('tsx'), '-e', source], {
        cwd: root,
        env: { ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'error', ANALYTICS_ENABLED: 'false',
          ANALYTICS_MAINTENANCE_ENABLED: String(mode === 'maintenance'), ANALYTICS_ROLLUPS_ENABLED: 'false',
          ANALYTICS_ADMIN_ROLLUPS_ENABLED: 'false', ANALYTICS_PERSONALIZATION_ENABLED: 'false',
          ANALYTICS_INTEREST_WORKER_ENABLED: 'false' },
      });
      t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
      await Promise.race([
        once(child.stdout!, 'data').then(([data]) => assert.equal(String(data).trim(), 'ready')),
        once(child, 'exit').then(() => { throw new Error('Worker exited before readiness'); }),
      ]);
      await new Promise(r => setTimeout(r, 150));
      assert.equal(child.exitCode, null, 'startup completion must not exit the dedicated worker');
      const exit = once(child, 'exit');
      child.kill('SIGTERM');
      const [code, signal] = await exit;
      assert.equal(code, 0);
      assert.equal(signal, null);
    });
  }
});
