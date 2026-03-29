import type { Metadata } from "next";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { supportEmail } from "@/components/site-navigation";
import { Card } from "@/components/ui/card";
import { getServerSessionSafe } from "@/lib/auth/session-safe";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Read how RowsnColumns AI handles data, workbook content, and account information.",
  alternates: {
    canonical: "/privacy",
  },
};

export default async function PrivacyPage() {
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
    <main className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 -z-10 h-[38rem] bg-[radial-gradient(circle_at_top,rgba(255,109,52,0.22),transparent_42%)]" />

      <section className="px-5 pb-12 pt-5 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <Card className="hero-grid overflow-hidden bg-[var(--card-bg)]">
            <div className="p-4 sm:p-6">
              <SiteHeader initialUser={initialUser} />
            </div>
          </Card>
        </div>
      </section>

      <section className="px-5 pb-12 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <Card className="mx-auto w-full bg-[var(--card-bg-solid)] p-6 shadow-[0_24px_70px_var(--card-shadow)] sm:p-8">
            <h1 className="display-font text-3xl font-semibold text-[var(--foreground)] sm:text-4xl">
              Privacy Policy
            </h1>
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">
              Last updated: March 29, 2026
            </p>

            <div className="mt-6 space-y-6 text-sm leading-7 text-[var(--muted-foreground)] sm:text-base">
              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  1. Scope and Applicability
                </h2>
                <p className="mt-2">
                  This Privacy Policy describes how RowsnColumns AI collects,
                  uses, stores, and discloses personal data when you access our
                  website, authentication flows, workspace features, support
                  channels, and related services. It applies to customer users,
                  trial users, visitors, and authorized administrators acting on
                  behalf of an organization.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  2. Categories of Data We Process
                </h2>
                <p className="mt-2">
                  We may process account identifiers (name, email, user ID),
                  authentication and session data, workspace metadata, prompts,
                  workbook-level operations, generated outputs, audit trails,
                  usage telemetry, and support communications. If your
                  organization connects external systems, we may also process
                  integration metadata required to complete requested actions.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  3. Purposes of Processing
                </h2>
                <p className="mt-2">
                  We process data to provide and secure the service, authenticate
                  users, execute spreadsheet workflows, maintain auditability,
                  prevent abuse, support billing and service operations, and
                  improve reliability. We do not sell personal data.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  4. Lawful Bases
                </h2>
                <p className="mt-2">
                  Depending on jurisdiction, our lawful bases may include
                  performance of a contract, legitimate interests (for security
                  and service operations), compliance with legal obligations, and
                  consent where required.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  5. Sharing and Subprocessors
                </h2>
                <p className="mt-2">
                  We may share data with hosting, infrastructure, analytics,
                  authentication, and support vendors acting under contractual
                  confidentiality and data protection obligations. Data may also
                  be disclosed where required by law, court order, or valid
                  government request.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  6. Retention and Deletion
                </h2>
                <p className="mt-2">
                  Data retention depends on account configuration, operational
                  needs, and legal requirements. Workflow artifacts and logs are
                  retained only as long as needed for service delivery, audit,
                  security, and compliance, then deleted or de-identified in
                  accordance with internal controls.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  7. Security
                </h2>
                <p className="mt-2">
                  We implement administrative, technical, and organizational
                  safeguards designed to protect data against unauthorized
                  access, loss, misuse, or alteration. No method of transmission
                  or storage is fully risk-free, so we encourage customers to
                  apply access controls and review policies within their own
                  environments.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  8. International Data Transfers
                </h2>
                <p className="mt-2">
                  If data is transferred across borders, we use appropriate legal
                  and contractual mechanisms required by applicable privacy laws.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  9. Your Rights
                </h2>
                <p className="mt-2">
                  Subject to local law, you may request access, correction,
                  deletion, objection, restriction, or portability of your
                  personal data, and may appeal decisions where applicable.
                  Requests are handled in accordance with identity verification
                  and legal requirements.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  10. Children’s Data
                </h2>
                <p className="mt-2">
                  The service is intended for business and professional use and
                  is not directed to children under the age required by
                  applicable law.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  11. Policy Updates
                </h2>
                <p className="mt-2">
                  We may revise this Policy from time to time. Material updates
                  will be reflected by the &quot;Last updated&quot; date and, where required,
                  additional notice.
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  12. Contact and Legal Requests
                </h2>
                <p className="mt-2">
                  Privacy and legal requests can be sent to{" "}
                  <a
                    href={`mailto:${supportEmail}`}
                    className="font-medium text-[var(--foreground)] underline-offset-2 hover:underline"
                  >
                    {supportEmail}
                  </a>
                  . Please include your organization, request type, and relevant
                  account identifier to help us process your request.
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
