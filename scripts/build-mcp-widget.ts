import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindPostcss from "@tailwindcss/postcss";

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
const tailwindEntryFile = path.join(
  projectRoot,
  "mcp-server",
  "widget",
  "tailwind.css",
);

const buildTailwindCss = async () => {
  const inputCss = await readFile(tailwindEntryFile, "utf8");
  // tailwind/postcss can be installed with a different PostCSS instance than ours.
  // Cast to avoid type-level mismatch while keeping runtime behavior correct.
  const postcssAny = postcss as unknown as (
    plugins: unknown[],
  ) => {
    process: (
      css: string,
      options: { from: string; map: false },
    ) => Promise<{ css: string }>;
  };
  const tailwindPlugin = tailwindPostcss as unknown as () => unknown;
  const result = await postcssAny([tailwindPlugin()]).process(inputCss, {
    from: tailwindEntryFile,
    map: false,
  });
  return result.css;
};

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

  const tailwindCss = await buildTailwindCss();
  const cssOutputPath = path.join(outDir, `${outBaseName}.css`);
  const cssOutput = outputs.find(
    (output) => path.resolve(output.path) === path.resolve(cssOutputPath),
  );

  if (cssOutput) {
    const existingCss = Buffer.from(cssOutput.contents).toString("utf8");
    const combinedCss = `${existingCss}\n\n/* MCP widget Tailwind bundle */\n${tailwindCss}\n`;
    cssOutput.contents = new Uint8Array(Buffer.from(combinedCss));
  } else {
    outputs.push({
      path: cssOutputPath,
      contents: new Uint8Array(Buffer.from(tailwindCss)),
      hash: "",
      text: tailwindCss,
    });
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
