'use strict';
const { PUBLIC_MEMBER_COLUMNS } = require('./public-content');
const canManageRoster = actor => !!actor?.superAdmin || ['chair', 'advisor', 'admin'].includes(actor?.role);

async function listMembers(db, { includeArchived = false } = {}) {
    const columns = [...PUBLIC_MEMBER_COLUMNS, ...(includeArchived ? ['archived_at'] : [])];
    const result = await db.execute(`SELECT ${columns.join(', ')} FROM members ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY order_num ASC, id ASC`);
    return result.rows;
}

async function setMemberArchived(db, id, archived, now = () => new Date().toISOString()) {
    if (!/^\d+$/.test(String(id))) { const error = new Error('成員識別碼不正確。'); error.status = 400; throw error; }
    const result = await db.execute({ sql: 'UPDATE members SET archived_at = ? WHERE id = ?', args: [archived ? now() : null, id] });
    if (!result.rowsAffected) { const error = new Error('找不到此成員。'); error.status = 404; throw error; }
    return { message: archived ? '已移出現任名單，歷史資料保留。' : '已恢復公開名單。', archived };
}

module.exports = { listMembers, setMemberArchived, canManageRoster };
