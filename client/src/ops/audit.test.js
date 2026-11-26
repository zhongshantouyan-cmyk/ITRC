import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recentAuditEntries, auditActorLabel } from './audit.js';

test('audit shows the newest 30 of the 200 server entries without reversing or mutating them', () => {
  const entries = Object.freeze(Array.from({ length: 200 }, (_, i) => Object.freeze({ id: 200 - i })));
  const visible = recentAuditEntries(entries);
  assert.equal(visible.length, 30);
  assert.deepEqual(visible.map(entry => entry.id), Array.from({ length: 30 }, (_, i) => 200 - i));
  assert.equal(entries[0].id, 200);
  assert.notEqual(visible, entries);
});

test('audit preserves empty, short and equal-timestamp lists in source order', () => {
  assert.deepEqual(recentAuditEntries(), []);
  const entries = [{ id: 'new', createdAt: 'same' }, { id: 'old', createdAt: 'same' }];
  assert.deepEqual(recentAuditEntries(entries), entries);
});

test('audit identifies current actorEmail records and older named records', () => {
  assert.equal(auditActorLabel({ actorEmail: 'officer@example.invalid' }), 'officer@example.invalid');
  assert.equal(auditActorLabel({ actorName: '測試幹部', actorEmail: 'officer@example.invalid' }), '測試幹部');
  assert.equal(auditActorLabel({ actorName: '', actorEmail: '' }), '未記錄操作者');
});

test('management audit view uses the tested ordering and actor helpers', () => {
  const page = readFileSync(new URL('../pages/OpsPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /recentAuditEntries\(data\.audit\)\.map/);
  assert.match(page, /auditActorLabel\(item\)/);
  assert.doesNotMatch(page, /data\.audit\.slice\(-30\)/);
});
