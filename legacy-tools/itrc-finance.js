/* 財務工作流程：固定單號、不可自核准、一次提交收支與核銷狀態。
   此模組不包含憑證，也不自行連線；資料層權限由 RTDB 規則執行。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ITRCFinance = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function fail(message) { throw new Error(message); }
  function str(value) { return String(value == null ? '' : value).trim(); }
  function key(value) { var v = str(value); if (!/^[A-Za-z0-9_-]+$/.test(v)) fail('資料單號無效，請重新載入後再試。'); return v; }
  function amount(value) { var n = Number(value); if (!Number.isSafeInteger(n) || n <= 0 || n > 1000000000) fail('請填有效金額（1 至 1,000,000,000 的正整數）。'); return n; }
  function date(value) { var v = str(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v + 'T00:00:00Z')) || new Date(v + 'T00:00:00Z').toISOString().slice(0,10) !== v) fail('請填有效日期。'); return v; }
  function actor(user) { if (!user || !str(user.uid) || !str(user.name)) fail('請先登入已授權的帳號。'); return user; }
  function clean(row) { var out = {}; Object.keys(row || {}).forEach(function (k) { if (k !== '_key') out[k] = row[k]; }); return out; }
  function rows(value) { return Object.keys(value || {}).filter(function (k) { return value[k] && typeof value[k] === 'object'; }).map(function (k) { return Object.assign({}, value[k], { _key: k }); }); }
  function claim(fields, user, id, now) {
    user = actor(user); id = key(id);
    var item = str(fields.item), pay = str(fields.payMethod), account = str(fields.account);
    if (!item || item.length > 500) fail('請填項目／用途（500 字以內）。');
    if (pay !== 'cash' && pay !== 'transfer') fail('請選擇付款方式。');
    if (pay === 'transfer' && !account) fail('匯款需填收款帳戶，或改選現金。');
    if (account.length > 500 || str(fields.cat).length > 200 || str(fields.note).length > 2000) fail('內容過長：收款帳戶限 500 字、類別限 200 字、備註限 2,000 字。');
    var receipt = str(fields.receipt);
    if (receipt && !/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(receipt)) fail('收據必須是 PNG、JPEG、WebP 或 GIF 圖片。');
    if (receipt.length > 2500000) fail('收據圖片太大，請先壓縮。');
    return { id: id, created: now, date: date(fields.date), byUid: user.uid, byName: user.name,
      byEmail: str(user.email).toLowerCase(), amount: amount(fields.amount), cat: str(fields.cat), item: item,
      note: str(fields.note), payMethod: pay, account: pay === 'transfer' ? account : '', receipt: receipt,
      status: 'submitted', approver: '', approverUid: '', approvedAt: '', rejectReason: '', postedAt: '', postedByUid: '', ledgerKey: '' };
  }
  function review(row, user, approve, reason, now) {
    user = actor(user);
    if (!row || row.status !== 'submitted') fail('這筆核銷已不在待簽核狀態，請重新載入。');
    if (row.byUid === user.uid) fail('申請人不能核准或退回自己的核銷；請由另一位有簽核權限的人使用自己的帳號處理。');
    if (!approve && !str(reason)) fail('退回時請填寫原因。');
    return Object.assign(clean(row), { status: approve ? 'approved' : 'rejected', approver: user.name,
      approverUid: user.uid, approvedAt: now, rejectReason: approve ? '' : str(reason) });
  }
  function posting(row, ledger, user, now) {
    user = actor(user);
    if (!row || row.status !== 'approved') fail('這筆核銷已不在待入帳狀態，請重新載入。');
    if ((ledger || []).some(function (entry) { return entry.ref === row.id; })) fail('收支表已有這筆核銷的紀錄，請先核對，不會重複入帳。');
    var claimKey = key(row._key || row.id), ledgerKey = 'reimb_' + claimKey;
    var entry = { id: ledgerKey, date: date(row.date), type: 'out', cat: str(row.cat) || '核銷', item: str(row.item),
      amount: amount(row.amount), note: '核銷·' + str(row.byName) + (row.payMethod === 'cash' ? '／現金' : '／匯款') + (row.approver ? '／核准:' + row.approver : ''),
      by: user.name, byUid: user.uid, createdAt: now, ref: row.id, claimKey: claimKey };
    var next = Object.assign(clean(row), { status: 'posted', postedAt: now, postedByUid: user.uid, ledgerKey: ledgerKey });
    var updates = {};
    updates['finance/ledger/' + ledgerKey] = entry;
    updates['finance/reimbursements/' + claimKey] = next;
    return { updates: updates, claim: next, ledger: entry, claimKey: claimKey, ledgerKey: ledgerKey };
  }
  function manual(fields, user, id, now) {
    user = actor(user); id = key(id);
    if (fields.type !== 'in' && fields.type !== 'out') fail('請選收入或支出。');
    if (!str(fields.item)) fail('請填項目說明。');
    return { id: id, date: date(fields.date), type: fields.type, cat: str(fields.cat), item: str(fields.item), amount: amount(fields.amount),
      note: '', by: user.name, byUid: user.uid, createdAt: now, ref: '', claimKey: '' };
  }
  function voidEntry(row, user, reason, now) {
    user = actor(user);
    if (!row || row.voidedAt) fail('這筆明細不存在或已作廢。');
    if (row.ref) fail('核銷入帳保留原始紀錄；如需更正，請由財務長新增調整分錄並在項目註明原單號。');
    if (!str(reason)) fail('作廢必須填寫原因，原明細會保留。');
    return Object.assign(clean(row), { voidedAt: now, voidedByUid: user.uid, voidedBy: user.name, voidReason: str(reason) });
  }
  function totals(ledger) { return (ledger || []).reduce(function (out, row) { if (!row.voidedAt) out[row.type === 'in' ? 'income' : 'expense'] += Number(row.amount) || 0; return out; }, { income: 0, expense: 0 }); }
  return { key: key, clean: clean, rows: rows, claim: claim, review: review, posting: posting, manual: manual, voidEntry: voidEntry, totals: totals };
});
