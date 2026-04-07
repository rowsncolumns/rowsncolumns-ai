import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowRight, ChevronRight } from "lucide-react";

import { PageTitleBlock } from "@/components/page-title-block";
import { SiteFixedWidthPageShell } from "@/components/site-fixed-width-page-shell";
import { TemplateSettingsTrigger } from "@/components/template-settings-trigger";
import { getButtonClassName } from "@/components/ui/button";
import { getServerSessionSafe } from "@/lib/auth/session-safe";
import { resolveActiveOrganizationIdForSession } from "@/lib/auth/organization";
import {
  getTemplateDocumentById,
  listOwnedDocumentIds,
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

const appendOrgIdQuery = (href: string, orgId: string | null): string => {
  if (!orgId) {
    return href;
  }
  return `${href}?orgId=${encodeURIComponent(orgId)}`;
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
  const session = await getServerSessionSafe();
  const activeOrganizationId = session?.user
    ? await resolveActiveOrganizationIdForSession(session)
    : null;
  const template = await getTemplateDocumentById({
    docId: documentId,
    orgId: activeOrganizationId,
  });

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

  const session = await getServerSessionSafe();

  const activeOrganizationId = session?.user
    ? await resolveActiveOrganizationIdForSession(session)
    : null;
  const template = await getTemplateDocumentById({
    docId: documentId,
    orgId: activeOrganizationId,
  });
  if (!template) {
    notFound();
  }
  const ownerDocumentIdSet = new Set(
    session?.user?.id
      ? await listOwnedDocumentIds(session.user.id, activeOrganizationId)
      : [],
  );
  const canEditTemplate = ownerDocumentIdSet.has(template.docId);

  const relatedTemplates = (
    await listTemplateDocuments({
      category: template.category,
      orgId: activeOrganizationId,
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
  const viewHref = `/templates/${encodeURIComponent(template.docId)}/view`;
  const forkHref = appendOrgIdQuery(
    `/templates/open/${encodeURIComponent(template.docId)}`,
    activeOrganizationId,
  );

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
      <section className="mx-auto w-full rounded-2xl border border-(--card-border) bg-(--card-bg-solid) p-7 shadow-[0_24px_70px_var(--card-shadow)] sm:p-8 mb-8">
        <nav className="mb-5 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-(--muted-foreground)">
          <Link href="/templates" className="transition hover:text-foreground">
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
            <PageTitleBlock
              className="pb-0"
              title={template.templateTitle}
              tagline={summary}
              taglineClassName="max-w-2xl"
            />

            <div className="flex flex-wrap items-center gap-3">
              <a
                href={viewHref}
                className={getButtonClassName({
                  variant: "secondary",
                  size: "lg",
                  className: "h-11 rounded-xl px-5",
                })}
              >
                View
              </a>
              <a
                href={forkHref}
                className={getButtonClassName({
                  size: "lg",
                  className: "h-11 rounded-xl px-5",
                })}
              >
                Fork
                <ArrowRight className="h-4 w-4" />
              </a>
              {canEditTemplate ? (
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
              <Image
                src={template.previewImageUrl}
                alt={`${template.templateTitle} preview`}
                width={1600}
                height={900}
                unoptimized
                sizes="(min-width: 1024px) 42vw, 100vw"
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

      <section className="mx-auto w-full rounded-2xl border border-(--card-border) bg-(--card-bg-solid) p-7 shadow-[0_24px_70px_var(--card-shadow)] sm:p-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
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
                href={viewHref}
                className={getButtonClassName({
                  variant: "secondary",
                  className: "mt-4 h-10 w-full rounded-lg text-sm",
                })}
              >
                View
              </a>
              <a
                href={forkHref}
                className={getButtonClassName({
                  className: "mt-2 h-10 w-full rounded-lg text-sm",
                })}
              >
                Fork
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
                <div className="relative aspect-[16/9] bg-[linear-gradient(120deg,#eef2ff,#f8fafc)]">
                  {item.previewImageUrl ? (
                    <Image
                      src={item.previewImageUrl}
                      alt={`${item.templateTitle} preview`}
                      fill
                      unoptimized
                      sizes="(min-width: 768px) 30vw, 100vw"
                      className="object-cover transition duration-200 group-hover:scale-[1.01]"
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
    </SiteFixedWidthPageShell>
  );
}
