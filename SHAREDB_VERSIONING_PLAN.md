# ShareDB Versioning + Agent Attribution Plan

## Goal
Add reliable operation history for ShareDB writes so every document change (user, agent, backend) is:

1. Attributed (`who/what/when`)
2. Versioned (`from version`, `to version`)
3. Revertible (safe undo path)

## Scope
- Track all **mutating document writes** across:
  - agent tool execution
  - user collaborative editing
  - backend/system operations
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

Note:
- Keep table name for backward compatibility, but store all sources (`agent`/`user`/`backend`) as first-class activity rows.

Indexes:
- `(doc_id, created_at desc)`
- pending rows (`reverted_at is null`)

## 2) Centralize Write Path
Ensure all mutating operations go through wrappers:
- `persistPatchTuples(...)`
- `submitShareDBOp(...)`
- `trackedSubmitOp(...)` (single low-level submit primitive)

Wrapper responsibilities:
- Capture `versionFrom` before submit
- Submit op
- Capture `versionTo` after submit
- Persist history row (for all sources: `agent`/`user`/`backend`)
- Require attribution context on every call (source + actor)

Enforcement:
- No direct `doc.submitOp(...)` calls outside `trackedSubmitOp(...)`.
- Add CI guard (grep/lint rule) that fails on direct `submitOp` usage in app code.
- Migrate existing direct call sites first (for example, `lib/chat/tools.ts` and `lib/chat/utils.ts` direct paths).

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
- `source=backend`
- `actorType=system`
- `actorId=sharedb-system`

Required caller behavior:
- Agent paths must set `source=agent`, `actorType=assistant`, and concrete assistant identity.
- User editing paths must set `source=user`, `actorType=user`, and concrete user identity.
- Backend jobs/maintenance must set `source=backend`, `actorType=system`, and concrete job identity.

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
- `listDocumentActivities(docId, limit, filters)`
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

## 9) Optional Hybrid Persistence Layer (Redis Streams + Postgres + S3)
Use the same hot/cold architecture pattern as y/hub while keeping ShareDB as the collaboration engine.

### 9.1 Architecture Mapping
- Hot real-time layer:
  - ShareDB handles live collaboration + versioning.
  - Every tracked write also appends an activity envelope to a Redis stream (`activity:{collection}:{doc_id}`).
- Worker layer:
  - Background worker consumes Redis stream entries in order.
  - Compacts/merges activity payloads and snapshots by version window.
  - Persists large blobs to S3.
  - Persists queryable metadata + blob references to Postgres.
- Cold durable layer:
  - Postgres stores metadata/indexes for activity listing/filtering.
  - S3 stores large operation payload blobs and optional snapshot blobs.

### 9.2 Storage Strategy
- Keep `agent_operation_history` as the primary metadata/audit table.
- Add payload storage mode fields:
  - `payload_storage` (`inline` | `s3`)
  - `payload_s3_key` (nullable)
  - `payload_bytes` (size for cost/monitoring)
- For large payloads, store only metadata + inverse summary in Postgres; full forward/inverse payload goes to S3.
- Optional snapshot table (or `milestones`) remains for faster historical reconstruction.

### 9.3 Worker Metadata Tables
- `sharedb_activity_worker_cursor`
  - `stream_key`
  - `last_id`
  - `updated_at`
- `sharedb_activity_chunk` (optional compaction index)
  - `collection`
  - `doc_id`
  - `from_version`
  - `to_version`
  - `from_time`
  - `to_time`
  - `s3_key`
  - `created_at`

### 9.4 Query and Rollback Semantics
- `GET /activity` and `GET /changeset` read metadata from Postgres first; hydrate heavy payload from S3 only when needed.
- Rollback path always requires inverse payload availability:
  - inline for small operations
  - S3 retrieval for large operations
- Redis stream is a transient queue/cache, not source of truth.

### 9.5 Cleanup and Retention
- Redis:
  - trim acknowledged stream entries after worker checkpoint.
- Postgres:
  - retain metadata long-term; optionally move old detailed payload columns to null when payload is in S3.
- S3:
  - lifecycle policy for stale blobs when corresponding metadata is deleted/archived.

### 9.6 MilestoneDB Compatibility
- ShareDB `milestoneDb` remains compatible as an optional acceleration path.
- Milestone snapshots can be stored in Postgres or S3-backed references depending on size.

