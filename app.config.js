const { existsSync, readFileSync } = require('node:fs');

/** Prepared internal QA profile only. No Firebase Auth, signing or identifier changes. */
module.exports = ({ config }) => {
  const versionCode = process.env.MYSTASH_ANDROID_VERSION_CODE;
  if (versionCode) {
    if (!/^\d+$/.test(versionCode) || Number(versionCode) < 1 || Number(versionCode) > 2100000000) {
      throw new Error('Android versionCode must be a positive integer within the Play limit.');
    }
    config = { ...config, android: { ...config.android, versionCode: Number(versionCode) } };
  }
  if (process.env.EAS_BUILD_PROFILE !== 'universal-find-qa') return config;
  const file = process.env.GOOGLE_SERVICES_JSON;
  // EAS secret file variables exist on the builder, not during every local CLI/config read.
  if (!file) {
    if (process.env.EAS_BUILD === 'true') throw new Error('Universal Find QA requires the approved Firebase client configuration.');
    return config;
  }
  if (!existsSync(file)) throw new Error('Universal Find QA Firebase client configuration is unavailable.');
  const google = JSON.parse(readFileSync(file, 'utf8'));
  const expectedProject = process.env.MYSTASH_QA_FIREBASE_PROJECT_ID;
  if (google.private_key || google.type === 'service_account' || !expectedProject
    || google.project_info?.project_id !== expectedProject
    || !google.client?.some(client => client.client_info?.android_client_info?.package_name === config.android?.package)) {
    throw new Error('Universal Find QA requires Firebase client configuration for the approved project and existing Android package.');
  }
  return { ...config, android: { ...config.android, googleServicesFile: file } };
};
