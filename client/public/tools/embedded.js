/* The workspace owns navigation. Authentication stays inside Firebase's
   existing same-origin persistence; no credentials are passed through messages. */
(function () {
  'use strict';
  var contextNode = document.getElementById('itrc-workspace-context');
  if (!contextNode) return;
  var context;
  try { context = JSON.parse(contextNode.textContent); } catch (_error) { return; }
  var embedded = window.parent !== window;
  if (!embedded) {
    window.location.replace(context.workspacePath || '/ops');
    return;
  }
  document.documentElement.classList.add('itrc-embedded');
  function routeFor(anchor) {
    var url;
    try { url = new URL(anchor.getAttribute('href'), window.location.href); } catch (_error) { return null; }
    if (url.origin !== window.location.origin && url.origin !== 'https://itrc-tools.vercel.app') return null;
    if (url.pathname === '/ops') {
      var toolId = url.searchParams.get('tool');
      if (toolId && context.routes[toolId + '.html']) return context.routes[toolId + '.html'];
      if (url.searchParams.get('view') === 'tasks') return { path: '/ops?view=tasks' + (url.searchParams.get('source') === 'legacy' ? '&source=legacy' : ''), view: 'tasks' };
      return { path: '/ops', view: 'overview' };
    }
    var name;
    try { name = decodeURIComponent(url.pathname.split('/').pop() || ''); } catch (_error) { return null; }
    return context.routes[name] || null;
  }
  function normalizeLinks() {
    document.querySelectorAll('a[href]').forEach(function (anchor) {
      var href = anchor.getAttribute('href');
      if (!href || href.charAt(0) === '#' || anchor.hasAttribute('download')) return;
      var route = routeFor(anchor);
      if (!route) return;
      anchor.setAttribute('href', route.path);
      anchor.setAttribute('target', '_top');
    });
  }
  function mount() {
    normalizeLinks();
    // sitebar is also hidden by CSS; remove the redundant navigation once it
    // has been created, leaving the original tool's controls and status intact.
    document.querySelectorAll('.sitebar').forEach(function (node) { node.remove(); });
    document.addEventListener('click', function (event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var anchor = event.target.closest && event.target.closest('a[href]');
      if (!anchor || anchor.hasAttribute('download')) return;
      var href = anchor.getAttribute('href');
      if (!href || href.charAt(0) === '#') return;
      var route = routeFor(anchor);
      if (!route) return;
      event.preventDefault();
      var view = route.path.indexOf('/ops?view=tasks') === 0 ? 'tasks' : route.path === '/ops' ? 'overview' : null;
      var source = route.path === '/ops?view=tasks&source=legacy' ? 'legacy' : null;
      window.parent.postMessage({ type: 'itrc-workspace:navigate', toolId: route.toolId || null, view: view, source: source }, window.location.origin);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
