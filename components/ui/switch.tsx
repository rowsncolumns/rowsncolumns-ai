"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, checked, ...props }, ref) => {
  const isChecked = typeof checked === "boolean" ? checked : undefined;

  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors outline-none",
        "data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-black/20",
        "focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      checked={checked}
      {...props}
      ref={ref}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none absolute left-[0px] top-[0px] block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform",
          isChecked === undefined
            ? "data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0"
            : "",
        )}
        style={
          isChecked === undefined
            ? undefined
            : { transform: `translateX(${isChecked ? 20 : 0}px)` }
        }
      />
    </SwitchPrimitive.Root>
  );
});
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
