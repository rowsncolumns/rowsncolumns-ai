import * as React from "react";

import { cn } from "@/lib/utils";

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          "flex min-h-12 w-full  bg-(--card-bg-solid) px-4 rounded-none py-3 text-sm leading-6 text-foreground outline-none transition placeholder:text-(--muted-foreground)  disabled:cursor-not-allowed disabled:opacity-50 border-none",
          className,
        )}
        {...props}
      />
    );
  },
);

Textarea.displayName = "Textarea";
