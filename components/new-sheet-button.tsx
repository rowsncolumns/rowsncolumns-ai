"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type NewSheetButtonProps = {
  className?: string;
};

export function NewSheetButton({ className }: NewSheetButtonProps) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateSheet = async () => {
    if (isCreating) return;

    setIsCreating(true);
    try {
      const response = await fetch("/api/documents", {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create document");
      }

      const { documentId } = await response.json();
      router.push(`/sheets/${documentId}`);
    } catch (error) {
      console.error("Failed to create sheet:", error);
      setIsCreating(false);
    }
  };

  return (
    <Button
      size="sm"
      className={className}
      onClick={handleCreateSheet}
      disabled={isCreating}
    >
      {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      New Sheet
    </Button>
  );
}
