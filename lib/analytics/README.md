# Analytics & Tracking

This directory contains the PostHog analytics integration for both client-side (website) and server-side (MCP endpoints, API routes) tracking.

## Setup

### Environment Variables

Add these to your `.env.local`:

```bash
# PostHog Configuration
NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=phc_xxxxx  # Your PostHog project API key
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com  # or https://eu.i.posthog.com
```

Alternative key names (all work):
- `NEXT_PUBLIC_POSTHOG_KEY`
- `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`
- `POSTHOG_API_KEY` (server-only)

## Architecture

```
instrumentation-client.ts   # PostHog initialization (Next.js 15.3+)
lib/analytics/
├── index.ts                # Re-exports everything
├── posthog-client.tsx      # Client-side React provider & helpers
├── posthog-server.ts       # Server-side (API routes, MCP tools)
└── README.md               # This file
```

## Client-Side Tracking (Website)

### Initialization (Next.js 15.3+)

PostHog is initialized in `instrumentation-client.ts` at the project root:

```typescript
import posthog from "posthog-js";

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  capture_pageview: true,
  capture_pageleave: true,
  autocapture: true,
});
```

### Provider Setup

The `PostHogProvider` is already added to `app/layout.tsx`:

```tsx
import { PostHogProvider } from "@/lib/analytics/posthog-client";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
```

### Automatic Tracking

The following is tracked automatically:
- Page views (`capture_pageview: true`)
- Page leaves (`capture_pageleave: true`)
- User interactions (`autocapture: true`)

### Manual Event Tracking

```tsx
import { trackEvent, trackPageView, identifyUser } from "@/lib/analytics";

// Track custom event
trackEvent("button_clicked", {
  buttonId: "export",
  location: "toolbar"
});

// Track page view with custom name
trackPageView("Dashboard", {
  dashboardType: "sales"
});

// Identify logged-in user
identifyUser("user_123", {
  email: "user@example.com",
  plan: "pro",
});
```

### Spreadsheet-Specific Tracking

```tsx
import { trackSpreadsheetAction, trackChatInteraction } from "@/lib/analytics";

// Track spreadsheet actions
trackSpreadsheetAction("cell_edited", {
  docId: "abc-123",
  sheetId: 1,
  range: "A1:B5",
});

// Track chat interactions
trackChatInteraction("send", {
  model: "claude-sonnet-4-6",
  messageLength: 150,
  toolsUsed: ["spreadsheet_changeBatch", "spreadsheet_formatRange"],
});
```

### Using the Hook

```tsx
import { usePostHog } from "@/lib/analytics";

function MyComponent() {
  const posthog = usePostHog();

  const handleClick = () => {
    posthog.capture("feature_used", { feature: "export" });
  };

  return <button onClick={handleClick}>Export</button>;
}
```

## Server-Side Tracking (MCP & API)

### MCP Tool Tracking

All MCP tools are automatically tracked in `mcp-server/register-tools.ts`. Each tool call captures:

| Property | Description |
|----------|-------------|
| `tool` | Tool name (e.g., `spreadsheet_changeBatch`) |
| `docId` | Document ID |
| `sheetId` | Sheet ID (if applicable) |
| `success` | Whether the call succeeded |
| `durationMs` | Execution time in milliseconds |
| `errorCode` | Error type if failed |
| `inputSize` | Size of input JSON in bytes |

### Session Tracking

Document open/create events are tracked automatically:

```typescript
// Tracked when user creates a document
trackMcpSession(docId, {
  docId,
  action: "create",
  host: "claude", // or "openai" or "unknown"
});

// Tracked when user opens a document
trackMcpSession(docId, {
  docId,
  action: "open",
  host: "openai",
});
```

### Manual Server-Side Tracking

```typescript
import {
  trackMcpTool,
  trackMcpSession,
  trackChat,
  trackError,
  withTracking
} from "@/lib/analytics";

// Track a tool call manually
trackMcpTool("user_123", {
  tool: "custom_tool",
  success: true,
  durationMs: 150,
});

// Track chat/assistant interaction
trackChat("user_123", {
  threadId: "thread_abc",
  model: "claude-sonnet-4-6",
  provider: "anthropic",
  toolCallCount: 3,
  durationMs: 2500,
  success: true,
});

// Track an error
trackError("user_123", {
  errorCode: "INVALID_RANGE",
  errorMessage: "Range A1:Z100 is too large",
  endpoint: "/api/chat",
  context: { docId: "abc-123" },
});

// Wrap a function with automatic tracking
const result = await withTracking(
  "user_123",
  "expensive_operation",
  async () => {
    // Your async operation
    return await doSomethingExpensive();
  },
  { customProperty: "value" }
);
```

### Identify Users (Server-Side)

```typescript
import { identifyUserServer } from "@/lib/analytics";

identifyUserServer("user_123", {
  email: "user@example.com",
  plan: "enterprise",
  company: "Acme Corp",
});
```

## Events Reference

### Automatic Events

| Event | Source | Description |
|-------|--------|-------------|
| `$pageview` | Client | Page view |
| `$pageleave` | Client | User leaves page |
| `$autocapture` | Client | Click, input, form submit |
| `mcp_tool_called` | Server | MCP tool execution |
| `mcp_session_create` | Server | Document created |
| `mcp_session_open` | Server | Document opened |

### Custom Events

| Event | Recommended Properties |
|-------|----------------------|
| `spreadsheet_*` | `docId`, `sheetId`, `range`, `toolName` |
| `chat_send` | `model`, `messageLength` |
| `chat_receive` | `model`, `toolsUsed[]`, `responseLength` |
| `chat_error` | `errorCode`, `errorMessage` |
| `error` | `errorCode`, `errorMessage`, `endpoint` |

## Development Mode

Analytics is enabled in all environments by default. To disable in development, add to `instrumentation-client.ts`:

```typescript
if (process.env.NODE_ENV !== "development") {
  posthog.init(...);
}
```

## Shutdown

For long-running processes (like MCP servers), ensure proper shutdown:

```typescript
import { shutdownPostHog } from "@/lib/analytics";

process.on("SIGTERM", async () => {
  await shutdownPostHog();
  process.exit(0);
});
```

## PostHog Dashboard

View your analytics at: https://us.posthog.com (or https://eu.posthog.com)

Key dashboards to create:
1. **MCP Tool Usage** - Filter by `mcp_tool_called` event
2. **Document Activity** - Filter by `mcp_session_*` events
3. **Error Tracking** - Filter by `error` event
4. **Performance** - Chart `durationMs` property over time
