import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = {
  primary:
    "bg-[var(--accent)] !text-[var(--accent-foreground)] shadow-[0_18px_40px_rgba(255,109,52,0.22)] hover:bg-[var(--accent-strong)] active:bg-[var(--accent-strong)] active:brightness-95",
  default:
    "bg-[var(--accent)] !text-[var(--accent-foreground)] shadow-[0_18px_40px_rgba(255,109,52,0.22)] hover:bg-[var(--accent-strong)] active:bg-[var(--accent-strong)] active:brightness-95",
  contrast:
    "bg-white text-[#111827] shadow-[0_10px_28px_rgba(0,0,0,0.2)] hover:opacity-90 active:opacity-90",
  secondary:
    "bg-[var(--card-bg-subtle)] text-[var(--foreground)] ring-1 ring-[var(--card-border)] hover:bg-[var(--nav-hover)] hover:shadow-[0_1px_2px_rgba(15,23,42,0.08)] active:bg-[var(--nav-hover)] active:brightness-95",
  ghost:
    "bg-transparent text-[var(--muted-foreground)] hover:bg-[var(--nav-hover)] hover:text-[var(--foreground)] active:bg-[var(--nav-hover)] active:opacity-80",
};

const buttonSizes = {
  default: "h-11 px-5 text-sm",
  sm: "h-9 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export type ButtonVariant = keyof typeof buttonVariants;
export type ButtonSize = keyof typeof buttonSizes;

type ButtonClassNameInput = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
};

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function getButtonClassName({
  className,
  variant = "primary",
  size = "default",
}: ButtonClassNameInput) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
    buttonVariants[variant],
    buttonSizes[size],
    className,
  );
}

export function Button({
  className,
  variant = "primary",
  size = "default",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={getButtonClassName({
        className,
        variant,
        size,
      })}
      {...props}
    />
  );
}
