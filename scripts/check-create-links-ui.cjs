/* Offline Create Studio interactions. Real screen/composer/buttons, mocked APIs;
 * no native runtime, provider requests, credentials, or database writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup, renderToString } = require('react-dom/server');
const web = require('react-native-web');
const ts = require('typescript');
const root = path.dirname(require.resolve('../package.json')), modules = new Map();
let tokens, fontScale = 1, stateIndex = 0, refIndex = 0, actions = [], inputs = [];
let values = new Map(), refs = new Map(), calls = [], response, failure, release;
const react = { ...React,
  useState(initial) {
    const real = React.useState(initial), index = stateIndex++;
    if (index >= 23) return real;
    if (!values.has(index)) values.set(index, real[0]);
    return [values.get(index), update => values.set(index, typeof update === 'function' ? update(values.get(index)) : update)];
  },
  useRef(initial) {
    const real = React.useRef(initial), index = refIndex++;
    if (!refs.has(index)) refs.set(index, real);
    return refs.get(index);
  },
};
const scaled = style => { const flat = web.StyleSheet.flatten(style) ?? {}; return [style, { fontSize: flat.fontSize ? flat.fontSize * fontScale : undefined, lineHeight: flat.lineHeight ? flat.lineHeight * fontScale : undefined }]; };
const native = { ...web,
  Text: props => React.createElement(web.Text, { ...props, style: scaled(props.style) }),
  TextInput: props => { inputs.push(props); return React.createElement(web.TextInput, { ...props, style: scaled(props.style) }); },
  Pressable: props => { actions.push(props); return React.createElement(web.Pressable, props); },
};
const draft = { ingestId: 'draft-fixture', videoTitle: 'Fixture video', sourceUrl: 'https://www.youtube.com/shorts/abcdefghijk', platform: 'youtube', products: [], status: 'ready_for_review', extractionPending: false };
async function submit(kind, ...args) {
  calls.push([kind, ...args]);
  await new Promise(resolve => { release = resolve; });
  if (failure) throw Error(failure);
  return response;
}
const api = { submitManualProductLinks: (...args) => submit('manual', ...args), appendManualProductsToIngest: (...args) => submit('append', ...args), listUserDraftIngests: async () => [], normalizeIngestError: error => error.message ?? String(error) };
function load(file) {
  const filename = ['.ts', '.tsx'].map(ext => file + ext).find(fs.existsSync) ?? file;
  if (modules.has(filename)) return modules.get(filename).exports;
  const mod = new Module(filename, module); mod.filename = filename; modules.set(filename, mod);
  mod.require = id => {
    if (id === 'react') return react;
    if (id === 'react-native') return native;
    if (id === '@/contexts/ThemeContext' || id === '@/src/theme/useThemeTokens') return { useThemeMode: () => ({ tokens }), useThemeTokens: () => tokens };
    if (id === '@/contexts/AuthContext') return { useAuth: () => ({ user: { id: 'fixture-owner' }, loading: false }) };
    if (id === '@react-navigation/native') return { useIsFocused: () => true, useFocusEffect() {} };
    if (id === 'expo-router') return { useRouter: () => ({ push() {}, replace() {} }) };
    if (id === '@/src/services/curation') return api;
    if (id === '@/src/services/userApi') return { ensureMe: async () => ({ creatorStatus: 'ACTIVE' }) };
    if (id === '@/src/ui/usePrefersReducedMotion') return { usePrefersReducedMotion: () => true };
    if (id === '@/src/ui/useAppToast') return { useAppToast: () => ({ showToast() {} }) };
    if (id === '@/src/state/createFlowSession') return { useCreateFlowReset() {} };
    if (id === '@/src/state/curationDraftStore') return { isCurationDraftPublished: () => false };
    if (id === '@/src/services/feedRefresh') return { requestFeedReload() {} };
    if (id === '@/src/notifications/permissionPrompt') return { maybePromptForPush() {} };
    if (id === '@/components/create/CreateScreenShell') return { CreateScreenShell: ({ children }) => React.createElement(web.View, null, children) };
    if (id === '@/components/create/CreateStudioLibraryPicker') return { CreateStudioLibraryPicker: () => null };
    if (id === '@/components/creator/CreatorOnboardingPanel') return { CreatorOnboardingPanel: () => null };
    if (id === '@/components/create/PublishConfirmSheet') return { PublishConfirmSheet: () => null };
    if (id === '@/components/create/PublishSuccessScreen') return { PublishSuccessScreen: () => null };
    if (id === '@expo/vector-icons') return { Ionicons: ({ name }) => React.createElement('span', { 'aria-hidden': true }, name === 'add-outline' ? '+' : '↗') };
    if (id === 'expo-image') return { Image: () => null };
    if (id.startsWith('@/')) return load(path.join(root, id.slice(2)));
    if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), id));
    return require(id);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const { getThemeTokens } = load(path.join(root, 'src/theme/tokens'));
const Screen = load(path.join(root, 'app/(tabs)/create/index')).default;
function reset(existing = false) {
  values = new Map([[0, { creatorStatus: 'ACTIVE' }], [1, false], [5, { sourceUrl: draft.sourceUrl, title: 'Fixture video' }], [6, existing ? { ...draft } : undefined], [10, true], [17, 'products']]);
  refs = new Map(); calls = []; failure = null; release = null; response = { ingestId: draft.ingestId, draft: { ...draft }, failedProductUrls: [] };
}
function render(width = 320, asDocument = false) {
  stateIndex = 0; refIndex = 0; actions = []; inputs = [];
  const element = React.createElement(web.View, { style: { width, backgroundColor: tokens.color.canvasSoft } }, React.createElement(Screen));
  if (!asDocument) return renderToStaticMarkup(element);
  const sheet = web.AppRegistry.getApplication('CreateLinksFixture', { initialProps: { element } }).getStyleElement();
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${renderToStaticMarkup(sheet)}</head><body style="margin:0;background:${tokens.color.canvasSoft}">${renderToString(element)}</body></html>`;
}
web.AppRegistry.registerComponent('CreateLinksFixture', () => ({ element }) => element);
const fieldInputs = () => inputs.filter(input => /^Product URL \d+$/.test(input.accessibilityLabel));
const action = label => actions.find(action => action.accessibilityLabel === label);
const fields = () => values.get(9);
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const originalFetch = global.fetch;
global.fetch = async () => { throw Error('Network forbidden in Create checks'); };
let checks = 0;
(async () => { try {
  for (const theme of ['titanium', 'nebula']) {
    tokens = getThemeTokens(theme);
    for (const existing of [false, true]) for (const count of [1, 2, 5]) {
      reset(existing); render(); assert.equal(fieldInputs().length, 1); assert.ok(!action('Remove product URL 1'));
      for (let i = 1; i < count; i++) { action('Add another link').onPress(); render(); }
      fieldInputs().forEach((input, i) => input.onChangeText(` https://shop.example/p/${i}?ref=affiliate `)); render();
      assert.equal(fieldInputs().length, count); assert.equal(Boolean(action('Add another link')), count < 5);
      const add = action(count === 1 ? 'Add product' : 'Add products'); assert.equal(add.disabled, false);
      add.onPress(); add.onPress(); assert.equal(calls.length, 1, 'same-frame taps submit only once');
      assert.equal(calls[0][0], existing ? 'append' : 'manual');
      assert.deepEqual(calls[0][2], Array.from({ length: count }, (_, i) => `https://shop.example/p/${i}?ref=affiliate`));
      render(); assert.ok(fieldInputs().every(input => input.editable === false)); assert.ok(action('Add products')?.disabled ?? action('Add product').disabled);
      assert.equal(fields().length, count, 'pending requests preserve entered values'); release(); await flush();
      render(); assert.equal(fieldInputs().length, 1); assert.equal(fieldInputs()[0].value, ''); assert.equal(values.get(6).ingestId, draft.ingestId); checks++;
    }
    reset(); render(); for (let i = 0; i < 4; i++) { action('Add another link').onPress(); render(); }
    fieldInputs().forEach((input, i) => input.onChangeText(`https://shop.example/${i}`)); render();
    const before = fields().map(field => ({ ...field })); action('Remove product URL 3').onPress(); render();
    assert.deepEqual(fields(), before.filter((_, i) => i !== 2));
    while (fields().length > 1) { action('Remove product URL 1').onPress(); render(); }
    assert.equal(fields()[0].value, before[4].value); assert.ok(!action('Remove product URL 1')); checks++;
    reset(); render(); action('Add another link').onPress(); render();
    fieldInputs()[0].onChangeText(' https://shop.example/p#one '); fieldInputs()[1].onChangeText('https://shop.example/p#two');
    let html = render(); assert.ok(html.includes('This link will be added once')); action('Add product').onPress();
    assert.deepEqual(calls[0][2], ['https://shop.example/p']); release(); await flush(); checks++;
    reset(); render(); action('Add another link').onPress(); render(); fieldInputs()[0].onChangeText('https://shop.example/valid'); fieldInputs()[1].onChangeText('bad link');
    html = render(); assert.ok(html.includes('Enter a valid')); assert.ok(action('Add product').disabled); action('Add product').onPress();
    assert.equal(calls.length, 0); assert.equal(fields()[1].value, 'bad link'); checks++;
    fieldInputs()[1].onChangeText('  '); render(); assert.equal(action('Add product').disabled, false);
    action('Add product').onPress(); failure = 'Fixture request failed'; release(); await flush();
    html = render(); assert.ok(html.includes('Fixture request failed')); assert.equal(fields()[0].value, 'https://shop.example/valid'); assert.equal(fields()[1].value, '  '); checks++;
    for (const existing of [false, true]) {
      reset(existing); render(); action('Add another link').onPress(); render();
      fieldInputs().forEach((input, i) => input.onChangeText(`https://shop.example/${i}`)); render();
      const product = { id: 'product-fixture', name: 'Successfully added product', price: '—', provider: 'manual', affiliateUrl: 'https://shop.example/0?ref=affiliate', resolutionStatus: 'RESOLVING' };
      response = { ingestId: draft.ingestId, draft: { ...draft, products: [product] }, failedProductUrls: ['https://shop.example/1'] };
      action('Add products').onPress(); release(); await flush(); html = render();
      assert.ok(html.includes('https://shop.example/1')); assert.equal(values.get(6).ingestId, draft.ingestId);
      assert.deepEqual(values.get(6).products, [product], 'keep the successful product and its resolution state');
      assert.equal(values.get(8)[product.id], 'link');
      assert.deepEqual(fields().map(field => field.value), [''], 'partial-success reset matches the pre-existing Studio behavior'); checks++;
    }
    for (const width of [320, 390]) for (fontScale of [1, 2]) for (const count of [1, 2, 5]) {
      reset(); render(width); for (let i = 1; i < count; i++) { action('Add another link').onPress(); render(width); }
      fieldInputs().forEach((input, i) => input.onChangeText(`https://shop.example/p/${i}?ref=affiliate`));
      const html = render(width, true); assert.equal(fieldInputs().length, count); assert.ok(fieldInputs().every(input => web.StyleSheet.flatten(input.style).minWidth === 0));
      assert.ok(actions.filter(action => /Add another link|^Remove product|^Add products?$/.test(action.accessibilityLabel)).every(action => web.StyleSheet.flatten(action.style).minHeight >= 44));
      if (process.env.CREATE_LINKS_PREVIEW_DIR) { fs.mkdirSync(process.env.CREATE_LINKS_PREVIEW_DIR, { recursive: true }); fs.writeFileSync(path.join(process.env.CREATE_LINKS_PREVIEW_DIR, `${theme}-${width}-${fontScale}-${count}.html`), html); }
      checks++;
    }
    fontScale = 1;
  }
  console.log(JSON.stringify({ passed: true, checks, themes: 2, widths: [320, 390], fontScales: [1, 2], counts: [1, 2, 5], nativeExecution: false }));
} finally { global.fetch = originalFetch; } })().catch(error => { console.error(error); process.exitCode = 1; });
