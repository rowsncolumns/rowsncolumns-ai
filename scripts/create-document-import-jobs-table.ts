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

const databaseUrl = process.env.DATABASE_URL ?? "";

if (!databaseUrl) {
  throw new Error(
    "Missing required config: DATABASE_URL. Set it in .env.local.",
  );
}

async function main() {
  const sql = postgres(databaseUrl, {
    prepare: false,
    ssl: "require",
  });

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const migrationPath = path.join(
    __dirname,
    "sql",
    "016_create_document_import_jobs_table.sql",
  );

  try {
    const migrationSql = await readFile(migrationPath, "utf8");
    await sql.unsafe(migrationSql);
    console.log("document_import_jobs table is ready.");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
