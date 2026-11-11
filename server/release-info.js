'use strict';

// Public code provenance only. Never include a deployment's environment values.
function releaseInfo(env = process.env) {
  const revision = /^[0-9a-f]{40}$/i.test(env.VERCEL_GIT_COMMIT_SHA || '') ? env.VERCEL_GIT_COMMIT_SHA : null;
  return { component: 'itrc-api', release: 'ops-completion-20261111', revision };
}

module.exports = { releaseInfo };
