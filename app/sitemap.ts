import type { MetadataRoute } from "next";
import { readdir } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 3600;

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://rowsncolumns.ai"
).replace(/\/+$/, "");
const APP_DIR = path.join(process.cwd(), "app");
const EXCLUDED_ROOT_SEGMENTS = new Set([
  "api",
  "account",
  "auth",
  "doc",
  "mcp",
  "sheets",
]);

const isRouteGroup = (segment: string) =>
  segment.startsWith("(") && segment.endsWith(")");

const isDynamicSegment = (segment: string) =>
  segment.startsWith("[") && segment.endsWith("]");

const discoverPageFiles = async (
  dir: string,
  acc: string[] = [],
): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith("_")) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await discoverPageFiles(fullPath, acc);
      continue;
    }
    if (entry.isFile() && entry.name === "page.tsx") {
      acc.push(fullPath);
    }
  }
  return acc;
};

const toRoutePath = (pageFilePath: string): string | null => {
  const relative = path.relative(APP_DIR, pageFilePath);
  const routePart = relative.replace(/\/page\.tsx$/, "");
  if (routePart === "page.tsx" || routePart === "") {
    return "/";
  }

  const rawSegments = routePart.split(path.sep).filter(Boolean);
  const urlSegments = rawSegments.filter((segment) => !isRouteGroup(segment));

  if (urlSegments.length === 0) {
    return "/";
  }

  if (urlSegments.some(isDynamicSegment)) {
    return null;
  }

  if (EXCLUDED_ROOT_SEGMENTS.has(urlSegments[0]!)) {
    return null;
  }

  return `/${urlSegments.join("/")}`;
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pageFiles = await discoverPageFiles(APP_DIR);
  const routes = new Set<string>(["/"]);

  for (const pageFile of pageFiles) {
    const routePath = toRoutePath(pageFile);
    if (routePath) {
      routes.add(routePath);
    }
  }

  return Array.from(routes)
    .sort((a, b) => a.localeCompare(b))
    .map((routePath) => ({
    url: `${SITE_URL}${routePath}`,
    lastModified: now,
    changeFrequency: routePath === "/" ? "weekly" : "monthly",
    priority: routePath === "/" ? 1 : 0.7,
    }));
}
