import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({
  path: path.resolve(process.cwd(), ".env.local"),
  override: false,
  quiet: true,
});
loadEnv({
  path: path.resolve(process.cwd(), "external/rnc.ai/.env.local"),
  override: false,
  quiet: true,
});

const databaseUrl = process.env.DATABASE_URL ?? "";

if (!databaseUrl) {
  throw new Error(
    "Missing required config: DATABASE_URL. Set it in external/rnc.ai/.env.local.",
  );
}

async function main() {
  const sql = postgres(databaseUrl, {
    prepare: false,
    ssl: "require",
  });

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const migrationPath = path.join(__dirname, "sql", "002_create_credit_tables.sql");

  try {
    const migrationSql = await readFile(migrationPath, "utf8");
    await sql.unsafe(migrationSql);
    console.log("credit tables are ready.");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
