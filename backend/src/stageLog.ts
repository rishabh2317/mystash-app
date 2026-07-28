import { logger } from './logger';

/** Terminal-visible pipeline stages for Mystash extraction. */
export function stageLog(stage: number, label: string, meta?: Record<string, unknown>): void {
  logger.info({ stage, ...meta }, `Stage ${stage}: ${label}`);
}
