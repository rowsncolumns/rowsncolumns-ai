"use client";

import * as React from "react";
import { Check, Copy, Link2, Loader2, X } from "lucide-react";
import { ToolbarIconButton } from "@rowsncolumns/spreadsheet";

import { Button } from "@/components/ui/button";

type ShareDocumentButtonProps = {
  documentId: string;
  canManageShare: boolean;
};

type ShareLinkResponse = {
  shareUrl?: string;
  error?: string;
};

export function ShareDocumentButton({
  documentId,
  canManageShare,
}: ShareDocumentButtonProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [shareUrl, setShareUrl] = React.useState("");
  const [error, setError] = React.useState("");
  const [copied, setCopied] = React.useState(false);

  const copiedTimeoutRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current !== null) {
        window.clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

  const markCopied = React.useCallback(() => {
    setCopied(true);
    if (copiedTimeoutRef.current !== null) {
      window.clearTimeout(copiedTimeoutRef.current);
    }
    copiedTimeoutRef.current = window.setTimeout(() => {
      setCopied(false);
    }, 1800);
  }, []);

  const createShareLink = React.useCallback(async () => {
    if (!canManageShare) return;

    setIsLoading(true);
    setError("");
    setCopied(false);

    try {
      const response = await fetch("/api/documents/share", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ documentId }),
      });

      const payload = (await response
        .json()
        .catch(() => null)) as ShareLinkResponse | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to create share link.");
      }

      if (!payload?.shareUrl) {
        throw new Error("Failed to generate share URL.");
      }

      setShareUrl(payload.shareUrl);
    } catch (errorValue) {
      setError(
        errorValue instanceof Error
          ? errorValue.message
          : "Failed to create share link.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [canManageShare, documentId]);

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      setIsOpen(nextOpen);
      if (!nextOpen || shareUrl || isLoading || !canManageShare) {
        return;
      }

      void createShareLink();
    },
    [canManageShare, createShareLink, isLoading, shareUrl],
  );

  const handleCopyLink = React.useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      markCopied();
    } catch {
      setError("Could not copy link. Please copy it manually.");
    }
  }, [markCopied, shareUrl]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("keydown", handleEsc);
    };
  }, [isOpen]);

  return (
    <>
      <ToolbarIconButton
        variant="ghost"
        size="default"
        className="gap-1 px-2 text-xs font-medium"
        disabled={!canManageShare}
        title={
          canManageShare
            ? "Share document"
            : "Only the owner can share this document"
        }
        aria-label="Share document"
        onClick={() => handleOpenChange(true)}
        tooltip="Share"
      >
        <Link2 className="h-3.5 w-3.5" />
      </ToolbarIconButton>

      {isOpen && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 px-4 backdrop-blur-[1px]"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="w-[min(92vw,460px)] rounded-2xl border border-(--card-border) bg-(--card-bg-solid) p-4 text-foreground shadow-[0_20px_44px_var(--card-shadow)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Share Link
                </p>
                <p className="text-xs text-(--muted-foreground)">
                  Anyone with this link can open this document.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-(--muted-foreground) transition hover:bg-(--nav-hover) hover:text-foreground"
                title="Close"
                aria-label="Close share dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {isLoading ? (
              <div className="flex items-center gap-2 text-xs text-(--muted-foreground)">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Generating share link...
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  readOnly
                  value={shareUrl}
                  className="h-9 w-full rounded-lg border border-(--card-border) bg-(--card-bg-solid) px-3 text-xs text-foreground outline-none"
                />
                <div className="flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void createShareLink()}
                    disabled={isLoading}
                    className="h-8 rounded-lg border border-(--card-border) bg-(--assistant-chip-bg) px-3 text-xs font-medium shadow-none hover:bg-(--assistant-chip-hover)"
                  >
                    Regenerate
                  </Button>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setIsOpen(false)}
                      className="h-8 rounded-lg border border-(--card-border) bg-(--assistant-chip-bg) px-3 text-xs font-medium shadow-none hover:bg-(--assistant-chip-hover)"
                    >
                      Done
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleCopyLink()}
                      disabled={!shareUrl || isLoading}
                      className="h-8 rounded-lg bg-(--accent) px-3 text-xs text-(--accent-foreground) hover:bg-(--accent-strong)"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {error && (
              <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
