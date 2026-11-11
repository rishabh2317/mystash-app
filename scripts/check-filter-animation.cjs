/* Runs component effects against React Native's actual Animated graph classes.
 * Native bridge calls are stubbed; this checks driver ownership, not device pixels. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const babel = require('@babel/core');
const ts = require('typescript');
const web = require('react-native-web');
global.__DEV__ = false;
const root = path.dirname(require.resolve('../package.json'));
const rn = path.join(root, 'node_modules/react-native');
const cache = new Map();
let tag = 0;
const helper = {
  assertNativeAnimatedModule() {},
  API: new Proxy({}, { get: () => () => {} }),
  shouldUseNativeDriver: config => config.useNativeDriver,
  generateNewNodeTag: () => ++tag,
  generateNewAnimationId: () => ++tag,
  nativeEventEmitter: { addListener: () => ({ remove() {} }) },
};
function loadNative(file) {
  if (!path.extname(file)) file += '.js';
  if (cache.has(file)) return cache.get(file).exports;
  const mod = new Module(file, module);
  cache.set(file, mod);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.dirname(file));
  mod.require = id => {
    if (id.includes('NativeAnimatedHelper')) return { __esModule: true, default: helper };
    if (id.includes('RendererProxy')) return { findNodeHandle: () => 1 };
    if (id.includes('ReactNativeFeatureFlags')) return new Proxy({}, { get: () => () => false });
    if (id.endsWith('/Platform')) return { __esModule: true, default: { OS: 'android' } };
    if (id.endsWith('/InteractionManager')) return { __esModule: true, default: {
      createInteractionHandle: () => 1, clearInteractionHandle() {},
    } };
    const resolved = Module._resolveFilename(id, mod);
    return resolved.startsWith(rn) ? loadNative(resolved) : require(resolved);
  };
  const code = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file, babelrc: false, configFile: false,
    presets: [require.resolve('@react-native/babel-preset')],
  }).code;
  mod._compile(code, file);
  return mod.exports;
}
const AnimatedValue = loadNative(path.join(rn, 'Libraries/Animated/nodes/AnimatedValue')).default;
const AnimatedProps = loadNative(path.join(rn, 'Libraries/Animated/nodes/AnimatedProps')).default;
const Animation = loadNative(path.join(rn, 'Libraries/Animated/animations/Animation')).default;

// Prove this harness rejects the original driver collision using RN's own guard.
const native = new AnimatedValue(0), js = new AnimatedValue(0);
const broken = new AnimatedProps({ style: { opacity: native, shadowOpacity: js } }, () => {});
broken.__attach(); native.__makeNative();
assert.throws(() => new Animation({ useNativeDriver: false }).start(0, () => {}, null, null, js),
  /Attempting to run JS driven animation/);
broken.__detach();

let effects, refs, refIndex, states, stateIndex, reducedMotion, tokens, renderedGradients;
const AnimatedView = 'AnimatedView';
const animations = [];
const react = { ...React,
  useEffect: effect => effects.push(effect),
  useRef: initial => refs[refIndex++] ??= { current: initial },
  useState: initial => {
    const index = stateIndex++;
    states[index] ??= initial;
    return [states[index], value => { states[index] = value; }];
  },
};
const animated = { View: AnimatedView, Value: AnimatedValue,
  loop(animation) { return { start: () => animation.start(), stop() {} }; },
  timing(value, config) { return { start() {
    animations.push(config.useNativeDriver);
    if (config.useNativeDriver) value.__makeNative();
    else new Animation(config).start(0, () => {}, null, null, value);
  } }; },
};
function loadComponent(file) {
  const mod = new Module(file, module);
  mod.require = id => {
    if (id === 'react') return react;
    if (id === 'react-native') return { Animated: animated, Easing: { out: x => x, cubic: x => x, inOut: x => x, quad: x => x }, Pressable: 'Pressable', View: 'View', StyleSheet: web.StyleSheet };
    if (id === 'expo-linear-gradient') return { LinearGradient: 'LinearGradient' };
    if (id === '@/contexts/ThemeContext') return { useThemeMode: () => ({ tokens }) };
    if (id === '@/src/ui/usePrefersReducedMotion') return { usePrefersReducedMotion: () => reducedMotion };
    if (id === '@/src/theme/tokens') return theme;
    if (id.startsWith('@/')) {
      const source = path.join(root, id.slice(2));
      return loadComponent(['.ts', '.tsx'].map(ext => source + ext).find(fs.existsSync) ?? source);
    }
    return require(id);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, file);
  return mod.exports;
}
const theme = loadComponent(path.join(root, 'src/theme/tokens.ts'));
const { TactileFilterChip } = loadComponent(process.argv[2] ?? path.join(root, 'components/ui/TactileFilterChip.tsx'));
function render(selected, disabled = false) {
  effects = []; refIndex = 0; stateIndex = 0; renderedGradients = [];
  const tree = TactileFilterChip({ selected, disabled, onPress() {}, children: 'Processing' });
  const graphs = []; let button;
  function visit(node) {
    if (!React.isValidElement(node)) return;
    if (node.type === AnimatedView) {
      const graph = new AnimatedProps({ ...node.props, style: web.StyleSheet.flatten(node.props.style) }, () => {});
      graph.__attach(); graphs.push(graph);
    }
    if (node.type === 'Pressable') button = node.props;
    if (node.type === 'LinearGradient') renderedGradients.push(node.props.colors);
    React.Children.forEach(node.props.children, visit);
  }
  visit(tree);
  for (const effect of effects) effect();
  for (const graph of graphs) graph.__detach();
  return button;
}
let checks = 0;
for (const mode of ['titanium', 'nebula']) for (const reduce of [false, true]) {
  tokens = theme.getThemeTokens(mode); reducedMotion = reduce;
  refs = []; states = []; animations.length = 0;
  let button = render(false);
  assert.deepEqual(renderedGradients, [theme.FILTER_CHIP_DEPTH[mode].raisedRim, theme.FILTER_CHIP_DEPTH[mode].raisedBlend, theme.FILTER_CHIP_DEPTH[mode].raisedFace]);
  button.onPressIn(); button = render(false);
  assert.deepEqual(renderedGradients, [theme.FILTER_CHIP_DEPTH[mode].pressedRim, theme.FILTER_CHIP_DEPTH[mode].pressedBlend, theme.FILTER_CHIP_DEPTH[mode].pressedFace]);
  button.onPressOut(); render(false);
  button = render(true);
  assert.equal(button.accessibilityState.selected, true);
  assert.deepEqual(renderedGradients, [theme.FILTER_CHIP_DEPTH[mode].pressedRim, theme.FILTER_CHIP_DEPTH[mode].pressedBlend, theme.FILTER_CHIP_DEPTH[mode].pressedFace]);
  render(false); // selection can move between siblings without native ownership leakage
  assert.equal(render(false, true).disabled, true);
  if (reduce) assert.equal(animations.length, 0);
  else assert.deepEqual(animations.slice(0, 2), [true, false]);
  checks += 6;
}
const { FindStatusProgress } = loadComponent(path.join(root, 'components/find/FindStatusProgress.tsx'));
for (const reduce of [false, true]) {
  refs = []; states = []; reducedMotion = reduce; animations.length = 0;
  let cleanup;
  for (const active of [true, false, true]) {
    if (cleanup) cleanup();
    effects = []; refIndex = 0; stateIndex = 0; states[0] = 240;
    const tree = FindStatusProgress({ color: tokens.color.success, active, label: 'Finding products' });
    assert.equal(tree.props.accessibilityRole, active ? 'progressbar' : undefined);
    const graph = new AnimatedProps(tree.props.children.props, () => {}); graph.__attach();
    const before = animations.length;
    cleanup = effects[0]();
    assert.equal(animations.length - before, active && !reduce ? 1 : 0);
    assert.ok(animations.every(Boolean), 'progress owns only a native transform graph');
    graph.__detach(); checks++;
  }
  if (cleanup) cleanup();
}
console.log(`${checks} filter/progress mount, transition and reduced-motion checks passed using React Native Animated graph classes.`);
