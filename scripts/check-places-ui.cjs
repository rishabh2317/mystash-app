/* Offline component render checks using existing dependencies. No server, browser,
 * dotenv, native build, backend, provider, or Analytics client is started. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const nativeWeb = require('react-native-web');
const ts = require('typescript');

const root = path.dirname(require.resolve('../package.json'));
const modules = new Map();
let tokens;
let dimensions = { width: 390, height: 844, scale: 1, fontScale: 1 };
let captured = null;
let allowObservations = false;
const observations = [];
let controlled = null;
let stateIndex = 0;
let refIndex = 0;
const reactAdapter = { ...React, useRef(initial) {
  const real = React.useRef(initial);
  if (!controlled) return real;
  const index = refIndex++;
  controlled.refs ??= new Map();
  if (!controlled.refs.has(index)) controlled.refs.set(index, real);
  return controlled.refs.get(index);
}, useState(initial) {
  const real = React.useState(initial);
  const index = stateIndex++;
  if (!controlled || index >= controlled.count) return real;
  if (!controlled.values.has(index)) controlled.values.set(index, real[0]);
  return [controlled.values.get(index), update => controlled.values.set(index,
    typeof update === 'function' ? update(controlled.values.get(index)) : update)];
} };
function capture() { return { views: [], actions: [], images: [], scrolls: [], lists: [] }; }
function renderControlled(Component, props) {
  captured = capture(); stateIndex = 0; refIndex = 0;
  return renderToStaticMarkup(React.createElement(Component, props));
}
const nativeAdapters = {
  ...nativeWeb,
  useWindowDimensions: () => dimensions,
  ScrollView: props => {
    if (captured?.scrolls) captured.scrolls.push(props);
    return React.createElement(nativeWeb.ScrollView, props);
  },
  FlatList: props => {
    if (captured?.lists) captured.lists.push(props);
    return React.createElement(nativeWeb.FlatList, props);
  },
  View: (props) => {
    if (captured) captured.views.push(props);
    return React.createElement(nativeWeb.View, props);
  },
  Pressable: (props) => {
    if (captured) captured.actions.push(props);
    return React.createElement(nativeWeb.Pressable, props);
  },
  // SSR has no native modal host; expose its actual children for fixture checks.
  Modal: props => {
    if (captured) captured.nativeModal = props;
    return props.visible ? React.createElement(nativeWeb.View, null, props.children) : null;
  },
};
function load(file) {
  const filename = ['.ts', '.tsx'].map((ext) => file + ext).find(fs.existsSync) ?? file;
  if (modules.has(filename)) return modules.get(filename).exports;
  const mod = new Module(filename, module);
  mod.filename = filename;
  modules.set(filename, mod);
  mod.require = (id) => {
    if (id === 'react') return reactAdapter;
    if (id === 'react-native') return nativeAdapters;
    if (id === '@/contexts/ThemeContext' || id === '@/src/theme/useThemeTokens') {
      return { useThemeMode: () => ({ tokens }), useThemeTokens: () => tokens };
    }
    if (id === '@/src/analytics/client') return { enqueueObservation(...args) {
      if (!allowObservations) throw new Error('Analytics forbidden in render checks');
      observations.push(args);
    } };
    if (id === '@/src/analytics/hooks') return { useQualifiedExposure: () => React.useRef(null) };
    if (id === './PlaceSourceVideoModal') return { PlaceSourceVideoModal: props => {
      if (captured) captured.modal = props;
      return React.createElement(nativeWeb.Text, null, 'Source viewer');
    } };
    if (id === '@react-navigation/native') return { useIsFocused: () => true, useFocusEffect() {} };
    if (id === 'react-native-safe-area-context') return { SafeAreaView: nativeAdapters.View };
    if (id === '@/components/YouTubeReelItem' || id === '@/components/InstagramReelItem') return { __esModule: true,
      default: props => {
        if (captured) captured.player = props;
        return React.createElement(nativeWeb.Text, null, props.video.url);
      } };
    if (id === 'expo-router') return { useFocusEffect() {} };
    // Native image/icon/animation adapters are not exercised by SSR. Geometry,
    // Text, ActionButton, card, list and presentation adapter are the real code.
    if (id === '@expo/vector-icons') return { Ionicons: () => null };
    if (id === 'expo-linear-gradient') return { LinearGradient: ({ children, style }) =>
      React.createElement(nativeWeb.View, { style }, children) };
    if (id === 'expo-image') return { Image: props => {
      if (captured?.images) captured.images.push(props);
      return React.createElement(nativeWeb.View, { style: props.style }, React.createElement('img', { src: props.source.uri, alt: props.accessibilityLabel }));
    } };
    if (id === '@/components/status/SkeletonBlock') return { SkeletonBlock: ({ width, height, radius, style }) =>
      React.createElement(nativeAdapters.View, { style: [{ width, height, borderRadius: radius, backgroundColor: tokens.color.surfaceSubtle }, style] }) };
    if (id.startsWith('@/')) return load(path.join(root, id.slice(2)));
    if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), id));
    return require(id);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText, filename);
  return mod.exports;
}

const { getThemeTokens } = load(path.join(root, 'src/theme/tokens'));
const { StashPlacesContent } = load(path.join(root, 'components/place/StashPlacesContent'));
const destination = { kind: 'google_search', query: 'fixture', url: 'https://example.invalid' };
const fixtures = [
  { kind: 'resolved', saveId: 'save-a', id: 'a', name: 'Potato Head Beach Club', category: 'Beach club',
    localityLabel: 'Seminyak', formattedAddress: null, image: { kind: 'source', url: 'https://fixture.invalid/video.jpg' },
    sourceVideo: { url: 'https://youtu.be/dQw4w9WgXcQ', thumbnailUrl: null }, destination },
  { kind: 'unresolved', saveId: 'save-b', id: 'b', name: 'Café de Flore', locationContext: 'Paris',
    uncertainty: 'ambiguous', image: null, sourceVideo: null, destination },
];
const originalFetch = global.fetch;
global.fetch = async () => { throw new Error('Network forbidden in Places render checks'); };
let checks = 0;
try {
  for (const theme of ['titanium', 'nebula']) {
    const base = getThemeTokens(theme);
    tokens = { ...base, fontSize: Object.fromEntries(Object.entries(base.fontSize).map(([k, v]) => [k, v * 2])),
      lineHeight: Object.fromEntries(Object.entries(base.lineHeight).map(([k, v]) => [k, v * 2])) };
    for (const state of ['idle', 'loading', 'empty', 'error', 'mixed', 'unverified', 'cached-error', 'refreshing']) {
      const items = ['idle', 'loading', 'empty', 'error'].includes(state) ? [] : state === 'unverified' ? [fixtures[1]] : fixtures;
      const html = renderToStaticMarkup(React.createElement(nativeWeb.View, { style: { width: 320, height: 844 } },
        React.createElement(StashPlacesContent, { items,
          status: state === 'idle' ? 'idle' : state === 'loading' ? 'loading' : state.includes('error') ? 'error' : 'ready',
          refreshing: state === 'refreshing', bottomInset: 80,
          onRefresh() {}, onRetry() {}, onSearch() { throw new Error('Navigation forbidden in render checks'); },
        })));
      assert.ok(html.includes('Your places'), `${theme}/${state}`);
      if (state === 'loading' || state === 'idle') {
        assert.ok(html.includes('Loading places')); assert.ok(html.includes('role="progressbar"'));
        assert.ok(!html.includes('No places yet'));
      }
      if (state === 'empty') { assert.ok(html.includes('No places yet')); assert.ok(!html.includes('Retry')); }
      if (state === 'error') {
        assert.ok(html.includes('Couldn’t load places')); assert.ok(html.includes('Retry')); assert.ok(!html.includes('No places yet'));
      }
      if (state === 'cached-error') {
        assert.ok(html.includes('Couldn’t refresh places')); assert.ok(html.includes('Potato Head Beach Club')); assert.ok(html.includes('Retry'));
      }
      if (state === 'mixed' || state === 'refreshing') {
        assert.ok(html.includes('2 places')); assert.ok(!html.includes('Unverified')); assert.ok(html.includes('Saved video preview'));
        assert.ok(html.includes('Source video, Potato Head Beach Club'));
        assert.ok(!html.includes('Source video unavailable') && !html.includes('No photo available') && !html.includes('Not confirmed yet'));
        assert.ok(html.includes('Recently stashed'));
      }
      if (state === 'unverified') {
        assert.ok(html.includes('1 place')); assert.ok(!html.includes('Unverified') && !html.includes('Location unclear'));
      }
      checks++;
    }
  }
  const { PlaceCard } = load(path.join(root, 'components/place/PlaceCard'));
  const { PlaceCardSkeleton } = load(path.join(root, 'components/place/PlaceCardSkeleton'));
  const { PRODUCT_CARD_LAYOUT } = load(path.join(root, 'src/ui/productCardLayout'));
  const { PublishSuccessScreen } = load(path.join(root, 'components/create/PublishSuccessScreen'));
  const { PublishConfirmSheet } = load(path.join(root, 'components/create/PublishConfirmSheet'));
  for (const theme of ['titanium', 'nebula']) {
    for (const scale of [1, 2]) {
      const base = getThemeTokens(theme);
      tokens = { ...base, fontSize: Object.fromEntries(Object.entries(base.fontSize).map(([k, v]) => [k, v * scale])),
        lineHeight: Object.fromEntries(Object.entries(base.lineHeight).map(([k, v]) => [k, v * scale])) };
      for (const width of [320, 430]) {
        const item = fixtures[0];
        const searched = [], opened = [];
        captured = { views: [], actions: [] };
        const html = renderToStaticMarkup(React.createElement(nativeWeb.View, { style: { width } },
          React.createElement(PlaceCard, { item, onSearch: (url) => searched.push(url), onOpenSource: (source) => opened.push(source) })));
        const styles = captured.views.map((p) => nativeWeb.StyleSheet.flatten(p.style) ?? {});
        assert.ok(styles.some((s) => s.aspectRatio === PRODUCT_CARD_LAYOUT.relatedMediaAspect));
        assert.ok(styles.some((s) => s.padding === PRODUCT_CARD_LAYOUT.relatedInset));
        const search = captured.actions.find((p) => p.accessibilityLabel === 'Search on Google, Potato Head Beach Club');
        const source = captured.actions.find((p) => p.accessibilityLabel === 'Source video, Potato Head Beach Club');
        assert.ok(search && source);
        assert.ok(!renderToStaticMarkup(React.createElement(React.Fragment, null, source.children)).includes('Source video'));
        assert.ok(nativeWeb.StyleSheet.flatten(source.style({ pressed: false })).minWidth >= 44);
        for (const action of [search, source]) {
          const style = nativeWeb.StyleSheet.flatten(action.style({ pressed: false }));
          assert.ok(style.minHeight >= 44); assert.equal(style.maxWidth, '100%');
        }
        assert.ok(html.includes('Seminyak') && html.includes('Saved video preview'));
        assert.equal(observations.length, 0, 'render does not send an event');
        allowObservations = true;
        search.onPress(); source.onPress();
        allowObservations = false;
        assert.deepEqual(searched, [destination.url]); assert.deepEqual(opened, [item.sourceVideo]);
        assert.deepEqual(observations.splice(0), [['place.outbound_requested', 'place', 'a', 'stash', { destination_kind: 'search' }]]);
        captured = { views: [], actions: [] };
        renderToStaticMarkup(React.createElement(PlaceCardSkeleton));
        assert.ok(captured.views.map((p) => nativeWeb.StyleSheet.flatten(p.style) ?? {})
          .some((s) => s.aspectRatio === PRODUCT_CARD_LAYOUT.relatedMediaAspect));
        captured = null;
        checks++;
      }
    }
    tokens = getThemeTokens(theme);
    for (const coverUrl of [null, 'https://fixture.invalid/cover.jpg']) {
      for (const canViewCollection of [true, false]) {
        captured = { views: [], actions: [] };
        const navigations = [];
        const html = renderToStaticMarkup(React.createElement(PublishSuccessScreen, { visible: true, coverUrl,
          title: 'Published fixture', productCountLabel: '1 product', canViewCollection,
          onViewFeed: () => navigations.push('feed'), onViewCollection: () => navigations.push('collection'),
          onCreateAnother: () => navigations.push('create') }));
        assert.ok(html.includes('Published fixture') && html.includes('1 product'));
        assert.equal(html.includes('https://fixture.invalid/cover.jpg'), Boolean(coverUrl));
        for (const action of captured.actions) action.onPress();
        assert.deepEqual(navigations, canViewCollection ? ['collection', 'feed', 'create'] : ['feed', 'create']);
        captured = null; checks++;
      }
    }
    for (const publishing of [false, true]) {
      captured = { views: [], actions: [] };
      const actions = [];
      const html = renderToStaticMarkup(React.createElement(PublishConfirmSheet, { visible: true,
        summary: { title: 'Fixture', thumbnailUrl: undefined, productCount: 2, previewLine: 'Preview' }, publishing,
        onConfirm: () => actions.push('confirm'), onCancel: () => actions.push('cancel') }));
      assert.ok(html.includes('2 products'));
      for (const action of captured.actions) action.onPress();
      assert.deepEqual(actions, publishing ? [] : ['confirm', 'cancel']);
      captured = null; checks++;
    }
  }
  // Exercise the real shelf state setters and rerender, without a browser/server.
  // Only root-owned state is controlled; all nested/native hooks remain real SSR.
  for (const theme of ['titanium', 'nebula']) {
    tokens = getThemeTokens(theme);
    dimensions = { width: 390, height: 844, scale: 1, fontScale: 1 };
    const items = [{ ...fixtures[0], category: 'Attraction', sourceVideos: [fixtures[0].sourceVideo,
      { url: 'https://www.instagram.com/reel/ABC_123/', thumbnailUrl: null }] },
      { ...fixtures[1], category: 'Cafe' }];
    const props = { items, status: 'ready', refreshing: false, bottomInset: 80,
      onRefresh() {}, onRetry() {}, onSearch() { throw new Error('Unexpected navigation'); } };
    controlled = { count: 4, values: new Map() };
    let html = renderControlled(StashPlacesContent, props);
    assert.ok(html.includes('Attractions, 1 place') && html.includes('Cafés, 1 place') && html.includes('Recently stashed'));
    captured.actions.find(p => p.accessibilityLabel === 'Attractions, 1 place').onPress();
    html = renderControlled(StashPlacesContent, props);
    assert.ok(html.includes('Back to all places') && html.includes('Potato Head Beach Club'));
    assert.ok(!html.includes('Café de Flore') && !html.includes('Recently stashed'));
    captured.actions.find(p => p.accessibilityLabel === 'Source video, Potato Head Beach Club').onPress();
    html = renderControlled(StashPlacesContent, props);
    assert.equal(captured.modal.sources.length, 2);
    captured.modal.onClose();
    renderControlled(StashPlacesContent, props);
    assert.equal(captured.modal, undefined, 'Close unmounts the source viewer');
    captured.actions.find(p => p.accessibilityLabel === 'Back to all places').onPress();
    html = renderControlled(StashPlacesContent, props);
    assert.ok(html.includes('Recently stashed') && html.includes('Cafés'));
    controlled = null; captured = null; checks++;

    // Initial image failure advances to an associated source poster, then a quiet placeholder.
    const fallbackItem = { ...fixtures[0], sourceVideo: { ...fixtures[0].sourceVideo, thumbnailUrl: 'https://fixture.invalid/alternate.jpg' } };
    controlled = { count: 2, values: new Map() }; // reduced-motion hook, then failed-image URLs
    renderControlled(PlaceCard, { item: fallbackItem, onSearch() {}, onOpenSource() {} });
    assert.equal(captured.images[0].source.uri, fallbackItem.image.url);
    assert.equal(captured.images[0].cachePolicy, 'memory-disk');
    captured.images[0].onError();
    renderControlled(PlaceCard, { item: fallbackItem, onSearch() {}, onOpenSource() {} });
    assert.equal(captured.images[0].source.uri, 'https://fixture.invalid/alternate.jpg');
    captured.images[0].onError();
    html = renderControlled(PlaceCard, { item: fallbackItem, onSearch() {}, onOpenSource() {} });
    assert.equal(captured.images.length, 0); assert.ok(!html.includes('No photo available'));
    controlled = null; captured = null; checks++;

    const { PlaceSourceVideoModal } = load(path.join(root, 'components/place/PlaceSourceVideoModal'));
    const source = fixtures[0].sourceVideo;
    const sources = [source, { url: 'https://www.instagram.com/reel/ABC_123/', thumbnailUrl: null }];
    controlled = { count: 5, values: new Map() };
    let closed = 0;
    const modalProps = { source, sources, onClose() { closed++; } };
    html = renderControlled(PlaceSourceVideoModal, modalProps);
    assert.ok(html.includes(source.url) && html.includes('Source video 2'));
    const staleReady = captured.player.onReady;
    captured.actions.find(p => p.accessibilityLabel === 'Source video 2').onPress();
    html = renderControlled(PlaceSourceVideoModal, modalProps);
    assert.ok(html.includes(sources[1].url) && !html.includes(source.url));
    staleReady();
    assert.equal(controlled.values.get(3), false, 'old player cannot mark the new source ready');
    captured.player.onLoadError();
    html = renderControlled(PlaceSourceVideoModal, modalProps);
    assert.ok(html.includes('Source video unavailable') && html.includes('Retry'));
    captured.actions.find(p => p.accessibilityLabel === 'Retry').onPress();
    html = renderControlled(PlaceSourceVideoModal, modalProps);
    assert.ok(html.includes(sources[1].url));
    captured.actions.find(p => p.accessibilityLabel === 'Close').onPress();
    captured.nativeModal.onRequestClose(); assert.equal(closed, 2);
    controlled = null; captured = null; checks++;
  }
  const { StashRecentProducts } = load(path.join(root, 'components/commerce/StashRecentProducts'));
  const { buildStashHome } = load(path.join(root, 'src/ui/bag'));
  for (const theme of ['titanium', 'nebula']) {
    for (const fontScale of [1, 2]) {
      const base = getThemeTokens(theme);
      tokens = { ...base, fontSize: Object.fromEntries(Object.entries(base.fontSize).map(([k, v]) => [k, v * fontScale])),
        lineHeight: Object.fromEntries(Object.entries(base.lineHeight).map(([k, v]) => [k, v * fontScale])) };
      dimensions = { width: 390, height: 844, scale: 1, fontScale };
      const products = Array.from({ length: 15 }, (_, index) => ({ cartItemId: String(index), title: `Product ${index}`,
        category: index < 5 ? 'Fashion' : 'Electronics', addedAt: new Date(Date.UTC(2026, 9, 30, 0, index)).toISOString(), imageUrl: null }));
      let grid;
      const props = { items: products, categories: buildStashHome(products).categories,
        renderGrid(items) { grid = items; return React.createElement(nativeWeb.Text, null, items.map(item => item.title).join('|')); } };
      controlled = { count: 1, values: new Map() };
      let html = renderControlled(StashRecentProducts, props);
      assert.equal(grid.length, 15); assert.equal(grid[0].cartItemId, '14');
      let all = captured.actions.find(action => action.accessibilityLabel === 'All');
      const unselected = captured.actions.find(action => action.accessibilityLabel === 'Fashion');
      const activeStyle = nativeWeb.StyleSheet.flatten(all.style({ pressed: false }));
      const inactiveStyle = nativeWeb.StyleSheet.flatten(unselected.style({ pressed: false }));
      assert.notEqual(activeStyle.backgroundColor, inactiveStyle.backgroundColor);
      assert.ok(activeStyle.minHeight >= 44); assert.equal(activeStyle.flexShrink, 0);
      assert.equal(activeStyle.borderRadius, tokens.radius.pill); assert.equal(activeStyle.borderWidth, tokens.stroke.thin);
      assert.ok(all.accessibilityState.selected); assert.ok(!unselected.accessibilityState.selected);
      const bar = captured.scrolls.find(scroll => scroll.accessibilityLabel === 'Filter recent products');
      assert.equal(bar.horizontal, true); assert.equal(bar.showsHorizontalScrollIndicator, false);
      assert.notEqual(nativeWeb.StyleSheet.flatten(bar.contentContainerStyle).flexWrap, 'wrap');
      unselected.onPress();
      html = renderControlled(StashRecentProducts, props);
      assert.deepEqual(grid.map(item => item.cartItemId), ['4', '3', '2', '1', '0']);
      assert.ok(captured.actions.find(action => action.accessibilityLabel === 'Fashion').accessibilityState.selected);
      captured.actions.find(action => action.accessibilityLabel === 'All').onPress();
      renderControlled(StashRecentProducts, props); assert.equal(grid.length, 15);
      controlled = null; captured = null; checks++;

      const places = Array.from({ length: 15 }, (_, index) => ({ ...fixtures[index < 5 ? 1 : 0], id: `place-${index}`, saveId: `save-${index}`,
        category: index < 5 ? 'Cafe' : 'Attraction', name: `Saved place ${index}`, addedAt: new Date(Date.UTC(2026, 9, 30, 0, index)).toISOString() }));
      const placeProps = { items: places, status: 'ready', refreshing: false, bottomInset: 80, onRefresh() {}, onRetry() {}, onSearch() {} };
      controlled = { count: 4, values: new Map() };
      html = renderControlled(StashPlacesContent, placeProps);
      let list = captured.lists[0];
      assert.equal(list.data.filter(row => row.kind === 'places').flatMap(row => row.items).length, 15);
      const collageKeys = list.data.filter(row => row.kind === 'categories').flatMap(row => row.items).map(item => item.key);
      captured.actions.find(action => action.accessibilityLabel === 'Cafés').onPress();
      html = renderControlled(StashPlacesContent, placeProps);
      list = captured.lists[0];
      assert.deepEqual(list.data.filter(row => row.kind === 'places').flatMap(row => row.items).map(item => item.id),
        ['place-4', 'place-3', 'place-2', 'place-1', 'place-0']);
      assert.deepEqual(list.data.filter(row => row.kind === 'categories').flatMap(row => row.items).map(item => item.key), collageKeys);
      assert.ok(!html.includes('Unverified') && !html.includes('Location unclear') && !html.includes('Needs location'));
      assert.ok(html.includes('Cafe'));
      assert.ok(captured.actions.find(action => action.accessibilityLabel === 'Cafés').accessibilityState.selected);
      captured.actions.find(action => action.accessibilityLabel === 'All').onPress();
      renderControlled(StashPlacesContent, placeProps);
      assert.equal(captured.lists[0].data.filter(row => row.kind === 'places').flatMap(row => row.items).length, 15);
      controlled = null; captured = null; checks++;
    }
  }
  const { CreateStudioStage } = load(path.join(root, 'components/create/CreateStudioStage'));
  const { ActionChoiceRow } = load(path.join(root, 'components/ui/ActionChoiceRow'));
  const { CollectionTile } = load(path.join(root, 'components/collection/CollectionTile'));
  const { ProfileIdentityHeader } = load(path.join(root, 'components/profile/ProfileIdentityHeader'));
  for (const theme of ['titanium', 'nebula']) {
    tokens = getThemeTokens(theme);
    for (const expanded of [false, true]) {
      const html = renderToStaticMarkup(React.createElement(CreateStudioStage, {
        step: 'video', active: 'video', expanded, locked: false, progress: {}, summary: 'Choose a video',
        subhead: 'Choose a video', onPressHeader() {},
      }, React.createElement(ActionChoiceRow, { appearance: 'studio', title: 'Find products with AI',
        body: 'Extract products from the selected video.', icon: 'sparkles-outline', onPress() {} })));
      assert.ok(html.includes('Choose a video'));
      assert.equal(html.includes('Find products with AI'), expanded);
      checks++;
    }
    const creator = { userId: 'u', username: 'creator', avatarUrl: null };
    const collection = { collectionId: 'c', title: 'Collection', creator: { id: 'u', username: 'creator' },
      heroThumbnailUrl: null, productCount: 1 };
    const fallback = renderToStaticMarkup(React.createElement(CollectionTile, { collection, variant: 'public', onPress() {} }));
    assert.ok(fallback.includes('Preview unavailable')); checks++;
    const profile = renderToStaticMarkup(React.createElement(ProfileIdentityHeader, { creator }));
    assert.ok(profile.includes('Default profile picture')); checks++;
    const photo = renderToStaticMarkup(React.createElement(ProfileIdentityHeader, {
      creator: { ...creator, avatarUrl: 'https://fixture.invalid/current.jpg' },
    }));
    assert.ok(photo.includes('https://fixture.invalid/current.jpg')); checks++;
  }
} finally { global.fetch = originalFetch; }
console.log(`${checks} Places/Create/profile render and interaction checks passed. SSR does not verify native image loading, gestures, or device layout.`);
