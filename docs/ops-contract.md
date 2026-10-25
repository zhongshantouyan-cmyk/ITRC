# ITRC operations workspace contract

Implementation branch: `feature/itrc-integrated-ops-20261025`. This module extends the existing React/Express application. It does not replace public CMS tables or automatically migrate live Google Sheets.

## Data ownership

- Existing Google Sheets remain the authoritative source for previously confirmed activity facts until a deliberate cutover. Imports retain source URL/date, are staged, and never write back automatically.
- The new `ops_*` namespace owns new workflow records, copy versions, approvals, tasks, jobs, and delivery evidence. It must not update public `activities` records implicitly.
- Public source control contains fictional demonstration data only. No member lists, contact history, private sponsor agreements, service credentials, or production database copies.

## API

`GET /api/ops/bootstrap` requires an existing verified Firebase identity and returns:

```json
{
  "actor": {"email":"", "name":"", "role":"officer", "canApprove":false, "canDesign":false},
  "projects":[], "events":[], "posts":[], "tasks":[], "obligations":[], "jobs":[], "audit":[],
  "settings": {"mode":"live", "integrations":{"drafting":{},"canva":{},"sheets":{}}, "sources":[]}
}
```

Every record has `id`, `version` (integer, starts 1), `createdAt`, `updatedAt`. IDs never depend on row order. Mutations require an authenticated server-side identity; do not trust any submitted actor, role, email or approval flag. Legacy shared-password JWTs are not allowed for operations.

`POST /api/ops/actions` body:

```json
{"action":"post.create","id":"optional-record-id","expectedVersion":1,"idempotencyKey":"uuid","payload":{}}
```

Return `{ok:true, record, state?}` only after durable persistence. Use 400 validation, 401 identity, 403 permission, 409 stale version/stage/idempotency collision. Idempotency is bound to actor and action payload, persisted atomically with changes. Same key/different payload is rejected. UI refreshes bootstrap after mutation; network errors do not imply success.

### Entities

- Project: `title, objective, ownerEmail, adviserEmail, status, dueDate, completionCriteria`.
- Event: `projectId, title, speaker, date, time, venue, audience, fee, registrationUrl, highlights, ownerEmail, confirmationStatus` (`draft|confirmed|changed|cancelled`), `sourceUrl, sourceDate, sourceRevision`. Missing data is not invented. Require confirmed date/speaker/venue or explicit online venue before final copy approval.
- Obligation: `projectId,eventId,title,requirements,channel,requiresSponsorReview,sourceUrl,status,ownerEmail,evidenceUrl`. Freeform requirements must be included in review and draft input.
- Post: `projectId,eventId,title,purpose,audience,highlights,cta,channel` (`instagram|story|announcement`), `scheduledAt,ownerEmail,caption,slides` (array of `{heading,body}`), `copyVersion` (starts 1), `stage` (`brief|draft|unit_review|approval|approved|design_pending|design_review|sponsor_review|ready|published|needs_revision`), `sourceEventVersion,unitReviewedVersion,approvedVersion,approvedBy,approvedAt,designCopyVersion,canvaDesignId,canvaEditUrl,designApprovedBy,sponsorApprovedVersion,publishedUrl,publishedAt,generationMethod`.
- Task: `projectId,eventId,postId,title,ownerEmail,parentId,dependsOn` (array task IDs), `dueDate,status` (`unassigned|accepted|todo|doing|blocked|delivered|done|cancelled`), `blocker,deliverableUrl,acceptanceCriteria`. Reject cycles/missing parent/dependencies; blockers remain visible. No requirement that every routine update wait for adviser approval.
- Job: `id,postId,copyVersion,type,status` (`queued|running|succeeded|blocked_configuration|failed|needs_reconciliation|obsolete`), `attempts,lastError,providerJobId,result,createdAt,updatedAt`.
- Audit: append-only `action,actorEmail,entityId,fromVersion,toVersion,createdAt,summary`.

### Commands

