import { readFileSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { CLUB_TOOLS, legacyToolRoutes } from '../client/src/ops/club-tools-catalog.js';

const SHARED_ASSETS = ['itrc.css', 'itrc.js', 'itrc-auth.js', 'itrc-cloud.js', 'itrc-finance.js', 'itrc-roster.js'];
const MIME = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' };

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function redirectPage(path) {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${escapeHtml(path)}"><title>ITRC 社務工作台</title></head><body><a href="${escapeHtml(path)}" target="_top">前往社務工作台</a></body></html>`;
}

function disabledPage(tool) {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(tool.title)}｜預覽模式</title><style>body{font:15px/1.8 system-ui,sans-serif;background:#f4f3ef;color:#343d43;padding:32px}main{max-width:600px;margin:auto;background:white;border:1px solid #dfe5e5;border-radius:12px;padding:24px}a{color:#416e8f}</style></head><body><main><h1>${escapeHtml(tool.title)}</h1><p>預覽模式不連接正式工具資料。</p><p>請在正式工作台使用財務、幹部權限與其他共用工具。</p><a href="/ops" target="_top">回到工作台</a></main></body></html>`;
}

function embedPage(html, tool) {
  const context = JSON.stringify({ toolId: tool.id, workspacePath: tool.workspacePath, routes: legacyToolRoutes() }).replace(/</g, '\\u003c');
  const bridge = `<script type="application/json" id="itrc-workspace-context">${context}</script><script src="/tools/embedded.js"></script>`;
  return html.replace(/<head>/i, `<head>\n${bridge}`)
    .replace(/<\/head>/i, '<link rel="stylesheet" href="/tools/embedded.css">\n</head>');
}

// Render the tracked source at build time. Do not keep a second editable copy
// of the financial or Firebase code inside client/public.
export function createLegacyToolAssets(sourceDirectory, mode = 'production') {
  const expected = new Set(['index.html', ...CLUB_TOOLS.map(tool => tool.file)]);
  const actual = readdirSync(sourceDirectory).filter(name => name.endsWith('.html'));
  if (actual.length !== expected.size || actual.some(name => !expected.has(name))) {
    throw new Error('Legacy tool catalog must cover every HTML page before publishing.');
  }
  const assets = new Map();
  assets.set('tools/index.html', redirectPage('/ops'));
  for (const tool of CLUB_TOOLS) {
    const source = readFileSync(resolve(sourceDirectory, tool.file), 'utf8');
    assets.set(`tools/${tool.id}.html`, mode === 'preview' ? disabledPage(tool) : embedPage(source, tool));
    assets.set(`tools/${tool.file}`, redirectPage(tool.workspacePath));
  }
  if (mode !== 'preview') {
    for (const filename of SHARED_ASSETS) assets.set(`tools/${filename}`, readFileSync(resolve(sourceDirectory, filename), 'utf8'));
  }
  return assets;
}

export function legacyToolsPlugin({ repositoryRoot, mode = process.env.VERCEL_ENV || 'development' }) {
  const sourceDirectory = resolve(repositoryRoot, 'legacy-tools');
  const prefix = 'tools/';
  return {
    name: 'itrc-workspace-tools',
    config() {
      return { define: { 'import.meta.env.VITE_CLUB_TOOLS_MODE': JSON.stringify(mode === 'preview' ? 'preview' : 'live') } };
    },
    buildStart() {
      for (const tool of CLUB_TOOLS) this.addWatchFile(resolve(sourceDirectory, tool.file));
      for (const filename of SHARED_ASSETS) this.addWatchFile(resolve(sourceDirectory, filename));
    },
    generateBundle() {
      for (const [fileName, source] of createLegacyToolAssets(sourceDirectory, mode)) this.emitFile({ type: 'asset', fileName, source });
    },
    configureServer(server) {
      const changed = filename => { if (filename.startsWith(`${sourceDirectory}${sep}`)) server.ws.send({ type: 'full-reload' }); };
      server.watcher.add(sourceDirectory);
      server.watcher.on('change', changed);
      server.httpServer?.once('close', () => server.watcher.off('change', changed));
      server.middlewares.use((req, res, next) => {
        let pathname;
        try { pathname = decodeURIComponent(new URL(req.url, 'http://local.invalid').pathname).replace(/^\//, ''); }
        catch { res.statusCode = 400; res.end('Bad path'); return; }
        if (!pathname.startsWith(prefix) || ['tools/embedded.js', 'tools/embedded.css'].includes(pathname)) return next();
        if (!['GET', 'HEAD'].includes(req.method)) { res.statusCode = 405; res.end(); return; }
        const assets = createLegacyToolAssets(sourceDirectory, mode);
        if (!assets.has(pathname)) { res.statusCode = 404; res.end('Tool not found'); return; }
        res.setHeader('Content-Type', MIME[pathname.split('.').pop()] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.end(req.method === 'HEAD' ? undefined : assets.get(pathname));
      });
    },
  };
}

export function oldToolsRedirects(origin = 'https://nsysu-itrc.vercel.app') {
  return [{ source: '/', destination: `${origin}/ops`, permanent: false },
    { source: '/index.html', destination: `${origin}/ops`, permanent: false },
    ...CLUB_TOOLS.map(tool => ({ source: `/${tool.file}`, destination: `${origin}${tool.workspacePath}`, permanent: false }))];
}

export function mainToolsRedirects() {
  return [{ source: '/tools/index.html', destination: '/ops', permanent: false },
    ...CLUB_TOOLS.flatMap(tool => [
      { source: `/${tool.file}`, destination: tool.workspacePath, permanent: false },
      { source: `/tools/${tool.file}`, destination: tool.workspacePath, permanent: false },
    ])];
}
