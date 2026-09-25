# Mystash shopping memory — UX audit & design plan

**Status:** Audit only · no code  
**Date:** 2026-09-23  
**Scope:** Bag / Product Page / product cards / merchant options / shared primitives  
**Constraint:** Preserve existing navigation and functionality unless a visual change requires it. Do not invent backend fields when client data already exists.  
**Next:** Wait for Phase 1 prompt (Bag redesign only).

---

## Product principle

Mystash is not a conventional ecommerce cart. It is a **personal shopping memory**:

> Share it → forget it → Mystash remembers, organizes, and prepares it for you.

The Bag should feel personalized, intelligent, and curated — not like a database or checkout list.

**Emotional loop:** See something → Stash it → Forget it → Mystash remembers and organizes it.

---

## Screenshots used

| Set | Role |
|-----|------|
| Sep 22 Mystash captures (Bag, Product Page, discovery, specs) | **Current UI baseline** |
| Sep 23 reference captures (editorial profile / products / collections) | **Visual tone only** — do **not** copy layout, branding, or information architecture |

### What current screenshots show

**Bag**

- Title `Bag · N`, back control, soft canvas
- Category sections (`electronics`, `Other`)
- Bordered white cards: thumb + brand + title + teal price / orange availability + “From a shared link” + “Remove from Bag” on every card
- Reads as a **cart inventory**, not a memory

**Product page**

- TopBar with truncated title + Bag badge
- Inset rounded hero → brand → long title
- “Where can I buy this?” stacked merchant cards with full-width **Buy**
- “Your discovery” / related media / Compare / Specifications further down
- Functional commerce scroll — not editorial preparation

### What references suggest (tone only)

- Image-forward cards, collage “folders,” horizontal rails
- Generous whitespace, soft radius, quiet chrome
- Curation via named groups and media — not flat databases
- **Take for Mystash:** hierarchy through photography + restraint; organize memories visually; one calm accent
- **Do not adopt:** LTK tabs, Follow/Share CTAs, creator-profile IA, or their branding

---

## Code audit — inventory

### 1. Bag / Cart

| Role | Path |
|------|------|
| Screen | `app/cart.tsx` |
| Row card | `components/commerce/BagItemCard.tsx` |
| View model | `src/ui/bag.ts` |
| Line mapper | `src/services/cartLineMap.ts` |
| API | `src/services/cartApi.ts` |
| State | `contexts/CartContext.tsx` |
| Share progress | `src/hooks/useImportSharesPoll.ts` |
| Purchase modal | `components/commerce/CartPurchaseConfirmModal.tsx` |
| Copy | `BAG_COPY` in `src/ui/contracts.ts` |

**Layout today**

- Soft canvas gradient + `TopBar` (`mode="page"`, title via `bagScreenTitle`, bag icon off)
- `SectionList` of category groups (`bagSections`) or empty / auth / error / loading
- Optional list-header banners for in-flight / failed import shares
- `CartPurchaseConfirmModal` after return from merchant buy

**Data flow**

1. `useCart()` → `fetchCart()` → `CartLine[]`
2. `bagItemFromLine` → `BagItemView[]`
3. Parallel: `useImportSharesPoll` → progress banners; refresh on ready

**Displayed on Bag**

| UI | Source |
|----|--------|
| Thumb | `imageUrl` / `displayHeroUri` |
| Brand | `brand` |
| Title | `title` |
| Price | `priceLabel` |
| Source chip | `sourceLabel` (`bagSourceLabel`) |
| Availability warning | `availabilityLabel` |
| Remove | text control |

**Not shown (but available):** quantity (none in model), Buy CTA, verification, merchant name, gallery, description, specs, `canBuy` (computed unused), `addedAt` (sort only), category as chip (used as section header)

**Interactions:** tap row → product page (with `contentSourceId` / `userImportId`); remove with confirm; no Buy on Bag; post-merchant “Keep in Bag?” modal

---

### 2. Product page

| Role | Path |
|------|------|
| Route | `app/product/[productId].tsx` |
| Content | `components/product/ProductPage.tsx` |
| Types | `src/types/productPage.ts` |
| Hydration | `src/services/productPageMap.ts` |
| UI helpers | `src/ui/productPage.ts` |
| Live prices | `src/services/livePricesApi.ts`, `src/types/livePrices.ts` |

**Scroll order today**

1. Hero (single; gallery used as fallback only)
2. Brand / title / updating / headline price
3. Offers (“Where can I buy this?”) + Add to Bag
4. Discovery source embed
5. Related media rail
6. Reviews
7. Similar products
8. Compare (always shown)
9. Description
10. Specs