### 9.7 Postgres Growth Controls (Default v1 Policy)
- Metadata-first storage in Postgres:
  - keep indexed/query fields in `agent_operation_history`
  - store only compact inverse summary inline for rollback preview/listing
- Payload offload threshold:
  - if serialized forward+inverse payload > `16 KB`, store full payload in S3
  - persist `payload_storage='s3'`, `payload_s3_key`, and `payload_bytes` in Postgres
- Partitioning:
  - monthly range partitioning on `created_at` for activity tables
- Retention:
  - hot window (full inline payload allowed): `30 days`
  - warm window: metadata + S3 pointer only (`31-180 days`)
  - cold/archive window: metadata-only or archive/delete per compliance policy
- Index policy (lean):
  - required: `(doc_id, created_at desc)`
  - required: partial index for pending/revertible activities (`reverted_at is null`)
  - optional: `(doc_id, activity_type, created_at desc)` if query profile needs it
  - do not index large payload columns
- Optional compaction:
  - batch older micro-activities into chunk manifests while preserving attribution boundaries and rollback safety.

## 10) Rollout Plan
1. DB migration
2. Repository + wrappers (`trackedSubmitOp` as single submit primitive)
3. Migrate all direct `doc.submitOp` call sites to tracked wrappers
4. Add undo services (latest + by operation id)
5. Add activity/changeset/rollback/restore APIs
6. Add rollback-as-activity persistence (including rollback-of-rollback support)
7. Implement History toolbar button + activity panel (read-only v1)
8. Add content-level attribution index
9. Add enforcement (CI rule: block direct `doc.submitOp`)
10. Add tests
11. (Optional) Add hybrid persistence worker (Redis stream -> Postgres metadata + S3 blobs)
12. Add partitioning/retention jobs for activity tables and S3 lifecycle policies
13. Enable UI/admin controls

## 11) Testing Plan
- Unit:
  - inverse generation for supported op types
  - patch tuple undo transformation
  - selector extraction from patch paths/ranges
- Integration:
  - all sources (`agent`/`user`/`backend`) write activity rows with attribution
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
- Static/Policy:
  - CI fails if direct `doc.submitOp(...)` is used outside approved wrapper module(s)
- Concurrency:
  - concurrent writes + latest undo behavior
- Milestones (optional):
  - worker consumes Redis streams in order and checkpoints cursor correctly
  - payload offloading to S3 and re-hydration correctness for rollback/changeset
  - threshold policy validation (`<=16KB` inline, `>16KB` offloaded)
  - retention transitions (`hot -> warm -> cold`) preserve activity listing and rollback guarantees
  - retention cleanup does not break activity listing or undo capability
  - milestone save/retrieve by version/timestamp and fallback correctness when missing

## 12) Risks
- Undoing old operations after heavy downstream edits can conflict.
- Some json0 operations may not be safely invertible without richer metadata.
- Overly aggressive milestone frequency increases storage and write amplification.
- Content selector extraction can be lossy if operation semantics are ambiguous.
- Hybrid persistence adds eventual-consistency windows between Redis and cold storage.
- S3/object-store outages can block hydration of large historical payloads.

Mitigation:
- prefer latest-first undo in phase 1
- mark non-invertible operations explicitly
- use measured milestone intervals and retention policies
- store both raw operation payload and normalized selector metadata
- add stronger rebase strategy in phase 2
- keep rollback-critical inverse summaries in Postgres even when full payload is offloaded
- add worker lag/error monitoring and replay-safe idempotent persistence

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

## 15) History Sidebar + Activity Panel (UI Plan)
Add a document history surface in the spreadsheet workspace that exposes ShareDB activity timeline data with undo capabilities.

### 15.1 UX
- Add a `History` button in the spreadsheet toolbar (`app/doc/workspace.tsx`) near the existing search control.
- Clicking `History` opens an activity sidebar:
  - desktop: right-side panel (collapsible)
  - mobile: drawer/full-height panel
- Sidebar shows all attributed operations to the sheet:
  - grouped by tool/agent run when applicable
  - shows actor (user/agent), timestamp, and operation summary
  - visual indicator for reverted operations

