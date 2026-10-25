# Mystash — Design Handover for a Fresh-Perspective Redesign

**Audience:** A designer (human or Claude) picking this product up cold and re-imagining it.
**Goal of this doc:** Give you everything you need to redesign Mystash with a genuinely fresh
eye — the product truth, the users, the current surfaces, the design system, the debt, and the
hard constraints — while being explicit about what you're free to tear up and what you must not.
**Date:** 2026-09-30

> Read this once end-to-end before sketching. The most important sections for a *fresh*
> redesign are **§1 (the product)**, **§4 (what's broken today)**, and **§7 (your brief +
> guardrails)**. Everything else is reference.

---

## 1. What Mystash actually is

Mystash is **a personal shopping memory**, not a store and not a cart app.

> **See something → Stash it → Forget it → Mystash remembers, organizes, and prepares it for you.**

Two things are happening in one product:

1. **Discovery (consume).** A full-screen vertical **reels feed** of shoppable short-form video
   (YouTube / Instagram embeds). Creators publish "collections" of video + the products inside
   them. Users watch, and every reel exposes the products featured in it.
2. **Memory (keep).** Anything a user finds — in-app *or* shared in from elsewhere — is extracted,
   enriched, de-duplicated, and organized into their **Stash** (products) and, increasingly,
   **Places**. Later, Mystash has already figured out *where to buy it*, *for how much*, and *why
   it's there*.

The emotional promise is **relief and delight**, not transaction. The user should feel the app did
homework for them. The current UI too often reads like a database/checkout list — closing that gap
is the heart of this redesign.

### The two sides of the marketplace
- **Consumers** browse, stash, and (eventually) buy via external merchant redirects.
- **Creators** publish collections (via the Create flow), can connect YouTube/Instagram libraries,
  and have public profiles. There is an emerging **brand campaign / creator ecosystem** layer in the
  backend (early).

### What Mystash is *not*
- Not a checkout / payments product. **Buy = an explicit hand-off to an external merchant.**
- Not a quantity-based cart. One product = one line. No steppers, no totals.
- Not a generic social app. Engagement (like/save/follow/share) exists but in service of memory and
  discovery, not vanity.

---

## 2. Who it's for & core jobs

| User | Primary jobs |
|------|--------------|
| **Shopper / saver** | "Keep this for later." · "Where do I buy the thing from that video?" · "What did I save?" · "Is it worth it / where's it cheapest?" |
| **Creator** | "Turn my videos into shoppable collections." · "Grow an audience." · "Let people shop what I feature." |

The signature moment to design *around*: a user shares a random Instagram reel / TikTok / link into
Mystash, forgets about it, and later opens the app to find it already resolved into a clean,
buyable product with merchant options and a reason it's there. Make that moment feel magical.

---

## 3. Current information architecture

### Tabs (bottom nav)
`Home` · `Search` · `Create` · `Stash` · `Profile`
(Note: the older architecture docs say 4 tabs and "Bag is not a tab" — the code has since grown a
**Stash** tab. Treat the live code as truth. There is no "Bag" tab; a `/cart` route still exists and
is reachable via a bag button in some chrome. The consumer-facing noun is **Stash**, not "Cart".)

### Primary surfaces (all live in `app/`, Expo Router file-based routing)

| Surface | Route | Role today |
|---------|-------|-----------|
| **Home feed** | `app/(tabs)/index.tsx` | The hero. Full-screen paging reels; product shelf + action rail + creator block overlaid on video. **Protected** (see §7). |
| **Search** | `app/(tabs)/search.tsx` | Blended search across collections / creators / products; has a mode switch. |
| **Create** | `app/(tabs)/create/*` | Creator studio: submit URL → review → publish; modes (my content / products only); connected accounts; creator library; drafts hub. |
| **Stash** | `app/(tabs)/stash.tsx` | The memory. Segmented into **Products** (category cards + "recently stashed" grid) and **Places**. Import-in-progress banners. |
| **Profile** | `app/(tabs)/profile.tsx` | Signed-in account: auth (email + Google), personal profile, own + saved collections, edit profile, entry to settings/analytics. |
| **Collection / Reel host** | `app/(tabs)/collection/[collectionId]`, `app/reel/[collectionId]` | Focused single-collection reel presentation (reuses feed components). |
| **Product page** | `app/product/[productId]` | Full product: hero, identity, buying options (offers + live prices), discovery source, related media, reviews, similar, compare, specs. |
| **Product list** | `app/product-list/[id]` | "View all products" for a collection/video. |
| **Creator (public)** | `app/creator/[username]` | Public creator profile + their collections + follow. |
| **Cart** | `app/cart.tsx` | Legacy route; purchase-confirm modal lives here. Largely superseded by Stash. |
| **Compare / Cart / Merchant browser / Settings / Analytics / Shares / Import** | various | Supporting stack screens. |

