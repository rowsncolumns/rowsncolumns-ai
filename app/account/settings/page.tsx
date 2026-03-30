import { AdminCreditRefillCard } from "@/components/admin-credit-refill-card";
import { SignOutButton } from "@/components/sign-out-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { isAdminUser } from "@/lib/auth/admin";
import { getUserBillingEntitlement } from "@/lib/billing/repository";
import { getServerSessionSafe } from "@/lib/auth/session-safe";
import { INITIAL_CREDITS } from "@/lib/credits/pricing";
import { getUserCredits } from "@/lib/credits/repository";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Account Settings",
  description:
    "Manage your RowsnColumns AI account profile, daily credits, and access settings.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AccountSettingsPage() {
  const session = await getServerSessionSafe();

  if (!session?.user) {
    redirect("/auth/sign-in?callbackURL=/account/settings");
  }

  const user = session.user;
  const isAdmin = isAdminUser({ id: user.id, email: user.email });
  const [credits, billing] = await Promise.all([
    getUserCredits(user.id),
    getUserBillingEntitlement(user.id),
  ]);
  const nextResetAt = new Date(`${credits.creditDay}T00:00:00.000Z`);
  nextResetAt.setUTCDate(nextResetAt.getUTCDate() + 1);
  const nextResetLabel = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(nextResetAt);

  return (
    <main className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 -z-10 h-152 bg-[radial-gradient(circle_at_top,rgba(255,109,52,0.22),transparent_42%)]" />

      <section className="px-5 pt-5 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <Card className="hero-grid overflow-hidden bg-(--card-bg)">
            <div className="p-4 sm:p-6">
              <SiteHeader
                initialUser={{
                  id: user.id,
                  name: user.name,
                  email: user.email,
                  image: user.image,
                }}
              />
            </div>
          </Card>
        </div>
      </section>

      <section className="px-5 pb-12 pt-8 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <Card className="mx-auto w-full bg-(--card-bg-solid) shadow-[0_24px_70px_var(--card-shadow)]">
            <CardHeader className="pb-2">
              <CardTitle className="display-font text-2xl">Settings</CardTitle>
              <p className="mt-1 text-sm leading-7 text-(--muted-foreground) sm:text-base">
                Update your account details and review your current credit
                configuration.
              </p>
            </CardHeader>
            <CardContent className="space-y-6 pt-1 sm:pt-2 text-sm text-(--muted-foreground)">
              <div className="space-y-3">
                <p>
                  <span className="font-medium text-foreground">Name:</span>{" "}
                  {user.name || "N/A"}
                </p>
                <p>
                  <span className="font-medium text-foreground">Email:</span>{" "}
                  {user.email}
                </p>
              </div>

              <div className="rounded-xl border border-(--card-border) bg-(--card-bg) p-4">
                <h3 className="display-font text-lg font-semibold text-foreground">
                  Credits
                </h3>
                <p className="mt-2">
                  <span className="font-medium text-foreground">
                    Available:
                  </span>{" "}
                  {isAdmin
                    ? "Unlimited"
                    : `${credits.availableCredits}`}
                </p>
                <p>
                  <span className="font-medium text-foreground">Paid:</span>{" "}
                  {isAdmin ? "N/A" : credits.paidBalance}
                </p>
                <p>
                  <span className="font-medium text-foreground">
                    Free daily remaining:
                  </span>{" "}
                  {isAdmin ? "N/A" : `${credits.dailyFreeRemaining}/${INITIAL_CREDITS}`}
                </p>
                <p>
                  <span className="font-medium text-foreground">Plan:</span>{" "}
                  {billing.plan.toUpperCase()}
                </p>
                <p>
                  <span className="font-medium text-foreground">Reset:</span>{" "}
                  {isAdmin
                    ? "Not applicable (admin account)"
                    : billing.plan === "free"
                      ? `${nextResetLabel} (UTC)`
                      : "Not applicable on paid plans"}
                </p>
                {isAdmin ? (
                  <p className="mt-1 text-xs">
                    Admin users have unlimited assistant credits.
                  </p>
                ) : (
                  <p className="mt-1 text-xs">
                    {billing.plan === "free"
                      ? `Free credits reset to ${INITIAL_CREDITS} every day and do not roll over.`
                      : "Paid plans use durable credits and do not get the daily free reset."}
                  </p>
                )}
                <a
                  href="/account/billing"
                  className="mt-3 inline-flex h-9 items-center justify-center rounded-lg border border-(--card-border) bg-(--card-bg-solid) px-3 text-xs font-medium text-foreground transition hover:opacity-80"
                >
                  Open Billing
                </a>
              </div>

              {isAdmin ? (
                <AdminCreditRefillCard currentUserId={user.id} />
              ) : null}

              <SignOutButton className="inline-flex h-10 items-center justify-center rounded-lg border border-(--card-border) bg-(--card-bg-solid) px-4 text-sm font-medium text-foreground transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-70" />
            </CardContent>
          </Card>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
