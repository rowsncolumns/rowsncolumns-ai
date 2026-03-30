import Link from "next/link";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getButtonClassName } from "@/components/ui/button";
import { supportEmail } from "@/components/site-navigation";
import { Card } from "@/components/ui/card";
import { getServerSessionSafe } from "@/lib/auth/session-safe";

export default async function NotFound() {
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
          <Card className="mx-auto w-full max-w-4xl bg-[var(--card-bg-solid)] p-6 shadow-[0_24px_70px_var(--card-shadow)] sm:p-8">
            <div className="grid gap-6 md:grid-cols-[auto_1fr] md:items-center md:gap-10">
              <div className="display-font text-6xl font-semibold tracking-tight text-[var(--foreground)] sm:text-7xl md:text-8xl">
                404
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                  Page not found
                </p>
                <h1 className="display-font mt-3 text-3xl font-semibold text-[var(--foreground)] sm:text-4xl">
                  This link no longer points to an active page.
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--muted-foreground)] sm:text-base">
                  The page may have moved, the URL might be incomplete, or the
                  shared document is no longer available.
                </p>

                <div className="mt-7 flex flex-wrap gap-3">
                  <Link
                    href="/"
                    className={getButtonClassName({
                      variant: "primary",
                    })}
                  >
                    Back to home
                  </Link>
                  <Link
                    href="/sheets"
                    className={getButtonClassName({
                      variant: "secondary",
                    })}
                  >
                    Open sheets
                  </Link>
                </div>

                <p className="mt-5 text-sm text-[var(--muted-foreground)]">
                  Need help recovering a document?{" "}
                  <a
                    href={`mailto:${supportEmail}`}
                    className="font-medium text-[var(--foreground)] underline-offset-2 hover:underline"
                  >
                    Contact support
                  </a>
                  .
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