**Available vs displayed (selected)**

| Field | Displayed? |
|-------|------------|
| `title`, `brand`, `heroImage`, `price` | Yes |
| `offers[]` | Yes |
| `source`, `relatedMedia`, `reviews`, `description`, `specifications` | Yes when present |
| `detailsUpdating` | Yes (spinner + poll) |
| `galleryImages` | Fallback only — no carousel |
| `category`, page-level `merchant` | No |
| `canShop` | Unused in UI |
| `compareAvailable` | Ignored — Compare always shown |

**Live prices:** merge loading / live / stale / stored onto offers; `merchantUrl` attached but buy still via `openProductShopping({ offerId })`.

**Note:** Older `ProductDetailsSheet` still exists (gallery + `MerchantSection` + verification) — dual consumer product UIs.

---

### 3. Product cards

**Canonical:** `components/commerce/ProductCard.tsx`  
Variants: `compact` | `standard` | `collection` | `related` | `publicProfile`

**Bag-specific:** `BagItemCard` (not `ProductCard`)

**Wrappers / related:** `SearchProductCard`, `ShareActivityCard`, `FeedProductShelf`, etc.

Verification is shown on search/collection paths; **deliberately absent on Bag** (keep that product rule).

---

### 4. Merchant / buying options

| Surface | Pattern |
|---------|---------|
| Product Page | Inline offer cards |
| Collection / sheet | `MerchantSection`, `TrustStrip` |
| Redirect | `openProductShopping` → JSON redirect → `app/merchant-browser.tsx` |

**Shown:** merchant, price, availability, CTA from `action`, freshness label  
**Not shown as text:** offer `id`, `merchantUrl`, raw status codes

**Label inconsistency:** PDP CTA “Buy” vs `BAG_COPY.buy` = “View Product”

---

### 5. Navigation / header

- Tabs: Home · Search · Create · Profile — **Bag is not a tab**
- Bag via `BagButton` on `TopBar` → `/cart`
- Stack screens use in-app chrome (`headerShown: false`)
- User-facing noun is **Bag**; APIs may still say cart

---

### 6. Design tokens

**Source of truth:** `src/theme/tokens.ts` (titanium | nebula)

- Colors: `text`, `textMuted`, `surface*`, `border`/`divider`, `primary` `#00AFC0`, `cta`, semantic success/warning/danger
- Type scale micro → headline; weights 400/600/700/800
- Space xxs–xxl; radius sm–xxl / pill
- Gradients: `softCanvasGradient`, `pageCanvasGradient`

Legacy `constants/theme.ts` is **not** the shopping redesign SoT.

---

## Client field inventory (use these — no new backend for visuals)

### Cart line / BagItemView

```
cartItemId, productId, catalogProductId, addedAt,
availability: AVAILABLE | UNAVAILABLE | NO_DESTINATION,
source: { surface, contentSourceId, userImportId, … } | null,
title, brand, priceLabel, imageUrl, category,
sourceLabel, availabilityLabel, canBuy,
product: CatalogProductViewModel
```

### CatalogProductViewModel (nested)

```
id, catalogProductId, title, brand, merchant,
heroImage, galleryImages[], description, shortDescription,
specifications, verificationStatus, availability,
price, currency, lastVerifiedAt, metadataCompleteness, category?
```

### ProductPageView

```
productId, shoppingProductId, title, brand, category,
heroImage, galleryImages[], price, currency, merchant,
description, specifications, offers[], canShop,
source?, relatedMedia[], reviews?,
compareAvailable, detailsUpdating
```

### Offer + live prices

```
Offer: id, merchant, price, currency, availability, action
Live: merchantName, merchantUrl, price, currency, availability,
      source live|fallback, status, freshness loading|live|stale|stored
```

### Import / shares (Bag banners)

```
importId, state (looking|ready|nothing_yet|couldnt_finish),
kind, productCount, contentSourceId, sourceUrl, products[]
```

### Commerce country

```
country, profileCountry, locale, countrySource, source
```

---

## UX gaps vs product principle