### Key flows
- **Discover → inspect → stash → (later) buy.** Reel → product chip/sheet → Product page → Add to
  Stash / Buy (external redirect) → return → "Did you buy this?" confirm.
- **Share-in → resolve → appears in Stash.** External share → ingestion pipeline → import progress
  banners → resolved product/place appears.
- **Create → publish.** Creator submits a video URL → review extracted products → publish collection.
- **Auth-gated actions.** Browsing is public. **Save, Add to Stash/Cart, and Follow require login**,
  with a login → intent-resume pattern (`src/navigation/authIntent`, resumed in `profile.tsx`).

---

## 4. What's wrong today (the reason for a redesign)

This is the most important section for a fresh perspective. The current app *works* but does not
*feel* like its own promise. Observed problems:

1. **Memory reads like a database.** Stash / Bag / product lists lean on bordered rows, repeated
   meta ("From a shared link" on every card), "Remove" on every item, and taxonomic category
   headers (`electronics`, `Other`). It feels like inventory management, not a curated personal
   collection. The product principle ("shopping memory") is invisible in the UI.

2. **Commerce is loud where it should be calm.** Product pages read as a functional commerce scroll
   (stacked merchant "Buy" cards) rather than editorial "here's what we prepared for you." Freshness
   labels, statuses, and full-width CTAs add noise.

3. **The "why is this here?" is buried.** The discovery source ("you saw this in @creator's reel")
   — arguably the most emotionally valuable context — appears *below* offers on the product page and
   is whispered or absent elsewhere.

4. **Inconsistent language & components.** "Buy" vs "View Product" vs "View at {merchant}". Multiple
   product surfaces (`ProductPage` full screen **and** `ProductDetailsSheet`). Several product-card
   shapes with overlapping jobs. Verification badges appear on some surfaces, deliberately not on
   others — the rules are subtle and easy to get wrong.

5. **Chrome is heavy / generic.** Auth screen, settings rows, and some cards use ad-hoc colors and
   one-off styles that pre-date the token system (e.g. hardcoded `rgba` in `profile.tsx`). The
   Titanium/Nebula system is good but unevenly applied.

6. **Two visual worlds that don't quite talk.** The **immersive** world (reels, media-over-video
   chrome — dark, translucent, mode-invariant) and the **page** world (Stash, Profile, Product,
   Create — light/dark themed, editorial). Transitions between them can feel abrupt.

7. **Rich data underused.** Fields like `canBuy`, galleries, categories, `compareAvailable`,
   `addedAt`, availability, place metadata exist client-side but aren't leveraged to make surfaces
   feel intelligent.

**Design north star for the redesign:** every shopping/memory surface should answer *"why is this
here, and what did Mystash do for me?"* — through **photography-led hierarchy, generous whitespace,
one calm accent, and quiet chrome** — without looking like an admin list, and without inventing new
backend data.

---

## 5. The current design system (your material palette)

**Source of truth:** `src/theme/tokens.ts` (+ `src/theme/typography.ts` for semantic type roles,
`src/theme/useThemeTokens` / `contexts/ThemeContext` for access). `constants/theme.ts` is **legacy**
— not the SoT. NativeWind is installed but **unwired** — do not migrate to it.

### Two theme modes
- **Titanium** (light): white canvas `#FFFFFF` → `#F7F7F7`, near-black text `#1A1A1A`, muted
  `#666666`.
- **Nebula** (dark): near-black canvas `#08080A` → `#101012`, white text, muted `#A0A0A6`.
  Cards are *outline-only over a transparent fill* so the canvas shows through.