### 15.2 Panel Data
- Backing source: app-level operation history (`agent_operation_history`), not raw ShareDB op log.
- Activity row fields:
  - timestamp (`created_at`)
  - actor (`actor_type`, `actor_id`)
  - `activity_type` (`write`/`rollback`/`restore`)
  - version range (`sharedb_version_from` -> `sharedb_version_to`)
  - source/tool context from `metadata` (toolName, toolCallId)
  - reverted state (`reverted_at`, `reverted_by_operation_id`)
- Panel states:
  - loading
  - empty
  - error
  - paginated list with "Load more"

### 15.3 Undo/Rollback Button
Each activity item in the sidebar includes an undo button:
- Button is visible for revertable operations (`reverted_at IS NULL`)
- Button is disabled/hidden for already-reverted operations
- Clicking undo:
  1. Shows confirmation dialog with preview of what will be undone
  2. Calls `POST /api/documents/{documentId}/undo` with `operationId`
  3. Updates UI to reflect reverted state
  4. Shows success/error toast
- Rollback-of-rollback: rollback activities can also be undone (re-applies original changes)

### 15.4 Per-Tool Undo Capability
Support undoing all operations from a specific tool invocation:
- Activity items with same `toolCallId` are grouped visually
- "Undo all from this tool call" option when multiple ops share `toolCallId`
- Implementation:
  1. Query operations by `toolCallId` from metadata
  2. Undo in reverse chronological order
  3. Each undo creates its own rollback activity
- API: `POST /api/documents/{documentId}/undo` with `{ toolCallId: "xxx" }`

### 15.5 API Bridge
- Activity endpoint:
  - `GET /api/documents/{documentId}/activity`
  - Query params: `limit`, `cursor`, `from`, `to`, `by`, `activityTypes`, `sources`
  - Response: `{ items: ActivityItem[], nextCursor: string | null }`
- Undo endpoint:
  - `POST /api/documents/{documentId}/undo`
  - Body: `{ operationId?: string, toolCallId?: string, preview?: boolean }`
  - Response: `{ success, operationId, rollbackOperationId, versionFrom, versionTo }`
- Check undo status:
  - `GET /api/documents/{documentId}/undo?operationId=xxx`
  - Response: `{ canUndo: boolean, reason?: string }`

### 15.6 Activity Item UI Component
```tsx
// ActivityItem component structure
<ActivityItem>
  <ActorAvatar type={actorType} />
  <ActivityContent>
    <ActorName>{actorId}</ActorName>
    <ToolBadge>{metadata.toolName}</ToolBadge>
    <Timestamp>{createdAt}</Timestamp>
    <VersionRange>v{versionFrom} → v{versionTo}</VersionRange>
  </ActivityContent>
  <UndoButton
    disabled={!!revertedAt}
    onClick={() => handleUndo(operationId)}
  />
  {revertedAt && <RevertedBadge>Reverted</RevertedBadge>}
</ActivityItem>
```

### 15.7 Non-Goals for This UI Phase
- No live streaming updates in panel; refresh + pagination is sufficient for v1.
- No content-level selective rollback UI (rollback specific cells only).
- No drag-and-drop reordering of operations.

## 16) Feature Flag Based Deployment

Deploy the versioning system incrementally using feature flags to control exposure and enable instant rollback.

### 16.1 Flag Definitions
```typescript
// Feature flags (e.g., LaunchDarkly, environment vars, or internal config)
flags: {
  enableOperationTracking: boolean,      // Master switch for history persistence
  enableOperationTrackingForAgents: boolean,  // Track agent writes
  enableOperationTrackingForUsers: boolean,   // Track user writes
  enableOperationTrackingForBackend: boolean, // Track backend/system writes
  enableHistoryPanel: boolean,           // Show History button in toolbar
  enableRollbackApi: boolean,            // Enable rollback/restore endpoints
  trackingMode: 'blocking' | 'async' | 'shadow',  // See 16.2
}
```

### 16.2 Tracking Modes
- **shadow**: Tracking runs in parallel but failures are logged only (no impact on writes). Use for validation.
- **async**: Tracking is fire-and-forget after successful write. Tracking failures don't block edits.
- **blocking**: Tracking must succeed for write to complete. Use only after confidence is established.

