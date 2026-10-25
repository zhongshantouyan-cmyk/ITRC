#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { restoreBackupToDirectory, MAX_BACKUP_BYTES } = require('../server/system-backup');

async function main() {
    const [source, destination, ...extra] = process.argv.slice(2);
    if (!source || !destination || extra.length || !path.isAbsolute(source)) {
        throw new Error('Usage: node scripts/restore-system-backup.cjs /absolute/backup.json /absolute/new-directory');
    }
    const stat = await fs.stat(source);
    if (!stat.isFile() || stat.size > MAX_BACKUP_BYTES) throw new Error('Backup must be a local JSON file no larger than 64 MiB.');
    const bundle = JSON.parse(await fs.readFile(source, 'utf8'));
    const result = await restoreBackupToDirectory(bundle, destination);
    process.stdout.write(JSON.stringify({ ok: true, ...result }, null, 2) + '\n');
}

if (require.main === module) main().catch(error => {
    // Error messages contain schema/path validation only, never rows or credentials.
    process.stderr.write('Isolated restoration failed: ' + error.message + '\n');
    process.exitCode = 1;
});
module.exports = { main };
