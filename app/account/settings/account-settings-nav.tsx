import Link from "next/link";

import { cn } from "@/lib/utils";

export type AccountSettingsSegment = "profile" | "developers";

type AccountSettingsNavProps = {
  activeSegment: AccountSettingsSegment;
  className?: string;
};

const ACCOUNT_SETTINGS_TABS: Array<{
  segment: AccountSettingsSegment;
  href: string;
  label: string;
}> = [
  {
    segment: "profile",
    href: "/account/settings",
    label: "Profile",
  },
  {
    segment: "developers",
    href: "/account/settings/developers",
    label: "Developers",
  },
];

export function AccountSettingsNav({
  activeSegment,
  className,
}: AccountSettingsNavProps) {
  return (
    <nav
      className={cn(
        "mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-(--card-border) bg-(--card-bg) p-2",
        className,
      )}
      aria-label="Account settings navigation"
    >
      {ACCOUNT_SETTINGS_TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          prefetch={false}
          aria-current={tab.segment === activeSegment ? "page" : undefined}
          className={cn(
            "inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium transition",
            tab.segment === activeSegment
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