Recommended rollout:
1. Start with `shadow` mode to validate data quality
2. Move to `async` mode for production use
3. Consider `blocking` only if audit guarantees are required

### 16.3 Wrapper Implementation with Flags
```typescript
async function trackedSubmitOp(doc, op, attribution, options) {
  const trackingEnabled = flags.enableOperationTracking &&
    ((attribution.source === 'agent' && flags.enableOperationTrackingForAgents) ||
     (attribution.source === 'user' && flags.enableOperationTrackingForUsers) ||
     (attribution.source === 'backend' && flags.enableOperationTrackingForBackend));

  const versionFrom = doc.version;

  // Always submit the op first (non-blocking tracking)
  await doc.submitOp(op, options?.source);

  const versionTo = doc.version;

  if (!trackingEnabled) return;

  const trackingPromise = persistOperationHistory({
    doc,
    op,
    attribution,
    versionFrom,
    versionTo,
  });

  if (flags.trackingMode === 'shadow') {
    trackingPromise.catch(err => logger.warn('Shadow tracking failed', err));
  } else if (flags.trackingMode === 'async') {
    trackingPromise.catch(err => logger.error('Async tracking failed', err));
  } else if (flags.trackingMode === 'blocking') {
    await trackingPromise; // Only mode where tracking failure surfaces
  }
}
```

### 16.4 Gradual Rollout Plan
1. **Week 1**: Deploy with all flags off. Code is in place but inactive.
2. **Week 2**: Enable `shadow` mode for agent writes only on staging.
3. **Week 3**: Enable `shadow` mode for agent writes in production. Validate data.
4. **Week 4**: Switch to `async` mode for agent writes. Monitor for errors.
5. **Week 5**: Enable `async` tracking for user writes (higher volume).
6. **Week 6**: Enable History panel UI behind flag for internal users.
7. **Week 7+**: Gradual rollout of History panel to all users.

## 17) Feature Rollback Strategy

If the versioning system causes issues, here's how to disable or fully remove it.

### 17.1 Instant Disable (No Deploy Required)
Set feature flags to off:
```
enableOperationTracking = false
enableHistoryPanel = false
enableRollbackApi = false
```
This immediately stops all tracking and hides UI. Existing data remains but is unused.

### 17.2 Graceful Degradation
If tracking persistence is failing but writes should continue:
1. Switch `trackingMode` to `shadow` (failures are logged, not thrown)
2. Writes continue unaffected
3. Investigate and fix tracking issues offline

### 17.3 Code Rollback (If Needed)
If wrapper code itself is problematic:

**Step 1: Revert wrapper to passthrough**
```typescript
async function trackedSubmitOp(doc, op, attribution, options) {
  // Bypass all tracking, direct submit
  return doc.submitOp(op, options?.source);
}
```

**Step 2: Remove wrapper calls (optional)**
Revert call sites from `trackedSubmitOp(...)` back to `doc.submitOp(...)`.

### 17.4 Database Cleanup (Full Removal)
If the feature is being fully removed:

```sql
-- Drop tables in dependency order
DROP TABLE IF EXISTS agent_operation_attributions;
DROP TABLE IF EXISTS agent_operation_content_index;
DROP TABLE IF EXISTS agent_operation_history;

-- Drop any worker/cursor tables if hybrid persistence was enabled
DROP TABLE IF EXISTS sharedb_activity_worker_cursor;
DROP TABLE IF EXISTS sharedb_activity_chunk;
```

Note: This is a one-way operation. Export data first if audit records may be needed.

### 17.5 Rollback Risk Assessment

| Component | Risk | Mitigation |
|-----------|------|------------|
| Tracking wrapper | Medium - in write path | Non-blocking async mode by default |
| History persistence | Low - additive tables | Shadow mode validates before production |
| History UI | Low - read-only panel | Feature flag hides instantly |
| Rollback API | Low - explicit user action | Flag disables endpoints |
| CI enforcement rule | Low - build-time only | Remove grep rule from CI config |

### 17.6 Monitoring and Alerts
Set up alerts to catch issues early:
- Tracking error rate > 1% → alert
- Tracking latency p99 > 500ms → alert
- Write latency increase > 10% after enabling → alert
- History table growth > expected → alert

If alerts fire, switch to `shadow` mode and investigate before disabling entirely.
