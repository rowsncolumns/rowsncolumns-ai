"use client";

import { useState } from "react";
import { Loader2, UserRoundMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type CancelInvitationButtonProps = {
  organizationId: string;
  invitationId: string;
  email: string;
};

type CancelInvitationResponse = {
  error?: string;
};

export function CancelInvitationButton({
  organizationId,
  invitationId,
  email,
}: CancelInvitationButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCancelInvitation = async () => {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/organizations/${encodeURIComponent(organizationId)}/invitations/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invitationId }),
        },
      );

      const payload = (await response.json().catch(() => null)) as
        | CancelInvitationResponse
        | null;
      if (!response.ok) {
        toast.error(payload?.error ?? "Failed to remove invitation.");
        return;
      }

      toast.success(`Pending invitation removed for ${email}.`);
      setIsOpen(false);
      router.refresh();
    } catch {
      toast.error("Failed to remove invitation.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (isSubmitting) {
          return;
        }
        setIsOpen(nextOpen);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 rounded-lg text-red-700 hover:text-red-700"
        >
          <UserRoundMinus className="h-3.5 w-3.5" />
          Remove
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove pending invitation?</AlertDialogTitle>
          <AlertDialogDescription>
            This will cancel the invite sent to {email}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleCancelInvitation}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Removing...
              </span>
            ) : (
              "Remove invitation"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
