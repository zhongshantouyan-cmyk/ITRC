import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLegacyToolAssets, mainToolsRedirects, oldToolsRedirects } from './legacy-tools.mjs';
import { CLUB_TOOLS } from '../client/src/ops/club-tools-catalog.js';

const sourceDirectory = fileURLToPath(new URL('../legacy-tools/', import.meta.url));
const source = name => readFileSync(new URL(`../legacy-tools/${name}`, import.meta.url), 'utf8');
const production = createLegacyToolAssets(sourceDirectory, 'production');
const preview = createLegacyToolAssets(sourceDirectory, 'preview');

function inlineScripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\bsrc\s*=|application\/json/i.test(match[1])).map(match => match[2]);
}

test('every published tool is bundled under one origin and former board links use the main task page', () => {
  assert.equal(CLUB_TOOLS.filter(tool => !tool.hidden).length, 8);
  for (const tool of CLUB_TOOLS) {
    assert.equal(tool.path, `/tools/${tool.id}.html`);
    assert(production.has(tool.path.slice(1)), tool.id);
    assert(production.get(`tools/${tool.file}`).includes(tool.workspacePath.replaceAll('&', '&amp;')));
  }
  const board = CLUB_TOOLS.find(tool => tool.id === 'board');
  assert.equal(board.hidden, true);
  assert.equal(board.workspacePath, '/ops?view=tasks&source=legacy');
});

test('embedding preserves the financial implementation and all tool inline logic', () => {
  assert.equal(production.get('tools/itrc-finance.js'), source('itrc-finance.js'));
  assert.equal(production.get('tools/itrc-auth.js'), source('itrc-auth.js'));
  assert.equal(production.get('tools/itrc-roster.js'), source('itrc-roster.js'));
  for (const tool of CLUB_TOOLS) {
    const bundled = production.get(`tools/${tool.id}.html`);
    assert.deepEqual(inlineScripts(bundled), inlineScripts(source(tool.file)), tool.id);
    assert(bundled.includes('src="/tools/embedded.js"'));
    assert(bundled.includes('href="/tools/embedded.css"'));
  }
});

test('Preview direct tool URLs contain no live authentication or business scripts', () => {
  for (const tool of CLUB_TOOLS) {
    const html = preview.get(`tools/${tool.id}.html`);
    assert(html.includes('預覽模式不連接正式工具資料'));
    assert(!/<script\b|firebase|finance\/ledger/i.test(html), tool.id);
  }
  for (const name of ['itrc-auth.js', 'itrc-cloud.js', 'itrc-finance.js', 'itrc-roster.js']) assert.equal(preview.has(`tools/${name}`), false);
});

test('redirects use only known old pages and keep the existing API gateway configuration', () => {
  const old = oldToolsRedirects();
  assert.equal(old.length, CLUB_TOOLS.length + 2);
  for (const rule of old) {
    assert(rule.destination.startsWith('https://nsysu-itrc.vercel.app/ops'));
    assert.equal(rule.permanent, false);
  }
  assert.equal(old.find(rule => rule.source === '/ITRC財務站.html').destination, 'https://nsysu-itrc.vercel.app/ops?tool=finance');
  assert.equal(old.find(rule => rule.source === '/ITRC管理組-任務看板.html').destination, 'https://nsysu-itrc.vercel.app/ops?view=tasks&source=legacy');
  const main = JSON.parse(readFileSync(new URL('../client/vercel.json', import.meta.url), 'utf8'));
  assert(main.rewrites.some(rule => rule.source === '/api/ops/:path*' && rule.destination === '/api/ops?path=:path*'));
  assert.equal(main.functions['api/ops.js'].maxDuration, 60);
  for (const rule of mainToolsRedirects()) assert.deepEqual(main.redirects.find(item => item.source === rule.source), rule);
});

test('main workspace and embedded tools use the same existing Firebase project', () => {
  const main = readFileSync(new URL('../client/src/firebase.js', import.meta.url), 'utf8');
  const embedded = source('itrc-auth.js');
  for (const key of ['apiKey', 'authDomain', 'projectId', 'databaseURL', 'appId']) {
    const expression = new RegExp(`${key}\\s*:\\s*["']([^"']+)`);
    assert.equal(main.match(expression)?.[1], embedded.match(expression)?.[1], key);
    assert(main.match(expression)?.[1], `missing ${key}`);
  }
  assert(main.includes('initializeApp(firebaseConfig)'));
  assert(embedded.includes('firebase.initializeApp(CFG)'));
});
