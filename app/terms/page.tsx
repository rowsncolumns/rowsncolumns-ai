import type { Metadata } from "next";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { supportEmail } from "@/components/site-navigation";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Review the terms for using RowsnColumns AI and its spreadsheet workflow services.",
  alternates: {
    canonical: "/terms",
  },
};

export default function TermsPage() {
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
              Terms of Service
            </h1>
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">
              Last updated: March 29, 2026
            </p>

            <div className="mt-6 space-y-6 text-sm leading-7 text-[var(--muted-foreground)] sm:text-base">
              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  1. Acceptance of Terms
                </h2>
                <p className="mt-2">
                  By accessing or using RowsnColumns AI, you agree to these
                  Terms of Service and all applicable laws. If you are using the
                  service on behalf of an organization, you represent that you
                  have authority to bind that organization.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  2. Eligibility and Accounts
                </h2>
                <p className="mt-2">
                  You must provide accurate account information, maintain the
                  security of your credentials, and promptly notify us of
                  unauthorized use. You are responsible for activity occurring
                  under your account and workspace permissions.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  3. Service Description
                </h2>
                <p className="mt-2">
                  RowsnColumns AI provides tooling for spreadsheet workflow
                  planning, execution, verification, and audit support. Features
                  may change over time as we improve performance, security, and
                  product reliability.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  4. Customer Data and Responsibilities
                </h2>
                <p className="mt-2">
                  You retain responsibility for the legality, integrity, and
                  accuracy of data submitted to the service. You are also
                  responsible for reviewing outputs before operational,
                  financial, legal, or regulatory use.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  5. Acceptable Use Restrictions
                </h2>
                <p className="mt-2">
                  You may not use the service to violate laws, infringe rights,
                  bypass security controls, process data without authorization,
                  reverse engineer protected components, abuse APIs, or
                  interfere with platform stability.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  6. Fees and Billing
                </h2>
                <p className="mt-2">
                  Paid features, if applicable, are billed under the pricing and
                  plan terms presented at purchase or in a separate order form.
                  Unless otherwise stated, fees are non-refundable except where
                  required by law.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  7. Intellectual Property and License
                </h2>
                <p className="mt-2">
                  We retain all rights, title, and interest in the service and
                  related materials. Subject to these Terms, we grant you a
                  limited, non-exclusive, non-transferable right to access and
                  use the service for internal business purposes.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  8. Confidentiality
                </h2>
                <p className="mt-2">
                  Each party agrees to protect the other party’s confidential
                  information using reasonable safeguards and to use it only for
                  purposes of providing or receiving the service.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  9. Disclaimers
                </h2>
                <p className="mt-2">
                  The service is provided on an &quot;as is&quot; and &quot;as
                  available&quot; basis. To the maximum extent permitted by law,
                  we disclaim all implied warranties, including merchantability,
                  fitness for a particular purpose, and non-infringement.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  10. Limitation of Liability
                </h2>
                <p className="mt-2">
                  To the fullest extent permitted by law, neither party will be
                  liable for indirect, incidental, special, consequential, or
                  punitive damages, or loss of profits, revenues, data, or
                  goodwill, arising from or related to these Terms.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  11. Suspension and Termination
                </h2>
                <p className="mt-2">
                  We may suspend or terminate access for material breach, legal
                  risk, or abuse. You may stop using the service at any time.
                  Provisions that by nature should survive termination will
                  continue, including payment, confidentiality, and liability
                  clauses.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  12. Governing Law and Disputes
                </h2>
                <p className="mt-2">
                  These Terms are governed by applicable law set in your
                  customer agreement or order form. If none is specified,
                  disputes will be resolved in a mutually agreed competent
                  venue, subject to mandatory consumer or local legal
                  protections.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  13. Changes to Terms and Contact
                </h2>
                <p className="mt-2">
                  We may update these Terms from time to time. Continued use
                  after updates constitutes acceptance of the revised Terms.
                  Questions about legal terms can be sent to{" "}
                  <a
                    href={`mailto:${supportEmail}`}
                    className="font-medium text-[var(--foreground)] underline-offset-2 hover:underline"
                  >
                    {supportEmail}
                  </a>
                  .
                </p>
              </section>
            </div>
          </Card>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
