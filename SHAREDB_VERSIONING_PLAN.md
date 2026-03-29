# ShareDB Versioning + Agent Attribution Plan

## Goal
Add reliable operation history for agent writes so every agent change is:

1. Attributed (`who/what/when`)
2. Versioned (`from version`, `to version`)
3. Revertible (safe undo path)

## Scope
- Track all **agent-initiated document writes**.
- Keep existing ShareDB behavior for collaborative editing.
- Add app-level history for audit + undo.

## Non-Goals (Phase 1)
- Rewriting/deleting historical rows from ShareDB `ops`.
- Full arbitrary historical rebase undo for heavily diverged docs.

## Current State
- ShareDB already versions ops (`ops.version`).
- Writes can pass a `source`, but detailed attribution and undo metadata are not consistently stored in app-level history.
- Tool writes mostly funnel through patch persistence helpers, with a few direct `submitOp` paths.

## Proposed Design

## 1) Add App-Level History Table
Create `agent_operation_history` in Postgres with:
- `id`
- `collection`
- `doc_id`
- `source` (`agent`/`user`/`backend`)
- `actor_type`
- `actor_id`
- `activity_type` (`write`/`rollback`/`restore`)
- `sharedb_version_from`
- `sharedb_version_to`
- `operation_kind` (`patch_tuples` or `raw_op`)
- `operation_payload` (forward + inverse data)
- `metadata` (threadId, runId, toolName, userId, etc.)
- `target_operation_ids` (array of operation ids affected by rollback/restore)
- `created_at`
- `reverted_at`
- `reverted_by_operation_id`
- `revert_sharedb_version_from`
- `revert_sharedb_version_to`

Indexes:
- `(doc_id, created_at desc)`
- pending rows (`reverted_at is null`)

## 2) Centralize Write Path
Ensure all mutating operations go through wrappers:
- `persistPatchTuples(...)`
- `submitShareDBOp(...)`

Wrapper responsibilities:
- Capture `versionFrom` before submit
- Submit op
- Capture `versionTo` after submit
- Persist history row (for source=`agent`)

## 3) Attribution Context
Introduce request/run-scoped attribution context:
- `source`
- `actorType`
- `actorId`
- `threadId`
- `userId`
- `docId`
- `runId`
- `toolName`

Fallback defaults:
- `source=agent`
- `actorType=assistant`
- `actorId=spreadsheet-assistant`

## 4) Undo Strategy
Support two undo entry points:
- `undoLatestAgentOperation(docId)`
- `undoAgentOperationById(docId, operationId)`

Behavior:
- Load pending history row
- Build inverse operation
  - patch entries: reverse order + inverse patch direction
  - raw ops: use stored inverse json0 op
- Submit inverse as `source=backend` and persist a new history row with `activity_type=rollback`
- Mark original row as reverted with revert version metadata

Important:
- A rollback is an activity by itself and must be queryable via `GET /activity`.
- Rollback rows must store forward + inverse payload so they are also revertible.
- This enables rollback-of-rollback (effectively re-apply of the original changes).

## 5) Conflict and Safety Rules
- If operation already reverted: return no-op error.
- If operation belongs to different doc: reject.
- If inverse cannot be generated/applied: fail safely and keep row unreverted.
- Start with “latest-first” undo as the default safe path.

## 6) API/CLI Surface
Add internal interfaces:
- `listAgentOperations(docId, limit)`
- `undoLatestAgentOperation(docId)`
- `undoAgentOperationById(docId, operationId)`
- `undoActivityOperationById(docId, operationId)` (supports `write` and `rollback`)

Optional admin endpoint/CLI:
- list pending operations
- revert selected operation

## 7) Y/hub-Like Activity + Rollback/Restore API
Support an API surface similar to y/hub for document activity tracking and selective rollback.

Target API shape (internal first, then public):
- `GET /activity/{docId}`
  - filters: `from`, `to`, `by`, `limit`, `order`, `group`, `activityTypes`
  - returns timeline entries with actor + version/time boundaries
- `GET /changeset/{docId}`
  - filters: `fromVersion`, `toVersion` (or `from`, `to` timestamps)
  - optional: `attributions=true`, `delta=true`
  - returns computed diff/change summary for the selected window
- `POST /rollback/{docId}`
  - selectors: `operationIds`, `by`, `from`, `to`, `contentSelectors`, `activityTypes`
  - rolls back matching activity by applying inverse operations
- `POST /restore/{docId}`
  - supports restore semantics:
    - `restoreTo` (restore document state to a target version/timestamp)
    - `restoreRange` (re-apply/restore only a selected activity window from `from -> to`)

Implementation note:
- Phase 1 API can operate on operation-level attribution.
- Phase 2 adds content-level selectors matching y/hub-style attributed filtering.
- Align with y/hub semantics: rollback writes are attributable activities, not hidden system side effects.
- Default `activityTypes` for rollback should be `["write"]` for safety.
- To rollback a rollback, caller passes `activityTypes=["rollback"]` or explicit rollback `operationIds`.

