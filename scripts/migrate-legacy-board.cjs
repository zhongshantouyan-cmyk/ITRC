#!/usr/bin/env node
'use strict';

// This CLI only talks to the existing authenticated API. It never reads server
// environment files, Firebase service accounts, browser storage, or production DB
// credentials. --apply is required for business mutations; import.preview may
// persist the API's existing idempotency metadata even in preview-only mode.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { convertBackup, digest } = require('./prepare-legacy-board-import.cjs');

const API_BASE = 'https://itrc-eight.vercel.app/api';
const MAX_BYTES = 64 * 1024 * 1024;
const SOURCE_PREFIX = 'firebase:boards/itrc:card:';
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const check = (condition, code) => { if (!condition) fail(code); };
const same = (a, b) => a === undefined || b === undefined ? a === b : digest(a) === digest(b);
const sorted = rows => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));

function checkedBackup(bundle) {
  try { require('../server/system-backup').validateSystemBackup(bundle); }
  catch { fail('INVALID_SYSTEM_BACKUP'); }
  return bundle;
}

function records(bundle, kind) {
  const table = bundle.database.tables.find(item => item.name === 'ops_records');
  const names = table.columns.map(column => column.name);
  return table.rows.map(row => Object.fromEntries(names.map((name, index) => [name, row[index]])))
    .filter(row => row.kind === kind).map(row => {
      let data;
      try { data = JSON.parse(row.data); } catch { fail('INVALID_OPS_RECORD'); }
      check(data && typeof data === 'object' && !Array.isArray(data) && data.id === row.id && data.version === row.version, 'OPS_RECORD_ID_OR_VERSION_MISMATCH');
      return data;
    });
}

function snapshot(bundle) {
  checkedBackup(bundle);
  const board = bundle.firebase.paths.find(entry => entry.path === 'boards/itrc');
  check(board?.exists, 'LEGACY_BOARD_MISSING');
  const people = sorted(records(bundle, 'people')), tasks = sorted(records(bundle, 'tasks'));
  const sourceKeys = tasks.map(task => task.sourceKey).filter(key => typeof key === 'string' && key.startsWith(SOURCE_PREFIX));
  check(new Set(sourceKeys).size === sourceKeys.length, 'DUPLICATE_LEGACY_TARGET_KEYS');
  return { boardSha256: board.sha256, boardVersion: board.value.v, people, tasks,
    peopleSha256: digest(people), tasksSha256: digest(tasks) };
}

function assertFresh(before, current) {
  const a = snapshot(before), b = snapshot(current);
  check(a.boardSha256 === b.boardSha256 && a.boardVersion === b.boardVersion, 'SOURCE_CHANGED_BEFORE_APPLY');
  check(a.peopleSha256 === b.peopleSha256, 'PEOPLE_CHANGED_BEFORE_APPLY');
  check(a.tasksSha256 === b.tasksSha256, 'TARGET_CHANGED_BEFORE_APPLY');
  for (const kind of ['events', 'posts']) check(same(sorted(records(before, kind)), sorted(records(current, kind))), `${kind.toUpperCase()}_CHANGED_BEFORE_APPLY`);
  return { boardUnchanged: true, peopleUnchanged: true, tasksUnchanged: true, eventsUnchanged: true, postsUnchanged: true };
}

function assertBootstrap(bundle, bootstrap) {
  check(bootstrap?.actor?.uid && bootstrap.actor.email && ['advisor', 'chair'].includes(bootstrap.actor.role), 'AUTHORIZED_IMPORT_ACTOR_REQUIRED');
  for (const kind of ['people', 'tasks', 'events', 'posts']) {
    // bootstrap adds this derived display-only field to events; the stored
    // event fields must still match the full backup exactly.
    const rows = Array.isArray(bootstrap[kind]) ? bootstrap[kind].map(row => kind === 'events' ? Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'missingFacts')) : row) : null;
    check(rows && same(sorted(records(bundle, kind)), sorted(rows)), 'BOOTSTRAP_BACKUP_CHANGED');
  }
}

