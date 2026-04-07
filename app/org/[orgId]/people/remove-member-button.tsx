"use client";

import { useState } from "react";
import { Loader2, UserMinus } from "lucide-react";
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

type RemoveMemberButtonProps = {
  organizationId: string;
  memberId: string;
  memberName: string | null;
  memberEmail: string | null;
};

type RemoveMemberResponse = {
  error?: string;
};

export function RemoveMemberButton({
  organizationId,
  memberId,
  memberName,
  memberEmail,
}: RemoveMemberButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const memberLabel = memberName?.trim() || memberEmail?.trim() || "this member";

  const handleRemove = async () => {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/organizations/${encodeURIComponent(organizationId)}/members/remove`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memberId }),
        },
      );

      const payload = (await response.json().catch(() => null)) as
        | RemoveMemberResponse
        | null;
      if (!response.ok) {
        toast.error(payload?.error ?? "Failed to remove member.");
        return;
      }

      toast.success(`${memberLabel} was removed from the organization.`);
      setIsOpen(false);
      router.refresh();
    } catch {
      toast.error("Failed to remove member.");
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
          <UserMinus className="h-3.5 w-3.5" />
          Remove
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove member?</AlertDialogTitle>
          <AlertDialogDescription>
            {memberLabel} will lose access to this organization immediately.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleRemove} disabled={isSubmitting}>
            {isSubmitting ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Removing...
              </span>
            ) : (
              "Remove member"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
