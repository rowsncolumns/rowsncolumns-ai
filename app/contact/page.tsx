import type { Metadata } from "next";

import { PageTitleBlock } from "@/components/page-title-block";
import { supportEmail } from "@/components/site-navigation";
import { SiteFixedWidthPageShell } from "@/components/site-fixed-width-page-shell";
import { Card } from "@/components/ui/card";
import { getServerSessionSafe } from "@/lib/auth/session-safe";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact RowsnColumns AI support for workspace issues, pilots, and product questions.",
  alternates: {
    canonical: "/contact",
  },
};

export default async function ContactPage() {
  const session = await getServerSessionSafe();
  const initialUser = session?.user
    ? {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }
    : undefined;

  return (
    <SiteFixedWidthPageShell
      initialUser={initialUser}
      bodySectionClassName="px-5 pb-12 pt-8 sm:px-8 lg:px-12"
    >
      <Card className="mx-auto w-full bg-[var(--card-bg-solid)] p-6 shadow-[0_24px_70px_var(--card-shadow)] sm:p-8">
        <PageTitleBlock
          title="Contact and Support"
          tagline="Use the details below for sales enquiries and company information."
        />

        <div className="mt-6 grid gap-4 sm:mt-8">
          <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
              Sales enquiries
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
              For sales enquiries contact us at{" "}
              <a
                href={`mailto:${supportEmail}`}
                className="font-semibold text-[var(--foreground)] underline-offset-2 hover:underline"
              >
                {supportEmail}
              </a>
              .
            </p>
          </div>

          <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
              Company
            </p>
            <p className="mt-2 text-sm leading-7 text-[var(--muted-foreground)]">
              <span className="font-semibold text-[var(--foreground)]">
                RowsnColumns
              </span>
              <br />
              75 Punggol Central, #05-78
              <br />
              Singapore - 828757
              <br />
              <br />
              UEN: 53466564X
            </p>
          </div>
        </div>
      </Card>
    </SiteFixedWidthPageShell>
  );
}
