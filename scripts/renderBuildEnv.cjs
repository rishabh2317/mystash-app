// Scope this override to the render-test Babel configuration. Shared EAS preview
// variables and developers' local .env files must continue to use their own API.
module.exports = function renderBuildEnv({ types: t }) {
  return {
    name: 'mystash-render-build-endpoint',
    visitor: {
      MemberExpression(path, state) {
        if (!path.matchesPattern('process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL')) return;
        if (path.parentPath.isAssignmentExpression({ left: path.node })) return;
        const url = new URL(state.opts.backendUrl);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
          throw path.buildCodeFrameError('Render build requires a public HTTPS backend URL');
        }
        path.replaceWith(t.stringLiteral(state.opts.backendUrl));
      },
    },
  };
};
