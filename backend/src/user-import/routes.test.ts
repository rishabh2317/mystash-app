import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request, Response } from 'express';
import { ContentSourceService } from '../content-source/ContentSourceService';
import { InMemoryContentSourceRepository } from '../content-source/InMemoryContentSourceRepository';
import { contentSourceProcessingJobId } from '../content-source/jobs/contentSourceQueue';
import { InMemoryUserImportRepository } from './InMemoryUserImportRepository';
import type { UserImportContentSourcePort } from './ports';
import { createUserImportHandler, createUserImportListHandler } from './routes';
import { UserImportService } from './UserImportService';

const USER_A = '11111111-1111-4111-8111-111111111111';
const REEL_URL = 'https://www.instagram.com/reel/ABC123/';

/** Content Source wired in-memory: the route contract must not depend on Redis. */
function createContentSourcePort(options: { enqueueFails?: boolean } = {}): {
  port: UserImportContentSourcePort;
  sourceRepo: InMemoryContentSourceRepository;
  jobs: string[];
} {
  const sourceRepo = new InMemoryContentSourceRepository();
  const jobs: string[] = [];
  const contentSource = new ContentSourceService(sourceRepo, {
    enqueue: async (data) => {
      if (options.enqueueFails) throw new Error('ingest.queue.redis_unavailable');
      jobs.push(contentSourceProcessingJobId(data.contentSourceId));
      return contentSourceProcessingJobId(data.contentSourceId);
    },
  });
  return {
    sourceRepo,
    jobs,
    port: {
      getOrCreate: (normalizedUrl) => contentSource.getOrCreate(normalizedUrl),
      getById: (id) => contentSource.getById(id),
      listProducts: (id) => contentSource.listProducts(id),
      requestProcessing: (params) => contentSource.requestProcessing(params),
      requestReprocessing: (params) => contentSource.requestReprocessing(params),
    },
  };
}

type Captured = { status: number; body: unknown };

function fakeRes(): { res: Response; captured: Captured } {
  const captured: Captured = { status: 200, body: undefined };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, captured };
}

/** `authorization: null` omits the header entirely. */
function fakeReq(body: unknown, authorization: string | null): Request {
  return { headers: authorization ? { authorization } : {}, body } as unknown as Request;
}

function createHarness(
  options: { authenticated?: boolean; enqueueFails?: boolean } = {},
) {
  const repo = new InMemoryUserImportRepository();
  const { port, sourceRepo, jobs } = createContentSourcePort({
    enqueueFails: options.enqueueFails,
  });
  const service = new UserImportService(repo, port, null, async () => undefined);
  const handler = createUserImportHandler({
    service,
    authenticate: async (req) =>
      options.authenticated === false || !req.headers.authorization
        ? null
        : { userId: USER_A },
  });
  return { repo, sourceRepo, jobs, handler };
}

async function post(
  handler: ReturnType<typeof createUserImportHandler>,
  body: unknown,
  authorization: string | null = 'Bearer token',
): Promise<Captured> {
  const { res, captured } = fakeRes();
  await handler(fakeReq(body, authorization), res);
  return captured;
}

