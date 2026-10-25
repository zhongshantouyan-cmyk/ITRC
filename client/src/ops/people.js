import { isAdviser } from './model.js';

export const PERSON_STATES = { active: '在任', inactive: '非當期名單', retired: '已卸任', pending: '待確認' };
export const isInactivePerson = person => ['inactive', 'retired'].includes(person?.status);
export const personById = (people = [], id) => people.find(person => person.personId === id);
export const LEGACY_ASSIGNEE = '__keep_legacy_email__';
export const assignmentFormValue = record => record?.ownerPersonId || (record?.ownerEmail ? LEGACY_ASSIGNEE : '');
export function assignmentPayload(value, record) {
  return value === LEGACY_ASSIGNEE ? { ownerPersonId: '', ownerEmail: record?.ownerEmail || '' } : { ownerPersonId: value || '', ownerEmail: '' };
}
export function assignmentOptions(people, record) {
  return [...(record?.ownerEmail && !record.ownerPersonId ? [{ value: LEGACY_ASSIGNEE, label: `${record.ownerEmail}（原指派，待對照）` }] : []), ...personOptions(people, record?.ownerPersonId)];
}
export const personLabel = person => person ? [person.name, person.title || person.group].filter(Boolean).join(' · ') : '';
export function personOptions(people = [], currentId = '') {
  return people.filter(person => !isInactivePerson(person) || person.personId === currentId)
    .map(person => ({ value: person.personId, label: `${personLabel(person)}${isInactivePerson(person) ? `（${PERSON_STATES[person.status]}，保留歷史）` : person.status === 'pending' ? '（待確認）' : ''}` }));
}
export function ownerLabel(record, people = []) {
  const person = personById(people, record?.ownerPersonId);
  return personLabel(person) || (record?.ownerPersonId ? `待核對人員 ${record.ownerPersonId}` : record?.ownerEmail || '待指派');
}
export const hasAssignee = task => !!(task.ownerPersonId || task.ownerEmail);
export function matchesPerson(task, person, actorEmail = '') {
  if (task.ownerPersonId) return !!person && task.ownerPersonId === person.personId;
  const email = person?.email || actorEmail;
  return !!email && task.ownerEmail?.toLowerCase() === email.toLowerCase();
}
export function actorPerson(actor, people = []) {
  return people.find(person => !isInactivePerson(person) && person.email && person.email.toLowerCase() === actor?.email?.toLowerCase());
}
export function canReviewTask(actor, task, people = []) {
  const reviewer = personById(people, task.reviewerPersonId);
  return isAdviser(actor) || !!reviewer?.email && !isInactivePerson(reviewer) && reviewer.email.toLowerCase() === actor?.email?.toLowerCase();
}
export function taskDeliveryReason(task, tasks = [], people = []) {
  if (!hasAssignee(task)) return '先指派實際承辦人';
  if (!task.reviewerPersonId) return '先指定驗收人';
  if (task.ownerPersonId === task.reviewerPersonId) return '承辦人與驗收人需要分開';
  const owner = personById(people, task.ownerPersonId), reviewer = personById(people, task.reviewerPersonId);
  if (isInactivePerson(owner) || isInactivePerson(reviewer)) return '承辦人或驗收人已非現任，請先完成改派';
  if (reviewer?.email && reviewer.email.toLowerCase() === (owner?.email || task.ownerEmail)?.toLowerCase()) return '承辦人與驗收人需要分開';
  if (!task.acceptanceCriteria?.trim()) return '先填寫驗收標準';
  if ((task.dependsOn || []).some(id => tasks.find(item => item.id === id)?.status !== 'done')) return '前置任務尚未驗收';
  if (task.id && tasks.some(item => item.parentId === task.id && item.requiredForCompletion !== false && item.status !== 'done')) return '必要子任務尚未驗收';
  return '';
}
export function projectPendingTasks(projectId, tasks = []) {
  if (!projectId) return [];
  return tasks.filter(task => task.projectId === projectId && task.requiredForCompletion !== false && task.status !== 'done');
}

export function taskGroups(task, people = []) {
  const person = personById(people, task.ownerPersonId) || (!task.ownerPersonId && people.find(row => row.email && row.email.toLowerCase() === task.ownerEmail?.toLowerCase()));
  return [...new Set((person?.group || '').split(/[、,，/；;]+/u).map(group => group.trim().replace(/組$/, '')).filter(Boolean))];
}
