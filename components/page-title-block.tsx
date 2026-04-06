import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageTitleBlockProps = {
  title: ReactNode;
  tagline?: ReactNode;
  className?: string;
  titleClassName?: string;
  taglineClassName?: string;
};

export function PageTitleBlock({
  title,
  tagline,
  className,
  titleClassName,
  taglineClassName,
}: PageTitleBlockProps) {
  return (
    <div className={cn("pb-2", className)}>
      <h1
        className={cn(
          "text-xl font-semibold tracking-[-0.01em] text-foreground",
          titleClassName,
        )}
      >
        {title}
      </h1>
      {tagline ? (
        <p
          className={cn(
            "mt-1 text-sm leading-7 text-(--muted-foreground) sm:text-base",
            taglineClassName,
          )}
        >
          {tagline}
        </p>
      ) : null}
    </div>
  );
}