function verifyPreview(before, payload, response) {
  const preview = response?.record;
  check(response?.ok === true && preview && Array.isArray(preview.tasks) && Array.isArray(preview.duplicates), 'INVALID_IMPORT_PREVIEW');
  check(preview.events?.length === 0 && preview.posts?.length === 0, 'UNEXPECTED_EVENT_OR_POST_IMPORT');
  const existing = new Set(records(before, 'tasks').map(task => task.sourceKey).filter(Boolean));
  const expectedNew = payload.tasks.filter(task => !existing.has(task.sourceKey));
  const expectedDuplicates = payload.tasks.filter(task => existing.has(task.sourceKey)).map(task => task.sourceKey).sort();
  check(preview.tasks.length === expectedNew.length && new Set(preview.tasks.map(task => task.sourceKey)).size === expectedNew.length, 'PREVIEW_TASK_COUNT_MISMATCH');
  for (const expected of expectedNew) {
    const actual = preview.tasks.find(task => task.sourceKey === expected.sourceKey);
    check(actual && Object.entries(expected).every(([key, value]) => same(value, actual[key])), 'PREVIEW_FIELD_MISMATCH');
    check(!actual.projectId && !actual.eventId && !actual.postId, 'UNEXPECTED_TASK_RELATIONSHIP');
    if (expected.status === 'done') check(actual.completionMode === 'imported_status' && !actual.completedAt && !actual.completedBy, 'FABRICATED_COMPLETION');
  }
  check(preview.duplicates.every(item => item.kind === 'tasks') && same(preview.duplicates.map(item => item.sourceKey).sort(), expectedDuplicates), 'PREVIEW_DUPLICATE_MISMATCH');
  return { newTasks: expectedNew.length, duplicates: expectedDuplicates.length, fieldsVerified: expectedNew.length };
}

function verifyApplyResponse(response, imported, duplicateKeys) {
  const result = response?.record;
  check(response?.ok === true && response.replayed !== true && result?.importedEvents === 0 && result?.importedPosts === 0 && result?.importedTasks === imported, 'APPLY_RESULT_MISMATCH');
  check(Array.isArray(result.duplicates) && result.duplicates.every(item => item.kind === 'tasks') && same(result.duplicates.map(item => item.sourceKey).sort(), [...duplicateKeys].sort()), 'APPLY_DUPLICATE_MISMATCH');
}

function verifyImported(before, after, payload) {
  const a = snapshot(before), b = snapshot(after);
  check(a.boardSha256 === b.boardSha256, 'SOURCE_CHANGED_AFTER_APPLY');
  check(a.peopleSha256 === b.peopleSha256, 'PEOPLE_CHANGED_AFTER_APPLY');
  for (const kind of ['events', 'posts']) check(same(sorted(records(before, kind)), sorted(records(after, kind))), `${kind.toUpperCase()}_CHANGED_AFTER_APPLY`);
  const old = new Map(a.tasks.map(task => [task.id, task]));
  for (const [id, task] of old) check(same(task, b.tasks.find(item => item.id === id)), 'EXISTING_TASK_CHANGED');
  const oldKeys = new Set(a.tasks.map(task => task.sourceKey).filter(Boolean));
  const expectedNew = payload.tasks.filter(task => !oldKeys.has(task.sourceKey));
  const added = b.tasks.filter(task => !old.has(task.id));
  check(added.length === expectedNew.length, 'UNEXPECTED_TASK_ADDITION');
  const verified = [];
  for (const expected of payload.tasks) {
    const matches = b.tasks.filter(task => task.sourceKey === expected.sourceKey);
    check(matches.length === 1, 'LEGACY_TASK_MISSING_OR_DUPLICATED');
    const actual = matches[0], created = !oldKeys.has(expected.sourceKey);
    const sourceFieldDifferences = Object.entries(expected).filter(([key, value]) => !same(value, actual[key])).map(([key]) => key);
    if (created) {
      check(sourceFieldDifferences.length === 0, 'IMPORTED_FIELD_MISMATCH');
      check(!actual.projectId && !actual.eventId && !actual.postId, 'UNEXPECTED_TASK_RELATIONSHIP');
      if (expected.status === 'done') check(actual.completionMode === 'imported_status' && !actual.completedAt && !actual.completedBy, 'FABRICATED_COMPLETION');
    }
    verified.push({ sourceKey: expected.sourceKey, id: actual.id, created, preservedExisting: !created,
      sourceFieldsCompared: true, sourceFieldsVerified: sourceFieldDifferences.length === 0, sourceFieldDifferences,
      status: actual.status, ownerPersonId: actual.ownerPersonId || '', recordSha256: digest(actual) });
  }
  return { verified, created: added.length, preservedExistingTasks: a.tasks.length, sourceUnchanged: true, peopleUnchanged: true,
    eventsUnchanged: true, postsUnchanged: true, totalTasks: b.tasks.length, legacyTasks: verified.length,
    newRecordsFieldsVerified: expectedNew.length, existingLegacyRecordsPreserved: verified.filter(item => !item.created).length,
    sourceFieldDifferences: verified.filter(item => item.sourceFieldDifferences.length).map(({ id, sourceKey, sourceFieldDifferences: fields }) => ({ id, sourceKey, fields })),
    statusCounts: Object.fromEntries([...new Set(verified.map(item => item.status))].map(status => [status, verified.filter(item => item.status === status).length])) };
}

