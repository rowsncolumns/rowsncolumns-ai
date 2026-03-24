import path from "node:path";
import { config as loadEnv } from "dotenv";

let loaded = false;

export const loadEnvironment = () => {
  if (loaded) {
    return;
  }

  loadEnv({
    path: path.resolve(process.cwd(), ".env.local"),
    override: false,
    quiet: true,
  });
  loaded = true;
};
