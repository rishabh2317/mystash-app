/**
 * Non-destructive staging smoke test for the notification inbox, run before production rollout.
 *
 *   NOTIFICATIONS_SMOKE_URL=https://<staging>.supabase.co \
 *   NOTIFICATIONS_SMOKE_SERVICE_ROLE_KEY=... \
 *   [NOTIFICATIONS_SMOKE_ANON_KEY=...] npm run notifications:smoke
 *
 * Proves the migration is applied, the deployed notification worker materializes, ownership
 * holds, the purge works, and anon cannot call the RPCs. Creates one throwaway auth user and
 * deletes it. Refuses production and local targets.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { SupabaseNotificationRepository } from '../src/notifications/SupabaseNotificationRepository';
import { NotificationService } from '../src/notifications/NotificationService';
import { ingestFailedEvent } from '../src/notifications/producers';
import { assertSafeTestTarget } from '../src/notifications/testing/databaseTargetGuard';

const url = process.env.NOTIFICATIONS_SMOKE_URL ?? '';
const serviceKey = process.env.NOTIFICATIONS_SMOKE_SERVICE_ROLE_KEY ?? '';
const anonKey = process.env.NOTIFICATIONS_SMOKE_ANON_KEY;
const waitMs = Number(process.env.NOTIFICATIONS_SMOKE_WAIT_MS ?? 60_000);

function step(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  if (!url || !serviceKey) throw new Error('NOTIFICATIONS_SMOKE_URL and NOTIFICATIONS_SMOKE_SERVICE_ROLE_KEY are required');
  assertSafeTestTarget(url, 'staging');

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const repo = new SupabaseNotificationRepository(admin);
  const service = new NotificationService(repo);

  const health = await repo.healthSnapshot();
  step('migration applied (health snapshot)', true, `due=${health.outboxDueCountCapped} dead=${health.outboxDeadCountCapped}`);

  const { data, error } = await admin.auth.admin.createUser({
    email: `ntf-smoke-${randomUUID()}@example.test`,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error('createUser failed');
  const userId = data.user.id;
  const stranger = randomUUID();

  try {
    const event = ingestFailedEvent({ ingestId: randomUUID(), userId, transitionAt: new Date().toISOString() });
    step('enqueue', (await service.emit(event)) === 'enqueued');
    step('replay is deduplicated', (await service.emit(event)) === 'duplicate');

    let itemId: string | null = null;
    const deadline = Date.now() + waitMs;
    while (!itemId && Date.now() < deadline) {
      const page = await service.listFeed(userId, {});
      itemId = page.items[0]?.id ?? null;
      if (!itemId) await new Promise((r) => setTimeout(r, 2_000));
    }
    step('deployed worker materialized the event', Boolean(itemId), itemId ? '' : `nothing after ${waitMs} ms`);

    if (itemId) {
      step('unread count', (await service.unreadCount(userId)).unread === 1);
      step('foreign open is rejected', !(await repo.recordOpen(stranger, itemId)));
      await service.recordOpen(userId, itemId);
      step('open marks read', (await service.unreadCount(userId)).unread === 0);
    }

    if (anonKey) {
      const anon = createClient(url, anonKey, { auth: { persistSession: false } });
      const { error: rpcErr } = await anon.rpc('notification_unread_count', { p_user_id: userId });
      step('anon cannot execute RPCs', Boolean(rpcErr));
      const { data: rows } = await anon.from('notifications').select('id').limit(1);
      step('anon cannot read notifications', !rows || rows.length === 0);
    }

    const purge = await service.purgeUser(userId);
    step('purge completes', purge.done);
    step('inbox empty after purge', (await service.listFeed(userId, {})).items.length === 0);
  } finally {
    await admin.auth.admin.deleteUser(userId);
  }
}

main().catch((err) => {
  console.error(`FAIL  smoke aborted — ${(err as Error).message}`);
  process.exit(1);
});
