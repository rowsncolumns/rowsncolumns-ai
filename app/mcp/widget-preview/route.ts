import path from "node:path";
import { readFile } from "node:fs/promises";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

const WIDGET_JS_PATH = path.join(
  process.cwd(),
  "public",
  "mcp",
  "spreadsheet-widget.bundle.js",
);
const WIDGET_CSS_PATH = path.join(
  process.cwd(),
  "public",
  "mcp",
  "spreadsheet-widget.bundle.css",
);

const normalizeShareDbUrl = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:") {
      parsed.protocol = "ws:";
      return parsed.toString();
    }
    if (parsed.protocol === "https:") {
      parsed.protocol = "wss:";
      return parsed.toString();
    }
    if (parsed.protocol === "ws:" || parsed.protocol === "wss:") {
      return parsed.toString();
    }
  } catch {
    // Fall through to host-only handling.
  }

  const isLocalHost =
    trimmed.startsWith("localhost") ||
    trimmed.startsWith("127.0.0.1") ||
    trimmed.startsWith("[::1]");
  return `${isLocalHost ? "ws" : "wss"}://${trimmed}`;
};

const resolveAppBaseUrl = (request: NextRequest) => {
  const fromEnv =
    process.env.MCP_APP_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    null;
  if (fromEnv) {
    return fromEnv.startsWith("http://") || fromEnv.startsWith("https://")
      ? fromEnv
      : `https://${fromEnv}`;
  }

  return request.nextUrl.origin;
};

export async function GET(request: NextRequest) {
  const appBaseUrl = resolveAppBaseUrl(request);
  const shareDbUrl = normalizeShareDbUrl(
    process.env.MCP_SHAREDB_URL?.trim() ||
      process.env.NEXT_PUBLIC_SHAREDB_URL?.trim() ||
      null,
  );
  const shareDbPort =
    process.env.MCP_SHAREDB_PORT?.trim() ||
    process.env.NEXT_PUBLIC_SHAREDB_PORT?.trim() ||
    null;
  const locale =
    request.nextUrl.searchParams.get("locale")?.trim() ||
    process.env.MCP_WIDGET_LOCALE?.trim() ||
    process.env.NEXT_PUBLIC_LOCALE?.trim() ||
    "en-US";
  const currency =
    request.nextUrl.searchParams.get("currency")?.trim() ||
    process.env.MCP_WIDGET_CURRENCY?.trim() ||
    process.env.NEXT_PUBLIC_CURRENCY?.trim() ||
    "USD";

  const [js, css] = await Promise.all([
    readFile(WIDGET_JS_PATH, "utf8").catch(
      () =>
        `console.error("Missing spreadsheet-widget.bundle.js. Run: yarn mcp:build-widget")`,
    ),
    readFile(WIDGET_CSS_PATH, "utf8").catch(() => ""),
  ]);

  const safeJs = js.replace(/<\/script/gi, "<\\/script");
  const safeCss = css.replace(/<\/style/gi, "<\\/style");
  const configJson = JSON.stringify({
    appBaseUrl,
    shareDbUrl,
    shareDbPort,
    locale,
    currency,
  });

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RowsnColumns MCP Widget Preview</title>
  <style>${safeCss}</style>
  <style>
    :root { color-scheme: light dark; }
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      overflow: hidden;
    }
    body {
      font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      background: transparent;
      color: #f3f6fb;
    }
    #app {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      flex-direction: column;
    }
    .rnc-widget-sheet {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    .rnc-canvas-wrapper {
      min-height: 0;
      flex: 1;
      display: flex;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <div id="app"></div>
  <script>window.__RNC_MCP_WIDGET_CONFIG__ = ${configJson};</script>
  <script>${safeJs}</script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
