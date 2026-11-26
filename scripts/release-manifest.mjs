import { execFileSync } from 'node:child_process';

// The frontend and API deploy separately. This artifact makes the actual public
// frontend revision observable without treating a successful build as promotion.
export function releaseManifestPlugin({ repositoryRoot, env = process.env }) {
  let revision = env.VERCEL_GIT_COMMIT_SHA || '';
  let provenance = revision ? 'vercel-git' : 'unknown';
  if (!revision) {
    try {
      const options = { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
      const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], options).trim();
      provenance = dirty ? 'uncommitted-worktree' : 'git';
      if (!dirty) revision = execFileSync('git', ['rev-parse', 'HEAD'], options).trim();
    }
    catch { /* A source export may have no Git metadata. Report unknown. */ }
  }
  if (!/^[0-9a-f]{40}$/i.test(revision)) revision = null;
  const manifest = { component: 'itrc-workspace', release: 'ops-completion-20261111', revision, provenance };
  return {
    name: 'itrc-release-manifest',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'release.json', source: JSON.stringify(manifest, null, 2) + '\n' });
    },
  };
}
