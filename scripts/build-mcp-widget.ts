import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const projectRoot = process.cwd();
const entryFile = path.join(
  projectRoot,
  "mcp-server",
  "widget",
  "spreadsheet-widget.tsx",
);
const eventsPolyfill = path.join(
  projectRoot,
  "mcp-server",
  "widget",
  "events-polyfill.ts",
);
const outDir = path.join(projectRoot, "public", "mcp");
const outFile = path.join(outDir, "spreadsheet-widget.bundle.js");

const run = async () => {
  await mkdir(outDir, { recursive: true });

  const result = await build({
    entryPoints: [entryFile],
    bundle: true,
    minify: true,
    sourcemap: false,
    platform: "browser",
    format: "iife",
    target: ["es2020"],
    write: false,
    jsx: "automatic",
    mainFields: ["browser", "module", "main"],
    alias: {
      events: eventsPolyfill,
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
      global: "globalThis",
    },
    logLevel: "info",
  });

  const output = result.outputFiles?.[0];
  if (!output) {
    throw new Error("Failed to generate MCP spreadsheet widget bundle.");
  }

  await writeFile(outFile, output.text, "utf8");
  console.error(`[mcp-widget] wrote bundle: ${outFile}`);
};

run().catch((error) => {
  console.error("[mcp-widget] build failed:", error);
  process.exit(1);
});
