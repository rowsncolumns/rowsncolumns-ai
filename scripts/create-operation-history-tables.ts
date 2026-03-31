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

const databaseUrl =
  process.env.SHAREDB_DATABASE_URL ?? process.env.DATABASE_URL ?? "";

if (!databaseUrl) {
  throw new Error(
    "Missing required config: SHAREDB_DATABASE_URL or DATABASE_URL. Set it in external/rnc.ai/.env.local.",
  );
}

const shouldRequireSsl = process.env.SHAREDB_REQUIRE_SSL !== "false";

async function main() {
  const sql = postgres(databaseUrl, {
    prepare: false,
    ...(shouldRequireSsl ? { ssl: "require" } : {}),
  });

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const migrations = [
    "011_create_agent_operation_history_table.sql",
    "012_create_agent_operation_content_index_table.sql",
    "013_create_agent_operation_attributions_table.sql",
    "014_backfill_operation_history_jsonb.sql",
  ];

  try {
    for (const migration of migrations) {
      const migrationPath = path.join(__dirname, "sql", migration);
      const migrationSql = await readFile(migrationPath, "utf8");
      console.log(`Running migration: ${migration}...`);
      await sql.unsafe(migrationSql);
      console.log(`  ✓ ${migration} complete`);
    }
    console.log("\nOperation history tables are ready.");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
