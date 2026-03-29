import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 3600;

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://rowsncolumns.ai"
).replace(/\/+$/, "");
const PUBLIC_ROUTES = ["/", "/contact", "/privacy", "/terms"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return PUBLIC_ROUTES.map((routePath) => ({
    url: `${SITE_URL}${routePath}`,
    lastModified: now,
    changeFrequency: routePath === "/" ? "weekly" : "monthly",
    priority: routePath === "/" ? 1 : 0.7,
  }));
}