function privateDirectory(repoRoot, requested) {
  const root = fs.realpathSync(repoRoot), destination = path.resolve(root, requested);
  const relative = path.relative(root, destination);
  check(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'EVIDENCE_DIRECTORY_MUST_BE_INSIDE_REPOSITORY');
  // Traverse without following symlinks, and create only private directories.
  let current = root;
  for (const [index, segment] of relative.split(path.sep).entries()) {
    current = path.join(current, segment);
    const last = index === relative.split(path.sep).length - 1;
    if (fs.existsSync(current)) {
      check(!last && fs.lstatSync(current).isDirectory() && !fs.lstatSync(current).isSymbolicLink(), 'EVIDENCE_DIRECTORY_EXISTS_OR_UNSAFE');
    } else fs.mkdirSync(current, { mode: 0o700 });
  }
  fs.writeFileSync(path.join(destination, '.gitignore'), '*\n', { mode: 0o600, flag: 'wx' });
  const ignored = spawnSync('git', ['check-ignore', '--no-index', '--quiet', path.join(destination, 'before-backup.json')], { cwd: root });
  check(ignored.status === 0, 'PRIVATE_ARTIFACTS_NOT_GITIGNORED');
  fs.chmodSync(destination, 0o700);
  return destination;
}

function writer(directory) {
  return (name, value) => {
    check(/^[a-z][a-z0-9-]*\.json$/.test(name), 'INVALID_ARTIFACT_NAME');
    fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  };
}

function readToken(filename) {
  check(typeof filename === 'string' && path.isAbsolute(filename), 'ABSOLUTE_TOKEN_FILE_REQUIRED');
  const stat = fs.lstatSync(filename);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size < 16384 && (stat.mode & 0o077) === 0, 'TOKEN_FILE_MUST_BE_PRIVATE');
  const token = fs.readFileSync(filename, 'utf8').trim();
  check(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token), 'INVALID_TOKEN_FILE');
  return token;
}

