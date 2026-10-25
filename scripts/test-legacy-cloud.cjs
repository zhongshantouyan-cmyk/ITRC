// Fictional Firebase/DOM stubs only: never initializes Firebase or performs network IO.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cloud = require('../legacy-tools/itrc-cloud.js');
const root = path.resolve(__dirname, '../legacy-tools');

function element() {
  return { value: '', textContent: '', innerHTML: '', style: {}, dataset: {}, children: [], options: [],
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, getAttribute() { return ''; }, addEventListener() {},
    appendChild(child) { this.children.push(child); }, insertBefore() {}, add() {},
    remove() {}, focus() {}, select() {}, click() {}, scrollIntoView() {},
    querySelectorAll() { return []; }, querySelector() { return null; } };
}
function documentStub() {
  const nodes = new Map();
  return { body: element(), head: element(), readyState: 'complete',
    createElement: element, addEventListener() {}, removeEventListener() {},
    querySelectorAll() { return []; }, querySelector() { return null; },
    getElementById(id) {
      if (!nodes.has(id)) { const e = element(); if (id === 'ctype') e.value = 'member'; nodes.set(id, e); }
      return nodes.get(id);
    } };
}
function fixture(options = {}) {
  const refs = new Map(), created = [], messages = [], writes = [];
  const db = { ref(p) {
    created.push(p);
    if (!refs.has(p)) refs.set(p, { path: p, listeners: [], reject: false,
      on(_event, callback, error) { this.listeners.push({ callback, error }); },
      off(_event, callback) { this.listeners = this.listeners.filter(x => x.callback !== callback); },
      set(value) { writes.push({ path: p, value }); return this.pending || (this.reject ? Promise.reject(new Error('PERMISSION_DENIED')) : Promise.resolve()); },
      emit(value) { for (const item of [...this.listeners]) item.callback({ val: () => value }); },
      deny() { for (const item of [...this.listeners]) item.error?.(new Error('PERMISSION_DENIED')); },
    });
    return refs.get(p);
  } };
  const doc = documentStub();
  const auth = { mode: 'prod', db, init(opts) { this.callback = opts.onChange; },
    signIn() { return Promise.resolve(null); }, signOut() { this.emit(null); return Promise.resolve(); },
    isDev() { return options.dev || false; }, emit(user) { this.callback(user); } };
  const win = { ITRCAuth: auth, document: doc, location: { hostname: options.local ? 'localhost' : 'tools.example.invalid', protocol: 'https:' } };
  let reference, unavailable = 0, local = 0;
  const api = cloud.create({ status: message => messages.push(message),
    onUnavailable() { unavailable++; }, onLocal() { local++; },
    onCloudReady(api) { reference = api.watch('example/data', () => {}); },
  }, { window: win, auth, document: doc });
  function allow() { auth.emit({ role: 'officer', email: 'officer@example.invalid' }); }
  function ready() { allow(); refs.get('.info/connected').emit(true); refs.get('example/data').emit({ id: 'fictional' }); }
  return { api, auth, win, doc, refs, created, messages, writes, allow, ready,
    get ref() { return reference; }, get unavailable() { return unavailable; }, get local() { return local; } };
}

test('no cloud reads or writes until Google auth and allowed role resolve', async () => {
  const f = fixture();
  assert.deepEqual(f.created, []);
  assert.equal(await f.api.write(null, { fictional: true }), false);
  f.auth.emit(null); assert.deepEqual(f.created, []);
  f.auth.emit({ role: null, email: 'outsider@example.invalid' });
  assert.deepEqual(f.created, []); assert.equal(f.writes.length, 0);
  assert.match(f.messages.at(-1), /未授權/);
});

test('allowed account must wait for cloud connection and first complete data snapshot', async () => {
  const f = fixture(); f.allow();
  assert.deepEqual(f.created, ['.info/connected', 'example/data']);
  assert.equal(await f.api.write(f.ref, {}), false);
  f.refs.get('.info/connected').emit(true);
  assert.equal(await f.api.write(f.ref, {}), false);
  f.ref.emit({ fictional: true });
  assert.equal(f.api.isReady(), true);
  assert.equal(await f.api.write(f.ref, { fictional: 'saved' }), true);
  assert.deepEqual(f.writes, [{ path: 'example/data', value: { fictional: 'saved' } }]);
  assert.match(f.messages.at(-1), /雲端已儲存/);
});

test('read denied clears listeners and never falls back to local business writes', async () => {
  const f = fixture(); f.allow(); f.ref.deny();
  assert.equal(f.api.isReady(), false); assert.equal(f.api.isLocal(), false);
  assert.equal(f.ref.listeners.length, 0); assert.equal(f.unavailable, 1);
  assert.match(f.messages.at(-1), /讀取被拒絕/);
  assert.equal(await f.api.write(f.ref, {}), false); assert.equal(f.writes.length, 0);
});

test('rejected writes stay visibly unsaved through value/connection events until successful retry', async () => {
  const f = fixture(); f.ready(); f.ref.reject = true;
  assert.equal(await f.api.write(f.ref, { fictional: 'reject' }), false);
  assert.match(f.messages.at(-1), /儲存失敗/);
  f.ref.emit({ fictional: 'original' });
  assert.match(f.messages.at(-1), /尚未儲存/);
  f.refs.get('.info/connected').emit(false);
  assert.equal(await f.api.write(f.ref, {}), false);
  f.refs.get('.info/connected').emit(true);
  assert.match(f.messages.at(-1), /尚未儲存/);
  f.ref.reject = false;
  assert.equal(await f.api.write(f.ref, { fictional: 'retry' }), true);
  assert.match(f.messages.at(-1), /雲端已儲存/);
});

