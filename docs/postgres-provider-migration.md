# PostgreSQL Provider Migration Runbook

This runbook is for moving this app from one PostgreSQL provider to another
(for example Neon -> PlanetScale Postgres), with script-driven setup.

It is written for agents/operators and focuses on:

- creating schema in the new DB
- migrating selected document data when needed
- avoiding known SSL/auth pitfalls

## 1. What This Repo Supports

### Schema-only migration (no data)

Use this when starting fresh on a new provider:

```bash
npm run db:migrate:schema
```

This creates app tables, ShareDB tables, and Better Auth tables.
It also includes optional service schema:

- operation history tables/indexes
- `document_metadata.is_user_renamed`

### Data migration scripts available

- `npm run db:migrate:templates:owner-reassign`
  - Copies template documents from `SOURCE_DATABASE_URL` to target DB.
  - Reassigns ownership to one target user.
  - Copies: `document_owners`, `document_metadata`, `snapshots`, `ops`.
- `npm run db:migrate:user-docs:no-ops`
  - Copies all docs owned by a source user.
  - Copies: `document_owners`, `document_metadata`, `snapshots`.
  - Does **not** copy `ops`.

## 2. Required Environment Variables

Set in `.env.local` (or shell env):

```bash
# Target DB (new provider)
DATABASE_URL=postgresql://...
# optional explicit target override
TARGET_DATABASE_URL=postgresql://...

# Source DB (old provider), only for data-copy scripts
SOURCE_DATABASE_URL=postgresql://...

# Better Auth
BETTER_AUTH_URL=https://your-app-domain
BETTER_AUTH_SECRET=your-long-random-secret
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

Optional ownership controls:

```bash
# For template migration target owner override
TARGET_TEMPLATE_OWNER_USER_ID=<target-user-id>

# For general user-doc migration source owner
SOURCE_OWNER_USER_ID=<old-user-id>

# For general user-doc migration target owner override
TARGET_OWNER_USER_ID=<target-user-id>
```

Notes:

- If `TARGET_*` is not set, scripts fall back to `DATABASE_URL`.
- If target DB has exactly one user in `public."user"`, owner override is optional.

## 3. Migration Flows

### A) Fresh provider, schema only

1. Point `DATABASE_URL` to the new provider.
2. Run:

```bash
npm run db:migrate:schema
```

3. Validate auth tables exist (`user`, `session`, `account`, `verification`).
4. Validate optional service tables/columns exist:
   - `agent_operation_history`
   - `agent_operation_content_index`
   - `agent_operation_attributions`
   - `document_metadata.is_user_renamed`

### B) Move global templates

1. Set `SOURCE_DATABASE_URL`.
2. Set `DATABASE_URL` (or `TARGET_DATABASE_URL`) to target.
3. Optional: set `TARGET_TEMPLATE_OWNER_USER_ID`.
4. Run:

```bash
npm run db:migrate:templates:owner-reassign
```

### C) Move one user's documents (no ops)

1. Set `SOURCE_DATABASE_URL`.
2. Set target DB URL.
3. Set source user id:

```bash
SOURCE_OWNER_USER_ID=<old-user-id> npm run db:migrate:user-docs:no-ops
```

4. Optional: set `TARGET_OWNER_USER_ID` if target has multiple users.

## 4. Idempotency and Re-runs

All migration scripts are designed to be re-runnable:

- use `INSERT ... ON CONFLICT ... DO UPDATE` for metadata/ownership/snapshots
- safe to run multiple times if you need to overwrite with latest source state

## 5. Verification Checklist

After any migration, verify:

1. Table presence:
   - `document_owners`, `document_metadata`, `snapshots`
   - Better Auth tables: `user`, `session`, `account`, `verification`
2. Expected owner doc counts in target.
3. Snapshot presence for migrated docs.
4. UI and ShareDB runtime:
   - open a migrated sheet
   - confirm data appears in grid

Recommended quick checks:

- open `/sheets/<docId>`
- compare migrated doc count in Sheets list
- if ShareDB websocket payload arrives but UI is stale, restart ShareDB server process and hard refresh

## 6. Known Pitfalls

### `sslrootcert=system` / `ENOENT: ... open 'system'`

Some providers include URL params not accepted by all Node clients.
This repo sanitizes `sslrootcert=system` and `sslmode` in runtime/migration code,
but if you still hit errors, remove those params from DB URLs.

### Better Auth route errors after cutover

Confirm:

- `BETTER_AUTH_URL` is set correctly for your environment
- `BETTER_AUTH_SECRET` is set and non-empty
- OAuth provider env vars are present
- `npm run db:migrate:auth` completed

### Data present in DB but not visible

Check in order:

1. ShareDB server points to target DB.
2. App and ShareDB use same collection (`SHAREDB_COLLECTION`, default `spreadsheets`).
3. ShareDB process restarted after migration.
4. Browser hard refresh.

## 7. Suggested Agent Procedure for New Provider

When delegating to an agent, use this sequence:

1. Set `DATABASE_URL` to new provider.
2. Run schema setup (`npm run db:migrate:schema`).
3. If needed, run template migration.
4. If needed, run user-doc migration (no ops).
5. Run verification checklist.
6. Report counts and any mismatches.
