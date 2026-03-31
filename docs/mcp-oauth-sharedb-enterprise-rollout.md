# MCP OAuth + ShareDB Auth Rollout Plan

Date: 2026-03-31
Owner: Platform / Realtime / MCP
Status: Draft

## Goal
Make Claude/ChatGPT MCP integrations reliably create and edit spreadsheets with enterprise-grade auth, access control, and audit.

## Current State
- ShareDB websocket endpoint now enforces strict ACL at protocol level.
- Browser app users with first-party session cookies can read/write normally.
- MCP HTTP endpoint can be called, but OAuth claims are not yet fully enforced end-to-end for ShareDB writes.
- MCP tool `spreadsheet_createDocument` creates ShareDB docs directly and does not create `document_owners` records.

## Why OAuth Connector Fields Alone Are Not Enough
- OAuth Client ID/Secret in Claude/OpenAI authenticates connector calls to MCP HTTP.
- ShareDB writes happen on a separate websocket path.
- If websocket auth token/cookie is not propagated, ShareDB ACL will reject reads/writes.
- Result: connector auth can succeed while ShareDB writes still fail.

## Required End-to-End Architecture
- Authenticate MCP HTTP request with OAuth bearer token.
- Resolve user identity from token.
- Propagate user auth to ShareDB websocket client used by MCP tools.
- Enforce ShareDB ACL using that identity.
- Persist ownership/metadata for newly created docs.

## Implementation Plan
1. MCP HTTP auth middleware
- Validate bearer token on every MCP request.
- Reject unauthorized requests with clear 401/403 JSON-RPC errors.
- Store resolved user context per request for tool handlers.

2. ShareDB auth propagation for MCP server-side writes
- Node websocket client should pass `Authorization: Bearer <token>` in handshake headers.
- Reuse same token that authenticated MCP request.
- Ensure ShareDB `connect/readSnapshots/submit` middleware reads and validates this token.

3. Safe document creation path
- Replace direct ShareDB-only creation in `spreadsheet_createDocument`.
- Create ownership + metadata first using existing server repository logic or API route equivalent.
- Then initialize ShareDB doc content.
- Fail atomically if ownership cannot be created.

4. Legacy orphan protection
- Add guard to deny ACL auto-ownership side effects for docs without owners.
- Backfill or delete orphan docs before production rollout.

5. Observability
- Add structured logs for:
  - MCP auth failures
  - ShareDB auth handshake failures
  - ACL denials with docId and reason
- Keep token values redacted.

## Temporary No-Login Mode (Implemented)
- Added doc-scoped `mcpToken` capability tokens for MCP/LLM flows.
- Tokens are signed server-side and validated by ShareDB middleware.
- Token scope is limited to one `docId` + permission (`view`/`edit`) + expiry.
- URLs returned by MCP `create/open` tools include `mcpToken`.
- ShareDB websocket clients in MCP tool runtime and widget pass `mcpToken`.
- Required env: `SHAREDB_MCP_TOKEN_SECRET` (HMAC signing key).

## Acceptance Criteria
- Authenticated Claude/OpenAI connector user can:
  - create a spreadsheet doc
  - read it
  - edit it through MCP tools
- Unauthorized connector call cannot read or write ShareDB docs.
- New MCP-created docs always have a `document_owners` row.
- No new orphan docs are created.
- Free/Pro users do not gain audit history storage or visibility.

## Test Plan
- Unit tests
  - MCP auth middleware: valid token, invalid token, missing token.
  - ShareDB middleware: unauthorized fetch/submit denied, edit allowed.
- Integration tests
  - End-to-end MCP create/edit flow with OAuth token.
  - Verify ownership row exists after create.
  - Verify activity/undo gating still Max/Admin only.
- Regression checks
  - First-party web app realtime collaboration still works.
  - Existing assistant/server tool flows still write successfully.

## Rollout
- Phase 1: ship MCP auth middleware and ShareDB bearer propagation behind flag.
- Phase 2: switch `spreadsheet_createDocument` to ownership-first flow.
- Phase 3: clean legacy orphan docs and enable strict mode.
- Phase 4: monitor logs and error-rate dashboards for 48 hours.

## Open Questions
- Should MCP-created docs be private to creator by default or optionally shared to org?
- Should token-to-user resolution use existing neon session introspection or dedicated OAuth introspection endpoint?
- Do we need per-tool scopes (read-only vs write) at MCP layer?
