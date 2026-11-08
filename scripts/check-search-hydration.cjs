/* Offline regression: Catalog enrichment failure keeps Search product cards usable. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const file = path.resolve(__dirname, '../src/mappers/searchProductHydration.ts');
const mod = new Module(file, module);
mod.filename = file;
mod.require = id => {
  if (id === '@/src/services/supabase') return { fetchCatalogProductsByIds: async () => { throw new Error('network offline'); } };
  if (id === '@/src/services/catalogProductMapper') return { catalogRowToViewModel: row => row };
  if (id === '@/src/mappers/searchMapper') return { mapSearchProductCardThin: card => ({ id: card.id, title: card.title }) };
  return require(id);
};
mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText, file);

mod.exports.hydrateSearchProducts([
  { id: 'canonical-product', entityType: 'product', title: 'Found product' },
]).then(cards => {
  assert.deepEqual(cards, [{ id: 'canonical-product', title: 'Found product' }]);
  console.log('Search product fallback hydration check passed.');
}).catch(error => { console.error(error); process.exitCode = 1; });
