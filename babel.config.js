module.exports = function(api) {
  const buildProfile = api.cache.using(() => process.env.EAS_BUILD_PROFILE || '');
  const qaBackend = api.cache.using(() => process.env.MYSTASH_QA_BACKEND || 'render');
  if (buildProfile === 'universal-find-qa-core' && !['render', 'mac'].includes(qaBackend)) {
    throw new Error('Unknown QA backend selection');
  }
  const backendUrl = buildProfile === 'universal-find-qa-core' && qaBackend === 'mac'
    ? 'https://api-dev.mystash.in'
    : require('./eas.json').build['render-test'].env.EXPO_PUBLIC_MYSTASH_INGEST_URL;
  return {
    presets: ['expo'],
    plugins: ['render-test', 'android-share-validation', 'universal-find-qa', 'universal-find-qa-core'].includes(buildProfile)
      ? [[require('./scripts/renderBuildEnv.cjs'), {
          backendUrl,
        }]]
      : [],
  };
};
