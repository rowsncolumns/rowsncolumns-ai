import type { Metadata } from "next";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { supportEmail } from "@/components/site-navigation";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact RowsnColumns AI support for workspace issues, pilots, and product questions.",
  alternates: {
    canonical: "/contact",
  },
};

export default function ContactPage() {
  return (
    <main className="relative ">
      <div className="absolute inset-x-0 top-0 -z-10 h-[38rem] bg-[radial-gradient(circle_at_top,rgba(255,109,52,0.22),transparent_42%)]" />

      <section className="px-5 pb-12 pt-5 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <Card className="hero-grid  bg-[var(--card-bg)]">
            <div className="p-4 sm:p-6">
              <SiteHeader />
            </div>
          </Card>
        </div>
      </section>

      <section className="px-5 pb-12 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <Card className="mx-auto w-full bg-[var(--card-bg-solid)] p-6 shadow-[0_24px_70px_var(--card-shadow)] sm:p-8">
            <h1 className="display-font text-3xl font-semibold text-[var(--foreground)] sm:text-4xl">
              Contact and Support
            </h1>
            <p className="mt-3 text-base leading-7 text-[var(--muted-foreground)]">
              Use the details below for sales enquiries and company information.
            </p>

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
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
