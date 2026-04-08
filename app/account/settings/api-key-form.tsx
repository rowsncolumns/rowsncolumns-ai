"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type OrganizationOption = {
  id: string;
  name: string;
  slug: string;
};

type ApiKeyRecord = {
  id: string;
  userId: string;
  organizationId: string | null;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

type ApiKeyActionResponse = {
  error?: string;
  key?: ApiKeyRecord | null;
  apiKey?: string;
  revoked?: boolean;
  organizationId?: string | null;
};

type AccountApiKeyFormProps = {
  organizations: OrganizationOption[];
  initialOrganizationId: string | null;
  initialKey: ApiKeyRecord | null;
};

const formatDateTime = (value: string | null): string => {
  if (!value) {
    return "Never";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
};

export function AccountApiKeyForm({
  organizations,
  initialOrganizationId,
  initialKey,
}: AccountApiKeyFormProps) {
  const [activeKey, setActiveKey] = useState<ApiKeyRecord | null>(initialKey);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<
    string | null
  >(initialOrganizationId);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [isLoadingKey, setIsLoadingKey] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasOrganizations = organizations.length > 0;
  const hasMultipleOrganizations = organizations.length > 1;
  const hasActiveKey = Boolean(activeKey);
  const selectedOrganization = useMemo(
    () =>
      organizations.find((organization) => organization.id === selectedOrganizationId) ??
      null,
    [organizations, selectedOrganizationId],
  );

  const loadKeyForOrganization = useCallback(
    async (organizationId: string) => {
      setIsLoadingKey(true);
      setError(null);
      try {
        const params = new URLSearchParams({ organizationId });
        const response = await fetch(`/api/account/api-key?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | ApiKeyActionResponse
          | null;
        if (!response.ok) {
          setError(payload?.error ?? "Failed to load API key.");
          setActiveKey(null);
          return;
        }
        setActiveKey(payload?.key ?? null);
      } catch {
        setError("Failed to load API key.");
        setActiveKey(null);
      } finally {
        setIsLoadingKey(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!hasOrganizations || !selectedOrganizationId) {
      setActiveKey(null);
      setGeneratedKey(null);
      return;
    }

    if (
      initialKey &&
      initialKey.organizationId === selectedOrganizationId &&
      activeKey?.id === initialKey.id
    ) {
      return;
    }

    setGeneratedKey(null);
    void loadKeyForOrganization(selectedOrganizationId);
  }, [
    activeKey?.id,
    hasOrganizations,
    initialKey,
    loadKeyForOrganization,
    selectedOrganizationId,
  ]);

  const handleGenerate = async () => {
    if (isGenerating || !selectedOrganizationId) {
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch("/api/account/api-key", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organizationId: selectedOrganizationId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | ApiKeyActionResponse
        | null;

      if (!response.ok || !payload?.apiKey || !payload.key) {
        setError(payload?.error ?? "Failed to generate API key.");
        return;
      }

      setGeneratedKey(payload.apiKey);
      setActiveKey(payload.key);
      toast.success(hasActiveKey ? "API key rotated." : "API key generated.");
    } catch {
      setError("Failed to generate API key.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRevoke = async () => {
    if (isRevoking || !activeKey || !selectedOrganizationId) {
      return;
    }

    setIsRevoking(true);
    setError(null);

    try {
      const response = await fetch("/api/account/api-key", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organizationId: selectedOrganizationId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | ApiKeyActionResponse
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "Failed to revoke API key.");
        return;
      }

      setActiveKey(null);
      setGeneratedKey(null);
      toast.success("API key revoked.");
    } catch {
      setError("Failed to revoke API key.");
    } finally {
      setIsRevoking(false);
    }
  };

  const handleCopy = async () => {
    if (!generatedKey || isCopying) {
      return;
    }

    if (!navigator?.clipboard) {
      setError("Clipboard is not available in this browser.");
      return;
    }

    setIsCopying(true);
    setError(null);
    try {
      await navigator.clipboard.writeText(generatedKey);
      toast.success("API key copied.");
    } catch {
      setError("Failed to copy API key.");
    } finally {
      setIsCopying(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label
          htmlFor="api-key-organization"
          className="text-sm font-medium text-foreground"
        >
          Organization scope
        </label>
        {hasMultipleOrganizations ? (
          <Select
            value={selectedOrganizationId ?? undefined}
            onValueChange={(value) => {
              const normalized = value.trim();
              setSelectedOrganizationId(normalized || null);
              setError(null);
              setGeneratedKey(null);
            }}
            disabled={isGenerating || isRevoking || isLoadingKey || !hasOrganizations}
          >
            <SelectTrigger id="api-key-organization">
              <SelectValue placeholder="Select organization" />
            </SelectTrigger>
            <SelectContent>
              {organizations.map((organization) => (
                <SelectItem key={organization.id} value={organization.id}>
                  {organization.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="h-11 w-full rounded-lg border border-(--panel-border) bg-(--assistant-chip-bg) px-3 text-sm text-foreground">
            <div className="flex h-full items-center">
              {selectedOrganization?.name ?? "No organization selected"}
            </div>
          </div>
        )}
        {!hasOrganizations ? (
          <p className="text-xs text-(--muted-foreground)">
            No organizations available.
          </p>
        ) : null}
      </div>

      <div className="rounded-lg border border-(--panel-border) bg-(--assistant-chip-bg) p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Active key</p>
            <p className="text-xs text-(--muted-foreground)">
              {selectedOrganization
                ? `Scoped to ${selectedOrganization.name}`
                : "Select an organization to manage its key."}
            </p>
            {isLoadingKey ? (
              <p className="text-xs text-(--muted-foreground)">Loading key...</p>
            ) : activeKey ? (
              <>
                <p className="font-mono text-xs text-(--muted-foreground)">
                  {activeKey.keyPrefix}...
                </p>
                <p className="text-xs text-(--muted-foreground)">
                  Created: {formatDateTime(activeKey.createdAt)}
                </p>
                <p className="text-xs text-(--muted-foreground)">
                  Last used: {formatDateTime(activeKey.lastUsedAt)}
                </p>
              </>
            ) : (
              <p className="text-xs text-(--muted-foreground)">
                No API key generated yet.
              </p>
            )}
          </div>
          <KeyRound className="h-4 w-4 text-(--muted-foreground)" />
        </div>
      </div>

      {generatedKey ? (
        <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3">
          <p className="text-sm font-medium text-amber-900">
            Copy this API key now. For security, it will not be shown again.
          </p>
          <div className="rounded-md border border-amber-200 bg-white px-3 py-2">
            <code className="break-all text-xs text-amber-900">{generatedKey}</code>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={handleCopy}
            disabled={isCopying}
          >
            {isCopying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Copying...
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                Copy API key
              </>
            )}
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating || isLoadingKey || !selectedOrganizationId}
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {hasActiveKey ? "Rotating..." : "Generating..."}
            </>
          ) : hasActiveKey ? (
            "Rotate API key"
          ) : (
            "Generate API key"
          )}
        </Button>

        {activeKey ? (
          <Button
            type="button"
            variant="secondary"
            onClick={handleRevoke}
            disabled={isRevoking || isLoadingKey || !selectedOrganizationId}
          >
            {isRevoking ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Revoking...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                Revoke
              </>
            )}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
