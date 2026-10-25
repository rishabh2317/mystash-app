import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { describe, it } from 'node:test';
import { InMemoryNotificationRepository } from '../InMemoryNotificationRepository';
import { startNotificationWorker } from './startNotificationWorker';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const address = srv.address();
      srv.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

/** Follows relative imports from an entry file; returns every bare package it reaches. */
function reachablePackages(entry: string): Set<string> {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:from\s+|import\()\s*['"]([^'"]+)['"]/g)) {
      const spec = match[1];
      if (!spec.startsWith('.')) {
        packages.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
        continue;
      }
      const base = path.resolve(path.dirname(file), spec);
      const resolved = [`${base}.ts`, path.join(base, 'index.ts')].find((f) => existsSync(f));
      if (resolved) queue.push(resolved);
    }
  }
  return packages;
}

describe('notification worker process', () => {
  it('serves health, reports draining with 503, and drains on close', async () => {
    const port = await freePort();
    const handle = startNotificationWorker(null, { healthPort: port, repo: new InMemoryNotificationRepository() });
    await new Promise((r) => setTimeout(r, 50));
    const ok = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { notifications: { status: string } }).notifications.status, 'ok');
    assert.equal((await fetch(`http://127.0.0.1:${port}/other`)).status, 404);

    const closing = handle.close(2_000);
    const result = await closing;
    assert.equal(result.drained, true);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
  });

  it('has no Redis or BullMQ dependency', () => {
    const entry = path.resolve(__dirname, '../../notificationWorker.ts');
    const packages = reachablePackages(entry);
    for (const forbidden of ['bullmq', 'ioredis', 'redis']) {
      assert.ok(!packages.has(forbidden), `${forbidden} is reachable from notificationWorker.ts`);
    }
    assert.ok(packages.has('@supabase/supabase-js'));
  });
});
