#!/usr/bin/env node
'use strict';

// Offline evidence verification only. No production credential or network used.
const fs = require('node:fs');
const path = require('node:path');
const { convertBackup, digest } = require('./prepare-legacy-board-import.cjs');
const { snapshot, assertFresh, assertBootstrap, verifyPreview, verifyApplyResponse, verifyImported } = require('./migrate-legacy-board.cjs');
const check = (condition, code) => { if (!condition) { const error = new Error(code); error.code = code; throw error; } };

function verifyDirectory(directory) {
  const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
  const before = read('before-backup.json'), payload = read('import-payload.json');
  snapshot(before);
  check(digest(payload) === digest(convertBackup(before).payload), 'PAYLOAD_DIFFERS_FROM_SOURCE_BACKUP');
  assertBootstrap(before, read('before-bootstrap.json'));
  const preview = read('server-preview.json'), staged = verifyPreview(before, payload, preview);
  const recovery = read('recovery-verification.json');
  check(recovery.remoteWrites === false && recovery.sqlDataVerifiedBeforeCredentialPause === true && recovery.checksum === before.checksum.value, 'ISOLATED_RESTORE_NOT_VERIFIED');
  const summary = read('summary.json');
  if (summary.status === 'preview_only') {
    check(summary.businessApplyAttempted === false && !fs.existsSync(path.join(directory, 'apply-command.json')), 'PREVIEW_SUMMARY_CONTRADICTS_APPLY');
    return { ok: true, status: 'preview_only', applied: false, ...staged };
  }
  check(['applied_and_verified', 'already_present_and_preserved'].includes(summary.status) && summary.businessApplyAttempted === true, 'INVALID_MIGRATION_SUMMARY');
  const guard = read('preapply-backup.json'), after = read('after-apply-backup.json'), final = read('after-repeat-backup.json');
  assertFresh(before, guard); assertBootstrap(guard, read('preapply-bootstrap.json'));
  assertBootstrap(after, read('after-apply-bootstrap.json')); assertBootstrap(final, read('after-repeat-bootstrap.json'));
  const keys = read('request-identifiers.json');
  check(keys.apply !== keys.repeatApply && keys.preview !== keys.repeatPreview, 'IDEMPOTENCY_PROOF_REUSED_KEY');
  for (const [filename, key, action] of [
    ['preview-command.json', 'preview', 'import.preview'], ['apply-command.json', 'apply', 'import.apply'],
    ['repeat-preview-command.json', 'repeatPreview', 'import.preview'], ['repeat-apply-command.json', 'repeatApply', 'import.apply'],
  ]) {
    const command = read(filename);
    check(command.idempotencyKey === keys[key] && command.action === action && digest(command.payload) === digest(payload), 'MIGRATION_REQUEST_EVIDENCE_MISMATCH');
  }
  verifyApplyResponse(read('apply-response.json'), staged.newTasks, preview.record.duplicates.map(item => item.sourceKey));
  verifyImported(before, after, payload);
  const repeatedPreview = verifyPreview(after, payload, read('repeat-preview.json'));
  check(repeatedPreview.newTasks === 0 && repeatedPreview.duplicates === payload.tasks.length, 'REPEAT_PREVIEW_NOT_DUPLICATE_ONLY');
  verifyApplyResponse(read('repeat-apply-response.json'), 0, payload.tasks.map(item => item.sourceKey));
  check(snapshot(after).tasksSha256 === snapshot(final).tasksSha256, 'REPEAT_CHANGED_TASKS');
  const verified = verifyImported(before, final, payload);
  check(summary.imported === verified.created && summary.repeatImported === 0 && summary.repeatDuplicates === payload.tasks.length && summary.readbackPresenceVerified === payload.tasks.length && summary.newRecordsFieldsVerified === verified.newRecordsFieldsVerified && summary.existingLegacyRecordsPreserved === verified.existingLegacyRecordsPreserved && digest(summary.sourceFieldDifferences) === digest(verified.sourceFieldDifferences), 'MIGRATION_SUMMARY_COUNT_MISMATCH');
  return { ok: true, status: 'applied_evidence_verified', imported: verified.created, readbackPresenceVerified: verified.legacyTasks,
    newRecordsFieldsVerified: verified.newRecordsFieldsVerified, existingLegacyRecordsPreserved: verified.existingLegacyRecordsPreserved,
    sourceFieldDifferences: verified.sourceFieldDifferences,
    existingTasksPreserved: verified.preservedExistingTasks, repeatImported: 0, repeatDuplicates: payload.tasks.length,
    sourceUnchanged: true, eventsUnchanged: true, postsUnchanged: true, statusCounts: verified.statusCounts };
}

module.exports = { verifyDirectory };
if (require.main === module) {
  try {
    const [directory, ...rest] = process.argv.slice(2);
    check(directory && !rest.length, 'USAGE_NODE_VERIFY_LEGACY_BOARD_MIGRATION_RUN_DIRECTORY');
    process.stdout.write(JSON.stringify(verifyDirectory(path.resolve(directory)), null, 2) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({ ok: false, code: /^[A-Z_0-9]+$/.test(error.code || '') ? error.code : 'INVALID_MIGRATION_EVIDENCE' }) + '\n');
    process.exitCode = 1;
  }
}