### 7.1) Rollback-of-Rollback Execution Steps
1. User/API requests rollback of operation `A`.
2. Service applies inverse(`A`) and writes a new history row `R1` with:
   - `activity_type=rollback`
   - `target_operation_ids=[A]`
   - forward payload = inverse(`A`) that was applied
   - inverse payload = operation that would undo `R1`
3. Service marks `A.reverted_at` and `A.reverted_by_operation_id=R1.id`.
4. Later, user/API requests rollback of `R1` (explicit id or `activityTypes=["rollback"]` selector).
5. Service applies inverse(`R1`) and writes `R2` (`activity_type=rollback`), which functionally restores `A`.

## 8) Fine-Grained Attribution Index (Content-Level)
To support selective rollback/restore by affected content (similar to Yjs content attribution maps), add a second index table:
- `agent_operation_content_index`
  - `operation_id` (fk to `agent_operation_history.id`)
  - `doc_id`
  - `sheet_id` (nullable)
  - `content_selector` (canonical path/range, e.g. `sheet:1!A1:C4` or structured json path)
  - `change_kind` (`insert`, `update`, `delete`, `format`, `structure`)
  - `created_at`

Purpose:
- Query “what changed where” efficiently.
- Roll back by actor/time/content slice, not only by whole operation ID.

Spreadsheet-specific strategy:
- Derive touched selectors from patch tuples/json0 paths.
- Normalize to deterministic selectors so query filters are stable.

## 9) Optional Performance Layer: Postgres MilestoneDB
Add a ShareDB `milestoneDb` adapter backed by Postgres to accelerate historical snapshot reconstruction.

Purpose:
- Speed up `fetchSnapshot` for older versions/timestamps by reducing the number of ops replayed.
- Keep this independent from agent-operation audit/undo data.

Table proposal (`milestones`):
- `collection`
- `doc_id`
- `version`
- `snapshot` (`jsonb`)
- `mtime` (`timestamptz` from snapshot metadata)
- `created_at`

Indexes:
- unique `(collection, doc_id, version)`
- `(collection, doc_id, mtime)`

Adapter methods to implement:
- `saveMilestoneSnapshot(collection, snapshot, callback)`
- `getMilestoneSnapshot(collection, id, version, callback)`
- `getMilestoneSnapshotAtOrBeforeTime(collection, id, timestamp, callback)`
- `getMilestoneSnapshotAtOrAfterTime(collection, id, timestamp, callback)`

Integration:
- Pass `milestoneDb` into ShareDB backend constructor.
- Control save frequency with `commit` middleware (`request.saveMilestoneSnapshot`) by collection/doc type.

Notes:
- This is a performance optimization; it is not required for attribution or undo correctness.
- Start with conservative intervals (for example 500-1000 versions), then tune from production metrics.

## 10) Rollout Plan
1. DB migration
2. Repository + wrappers
3. Hook write paths
4. Add undo services (latest + by operation id)
5. Add activity/changeset/rollback/restore APIs
6. Add rollback-as-activity persistence (including rollback-of-rollback support)
7. Implement History toolbar button + activity panel (read-only v1)
8. Add content-level attribution index
9. Add tests
10. (Optional) Add Postgres MilestoneDB
11. Enable UI/admin controls

## 11) Testing Plan
- Unit:
  - inverse generation for supported op types
  - patch tuple undo transformation
  - selector extraction from patch paths/ranges
- Integration:
  - write -> history row created
  - undo -> doc updated + row marked reverted
  - invalid undo cases (wrong doc, already reverted)
  - rollback by actor/time/content selector
  - rollback generates its own activity row (`activity_type=rollback`)
  - rollback-of-rollback restores prior state and keeps chain (`A -> R1 -> R2`)
  - history panel lists activities for the target `doc_id` in descending timestamp order
  - history panel pagination (`cursor`) appends correctly without duplicates
  - history panel loading/empty/error states render correctly
  - restoreTo and restoreRange correctness
- Concurrency:
  - concurrent writes + latest undo behavior
- Milestones (optional):
  - milestone save/retrieve by version
  - milestone save/retrieve by timestamp
  - fallback correctness when milestone missing

## 12) Risks
- Undoing old operations after heavy downstream edits can conflict.
- Some json0 operations may not be safely invertible without richer metadata.
- Overly aggressive milestone frequency increases storage and write amplification.
- Content selector extraction can be lossy if operation semantics are ambiguous.

Mitigation:
- prefer latest-first undo in phase 1
- mark non-invertible operations explicitly
- use measured milestone intervals and retention policies
- store both raw operation payload and normalized selector metadata
- add stronger rebase strategy in phase 2

## 13) Phase 2 Improvements
- Batch operations by assistant run/tool invocation.
- Add “preview undo impact” endpoint.
- Add richer conflict diagnostics and assisted rebase workflow.

