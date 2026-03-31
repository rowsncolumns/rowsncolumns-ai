import path from "node:path";
import postgres from "postgres";
import { config as loadEnv } from "dotenv";

const envPaths = [
  path.resolve(process.cwd(), ".env.local"),
  path.resolve(process.cwd(), "external/rnc.ai/.env.local"),
];

for (const envPath of envPaths) {
  loadEnv({
    path: envPath,
    override: false,
    quiet: true,
  });
}

const databaseUrl = process.env.DATABASE_URL ?? process.env.SHAREDB_DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "Missing required config: DATABASE_URL (or SHAREDB_DATABASE_URL). Set it in .env.local.",
  );
}

type PostgresClient = ReturnType<typeof postgres>;

declare global {
  // eslint-disable-next-line no-var
  var __rncPostgresClient__: PostgresClient | undefined;
}

const globalForDb = globalThis as typeof globalThis & {
  __rncPostgresClient__?: PostgresClient;
};

export const db: PostgresClient =
  globalForDb.__rncPostgresClient__ ??
  postgres(databaseUrl, {
    prepare: false,
    ssl: "require",
    onnotice: () => {}, // Suppress NOTICE messages (e.g., "relation already exists")
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__rncPostgresClient__ = db;
}
