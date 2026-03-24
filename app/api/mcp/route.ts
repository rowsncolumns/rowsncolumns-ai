import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createSpreadsheetMcpServer } from "@/mcp-server/create-server";
import { loadEnvironment } from "@/mcp-server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

loadEnvironment();

const splitCsv = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const MCP_ALLOWED_ORIGINS = splitCsv(process.env.MCP_ALLOWED_ORIGINS);
const ALLOW_ALL_ORIGINS = MCP_ALLOWED_ORIGINS.length === 0;
const CORS_ALLOW_HEADERS =
  "Content-Type, Authorization, mcp-session-id, mcp-protocol-version, Last-Event-ID";
const CORS_EXPOSE_HEADERS = "mcp-session-id, mcp-protocol-version";
const CORS_ALLOW_METHODS = "GET, POST, DELETE, OPTIONS";

const resolveAllowedOrigin = (request: Request) => {
  const requestOrigin = request.headers.get("origin");

  if (ALLOW_ALL_ORIGINS) {
    return "*";
  }

  if (!requestOrigin) {
    return null;
  }

  return MCP_ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : null;
};

const applyCorsHeaders = (response: Response, request: Request) => {
  const allowedOrigin = resolveAllowedOrigin(request);
  if (!allowedOrigin) {
    return response;
  }

  response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
  response.headers.set("Access-Control-Allow-Methods", CORS_ALLOW_METHODS);
  response.headers.set("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
  response.headers.set("Access-Control-Expose-Headers", CORS_EXPOSE_HEADERS);
  response.headers.set("Access-Control-Max-Age", "86400");
  response.headers.append("Vary", "Origin");

  return response;
};

const originForbidden = (request: Request) => {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || ALLOW_ALL_ORIGINS) {
    return false;
  }
  return !MCP_ALLOWED_ORIGINS.includes(requestOrigin);
};

const detectUiHost = (request: Request): "claude" | "openai" | null => {
  const userAgent = request.headers.get("user-agent")?.toLowerCase() ?? "";
  if (userAgent.includes("claude")) {
    return "claude";
  }
  if (userAgent.includes("chatgpt") || userAgent.includes("openai")) {
    return "openai";
  }
  return null;
};

const handleMcpRequest = async (request: Request) => {
  if (originForbidden(request)) {
    return applyCorsHeaders(
      Response.json({ error: "Origin is not allowed." }, { status: 403 }),
      request,
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createSpreadsheetMcpServer({
    uiHost: detectUiHost(request),
    mcpServerUrl: request.url,
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    return applyCorsHeaders(response, request);
  } catch (error) {
    console.error("[mcp] request handling error:", error);
    return applyCorsHeaders(
      Response.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        },
        { status: 500 },
      ),
      request,
    );
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
};

export async function POST(request: Request) {
  return handleMcpRequest(request);
}

export async function GET(request: Request) {
  return handleMcpRequest(request);
}

export async function DELETE(request: Request) {
  return handleMcpRequest(request);
}

export async function OPTIONS(request: Request) {
  if (originForbidden(request)) {
    return Response.json({ error: "Origin is not allowed." }, { status: 403 });
  }
  return applyCorsHeaders(new Response(null, { status: 204 }), request);
}
