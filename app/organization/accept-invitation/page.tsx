import type { Metadata } from "next";
import Link from "next/link";
import { headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";

import { PageTitleBlock } from "@/components/page-title-block";
import { SiteFixedWidthPageShell } from "@/components/site-fixed-width-page-shell";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth/server";
import { getServerSessionSafe } from "@/lib/auth/session-safe";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const readSingleParam = (
  value: string | string[] | undefined,
): string | null => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
};

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Organization Invitation",
  description: "Review your organization invitation.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const invitationId = readSingleParam(params.id)?.trim() ?? "";

  if (!invitationId) {
    redirect("/sheets?invitation=missing");
  }

  const callbackPath = `/organization/accept-invitation?id=${encodeURIComponent(invitationId)}`;
  const session = await getServerSessionSafe();
  if (!session?.user) {
    redirect(`/auth/sign-in?callbackURL=${encodeURIComponent(callbackPath)}`);
  }

  const requestHeaders = await nextHeaders();
  const invitation = await auth.api
    .getInvitation({
      headers: requestHeaders,
      query: { id: invitationId },
    })
    .catch(() => null);

  const initialUser = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
  };

  if (!invitation) {
    return (
      <SiteFixedWidthPageShell initialUser={initialUser}>
        <section className="mx-auto w-full max-w-2xl rounded-2xl border border-(--card-border) bg-(--card-bg-solid) p-7 shadow-[0_24px_70px_var(--card-shadow)] sm:p-8">
          <PageTitleBlock
            title="Invitation not available"
            tagline="This invitation is invalid, expired, or no longer pending."
          />
          <div className="pt-4">
            <Link
              href="/sheets"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-(--card-border) bg-(--card-bg) px-4 text-sm font-medium text-foreground transition hover:opacity-80"
            >
              Go to sheets
            </Link>
          </div>
        </section>
      </SiteFixedWidthPageShell>
    );
  }

  const roleLabel =
    invitation.role === "admin"
      ? "Admin"
      : invitation.role === "member"
        ? "Member"
        : invitation.role;
  const expiresLabel = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(invitation.expiresAt));

  return (
    <SiteFixedWidthPageShell initialUser={initialUser}>
      <section className="mx-auto w-full max-w-2xl rounded-2xl border border-(--card-border) bg-(--card-bg-solid) p-7 shadow-[0_24px_70px_var(--card-shadow)] sm:p-8">
        <PageTitleBlock
          title="Organization invitation"
          tagline="Review the details before accepting or declining."
        />

        <div className="mt-4 rounded-xl border border-(--card-border) bg-(--card-bg) p-5 text-sm text-(--muted-foreground)">
          <p>
            <span className="font-medium text-foreground">Organization:</span>{" "}
            {invitation.organizationName}
          </p>
          <p className="mt-2">
            <span className="font-medium text-foreground">Invited email:</span>{" "}
            {invitation.email}
          </p>
          <p className="mt-2">
            <span className="font-medium text-foreground">Role:</span> {roleLabel}
          </p>
          <p className="mt-2">
            <span className="font-medium text-foreground">Invited by:</span>{" "}
            {invitation.inviterEmail}
          </p>
          <p className="mt-2">
            <span className="font-medium text-foreground">Expires (UTC):</span>{" "}
            {expiresLabel}
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <form action="/organization/accept-invitation/respond" method="post">
            <input type="hidden" name="invitationId" value={invitation.id} />
            <input type="hidden" name="action" value="accept" />
            <Button type="submit">Accept invitation</Button>
          </form>

          <form action="/organization/accept-invitation/respond" method="post">
            <input type="hidden" name="invitationId" value={invitation.id} />
            <input type="hidden" name="action" value="decline" />
            <Button type="submit" variant="secondary">
              Decline invitation
            </Button>
          </form>
        </div>
      </section>
    </SiteFixedWidthPageShell>
  );
}
