"use client";

import { useEffect, useRef } from "react";
import { authClient } from "@/lib/auth/client";
import { identifyUser } from "@/lib/analytics";

/**
 * Component that identifies the current user with PostHog.
 * Place this in your layout or app root.
 */
export const PostHogIdentify = () => {
  const { data: sessionData } = authClient.useSession();
  const identifiedRef = useRef<string | null>(null);

  useEffect(() => {
    const user = sessionData?.user;

    if (!user?.id) {
      return;
    }

    // Only identify if we haven't already identified this user
    if (identifiedRef.current === user.id) {
      return;
    }

    identifyUser(user.id, {
      email: user.email ?? undefined,
      name: user.name ?? undefined,
      image: user.image ?? undefined,
    });

    identifiedRef.current = user.id;
  }, [sessionData?.user]);

  return null;
};
