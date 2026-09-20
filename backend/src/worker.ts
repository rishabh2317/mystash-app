import 'dotenv/config';
import { startContentSourceProcessingWorker } from './content-source/factory';
import { logger } from './logger';
import { createSupabaseAdmin } from './supabase';
import { startIngestPipelineWorker } from './workers/ingestPipelineWorker';

const worker = startIngestPipelineWorker();
logger.info('mystash ingest-pipeline worker listening');

const contentSourceWorker = startContentSourceProcessingWorker(createSupabaseAdmin());
logger.info('mystash content-source-processing worker listening');

async function shutdown() {
  await Promise.all([worker.close(), contentSourceWorker.close()]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
