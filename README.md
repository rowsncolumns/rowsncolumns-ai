This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Model Provider Config

The chat backend supports both OpenAI and Anthropic models.

Set these in `.env.local`:

```bash
# optional: force provider ("openai" | "anthropic")
AI_PROVIDER=openai

# optional: provider-agnostic model override (e.g. gpt-4.1-mini or claude-3-7-sonnet-latest)
AI_MODEL=

# OpenAI
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
OPENAI_REASONING_SUMMARY=auto
OPENAI_REASONING_EFFORT=medium

# Anthropic
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-3-7-sonnet-latest
```

Routing behavior:
- `AI_PROVIDER=anthropic` uses Anthropic.
- `AI_PROVIDER=openai` uses OpenAI.
- Without `AI_PROVIDER`, `claude-*` models route to Anthropic; everything else routes to OpenAI.

## Split Deployment: Vercel Frontend + Render Chat

You can run chat execution on Render while keeping the Next.js frontend on Vercel.

### Frontend (Vercel) env

Set these on Vercel:

```bash
NEXT_PUBLIC_CHAT_API_BASE_URL=https://chat.rowsncolumns.ai
NEXT_PUBLIC_CHAT_API_PATH=/chat
```

When `NEXT_PUBLIC_CHAT_API_BASE_URL` is set, the browser calls Render chat directly with a bearer token from Neon auth.
The token used is the Neon session token (`getSession().session.token`), and Render validates it via Neon `/get-session`.
Client payload includes only `threadId`, `docId`, and `message`.

### Chat service (Render)

Start command:

```bash
yarn chat:render
```

Render env vars:

```bash
PORT=10000
CHAT_RENDER_PATH=/chat
CHAT_SERVER_TIMEOUT_MS=1800000
CHAT_ALLOWED_ORIGINS=https://rowsncolumns.ai,https://www.rowsncolumns.ai,https://<your-vercel-domain>
CHAT_MODEL=gpt-5.4
CHAT_PROVIDER=openai
CHAT_REASONING_ENABLED=false
# Optional fixed server-side instructions (never sent by browser)
CHAT_SYSTEM_INSTRUCTIONS=

# Required auth backend URL (same value used by Next.js auth server)
NEON_AUTH_BASE_URL=

# Reuse existing app runtime envs:
DATABASE_URL=
SHAREDB_URL=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
LANGCHAIN_API_KEY=
LANGCHAIN_TRACING_V2=
LANGCHAIN_PROJECT=
```

Notes:
- `CHAT_ALLOWED_ORIGINS` is enforced via CORS.
- Keep `DATABASE_URL` and `SHAREDB_URL` pointing to the same production backends used by the frontend app.
- The legacy `/api/chat` route on Vercel can remain as fallback.

## Credits + Admin Refill

Users receive daily credits with a non-accumulating reset to `30`.

Run credits migration:

```bash
yarn db:migrate:credits
```

Optional admin allowlists (comma-separated) for manual refill access in Settings:

```bash
RNC_ADMIN_USER_IDS=
RNC_ADMIN_EMAILS=
```

## ShareDB On Postgres (Neon)

ShareDB server storage uses PostgreSQL.

Set in `.env.local`:

```bash
# Recommended: Neon Postgres URL
SHAREDB_DATABASE_URL=

# Optional fallback used when SHAREDB_DATABASE_URL is missing
DATABASE_URL=

# ShareDB websocket server port
SHAREDB_PORT=8080

# Optional: set to false for local non-SSL Postgres
SHAREDB_REQUIRE_SSL=true
```

Run ShareDB table migration:

```bash
yarn db:migrate:sharedb
```

## Document Ownership Mapping

Track document ownership (`doc_id -> user_id`) in Neon:

```bash
yarn db:migrate:documents
yarn db:migrate:document-shares
```

## Auth Cookie Compatibility (Safari)

Safari can fail OAuth completion when auth cookies are set with `SameSite=None; Partitioned`, which can cause a sign-in loop (`/auth/callback` -> `/doc` -> `/auth/sign-in`).

To keep behavior stable across Safari/Chrome/Edge, this app normalizes Neon auth cookies at app boundaries (not in `node_modules`):

- Utility: `lib/auth/cookie-compat.ts`
- API boundary: `app/api/auth/[...path]/route.ts`
- Middleware boundary: `proxy.ts`

Normalization rules (only for `__Secure-neon-auth.*` cookies):

- Remove `Partitioned`
- Rewrite `SameSite=None` to `SameSite=Lax`
- Preserve other attributes (`Secure`, `HttpOnly`, `Path`, `Domain`, `Max-Age`, etc.)

Notes:

