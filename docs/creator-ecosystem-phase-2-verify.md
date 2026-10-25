# Creator Ecosystem — Phase 2 VERIFY checklist

**Status:** Documentation gate complete (2026-03-25). Feature flags remain **off**.  
**Authority:** `docs/creator-ecosystem-architecture-audit.md` Phase 2  
**Code under review:** `backend/src/connected-accounts/` (YouTube adapter live behind flag; Instagram stub)  
**Scope of this pass:** Platform docs + Mystash code review. **No** live OAuth against Mystash Google/Meta apps was executed in this pass.

Labels used below:

| Label | Meaning |
|-------|---------|
| **VERIFIED** | Confirmed from current Google/Meta developer docs and/or Mystash Phase 2 code |
| **NOT VERIFIED** | Expected to be true, but not confirmed in this pass (ops, app review, or live call missing) |
| **BLOCKED** | Cannot proceed safely until resolved (policy, missing code, or hard platform constraint) |
| **UNKNOWN** | Insufficient public certainty; do not build Phase 3 assumptions on this |

**Do not set** `CONNECTED_ACCOUNTS_YOUTUBE_ENABLED` or `CONNECTED_ACCOUNTS_INSTAGRAM_ENABLED` from this document alone.

---

## Feature flags (env) — unchanged

| Flag | Default | Effect |
|------|---------|--------|
| `CONNECTED_ACCOUNTS_YOUTUBE_ENABLED` | unset / false | YouTube connect/re-auth blocked |
| `CONNECTED_ACCOUNTS_INSTAGRAM_ENABLED` | unset / false | Instagram connect/re-auth blocked |
| `CONNECTED_ACCOUNTS_ENCRYPTION_KEY` | required for token write | 32-byte key (base64 or 64-char hex) |
| `YOUTUBE_OAUTH_CLIENT_ID` / `YOUTUBE_OAUTH_CLIENT_SECRET` | required when YT enabled | Separate from Mystash Google login |
| `YOUTUBE_OAUTH_REDIRECT_URI` | required when YT enabled | Must match Expo / backend complete flow |
| `INSTAGRAM_OAUTH_CLIENT_ID` / `INSTAGRAM_OAUTH_CLIENT_SECRET` | required when IG enabled | Meta / Instagram app |
| `INSTAGRAM_OAUTH_REDIRECT_URI` | required when IG enabled | Must match Expo / backend complete flow |
| `CONNECTED_ACCOUNTS_OAUTH_STATE_SECRET` | falls back to encryption key | HMAC for OAuth `state` |

---

## Enablement verdict (Phase 2 linking only)

| Provider | Safely enable now? | Why |
|----------|--------------------|-----|
| **YouTube** | **No — not yet** | Platform linking path is **VERIFIED**, but Mystash ops (dedicated OAuth client, redirect URI, encryption key, Google Cloud YouTube Data API enablement, OAuth consent / verification posture) are **NOT VERIFIED**. Keep flag **off** until ops checklist below is green. |
| **Instagram** | **No** | Adapter is a **stub** (**BLOCKED** in code). Even after an adapter exists, Meta Developer Policies §6 and `media_url` constraints **BLOCK** treating connected media as a native/fullscreen playback or library-import source without Meta prior permission. Keep flag **off**. |

Paste-URL Create remains the degrade path when linking is disabled.

---

## YouTube Data API / Google OAuth

### VERIFIED

