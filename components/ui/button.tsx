import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = {
  default:
    "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[0_18px_40px_rgba(255,109,52,0.22)] hover:bg-[var(--accent-strong)]",
  secondary:
    "bg-[var(--card-bg-solid)] text-[var(--foreground)] ring-1 ring-[var(--card-border)] hover:opacity-90",
  ghost:
    "bg-transparent text-[var(--muted-foreground)] hover:bg-[var(--nav-hover)] hover:text-[var(--foreground)]",
};

const buttonSizes = {
  default: "h-11 px-5 text-sm",
  sm: "h-9 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
};

export function Button({
  className,
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    />
  );
}
