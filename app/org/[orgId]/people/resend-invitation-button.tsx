"use client";

import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type ResendInvitationButtonProps = {
  organizationId: string;
  invitationId: string;
  email: string;
};

type ResendResponse = {
  error?: string;
};

export function ResendInvitationButton({
  organizationId,
  invitationId,
  email,
}: ResendInvitationButtonProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleResend = async () => {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/organizations/${encodeURIComponent(organizationId)}/invitations/resend`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invitationId }),
        },
      );

      const payload = (await response.json().catch(() => null)) as
        | ResendResponse
        | null;
      if (!response.ok) {
        toast.error(payload?.error ?? "Failed to resend invitation.");
        return;
      }

      toast.success(`Invitation resent to ${email}.`);
      router.refresh();
    } catch {
      toast.error("Failed to resend invitation.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={handleResend}
      disabled={isSubmitting}
      className="h-8 rounded-lg"
    >
      {isSubmitting ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Resending...
        </>
      ) : (
        <>
          <RotateCcw className="h-3.5 w-3.5" />
          Resend
        </>
      )}
    </Button>
  );
}