### Color
- **Primary (brand): `#00AFC0` (teal). Identical in both modes — never theme-dependent.** This is
  the one calm accent. Use it sparingly and deliberately.
- `accent` is mode-specific (titanium teal, nebula violet `#A855F7`) — legacy; prefer `primary` on
  redesigned surfaces.
- `cta` = Buy CTA (sky `#0EA5E9` / violet). Semantic: `success`, `warning`, `danger` (+ `*On`
  content colors).
- **Outline borders are a deliberate A/B/C experiment** (`OUTLINE_BORDER_VARIANT`:
  `ultraSubtle | refined | crisp`, currently `crisp`). Cards are defined by **border + structure, not
  fills or shadows** (`elevation.card = 0` — no drop shadows on info cards).

### Immersive tokens (mode-invariant, for UI over media)
A separate `IMMERSIVE_TOKENS` set (`stage: #000`, translucent white surfaces/controls, media scrim
gradient) governs anything laid over video/imagery. Do not flip these with theme — media underneath
is always dark. `mediaScrimGradient()` provides the bottom-up legibility ramp.

### Type
- **Font: Inter** (geometric sans; loaded faces in `tokens.fontFamily` — prefer these over raw
  `fontWeight` for Android correctness). Weights: 400 / 600 / 700 / 800.
- Scale (px): `micro 11 · caption 13 · label 13 · body 15 · bodyStrong 15 · title 16 · section 17 ·
  display 20 · headline 22`. Editorial, restrained — not big and shouty.
- **Use the semantic type roles** in `typography.ts` (`typeStyle(tokens, role)`): `chromeTitle`,
  `sectionTitle`, `tileTitle`, `tileMeta`, `tilePrice`, `identityBrand`, `identityTitle`,
  `offerMerchant`, `offerPrice`, `cta`, `link`, `body`, `bodyMuted`. Prefer extending these roles over
  inventing inline styles.

### Space / radius / stroke / motion
- Space: `xxs 4 · xs 8 · sm 12 · md 16 · lg 24 · xl 32 · xxl 48`.
- Radius: `sm 8 · md 12 · lg 16 · xl 16 · xxl 22 · pill 999`.
- Stroke: `hairline/thin 1 · strong 2`. Elevation: none (outline language).
- Motion: `pressOpacity 0.88`, `themeMs 300`, add-to-bag success `1800ms`, thumbnail fade `300ms`
  (`80ms` reduced-motion). Honor reduced-motion (`usePrefersReducedMotion`).
- Gradients: `pageCanvasGradient`, `softCanvasGradient` (page washes), `mediaScrimGradient` (media).

### Helpers worth knowing
`outlineCardChrome(tokens)` → transparent fill + quiet border for info cards. `getThemeTokens(mode)`,
`useThemeMode()` / `useThemeTokens()`.

---

## 6. Component inventory (what exists to reuse or replace)

~100 components in `components/`. The ones that carry the design language:

**Chrome / shell:** `chrome/TopBar` (modes: `page` | `immersive`), `chrome/AppTabBar`,
`chrome/BagButton`, `chrome/BackButton`, `chrome/OverflowMenu`, `chrome/AppToast`,
`create/CreateScreenShell`, `status/StatusBlock` (loading/empty/error), `ui/SectionHeader`,
`ui/ContentRail`, `ui/Text` (themed), `ui/ActionButton`, `ui/ListRowGroup`, `ui/MetaBar`,
`ui/ExpandableText`.

**Feed / immersive:** `ReelItem` (+ `YouTubeReelItem`, `InstagramReelItem`), `BottomDock`,
`feed/FeedReelOverlay`, `feed/ReelActionStack`, `feed/FeedProductShelf`, `feed/FeedProductSheet`,
`feed/FeedCreatorBlock`, `feed/FeedPlayOverlay`, `feed/FeedTeachHint`, `ui/ContentPlayChip`.

