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
- `sharedb_version_from`
- `sharedb_version_to`
- `operation_kind` (`patch_tuples` or `raw_op`)
- `operation_payload` (forward + inverse data)
- `metadata` (threadId, runId, toolName, userId, etc.)
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
- Submit inverse as `source=backend` (not tracked as agent operation)
- Mark original row as reverted with revert version metadata

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

Optional admin endpoint/CLI:
- list pending operations
- revert selected operation

## 7) Y/hub-Like Activity + Rollback/Restore API
Support an API surface similar to y/hub for document activity tracking and selective rollback.

Target API shape (internal first, then public):
- `GET /activity/{docId}`
  - filters: `from`, `to`, `by`, `limit`, `order`, `group`
  - returns timeline entries with actor + version/time boundaries
- `GET /changeset/{docId}`
  - filters: `fromVersion`, `toVersion` (or `from`, `to` timestamps)
  - optional: `attributions=true`, `delta=true`
  - returns computed diff/change summary for the selected window
- `POST /rollback/{docId}`
  - selectors: `operationIds`, `by`, `from`, `to`, `contentSelectors`
  - rolls back matching activity by applying inverse operations
- `POST /restore/{docId}`
  - supports restore semantics:
    - `restoreTo` (restore document state to a target version/timestamp)
    - `restoreRange` (re-apply/restore only a selected activity window from `from -> to`)

Implementation note:
- Phase 1 API can operate on operation-level attribution.
- Phase 2 adds content-level selectors matching y/hub-style attributed filtering.

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
6. Add content-level attribution index
7. Add tests
8. (Optional) Add Postgres MilestoneDB
9. Enable UI/admin controls

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
