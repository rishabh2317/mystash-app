const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
/** Build-time resource export from the actual TS tokens; no second palette. */
module.exports = function shareTheme(root) {
  const cache = {};
  function load(relative) {
    if (cache[relative]) return cache[relative];
    const exports = {};
    const code = babel.transformSync(fs.readFileSync(path.join(root, relative), 'utf8'), {
      filename: relative, configFile: false, babelrc: false,
      presets: [require.resolve('@babel/preset-typescript')],
      plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
    }).code;
    vm.runInNewContext(code, { exports, require(id) {
      if (id === '@/src/theme/appFont') return load('src/theme/appFont.ts');
      throw new Error('Unexpected native theme dependency');
    } });
    cache[relative] = exports;
    return exports;
  }
  const { DEFAULT_THEME_MODE, getThemeTokens } = load('src/theme/tokens.ts');
  const glyphs = require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json');
  const modes = Object.fromEntries(['titanium', 'nebula'].map(mode => {
    const t = getThemeTokens(mode);
    return [mode, { color: t.color, space: t.space, fontSize: t.fontSize, lineHeight: t.lineHeight, radius: t.radius, stroke: t.stroke,
      minimumHitTarget: load('src/ui/feedA11y.ts').FEED_MIN_HIT_TARGET }];
  }));
  return { defaultMode: DEFAULT_THEME_MODE,
    icons: Object.fromEntries(['layers-outline', 'cube-outline', 'location-outline', 'information-circle-outline'].map(name => [name, glyphs[name]])),
    ...modes };
};