**Commerce:** `commerce/ProductCard` (variants: `compact | standard | collection | related | mini |
publicProfile` — the canonical card, one component many contracts), `commerce/BagItemCard`,
`commerce/ProductDetailsSheet`, `product/ProductPage`, `commerce/MerchantSection`,
`commerce/AddToCartButton`, `commerce/VerificationBadge`, `commerce/TrustStrip`,
`commerce/SpecificationGrid`, `commerce/CartPurchaseConfirmModal`, `commerce/AiReviewSheet` +
`ProductAiReviewCard`, `commerce/StashCategoryCard`, `product/ProductCompare`,
`product/ProductSourceMedia`, `product/ProductPageReviews`, `commerce/ProductHeroImage`.

**Collection:** `collection/CollectionScreen`, `CollectionTile`, `PublicCollectionTile`,
`CollectionHero`, `CollectionPageHeader`, `CollectionMediaReference`, `CollectionCuratorCredit`.

**Creator / profile:** `creator/CreatorProfile` (+ `Header`, `Card`, `CollectionList`,
`OnboardingPanel`, `DiscoverCreatorSuggestionCard`), `profile/PersonalProfile` (+ `Header`,
`IdentityHeader`, `StatsStrip`/`PersonalStatsBar`, `CollectionList`, `ContentTabs`,
`EditProfileSheet`, `DiscoverCreatorsSection`, `PersonalCreateCollectionCard`).

**Engagement:** `engagement/{Save,Like,Follow,Share}Control` — one pattern each, auth-gated.

**Places (new):** `place/PlaceCard` — an emerging object type (saved places, not just products).

**Create:** `create/{CreateModeSwitch, CreatorLibraryPanel, StagedProgressIndicator,
PublishConfirmSheet, PublishSuccessScreen, CreateInlineNotice}`.

**Deprecate-later / legacy:** `commerce/wrappers/{SearchProductCard, PublishedVideoProductCard}`,
`components/CartContext.tsx` (duplicate), `themed-text`, `themed-view`, `Header`, `SharedHeader`,
`parallax-scroll-view`, `hello-wave`, `constants/theme.ts`.

---

## 7. Your brief & guardrails

### You have freedom to rethink
- Overall **visual language, hierarchy, layout, spacing, and mood** of the page-world surfaces:
  **Stash, Product page, Product/collection cards, Profile, Search results, Create studio.**
- The **emotional framing** of memory (Stash) and preparation (Product page) — this is where the
  "database vs. memory" gap must close.
- **Copy/voice** on shopping surfaces (align to the "prepared for you" tone; unify Buy language).
- Component **consolidation** (e.g. unify `ProductPage` + `ProductDetailsSheet` language; rationalize
  the 6 ProductCard variants; one Buy label).
