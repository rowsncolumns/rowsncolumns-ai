import Link from "next/link";

import { getButtonClassName } from "@/components/ui/button";

type NewSheetButtonProps = {
  className?: string;
};

export function NewSheetButton({ className }: NewSheetButtonProps) {
  return (
    <Link
      href="/sheets/new"
      className={getButtonClassName({ size: "sm", className })}
    >
      New Sheet
    </Link>
  );
}
