import * as React from "react";

import { cn } from "@/lib/utils";

type BadgeProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "outline" | "muted";
};

export function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  const variants = {
    default:
      "border-transparent bg-[var(--badge)] text-[var(--badge-foreground)]",
    outline: "border-[var(--card-border)] bg-[var(--card-bg-subtle)] text-[var(--foreground)]",
    muted:
      "border-transparent bg-[var(--feature-card-bg)] text-[var(--muted-foreground)]",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
