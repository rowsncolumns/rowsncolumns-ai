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

When `NEXT_PUBLIC_CHAT_API_BASE_URL` is set, the browser calls Render chat directly.
Render chat validates Better Auth sessions via `/api/auth/get-session` on your auth host.
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

# Required auth backend URL for session introspection
# Falls back to BETTER_AUTH_URL when omitted.
CHAT_AUTH_BASE_URL=
CHAT_AUTH_BASE_PATH=/api/auth

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
- Render chat JSON request bodies are capped at `1MB`.

## Credits + Admin Refill

Users receive daily free credits with a non-accumulating reset to `20`.

- Free plan: `20` daily credits (daily bucket resets, no rollover)
- Pro: `$35/month`, `500` monthly credits
- Max: `$200/month`, `3500` monthly credits
- Top-up: `$50` one-off purchase adds `800` credits

Credit accounting uses two buckets:

- `daily_free_remaining` (free-only reset bucket)
- durable paid `balance` (plan grants + top-ups, no expiry)

Run credits migration:

```bash
yarn db:migrate:credits
yarn db:migrate:billing
```

Optional admin allowlists (comma-separated) for manual refill access in Settings:

```bash
RNC_ADMIN_USER_IDS=
RNC_ADMIN_EMAILS=
```

Stripe billing env vars:

```bash
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Optional override for customer portal config in Stripe
STRIPE_BILLING_PORTAL_CONFIGURATION_ID=

# Lookup keys from Stripe Prices
STRIPE_PRICE_LOOKUP_KEY_PRO_MONTHLY=pro_monthly
STRIPE_PRICE_LOOKUP_KEY_MAX_MONTHLY=max_monthly
STRIPE_PRICE_LOOKUP_KEY_TOPUP_50=topup_50
```

Optional: provision the Stripe product + prices (idempotent by lookup key):

```bash
yarn stripe:provision:billing-catalog
```

Optional: migrate existing Pro subscribers to the latest Pro price (`$35`) without proration:

```bash
# Dry run
yarn stripe:migrate:pro-35

# Apply changes
yarn stripe:migrate:pro-35 --apply
```

## ShareDB On Postgres

ShareDB server storage uses PostgreSQL.

Set in `.env.local`:

```bash
# Recommended: Postgres URL
SHAREDB_DATABASE_URL=

# Optional fallback used when SHAREDB_DATABASE_URL is missing
DATABASE_URL=

# ShareDB websocket server port
SHAREDB_PORT=8080

# Optional: set to false for local non-SSL Postgres
SHAREDB_REQUIRE_SSL=true

# Optional: maximum allowed serialized ShareDB document size in bytes.
# Default is 50MB (52428800). Set to 0 to disable the limit.
SHAREDB_DOC_MAX_BYTES=52428800
```

Run ShareDB table migration:

```bash
yarn db:migrate:sharedb
```

## Runtime Size Limits

- External chat service (`/chat`, `/chat/stop`, `/chat/history` POST fork): JSON request body limit is `1MB`.
- ShareDB websocket transport (`ws`): max inbound message payload is `100MB` by default unless overridden.
- ShareDB document writes: server-enforced max serialized snapshot size is `50MB` by default (`SHAREDB_DOC_MAX_BYTES`).
- MCP spreadsheet resource payloads: truncated to `1MB` by default (`MCP_RESOURCE_MAX_BYTES`).
- Chat image uploads (`/api/chat/attachments/image`): max file upload is `8MB`.

## Document Ownership Mapping

Track document ownership (`doc_id -> user_id`) in Postgres:

```bash
yarn db:migrate:documents
yarn db:migrate:document-shares
yarn db:migrate:document-share-permissions
yarn db:migrate:document-share-public-access
```

## Better Auth

Set these auth env vars in `.env.local` (and in Vercel/Render):

```bash
BETTER_AUTH_URL=https://your-domain.com
BETTER_AUTH_SECRET=your-strong-secret

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

Generate/migrate Better Auth tables:

```bash
yarn db:migrate:auth
```

For a fresh schema-only setup (no data migration), run:

```bash
yarn db:migrate:schema
```

For full provider cutover steps (including optional template/user-document data
migration scripts), see:

- `docs/postgres-provider-migration.md`

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
