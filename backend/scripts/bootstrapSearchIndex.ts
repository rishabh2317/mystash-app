/**
 * Bootstrap Search index from Postgres SoT into the running Search process
 * via existing POST /search/index/* routes.
 *
 * Why: event-driven indexing only fires on writes. After a DB reset (or when
 * using InMemorySearchIndex), the active Search index can be empty while
 * Collection/User/Catalog rows exist.
 *
 * Usage:
 *   cd backend
 *   SEARCH_BOOTSTRAP_URL=http://127.0.0.1:8787 npx tsx scripts/bootstrapSearchIndex.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} required`);
  return v;
}

function baseUrl(): string {
  return (
    process.env.SEARCH_BOOTSTRAP_URL?.replace(/\/$/, '') ||
    process.env.MYSTASH_INGEST_URL?.replace(/\/$/, '') ||
    `http://127.0.0.1:${process.env.PORT || '8787'}`
  );
}

async function postJson(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} → ${res.status}: ${text}`);
  }
}

async function main(): Promise<void> {
  const admin = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
  const target = baseUrl();
  console.log(`[bootstrap-search] target=${target}`);

  const { data: collections, error: colErr } = await admin
    .from('collections')
    .select(
      `id, slug, title, caption, search_title, search_text, search_keywords, search_brands,
       search_categories, search_eligible, content_revision, creator_id, creator_name,
       creator_username, creator_avatar, hero_thumbnail_url, primary_media_id,
       product_tag_count, published_at, quality_score, views_count, saves_count,
       shares_count, product_clicks_count, deleted_at`,
    )
    .is('deleted_at', null)
    .eq('search_eligible', true)
    .limit(500);
  if (colErr) throw new Error(colErr.message);

  const { data: creators, error: userErr } = await admin
    .from('users')
    .select(
      `id, username, display_name, bio, profile_photo_url, followers_count,
       creator_status, account_status, schema_version, deleted_at`,
    )
    .is('deleted_at', null)
    .eq('account_status', 'ACTIVE')
    .eq('creator_status', 'ACTIVE')
    .not('username', 'is', null)
    .limit(500);
  if (userErr) throw new Error(userErr.message);

  const { data: products, error: prodErr } = await admin
    .from('catalog_products')
    .select(
      `id, name, brand, model, category, normalized_name, canonical_slug,
       verification_status, image_url, last_verified_at, price, currency,
       status, merged_into_id`,
    )
    .eq('status', 'ACTIVE')
    .is('merged_into_id', null)
    .limit(500);
  if (prodErr) throw new Error(prodErr.message);

  let indexedCollections = 0;
  for (const row of (collections ?? []) as Row[]) {
    await postJson('/search/index/collection', {
      collectionId: String(row.id),
      slug: String(row.slug ?? row.id),
      searchTitle: (row.search_title as string) ?? (row.title as string) ?? null,
      searchText: (row.search_text as string) ?? (row.caption as string) ?? null,
      searchKeywords: (row.search_keywords as string[]) ?? [],
      searchBrands: (row.search_brands as string[]) ?? [],
      searchCategories: (row.search_categories as string[]) ?? [],
      searchEligible: Boolean(row.search_eligible),
      contentRevision: Number(row.content_revision) || 1,
      creator: {
        creatorId: String(row.creator_id),
        displayName: (row.creator_name as string) ?? null,
        username: (row.creator_username as string) ?? null,
        avatarRef: (row.creator_avatar as string) ?? null,
      },
      primaryMediaRef:
        (row.hero_thumbnail_url as string) ?? (row.primary_media_id as string) ?? null,
      productTagCount: Number(row.product_tag_count) || 0,
      publishedAt: (row.published_at as string) ?? null,
      qualityScore: row.quality_score == null ? null : Number(row.quality_score),
      viewsCount: Number(row.views_count) || 0,
      savesCount: Number(row.saves_count) || 0,
      sharesCount: Number(row.shares_count) || 0,
      productClicksCount: Number(row.product_clicks_count) || 0,
      deleted: false,
    });
    indexedCollections += 1;
  }

  let indexedCreators = 0;
  for (const row of (creators ?? []) as Row[]) {
    const username = String(row.username ?? '').trim();
    if (!username) continue;
    await postJson('/search/index/creator', {
      userId: String(row.id),
      username,
      displayName: (row.display_name as string) ?? null,
      bio: (row.bio as string) ?? null,
      avatarRef: (row.profile_photo_url as string) ?? null,
      followersCount: Number(row.followers_count) || 0,
      creatorAuthority: 0,
      searchEligible: true,
      contentRevision: Number(row.schema_version) || 1,
      deleted: false,
    });
    indexedCreators += 1;
  }

  let indexedProducts = 0;
  for (const row of (products ?? []) as Row[]) {
    const name = String(row.name ?? '');
    const normalized = (row.normalized_name as string) ?? null;
    const aliases: string[] = [];
    if (normalized && normalized !== name) aliases.push(normalized);
    await postJson('/search/index/product', {
      catalogProductId: String(row.id),
      canonicalSlug: (row.canonical_slug as string) ?? null,
      name,
      brand: (row.brand as string) ?? null,
      model: (row.model as string) ?? null,
      category: (row.category as string) ?? null,
      aliases,
      verificationStatus: (row.verification_status as string) ?? null,
      primaryImageRef: (row.image_url as string) ?? null,
      popularity: 0,
      lastVerifiedAt: (row.last_verified_at as string) ?? null,
      priceAmount: null,
      priceCurrency: (row.currency as string) ?? null,
      searchEligible: true,
      contentRevision: 1,
      deleted: false,
    });
    indexedProducts += 1;
  }

  console.log(
    `[bootstrap-search] indexed collections=${indexedCollections} creators=${indexedCreators} products=${indexedProducts}`,
  );

  // Smoke queries against the same process
  const samples: { label: string; q: string }[] = [];
  const firstCol = (collections ?? [])[0] as Row | undefined;
  const firstCreator = (creators ?? [])[0] as Row | undefined;
  const firstProduct = (products ?? [])[0] as Row | undefined;
  if (firstCol) {
    const title =
      ((firstCol.search_title as string) || (firstCol.title as string) || '').trim();
    if (title) samples.push({ label: 'collection', q: title.split(/\s+/).slice(0, 3).join(' ') });
  }
  if (firstCreator?.username) {
    samples.push({ label: 'creator', q: String(firstCreator.username) });
  }
  if (firstProduct?.name) {
    samples.push({
      label: 'product',
      q: String(firstProduct.name).split(/\s+/).slice(0, 3).join(' '),
    });
  }

  for (const s of samples) {
    const url = `${target}/search?q=${encodeURIComponent(s.q)}&presentation=typed&limit=5`;
    const res = await fetch(url);
    const body = (await res.json()) as {
      zeroResult?: boolean;
      results?: { entityType: string; id: string; title: string }[];
      lanes?: {
        collections?: unknown[];
        creators?: unknown[];
        products?: unknown[];
      };
    };
    console.log(
      `[bootstrap-search] smoke ${s.label} q=${JSON.stringify(s.q)} status=${res.status} zero=${body.zeroResult} results=${body.results?.length ?? 0} lanes=c${body.lanes?.collections?.length ?? 0}/cr${body.lanes?.creators?.length ?? 0}/p${body.lanes?.products?.length ?? 0}`,
    );
    if (body.results?.[0]) {
      console.log(`  top: ${body.results[0].entityType} ${body.results[0].id} ${body.results[0].title}`);
    }
  }
}

main().catch((e) => {
  console.error('[bootstrap-search] failed', e);
  process.exit(1);
});
