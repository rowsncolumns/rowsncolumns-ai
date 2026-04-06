import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { Search, X } from "lucide-react";

import { PageTitleBlock } from "@/components/page-title-block";
import { SiteFixedWidthPageShell } from "@/components/site-fixed-width-page-shell";
import { TemplateSettingsTrigger } from "@/components/template-settings-trigger";
import { Button, getButtonClassName } from "@/components/ui/button";
import { getServerSessionSafe } from "@/lib/auth/session-safe";
import {
  listOwnedDocumentIds,
  listTemplateDocuments,
} from "@/lib/documents/repository";
import { cn } from "@/lib/utils";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const parseSingleValue = (
  value: string | string[] | undefined,
): string | null => {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return null;
};

const normalizeQuery = (value: string | null): string | null => {
  const normalized = value?.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 120);
};

const normalizeCategory = (value: string | null): string | null => {
  const normalized = value?.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.toLowerCase() === "all") {
    return null;
  }
  return normalized.slice(0, 80);
};

const buildTemplatesHref = ({
  query,
  category,
}: {
  query?: string | null;
  category?: string | null;
}) => {
  const params = new URLSearchParams();
  if (query?.trim()) {
    params.set("q", query.trim());
  }
  if (category?.trim()) {
    params.set("category", category.trim());
  }
  const serialized = params.toString();
  return serialized ? `/templates?${serialized}` : "/templates";
};

const fallbackTemplateDescription =
  "Ready-to-use RowsnColumns spreadsheet template.";

