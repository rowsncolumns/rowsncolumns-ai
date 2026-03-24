import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({
  path: path.resolve(process.cwd(), ".env.local"),
  override: false,
  quiet: true,
});

void import("./render-chat-server").catch((error) => {
  console.error("Failed to start render chat server:", error);
  process.exit(1);
});