test('sign-out detaches data and invalidates late write acknowledgements', async () => {
  const f = fixture(); f.ready();
  let resolve; f.ref.pending = new Promise(r => { resolve = r; });
  const result = f.api.write(f.ref, { fictional: true });
  await Promise.resolve(); f.auth.emit(null); resolve();
  assert.equal(await result, false); assert.equal(f.ref.listeners.length, 0);
  assert.match(f.messages.at(-1), /請先 Google 登入/);
  assert.equal(f.api.isReady(), false);
});

test('development mode only permits local testing and never connects shared Firebase', () => {
  const remote = fixture({ dev: true }); remote.allow();
  assert.equal(remote.api.isLocal(), false); assert.equal(remote.local, 0);
  assert.deepEqual(remote.created, []);
  const local = fixture({ dev: true, local: true }); local.allow();
  assert.equal(local.api.isLocal(), true); assert.equal(local.local, 1);
  assert.deepEqual(local.created, []);
});

test('production missing Firebase never exposes a development role switcher', () => {
  let emitted, bars = 0;
  const doc = documentStub(); doc.body.insertBefore = () => { bars++; };
  const context = { window: {}, document: doc, location: { hostname: 'tools.example.invalid', protocol: 'https:', search: '?dev=1' } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'itrc-auth.js'), 'utf8'), context);
  context.window.ITRCAuth.init({ onChange: value => { emitted = value; } });
  assert.equal(context.window.ITRCAuth.mode, 'unavailable'); assert.equal(emitted, null); assert.equal(bars, 0);
});

test('late role lookup cannot restore a signed-out user', async () => {
  let authChanged, resolveRole;
  const auth = { onAuthStateChanged(fn) { authChanged = fn; } };
  const firebase = { apps: [{}], auth: () => auth, database: () => ({ ref: () => ({ once: () => new Promise(r => { resolveRole = r; }) }) }) };
  const context = { window: {}, document: documentStub(), location: { hostname: 'tools.example.invalid', protocol: 'https:', search: '' }, firebase };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'itrc-auth.js'), 'utf8'), context);
  const values = []; context.window.ITRCAuth.init({ onChange: value => values.push(value) });
  authChanged({ uid: 'fictional', email: 'person@example.invalid' }); authChanged(null);
  resolveRole({ val: () => [{ email: 'person@example.invalid', role: 'officer' }] });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(context.window.ITRCAuth.user, null); assert.deepEqual(values, [null]);
});

const pages = [
  ['ITRC活動組-講師池排程.html', ['activities/state']],
  ['ITRC公關拉贊助小幫手.html', ['sponsors/records', 'sponsors/pipeline', 'sponsors/cands']],
  ['ITRC證書產生器.html', ['certs/positions', 'certs/template']],
];
for (const [filename, expectedPaths] of pages) {
  test(`${filename}: whole page boots with corrupt local cache, delays reads and attaches exact cloud paths`, () => {
    const html = fs.readFileSync(path.join(root, filename), 'utf8');
    assert.ok(html.indexOf('firebase-auth-compat.js') < html.indexOf('itrc-auth.js'));
    assert.ok(html.indexOf('itrc-auth.js') < html.indexOf('itrc-cloud.js'));
    const f = fixture();
    // This fixture's first cloud instance is not used by the page.
    const storage = { getItem: () => '{malformed-cache', setItem() {} };
    const context = { window: f.win, document: f.doc, localStorage: storage,
      navigator: { clipboard: { writeText: () => Promise.resolve() } },
      setTimeout: () => 0, clearTimeout() {}, alert() {}, confirm: () => false,
      Option: function () {}, Blob: function () {}, URL: { createObjectURL: () => 'blob:fictional' },
      ITRCCloud: { create: options => cloud.create(options, { window: f.win, auth: f.auth, document: f.doc }) },
    };
    const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(s => s.trim());
    for (const script of inline) vm.runInNewContext(script, context, { filename });
    assert.deepEqual(f.created, []);
    f.auth.emit({ role: 'officer', email: 'fictional@example.invalid' });
    assert.deepEqual(f.created, ['.info/connected', ...expectedPaths]);
    assert.equal(f.writes.length, 0);
    f.refs.get('.info/connected').emit(true);
    for (const p of expectedPaths) f.refs.get(p).emit(null);
    assert.equal(f.writes.length, 0, 'empty cloud data must never seed itself');
    f.auth.emit(null);
    for (const p of expectedPaths) assert.equal(f.refs.get(p).listeners.length, 0);
  });
}

test('all local scripts parse and local asset references exist', () => {
  let count = 0;
  for (const filename of fs.readdirSync(root)) {
    const file = path.join(root, filename);
    if (!fs.statSync(file).isFile()) continue;
    if (filename.endsWith('.js')) { new vm.Script(fs.readFileSync(file, 'utf8'), { filename }); count++; }
    if (!filename.endsWith('.html')) continue;
    const html = fs.readFileSync(file, 'utf8');
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/type=["'](?:text\/(?:plain|markdown)|application\/json)["']/i.test(m[1])) continue;
      if (m[2].trim()) { new vm.Script(m[2], { filename }); count++; }
    }
    for (const m of html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
      if (/^(?:https?:|#|data:|mailto:|javascript:)/i.test(m[1])) continue;
      const rel = m[1].split(/[?#]/)[0];
      if (!rel || rel.includes('${')) continue;
      assert.ok(fs.existsSync(path.join(root, decodeURIComponent(rel))), `${filename}: missing asset ${rel}`);
    }
  }
  assert.ok(count >= 13);
});
