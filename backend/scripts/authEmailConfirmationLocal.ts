/**
 * Local GoTrue + Inbucket confirmation/recovery smoke test.
 * Requires `supabase start` (API :54321, Inbucket :54324). Never talks to hosted Auth.
 *
 * Skip (exit 0) when the local stack is not running so unit CI stays green.
 *
 * Uses the stock local-demo anon JWT when targeting 127.0.0.1 so a hosted
 * SUPABASE_ANON_KEY in `.env` cannot poison this check.
 */
import { createClient } from '@supabase/supabase-js';

const API = process.env.AUTH_LOCAL_URL ?? 'http://127.0.0.1:54321';
const LOCAL_DEMO_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const ANON = process.env.AUTH_LOCAL_ANON_KEY ?? LOCAL_DEMO_ANON;
const INBUCKET = process.env.AUTH_LOCAL_INBUCKET ?? 'http://127.0.0.1:54324';

function fail(message: string): never {
  console.error(`auth-local: FAIL ${message}`);
  process.exit(1);
}

async function probe(): Promise<boolean> {
  try {
    const res = await fetch(`${API.replace(/\/$/, '')}/auth/v1/health`, {
      headers: { apikey: ANON },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function mailbox(localPart: string): Promise<unknown[]> {
  const res = await fetch(`${INBUCKET.replace(/\/$/, '')}/api/v1/mailbox/${encodeURIComponent(localPart)}`);
  if (!res.ok) return [];
  const json = (await res.json()) as unknown;
  return Array.isArray(json) ? json : [];
}

function extractTokenHash(html: string): { token_hash: string; type: string } | null {
  const match = html.match(/token_hash=([^&"]+)&type=([a-z_]+)/i);
  if (!match) return null;
  return { token_hash: decodeURIComponent(match[1]), type: match[2] };
}

async function waitForToken(
  localPart: string,
  wantedType: string | null,
  seen: Set<string>,
): Promise<{ token_hash: string; type: string }> {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 400));
    const items = await mailbox(localPart);
    for (const item of items) {
      const id = (item as { id?: string }).id;
      if (!id || seen.has(id)) continue;
      const msgRes = await fetch(
        `${INBUCKET.replace(/\/$/, '')}/api/v1/mailbox/${encodeURIComponent(localPart)}/${id}`,
      );
      if (!msgRes.ok) continue;
      const body = (await msgRes.json()) as { body?: { html?: string; text?: string } };
      const blob = `${body.body?.html ?? ''}\n${body.body?.text ?? ''}`;
      const token = extractTokenHash(blob);
      if (!token) continue;
      if (wantedType && token.type !== wantedType) continue;
      seen.add(id);
      return token;
    }
  }
  fail(`Inbucket did not capture a ${wantedType ?? 'auth'} link (enable_confirmations / Inbucket)`);
}

async function main(): Promise<void> {
  if (!(await probe())) {
    console.log(`auth-local: SKIP (local Auth not reachable at ${API})`);
    return;
  }

  const stamp = Date.now();
  const localPart = `mystash-auth-${stamp}`;
  const email = `${localPart}@example.test`;
  const password = 'confirm-me-8';
  const nextPassword = 'confirm-me-9';
  const auth = createClient(API, ANON, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const seen = new Set<string>();

  const signedUp = await auth.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: 'mystash://auth/callback' },
  });
  if (signedUp.error) fail(`signup: ${signedUp.error.message}`);
  if (signedUp.data.session) fail('signup returned a session before confirmation');
  if (!signedUp.data.user) fail('signup did not create an Auth user');
  console.log('auth-local: PASS signup creates Auth user without session');

  const signInBlocked = await auth.auth.signInWithPassword({ email, password });
  if (!signInBlocked.error) fail('signin succeeded before confirmation');
  console.log('auth-local: PASS password sign-in blocked until confirmation');

  await waitForToken(localPart, 'signup', seen);
  console.log('auth-local: PASS confirmation email captured locally');

  await new Promise((r) => setTimeout(r, 1100));
  const resent = await auth.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: 'mystash://auth/callback' },
  });
  if (resent.error) fail(`resend: ${resent.error.message}`);
  const token = await waitForToken(localPart, 'signup', seen);
  console.log('auth-local: PASS confirmation resend captured locally');

  const invalid = await auth.auth.verifyOtp({
    token_hash: 'not-a-real-hash',
    type: 'signup',
  });
  if (!invalid.error) fail('invalid confirmation token succeeded');
  console.log('auth-local: PASS invalid confirmation link rejected');

  const verified = await auth.auth.verifyOtp({
    token_hash: token.token_hash,
    type: token.type as 'signup',
  });
  if (verified.error || !verified.data.session) {
    fail(`verifyOtp: ${verified.error?.message ?? 'no session'}`);
  }
  console.log('auth-local: PASS confirmation restores a session');

  const reused = await auth.auth.verifyOtp({
    token_hash: token.token_hash,
    type: token.type as 'signup',
  });
  if (!reused.error) fail('used confirmation token succeeded a second time');
  console.log('auth-local: PASS used confirmation link rejected');

  const recovered = await auth.auth.resetPasswordForEmail(email, {
    redirectTo: 'mystash://auth/callback',
  });
  if (recovered.error) fail(`resetPasswordForEmail: ${recovered.error.message}`);
  const recovery = await waitForToken(localPart, 'recovery', seen);
  console.log('auth-local: PASS recovery email captured locally');

  const recoverySession = await auth.auth.verifyOtp({
    token_hash: recovery.token_hash,
    type: 'recovery',
  });
  if (recoverySession.error || !recoverySession.data.session) {
    fail(`recovery verifyOtp: ${recoverySession.error?.message ?? 'no session'}`);
  }
  console.log('auth-local: PASS recovery session established');

  const updated = await auth.auth.updateUser({ password: nextPassword });
  if (updated.error) fail(`updateUser password: ${updated.error.message}`);
  console.log('auth-local: PASS recovery session can update password');

  await auth.auth.signOut();
  const afterReset = await auth.auth.signInWithPassword({ email, password: nextPassword });
  if (afterReset.error || !afterReset.data.session) {
    fail(`signin after reset: ${afterReset.error?.message ?? 'no session'}`);
  }
  console.log('auth-local: PASS password sign-in after reset');

  console.log('auth-local: all local confirmation checks passed');
}

void main().catch((e) => {
  fail(e instanceof Error ? e.message : String(e));
});
