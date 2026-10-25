// Configuration-only check. Never imports db.js, opens a database, or prints tokens/URLs.
const { createHash } = require('node:crypto');
const path = require('node:path');

function databaseFingerprint(value) {
    if (!value) return null;
    let identity;
    if (value.startsWith('file:')) identity = `file:${path.resolve(value.slice(5))}`;
    else {
        const url = new URL(value);
        // libsql:// and https:// can identify the same hosted database.
        identity = `${url.hostname.toLowerCase()}:${url.port || '443'}${url.pathname.replace(/\/$/, '')}`;
    }
    return createHash('sha256').update(identity).digest('hex');
}

function maintenanceCheck(env = process.env) {
    let fingerprint = null;
    try { fingerprint = databaseFingerprint(env.TURSO_DATABASE_URL); } catch { /* Invalid configuration is reported without its value. */ }
    const environment = env.VERCEL_ENV || env.NODE_ENV || 'local';
    const reference = env.ITRC_PRODUCTION_DB_FINGERPRINT || '';
    const preview = environment === 'preview';
    let status = !fingerprint ? 'database_not_configured' : 'not_a_preview';
    if (preview && fingerprint) {
        status = !/^[a-f0-9]{64}$/.test(reference) ? 'production_reference_required'
            : reference === fingerprint ? 'same_database_as_production' : 'different_connection_identity';
    }
    return {
        environment, databaseConfigured: !!fingerprint, databaseFingerprint: fingerprint,
        isolationStatus: status, previewWritesReadyForReview: preview && status === 'different_connection_identity',
        note: 'Connection identity comparison only; separately confirm database ownership and perform recovery tests with isolated fictional data.',
        cmsBackupScope: ['sections', 'achievements', 'members', 'activities', 'experiences', 'online_resources', 'offline_resources'],
        separatelyBackUp: ['ops tables and encrypted connection state', 'Firebase RTDB and rules', 'external images', 'Google Drive', 'Canva'],
    };
}

if (require.main === module) {
    const result = maintenanceCheck();
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.environment === 'preview' && !result.previewWritesReadyForReview) process.exitCode = 2;
}
module.exports = { databaseFingerprint, maintenanceCheck };
