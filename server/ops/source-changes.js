'use strict';

const { createHash } = require('node:crypto');
const { assert } = require('./errors');

// These are review/export snapshots. The existing FileOS files remain authoritative.
const SOURCE_FIELDS = {
  events: ['title','speaker','date','time','venue','audience','fee','registrationUrl','highlights','ownerPersonId','confirmationStatus'],
  posts: ['title','eventId','purpose','audience','highlights','cta','channel','scheduledAt','caption','slides','copyVersion','stage','approvedVersion','approvedAt','canvaEditUrl','designCopyVersion','publishedUrl','publishedAt','ownerPersonId'],
  tasks: ['title','projectId','eventId','postId','ownerPersonId','reviewerPersonId','dueDate','status','acceptanceCriteria','deliverableUrl','acceptedAt','reviewIdentityMode','reviewEvidenceUrl'],
};
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function text(value, label, limit = 2000) {
  assert(typeof value === 'string' && value.trim() && value.length <= limit,400,'SOURCE_FIELD_REQUIRED',`${label}需填寫完整，最多 ${limit} 字。`);
  return value.trim();
}
function snapshot(record, kind) {
  return Object.fromEntries(SOURCE_FIELDS[kind].filter(key => record[key] !== undefined).map(key => [key,structuredClone(record[key])]));
}
function latestWriteback(state, sourceUrl, sourceKey) {
  return (state.sourceChanges || []).filter(item => item.sourceUrl === sourceUrl && item.sourceKey === sourceKey && item.status === 'written_back')
    .sort((a,b) => (Number(b.writebackSequence) || 0) - (Number(a.writebackSequence) || 0) || String(b.writtenBackAt || b.updatedAt).localeCompare(String(a.writtenBackAt || a.updatedAt)) || b.id.localeCompare(a.id))[0];
}
function sourcePackage(change) {
  const payload = {
    schema: 'itrc.fileos-change.v1', changeId: change.id,
    status: 'approved_pending_writeback', sourceUrl: change.sourceUrl,
    sourceKey: change.sourceKey, expectedSourceRevision: change.baseSourceRevision,
    previousWritebackId: change.baseWritebackId || '', previousWritebackSequence: change.baseWritebackSequence || 0,
    targetKind: change.targetKind, workflowRecordId: change.targetId,
    workflowVersion: change.targetVersion, values: structuredClone(change.values),
    approvedAt: change.approvedAt, approvedBy: change.approvedBy,
    reason: change.reason, writeMode: 'reviewed_manual_writeback',
    instructions: '核對原始檔目前版本仍相同後，依固定來源鍵寫回；不得整表覆蓋。這份檔案本身不代表原始檔已更新。',
  };
  return {...payload,checksumSha256:digest(payload)};
}

