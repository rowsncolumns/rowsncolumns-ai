"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type InviteOrganizationMemberProps = {
  organizationId: string;
};

type InviteResponse = {
  error?: string;
};

export function InviteOrganizationMember({
  organizationId,
}: InviteOrganizationMemberProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedEmail = email.trim().toLowerCase();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!normalizedEmail || isSubmitting) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(
        `/api/organizations/${encodeURIComponent(organizationId)}/invitations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: normalizedEmail,
            role,
          }),
        },
      );

      const payload = (await response.json().catch(() => null)) as
        | InviteResponse
        | null;

      if (!response.ok) {
        const message = payload?.error ?? "Failed to send invitation.";
        setError(message);
        return;
      }

      toast.success(`Invitation sent to ${normalizedEmail}.`);
      setEmail("");
      setRole("member");
      setIsOpen(false);
      router.refresh();
    } catch {
      setError("Failed to send invitation.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (isSubmitting) {
          return;
        }
        setError(null);
        setIsOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" className="h-10 rounded-lg">
          <Plus className="h-4 w-4" />
          Invite member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
            <DialogDescription>
              Send an invitation to join this organization as a member or admin.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label
              htmlFor="invite-email"
              className="text-sm font-medium text-foreground"
            >
              Email
            </label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              autoComplete="email"
              required
              disabled={isSubmitting}
              className="h-11 w-full rounded-lg border border-(--panel-border) bg-(--assistant-chip-bg) px-3 text-sm text-foreground outline-none transition placeholder:text-(--muted-foreground) focus:border-(--focus-border) disabled:cursor-not-allowed disabled:opacity-70"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="invite-role-trigger"
              className="text-sm font-medium text-foreground"
            >
              Role
            </label>
            <Select
              value={role}
              onValueChange={(value) => setRole(value as "member" | "admin")}
              disabled={isSubmitting}
            >
              <SelectTrigger id="invite-role-trigger">
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                if (isSubmitting) return;
                setError(null);
                setIsOpen(false);
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!normalizedEmail || isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                "Send invite"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
