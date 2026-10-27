/** Both sides default off. No environment files are changed by this implementation. */
export function analyticsEnabled(): boolean { return process.env.ANALYTICS_ENABLED === 'true'; }
