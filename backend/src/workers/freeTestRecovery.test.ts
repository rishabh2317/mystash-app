import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ContentSourceService } from '../content-source/ContentSourceService';
import { InMemoryContentSourceRepository } from '../content-source/InMemoryContentSourceRepository';
import { contentSourceProcessingJobId } from '../content-source/jobs/jobIdentity';

for (const status of ['QUEUED', 'PROCESSING'] as const) {
  it(`explicit retry restores a lost ${status} queue job with the same persisted source identity`, async () => {
    const repo = new InMemoryContentSourceRepository();
    const queue = new Map<string, { contentSourceId: string; userImportId: string }>();
    const service = new ContentSourceService(repo, { enqueue: async data => {
      const id = contentSourceProcessingJobId(data.contentSourceId); queue.set(id, data); return id;
    } });
    const { record } = await service.getOrCreate('https://www.youtube.com/shorts/uRB-DFpjVIU');
    await service.requestProcessing({ contentSource: record, userImportId: 'same-import' });
    if (status === 'PROCESSING') await repo.markProcessing(record.id);
    queue.clear(); // Simulated Free Key Value restart, never the real Redis instance.
    const persisted = (await repo.findById(record.id))!;
    assert.equal(persisted.processingStatus, status);
    // Ordinary re-share is not an automatic lost-job repair.
    await service.requestProcessing({ contentSource: persisted, userImportId: 'same-import' });
    assert.equal(queue.size, 0);
    const retry = await service.requestReprocessing({ contentSource: persisted, userImportId: 'same-import' });
    assert.equal(retry.jobId, contentSourceProcessingJobId(record.id));
    assert.equal(queue.size, 1);
    assert.equal(queue.values().next().value?.userImportId, 'same-import');
    assert.equal(repo.sources.size, 1);
    assert.equal((await repo.findById(record.id))?.processingStatus, status);
    await service.requestReprocessing({ contentSource: persisted, userImportId: 'same-import' });
    assert.equal(queue.size, 1);
  });
}
