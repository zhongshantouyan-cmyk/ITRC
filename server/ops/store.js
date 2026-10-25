'use strict';

const { assert } = require('./errors');
const KINDS = ['projects', 'events', 'posts', 'tasks', 'obligations', 'jobs'];
const emptyState = () => Object.fromEntries([...KINDS, 'audit'].map(kind => [kind, []]));

function createOpsStore(db) {
  const ready = db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS ops_records (
      kind TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (kind, id)
    );
    CREATE TABLE IF NOT EXISTS ops_audit (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ops_audit_created ON ops_audit(created_at DESC);
    CREATE TABLE IF NOT EXISTS ops_idempotency (
      actor_email TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL,
      response TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(actor_email, key)
    );
  `);
  // Serialize local callers; SQLite/Turso write transactions serialize across instances too.
  let tail = Promise.resolve();
  function exclusive(fn) {
    const result = tail.then(fn, fn);
    tail = result.catch(() => {});
    return result;
  }
  async function readState(connection = db, auditLimit = 200) {
    const state = emptyState();
    const result = await connection.execute('SELECT kind, data FROM ops_records');
    for (const row of result.rows) {
      if (KINDS.includes(row.kind)) state[row.kind].push(JSON.parse(row.data));
    }
    const audit = await connection.execute({sql:'SELECT data FROM ops_audit ORDER BY created_at DESC, id DESC LIMIT ?', args:[auditLimit]});
    state.audit = audit.rows.map(row => JSON.parse(row.data));
    return state;
  }
  async function read() { await ready; return exclusive(() => readState()); }
  async function mutate({ actorEmail, idempotencyKey, fingerprint, now }, reducer) {
    await ready;
    return exclusive(async () => {
      const tx = await db.transaction('write');
      try {
        if (idempotencyKey) {
          const old = await tx.execute({sql:'SELECT fingerprint,response FROM ops_idempotency WHERE actor_email=? AND key=?',args:[actorEmail,idempotencyKey]});
          if (old.rows.length) {
            assert(old.rows[0].fingerprint === fingerprint,409,'IDEMPOTENCY_CONFLICT','同一操作識別碼不能用於不同內容，請重新整理後再試。');
            await tx.rollback();
            return { ...JSON.parse(old.rows[0].response), replayed: true };
          }
        }
        const state = await readState(tx);
        const before = new Map(KINDS.flatMap(kind => state[kind].map(record => [`${kind}:${record.id}`, JSON.stringify(record)])));
        const oldAuditIds = new Set(state.audit.map(item => item.id));
        const response = await reducer(state);
        for (const kind of KINDS) {
          for (const record of state[kind]) {
            const data = JSON.stringify(record);
            if (before.get(`${kind}:${record.id}`) !== data) {
              await tx.execute({sql:'INSERT INTO ops_records(kind,id,version,data) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET version=excluded.version,data=excluded.data',args:[kind,record.id,record.version,data]});
            }
          }
        }
        for (const entry of state.audit) {
          if (!oldAuditIds.has(entry.id)) await tx.execute({sql:'INSERT INTO ops_audit(id,created_at,data) VALUES(?,?,?)',args:[entry.id,entry.createdAt,JSON.stringify(entry)]});
        }
        if (idempotencyKey) {
          await tx.execute({sql:'INSERT INTO ops_idempotency(actor_email,key,fingerprint,response,created_at) VALUES(?,?,?,?,?)',args:[actorEmail,idempotencyKey,fingerprint,JSON.stringify(response),now]});
        }
        await tx.commit();
        return response;
      } catch (error) {
        if (!tx.closed) await tx.rollback();
        throw error;
      } finally { tx.close(); }
    });
  }
  return { ready, read, mutate };
}

module.exports = { createOpsStore, KINDS };
