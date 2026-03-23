"use client";

import { useRef, useState } from "react";

import { authClient } from "@/lib/auth/client";

type SignOutButtonProps = {
  className?: string;
  label?: string;
  pendingLabel?: string;
};

export function SignOutButton({
  className,
  label = "Log out",
  pendingLabel = "Logging out...",
}: SignOutButtonProps) {
  const signOutFormRef = useRef<HTMLFormElement>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);
    try {
      const { error } = await authClient.signOut();
      if (error) {
        signOutFormRef.current?.requestSubmit();
        return;
      }
      window.location.assign("/");
    } catch {
      signOutFormRef.current?.requestSubmit();
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <>
      <form ref={signOutFormRef} action="/auth/sign-out" method="post" />
      <button
        type="button"
        disabled={isSigningOut}
        className={className}
        onClick={() => {
          void handleSignOut();
        }}
      >
        {isSigningOut ? pendingLabel : label}
      </button>
    </>
  );
}
