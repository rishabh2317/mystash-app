import { logger } from '../logger';

export function logAiReviewEvent(
  event: string,
  fields: Record<string, unknown>,
): void {
  logger.info(fields, event);
}
