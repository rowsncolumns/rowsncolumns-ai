"use client";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

type NewSheetButtonProps = {
  className?: string;
};

export function NewSheetButton({ className }: NewSheetButtonProps) {
  const router = useRouter();

  return (
    <Button
      size="sm"
      className={className}
      onClick={() => {
        router.push(`/sheets/new`);
      }}
    >
      New Sheet
    </Button>
  );
}
