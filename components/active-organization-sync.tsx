"use client";

import { useEffect, useRef } from "react";

import { authClient } from "@/lib/auth/client";

type ActiveOrganizationSyncProps = {
  organizationId: string;
  sessionActiveOrganizationId?: string | null;
};

export function ActiveOrganizationSync({
  organizationId,
  sessionActiveOrganizationId,
}: ActiveOrganizationSyncProps) {
  const lastAttemptedOrganizationIdRef = useRef<string | null>(null);

  useEffect(() => {
    const normalizedOrganizationId = organizationId.trim();
    const normalizedSessionActiveOrganizationId =
      typeof sessionActiveOrganizationId === "string"
        ? sessionActiveOrganizationId.trim()
        : "";

    if (!normalizedOrganizationId) {
      return;
    }
    if (normalizedSessionActiveOrganizationId === normalizedOrganizationId) {
      return;
    }

    if (lastAttemptedOrganizationIdRef.current === normalizedOrganizationId) {
      return;
    }
    lastAttemptedOrganizationIdRef.current = normalizedOrganizationId;

    void authClient.organization
      .setActive({
        organizationId: normalizedOrganizationId,
      })
      .catch(() => {
        // Keep page usable even if active-org sync fails.
      });
  }, [organizationId, sessionActiveOrganizationId]);

  return null;
}
