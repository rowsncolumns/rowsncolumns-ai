import path from "node:path";
import { spawnSync } from "node:child_process";

import { config as loadEnv } from "dotenv";

loadEnv({
  path: path.resolve(process.cwd(), ".env.local"),
  override: false,
  quiet: true,
});

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error(
    "Missing required config: DATABASE_URL. Set it in .env.local.",
  );
}

const betterAuthUrl = process.env.BETTER_AUTH_URL?.trim();
if (!betterAuthUrl) {
  throw new Error(
    "Missing required config: BETTER_AUTH_URL. Set it in .env.local.",
  );
}

const betterAuthSecret = process.env.BETTER_AUTH_SECRET?.trim();
if (!betterAuthSecret) {
  throw new Error(
    "Missing required config: BETTER_AUTH_SECRET. Set it in .env.local.",
  );
}

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const commandArgs = ["auth@latest", "migrate", "--config", "lib/auth/server.ts"];

const result = spawnSync(npxCommand, commandArgs, {
  stdio: "inherit",
  env: process.env,
});

if (typeof result.status === "number" && result.status !== 0) {
  process.exitCode = result.status;
} else if (result.error) {
  throw result.error;
}
