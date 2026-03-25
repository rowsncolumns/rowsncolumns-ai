# Cross-Subdomain Authentication

This document explains how authentication works between the main app (`rowsncolumns.ai`) and the chat server (`chat.rowsncolumns.ai`).

## Overview

The app uses cookie-based authentication that works across subdomains. When a user signs in on `rowsncolumns.ai`, the session cookies are shared with `chat.rowsncolumns.ai`, eliminating the need for separate token exchange.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        User's Browser                           │
│                                                                 │
│  Cookies (domain: .rowsncolumns.ai):                           │
│  - __Secure-neon-auth.session_token                            │
│  - __Secure-neon-auth.session_challange                        │
│  - __Secure-neon-auth.local.session_data                       │
└─────────────────────────────────────────────────────────────────┘
                    │                           │
                    ▼                           ▼
        ┌───────────────────┐       ┌───────────────────┐
        │  rowsncolumns.ai  │       │chat.rowsncolumns.ai│
        │    (Next.js)      │       │   (Render Node)   │
        │                   │       │                   │
        │  - Sets cookies   │       │  - Reads cookies  │
        │  - Auth routes    │       │  - Validates via  │
        │                   │       │    NeonAuth API   │
        └───────────────────┘       └───────────────────┘
```

## Configuration

### Environment Variables

#### Vercel (Next.js App)

```env
# Required for cross-subdomain cookies
NEON_AUTH_COOKIE_DOMAIN=.rowsncolumns.ai

# Auth configuration
NEON_AUTH_BASE_URL=https://ep-xxx.neonauth.xxx.aws.neon.tech/neondb/auth
NEON_AUTH_COOKIE_SECRET=your-secret-here
```

#### Render (Chat Server)

```env
# Auth validation
NEON_AUTH_BASE_URL=https://ep-xxx.neonauth.xxx.aws.neon.tech/neondb/auth

# CORS (optional - defaults include rowsncolumns.ai)
CHAT_ALLOWED_ORIGINS=https://rowsncolumns.ai,https://www.rowsncolumns.ai
```

### Key Files

| File | Purpose |
|------|---------|
| `lib/auth/server.ts` | NeonAuth configuration with cookie domain |
| `lib/auth/cookie-compat.ts` | Cookie normalization for Safari compatibility |
| `app/api/auth/[...path]/route.ts` | Auth API routes with cookie compatibility wrapper |
| `render-chat-server.ts` | Chat server with cookie-based auth support |
| `components/workspace-assistant.tsx` | Client-side chat with `credentials: 'include'` |

## How It Works

### 1. User Signs In (rowsncolumns.ai)

When a user signs in, NeonAuth sets cookies with `domain=.rowsncolumns.ai`:

```
Set-Cookie: __Secure-neon-auth.session_token=xxx; Domain=.rowsncolumns.ai; Secure; HttpOnly; SameSite=Lax
```

The leading dot makes cookies accessible to all subdomains.

### 2. Client Makes Chat Request

The workspace assistant makes requests to the chat server with credentials:

```typescript
fetch("https://chat.rowsncolumns.ai/chat", {
  method: "POST",
  credentials: "include",  // Sends cookies cross-origin
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ... }),
});
```

### 3. Chat Server Validates Session

The chat server extracts the session token from cookies and validates it:

```typescript
// Extract token from cookies
const sessionToken = getSessionTokenFromCookies(req.headers.cookie);

// Validate via NeonAuth API
const identity = await verifyAuthToken(sessionToken);
```

### 4. CORS Configuration

The chat server includes credentials support in CORS headers:

```typescript
{
  "Access-Control-Allow-Origin": "https://rowsncolumns.ai",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}
```

## iOS Safari Compatibility

### Problem

iOS Safari has stricter handling of `ReadableStream` when cloning responses, causing 500 errors on auth endpoints.

### Solution

Read the response body as `ArrayBuffer` before creating a new Response:

```typescript
// lib/auth/cookie-compat.ts
export async function cloneResponseWithNormalizedNeonAuthCookies(
  response: Response,
  mode: NeonAuthCookieCompatibilityMode = "normalize",
): Promise<Response> {
  const headers = new Headers(response.headers);
  const changed = normalizeNeonAuthSetCookieHeadersInPlace(headers, mode);
  if (!changed) {
    return response;
  }

  // Read body as ArrayBuffer to avoid iOS Safari ReadableStream issues
  const body = await response.arrayBuffer();

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
```

## Cookie Normalization

NeonAuth may set cookies with `SameSite=None; Partitioned` which can cause issues. The cookie compatibility layer normalizes these:

- Removes `Partitioned` attribute
- Changes `SameSite=None` to `SameSite=Lax`

This is handled in `lib/auth/cookie-compat.ts`.

## Troubleshooting

### Cookies not sent to subdomain

**Symptoms:** 401 errors, cookies missing in request headers

**Solution:**
1. Ensure `NEON_AUTH_COOKIE_DOMAIN=.rowsncolumns.ai` is set in Vercel
2. Redeploy the Next.js app
3. Sign out and sign back in to get new cookies with correct domain
4. Verify in DevTools: Application → Cookies → Domain should show `.rowsncolumns.ai`

### CORS errors

**Symptoms:** Browser blocks request, no CORS headers in response

**Solution:**
1. Check `CHAT_ALLOWED_ORIGINS` includes your origin
2. Ensure chat server is deployed with latest code
3. Verify response includes `Access-Control-Allow-Credentials: true`

### 500 errors on iOS Safari

**Symptoms:** Auth endpoints return 500 with empty body on iOS Safari

**Solution:**
Ensure `cloneResponseWithNormalizedNeonAuthCookies` uses `response.arrayBuffer()` instead of `response.body`.

### Duplicate cookies causing 401

**Symptoms:** Multiple session cookies in request, 401 despite being signed in

**Solution:**
Clear all cookies for the domain and sign in fresh:
- iOS: Settings → Safari → Advanced → Website Data → Delete
- Desktop: DevTools → Application → Cookies → Clear

## Local Development

For local testing, cookies work across `localhost` ports without special configuration:

```env
# .env.local
NEXT_PUBLIC_CHAT_API_BASE_URL=http://localhost:8787

# Don't set NEON_AUTH_COOKIE_DOMAIN locally
```

Run both servers:
```bash
# Terminal 1: Next.js app
yarn dev

# Terminal 2: Chat server
yarn chat:render
```

## Security Considerations

1. **Cookie Security:** All auth cookies use `__Secure-` prefix requiring HTTPS and `Secure` flag
2. **CORS Allowlist:** Only explicitly allowed origins can make credentialed requests
3. **Token Validation:** Chat server validates tokens via NeonAuth API, not locally
4. **HttpOnly Cookies:** Session tokens are HttpOnly, preventing XSS access
