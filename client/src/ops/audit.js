// Both the durable store and demo return audit entries newest first.
// Preserve that ordering (including ties) and never mutate shared state.
export function recentAuditEntries(entries = []) {
  return entries.slice(0, 30);
}

export function auditActorLabel(entry) {
  return entry.actorName || entry.actorEmail || '未記錄操作者';
}
