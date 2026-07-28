import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { runOneExtractionJob, type ExtractionJobRow } from '../_shared/extractionExecutor.ts';
import { ingestLog } from '../_shared/ingestLog.ts';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-worker-secret',
};

function authorize(req: Request): boolean {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const authHeader = req.headers.get('Authorization') ?? '';
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (bearer && bearer === serviceKey) return true;

  /** Same key as REST `apikey` — some callers (pg_net / scripts) send this instead of Bearer. */
  const apikey = req.headers.get('apikey') ?? '';
  if (apikey && apikey === serviceKey) return true;

  const secret = Deno.env.get('EXTRACTION_WORKER_SECRET');
  const hdr = req.headers.get('x-worker-secret');
  if (secret && hdr === secret) return true;

  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!authorize(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  let limit = 3;
  try {
    const body = (await req.json()) as { limit?: number };
    if (typeof body.limit === 'number' && body.limit >= 1 && body.limit <= 10) {
      limit = Math.floor(body.limit);
    }
  } catch {
    /* default limit */
  }

  const workerId = `w_${crypto.randomUUID().slice(0, 12)}`;

  const { data: jobs, error: claimErr } = await admin.rpc('claim_extraction_jobs', {
    p_worker: workerId,
    p_limit: limit,
  });

  if (claimErr) {
    ingestLog('error', 'extract.queue.claim_failed', { message: claimErr.message });
    return new Response(JSON.stringify({ error: claimErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const rows = (jobs ?? []) as ExtractionJobRow[];
  const outcomes: Array<{ jobId: string; outcome: string }> = [];

  for (const job of rows) {
    const r = await runOneExtractionJob(admin, job);
    outcomes.push({ jobId: job.id, outcome: r.outcome });
  }

  ingestLog('info', 'extract.queue.batch_done', {
    workerId,
    claimed: rows.length,
    outcomes,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      workerId,
      claimed: rows.length,
      outcomes,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
