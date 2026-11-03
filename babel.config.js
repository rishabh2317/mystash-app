module.exports = function(api) {
  const buildProfile = api.cache.using(() => process.env.EAS_BUILD_PROFILE || '');
  return {
    presets: ['expo'],
    plugins: ['render-test', 'android-share-validation'].includes(buildProfile)
      ? [[require('./scripts/renderBuildEnv.cjs'), {
          backendUrl: require('./eas.json').build['render-test'].env.EXPO_PUBLIC_MYSTASH_INGEST_URL,
        }]]
      : [],
  };
};