function apiClient(token, fetchImpl = fetch) {
  return async (endpoint, body) => {
    check(['/system-backup/export', '/ops/bootstrap', '/ops/actions'].includes(endpoint), 'UNEXPECTED_API_ENDPOINT');
    let response;
    try {
      response = await fetchImpl(API_BASE + endpoint, { method: body ? 'POST' : 'GET', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Cache-Control': 'no-store', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) });
    } catch { fail('API_REQUEST_FAILED'); }
    check(response.ok, `API_HTTP_${response.status}`);
    check(/application\/json/i.test(response.headers.get('content-type') || ''), 'API_RESPONSE_NOT_JSON');
    const chunks = []; let bytes = 0;
    try {
      for await (const chunk of response.body) {
        bytes += chunk.length;
        check(bytes <= MAX_BYTES, 'API_RESPONSE_TOO_LARGE');
        chunks.push(Buffer.from(chunk));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) { if (error.code === 'API_RESPONSE_TOO_LARGE') throw error; fail('API_RESPONSE_INVALID'); }
  };
}

async function runMigration({ api, directory, apply = false, expectedCards = 17, expectedBoardSha256 = '', restore }) {
  const write = writer(directory), id = suffix => `legacy-board-${randomUUID()}-${suffix}`;
  const keys = { preview: id('preview'), apply: id('apply'), repeatPreview: id('repeat-preview'), repeatApply: id('repeat-apply') };
  write('request-identifiers.json', keys); // Contains no authorization token.
  let phase = 'backup', applyAttempted = false;
  try {
    const before = checkedBackup(await api('/system-backup/export'));
    write('before-backup.json', before);
    const bootstrap = await api('/ops/bootstrap');
    assertBootstrap(before, bootstrap);
    write('before-bootstrap.json', bootstrap);
    const baseline = snapshot(before), { payload, report } = convertBackup(before);
    check(payload.tasks.length === expectedCards, 'UNEXPECTED_SOURCE_CARD_COUNT');
    if (expectedBoardSha256) check(baseline.boardSha256 === expectedBoardSha256, 'REVIEWED_SOURCE_CHANGED');
    check(Buffer.byteLength(JSON.stringify({ action: 'import.apply', payload, idempotencyKey: keys.apply })) < 256 * 1024, 'IMPORT_PAYLOAD_TOO_LARGE');
    write('import-payload.json', payload); write('source-mapping.json', report);
    phase = 'preview';
    const previewCommand = { action: 'import.preview', payload, idempotencyKey: keys.preview };
    write('preview-command.json', previewCommand);
    const preview = await api('/ops/actions', previewCommand);
    write('server-preview.json', preview);
    const previewResult = verifyPreview(before, payload, preview);
    phase = 'isolated-restore';
    const restoreFn = restore || require('../server/system-backup').restoreBackupToDirectory;
    const recovery = await restoreFn(before, path.join(directory, 'isolated-restore'));
    check(recovery.remoteWrites === false && recovery.sqlDataVerifiedBeforeCredentialPause === true && recovery.checksum === before.checksum.value, 'ISOLATED_RESTORE_NOT_VERIFIED');
    write('recovery-verification.json', recovery);
    const baseSummary = { api: API_BASE, expectedCards, sourceBoardSha256: baseline.boardSha256,
      sourceBoardVersion: baseline.boardVersion, ...previewResult, isolatedRestoreVerified: true,
      previewMayPersistIdempotencyMetadata: true, evidenceDirectory: directory };
    if (!apply) {
      const summary = { ok: true, status: 'preview_only', businessApplyAttempted: false, ...baseSummary };
      write('summary.json', summary); return summary;
    }
    phase = 'preapply-check';
    const guard = checkedBackup(await api('/system-backup/export'));
    write('preapply-backup.json', guard);
    const guardBootstrap = await api('/ops/bootstrap');
    assertBootstrap(guard, guardBootstrap); assertFresh(before, guard);
    write('preapply-bootstrap.json', guardBootstrap);
    const command = { action: 'import.apply', payload, idempotencyKey: keys.apply };
    write('apply-command.json', command);
    phase = 'apply'; applyAttempted = true;
    const applied = await api('/ops/actions', command);
    write('apply-response.json', applied);
    verifyApplyResponse(applied, previewResult.newTasks, preview.record.duplicates.map(item => item.sourceKey));
    phase = 'readback';
    const after = checkedBackup(await api('/system-backup/export'));
    write('after-apply-backup.json', after);
    const afterBootstrap = await api('/ops/bootstrap');
    assertBootstrap(after, afterBootstrap); write('after-apply-bootstrap.json', afterBootstrap);
    const verified = verifyImported(before, after, payload);
    write('readback-verification.json', verified);
    write('rollback-manifest.json', { version: 1, automaticProductionRollback: false,
      beforeBackup: 'preapply-backup.json', isolatedRestore: 'isolated-restore', isolatedRestoreSourceBackup: 'before-backup.json',
      isolatedRestoreSourceChecksum: before.checksum.value, sourcePath: 'boards/itrc', sourceWasModified: false,
      createdTasks: verified.verified.filter(item => item.created).map(({ id: taskId, sourceKey, recordSha256 }) => ({ id: taskId, sourceKey, expectedRecordSha256: recordSha256 })),
      instructions: 'Preserve current production data first. The existing restore CLI restores only to a new local directory. No remote delete/restore is executed here. A maintainer must compare IDs, source keys, versions and hashes before any separately authorized production rollback; never overwrite concurrent updates or restore the entire live database blindly.' });
    phase = 'duplicate-proof';
    const repeatPreviewCommand = { action: 'import.preview', payload, idempotencyKey: keys.repeatPreview };
    write('repeat-preview-command.json', repeatPreviewCommand);
    const repeatPreview = await api('/ops/actions', repeatPreviewCommand);
    write('repeat-preview.json', repeatPreview);
    const repeatedPreview = verifyPreview(after, payload, repeatPreview);
    check(repeatedPreview.newTasks === 0 && repeatedPreview.duplicates === expectedCards, 'REPEAT_PREVIEW_NOT_DUPLICATE_ONLY');
    const repeatApplyCommand = { action: 'import.apply', payload, idempotencyKey: keys.repeatApply };
    write('repeat-apply-command.json', repeatApplyCommand);
    const repeatResponse = await api('/ops/actions', repeatApplyCommand);
    write('repeat-apply-response.json', repeatResponse);
    verifyApplyResponse(repeatResponse, 0, payload.tasks.map(item => item.sourceKey));
    phase = 'final-readback';
    const final = checkedBackup(await api('/system-backup/export'));
    write('after-repeat-backup.json', final);
    const finalBootstrap = await api('/ops/bootstrap');
    assertBootstrap(final, finalBootstrap); write('after-repeat-bootstrap.json', finalBootstrap);
    check(snapshot(after).tasksSha256 === snapshot(final).tasksSha256, 'REPEAT_CHANGED_TASKS');
    const finalVerified = verifyImported(before, final, payload);
    write('final-verification.json', finalVerified);
    const summary = { ok: true, status: previewResult.newTasks ? 'applied_and_verified' : 'already_present_and_preserved',
      businessApplyAttempted: true, ...baseSummary, imported: verified.created, existingTasksPreserved: verified.preservedExistingTasks,
      readbackPresenceVerified: finalVerified.legacyTasks, newRecordsFieldsVerified: finalVerified.newRecordsFieldsVerified,
      existingLegacyRecordsPreserved: finalVerified.existingLegacyRecordsPreserved,
      sourceFieldDifferences: finalVerified.sourceFieldDifferences,
      existingComparisonNote: 'Existing records are preserved even when source fields differ. Differences list field names only; sourceDate, sourceRevision and the capture-time line in notes can differ on a later snapshot.',
      repeatImported: 0, repeatDuplicates: expectedCards,
      distinctApplyIdempotencyKeys: keys.apply !== keys.repeatApply, taskDataUnchangedByRepeat: true,
      sourceUnchanged: finalVerified.sourceUnchanged, eventsUnchanged: true, postsUnchanged: true, statusCounts: finalVerified.statusCounts,
      consistencyLimit: 'API snapshots check source, people and tasks immediately before apply. They do not lock the legacy Firebase board across the SQL transaction; any detected later change stops verification without overwriting it.' };
    write('summary.json', summary); return summary;
  } catch (error) {
    const failure = { ok: false, status: 'stopped', phase, code: /^[A-Z_0-9]+$/.test(error.code || '') ? error.code : 'MIGRATION_STOPPED',
      businessApplyAttempted: applyAttempted, outcomeMayRequireReconciliation: applyAttempted, evidenceDirectory: directory };
    // A lost mutation response is not automatically retried. Read-only evidence
    // can still reveal the result, while preserving the original request key.
    if (phase === 'apply' && applyAttempted) {
      try { write('uncertain-apply-backup.json', checkedBackup(await api('/system-backup/export'))); failure.uncertainReadbackSaved = true; }
      catch { failure.uncertainReadbackSaved = false; }
    }
    try { write('failure.json', failure); } catch { /* Never expose filesystem/request contents. */ }
    const safe = new Error(failure.code); Object.assign(safe, failure); throw safe;
  }
}

function parseArgs(argv) {
  const args = { apply: false, expectedCards: 17 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') { check(!args.apply, 'DUPLICATE_OPTION'); args.apply = true; }
    else if (argv[i] === '--help') args.help = true;
    else {
      const key = { '--token-file': 'tokenFile', '--out-dir': 'outDir', '--expect-cards': 'expectedCards', '--expect-board-sha256': 'expectedBoardSha256' }[argv[i]];
      check(key && argv[i + 1] && !argv[i + 1].startsWith('--'), 'INVALID_ARGUMENTS');
      args[key] = argv[++i];
    }
  }
  args.expectedCards = Number(args.expectedCards);
  check(Number.isInteger(args.expectedCards) && args.expectedCards >= 1 && args.expectedCards <= 200, 'INVALID_EXPECTED_CARD_COUNT');
  if (args.expectedBoardSha256) check(/^[a-f0-9]{64}$/.test(args.expectedBoardSha256), 'INVALID_EXPECTED_BOARD_HASH');
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write('Usage: node scripts/migrate-legacy-board.cjs --token-file /absolute/private/firebase-id-token --out-dir .private/legacy-board-RUN [--expect-cards 17] [--expect-board-sha256 HASH] [--apply]\nDefault: back up, verify current source/target, server preview, isolated restore; no import.apply. Preview can persist API idempotency metadata. Token file must be 0600. API is pinned to ' + API_BASE + '.\n');
    return;
  }
  check(args.tokenFile && args.outDir, 'TOKEN_FILE_AND_OUTPUT_REQUIRED');
  const token = readToken(args.tokenFile);
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const directory = privateDirectory(repoRoot, args.outDir);
  const result = await runMigration({ ...args, directory, api: apiClient(token) });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

module.exports = { API_BASE, parseArgs, readToken, apiClient, privateDirectory, snapshot, assertFresh, assertBootstrap,
  verifyPreview, verifyApplyResponse, verifyImported, runMigration, main };
if (require.main === module) main().catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, code: /^[A-Z_0-9]+$/.test(error.code || '') ? error.code : 'MIGRATION_STOPPED',
    phase: error.phase || 'setup', businessApplyAttempted: error.businessApplyAttempted || false,
    outcomeMayRequireReconciliation: error.outcomeMayRequireReconciliation || false, evidenceDirectory: error.evidenceDirectory || null }) + '\n');
  process.exitCode = 1;
});
