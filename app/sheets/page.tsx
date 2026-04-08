import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Search, X } from "lucide-react";

import { NewSheetButton } from "@/components/new-sheet-button";
import { ActiveOrganizationSync } from "@/components/active-organization-sync";
import { PageTitleBlock } from "@/components/page-title-block";
import { SheetsBulkActions } from "@/components/sheets-bulk-actions";
import { SheetsSelectionProvider } from "@/components/sheets-selection";
import { SheetsFilterPicker } from "@/components/sheets-filter-picker";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeaderFrame } from "@/components/site-header-frame";
import { SheetsTable } from "@/components/sheets-table";
import { Button, getButtonClassName } from "@/components/ui/button";
import {
  getActiveOrganizationIdFromSession,
  listOrganizationsForSession,
  resolveActiveOrganizationIdForSession,
} from "@/lib/auth/organization";
import { getServerSessionSafe } from "@/lib/auth/session-safe";
import {
  listOwnedDocuments,
  type DocumentListFilter,
} from "@/lib/documents/repository";

const PAGE_SIZE = 20;
const SHEETS_BASE_PATH = "/sheets";
type SheetsListFilter = Exclude<DocumentListFilter, "templates">;

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

const parsePageNumber = (raw: string | null): number => {
  if (!raw) {
    return 1;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
};

const parseFilter = (raw: string | null): SheetsListFilter => {
  if (raw === "owned" || raw === "shared" || raw === "my_shared") {
    return raw;
  }
  return "owned";
};

const parseSearchQuery = (raw: string | null): string | null => {
  if (!raw) {
    return null;
  }
  const normalized = raw.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 120);
};

const buildSheetsHref = ({
  basePath,
  page,
  filter,
  query,
}: {
  basePath: string;
  page: number;
  filter: SheetsListFilter;
  query?: string | null;
}) => {
  const searchParams = new URLSearchParams();
  if (page > 1) {
    searchParams.set("page", String(page));
  }
  if (filter !== "owned") {
    searchParams.set("filter", filter);
  }
  const normalizedQuery = query?.trim();
  if (normalizedQuery) {
    searchParams.set("q", normalizedQuery);
  }

  const serialized = searchParams.toString();
  return serialized ? `${basePath}?${serialized}` : basePath;
};

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "My Sheets",
  description: "View and manage all sheets you created.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function SheetsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const queryParams = await searchParams;
  const page = parsePageNumber(parseSingleValue(queryParams.page));
  const filter = parseFilter(parseSingleValue(queryParams.filter));
  const query = parseSearchQuery(parseSingleValue(queryParams.q));
  const callbackPath = buildSheetsHref({
    basePath: SHEETS_BASE_PATH,
    page,
    filter,
    query,
  });

  const session = await getServerSessionSafe();
  if (!session?.user) {
    redirect(`/auth/sign-in?callbackURL=${encodeURIComponent(callbackPath)}`);
  }

  const activeOrganizationId =
    await resolveActiveOrganizationIdForSession(session);
  const organizations = await listOrganizationsForSession();
  const organization =
    organizations.find((item) => item.id === activeOrganizationId) ??
    organizations[0] ??
    null;
  if (!organization) {
    redirect(
      `/onboarding/organization?callbackURL=${encodeURIComponent(callbackPath)}`,
    );
  }

  const result = await listOwnedDocuments({
    userId: session.user.id,
    orgId: organization.id,
    page,
    pageSize: PAGE_SIZE,
    filter,
    query,
    excludeTemplates: true,
  });
  const descriptionByFilter: Record<SheetsListFilter, string> = {
    owned: "Sheets created by your account.",
    shared: "Sheets shared with you by other users.",
    my_shared: "Sheets you created that are currently shared.",
  };

  return (
    <main className="flex min-h-dvh w-full flex-col overflow-x-hidden">
      <ActiveOrganizationSync
        organizationId={organization.id}
        sessionActiveOrganizationId={getActiveOrganizationIdFromSession(session)}
      />
      <div className="px-4 py-4 sm:px-5 sm:py-5">
        <div className="mb-4">
          <SiteHeaderFrame
            initialUser={{
              id: session.user.id,
              name: session.user.name,
              email: session.user.email,
              image: session.user.image,
            }}
          />
        </div>

        <section className="rounded-2xl border border-(--card-border) bg-(--card-bg) p-4 shadow-[0_12px_32px_var(--card-shadow)] sm:p-5">
          <SheetsSelectionProvider initialItems={result.items}>
            <div className="mb-4 space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <PageTitleBlock
                    className="pb-0"
                    title="My Sheets"
                    tagline={descriptionByFilter[filter]}
                  />
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  <SheetsBulkActions className="hidden sm:flex" />
                  <NewSheetButton
                    basePath={SHEETS_BASE_PATH}
                    className="h-9 shrink-0 rounded-lg px-4"
                  />
                </div>
              </div>

              <div className="flex w-full items-center gap-2">
                <form
                  action={SHEETS_BASE_PATH}
                  method="get"
                  className="flex min-w-0 flex-1 flex-nowrap items-center gap-2"
                >
                  {filter !== "owned" ? (
                    <input type="hidden" name="filter" value={filter} />
                  ) : null}

                  <input
                    type="search"
                    name="q"
                    defaultValue={query ?? ""}
                    placeholder="Search by sheet title"
                    aria-label="Search by sheet title"
                    className="h-9 min-w-0 flex-1 rounded-lg border border-(--panel-border) bg-(--assistant-chip-bg) px-2.5 text-xs text-foreground outline-none transition placeholder:text-(--muted-foreground) focus:border-(--focus-border)"
                  />
                  <div className="min-w-0 shrink-0">
                    <SheetsFilterPicker
                      value={filter}
                      query={query}
                      basePath={SHEETS_BASE_PATH}
                      buttonClassName="w-auto"
                    />
                  </div>
                  <Button
                    type="submit"
                    size="sm"
                    variant="secondary"
                    className="h-9 w-9 rounded-lg p-0"
                    aria-label="Search sheets"
                  >
                    <Search className="h-4 w-4" />
                    <span className="sr-only">Search</span>
                  </Button>
                  {query ? (
                    <Link
                      href={buildSheetsHref({
                        basePath: SHEETS_BASE_PATH,
                        page: 1,
                        filter,
                        query: null,
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

            <SheetsTable
              basePath={SHEETS_BASE_PATH}
              documents={result.items}
              page={result.page}
              totalPages={result.totalPages}
              totalCount={result.totalCount}
              filter={filter}
              query={query}
            />
          </SheetsSelectionProvider>
        </section>
      </div>

      <SiteFooter fullWidth />
    </main>
  );
}