## 14) Y/hub Feature Parity Checklist (ShareDB-Based)
Goal: achieve behavioral parity with Y/hub while staying fully on ShareDB (no Yjs/ydoc dependency).

### 14.1 Parity Scope
- Activity timeline with attribution filters.
- Changeset/diff API for version/time windows.
- Selective rollback by actor/time/content.
- Rollback is an attributable activity.
- Rollback-of-rollback works.
- Restore to point-in-time and restore selected range.
- Optional branch-aware activity and rollback.
- Webhooks/callbacks for document updates and change batches.

### 14.2 ShareDB Mapping (Y/hub -> ShareDB)
- Y/hub content attribution map -> `agent_operation_history` + `agent_operation_content_index`.
- Y/hub `withCustomAttributions` -> operation metadata tags + indexed attribution key/value rows.
- Y/hub `contentIds` selectors -> deterministic `contentSelectors` (`sheet:1!A1:C4`, JSON paths).
- Y/hub rollback attribution -> persisted `activity_type=rollback` history rows.
- Y/hub changeset reconstruction -> operation history replay (+ optional milestone snapshots).

### 14.3 Required Data Model Additions
- `agent_operation_history` includes:
  - `activity_type` (`write`/`rollback`/`restore`)
  - `target_operation_ids`
  - `operation_payload` with forward + inverse payload
  - version/time boundaries and actor/source metadata
- `agent_operation_content_index` for content-level filtering.
- `agent_operation_attributions`:
  - `operation_id` (fk)
  - `k`
  - `v`
  - indexed for `withCustomAttributions` filters.

### 14.4 Required API Surface for Parity
- `GET /activity/{docId}`
  - supports: `from`, `to`, `by`, `limit`, `order`, `group`, `withCustomAttributions`, `contentSelectors`, optional `branch`
  - feeds the workspace History panel via app route `GET /api/documents/{documentId}/activity`
- `GET /changeset/{docId}`
  - supports: `fromVersion`, `toVersion` (or `from`, `to`), `delta`, `attributions`, optional `branch`
- `POST /rollback/{docId}`
  - supports: `operationIds`, `by`, `from`, `to`, `contentSelectors`, `withCustomAttributions`, optional `branch`
- `POST /restore/{docId}`
  - supports: `restoreTo`, `restoreRange`, optional `branch`
- Optional parity extras:
  - WebSocket attribution hooks
  - webhook callbacks on committed changes.

### 14.5 Execution Plan
1. Centralize all writes in wrapper APIs.
2. Persist operation history for all mutating writes.
3. Persist content selectors and custom attributions on write.
4. Implement inverse generation for patch/raw ops.
5. Implement rollback as activity persistence.
6. Implement rollback-of-rollback and restore flows.
7. Implement activity and changeset query services.
8. Add attribution/content selector query filters.
9. Add webhook callbacks and optional branch dimension.
10. Add performance layer (milestones, query/index tuning).

### 14.6 Definition of Done (Parity)
- Every committed mutation appears in activity with actor + attributions.
- Rollback creates a new activity row and is itself rollbackable.
- Rolling back a rollback restores prior state deterministically.
- Activity/changeset filters work for actor, time, attribution, and content selectors.
- Workspace History panel renders accurate activity timeline for the active ShareDB document.
- Restore-to and restore-range produce deterministic snapshots.
- APIs meet target latency/SLO under production-like load.

## 15) History Toolbar + Activity Panel (UI Plan)
Add a document history surface in the spreadsheet workspace that exposes ShareDB activity timeline data.

### 15.1 UX
- Add a `History` button in the spreadsheet toolbar (`app/doc/workspace.tsx`) near the existing search control.
- Clicking `History` opens an activity panel:
  - desktop: right-side panel
  - mobile: drawer/full-height panel
- v1 is read-only:
  - list activity entries only
  - no rollback/restore actions inside the panel yet

### 15.2 Panel Data
- Backing source: app-level operation history (`agent_operation_history`), not raw ShareDB op log.
- Activity row fields:
  - timestamp (`created_at`)
  - actor (`actor_type`, `actor_id`)
  - `activity_type` (`write`/`rollback`/`restore`)
  - version range (`sharedb_version_from` -> `sharedb_version_to`)
  - source/tool context from `metadata`
  - reverted state (`reverted_at`, `reverted_by_operation_id`)
- Panel states:
  - loading
  - empty
  - error
  - paginated list with “Load more”

### 15.3 API Bridge
- Add app endpoint:
  - `GET /api/documents/{documentId}/activity`
- Query params:
  - `limit`, `cursor`
  - optional `from`, `to`, `by`, `activityTypes`
- Response shape:
  - `items: ActivityItem[]`
  - `nextCursor: string | null`
- API bridge maps to internal activity service (`GET /activity/{docId}`) and normalizes output for UI.

### 15.4 Non-Goals for This UI Phase
- No rollback/restore mutation buttons in panel.
- No live streaming updates in panel; refresh + pagination is sufficient for v1.
