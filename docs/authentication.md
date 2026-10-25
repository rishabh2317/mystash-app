# Mystash authentication (Phase 2)

Supabase Auth is the identity and session provider. Mystash does not issue its own
JWTs, store verification tokens, or send email from the client.

Phase 1 database lockdown (`supabase/migrations/20261015200000_users_client_access.sql`)
is implemented locally and **has not been applied to hosted Supabase**.

## Session lifecycle

- Persistence: AsyncStorage, `flowType: 'pkce'`, `detectSessionInUrl: false`.
- Auto-refresh: `bindAuthAutoRefresh` starts GoTrue refresh when `AppState` is
  `active` and stops it when backgrounded (single listener).
- Restoration: `getSession()` on launch, then `onAuthStateChange`.
- Refresh failures / offline: the SDK keeps the persisted session; Mystash does
  not sign the user out or retry in a loop.
- Sign-out: push unlink, then `signOut()`. Cart and notification unread state
  key off `user.id` and clear on switch.

**AsyncStorage trade-off:** required so the PKCE `code_verifier` survives the
Google in-app browser hop. SecureStore is not a drop-in Auth storage adapter
(size, web, SDK compatibility). Do not swap it without proving restore + PKCE.

## Email confirmation

Intended hosted path: sign-up → pending (no session) → open `mystash://auth/callback`
→ verified session → `POST /users/me/ensure` → app.

- `signUp` / `resend` / recovery all use `emailRedirectTo` = `Linking.createURL('auth/callback')`.
- Callback completes **PKCE `code`** or **`verifyOtp({ token_hash, type })`**. Implicit
  `access_token` / `refresh_token` query handling was removed.
- Client cooldown for resend: 60 seconds. Hosted GoTrue also rate-limits.

Local `supabase/config.toml` has `enable_confirmations = true`. Confirmation and
recovery mail is captured by Inbucket at `http://127.0.0.1:54324` (not sent to
the internet). Restart the local stack after this change (`supabase stop` /
`supabase start`). Hosted production still needs Confirm email + SMTP.

Run `npm run test:auth:local` in `backend/` when the local stack is up. The
script targets `http://127.0.0.1:54321` with the local-demo anon JWT (override
with `AUTH_LOCAL_ANON_KEY` / `AUTH_LOCAL_URL` if needed) and skips (exit 0) if
Auth is not reachable so unit CI stays green. `[auth.sms] enable_confirmations`
stays false; SMS is unused.

## Verification policy (backend)

A session is not proof of a verified address. Privileged writes require
`email_confirmed_at` / `confirmed_at`, or an OAuth identity with
`email_verified=true`. Google is not assumed verified.

Blocked until verified (server-side `403 EMAIL_NOT_VERIFIED`): User `/users/me`
and `/users/me/*` (including `ensure` and creator onboarding); collection
create/mutate; cart mutations; authenticated engagement writes; ingest
(`POST /ingest`, manual, append, resolve); publish; connected-account user
routes; creator library; brand campaign creator attaches; user imports;
notification inbox, prefs, and push registration; places list (private stash).
Legacy Edge `ingest-url` / `publish-ingest` use the same check. Authenticators
that wrap `getUser` rethrow `UnverifiedEmailError` so verification is 403, not
a generic 401.

Not blocked: public profiles, guest feed/search, public product/AI-review/live
price reads, optional engagement *views* and search/shopping click attribution
(unverified sessions are treated as anonymous). Brand feed ingest uses a service
key, not a user JWT.

`public.users` is created only after a verified session hits `ensureFromAuth`.

## Password recovery

`resetPasswordForEmail` → same callback → `password_recovery` → `/auth/reset-password`
→ `updateUser({ password })`. Responses for unknown emails are generic.

`onAuthStateChange('PASSWORD_RECOVERY')` and `AuthRecoveryGate` persist a flag and
route cold launches to the reset screen (except `/auth/callback`). **This is not a
security boundary.** A recovery JWT is a full Supabase session for that user. Write
APIs authorize the account owner; they do not know the user is mid-reset. Do not
invent a second token store. JWT expiry (local 1h) limits the window.

Client and local GoTrue minimum password length is **8**. Hosted Auth still needs
the same (or stricter) setting; UI validation is not server enforcement.

## Email delivery (replaceable)

Mystash never calls an SMTP vendor. Supabase Auth sends confirmation and recovery
mail using **dashboard SMTP** (recommended) or, later, the **Send Email Hook**.
Changing vendor is a Supabase configuration change, not an app release.

Local emails go to Inbucket (`config.toml` `[inbucket]`), not the internet.

## Manual hosted setup (not done in this phase)

1. Auth → URL configuration: `site_url` and allowlist
   `mystash://auth/callback` plus Expo go URLs used in development.
2. Auth → Providers → Email: enable Confirm email; minimum password length ≥ 8.
3. Auth → SMTP: host, port, user, password, sender. Templates must keep
   `{{ .ConfirmationURL }}` / recovery URL so PKCE redirects to the app.
4. Optional later: Auth Hooks → Send Email (HTTP) instead of SMTP.
5. Apply Phase 1 migration `20261015200000_users_client_access.sql` (still pending).
6. Google Cloud + Supabase Google provider redirect allowlist (unverified here).
7. Captcha: `[auth.captcha]` is commented out locally; confirm hosted bot protection.

Rate limits in repo evidence (`[auth.rate_limit]`): email_sent, sign_in_sign_ups,
token_refresh, token_verifications. Hosted values can differ — check the dashboard.

## Still requiring physical-device tests

Google PKCE, confirmation deep links, recovery deep links, AppState refresh
across backgrounding, and cold-start `mystash://` opens.
