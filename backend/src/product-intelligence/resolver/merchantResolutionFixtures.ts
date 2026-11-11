/** Deterministic fixtures: recorded identities/URLs, synthetic merchant metadata and images. */
import { ProductResolver } from './ProductResolver';
import { CatalogService } from '../../catalog/CatalogService';
import { InMemoryCatalogRepository } from '../../catalog/InMemoryCatalogRepository';
import { getProductIntelligenceConfig } from '../config';
import { TavilyEnrichedPdpSearchStrategy } from '../search/TavilyEnrichedPdpSearchStrategy';
import { MerchantEnrichmentService } from '../enrichment/MerchantEnrichmentService';
import { listStoredShoppingDestinations, catalogShoppingSource } from '../../shopping/storedDestinations';

const products = [
  { key: 'jbl', name: 'Tune Beam 2', brand: 'JBL', model: 'Tune Beam 2', url: 'https://www.jbl.com/TUNE-BEAM-2.html', category: 'electronics' },
  { key: 'dji', name: 'Osmo Pocket 3', brand: 'DJI', model: 'Pocket 3', url: 'https://store.dji.com/product/osmo-pocket-3', category: 'electronics' },
  { key: 'thinkpad', name: 'ThinkPad X1 Carbon', brand: 'Lenovo', model: 'X1 Carbon', url: 'https://www.lenovo.com/product/thinkpad-x1-carbon', category: 'laptops' },
  { key: 'omnibook', name: 'OmniBook X', brand: 'HP', model: 'OmniBook X', url: 'https://www.hp.com/us-en/shop/pdp/hp-omnibook-x', category: 'laptops' },
];
const current = { ProductResolver, CatalogService, InMemoryCatalogRepository, getProductIntelligenceConfig, TavilyEnrichedPdpSearchStrategy, MerchantEnrichmentService };
export type FixtureModules = typeof current;
export async function merchantImageFixtures(modules = current) {
  const outputs: Record<string, { hero: string | null; gallery: unknown; imageCalls: string[] }> = {};
  const outcomes: Record<string, { url: string | null; evidence: unknown; destinations: string[] }> = {};
  for (const product of products) for (const mode of ['create', 'find'] as const) for (const variant of ['page', 'blocked', 'fallback'] as const) {
    const key = `${product.key}:${mode}:${variant}`;
    const repo = new modules.InMemoryCatalogRepository();
    const imageCalls: string[] = [];
    const strategy = new modules.TavilyEnrichedPdpSearchStrategy({ name: 'fixture-discovery', async search() {
      return { kind: 'Succeeded', provider: 'fixture-discovery', candidates: [{ title: `${product.brand} ${product.name}`, merchantUrl: product.url, merchant: product.brand, score: 1, image: null }] };
    } }, new modules.MerchantEnrichmentService({ name: 'fixture-merchant', async extract(input) {
      imageCalls.push(input.merchantUrl);
      if (variant === 'fallback') return null;
      if (variant === 'blocked') return { title: new URL(product.url).hostname, merchantUrl: product.url, identitySource: 'tavily_gpt' };
      return { title: `${product.brand} ${product.name}`, brand: product.brand, merchantUrl: product.url,
        image: `https://images.example/${product.key}.jpg`, price: null, identitySource: 'merchant_html',
        pageEvidence: { hasProductJsonLd: true, hasAddToCart: false, name: `${product.brand} ${product.name}`, brand: product.brand, model: product.model },
        description: `${product.name} product details.`, specifications: { Model: product.model } };
    } }), 'fixture-ingest', 'fixture-trace');
    const resolver = new modules.ProductResolver(new modules.CatalogService(repo), strategy, { async updateResolution() {} },
      { async write() {} }, { ...modules.getProductIntelligenceConfig(), backgroundResolve: false }, null, 'fixture-ingest');
    const draft = { draftId: key, externalId: key, ...product, confidence: 1, image: `https://images.example/extracted-${product.key}.jpg`, commerceCountry: 'IN' };
    const [result] = mode === 'create' ? await resolver.resolveIngest([draft]) : await resolver.resolveForUserImport([draft]);
    const saved = mode === 'create' ? repo.all()[0] : result.discovered;
    const metadata = saved?.metadata ?? {};
    outputs[key] = { hero: saved?.imageUrl ?? null, gallery: metadata.gallery ?? [], imageCalls };
    const shoppingSource = mode === 'create' ? catalogShoppingSource(repo.all()[0]) : { merchant: saved?.merchant ?? null, merchantUrl: saved?.merchantUrl ?? null, preferredShoppingUrl: null, price: saved?.price ?? null, currency: saved?.currency ?? null, brand: saved?.brand ?? null, metadata };
    outcomes[key] = { url: result.merchantUrl, evidence: metadata.merchant_evidence, destinations: listStoredShoppingDestinations(shoppingSource).map(d => d.url) };
  }
  for (const mode of ['create', 'find'] as const) for (const variant of ['mixed-generation', 'multi-gallery', 'seed', 'catalog-hit'] as const) {
    const key = `${variant}:${mode}`;
    const repo = new modules.InMemoryCatalogRepository();
    const catalog = new modules.CatalogService(repo);
    const candidate = { title: variant === 'mixed-generation' ? 'JBL Tune Beam' : 'JBL Tune Beam 2',
      brand: 'JBL', merchant: 'JBL', merchantUrl: variant === 'mixed-generation' ? 'https://jbl.com/TUNE-BEAM.html' : 'https://jbl.com/TUNE-BEAM-2.html',
      image: 'https://images.example/existing-hero.jpg', score: 1, enrichmentSucceeded: true,
      pdpScore: 0.9, pdpVerdict: 'pdp' as const, sourceType: 'OFFICIAL' as const, pageType: 'PRODUCT' as const,
      capabilities: { metadata: true, images: true, commerce: true, specifications: true, evidence: true },
      enrichmentMeta: { gallery: ['https://images.example/second.jpg', 'https://images.example/third.jpg', 'https://images.example/second.jpg'],
        merchantPageIdentity: { title: variant === 'mixed-generation' ? 'JBL Tune Beam' : 'JBL Tune Beam 2', brand: 'JBL' } } };
    if (variant === 'catalog-hit') await catalog.createFromResolve({ name: 'JBL Tune Beam 2', normalizedName: 'jbl tune beam 2',
      canonicalSlug: 'jbl-tune-beam-2', brand: 'JBL', model: 'Tune Beam 2', category: 'electronics',
      imageUrl: candidate.image, merchantUrl: candidate.merchantUrl, verificationStatus: 'VERIFIED', verificationSource: 'fixture', verificationVersion: 'v1',
      metadata: { gallery: ['https://images.example/cached-second.jpg', candidate.image] } });
    const resolver = new modules.ProductResolver(catalog, { async search() { return { kind: 'Succeeded', provider: 'fixture', candidates: [candidate] }; } },
      { async updateResolution() {} }, { async write() {} }, { ...modules.getProductIntelligenceConfig(), backgroundResolve: false }, null, key);
    const draft = { draftId: key, externalId: key, name: 'JBL Tune Beam 2', brand: 'JBL', model: 'Tune Beam 2', category: 'electronics', confidence: 1,
      image: 'https://images.example/extraction.jpg', merchantUrl: variant === 'seed' || variant === 'catalog-hit' ? candidate.merchantUrl : null, creatorSuppliedUrl: variant === 'seed' };
    const [result] = mode === 'create' ? await resolver.resolveIngest([draft]) : await resolver.resolveForUserImport([draft]);
    const saved = result.catalogProductId ? repo.all()[0] : result.discovered;
    outputs[key] = { hero: saved?.imageUrl ?? null, gallery: saved?.metadata.gallery ?? [], imageCalls: [] };
  }
  return { outputs, outcomes };
}
