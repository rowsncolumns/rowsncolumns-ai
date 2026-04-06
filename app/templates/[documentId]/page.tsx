import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowRight, ChevronRight } from "lucide-react";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { TemplateSettingsTrigger } from "@/components/template-settings-trigger";
import { getButtonClassName } from "@/components/ui/button";
import { isAdminUser } from "@/lib/auth/admin";
import { getServerSessionSafe } from "@/lib/auth/session-safe";
import {
  getTemplateDocumentById,
  listTemplateDocuments,
} from "@/lib/documents/repository";

type RouteParams = Promise<{ documentId: string }>;

const markdownPlugins = [remarkGfm];

const fallbackDescription = "Ready-to-use RowsnColumns spreadsheet template.";

const getSummaryFromMarkdown = (value: string): string => {
  const normalized = value
    .replace(/[`*_#>\-\[\]\(\)!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return fallbackDescription;
  }
  return normalized.slice(0, 220);
};

const buildCategoryHref = (category: string) => {
  const params = new URLSearchParams();
  params.set("category", category);
  return `/templates?${params.toString()}`;
};

const resolveTemplateTagline = ({
  tagline,
  descriptionMarkdown,
}: {
  tagline: string;
  descriptionMarkdown: string;
}) => tagline.trim() || getSummaryFromMarkdown(descriptionMarkdown);

export async function generateMetadata({
  params,
}: {
  params: RouteParams;
}): Promise<Metadata> {
  const { documentId } = await params;
  const template = await getTemplateDocumentById({ docId: documentId });

  if (!template) {
    return {
      title: "Template Not Found",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const title = `${template.templateTitle} · Templates`;
  const description = resolveTemplateTagline({
    tagline: template.tagline,
    descriptionMarkdown: template.descriptionMarkdown || fallbackDescription,
  });

  return {
    title,
    description,
    alternates: {
      canonical: `/templates/${encodeURIComponent(template.docId)}`,
    },
  };
}

export const dynamic = "force-dynamic";

export default async function TemplateDetailsPage({
  params,
}: {
  params: RouteParams;
}) {
  const { documentId } = await params;

  const [session, template] = await Promise.all([
    getServerSessionSafe(),
    getTemplateDocumentById({ docId: documentId }),
  ]);

  if (!template) {
    notFound();
  }

  const isAdmin = isAdminUser({
    id: session?.user?.id,
    email: session?.user?.email,
  });

  const relatedTemplates = (
    await listTemplateDocuments({
      category: template.category,
      limit: 9,
    })
  )
    .filter((item) => item.docId !== template.docId)
    .slice(0, 3);

  const summary = resolveTemplateTagline({
    tagline: template.tagline,
    descriptionMarkdown: template.descriptionMarkdown || fallbackDescription,
  });
  const categoryHref = buildCategoryHref(template.category);

  return (
    <main className="flex min-h-dvh w-full flex-col overflow-x-hidden">
      <div className="px-5 py-4 sm:px-8 sm:py-5 lg:px-12">
        <div className="mx-auto w-full max-w-7xl">
          <div className="mb-4">
          <SiteHeader
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
          />
          </div>

        <section className="rounded-2xl border border-(--card-border) bg-(--card-bg) p-4 shadow-[0_12px_32px_var(--card-shadow)] sm:p-5">
          <nav className="mb-5 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-(--muted-foreground)">
            <Link
              href="/templates"
              className="transition hover:text-foreground"
            >
              Templates
            </Link>
            <ChevronRight className="h-3 w-3" />
            <Link
              href={categoryHref}
              className="transition hover:text-foreground"
            >
              {template.category}
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground">{template.templateTitle}</span>
          </nav>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,42%)]">
            <div className="space-y-4">
              <h1 className="text-3xl font-semibold tracking-[-0.02em] text-foreground sm:text-4xl">
                {template.templateTitle}
              </h1>
              <p className="max-w-2xl text-base text-(--muted-foreground)">
                {summary}
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={`/templates/open/${encodeURIComponent(template.docId)}`}
                  className={getButtonClassName({
                    size: "lg",
                    className: "h-11 rounded-xl px-5",
                  })}
                >
                  Open in Rnc
                  <ArrowRight className="h-4 w-4" />
                </a>
                {isAdmin ? (
                  <TemplateSettingsTrigger
                    template={template}
                    triggerMode="button"
                    triggerLabel="Edit template"
                    triggerClassName="h-11 rounded-xl px-4"
                  />
                ) : null}
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-(--card-border) bg-[linear-gradient(120deg,#eef2ff,#f8fafc)]">
              {template.previewImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={template.previewImageUrl}
                  alt={`${template.templateTitle} preview`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex aspect-[16/9] h-full items-center justify-center p-6 text-center text-sm text-(--muted-foreground)">
                  Preview image not set
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-(--card-border) bg-(--card-bg-solid) p-4 sm:p-5">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
            <article className="space-y-3">
              <h2 className="text-2xl font-semibold tracking-[-0.01em] text-foreground">
                About {template.templateTitle}
              </h2>
              <div className="prose prose-sm max-w-none text-(--muted-foreground)">
                <ReactMarkdown remarkPlugins={markdownPlugins}>
                  {template.descriptionMarkdown || fallbackDescription}
                </ReactMarkdown>
              </div>
            </article>

            <aside className="space-y-4">
              <div className="rounded-xl border border-(--card-border) bg-(--card-bg) p-4">
                <h3 className="text-base font-semibold text-foreground">
                  {template.templateTitle}
                </h3>
                <p className="mt-1 line-clamp-2 text-sm text-(--muted-foreground)">
                  {summary}
                </p>
                <p className="mt-1 text-xs text-(--muted-foreground)">
                  Free spreadsheet template
                </p>
                <a
                  href={`/templates/open/${encodeURIComponent(template.docId)}`}
                  className={getButtonClassName({
                    className: "mt-4 h-10 w-full rounded-lg text-sm",
                  })}
                >
                  Open in Rnc
                </a>
              </div>

              {template.tags.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-(--muted-foreground)">
                    Tags
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {template.tags.map((tag) => (
                      <span
                        key={`${template.docId}:${tag}`}
                        className="rounded-full border border-(--card-border) bg-(--assistant-chip-bg) px-2.5 py-1 text-xs text-(--muted-foreground)"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-(--muted-foreground)">
                  Category
                </p>
                <Link
                  href={categoryHref}
                  className="inline-flex items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline"
                >
                  More {template.category} templates
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </aside>
          </div>
        </section>

          {relatedTemplates.length > 0 ? (
          <section className="mt-4 rounded-2xl border border-(--card-border) bg-(--card-bg-solid) p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-foreground">
                More In {template.category}
              </h2>
              <Link
                href={categoryHref}
                className="text-xs font-medium text-(--muted-foreground) hover:text-foreground"
              >
                View all
              </Link>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {relatedTemplates.map((item) => (
                <Link
                  key={item.docId}
                  href={`/templates/${encodeURIComponent(item.docId)}`}
                  className="group overflow-hidden rounded-xl border border-(--card-border) bg-(--card-bg)"
                >
                  <div className="aspect-[16/9] bg-[linear-gradient(120deg,#eef2ff,#f8fafc)]">
                    {item.previewImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.previewImageUrl}
                        alt={`${item.templateTitle} preview`}
                        className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.01]"
                      />
                    ) : null}
                  </div>
                  <div className="p-3">
                    <p className="line-clamp-2 text-sm font-medium text-foreground">
                      {item.templateTitle}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
          ) : null}
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}