- `project.create`, `project.update`
- `event.create`, `event.update`, `event.confirm` (owner/adviser; preserve source). Event changes invalidate dependent unpublished approvals/designs; published posts retain publication evidence and create a correction task. No automatic public-site publication.
- `obligation.create`, `obligation.update` (changes invalidate affected unpublished posts)
- `task.create`, `task.update` (owner/adviser controls owner/terminal status; direct progress updates permitted)
- `post.create`, `post.update` (changes to copy increment `copyVersion` and invalidate prior reviews), `post.generate` (deterministic labelled draft fallback or configured provider), `post.submit` (to unit_review), `post.unit-review` (owner/adviser -> approval), `post.approve` (only configured final approver, creates one design job), `post.reject` (reviewer with reason), `post.request-design` (approved current version only), `post.attach-design` (validated canva.com edit URL; current approved version only), `post.design-review` (configured designer/adviser; current design version; -> sponsor_review if required else ready), `post.sponsor-review` (explicit confirmation + evidence by allowed reviewer; -> ready), `post.publish` (only ready/current approvals, valid https publication URL/time; preserves evidence).
- `job.retry` (do not blindly repeat unknown-result writes), `jobs.run` (adviser; bounded 1-5 jobs; provider settings checked)
- `import.preview` payload `{events:[...], posts:[...], tasks:[...]}`: adviser-only; validate at most 200 staged rows, return preview, do not insert business records. Each row retains either `sourceUrl` or `sourceLabel` (original local filename), optional `sourceDate/sourceRevision`, and stable `sourceKey`. Each promotional row links to an existing `eventId` or an `eventSourceKey` matching an imported/existing event's `sourceKey`. Explicit source keys are recommended; fallback hashes use source and content identity, never row order. Local Excel/CSV sources do not need a public upload URL.
- `import.apply` payload same: adviser-only; revalidate preview semantics, import events first and then promotional rows, preserve source evidence, and never import approvals. Activities start as `draft`; posts start as `brief` or `draft`. A repeated source key is skipped, not overwritten.
- `import.sheet-preview` payload `{sourceId}`: adviser-only, reads only a server allowlisted source from `OPS_SHEET_SOURCES_JSON` and returns `{record:preview, staged:{events,posts,tasks}}`. Source definitions use `{id,name,spreadsheetId,range,kind,columns}` with kind `events|posts|tasks` and columns mapping record field names to source header names. No arbitrary spreadsheet ID/range can be supplied by the browser.
- `event.cancel` requires owner/adviser and `{reason}`; invalidates unpublished approvals and preserves published evidence with correction tasks.

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

Final approver and designer email lists are environment configuration (`OPS_APPROVER_EMAILS`, `OPS_DESIGNER_EMAILS`). Empty list means these actions are not enabled; server verifies both Firebase identity and configured email. Role simulation exists in fictional demonstration mode only and cannot authorize a production request.

## Frontend

Page `client/src/pages/OpsPage.jsx`, CSS `client/src/pages/ops.css`, optional supporting files under `client/src/ops/`. Root agent mounts `/ops` behind existing ProtectedRoute. A separate `/ops-demo` is fictional, browser-local demonstration, visibly labelled and cannot call production API or present external generation as complete.

Tabs: 工作總覽 / 活動與專案 / 宣傳製作 / 我的任務 / 審核與紀錄 / 系統連線. Readable Traditional Chinese, responsive, keyboard-accessible, useful empty/error/loading states. Show explicit next action and reason unavailable. Integration status must distinguish configured, unavailable and unverified. No destructive bulk deletion. User editing fields and separate unit/final review must work.

## Test priorities

Wrong principal/legacy token cannot approve; record version and copy version conflicts; obligations/date edits invalidate approvals; published evidence retained with correction tasks; idempotent concurrent calls; task dependency cycles; missing provider secrets; uncertain Canva result cannot be retried into duplicates; persisted records survive reopening; production API never uses demo actors; frontend build succeeds; existing public routes remain untouched.
