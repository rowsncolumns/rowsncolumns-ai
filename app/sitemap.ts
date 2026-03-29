import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://rowsncolumns.ai"
).replace(/\/+$/, "");
const APP_DIR = path.join(process.cwd(), "app");
const PRIVATE_PREFIXES = new Set(["api", "auth", "doc", "mcp", "account"]);

type PageEntry = {
  filePath: string;
  routePath: string;
};

const isRouteGroup = (segment: string) =>
  segment.startsWith("(") && segment.endsWith(")");

const isDynamicSegment = (segment: string) =>
  segment.startsWith("[") && segment.endsWith("]");

const toRoutePath = (pageFilePath: string): string | null => {
  const routeDir = path.dirname(pageFilePath);
  const relativeDir = path.relative(APP_DIR, routeDir);
  const rawSegments = relativeDir.split(path.sep).filter(Boolean);

  if (rawSegments.some(isDynamicSegment)) {
    return null;
  }

  const segments = rawSegments.filter((segment) => !isRouteGroup(segment));
  if (segments.length > 0 && PRIVATE_PREFIXES.has(segments[0])) {
    return null;
  }

  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
};

const collectPageEntries = async (dirPath: string): Promise<PageEntry[]> => {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const pageEntries: PageEntry[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      pageEntries.push(...(await collectPageEntries(fullPath)));
      continue;
    }

    if (!entry.isFile() || entry.name !== "page.tsx") {
      continue;
    }

    const routePath = toRoutePath(fullPath);
    if (!routePath) {
      continue;
    }

    pageEntries.push({ filePath: fullPath, routePath });
  }

  return pageEntries;
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pageEntries = await collectPageEntries(APP_DIR);
  const deduped = new Map<string, Date>();

  for (const entry of pageEntries) {
    const pageStat = await stat(entry.filePath);
    const current = deduped.get(entry.routePath);
    if (!current || pageStat.mtime > current) {
      deduped.set(entry.routePath, pageStat.mtime);
    }
  }

  return [...deduped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([routePath, lastModified]) => ({
      url: `${SITE_URL}${routePath}`,
      lastModified,
      changeFrequency: routePath === "/" ? "weekly" : "monthly",
      priority: routePath === "/" ? 1 : 0.7,
    }));
}
