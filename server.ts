import http from "http";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import ShareDB from "sharedb";
import { WebSocketServer, WebSocket } from "ws";

loadEnv({
  path: path.resolve(process.cwd(), ".env.local"),
  override: false,
  quiet: true,
});
const createShareDBPostgres = require("sharedb-postgres") as (
  options?: Record<string, unknown>,
) => unknown;

const shareDbDatabaseUrl =
  process.env.SHAREDB_DATABASE_URL || process.env.DATABASE_URL;

if (!shareDbDatabaseUrl) {
  throw new Error(
    "Missing SHAREDB_DATABASE_URL/DATABASE_URL for ShareDB server.",
  );
}
const SHAREDB_DATABASE_URL: string = shareDbDatabaseUrl;

const SHAREDB_REQUIRE_SSL = process.env.SHAREDB_REQUIRE_SSL !== "false";
const parsePositiveInt = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const parseNonNegativeInt = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};
const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return fallback;
};
const SHAREDB_PG_MAX_POOL_SIZE = parsePositiveInt(
  process.env.SHAREDB_PG_MAX_POOL_SIZE,
  10,
);
const SHAREDB_PG_CONNECTION_TIMEOUT_MS = parsePositiveInt(
  process.env.SHAREDB_PG_CONNECTION_TIMEOUT_MS,
  10000,
);
const SHAREDB_PG_IDLE_TIMEOUT_MS = parseNonNegativeInt(
  process.env.SHAREDB_PG_IDLE_TIMEOUT_MS,
  30000,
);
const SHAREDB_PG_MAX_LIFETIME_SECONDS = parseNonNegativeInt(
  process.env.SHAREDB_PG_MAX_LIFETIME_SECONDS,
  0,
);
const SHAREDB_PG_KEEP_ALIVE = parseBoolean(
  process.env.SHAREDB_PG_KEEP_ALIVE,
  true,
);
const SHAREDB_PG_KEEP_ALIVE_INITIAL_DELAY_MS = parseNonNegativeInt(
  process.env.SHAREDB_PG_KEEP_ALIVE_INITIAL_DELAY_MS,
  0,
);
const PORT = parseInt(
  process.env.PORT || process.env.SHAREDB_PORT || "8080",
  10,
);
const HOST = process.env.HOST || "0.0.0.0";

const redactDatabaseUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    if (parsed.username) parsed.username = "***";
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return value;
  }
};

async function startServer() {
  console.log(
    "Connecting ShareDB to PostgreSQL:",
    redactDatabaseUrl(SHAREDB_DATABASE_URL),
  );
  console.log("ShareDB pg pool config:", {
    max: SHAREDB_PG_MAX_POOL_SIZE,
    connectionTimeoutMillis: SHAREDB_PG_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: SHAREDB_PG_IDLE_TIMEOUT_MS,
    maxLifetimeSeconds: SHAREDB_PG_MAX_LIFETIME_SECONDS || undefined,
    keepAlive: SHAREDB_PG_KEEP_ALIVE,
    keepAliveInitialDelayMillis: SHAREDB_PG_KEEP_ALIVE_INITIAL_DELAY_MS,
  });

  const shouldForceSsl =
    SHAREDB_REQUIRE_SSL && !/sslmode=/i.test(SHAREDB_DATABASE_URL);

  const db = createShareDBPostgres({
    connectionString: SHAREDB_DATABASE_URL,
    max: SHAREDB_PG_MAX_POOL_SIZE,
    connectionTimeoutMillis: SHAREDB_PG_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: SHAREDB_PG_IDLE_TIMEOUT_MS,
    ...(SHAREDB_PG_MAX_LIFETIME_SECONDS > 0
      ? { maxLifetimeSeconds: SHAREDB_PG_MAX_LIFETIME_SECONDS }
      : {}),
    keepAlive: SHAREDB_PG_KEEP_ALIVE,
    keepAliveInitialDelayMillis: SHAREDB_PG_KEEP_ALIVE_INITIAL_DELAY_MS,
    ...(shouldForceSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  }) as never;

  const backend = new ShareDB({
    db,
    presence: true,
    doNotForwardSendPresenceErrorsToClient: true,
  });

  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
      );
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  const wss = new WebSocketServer({ server });

  wss.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} is already in use. Stop the existing ShareDB server or set PORT/SHAREDB_PORT to a different port.`,
      );
      process.exit(1);
    }
    console.error("WebSocket server error:", error);
    process.exit(1);
  });

  wss.on("connection", (ws: WebSocket) => {
    const stream = new WebSocketJSONStream(ws);
    backend.listen(stream as never);
    console.log("Client connected");

    ws.on("close", () => {
      console.log("Client disconnected");
    });
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} is already in use. Stop the existing ShareDB server or set PORT/SHAREDB_PORT to a different port.`,
      );
      process.exit(1);
    }
    console.error("HTTP server error:", error);
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    console.log(`ShareDB server running on ${HOST}:${PORT}`);
    console.log(`Health check: http://${HOST}:${PORT}/health`);
  });

  process.on("SIGTERM", () => {
    console.log("Shutting down...");
    server.close(() => {
      backend.close(() => {
        process.exit(0);
      });
    });
  });
}

/**
 * WebSocket JSON stream adapter for ShareDB
 */
class WebSocketJSONStream {
  private ws: WebSocket;

  constructor(ws: WebSocket) {
    this.ws = ws;
  }

  // ShareDB stream interface
  on(event: string, callback: (...args: unknown[]) => void) {
    if (event === "data") {
      this.ws.on("message", (data: Buffer | string) => {
        try {
          const message = JSON.parse(data.toString());
          callback(message);
        } catch (error) {
          console.error("Failed to parse message:", error);
        }
      });
    } else if (event === "close" || event === "end") {
      this.ws.on("close", callback);
    } else if (event === "error") {
      this.ws.on("error", callback);
    }
  }

  write(data: unknown) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  end() {
    this.ws.close();
  }

  // Duplex stream compatibility
  pipe() {
    return this;
  }

  removeListener() {
    return this;
  }
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
