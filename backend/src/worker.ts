import 'dotenv/config';
import { logger } from './logger';
import { startIngestPipelineWorker } from './workers/ingestPipelineWorker';

const worker = startIngestPipelineWorker();
logger.info('mystash ingest-pipeline worker listening');

async function shutdown() {
  await worker.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
