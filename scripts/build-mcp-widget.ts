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
const outBaseName = "spreadsheet-widget.bundle";

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
    outdir: outDir,
    entryNames: outBaseName,
    assetNames: "assets/[name]-[hash]",
    jsx: "automatic",
    mainFields: ["browser", "module", "main"],
    alias: {
      events: eventsPolyfill,
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify(
        process.env.NODE_ENV ?? "production",
      ),
      global: "globalThis",
    },
    logLevel: "info",
  });

  const outputs = result.outputFiles ?? [];
  if (outputs.length === 0) {
    throw new Error("Failed to generate MCP spreadsheet widget bundle.");
  }

  for (const output of outputs) {
    await mkdir(path.dirname(output.path), { recursive: true });
    await writeFile(output.path, output.contents);
  }

  console.error(
    `[mcp-widget] wrote bundle assets to: ${path.join(
      outDir,
      `${outBaseName}.js`,
    )}`,
  );
};

run().catch((error) => {
  console.error("[mcp-widget] build failed:", error);
  process.exit(1);
});