const getSummaryFromMarkdown = (value: string): string => {
  const normalized = value
    .replace(/[`*_#>\-\[\]\(\)!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return fallbackTemplateDescription;
  }
  return normalized.slice(0, 220);
};

export const metadata: Metadata = {
  title: "Free Excel templates",
  description:
    "Browse spreadsheet templates and open them directly in RowsnColumns AI.",
  alternates: {
    canonical: "/templates",
  },
};

export const dynamic = "force-dynamic";

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const query = normalizeQuery(parseSingleValue(params.q));
  const selectedCategory = normalizeCategory(parseSingleValue(params.category));

  const session = await getServerSessionSafe();
  const ownerDocumentIds = session?.user?.id
    ? await listOwnedDocumentIds(session.user.id)
    : [];
  const ownerDocumentIdSet = new Set(ownerDocumentIds);
  const [templates, categorySource] = await Promise.all([
    listTemplateDocuments({
      query,
      category: selectedCategory,
    }),
    listTemplateDocuments({
      query,
      limit: 500,
    }),
  ]);

  const grouped = templates.reduce<Map<string, typeof templates>>(
    (acc, item) => {
      const existing = acc.get(item.category);
      if (existing) {
        existing.push(item);
        return acc;
      }
      acc.set(item.category, [item]);
      return acc;
    },
    new Map(),
  );

  const categoryOptions = Array.from(
    new Set(categorySource.map((template) => template.category)),
  ).sort((a, b) => a.localeCompare(b));

  return (
    <SiteFixedWidthPageShell
      initialUser={
        session?.user
          ? {
              id: session.user.id,
              name: session.user.name,
              email: session.user.email,
              image: session.user.image,
            }
          : undefined
      }
    >
      <section className="mx-auto w-full rounded-2xl border border-(--card-border) bg-(--card-bg-solid) p-7 shadow-[0_24px_70px_var(--card-shadow)] sm:p-8">
        <div className="mb-4 space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <PageTitleBlock
                className="pb-0"
                title="Templates"
                tagline="Browse curated spreadsheet templates and open your own copy."
              />
            </div>
          </div>

          <div className="flex w-full items-center gap-2">
            <form
              action="/templates"
              method="get"
              className="flex min-w-0 flex-1 flex-nowrap items-center gap-2"
            >
              {selectedCategory ? (
                <input type="hidden" name="category" value={selectedCategory} />
              ) : null}

              <input
                type="search"
                name="q"
                defaultValue={query ?? ""}
                placeholder="Search templates..."
                aria-label="Search templates"
                className="h-9 min-w-0 flex-1 rounded-lg border border-(--panel-border) bg-(--assistant-chip-bg) px-2.5 text-xs text-foreground outline-none transition placeholder:text-(--muted-foreground) focus:border-(--accent)"
              />
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                className="h-9 w-9 rounded-lg p-0"
                aria-label="Search templates"
              >
                <Search className="h-4 w-4" />
                <span className="sr-only">Search</span>
              </Button>
              {query ? (
                <Link
                  href={buildTemplatesHref({
                    query: null,
                    category: selectedCategory,
                  })}
                  className={getButtonClassName({
                    variant: "secondary",
                    size: "sm",
                    className: "h-9 w-9 rounded-lg p-0",
                  })}
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Clear search</span>
                </Link>
              ) : null}
            </form>
          </div>
        </div>

        <div className="mb-5 rounded-xl border border-(--card-border) bg-(--card-bg-solid) p-3">
          <div className="flex flex-wrap gap-2">
            <Link
              href={buildTemplatesHref({ query, category: null })}
              className={cn(
                "rounded-full border border-transparent px-3 py-1.5 text-xs font-semibold transition",
                !selectedCategory && "border-(--panel-border-strong)",
              )}
            >
              All Templates
            </Link>
            {categoryOptions.map((category) => (
              <Link
                key={category}
                href={buildTemplatesHref({ query, category })}
                className={cn(
                  "rounded-full border border-transparent px-3 py-1.5 text-xs font-semibold transition",
                  selectedCategory === category &&
                    "border-(--panel-border-strong)",
                )}
              >
                {category}
              </Link>
            ))}
          </div>
        </div>

        {templates.length === 0 ? (
          <div className="rounded-xl border border-dashed border-(--card-border) bg-(--card-bg-solid) px-4 py-10 text-center text-sm text-(--muted-foreground)">
            No templates found for this filter.
          </div>
        ) : (
          <div className="space-y-8">
            {Array.from(grouped.entries()).map(([category, items]) => (
              <section key={category} className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-lg font-semibold text-foreground">
                    {category}
                  </h2>
                  <p className="text-xs text-(--muted-foreground)">
                    {items.length} template{items.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((template) => {
                    const displayTitle =
                      template.templateTitle || template.title;
                    const displayTagline =
                      template.tagline.trim() ||
                      getSummaryFromMarkdown(template.descriptionMarkdown);
                    const detailsHref = `/templates/${encodeURIComponent(template.docId)}`;

                    return (
                      <article
                        key={template.docId}
                        className="overflow-hidden rounded-lg border border-(--card-border) bg-(--card-bg-solid)"
                      >
                        <Link
                          href={detailsHref}
                          className="relative block aspect-16/8 overflow-hidden border-b border-(--card-border) bg-[linear-gradient(120deg,#eef2ff,#f8fafc)]"
                        >
                          {template.previewImageUrl ? (
                            <Image
                              src={template.previewImageUrl}
                              alt={`${displayTitle} preview`}
                              fill
                              unoptimized
                              sizes="(min-width: 1280px) 22vw, (min-width: 640px) 45vw, 94vw"
                              className="object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center px-4 text-center text-[11px] font-medium tracking-wide text-(--muted-foreground)">
                              Preview image not set
                            </div>
                          )}
                        </Link>

                        <div className="space-y-2.5 p-3">
                          <div>
                            <h3 className="text-sm font-semibold text-foreground">
                              <Link
                                href={detailsHref}
                                className="hover:underline"
                              >
                                {displayTitle}
                              </Link>
                            </h3>
                            <p className="mt-1 line-clamp-2 text-xs font-medium text-(--muted-foreground)">
                              {displayTagline}
                            </p>
                          </div>

                          {template.tags.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {template.tags.map((tag) => (
                                <span
                                  key={`${template.docId}:${tag}`}
                                  className="rounded-full border border-(--card-border) bg-(--assistant-chip-bg) px-1.5 py-0.5 text-[10px] font-medium text-(--muted-foreground)"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : null}

                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-[11px] text-(--muted-foreground)">
                              Updated{" "}
                              {new Intl.DateTimeFormat(undefined, {
                                dateStyle: "medium",
                              }).format(new Date(template.updatedAt))}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              {ownerDocumentIdSet.has(template.docId) ? (
                                <TemplateSettingsTrigger
                                  template={template}
                                  triggerMode="button"
                                  triggerLabel="Edit template"
                                  triggerClassName="h-7 rounded-md px-2.5 text-[11px] whitespace-nowrap"
                                />
                              ) : null}
                              <a
                                href={`/sheets/${encodeURIComponent(template.docId)}`}
                                className={getButtonClassName({
                                  variant: "secondary",
                                  size: "sm",
                                  className:
                                    "h-7 rounded-md px-2.5 text-[11px] whitespace-nowrap",
                                })}
                              >
                                View
                              </a>
                              <a
                                href={`/templates/open/${encodeURIComponent(template.docId)}`}
                                className={getButtonClassName({
                                  size: "sm",
                                  className:
                                    "h-7 rounded-md px-2.5 text-[11px] whitespace-nowrap",
                                })}
                              >
                                Fork
                              </a>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </SiteFixedWidthPageShell>
  );
}
