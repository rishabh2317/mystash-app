import { logger } from '../../logger';
import { CAMPAIGN_FANOUT } from '../domain/policy';
import type { NotificationService } from '../NotificationService';

export type CampaignFanOutStats = { lastRunAt: string | null; lastFannedAt: string | null; lastError: string | null };

export async function runCampaignFanOutOnce(
  service: NotificationService,
  batch: number = CAMPAIGN_FANOUT.batch,
): Promise<number> {
  const fanned = await service.fanOutDueCampaigns(batch);
  if (fanned > 0) logger.info({ fanned, batch }, 'notification.campaign.fanout');
  return fanned;
}

export type CampaignFanOutHandle = { stop(): void; stats(): CampaignFanOutStats };

export function startCampaignFanOut(service: NotificationService): CampaignFanOutHandle {
  const stats: CampaignFanOutStats = { lastRunAt: null, lastFannedAt: null, lastError: null };
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;

  const loop = async (): Promise<void> => {
    if (stopped) return;
    let fanned = 0;
    try {
      fanned = await runCampaignFanOutOnce(service);
      stats.lastRunAt = new Date().toISOString();
      if (fanned > 0) stats.lastFannedAt = stats.lastRunAt;
      stats.lastError = null;
    } catch (err) {
      stats.lastError = ((err as Error).message ?? 'unknown').slice(0, 200);
      logger.warn({ message: stats.lastError }, 'notification.campaign.fanout_failed');
    }
    if (stopped) return;
    const delay = fanned >= CAMPAIGN_FANOUT.batch ? 0 : CAMPAIGN_FANOUT.idlePollMs;
    timer = setTimeout(() => {
      running = loop();
    }, delay);
  };

  running = loop();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      void running;
    },
    stats: () => ({ ...stats }),
  };
}
