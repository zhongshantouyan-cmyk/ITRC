# ITRC operations workspace contract

Current workflow contract: 2026-10-26 simplified student-club release. This module extends the existing React/Express application. Deployment evidence is recorded separately in `ops-validation.md`; this contract does not assert a release is already live.

## Data ownership

- Existing FileOS Excel/Markdown files and designated Google Sheets remain the authoritative business sources. Imports retain source URL/date, are staged, and never write back automatically.
- The new `ops_*` namespace owns new workflow records, copy versions, approvals, tasks, jobs, and delivery evidence. It must not update public `activities` records implicitly.
- Public source control contains fictional demonstration data only. No member lists, contact history, private sponsor agreements, service credentials, or production database copies.

## API

`GET /api/ops/bootstrap` requires an existing verified Firebase identity and returns:

```json
{
  "actor": {"email":"", "name":"", "role":"officer", "canApprove":false, "canDesign":false},
  "projects":[], "events":[], "posts":[], "tasks":[], "people":[], "sourceChanges":[], "obligations":[], "jobs":[], "audit":[],
  "settings": {"mode":"live", "integrations":{"drafting":{},"canva":{},"sheets":{}}, "sources":[]}
}
```

Every record has `id`, `version` (integer, starts 1), `createdAt`, `updatedAt`. IDs never depend on row order. Mutations require an authenticated server-side identity; do not trust any submitted actor, role, email or approval flag. Legacy shared-password JWTs are not allowed for operations.

`POST /api/ops/actions` body:

```json
{"action":"post.create","id":"optional-record-id","expectedVersion":1,"idempotencyKey":"uuid","payload":{}}
```

Return `{ok:true, record, state?}` only after durable persistence. Use 400 validation, 401 identity, 403 permission, 409 stale version/stage/idempotency collision. Idempotency is bound to actor and action payload, persisted atomically with changes. Same key/different payload is rejected. UI refreshes bootstrap after mutation; network errors do not imply success.

### Entities and current commands

All ordinary event, post and task edits require an authenticated, currently authorized officer. They do not require ownership, a separate reviewer or configured final-approver email. Retired/inactive access denial, source integrity, version checks and financial permissions remain in force.

- Event: `title,eventType,projectId,date,time,venue,speaker,audience,fee,registrationUrl,highlights,ownerPersonId,ownerEmail,confirmationStatus,status` and source metadata. `eventType` is `lecture|activity`; missing legacy values mean lecture. `event.set-status {status:'todo'|'doing'|'done'}` records progress independently of fact confirmation; an elapsed date never means done. `event.confirm {}` returns `reviewed` when relevant facts are missing, `confirmed` when present. Missing facts remain visible and do not block promotion work; general activities do not require a speaker. `event.create/update` never invent missing dates, venues or people.
- Task: `title,notes,dueDate,status,ownerPersonId,ownerEmail,deliverableUrl` and optional existing project/event/post/parent/dependency references. `task.set-status {status:'todo'|'doing'|'done'}` and `task.create/update` support direct completion by a current officer. Owner, deadline, reviewer, criteria, evidence link and return reason are optional. Preserve `deliveryHistory` and audit; member-recorded completion captures the actual actor and time. Legacy deliver/submit/accept commands map to done, return/reopen to todo. Retain old records and dependency integrity; dependency completion is not a routine completion gate.
- Post: `eventId,projectId,title,purpose,audience,highlights,cta,channel,scheduledAt,ownerPersonId,ownerEmail,caption,slides,copyVersion` plus confirmation, design, history and publication evidence. Current user flow is draft → copy confirmed → completed/published. Legacy stages remain readable.
- `post.confirm {}` confirms a nonempty current caption once, without a unit/final/design review chain. It does not enqueue work automatically. `post.unconfirm {reason?}` withdraws confirmation. `post.update`, `post.generate` and `post.restore-version` are collaborative; copy or underlying fact changes invalidate old confirmation/design work. Restore creates a new draft, never revives an approval.
- `post.request-design {}` requires only current copy confirmation and queues a durable job. `post.attach-design {canvaEditUrl,canvaDesignId?}` accepts a validated HTTPS Canva link even on a draft, without claiming confirmation. `post.complete {canvaEditUrl?,canvaDesignId?,publishedUrl?,publishedAt?}` requires current copy confirmation but no second reviewer, design acceptance or publication URL. `post.publish` records an already performed publication, never sends a social post. Published evidence remains immutable; corrections use a new draft/task. Late jobs cannot overwrite a manually completed post.
- Legacy post submit/unit-review/approve commands remain compatible with one copy confirmation; legacy approve also queues a design job. Optional design/sponsor review records are retained, not required daily gates.
- `task.comment {text,attachmentUrl?}` and `task.add-link {title,url}` are available to current officers. Server-supplied author/time and old evidence are preserved; no binary upload or notification is implied.
- Projects and obligations retain existing management authority. Ordinary project completion does not require independent task acceptance. `event.cancel {reason}` retains the existing owner/adviser authority and published correction evidence.
- Jobs retain `queued|running|succeeded|blocked_configuration|failed|needs_reconciliation|obsolete`, attempts, provider IDs and errors. `job.retry` must not blindly repeat unknown-result writes; `jobs.run` remains bounded and administrative.
- `import.preview` / `import.apply` accept at most 200 rows across `{events,posts,tasks}`, require administrative authority and stable source evidence (`sourceKey` plus `sourceUrl` or `sourceLabel`, optional date/revision). Preview has no business writes; apply revalidates and skips duplicate keys without overwriting existing records. Posts link by an existing `eventId` or matching `eventSourceKey`. Events/posts never import approvals. Explicit task `todo|doing|done` survives import; missing means todo, unknown status is rejected. Imported done uses `completionMode:'imported_status'` without fabricated completion time/person. Historical delivered means doing during import; other known aliases are normalized. Task 備註 maps to `notes`.
- `import.sheet-preview {sourceId}` reads only server-allowlisted `{id,name,spreadsheetId,range,kind,columns}` definitions; browsers cannot select arbitrary sheets/ranges.
- Audit is append-only. Neither ordinary completion nor import grants roles, changes financial approval rules or implicitly publishes CMS data.