function executeSourceAction(state, command, actor, now, helpers) {
  const {find,versionCheck,newRecord,touch,audit,isAdvisor,requireManage,httpsUrl} = helpers;
  const {action,id,expectedVersion,payload = {}} = command;
  state.sourceChanges ||= [];
  if (action === 'source-change.propose') {
    assert(['events','posts','tasks'].includes(payload.targetKind),400,'SOURCE_KIND_INVALID','只接受活動、宣傳或任務的來源更新。');
    const target = find(state,payload.targetKind,payload.targetId);
    requireManage(state,actor,target);
    versionCheck(target,payload.targetVersion);
    const sourceUrl = text(payload.sourceUrl || target.sourceUrl,'正式來源網址');
    httpsUrl(sourceUrl,'正式來源網址',{optional:false});
    if (target.sourceUrl) assert(sourceUrl === target.sourceUrl,409,'SOURCE_TARGET_MISMATCH','正式來源需與這筆工作原本的來源相同，請先核對資料對照。');
    const sourceKey = text(payload.sourceKey || target.sourceKey,'來源固定識別碼',200);
    if (target.sourceKey) assert(sourceKey === target.sourceKey,409,'SOURCE_TARGET_MISMATCH','來源識別碼與原本對照不同，請先核對資料。');
    const baseSourceRevision = text(payload.baseSourceRevision,'目前正式來源版本');
    const priorWriteback = latestWriteback(state,sourceUrl,sourceKey);
    const knownRevision = priorWriteback?.appliedSourceRevision || target.sourceRevision;
    if (knownRevision) assert(baseSourceRevision === knownRevision,409,'SOURCE_REVISION_CONFLICT','正式來源版本與上次核對紀錄不同，請先確認最新來源及更新工作資料。');
    const prior = state.sourceChanges.find(change => change.targetKind === payload.targetKind && change.targetId === target.id && change.targetVersion === target.version && ['pending','approved'].includes(change.status));
    if (prior) return {ok:true,record:prior};
    const change = newRecord({targetKind:payload.targetKind,targetId:target.id,targetVersion:target.version,title:target.title,
      sourceUrl,sourceKey,baseSourceRevision,baseWritebackId:priorWriteback?.id || '',baseWritebackSequence:priorWriteback?.writebackSequence || 0,reason:text(payload.reason,'更新原因'),values:snapshot(target,payload.targetKind),
      status:'pending',proposedBy:actor.email,proposedAt:now},now);
    change.snapshotHash = digest(change.values);
    state.sourceChanges.push(change);
    audit(state,actor,action,change,0,now,`提出「${target.title}」的正式來源更新；原始檔尚未修改。`);
    return {ok:true,record:change};
  }
  const change = find(state,'sourceChanges',id);
  versionCheck(change,expectedVersion);
  assert(isAdvisor(actor),403,'ADVISOR_REQUIRED','正式來源更新由社長或顧問核對與記錄。');
  const from = change.version;
  const assertCurrent = () => {
    const target = find(state,change.targetKind,change.targetId);
    assert(target.version === change.targetVersion && digest(snapshot(target,change.targetKind)) === change.snapshotHash,409,'SOURCE_WORKFLOW_CHANGED','工作資料已更新，這份來源提案不能繼續使用；請退回後依最新版本重提。');
    const priorWriteback = latestWriteback(state,change.sourceUrl,change.sourceKey);
    assert((priorWriteback?.id || '') === (change.baseWritebackId || '') && (priorWriteback?.writebackSequence || 0) === (change.baseWritebackSequence || 0),409,'SOURCE_REVISION_CONFLICT','此來源已被另一筆提案回寫，請先核對最新來源。');
    if (priorWriteback) assert(priorWriteback.appliedSourceRevision === change.baseSourceRevision,409,'SOURCE_REVISION_CONFLICT','來源版本已改變，不能依舊版本回寫。');
  };
  if (action === 'source-change.reject') {
    assert(['pending','approved'].includes(change.status),409,'SOURCE_STAGE_INVALID','只有待確認或待回寫的提案可以退回。');
    change.status = 'rejected'; change.reviewReason = text(payload.reason,'退回原因');
  } else if (action === 'source-change.approve') {
    assert(change.status === 'pending',409,'SOURCE_STAGE_INVALID','這份提案目前不在待確認階段。');
    assertCurrent();
    assert(payload.confirmedSourceReview === true,400,'SOURCE_CONFIRMATION_REQUIRED','請開啟正式來源，核對固定識別碼、內容及版本後再確認。');
    assert(payload.observedSourceRevision === change.baseSourceRevision,409,'SOURCE_REVISION_CONFLICT','你核對到的正式來源版本已不同，請先處理差異。');
    change.status = 'approved'; change.approvedAt = now; change.approvedBy = actor.email;
    change.sourceCheckMode = 'human_verified';
  } else if (action === 'source-change.export') {
    assert(change.status === 'approved',409,'SOURCE_APPROVAL_REQUIRED','先核准這份提案，再匯出回寫包。');
    assertCurrent();
    change.exportedAt = now; touch(change,now);
    audit(state,actor,action,change,from,now,'匯出已核准回寫包；尚未確認原始檔已更新。');
    return {ok:true,record:{changeId:change.id,package:sourcePackage(change)}};
  } else if (action === 'source-change.record-writeback') {
    assert(change.status === 'approved',409,'SOURCE_APPROVAL_REQUIRED','只有已核准的提案可記錄回寫完成。');
    assertCurrent();
    assert(payload.confirmedSourceWriteback === true,400,'SOURCE_CONFIRMATION_REQUIRED','請先在指定原始檔完成寫入並回讀確認，再登錄結果。');
    assert(payload.observedSourceRevision === change.baseSourceRevision,409,'SOURCE_REVISION_CONFLICT','寫入前的正式來源版本與核准版本不一致。');
    const revision = text(payload.appliedSourceRevision,'回寫後來源版本');
    assert(revision !== change.baseSourceRevision,400,'SOURCE_NEW_REVISION_REQUIRED','請填寫這次回寫後的新來源版本。');
    httpsUrl(text(payload.evidenceUrl,'回寫證據網址'),'回寫證據',{optional:false});
    change.status = 'written_back'; change.appliedSourceRevision = revision;
    change.writebackEvidenceUrl = payload.evidenceUrl; change.writtenBackAt = now; change.writtenBackBy = actor.email;
    change.writebackMode = 'human_recorded';
    change.writebackSequence = (change.baseWritebackSequence || 0) + 1;
  } else {
    assert(false,400,'UNKNOWN_ACTION','不支援這項來源更新操作。');
  }
  touch(change,now);
  audit(state,actor,action,change,from,now,({approved:'已核准來源更新，等待寫回原始檔。',rejected:`退回來源更新：${change.reviewReason}`,written_back:'已由管理者登錄原始檔回寫結果與證據；未自動改寫外部檔案。'})[change.status]);
  return {ok:true,record:change};
}

module.exports = {executeSourceAction,sourcePackage,SOURCE_FIELDS};
