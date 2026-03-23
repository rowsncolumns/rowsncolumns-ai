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
