import Link from "next/link";

import { cn } from "@/lib/utils";

type OrganizationNavTab = {
  href: string;
  label: string;
  isActive: boolean;
};

type OrganizationNavProps = {
  tabs: OrganizationNavTab[];
  className?: string;
};

export function OrganizationNav({ tabs, className }: OrganizationNavProps) {
  return (
    <nav
      className={cn(
        "mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-(--card-border) bg-(--card-bg) p-2",
        className,
      )}
      aria-label="Organization navigation"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          prefetch={false}
          aria-current={tab.isActive ? "page" : undefined}
          className={cn(
            "inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium transition",
            tab.isActive
              ? "bg-(--accent) text-(--accent-foreground)"
              : "text-(--muted-foreground) hover:bg-(--assistant-chip-bg) hover:text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