| Gap | Evidence | Design implication |
|-----|----------|-------------------|
| Bag reads as cart inventory | Dense bordered rows; Remove on every card; repeated source chip | Curated memory layout: larger media, quieter actions |
| Category headers feel taxonomic | Raw `electronics` / `Other` | Keep category data; present as soft editorial chapters |
| Buy CTA inconsistency | PDP “Buy” vs `BAG_COPY.buy` “View Product” | One leave-app language; Bag stays prepare, not checkout |
| Dual product UIs | ProductPage vs ProductDetailsSheet | Unify consumer language over time |
| Offer density | Merchant + price + availability + freshness + full-width Buy | Calm merchant rows; quiet freshness |
| Discovery buried | Source media after offers | Memory origin should feel first-class when present |
| Underused fields | `canBuy`, gallery, category on PDP, `compareAvailable` | Elevate in redesign without new APIs |

---

## Design direction

Premium editorial mobile: **photography leads**, type is confident and spare, **whitespace replaces borders**, Titanium/Nebula tokens stay the system.

Mystash-specific: every shopping surface should answer **“why is this here?”** (source / when saved / ready to shop) without looking like an admin list.

### Visual system (shopping)

- Prefer divider + space over hairline card borders where possible
- Larger product media on Bag and PDP; gallery when `galleryImages` exist
- One primary accent (`tokens.color.primary`); mute secondary meta
- Destructive actions: secondary control / confirm — not permanent red text on every row
- Preserve `softCanvasGradient` + page TopBar; Bag remains chrome route `/cart`

### Preserve (function & nav)

- Tabs unchanged; Bag via BagButton only
- Tap Bag row → product page with source ids
- Remove + purchase-confirm modal (“Keep in Bag?”)
- Live prices + merchant-browser redirect
- Import share progress banners (restyle, keep states)
- `BAG_COPY` noun; never surface “Cart” in UI
- Align with UX-B.0: One Bag, curiosity before conversion, Buy = explicit leave

---

## Surface redesign briefs

### 1. Bag — Phase 1

**Feel:** Personal stash Mystash organized for you — shelves of memory, not line items.

**Layout**

- Quiet intro: title + count + optional looking state
- Category chapters as soft section titles (reuse `bagSections` / `category`)
- Memory cards: dominant image, brand, title, price
- Source as whisper (not repeated full sentence on every card)
- Availability as subtle status unless blocking
- Remove via secondary control (confirm retained)

**Use existing fields:** `BagItemView`, `addedAt`, `category`, `sourceLabel` / `USER_IMPORT`, banners from `bagProgressBanners`. Optional later: `canBuy` prepare affordance (not required Phase 1).

**Out of scope Phase 1:** quantity, totals, checkout, new APIs, renaming `/cart`.

---

### 2. Product page — Phase 2

- Editorial media stage (hero + optional gallery)
- Identity block: brand, title, headline price
- When `source` exists, elevate “Your discovery” near identity
- Merchant options as calm list
- Add to Bag = primary in-app; leave-app CTA secondary/explicit
- Details / specs / reviews / similar as progressive sections
- Honor `detailsUpdating`; gate Compare with `compareAvailable`

---

### 3. Product cards — Phase 2–3

One visual family across Bag memory card, `ProductCard` variants, search wrappers. Image-led; brand → title → price. Verification only where trust path already expects it (**not** Bag). Align action labels with `BAG_COPY`.

---

### 4. Merchant / buying options — Phase 2

Quiet rows: merchant · price · optional availability · quiet freshness · single leave-app control. Keep `openProductShopping` + merchant-browser. Prefer “View at {merchant}” / View Product over shouty “Buy” if aligning to contracts.

---

### 5. Shared primitives — throughout

`SectionHeader`, `ActionButton`, `ProductHeroImage`, `TopBar` — extend tone without forking a second design system. Stay on `tokens.ts`.

---

## Phased delivery

| Phase | Scope | Success look |
|-------|--------|--------------|
| **Phase 1 — Bag** | `cart.tsx`, `BagItemCard`, empty/auth/progress chrome | Opens as curated memory; same data & actions; no cart theatre |
| **Phase 2 — PDP + merchants** | `ProductPage`, offer rows, discovery emphasis | Prepare-to-shop editorial; live prices still clear |
| **Phase 3 — Cards + polish** | `ProductCard` family, rails, label consistency | One shopping language across Search, Bag, PDP, shares |

---

## Alignment with UX-B.0

Honors existing blueprint (`mystash-ux-b0-design-blueprint`): One Bag, Titanium/Nebula, Bag not a tab, curiosity before conversion, Buy = explicit leave. This document is the **shopping-memory visual chapter** on top of that chrome model — not a parallel IA.

---

## Gate

**No implementation until an explicit Phase 1 prompt** to redesign the Bag only (`app/cart.tsx` + `BagItemCard` + related empty/progress states).