- New **token values / additional semantic roles** if they serve the system (extend, don't fork).
- How the **immersive world and page world** hand off to each other.

### Hard constraints — do not break these
1. **Tech stack is fixed:** Expo ~54, React Native 0.81, Expo Router, TypeScript, StyleSheet +
   Titanium/Nebula token system. **No NativeWind migration, no new styling framework, no Redux/
   Zustand/React Query** unless a concrete need is proven.
2. **The Home Reel Feed is protected.** Do not redesign its navigation, paging model, or visual
   hierarchy (full-screen media → creator/context → product shelf → View All). You *may* restyle
   within that hierarchy and align tokens, but no structural rework of the feed. Treat
   `REELS_FEED_README.md` and `frontend/docs/FE_DOMAIN_ARCHITECTURE_V1.md` §10 as binding.
3. **No new backend fields for visuals.** Use data the client already has (see the field inventory in
   `docs/shopping-memory-ux-audit-and-design-plan.md`). Elevate underused fields; don't invent APIs.
4. **Two themes, both first-class.** Every screen must work in Titanium **and** Nebula. Primary teal
   `#00AFC0` never changes with theme. Immersive tokens never flip with theme.
5. **Auth & commerce policy is frozen:** browse is public; **Save / Add to Stash / Follow require
   login** with intent-resume; **Buy = explicit external redirect**; **no quantity/checkout/payments**;
   purchase confirmation is an explicit "Did you buy?" Yes/No after returning to the app. Verification
   badges appear on trust paths (search/collection) but **not** in Stash — keep that rule unless you
   have a strong reason.
6. **Accessibility:** keep the existing `accessibilityRole`/`accessibilityLabel` coverage and
   reduced-motion handling; maintain legible contrast in both themes and over media.
7. **Preserve navigation & function** unless a visual change genuinely requires it. Tabs stay
   `Home · Search · Create · Stash · Profile`.

### Where to start (suggested, not mandatory)
The existing plan phases the shopping redesign **Stash → Product page + merchants → cards + polish**
(`docs/shopping-memory-ux-audit-and-design-plan.md`). That's a sensible order because Stash is the
purest expression of the "memory, not database" idea and has the highest emotional payoff per pixel.
A fresh perspective is welcome to re-sequence, but articulate why.

---

## 8. Deliverables I'd expect back

1. **A crisp design POV** (1 paragraph): what Mystash *should feel like*, in your words.
2. **A visual language spec:** refined tokens (color usage, type ramp, spacing rhythm, card/border
   language, motion), expressed as changes/additions to `src/theme/tokens.ts` + `typography.ts`.
3. **Redesigned key surfaces**, in priority order, each with: the intent ("why is this here?"), the
   layout, the states (loading/empty/error/auth), and which existing components/data it uses.
   Start with **Stash**, then **Product page + merchant options**, then the **ProductCard family**.
4. **A component consolidation plan:** what to unify/retire (esp. product cards, product details,
   Buy language) and the migration path.
5. **Explicit callouts** of anything that would require a constraint exception (protected feed, new
   data, nav changes) — with justification — so it can be approved before build.

---

## 9. Reference map (where to look in the repo)

| Topic | File(s) |
|-------|---------|
| **Design tokens** | `src/theme/tokens.ts`, `src/theme/typography.ts`, `src/theme/useThemeTokens.ts`, `contexts/ThemeContext.tsx` |
| **Product principle + current UX audit + client field inventory** | `docs/shopping-memory-ux-audit-and-design-plan.md` (read this — it's the most design-relevant doc) |
| **FE architecture, domain boundaries, auth policy (frozen)** | `frontend/docs/FE_DOMAIN_ARCHITECTURE_V1.md`, `frontend/docs/FE_ARCHITECTURE_AUDIT.md` |
| **Reel feed (protected) internals** | `REELS_FEED_README.md`, `frontend/docs/REEL_FE_ARCHITECTURE_PLAN.md`, `components/ReelItem.tsx`, `app/(tabs)/index.tsx` |
| **Canonical product card** | `components/commerce/ProductCard.tsx` |
| **Product page** | `components/product/ProductPage.tsx`, `src/ui/productPage.ts`, `src/types/productPage.ts` |
| **Stash / memory** | `app/(tabs)/stash.tsx`, `src/ui/bag.ts`, `src/ui/stashPlaces.ts`, `components/commerce/StashCategoryCard.tsx`, `components/place/PlaceCard.tsx` |
| **Create / creator studio** | `app/(tabs)/create/*`, `src/ui/createCopy.ts`, `src/ui/createMode.ts` |
| **Profile / auth** | `app/(tabs)/profile.tsx`, `components/profile/*`, `components/creator/*` |
| **Feature FE plans (per domain)** | `frontend/docs/*_IMPLEMENTATION_PLAN.md` (Search, Cart, Collection reel, Creator) |
| **Backend domain specs (for data truth)** | `backend/docs/*_DOMAIN_SPEC.md` |

---

## 10. One-paragraph TL;DR for the incoming designer

Mystash is a **personal shopping memory** with two faces: a protected, TikTok-style **reels feed**
for discovery, and a **Stash** that quietly remembers, resolves, and prepares everything a user saves
or shares in — figuring out where to buy it, for how much, and why it's there. Today the memory and
commerce surfaces read like a database and a checkout list; your job is to make them feel like
something a thoughtful friend curated for you: **photography-led, spacious, one calm teal accent,
quiet chrome, editorial type (Inter), two first-class themes (light "Titanium" / dark "Nebula")**.
Rework the page-world surfaces freely, **leave the reels feed's structure alone**, use only data the
client already has, keep Buy an explicit external hand-off, and unify the tangle of product cards and
Buy labels into one confident, consistent language.
```
