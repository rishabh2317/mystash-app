/** Execute real ProductPage render/effect callbacks with offline service adapters. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const native = require('react-native-web');
const { renderToStaticMarkup } = require('react-dom/server');
let effects = [], searchCalls = 0, priceCalls = 0;
const inert = () => null;
const tokens = { space: { md: 16, xxl: 32, xl: 24, sm: 8, xs: 4, xxs: 2 }, radius: { lg: 16, md: 12 }, color: { surfaceSubtle: '#eee', primary: '#000', divider: '#ccc' }, lineHeight: { micro: 12 } };
const ui = {
  PRODUCT_PAGE_COPY: { offers: 'Buying options' }, catalogViewFromProductPage: page => ({ id: page.productId, catalogProductId: page.shoppingProductId }),
  productPageSections: () => ({ offers: true, similar: true, featured: false, compare: true }),
  productPagePriceLabel: row => row.price || null, productPageBestPriceLabel: () => null, productPageBuyingFreshnessLine: () => null,
  productAiReviewFromPage: () => null, featuredMediaFromPage: () => [], productPagePricesFromLabel: () => null,
  similarProductsQuery: () => 'mug', productPageOfferCta: () => 'Shop now', productPageAvailabilityLabel: () => null, productPagePriceFreshnessLabel: () => 'Refreshing',
};
const file = path.resolve(__dirname, '../components/product/ProductPage.tsx');
const mod = new Module(file, module); mod.filename = file; mod.paths = module.paths;
mod.require = id => {
  if (id === 'react') return { ...React, useEffect: fn => effects.push(fn) };
  if (id === 'react-native') return { ...native, useWindowDimensions: () => ({ width: 390 }) };
  if (id === 'expo-router') return { useRouter: () => ({ push() {} }) };
  if (id.endsWith('/analytics/hooks')) return { useMeasuredOpen() {} };
  if (id.endsWith('/ThemeContext')) return { useThemeMode: () => ({ tokens }) };
  if (id.endsWith('/theme/tokens')) return { outlineCardChrome: () => ({}) };
  if (id.endsWith('/theme/typography')) return { typeStyle: () => ({}) };
  if (id.endsWith('/ui/productPage')) return ui;
  if (id.endsWith('/ui/rail')) return { railCardWidth: () => 160 };
  if (id.endsWith('/ui/contracts')) return { BAG_COPY: { add: 'Stash it' } };
  if (id.endsWith('/productActionOrchestration')) return { useProductAddToCartHandler: () => inert, useProductBuyHandler: () => inert };
  if (id.endsWith('/searchApi')) return { async searchBlended() { searchCalls++; return { lanes: { products: [] } }; } };
  if (id.endsWith('/searchProductHydration')) return { async hydrateSearchProducts() { return []; } };
  if (id.endsWith('/collectionRelatedProducts')) return { pickRelatedProducts: () => [] };
  if (id.endsWith('/livePricesApi')) return { async fetchLivePrices() { priceCalls++; return { results: [] }; } };
  if (id.endsWith('/commerceCountry')) return { async getCommerceCountry() { return { country: 'IN' }; } };
  if (id.startsWith('@/components/')) return new Proxy({}, { get: (_target, name) => name === 'Text' ? native.Text : inert });
  if (id.startsWith('@/')) return new Proxy({}, { get: () => inert });
  return require(id);
};
mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, file);
const page = { productId: 'mug', shoppingProductId: 'mug', title: 'Stored mug', brand: null, category: null, description: null,
  heroImage: null, galleryImages: [], specifications: {}, offers: [{ id: 'one', merchant: 'Stored store', price: '120', action: 'buy' }], reviews: null };
async function render(publicMode) {
  effects = [];
  const html = renderToStaticMarkup(React.createElement(mod.exports.ProductPage, { page,
    ...(publicMode ? { publicActions: { onSave() {}, async onShop() {} } } : {}) }));
  const cleanups = effects.map(fn => fn());
  await new Promise(resolve => setImmediate(resolve));
  cleanups.forEach(fn => typeof fn === 'function' && fn());
  return html;
}
(async () => {
  const html = await render(true);
  assert.match(html, /Stored store/); assert.match(html, /120/); assert.match(html, /Shop now/);
  assert.equal(searchCalls, 0); assert.equal(priceCalls, 0);
  await render(false);
  assert.equal(searchCalls, 1); assert.equal(priceCalls, 1);
  process.stdout.write('Public stored offers preserved; public search/pricing suppressed; standard effects preserved.\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