## Integrations (server-owned configuration)

Owned by `server/ops/providers.js` (integration agent). Export:

```js
getIntegrationStatus(env = process.env) // safe booleans/status/missing variable names only
generateCopy({event,post,obligations}, {env,fetchImpl} = {}) // {caption,slides,generationMethod}; missing AI configuration -> labelled deterministic draft; provider failure throws, never fake success
createCanvaDesign({post,event,obligations}, {env,fetchImpl} = {}) // one provider request; returns {providerJobId, status}; requires approved current version
getCanvaJob(providerJobId, {env,fetchImpl} = {}) // {status, canvaDesignId?,canvaEditUrl?,error?}
readSheetSource({spreadsheetId,range}, {env,fetchImpl} = {}) // bounded read only; credentials stay on server
```

No secret values in responses, logs, frontend, repository, PR, or saved artifacts. No default model guessed; optional `OPENAI_MODEL` and key are required for AI requests. Canva configuration uses explicitly mapped template/design data fields and obtains credentials from the server environment. Never overwrite human-edited designs; always create a new design. Missing credentials produce a visible blocked job. Timeout/uncertain write is `needs_reconciliation`, not auto-retried. Never send email or post to social media; publication tracking records authorized human-published evidence.

`OPS_APPROVER_EMAILS` and `OPS_DESIGNER_EMAILS` remain legacy capability metadata. They are not prerequisites for ordinary copy confirmation, editing, attaching designs or completion. The server still verifies Firebase identity, permitted club role and active roster status. Role simulation exists in fictional demonstration mode only and cannot authorize a production request.

## Frontend

Page `client/src/pages/OpsPage.jsx`, CSS `client/src/pages/ops.css`, optional supporting files under `client/src/ops/`. Root agent mounts `/ops` behind existing ProtectedRoute. A separate `/ops-demo` is fictional, browser-local demonstration, visibly labelled and cannot call production API or present external generation as complete.

The main workspace combines activities and their promotions, shows routine tasks as 待辦／進行中／完成, and exposes existing finance, speaker, sponsor, marketing and certificate tools under the same origin (`/ops?tool=<id>`, files under `/tools/`). Finance keeps its own strict review and ledger permissions. Advanced source/version/connection controls stay in settings. Integration status distinguishes configured, unavailable and verified; same-origin navigation does not claim automatic source synchronization. `/ops-demo` remains fictional and browser-local.

## Test priorities

Unknown/retired principals and legacy tokens cannot access operations; active officers can collaborate without owner/reviewer gates; direct task/activity completion and reopening preserve history; record version and copy version conflicts; obligations/date edits invalidate approvals; published evidence retained with correction tasks; idempotent concurrent calls; task dependency cycles; missing provider secrets; uncertain Canva result cannot be retried into duplicates; persisted records survive reopening; production API never uses demo actors; frontend build succeeds; existing public routes remain untouched.


## 2026-10-26 release additions

- People status includes `retired` (confirmed departure), distinct from `inactive` (not on current roster). Both remove eligibility for new assignment and deny workbench bootstrap/actions by matching verified account email. The store checks the roster inside write transactions before serving an idempotency replay. This does not grant/rewrite Firebase roles; other platforms require their own revocation.
- `task.comment` accepts `{text, attachmentUrl?}`; `task.add-link` accepts `{title,url}`. Any currently authorized officer can append. User-provided actor fields are rejected. History snapshots retain the links present at each delivery/acceptance. No binary uploads or notification sends occur.
- `event.preview-checklist` returns the eight `itrc-lesson-v1` tasks with suggested dates; `event.apply-checklist` requires `{templateId:'itrc-lesson-v1',confirmed:true}`, ownership and the unchanged event version. Tasks have optional assignees, are source-labelled and deduplicated by event/template item; no activity facts or approvals are invented.
- `sourceChanges` is an `ops_records` kind for proposals and evidence, not canonical business data. Commands: `source-change.propose`, `.approve`, `.reject`, `.export`, `.record-writeback`. Propose includes `targetKind`, `targetId`, `targetVersion`, `sourceUrl`, `sourceKey`, `baseSourceRevision`, `reason`; server snapshots explicitly allowed fields. Approval requires a manager and `confirmedSourceReview:true` plus exactly matching `observedSourceRevision`. The approved export includes a SHA-256 checksum and remains pending external writeback. `record-writeback` additionally requires `confirmedSourceWriteback:true`, unchanged observed prior revision, a different `appliedSourceRevision`, and HTTPS `evidenceUrl`.
- Source-change actions never write external files or silently modify business records. Source revision confirmation is human-supplied, not automatically verified against Drive. The existing FileOS inbox remains the canonical intake: the UI reason can retain its URL/row/message ID, and a real pending proposal has been manually cross-referenced at row 301. This is a manual evidence link, not automatic Sheets writeback or a second canonical queue.
