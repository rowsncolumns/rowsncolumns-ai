import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeaderFrame } from "@/components/site-header-frame";
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
          <SiteHeaderFrame initialUser={initialUser} />
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
