import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

import {
  parseSpreadsheetBuffer,
  SUPPORTED_IMPORT_EXTENSIONS,
} from "../lib/documents/import/parsers";

type CliOptions = {
  inputPath: string;
  outputPath?: string;
  stdout: boolean;
};

const usage = () => {
  console.log(
    [
      "Usage:",
      "  yarn import:parse-snapshot <file.xlsx|file.ods|file.csv> [--out <output.json>] [--stdout]",
      "",
      "Examples:",
      "  yarn import:parse-snapshot ./samples/budget.xlsx",
      "  yarn import:parse-snapshot ./samples/report.ods --out ./tmp/report.snapshot.json",
      "  yarn import:parse-snapshot ./samples/data.csv --stdout",
    ].join("\n"),
  );
};

const parseArgs = (argv: string[]): CliOptions | null => {
  if (argv.length === 0) {
    return null;
  }

  let inputPath: string | undefined;
  let outputPath: string | undefined;
  let stdout = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out" || arg === "-o") {
      outputPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--stdout") {
      stdout = true;
      continue;
    }
    if (!arg.startsWith("-") && !inputPath) {
      inputPath = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!inputPath) {
    throw new Error("Missing input file path.");
  }

  return {
    inputPath,
    outputPath,
    stdout,
  };
};

const getExtension = (filePath: string) =>
  extname(filePath).slice(1).toLowerCase();

const buildDefaultOutputPath = (inputPath: string): string => {
  const extension = extname(inputPath);
  const base = basename(inputPath, extension);
  return resolve(process.cwd(), `${base}.snapshot.json`);
};

const main = async () => {
  const rawArgv = process.argv.slice(2);
  if (rawArgv.includes("--help") || rawArgv.includes("-h")) {
    usage();
    process.exit(0);
  }

  const args = parseArgs(rawArgv);
  if (!args) {
    usage();
    process.exit(1);
  }

  const extension = getExtension(args.inputPath);
  if (!SUPPORTED_IMPORT_EXTENSIONS.has(extension)) {
    throw new Error(
      `Unsupported extension "${extension}". Supported: ${Array.from(
        SUPPORTED_IMPORT_EXTENSIONS,
      ).join(", ")}`,
    );
  }

  const inputBuffer = await readFile(resolve(process.cwd(), args.inputPath));
  const filename = basename(args.inputPath);
  const snapshot = await parseSpreadsheetBuffer(
    inputBuffer,
    filename,
    extension,
  );

  const snapshotJson = JSON.stringify(snapshot, null, 2);
  const outputPath = args.outputPath
    ? resolve(process.cwd(), args.outputPath)
    : buildDefaultOutputPath(args.inputPath);

  if (args.stdout) {
    process.stdout.write(`${snapshotJson}\n`);
  } else {
    await writeFile(outputPath, snapshotJson, "utf8");
    console.log(`Snapshot written to: ${outputPath}`);
  }
  console.log(snapshot.cellXfs);

  console.log(
    [
      "Snapshot summary:",
      `  Sheets: ${snapshot.sheets.length}`,
      `  Cells: ${Object.keys(snapshot.sheetData).length}`,
      `  Tables: ${snapshot.tables.length}`,
      `  Charts: ${snapshot.charts.length}`,
      `  Drawings: ${snapshot.embeds.length}`,
    ].join("\n"),
  );
};

main().catch((error) => {
  console.error("[parse-spreadsheet-snapshot] failed");
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  process.exit(1);
});