describe('POST /imports', () => {
  it('accepts an authenticated import and acknowledges with RECEIVED', async () => {
    const { repo, handler } = createHarness();
    const result = await post(handler, { url: REEL_URL });

    assert.equal(result.status, 201);
    const body = result.body as { importId: string; status: string; created: boolean };
    assert.equal(body.status, 'RECEIVED');
    assert.equal(body.created, true);
    assert.ok(body.importId);
    assert.equal(repo.imports.size, 1);
    // Acknowledgement carries no processing or product fields.
    assert.deepEqual(Object.keys(body).sort(), ['created', 'importId', 'status']);
  });

  it('accepts shared text under `text` as well as a bare `url`', async () => {
    const { handler } = createHarness();
    const result = await post(handler, { text: `look → ${REEL_URL}` });
    assert.equal(result.status, 201);
  });

  it('rejects an unauthenticated request', async () => {
    const { repo, handler } = createHarness();
    const missingHeader = await post(handler, { url: REEL_URL }, null);

    const { handler: unauthorized } = createHarness({ authenticated: false });
    const badToken = await post(unauthorized, { url: REEL_URL });

    assert.deepEqual(missingHeader, { status: 401, body: { error: 'Missing authorization' } });
    assert.deepEqual(badToken, { status: 401, body: { error: 'Unauthorized' } });
    assert.equal(repo.imports.size, 0);
  });

  it('rejects a missing url', async () => {
    const { handler } = createHarness();
    assert.deepEqual(await post(handler, {}), {
      status: 400,
      body: { error: 'url required' },
    });
    assert.deepEqual(await post(handler, { url: 42 }), {
      status: 400,
      body: { error: 'url required' },
    });
  });

  it('rejects malformed and unsupported input without leaking internals', async () => {
    const { handler } = createHarness();
    const unsupported = await post(handler, { url: 'ftp://files.example.com/x' });
    const privateHost = await post(handler, { url: 'http://localhost:8787/x' });

    assert.equal(unsupported.status, 400);
    assert.deepEqual(unsupported.body, { error: 'Only http and https links can be imported' });
    assert.equal(privateHost.status, 400);
    assert.deepEqual(privateHost.body, { error: 'That link cannot be imported' });
  });

  it('never trusts a client-supplied user id', async () => {
    const { handler } = createHarness();
    assert.deepEqual(await post(handler, { url: REEL_URL, user_id: 'someone-else' }), {
      status: 400,
      body: { error: 'userId must not be supplied by client' },
    });
  });

  it('returns 200 for a duplicate submission instead of an error', async () => {
    const { repo, handler } = createHarness();
    const first = await post(handler, { url: REEL_URL });
    const second = await post(handler, { url: `${REEL_URL}?utm_source=ig` });

    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(
      (second.body as { importId: string }).importId,
      (first.body as { importId: string }).importId,
    );
    assert.equal((second.body as { created: boolean }).created, false);
    assert.equal(repo.imports.size, 1);
  });

  it('maps an unexpected repository failure to a generic 500', async () => {
    const repo = new InMemoryUserImportRepository();
    repo.insert = async () => {
      throw new Error('relation "user_imports" does not exist');
    };
    const handler = createUserImportHandler({
      service: new UserImportService(repo, createContentSourcePort().port),
      authenticate: async () => ({ userId: USER_A }),
    });

    const result = await post(handler, { url: REEL_URL });
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { error: 'Could not accept the shared link' });
  });

  it('keeps the Phase 1 response contract after the content source handoff', async () => {
    const { handler, sourceRepo, jobs } = createHarness();
    const result = await post(handler, { url: REEL_URL });

    assert.equal(result.status, 201);
    assert.deepEqual(Object.keys(result.body as object).sort(), [
      'created',
      'importId',
      'status',
    ]);
    assert.equal((result.body as { status: string }).status, 'RECEIVED');
    assert.equal(sourceRepo.sources.size, 1);
    assert.equal(jobs.length, 1);
  });

  it('still acknowledges when Redis is unavailable for the enqueue', async () => {
    const { handler, repo, sourceRepo, jobs } = createHarness({ enqueueFails: true });
    const result = await post(handler, { url: REEL_URL });

    assert.equal(result.status, 201);
    assert.equal((result.body as { status: string }).status, 'RECEIVED');
    assert.equal(repo.imports.size, 1);
    assert.equal(jobs.length, 0);
    const [source] = [...sourceRepo.sources.values()];
    assert.equal(source.processingStatus, 'RECEIVED');
  });

  it('maps a content source database failure to the existing 500 contract', async () => {
    const repo = new InMemoryUserImportRepository();
    const { port } = createContentSourcePort();
    port.getOrCreate = async () => {
      throw new Error('relation "content_sources" does not exist');
    };
    const handler = createUserImportHandler({
      service: new UserImportService(repo, port),
      authenticate: async () => ({ userId: USER_A }),
    });

    const result = await post(handler, { url: REEL_URL });
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { error: 'Could not accept the shared link' });
    assert.equal(repo.imports.size, 0);
  });
});

describe('GET /imports', () => {
  it('returns user-facing share states', async () => {
    const { handler, repo, sourceRepo } = createHarness();
    const submitHandler = handler;
    await post(submitHandler, { url: REEL_URL });
    const service = new UserImportService(
      repo,
      {
        getOrCreate: async () => {
          throw new Error('unused');
        },
        getById: (id) => sourceRepo.findById(id),
        listProducts: (id) => sourceRepo.listProducts(id),
        requestProcessing: async () => ({
          queued: false,
          suppressed: true,
          enqueueFailed: false,
          jobId: null,
        }),
        requestReprocessing: async () => ({
          queued: false,
          suppressed: true,
          enqueueFailed: false,
          jobId: null,
        }),
      },
      null,
      async () => undefined,
    );
    const listHandler = createUserImportListHandler({
      service,
      authenticate: async () => ({ userId: USER_A }),
    });
    const { res, captured } = fakeRes();
    await listHandler(fakeReq({}, 'Bearer t'), res);
    const body = captured.body as {
      shares: Array<{
        state: string;
        kind: string;
        createdAt: string;
        productCount: number;
        primaryProduct: unknown;
      }>;
    };
    assert.equal(captured.status, 200);
    assert.equal(body.shares.length, 1);
    assert.equal(body.shares[0]?.state, 'looking');
    assert.equal(body.shares[0]?.kind, 'instagram');
    assert.equal(typeof body.shares[0]?.createdAt, 'string');
    assert.equal(body.shares[0]?.productCount, 0);
    assert.equal(body.shares[0]?.primaryProduct, null);
    assert.equal(Array.isArray((body.shares[0] as { products?: unknown }).products), true);
    assert.equal(JSON.stringify(body).includes('QUEUED'), false);
    assert.equal(JSON.stringify(body).includes('processingStatus'), false);
    assert.equal(JSON.stringify(body).includes('timed_out'), false);
  });
});
