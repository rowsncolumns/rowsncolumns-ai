import { AdminCreditRefillCard } from "@/components/admin-credit-refill-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SiteHeader } from "@/components/site-header";
import { siteNavigation } from "@/components/site-navigation";
import { isAdminUser } from "@/lib/auth/admin";
import { auth } from "@/lib/auth/server";
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
  const { data: session } = await auth.getSession();

  if (!session?.user) {
    redirect("/auth/sign-in?callbackURL=/account/settings");
  }

  const user = session.user;
  const isAdmin = isAdminUser({ id: user.id, email: user.email });
  const credits = await getUserCredits(user.id);
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
            <CardHeader>
              <CardTitle className="display-font text-2xl">Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 text-sm text-(--muted-foreground)">
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
                  Daily Credits
                </h3>
                <p className="mt-2">
                  <span className="font-medium text-foreground">Remaining:</span>{" "}
                  {credits.balance}/{INITIAL_CREDITS}
                </p>
                <p>
                  <span className="font-medium text-foreground">Reset:</span>{" "}
                  {nextResetLabel} (UTC)
                </p>
                <p className="mt-1 text-xs">
                  Credits reset to {INITIAL_CREDITS} every day and do not roll
                  over.
                </p>
              </div>

              {isAdmin ? <AdminCreditRefillCard currentUserId={user.id} /> : null}

              <form action="/auth/sign-out" method="post">
                <button
                  type="submit"
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-(--card-border) bg-(--card-bg-solid) px-4 text-sm font-medium text-foreground transition hover:opacity-80"
                >
                  Log out
                </button>
              </form>
            </CardContent>
          </Card>
        </div>
      </section>

      <footer className="px-5 pb-10 pt-4 sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 rounded-[18px] border border-(--card-border) bg-(--card-bg) px-6 py-5 text-sm text-(--muted-foreground) md:flex-row md:items-center md:justify-between">
          <p>
            RowsnColumns AI. Built for spreadsheet-native teams that need speed
            with control.
          </p>
          <div className="flex flex-wrap gap-4">
            {siteNavigation.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </main>
  );
}
