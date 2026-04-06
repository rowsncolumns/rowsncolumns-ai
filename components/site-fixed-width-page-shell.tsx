import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { cn } from "@/lib/utils";

type SiteFixedWidthPageShellUser = {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

type SiteFixedWidthPageShellProps = {
  initialUser?: SiteFixedWidthPageShellUser;
  children: ReactNode;
  mainClassName?: string;
  headerSectionClassName?: string;
  bodySectionClassName?: string;
  bodyContainerClassName?: string;
  showFooter?: boolean;
};

export function SiteFixedWidthPageShell({
  initialUser,
  children,
  mainClassName,
  headerSectionClassName,
  bodySectionClassName,
  bodyContainerClassName,
  showFooter = true,
}: SiteFixedWidthPageShellProps) {
  return (
    <main className={cn("relative overflow-hidden", mainClassName)}>
      <div className="absolute inset-x-0 top-0 -z-10 h-152 bg-[radial-gradient(circle_at_top,rgba(255,109,52,0.22),transparent_42%)]" />

      <section
        className={cn("px-5 pt-5 sm:px-8 lg:px-12", headerSectionClassName)}
      >
        <div className="mx-auto max-w-7xl">
          <div className="hero-grid overflow-hidden rounded-[20px] border border-[var(--card-border)] bg-(--card-bg) shadow-[0_30px_80px_var(--card-shadow)] backdrop-blur">
            <div className="p-4 sm:p-6">
              <SiteHeader initialUser={initialUser} />
            </div>
          </div>
        </div>
      </section>

      <section
        className={cn("px-5 pb-12 pt-8 sm:px-8 lg:px-12", bodySectionClassName)}
      >
        <div className={cn("mx-auto max-w-7xl", bodyContainerClassName)}>
          {children}
        </div>
      </section>

      {showFooter ? <SiteFooter /> : null}
    </main>
  );
}
