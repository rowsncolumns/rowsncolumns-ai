import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Search } from "lucide-react";

import { NewSheetButton } from "@/components/new-sheet-button";
import { SheetsFilterPicker } from "@/components/sheets-filter-picker";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SheetsTable } from "@/components/sheets-table";
import { Button, getButtonClassName } from "@/components/ui/button";
import { getServerSessionSafe } from "@/lib/auth/session-safe";
import {
  listOwnedDocuments,
  type DocumentListFilter,
} from "@/lib/documents/repository";

const PAGE_SIZE = 20;

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

const parseFilter = (raw: string | null): DocumentListFilter => {
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
  page,
  filter,
  query,
}: {
  page: number;
  filter: DocumentListFilter;
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
  return serialized ? `/sheets?${serialized}` : "/sheets";
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
  const params = await searchParams;
  const page = parsePageNumber(parseSingleValue(params.page));
  const filter = parseFilter(parseSingleValue(params.filter));
  const query = parseSearchQuery(parseSingleValue(params.q));
  const callbackPath = buildSheetsHref({ page, filter, query });

  const session = await getServerSessionSafe();
  if (!session?.user) {
    redirect(`/auth/sign-in?callbackURL=${encodeURIComponent(callbackPath)}`);
  }

  const result = await listOwnedDocuments({
    userId: session.user.id,
    page,
    pageSize: PAGE_SIZE,
    filter,
    query,
  });
  const descriptionByFilter: Record<DocumentListFilter, string> = {
    owned: "Sheets created by your account.",
    shared: "Sheets shared with you by other users.",
    my_shared: "Sheets you created that are currently shared.",
  };

  return (
    <main className="flex min-h-dvh w-full flex-col overflow-x-hidden">
      <div className="px-4 py-4 sm:px-5 sm:py-5">
        <div className="mb-4">
          <SiteHeader
            initialUser={{
              id: session.user.id,
              name: session.user.name,
              email: session.user.email,
              image: session.user.image,
            }}
          />
        </div>

        <section className="rounded-2xl border border-(--card-border) bg-(--card-bg) p-4 shadow-[0_12px_32px_var(--card-shadow)] sm:p-5">
          <div className="mb-4 space-y-2.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">
                  My Sheets
                </h1>
                <p className="text-sm text-(--muted-foreground)">
                  {descriptionByFilter[result.filter]}
                </p>
              </div>
              <NewSheetButton className="h-9 shrink-0 rounded-lg px-4" />
            </div>

            <div className="flex w-full items-center gap-2">
              <form
                action="/sheets"
                method="get"
                className="flex min-w-0 flex-1 flex-nowrap items-center gap-2"
              >
                {result.filter !== "owned" ? (
                  <input type="hidden" name="filter" value={result.filter} />
                ) : null}

                <input
                  type="search"
                  name="q"
                  defaultValue={query ?? ""}
                  placeholder="Search by sheet title"
                  aria-label="Search by sheet title"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-(--panel-border) bg-(--assistant-chip-bg) px-2.5 text-xs text-foreground outline-none transition placeholder:text-(--muted-foreground) focus:border-(--accent)"
                />
                <div className="min-w-0 shrink-0">
                  <SheetsFilterPicker
                    value={result.filter}
                    query={query}
                    hideLabelOnMobile
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
                      page: 1,
                      filter: result.filter,
                      query: null,
                    })}
                    className={getButtonClassName({
                      variant: "ghost",
                      size: "sm",
                      className: "rounded-lg px-2.5",
                    })}
                  >
                    Clear
                  </Link>
                ) : null}
              </form>
            </div>
          </div>

          <SheetsTable
            documents={result.items}
            page={result.page}
            totalPages={result.totalPages}
            totalCount={result.totalCount}
            filter={result.filter}
            query={query}
          />
        </section>
      </div>

      <SiteFooter fullWidth />
    </main>
  );
}
