/* Shared cloud-session guard for lecturer, sponsorship and certificate tools.
   No database reads happen until Google login and the existing role lookup finish. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ITRCCloud = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  function create(options, dependencies) {
    var deps = dependencies || {}, win = deps.window || window;
    var auth = deps.auth || win.ITRCAuth, doc = deps.document || win.document;
    var state = 'loading', user = null, refs = [], connected = false, settingUp = false;
    var generation = 0, pendingWrites = 0, failedWrites = [], authButton = null, statusText = null;
    function status(message) {
      if (statusText) statusText.textContent = message;
      if (options.status) options.status(message);
    }
    function refresh() {
      if (state === 'local') return status('● 本機測試，資料只留在這台瀏覽器');
      if (!user || !user.role) return;
      if (!connected) return status(pendingWrites ? '● 雲端離線，儲存結果尚待確認' : '● 雲端離線，已暫停儲存');
      if (settingUp || !refs.length || refs.some(function (item) { return !item.loaded; })) {
        state = 'loading'; return status('● 正在讀取共用資料，請稍候再編輯');
      }
      state = 'ready';
      status(pendingWrites ? '● 儲存中，等待雲端確認…' :
        failedWrites.length ? '● 有變更尚未儲存；請核對權限與連線後重試' : '● 共用資料已載入');
    }
    function disconnect() {
      refs.forEach(function (item) { item.ref.off('value', item.callback); });
      refs = [];
      if (api.connectionRef) { api.connectionRef.off('value', api.connectionCallback); api.connectionRef = null; }
      connected = false;
    }
    function unavailable(message) {
      generation += 1; pendingWrites = 0; failedWrites = []; disconnect(); state = 'blocked';
      if (options.onUnavailable) options.onUnavailable();
      status(message);
    }
    function watch(path, onValue) {
      if (!user || !user.role || !auth.db || (state !== 'loading' && state !== 'ready')) throw new Error('登入尚未確認');
      var version = generation, ref = auth.db.ref(path);
      var item = { ref: ref, loaded: false, callback: null };
      item.callback = function (snapshot) {
        if (version !== generation) return;
        try { onValue(snapshot); item.loaded = true; refresh(); }
        catch (_error) { unavailable('● 資料讀取失敗，未連接共用資料；請重新整理後確認'); }
      };
      refs.push(item);
      ref.on('value', item.callback, function () {
        if (version === generation) unavailable('● 雲端讀取被拒絕或連線失敗；未切換成本機儲存');
      });
      return ref;
    }
    function write(ref, value) {
      if (state !== 'ready' || !connected || !user || !user.role || !refs.some(function (item) { return item.ref === ref; })) {
        status('● 尚未儲存：請先登入並等候共用資料載入');
        return Promise.resolve(false);
      }
      var version = generation;
      pendingWrites += 1; status('● 儲存中，等待雲端確認…');
      return Promise.resolve().then(function () {
        if (version !== generation || state !== 'ready' || !connected) throw new Error('登入或連線狀態已變更');
        return ref.set(value);
      }).then(function () {
        if (version !== generation) return false;
        pendingWrites -= 1;
        failedWrites = failedWrites.filter(function (failedRef) { return failedRef !== ref; });
        status(pendingWrites ? '● 儲存中，等待雲端確認…' :
          failedWrites.length ? '● 有變更尚未儲存；請核對權限與連線後重試' : '● 雲端已儲存');
        return true;
      }, function () {
        if (version !== generation) return false;
        pendingWrites -= 1;
        if (failedWrites.indexOf(ref) < 0) failedWrites.push(ref);
        status('● 儲存失敗，變更尚未確認；請核對權限與連線後重試');
        return false;
      });
    }
    function mount() {
      if (!doc || !doc.body) return;
      var bar = doc.createElement('div');
      bar.id = 'itrcCloudSession';
      bar.style.cssText = 'display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 18px;background:#fff4d9;color:#26303f;font:14px system-ui;border-bottom:1px solid #d7bd75';
      statusText = doc.createElement('span'); statusText.setAttribute('role', 'status'); statusText.setAttribute('aria-live', 'polite');
      authButton = doc.createElement('button'); authButton.type = 'button'; authButton.textContent = 'Google 登入';
      authButton.style.cssText = 'padding:6px 12px;cursor:pointer';
      authButton.onclick = function () {
        if (!auth) return status('● 登入元件未載入，請重新整理');
        if (user) auth.signOut();
        else {
          status('● 請完成 Google 登入，載入共用資料後再編輯');
          Promise.resolve(auth.signIn()).then(function (result) {
            if (!result && !user) status('● 登入未完成，尚未連接共用資料');
          }, function () { status('● 登入失敗，尚未連接共用資料'); });
        }
      };
      bar.appendChild(statusText); bar.appendChild(authButton); doc.body.insertBefore(bar, doc.body.firstChild);
    }
    var api = { watch: watch, write: write, isLocal: function () { return state === 'local'; },
      isReady: function () { return state === 'ready' && connected; }, status: status, connectionRef: null, connectionCallback: null };
    mount(); status('● 正在確認 Google 登入，請稍候再編輯');
    if (!auth) { unavailable('● 登入元件未載入，無法連接共用資料'); return api; }
    try {
      auth.init({ onChange: function (nextUser) {
        generation += 1; pendingWrites = 0; failedWrites = []; disconnect(); user = nextUser;
        if (authButton) authButton.textContent = user ? '登出' : 'Google 登入';
        if (auth.mode === 'unavailable') { unavailable('● Firebase 登入元件未載入，無法連接共用資料'); return; }
        if (auth.isDev()) {
          var location = win.location || {};
          if (!['localhost', '127.0.0.1', '::1'].includes(location.hostname) && location.protocol !== 'file:') {
            unavailable('● Firebase 登入元件未載入，無法連接共用資料'); return;
          }
          state = 'local'; if (options.onLocal) options.onLocal(); refresh(); return;
        }
        if (!user) { unavailable('● 請先 Google 登入；目前未連接共用資料'); return; }
        if (!user.role) { unavailable('● 此帳號未授權或角色讀取失敗；請洽名單管理者'); return; }
        state = 'loading'; settingUp = true;
        try {
          var version = generation;
          api.connectionRef = auth.db.ref('.info/connected');
          api.connectionCallback = function (snapshot) {
            if (version !== generation) return;
            connected = snapshot.val() === true; refresh();
          };
          api.connectionRef.on('value', api.connectionCallback);
          options.onCloudReady(api);
          settingUp = false; refresh();
        } catch (_error) { settingUp = false; unavailable('● 雲端初始化失敗；未連接共用資料'); }
      } });
    } catch (_error) { unavailable('● 登入或 Firebase 元件無法啟動，請重新整理'); }
    return api;
  }
  return { create: create };
});
