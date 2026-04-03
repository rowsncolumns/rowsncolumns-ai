"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { NewDocumentDialog } from "@/components/new-document-dialog";
import { Button } from "@/components/ui/button";

type NewSheetButtonProps = {
  className?: string;
};

export function NewSheetButton({ className }: NewSheetButtonProps) {
  const router = useRouter();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleDocumentCreated = async (documentId: string) => {
    router.push(`/sheets/${documentId}`);
  };

  return (
    <>
      <Button size="sm" className={className} onClick={() => setIsDialogOpen(true)}>
        New Sheet
      </Button>
      <NewDocumentDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onCreated={handleDocumentCreated}
      />
    </>
  );
}
