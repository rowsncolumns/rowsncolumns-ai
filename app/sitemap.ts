import type { MetadataRoute } from "next";
import { listTemplateSitemapEntries } from "@/lib/documents/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 3600;

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://rowsncolumns.ai"
).replace(/\/+$/, "");

/**
 * Static public routes that should appear in the sitemap.
 * Update this list when adding new public pages.
 */
const STATIC_ROUTES = [
  "/",
  "/contact",
  "/pricing",
  "/privacy",
  "/templates",
  "/terms",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const routes = new Set<string>(STATIC_ROUTES);

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
