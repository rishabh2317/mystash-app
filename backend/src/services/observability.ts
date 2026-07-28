import { ingestLog, type IngestLogFields } from '../pipeline/ingestLog';

export type PipelineEvent =
  | 'ingest.started'
  | 'metadata.complete'
  | 'transcript.complete'
  | 'media_understanding.started'
  | 'media_understanding.complete'
  | 'ocr.complete'
  | 'logo.complete'
  | 'scene.complete'
  | 'context.built'
  | 'reasoning.complete'
  | 'validate.complete'
  | 'rank.complete'
  | 'catalog.match.complete'
  | 'review.required'
  | 'ingest.complete'
  | 'cache.hit'
  | 'stage.gate';

export function emitPipelineEvent(event: PipelineEvent, fields: IngestLogFields = {}): void {
  ingestLog('info', event, fields);
}
