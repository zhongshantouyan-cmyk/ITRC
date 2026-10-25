'use strict';

const { createHash } = require('node:crypto');
const { assert } = require('./errors');

const WEBSITE_AUTHORITY = 'https://nsysu-itrc.vercel.app/';
const PERSON_FIELDS = ['personId','name','email','title','group','lineName','term','status','sourceUrl','sourceRevision','contactSourceUrl'];
const PERSON_ID = /^ITRC-P\d{4,8}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isInactivePerson = row => Boolean(row && ['inactive','retired'].includes(row.status));
function assertActorActive(state, actor) {
  const row = (state.people || []).find(item => item.email && item.email.toLowerCase() === actor?.email?.toLowerCase());
  assert(!isInactivePerson(row),403,'PERSON_ACCESS_REVOKED','此帳號已不在現任幹部名單，無法存取社團工作台。歷史工作紀錄仍會保留。');
}
function person(state, personId) { return (state.people || []).find(row => row.personId === personId); }
function personMatches(state, personId, actor) {
  const row = person(state, personId);
  return Boolean(row && !isInactivePerson(row) && row.email && row.email === actor.email);
}
function requirePerson(state, personId, label = '負責人') {
  const row = person(state, personId);
  assert(row,400,'PERSON_NOT_FOUND',`${label}不在已確認的幹部名單，請先更新名單。`);
  assert(!isInactivePerson(row),400,'PERSON_INACTIVE',`${label}不在當期名單，請選擇目前在任的人員。`);
  return row;
}
function validatePersonReferences(state, record) {
  for (const [key,label] of [['ownerPersonId','負責人'],['reviewerPersonId','驗收人'],['adviserPersonId','專案督導']]) {
    if (record[key]) {
      const row = requirePerson(state,record[key],label);
      const emailKey = key.replace('PersonId','Email');
      if (record[emailKey]) assert(row.email && row.email === record[emailKey].toLowerCase(),400,'PERSON_EMAIL_MISMATCH',`${label}的幹部 ID 與原指派信箱不同，請先清除舊信箱，再以固定幹部 ID 指派。`);
    }
  }
}
function normalizePeopleImport(state, payload) {
  assert(payload && Array.isArray(payload.people) && payload.people.length > 0 && payload.people.length <= 200,400,'PEOPLE_IMPORT_LIMIT','每次請提供 1 到 200 位幹部。');
  const existing = new Map((state.people || []).map(row => [row.personId,row]));
  const seen = new Set();
  const people = [], changes = [];
  for (const input of payload.people) {
    assert(input && typeof input === 'object' && !Array.isArray(input),400,'INVALID_PERSON','幹部資料格式不正確。');
    const fields = {};
    for (const key of Object.keys(input)) assert(PERSON_FIELDS.includes(key),400,'UNSUPPORTED_PERSON_FIELD',`名單不接受欄位 ${key}；登入角色與權限需另行管理。`);
    for (const key of PERSON_FIELDS) if (input[key] !== undefined) {
      assert(typeof input[key] === 'string' && input[key].length <= (key.endsWith('Url') ? 2000 : 500),400,'INVALID_PERSON_FIELD',`幹部欄位 ${key} 格式不正確。`);
      fields[key] = input[key].trim();
    }
    assert(PERSON_ID.test(fields.personId || ''),400,'PERSON_ID_REQUIRED','幹部需使用固定 ITRC-P0001 格式的識別碼，不以姓名或排序產生 ID。');
    assert(fields.name,400,'PERSON_NAME_REQUIRED','請填寫幹部姓名。');
    assert(!seen.has(fields.personId),400,'DUPLICATE_PERSON_ID','同一次匯入不能重複幹部 ID。');
    seen.add(fields.personId);
    if (fields.email !== undefined) {
      fields.email = fields.email.toLowerCase();
      assert(!fields.email || EMAIL.test(fields.email),400,'INVALID_EMAIL','幹部 MAIL 格式不正確。');
    }
    if (fields.status !== undefined) assert(['active','inactive','retired','pending'].includes(fields.status),400,'INVALID_PERSON_STATUS','在任狀態需為 active、inactive、retired 或 pending。');
    for (const key of ['sourceUrl','contactSourceUrl']) if (fields[key]) {
      let url; try { url = new URL(fields[key]); } catch {}
      assert(url?.protocol === 'https:' && !url.username && !url.password,400,'INVALID_URL','名單來源需使用完整 https 網址。');
    }
    const old = existing.get(fields.personId);
    const row = {...Object.fromEntries(PERSON_FIELDS.map(key => [key,''])),...old,...fields};
    row.id = row.personId;
    row.status ||= 'pending';
    row.sourceUrl ||= WEBSITE_AUTHORITY;
    row.authorityUrl = WEBSITE_AUTHORITY;
    row.sourceAuthority = 'official-website';
    const changedFields = PERSON_FIELDS.filter(key => (old?.[key] || '') !== row[key]);
    const change = !old ? 'create' : changedFields.length ? 'update' : 'unchanged';
    people.push(row);
    changes.push({personId:row.personId,name:row.name,change,changedFields});
  }
  const merged = new Map(existing);
  for (const row of people) merged.set(row.personId,row);
  const byEmail = new Set();
  for (const row of merged.values()) if (row.email) {
    assert(!byEmail.has(row.email),400,'DUPLICATE_PERSON_EMAIL','同一個 MAIL 對應多位幹部，請先確認；不會自動合併或轉移身分。');
    byEmail.add(row.email);
  }
  const revision = [...existing.values()].sort((a,b) => a.personId.localeCompare(b.personId)).map(row => [row.personId,row.version]);
  const previewToken = createHash('sha256').update(JSON.stringify({revision,people:people.map(row => PERSON_FIELDS.map(key => row[key]))})).digest('hex');
  return {people,changes,previewToken,warnings:[
    '姓名、職稱與現任名單以官網為準；這裡保存工作台的人員對照，正式來源仍需在原表維護。',
    '只更新本次列出的固定幹部 ID；未列出的人員紀錄不刪除，MAIL 與任務不會自動轉給另一人。',
    '名單不會授予新的登入或審核權限；非當期／已卸任帳號會停止使用工作台。其他平台的帳號角色仍需另外撤銷。',
  ]};
}

module.exports = {isInactivePerson,assertActorActive,WEBSITE_AUTHORITY,PERSON_FIELDS,person,personMatches,requirePerson,validatePersonReferences,normalizePeopleImport};