| Topic | Finding | Sources / code |
|-------|---------|----------------|
| Phase 2 purpose | Linking + identity health only; no media sync in Phase 2 | Audit Phase 2; `YouTubeOAuthProvider` |
| Minimum scope for Phase 2 | `https://www.googleapis.com/auth/youtube.readonly` (“View your YouTube account”) is sufficient for `channels.list?mine=true` and for Phase 3 read listing | [YouTube OAuth scopes](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps); Mystash uses this scope |
| Account identity | `GET youtube/v3/channels?part=snippet&mine=true` returns channel `id`, `snippet.title`, `snippet.customUrl` for the authorized channel | [channels.list](https://developers.google.com/youtube/v3/docs/channels/list); `fetchChannel` in provider |
| Account type | Any Google account that owns a YouTube channel; empty `items` means no channel (**VERIFIED** failure mode in code) | Provider error: “No YouTube channel found…” |
| OAuth authorize params in code | `access_type=offline`, `prompt=consent`, `include_granted_scopes=true` match Google guidance for obtaining a refresh token | Provider `buildAuthorizeUrl` |
| Access token lifetime | Short-lived access tokens (`expires_in`); store expiry | Provider stores `expiresAt` |
| Refresh token issuance pattern | Offline + consent is the documented way to receive refresh tokens (often only on first consent) | Google OAuth web-server guide |
| Revoke | `https://oauth2.googleapis.com/revoke` | Provider `revoke` |
| Phase 3 list path (capability) | Channel uploads playlist via `channels.list` `contentDetails.relatedPlaylists.uploads` → `playlistItems.list` (quota cost 1/call) | YouTube Data API docs |
| Default quota posture | Projects have limited daily quota; `search.list` is expensive relative to `playlistItems.list` / `videos.list` — prefer uploads playlist for sync | [Quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost) |
| Playback / AV policy | Must **not** download, import, backup, cache, or store YouTube **audiovisual** content without prior written approval; no offline playback of AV; compliant distribution is via YouTube API Services (incl. **IFrame / embedded player**) | [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies) |
| Mystash playback alignment | Current Mystash Watch path uses embedded WebView players — aligns with compliant playback for YouTube | Audit playback section |
| Separation from Supabase Google login | Phase 2 design requires a **dedicated** YouTube-linking OAuth client (not Mystash sign-in) | This checklist; audit |

### NOT VERIFIED

| Topic | Gap |
|-------|-----|
| Mystash Google Cloud project | Existence, YouTube Data API enabled, billing/quota project |
| Dedicated OAuth client IDs/secrets in deployed env | Values present and distinct from Supabase Google auth |
| Redirect URI registered | Exact Expo `connected-accounts/callback` / backend URI match with Google Console |
| `CONNECTED_ACCOUNTS_ENCRYPTION_KEY` in prod/staging | Required before any live connect |
| Google OAuth consent screen + verification | Sensitive scope `youtube.readonly` may require verification / limited testing users for production traffic |
| Live end-to-end connect | No live authorize → exchange → `channels.list` run against Mystash credentials in this pass |
| Refresh-token durability | Google can invalidate refresh tokens (password change, revoke, unused, app changes); no Mystash ops runbook verified |
| Access-token auto-refresh in backend | Code **stores** refresh ciphertext but **does not** implement refresh-grant renewal before health/API calls — durable health after ~1h is **NOT VERIFIED** in code |

### BLOCKED

| Topic | Why |
|-------|-----|
| Enabling `CONNECTED_ACCOUNTS_YOUTUBE_ENABLED` in production | Ops + consent/verification items above incomplete; enabling would expose users to broken connect or unapproved OAuth client |
| Phase 3 native/rehosted YouTube playback | Explicitly prohibited without YouTube prior written approval — keep embed/IFrame |
| Treating Data API as a download pipeline | Same AV policy block |

### UNKNOWN

| Topic | Note |
|-------|------|
| Authoritative Shorts-only filter | No first-class “isShort” field in Data API; duration/aspect heuristics are imperfect |
| Exact Mystash daily quota needs for Phase 3 sync | Depends on creator count × upload volume × refresh cadence |
| Made For Kids / COPPA implications for embedded players in Mystash | Required by YouTube policies for embeds; not audited against current Mystash player code in this pass |

### YouTube ops checklist before flag=true (Phase 2 only)

- [ ] Google Cloud project with **YouTube Data API v3** enabled  
- [ ] OAuth client **dedicated to YouTube linking** (not Supabase Google login)  
- [ ] Redirect URI(s) registered to match app complete flow  
- [ ] Consent screen configured; test users or verification as required  
- [ ] `YOUTUBE_OAUTH_*` + `CONNECTED_ACCOUNTS_ENCRYPTION_KEY` set in the target environment  
- [ ] Manual smoke: connect → list account → health → disconnect  
- [ ] Decide whether to ship access-token refresh before relying on health in production (**recommended**; still Phase 2 scope if done later — not implemented in this VERIFY pass)  
- [ ] Only then set `CONNECTED_ACCOUNTS_YOUTUBE_ENABLED=true`

---

## Instagram Graph API / Meta

### VERIFIED

| Topic | Finding | Sources / code |
|-------|---------|----------------|
| Account type | Instagram Platform APIs require an **Instagram professional** account (Business or Creator). Personal accounts are out of scope | [Instagram Platform overview](https://developers.facebook.com/docs/instagram-platform/overview) |
| Login product for IG-only pros | **Business Login for Instagram** (Instagram credentials) → Instagram User tokens on `graph.instagram.com`; Facebook Page link **not** required for this product | Meta Instagram Login docs |
| Alternate path | Instagram API with **Facebook Login** (Page-linked pros) uses Facebook User tokens on `graph.facebook.com` — different permission set | Same overview |
| Phase 2 identity scopes (Instagram Login) | `instagram_business_basic` is the read/identity + media-read permission for Instagram Login (legacy `business_basic` deprecated; docs required migration by **2025-01-27**) | [Business Login for Instagram](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login/) |
| Token lifecycle (Instagram Login) | Auth code → short-lived (~1h) via `api.instagram.com/oauth/access_token` → long-lived (~60 days) via `graph.instagram.com/access_token` → refresh via `graph.instagram.com/refresh_access_token` (refresh when long-lived token is still valid / within documented window) | Same Business Login docs |
| Phase 3 media list (API availability) | `GET /{ig-user-id}/media` and IG Media fields including `id`, `media_type`, `permalink`, `thumbnail_url`, optional `media_url` | [IG User Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/), [IG Media](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/) |
| CDN / expiry behavior | Instagram serves privacy-aware CDN URLs; deleted/expired content stops resolving | Platform overview |
| Mystash Phase 2 code | `InstagramOAuthProvider` is an intentional stub: authorize/exchange throw; health returns not available | `providers/InstagramOAuthProvider.ts` |
| Meta policy on “library-like” use | Developer Policies §6 Instagram Platform: do **not** use the Instagram Platform to **simply display** User Content, **import or backup** content, or manage relationships **without Meta’s prior permission**; respect owner restrictions | [Meta Developer Policies](https://developers.facebook.com/devpolicy) §6 |

### Instagram playback question (explicit)

**Question:** Can connected-account media provide a usable media URL for Mystash **native / fullscreen** playback?

| Layer | Status | Finding |
|-------|--------|---------|
| **API availability** | **VERIFIED (partial)** | Field `media_url` exists on IG Media for some video/Reels owned by the authorized professional account. |
| **API reliability** | **VERIFIED (constraint)** | `media_url` is **omitted** when media has copyrighted/licensed audio (incl. Instagram audio library), copyright flags, or when reel downloads are disabled / certain cross-user read paths. Many Reels will therefore have **no** playable `media_url`. |
| **URL durability** | **VERIFIED (constraint)** | Returned URLs are signed CDN URLs that **expire**; they are not stable long-term storage keys. Apps must re-fetch via API rather than assuming permanent URLs. |
| **What Meta permits Mystash to store/cache/re-host/play** | **BLOCKED without prior permission** | §6 forbids using Platform merely to display / import / backup User Content without Meta’s prior permission. Re-hosting or treating CDN bytes as Mystash-owned video for native players is **not** an approved default. |
| **Mystash product implication** | **VERIFIED (architecture)** | Mystash Watch today uses **embedded WebView** of public Instagram URLs. That remains the compliant default. Connected-account `media_url` must **not** be assumed as a Phase 3 native/fullscreen player source. Prefer **`permalink` + official embed / WebView**, and treat any native CDN playback as a **separate Meta permission / product review** item. |

**Summary:** API can sometimes return a temporary playable URL; that is **not** the same as Meta permitting Mystash to store, cache, re-host, or ship native fullscreen playback of that media.

### NOT VERIFIED

| Topic | Gap |
|-------|-----|
| Mystash Meta app | App ID, Instagram product configured, App Review / Advanced Access for permissions |
| Choice of Login product | Instagram Login vs Facebook Login for Mystash creators (product decision) |
| Redirect URI registration | Exact Expo callback vs Meta dashboard |
| Live token exchange + `/me` identity | Not executed in this pass |
| Rate limits / quota for Phase 3 sync at Mystash scale | Depends on usage tier and App Review |
| Whether Meta would grant permission for Mystash’s Create library UX | Business / partnership question — not answered by public docs alone |

### BLOCKED

| Topic | Why |
|-------|-----|
| Enabling `CONNECTED_ACCOUNTS_INSTAGRAM_ENABLED` | OAuth adapter is a **stub**; flag would only surface 403/503 UX with no working connect |
| Implementing Instagram OAuth in this VERIFY pass | Explicitly out of scope (no OAuth/code changes) |
| Phase 3 content library that imports/backups IG media by default | Meta §6 prior-permission requirement |
| Native/fullscreen player fed by stored `media_url` / rehosted files | Policy + URL expiry + frequent field omission |

### UNKNOWN

| Topic | Note |
|-------|------|
| Exact App Review timeline / rejection risk for Mystash’s stated use case | Depends on Meta review |
| Future Meta products (oEmbed changes, embed ToS revisions) | Monitor; playback must stay degrade-safe to paste URL |
| Whether `instagram_business_basic` alone will clear App Review for “creator connects own account for later sync” | Often acceptable for own-account tools, but **NOT VERIFIED** for Mystash specifically |

### Instagram ops + product checklist before flag=true (Phase 2 only)

- [ ] Implement Instagram OAuth adapter (authorize, code exchange, long-lived token, refresh, identity probe) — **future work; not this pass**  
- [ ] Meta app + Instagram product + redirect URIs  
- [ ] Scope `instagram_business_basic` only for Phase 2 (no publish/messaging scopes unless needed later)  
- [ ] App Review / roles / test professional accounts  
- [ ] Encryption key + secrets env  
- [ ] Manual smoke connect / health / disconnect  
- [ ] Explicit product decision: Phase 3 library UX must not rely on import/backup without Meta permission  
- [ ] Only then set `CONNECTED_ACCOUNTS_INSTAGRAM_ENABLED=true`

---

## Phase 2 vs Phase 3 (unchanged product split)

| Concern | Phase 2 | Phase 3 |
|---------|---------|---------|
| Account linking / tokens | Yes (VERIFY + flags) | — |
| Health probe (identity only) | Yes | — |
| Media sync / content library | **No** | Yes (after Phase 3 VERIFY) |
| `content_sources` Create bridge | **No** | Later |
| Playback changes | **No** — keep URL/embed WebView | Only if policy-approved |

---

## Exact prerequisites for Phase 3

Do **not** start Phase 3 until all of the following are true:

### Shared

1. Phase 2 linking works in a real environment for the providers you intend to sync (YouTube and/or Instagram).  
2. Encrypted token vault + revoke/disconnect proven.  
3. Access-token refresh (YouTube refresh grant; Instagram long-lived refresh) implemented and tested — otherwise sync jobs will fail after token expiry.  
4. Sync design still upserts **`content_sources`** (no parallel product system); library membership is separate from Collection.  
5. Playback remains **embed/WebView** (or other platform-approved player) unless written platform approval exists for an alternate.

### YouTube-specific

6. Sync uses **uploads playlist + `playlistItems.list` (+ `videos.list` for duration/metadata)** — avoid `search.list` as the primary sync.  
7. Quota budget and backoff designed; compliance with “no AV download/cache/store” — store **video IDs, metadata, permalinks/embed URLs**, not media bytes.  
8. Shorts filtering strategy documented as heuristic (**UNKNOWN** authoritative flag) with product acceptance.  
9. Embedded player policy items (attribution, no download UX, Made For Kids lookup where applicable) reviewed against Mystash players.

### Instagram-specific

10. Working Instagram Login (or chosen Facebook Login) adapter + App Review for required permissions.  
11. Sync stores **media id + permalink (+ thumbnail URL with short TTL awareness)**; do **not** treat `media_url` as durable SoT.  
12. **Written Meta prior permission** (or an explicitly approved Meta use case / review outcome) if the product “imports,” “backs up,” or “simply displays” IG User Content in a library beyond owner-authorized API reads that Meta allows for the approved app.  
13. Native/fullscreen playback from CDN/`media_url` is **out of scope** unless separately approved; default remains permalink → embed/WebView.  
14. Handle missing `media_url` (copyrighted audio / download disabled) without breaking Create.

### Explicitly deferred (still Phase 3+)

- Media sync jobs, cursors, webhooks  
- Content library UI  
- Create bridge that prefers library over paste  
- Brands / campaigns  
- Home / Watch redesign  

---

## Degrade path

Create paste-URL flow must keep working when linking is disabled, VERIFY incomplete, tokens fail, or provider media fields are omitted.
