/* Real shared reel host with offline platform/player/API adapters. No providers,
 * authentication, persistent data, or native video players are used. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const web = require('react-native-web');
const ts = require('typescript');
const root = path.dirname(require.resolve('../package.json')), modules = new Map();
let tokens, owner = 'owner', focused = true, params, values, refs, stateIndex, refIndex;
let list, rootProps, players, actions, offsets, calls, response, failure, finish;
const react = { ...React,
  useState(initial) {
    const real = React.useState(initial), index = stateIndex++;
    if (index >= 9) return real;
    if (!values.has(index)) values.set(index, real[0]);
    return [values.get(index), update => values.set(index, typeof update === 'function' ? update(values.get(index)) : update)];
  },
  useRef(initial) {
    const real = React.useRef(initial), index = refIndex++;
    if (!refs.has(index)) refs.set(index, real);
    return refs.get(index);
  },
};
const native = { ...web,
  View: props => { if (props.onLayout) rootProps = props; return React.createElement(web.View, props); },
  Pressable: props => { actions.push(props); return React.createElement(web.Pressable, props); },
  FlatList: props => {
    list = props; props.ref.current = { scrollToOffset: arg => offsets.push(arg), scrollToIndex: arg => offsets.push(arg) };
    return React.createElement(web.View, null, props.data.map((item, index) => React.createElement(React.Fragment, { key: props.keyExtractor(item, index) }, props.renderItem({ item, index }))));
  },
};
async function page(kind, ...args) { calls.push([kind, ...args]); await new Promise(resolve => { finish = resolve; }); if (failure) throw Error('offline'); return response; }
const engagement = { canSaveShare: true, showFollow: true };
function load(file) {
  const filename = ['.ts', '.tsx'].map(ext => file + ext).find(fs.existsSync) ?? file;
  if (modules.has(filename)) return modules.get(filename).exports;
  const mod = new Module(filename, module); mod.filename = filename; modules.set(filename, mod);
  mod.require = id => {
    if (id === 'react') return react;
    if (id === 'react-native') return native;
    if (id === '@/contexts/AuthContext') return { useAuth: () => ({ user: owner ? { id: owner } : null }) };
    if (id === '@/contexts/ThemeContext') return { useThemeMode: () => ({ tokens }) };
    if (id === '@react-navigation/native') return { useIsFocused: () => focused };
    if (id === 'expo-router') return { useLocalSearchParams: () => params, useRouter: () => ({ back() {} }) };
    if (id === '@/components/ReelItem') return { __esModule: true, default: props => { players.push(props); return React.createElement(web.Text, null, props.video.id); } };
    if (id === '@/components/chrome/TopBar') return { TopBar: () => null };
    if (id === '@/components/feed/FeedProductSheet') return { FeedProductSheet: () => null };
    if (id === '@/src/services/collectionViewTracking') return { recordCollectionViewOnce() {} };
    if (id === '@/src/services/feedReelEngagement') return { useFeedReelEngagement: () => engagement };
    if (id === '@/src/services/searchReelHydration') return { clearSearchReelVideoCache() {}, peekSearchReelVideo: () => null, hydrateSearchReelVideo: async () => { throw Error('Hydration forbidden during SSR'); } };
    if (id === '@/src/services/collectionApi') return { listCreatorCollections: (...args) => page('creator', ...args) };
    if (id === '@/src/services/engagementApi') return { listSavedCollectionIds: (...args) => page('saved', ...args) };
    if (id === '@/src/services/searchApi') return { searchBlended: (...args) => page('search', ...args) };
    if (id === 'expo-image') return { Image: Object.assign(() => null, { prefetch: async () => {} }) };
    if (id === 'expo-linear-gradient') return { LinearGradient: props => React.createElement(web.View, null, props.children) };
    if (id === '@expo/vector-icons') return { Ionicons: () => null };
    if (id.startsWith('@/')) return load(path.join(root, id.slice(2)));
    if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), id));
    return require(id);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const Host = load(path.join(root, 'components/feed/CollectionReelFeed')).default;
const { getThemeTokens } = load(path.join(root, 'src/theme/tokens'));
const searchState = load(path.join(root, 'src/state/searchReelSession'));
const collections = ['a', 'b', 'c'].map(collectionId => ({ collectionId, heroThumbnailUrl: null }));
function reset(cursor = null, count = 3) {
  owner = 'owner'; focused = true; params = { collectionId: count > 1 ? 'b' : 'a' };
  const rows = collections.slice(0, count);
  values = new Map([[1, Object.fromEntries([...rows, { collectionId: 'd' }].map(row => [row.collectionId, { id: row.collectionId, collection_id: row.collectionId }]))]]);
  refs = new Map(); offsets = []; calls = []; failure = false; finish = null;
  response = { collections: [{ collectionId: 'd' }], nextCursor: null };
  return { collections: rows, startCollectionId: params.collectionId, nextCursor: cursor, source: { kind: 'snapshot' } };
}
function render(session) {
  list = null; rootProps = null; players = []; actions = []; stateIndex = 0; refIndex = 0;
  return renderToStaticMarkup(React.createElement(Host, { sourceSession: session }));
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const originalFetch = global.fetch;
global.fetch = async () => { throw Error('Network forbidden in reel checks'); };
let checks = 0;
(async () => { try {
  for (const theme of ['titanium', 'nebula']) {
    tokens = getThemeTokens(theme);
    let session = reset(); render(session);
    assert.equal(list.initialScrollIndex, 1); assert.deepEqual(list.data.map(r => r.collectionId), ['a', 'b', 'c', 'a']);
    assert.equal(new Set(list.data.map(list.keyExtractor)).size, 4);
    assert.deepEqual(players.filter(p => p.isActive).map(p => p.video.id), ['b']); checks++;
    rootProps.onLayout({ nativeEvent: { layout: { height: 640 } } }); render(session);
    assert.equal(list.snapToInterval, 640); assert.equal(list.getItemLayout(null, 2).offset, 1280); checks++;
    list.onViewableItemsChanged({ viewableItems: [{ index: 3, isViewable: true }] }); render(session);
    assert.deepEqual(players.filter(p => p.isActive).map(p => p.video.id), ['a']);
    list.onMomentumScrollEnd({ nativeEvent: { contentOffset: { y: 1920 } } }); render(session);
    assert.deepEqual(offsets.at(-1), { offset: 0, animated: false }); assert.equal(values.get(2), 0);
    assert.deepEqual(players.filter(p => p.isActive).map(p => p.video.id), ['a']); checks++;
    focused = false; render(session); assert.equal(players.filter(p => p.isActive).length, 0);
    focused = true; render(session); players.find(p => p.isActive).onProductPress({ id: 'product' }); render(session);
    assert.equal(players.filter(p => p.isActive).length, 0); checks++;
    session = reset(null, 1); render(session); assert.equal(list.data.length, 1); checks++;
    session = reset(); session.ownerId = 'owner'; owner = 'different-owner';
    assert.ok(render(session).includes('Your account changed')); assert.equal(list, null); checks++;
    session = reset(); values.set(7, { a: true }); values.set(1, { b: { id: 'b' }, c: { id: 'c' } });
    assert.ok(render(session).includes('swipe to the next reel')); assert.equal(list.data.length, 4); checks++;
    session = reset('creator-page2'); session.source = { kind: 'creator', creatorId: 'specific-creator' };
    values.set(6, true); render(session); assert.equal(list.data.length, 3, 'no loop while more source pages exist');
    let retry = actions.find(a => a.accessibilityLabel === 'Try loading more reels'); retry.onPress(); retry.onPress();
    assert.equal(calls.length, 1); assert.deepEqual(calls[0], ['creator', 'specific-creator', { limit: 20, cursor: 'creator-page2' }]);
    finish(); await flush(); render(session); assert.deepEqual(list.data.map(r => r.collectionId), ['a', 'b', 'c', 'd', 'a']); checks++;
    session = reset('retry-cursor'); session.source = { kind: 'creator', creatorId: 'creator' }; values.set(6, true); render(session);
    actions.find(a => a.accessibilityLabel === 'Try loading more reels').onPress(); failure = true; finish(); await flush(); render(session);
    assert.equal(list.data.length, 3); assert.ok(actions.some(a => a.accessibilityLabel === 'Try loading more reels'));
    failure = false; actions.find(a => a.accessibilityLabel === 'Try loading more reels').onPress(); assert.equal(calls[1][2].cursor, 'retry-cursor');
    finish(); await flush(); render(session); assert.equal(list.data.length, 5); checks++;
    session = reset('ranked-page'); searchState.setSearchReelSession({ ...session, query: 'camera', entityType: 'collection' });
    values.set(6, true); response = { results: [], nextCursor: null }; render(undefined);
    actions.find(a => a.accessibilityLabel === 'Try loading more reels').onPress(); assert.equal(calls[0][0], 'search'); assert.equal(calls[0][1].q, 'camera');
    finish(); await flush(); render(undefined); assert.equal(list.data.length, 4); checks++;
  }
  console.log(JSON.stringify({ passed: true, checks, themes: 2, nativeExecution: false }));
} finally { global.fetch = originalFetch; } })().catch(error => { console.error(error); process.exitCode = 1; });
