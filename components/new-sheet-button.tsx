"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

type NewSheetButtonProps = {
  className?: string;
};

const createDocumentId = (): string => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

export function NewSheetButton({ className }: NewSheetButtonProps) {
  const router = useRouter();

  return (
    <Button
      size="sm"
      className={className}
      onClick={() => {
        router.push(`/sheets/${createDocumentId()}`);
      }}
    >
      New Sheet
    </Button>
  );
}