- `/auth/callback` remains simple (handles explicit OAuth error params; otherwise redirects to `redirectTo`)
- OAuth verifier exchange remains middleware-driven
- No polling/retry logic and no SDK monkey patching

Quick validation:

```bash
# local
curl -i -X POST 'http://localhost:3000/api/auth/sign-in/social' \
  -H 'content-type: application/json' \
  --data '{"provider":"google","callbackURL":"/auth/callback?redirectTo=%2Fdoc","disableRedirect":true}'

# production
curl -i -X POST 'https://rowsncolumns.ai/api/auth/sign-in/social' \
  -H 'content-type: application/json' \
  -H 'origin: https://rowsncolumns.ai' \
  --data '{"provider":"google","callbackURL":"/auth/callback?redirectTo=%2Fdoc","disableRedirect":true}'
```

Expected `Set-Cookie` for Neon auth cookies:

- Contains `SameSite=Lax`
- Does not contain `Partitioned`

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [https://localhost:3000](https://localhost:3000) with your browser to see the result.
OAuth sign-in (especially Safari) requires secure cookies, so dev now starts with HTTPS by default. Use [https://localhost:3000](https://localhost:3000).

## Excel Add-in (MVP)

This repo includes an Excel task pane add-in surface backed by Office.js:

- Task pane page: `/excel-addin`
- Planning endpoint: `/api/chat/excel/step`
- Manifest: `public/excel-addin/manifest.xml`

Current local Excel tool support in the add-in:

- `spreadsheet_changeBatch`
- `spreadsheet_queryRange`
- `spreadsheet_readDocument`
- `spreadsheet_createSheet`
- `spreadsheet_updateSheet`
- `spreadsheet_formatRange`

Run the app:

```bash
yarn dev
```

Sideload the manifest into Excel:

1. Open Excel.
2. Go to `Insert` -> `Add-ins` -> `My Add-ins` -> `Upload My Add-in`.
3. Select `public/excel-addin/manifest.xml`.
4. Open the task pane from the `RowsnColumns AI` ribbon button.

Notes:

- The manifest is preconfigured for `https://localhost:3000`.
- If you host elsewhere, update URLs in `public/excel-addin/manifest.xml`.

### Testing The Excel Add-in (Manual QA)

Use this checklist to verify the MVP end-to-end.

1. Start app + verify route:

```bash
yarn dev
```

Open:

- `https://localhost:3000/excel-addin` (should render the taskpane UI in browser)
- Sign in if prompted (the chat endpoint requires auth session cookies)

2. Sideload in Excel:

- Open Excel desktop or Excel on web.
- Upload `public/excel-addin/manifest.xml`.
- Open `RowsnColumns AI` from the ribbon.
- Confirm header shows `Workbook connected`.

3. Verify context wiring:

- Click a cell (for example `B2`) in Excel.
- In taskpane, verify active cell indicator updates to the same address.
- Click `Refresh context` if needed.

4. Test supported tools with prompts:

- Query range:
  - Prompt: `Read A1:C5 and summarize what is there.`
  - Expect: assistant invokes `spreadsheet_readDocument` or `spreadsheet_queryRange` and returns values.
- Write values:
  - Prompt: `Put headers Name, Revenue, Cost in A1:C1 and add 3 sample rows.`
  - Expect: assistant invokes `spreadsheet_changeBatch`; sheet updates.
- Create sheet:
  - Prompt: `Create a new sheet called Summary.`
  - Expect: `spreadsheet_createSheet`; new tab appears.
- Update sheet:
  - Prompt: `Rename sheet 1 to RawData and freeze the top row.`
  - Expect: `spreadsheet_updateSheet`; name/freeze updates.
- Format:
  - Prompt: `Format A1:C1 as bold with a light background.`
  - Expect: `spreadsheet_formatRange`; visible formatting change.

5. Verify tool cards:

- Each tool call should appear in chat with:
  - Input JSON
  - Output JSON
  - Running/completed state

6. Negative test (unsupported tool):

- Prompt: `Delete rows 2 through 5.`
- Current MVP does not implement delete-row tool execution.
- Expect: tool result contains explicit `not implemented` error.

### Troubleshooting

- `Unauthorized` from chat:
  - Sign in to the web app at `https://localhost:3000` first, then reopen the taskpane.
- Taskpane does not load:
  - Confirm URLs in manifest match your dev host.
  - Verify HTTPS is used (`yarn dev`, not `yarn dev:http`).
- Office.js errors after workbook changes:
  - Click `Refresh context` and retry prompt.
- Manifest changes not reflected:
  - Remove and re-sideload the add-in in Excel.

If you need plain HTTP for debugging, run:

```bash
yarn dev:http
```

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
