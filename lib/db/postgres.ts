import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "Missing required config: DATABASE_URL. Set it in external/rnc.ai/.env.local.",
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
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__rncPostgresClient__ = db;
}
