/**
 * Terminal processing failure — do not retry. BullMQ should not redeliver.
 * Retryable failures are ordinary thrown Errors so the existing job attempts/backoff apply.
 */
export class ContentSourceTerminalError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ContentSourceTerminalError';
  }
}

export const CONTENT_SOURCE_PROCESSOR_VERSION = 'content-source-processor.v1';
