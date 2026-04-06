import type { MetadataRoute } from "next";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { listTemplateSitemapEntries } from "@/lib/documents/repository";

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

  const staticEntries: MetadataRoute.Sitemap = Array.from(routes)
    .sort((a, b) => a.localeCompare(b))
    .map((routePath): MetadataRoute.Sitemap[number] => ({
      url: `${SITE_URL}${routePath}`,
      lastModified: now,
      changeFrequency:
        routePath === "/" || routePath === "/templates"
          ? ("weekly" as const)
          : ("monthly" as const),
      priority: routePath === "/" ? 1 : routePath === "/templates" ? 0.8 : 0.7,
    }));

  const dynamicTemplateEntries: MetadataRoute.Sitemap = [];
  try {
    const templates = await listTemplateSitemapEntries();
    for (const template of templates) {
      dynamicTemplateEntries.push({
        url: `${SITE_URL}/templates/${encodeURIComponent(template.docId)}`,
        lastModified: template.updatedAt ? new Date(template.updatedAt) : now,
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }
  } catch (error) {
    console.error("Failed to load template documents for sitemap.", error);
  }

  const mergedEntries = new Map<string, MetadataRoute.Sitemap[number]>();
  for (const entry of [...staticEntries, ...dynamicTemplateEntries]) {
    const existing = mergedEntries.get(entry.url);
    if (!existing) {
      mergedEntries.set(entry.url, entry);
      continue;
    }
    mergedEntries.set(entry.url, {
      ...existing,
      ...entry,
      lastModified:
        (entry.lastModified ?? now) > (existing.lastModified ?? now)
          ? entry.lastModified
          : existing.lastModified,
    });
  }

  return Array.from(mergedEntries.values()).sort((a, b) =>
    a.url.localeCompare(b.url),
  );
}
