"use client";

import * as React from "react";
import { Check, Copy, Link2, Loader2, Share2, X } from "lucide-react";
import { ToolbarIconButton } from "@rowsncolumns/spreadsheet";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type ShareDocumentButtonProps = {
  documentId: string;
  canManageShare: boolean;
};

type SharePermission = "view" | "edit";

type ShareLinkResponse = {
  isActive?: boolean;
  wasActive?: boolean;
  shareUrl?: string;
  permission?: SharePermission;
  error?: string;
};

export function ShareDocumentButton({
  documentId,
  canManageShare,
}: ShareDocumentButtonProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isUpdatingPermission, setIsUpdatingPermission] = React.useState(false);
  const [isUnsharing, setIsUnsharing] = React.useState(false);
  const [shareUrl, setShareUrl] = React.useState("");
  const [permission, setPermission] = React.useState<SharePermission>("edit");
  const [copied, setCopied] = React.useState(false);
  const [canNativeShare, setCanNativeShare] = React.useState(false);

  const copiedTimeoutRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    setCanNativeShare(typeof navigator !== "undefined" && "share" in navigator);
  }, []);

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

  const loadShareState = React.useCallback(async () => {
    if (!canManageShare) {
      return;
    }

    setIsLoading(true);
    setCopied(false);

    try {
      const response = await fetch(
        `/api/documents/share?documentId=${encodeURIComponent(documentId)}`,
        {
          method: "GET",
        },
      );
      const payload = (await response
        .json()
        .catch(() => null)) as ShareLinkResponse | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load share settings.");
      }

      const hasActiveShareLink =
        payload?.isActive !== false && typeof payload?.shareUrl === "string";
      if (!hasActiveShareLink) {
        setShareUrl("");
        return;
      }

      setShareUrl(payload.shareUrl?.trim() ?? "");
      setPermission(payload.permission === "view" ? "view" : "edit");
    } catch (errorValue) {
      const message =
        errorValue instanceof Error
          ? errorValue.message
          : "Failed to load share settings.";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [canManageShare, documentId]);

  const createShareLink = React.useCallback(async () => {
    if (!canManageShare) return;

    setIsLoading(true);
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
      setPermission(payload.permission === "view" ? "view" : "edit");
    } catch (errorValue) {
      const message =
        errorValue instanceof Error
          ? errorValue.message
          : "Failed to create share link.";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [canManageShare, documentId]);

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      setIsOpen(nextOpen);
      if (!nextOpen || isLoading || !canManageShare) {
        return;
      }

      void loadShareState();
    },
    [canManageShare, isLoading, loadShareState],
  );

  const handleCopyLink = React.useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      markCopied();
      toast.success("Share link copied.");
    } catch {
      toast.error("Could not copy link. Please copy it manually.");
    }
  }, [markCopied, shareUrl]);

  const handleNativeShare = React.useCallback(async () => {
    if (
      !shareUrl ||
      typeof navigator === "undefined" ||
      !("share" in navigator)
    ) {
      return;
    }

    try {
      await navigator.share({
        title: "Share document",
        text: "Open this document:",
        url: shareUrl,
      });
    } catch (errorValue) {
      if (
        errorValue instanceof DOMException &&
        errorValue.name === "AbortError"
      ) {
        return;
      }
      toast.error("Could not open native share. Please copy the link instead.");
    }
  }, [shareUrl]);

  const updateSharePermission = React.useCallback(
    async (nextPermission: SharePermission) => {
      if (
        !canManageShare ||
        !shareUrl ||
        isLoading ||
        isUpdatingPermission ||
        isUnsharing
      ) {
        return;
      }
      if (nextPermission === permission) {
        return;
      }

      setIsUpdatingPermission(true);
      try {
        const response = await fetch("/api/documents/share", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            documentId,
            permission: nextPermission,
          }),
        });

        const payload = (await response
          .json()
          .catch(() => null)) as ShareLinkResponse | null;
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to update permission.");
        }

        if (payload?.shareUrl) {
          setShareUrl(payload.shareUrl);
        }
        setPermission(payload?.permission === "view" ? "view" : "edit");
        toast.success(
          nextPermission === "view"
            ? "Share permission set to Can view."
            : "Share permission set to Can edit.",
        );
      } catch (errorValue) {
        const message =
          errorValue instanceof Error
            ? errorValue.message
            : "Failed to update permission.";
        toast.error(message);
      } finally {
        setIsUpdatingPermission(false);
      }
    },
    [
      canManageShare,
      documentId,
      isLoading,
      isUnsharing,
      isUpdatingPermission,
      permission,
      shareUrl,
    ],
  );

  const handleStopSharing = React.useCallback(async () => {
    if (
      !canManageShare ||
      !shareUrl ||
      isLoading ||
      isUpdatingPermission ||
      isUnsharing
    ) {
      return;
    }

    setIsUnsharing(true);
    setCopied(false);

    try {
      const response = await fetch("/api/documents/share", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ documentId }),
      });
      const payload = (await response
        .json()
        .catch(() => null)) as ShareLinkResponse | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to disable sharing.");
      }

      setShareUrl("");
      setPermission("edit");
      toast.success("Sharing disabled.");
    } catch (errorValue) {
      const message =
        errorValue instanceof Error
          ? errorValue.message
          : "Failed to disable sharing.";
      toast.error(message);
    } finally {
      setIsUnsharing(false);
    }
  }, [
    canManageShare,
    documentId,
    isLoading,
    isUnsharing,
    isUpdatingPermission,
    shareUrl,
  ]);

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

      {typeof document !== "undefined"
        ? createPortal(
            isOpen ? (
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
                        Anyone with this link can open this document. Permission
                        controls whether they can edit.
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
                      <div className="rounded-lg border border-(--card-border) bg-(--assistant-chip-bg) p-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-(--muted-foreground)">
                          Permission
                        </p>
                        <div className="mt-1.5 inline-flex gap-1 rounded-lg border border-(--card-border) bg-(--card-bg-solid) p-1">
                          <Button
                            type="button"
                            size="sm"
                            variant={
                              permission === "view" ? "default" : "secondary"
                            }
                            onClick={() => void updateSharePermission("view")}
                            disabled={isUpdatingPermission || isLoading}
                            className="h-7 rounded-md px-2.5 text-xs"
                          >
                            Can view
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={
                              permission === "edit" ? "default" : "secondary"
                            }
                            onClick={() => void updateSharePermission("edit")}
                            disabled={isUpdatingPermission || isLoading}
                            className="h-7 rounded-md px-2.5 text-xs"
                          >
                            Can edit
                          </Button>
                        </div>
                        <p className="mt-1 text-[11px] text-(--muted-foreground)">
                          {permission === "view"
                            ? "Recipients can view but cannot edit."
                            : "Recipients can view and edit."}
                        </p>
                      </div>
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
                          onClick={() => setIsOpen(false)}
                          className="h-8 rounded-lg border border-(--card-border) bg-(--assistant-chip-bg) px-3 text-xs font-medium shadow-none hover:bg-(--assistant-chip-hover)"
                        >
                          Done
                        </Button>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {canNativeShare ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => void handleNativeShare()}
                              disabled={
                                !shareUrl || isLoading || isUpdatingPermission
                              }
                              className="h-8 rounded-lg border border-(--card-border) bg-(--assistant-chip-bg) px-3 text-xs font-medium shadow-none hover:bg-(--assistant-chip-hover)"
                            >
                              <Share2 className="h-3.5 w-3.5" />
                              Share link
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void handleCopyLink()}
                            disabled={
                              !shareUrl || isLoading || isUpdatingPermission
                            }
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
                </div>
              </div>
            ) : null,
            document.body,
          )
        : null}
    </>
  );
}
