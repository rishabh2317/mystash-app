import 'dotenv/config';
import { startAnalyticsMaintenance } from './analytics/worker';
import { startEngagementReconciliation } from './engagement/reconciliationWorker';
import { startContentSourceProcessingWorker } from './content-source/factory';
import { startCreatorLibrarySyncWorker } from './creator-library/jobs/librarySyncWorker';
import { logger } from './logger';
import { createSupabaseAdmin } from './supabase';
import { startIngestPipelineWorker } from './workers/ingestPipelineWorker';

const analyticsMaintenance = startAnalyticsMaintenance(createSupabaseAdmin());
const reconciliation = startEngagementReconciliation(createSupabaseAdmin());
const worker = startIngestPipelineWorker();
logger.info('mystash ingest-pipeline worker listening');

const contentSourceWorker = startContentSourceProcessingWorker(createSupabaseAdmin());
logger.info('mystash content-source-processing worker listening');

const librarySyncWorker = startCreatorLibrarySyncWorker(createSupabaseAdmin());
logger.info('mystash creator-library-sync worker listening');

async function shutdown() {
  reconciliation.close();
  analyticsMaintenance.close();
  await Promise.all([worker.close(), contentSourceWorker.close(), librarySyncWorker.close()]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
