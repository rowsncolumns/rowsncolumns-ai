"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
} from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type AssistantSkill = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type SkillsApiPayload = {
  skills?: unknown;
  skill?: unknown;
  error?: string;
};

const NEW_SKILL_EDITOR_ID = "__new__";

const parseSkillFromUnknown = (value: unknown): AssistantSkill | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const maybeSkill = value as Record<string, unknown>;
  if (typeof maybeSkill.id !== "string" || maybeSkill.id.trim().length === 0) {
    return null;
  }

  const name =
    typeof maybeSkill.name === "string" ? maybeSkill.name.trim() : "";
  if (!name) {
    return null;
  }

  const description =
    typeof maybeSkill.description === "string" ? maybeSkill.description : "";
  const instructions =
    typeof maybeSkill.instructions === "string" ? maybeSkill.instructions : "";
  const active =
    typeof maybeSkill.active === "boolean" ? maybeSkill.active : true;
  const createdAt =
    typeof maybeSkill.createdAt === "string" && maybeSkill.createdAt.trim()
      ? maybeSkill.createdAt
      : new Date().toISOString();
  const updatedAt =
    typeof maybeSkill.updatedAt === "string" && maybeSkill.updatedAt.trim()
      ? maybeSkill.updatedAt
      : createdAt;

  return {
    id: maybeSkill.id,
    name,
    description,
    instructions,
    active,
    createdAt,
    updatedAt,
  };
};

const parseSkillsFromPayload = (payload: unknown): AssistantSkill[] => {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const maybePayload = payload as Record<string, unknown>;
  if (!Array.isArray(maybePayload.skills)) {
    return [];
  }

  return maybePayload.skills
    .map(parseSkillFromUnknown)
    .filter((skill): skill is AssistantSkill => skill !== null);
};

const upsertSkillPreservingOrder = (
  skills: AssistantSkill[],
  nextSkill: AssistantSkill,
) => {
  const existingIndex = skills.findIndex((skill) => skill.id === nextSkill.id);
  if (existingIndex === -1) {
    return [nextSkill, ...skills];
  }

  return skills.map((skill, index) =>
    index === existingIndex ? nextSkill : skill,
  );
};

type OrganizationSkillsSettingsProps = {
  organizationId: string;
  initialSkills: AssistantSkill[];
  initialError?: string | null;
};

export function OrganizationSkillsSettings({
  organizationId,
  initialSkills,
  initialError = null,
}: OrganizationSkillsSettingsProps) {
  const [skills, setSkills] = useState<AssistantSkill[]>(initialSkills);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [skillsError, setSkillsError] = useState(initialError ?? "");
  const [editorSkillId, setEditorSkillId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftInstructions, setDraftInstructions] = useState("");
  const [draftIsActive, setDraftIsActive] = useState(true);
  const [formError, setFormError] = useState("");
  const [isSavingSkill, setIsSavingSkill] = useState(false);
  const [updatingSkillId, setUpdatingSkillId] = useState<string | null>(null);
  const [deletingSkillId, setDeletingSkillId] = useState<string | null>(null);
  const [pendingDeleteSkill, setPendingDeleteSkill] =
    useState<AssistantSkill | null>(null);
  const [copiedSkillId, setCopiedSkillId] = useState<string | null>(null);

  const skillsEndpoint = useMemo(
    () => `/api/organizations/${encodeURIComponent(organizationId)}/skills`,
    [organizationId],
  );

  const loadSkills = useCallback(async () => {
    setIsLoadingSkills(true);
    setSkillsError("");
    try {
      const response = await fetch(skillsEndpoint, {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response
        .json()
        .catch(() => null)) as SkillsApiPayload | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load skills.");
      }
      setSkills(parseSkillsFromPayload(payload));
    } catch (error) {
      setSkillsError(
        error instanceof Error ? error.message : "Failed to load skills.",
      );
      setSkills([]);
    } finally {
      setIsLoadingSkills(false);
    }
  }, [skillsEndpoint]);

  useEffect(() => {
    setSkills(initialSkills);
    setSkillsError(initialError ?? "");
  }, [initialError, initialSkills, organizationId]);

  const resetEditor = useCallback(() => {
    setEditorSkillId(null);
    setDraftName("");
    setDraftDescription("");
    setDraftInstructions("");
    setDraftIsActive(true);
    setFormError("");
  }, []);

  const closeEditor = useCallback(() => {
    if (isSavingSkill) {
      return;
    }
    resetEditor();
  }, [isSavingSkill, resetEditor]);

  const beginCreateSkill = useCallback(() => {
    setEditorSkillId(NEW_SKILL_EDITOR_ID);
    setDraftName("");
    setDraftDescription("");
    setDraftInstructions("");
    setDraftIsActive(true);
    setFormError("");
  }, []);

  const beginEditSkill = useCallback((skill: AssistantSkill) => {
    setEditorSkillId(skill.id);
    setDraftName(skill.name);
    setDraftDescription(skill.description);
    setDraftInstructions(skill.instructions);
    setDraftIsActive(skill.active);
    setFormError("");
  }, []);

  const saveSkill = useCallback(async () => {
    const name = draftName.trim();
    const description = draftDescription.trim();
    const instructions = draftInstructions.trim();
    const isCreating = editorSkillId === NEW_SKILL_EDITOR_ID;

    if (!name) {
      setFormError("Skill name is required.");
      return;
    }
    if (!instructions) {
      setFormError("Skill instructions are required.");
      return;
    }
    if (!editorSkillId) {
      setFormError("Select a skill to edit or create a new one.");
      return;
    }

    setIsSavingSkill(true);
    setFormError("");
    setSkillsError("");
    try {
      const response = await fetch(skillsEndpoint, {
        method: isCreating ? "POST" : "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          isCreating
            ? {
                name,
                description,
                instructions,
                active: draftIsActive,
              }
            : {
                skillId: editorSkillId,
                name,
                description,
                instructions,
                active: draftIsActive,
              },
        ),
      });
      const payload = (await response
        .json()
        .catch(() => null)) as SkillsApiPayload | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to save skill.");
      }

      const nextSkill = parseSkillFromUnknown(payload?.skill);
      if (!nextSkill) {
        throw new Error("Skill response was invalid.");
      }

      setSkills((previous) => upsertSkillPreservingOrder(previous, nextSkill));
      resetEditor();
      toast.success(isCreating ? "Skill created." : "Skill updated.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to save.");
    } finally {
      setIsSavingSkill(false);
    }
  }, [
    draftDescription,
    draftInstructions,
    draftIsActive,
    draftName,
    editorSkillId,
    resetEditor,
    skillsEndpoint,
  ]);

  const deleteSkill = useCallback(
    async (skillId: string) => {
      if (deletingSkillId || isSavingSkill) {
        return;
      }

      setDeletingSkillId(skillId);
      setSkillsError("");
      try {
        const response = await fetch(skillsEndpoint, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            skillId,
          }),
        });
        const payload = (await response
          .json()
          .catch(() => null)) as SkillsApiPayload | null;
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to delete skill.");
        }

        setSkills((previous) =>
          previous.filter((existing) => existing.id !== skillId),
        );
        setEditorSkillId((current) => (current === skillId ? null : current));
        setPendingDeleteSkill((current) =>
          current?.id === skillId ? null : current,
        );
        toast.success("Skill deleted.");
      } catch (error) {
        setSkillsError(
          error instanceof Error ? error.message : "Failed to delete skill.",
        );
      } finally {
        setDeletingSkillId((current) => (current === skillId ? null : current));
      }
    },
    [deletingSkillId, isSavingSkill, skillsEndpoint],
  );

  const toggleSkillActive = useCallback(
    async (skill: AssistantSkill, nextActive: boolean) => {
      if (updatingSkillId || deletingSkillId) {
        return;
      }

      setUpdatingSkillId(skill.id);
      setSkillsError("");
      try {
        const response = await fetch(skillsEndpoint, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            skillId: skill.id,
            active: nextActive,
          }),
        });
        const payload = (await response
          .json()
          .catch(() => null)) as SkillsApiPayload | null;
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to update skill.");
        }

        const nextSkill = parseSkillFromUnknown(payload?.skill);
        if (!nextSkill) {
          throw new Error("Skill response was invalid.");
        }

        setSkills((previous) =>
          upsertSkillPreservingOrder(previous, nextSkill),
        );
        setEditorSkillId((current) => {
          if (current !== skill.id) {
            return current;
          }
          setDraftIsActive(nextSkill.active);
          return current;
        });
      } catch (error) {
        setSkillsError(
          error instanceof Error ? error.message : "Failed to update skill.",
        );
      } finally {
        setUpdatingSkillId(null);
      }
    },
    [deletingSkillId, skillsEndpoint, updatingSkillId],
  );

  const copySkillId = useCallback(async (skillId: string) => {
    if (!navigator?.clipboard) {
      toast.error("Clipboard is not available.");
      return;
    }

    try {
      await navigator.clipboard.writeText(skillId);
      setCopiedSkillId(skillId);
      setTimeout(() => {
        setCopiedSkillId((current) => (current === skillId ? null : current));
      }, 1500);
    } catch {
      toast.error("Failed to copy skill ID.");
    }
  }, []);

  const isEditing = editorSkillId !== null;
  const isCreating = editorSkillId === NEW_SKILL_EDITOR_ID;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="display-font text-xl font-semibold text-foreground">
            Skills
          </h2>
          <p className="mt-2 text-sm text-(--muted-foreground)">
            Manage reusable organization skills shared across members.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void loadSkills()}
            disabled={isLoadingSkills || isSavingSkill}
            className="h-8 gap-1.5 px-2.5 text-xs"
          >
            {isLoadingSkills ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={beginCreateSkill}
            disabled={isSavingSkill}
            className="h-8 gap-1.5 px-2.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            New Skill
          </Button>
        </div>
      </div>

      {skillsError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {skillsError}
        </p>
      ) : null}

      <div className="py-4">
        {isLoadingSkills ? (
          <div className="flex items-center gap-2 text-sm text-(--muted-foreground)">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading skills...
          </div>
        ) : skills.length === 0 ? (
          <p className="text-sm text-(--muted-foreground)">
            No skills yet. Create your first organization skill.
          </p>
        ) : (
          <div className="space-y-3">
            {skills.map((skill) => {
              const isUpdating = updatingSkillId === skill.id;
              const isDeleting = deletingSkillId === skill.id;
              const isCopied = copiedSkillId === skill.id;

              return (
                <div
                  key={skill.id}
                  className="rounded-lg border border-(--card-border) bg-(--card-bg-solid) p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {skill.name}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-(--muted-foreground)">
                        {skill.description || "No description provided."}
                      </p>
                      <div className="mt-2 flex items-center gap-2 text-xs text-(--muted-foreground)">
                        <span className="truncate">{skill.id}</span>
                        <button
                          type="button"
                          onClick={() => void copySkillId(skill.id)}
                          className="inline-flex items-center gap-1 text-xs text-(--muted-foreground) transition hover:text-foreground"
                          title="Copy skill ID"
                        >
                          {isCopied ? (
                            <Check className="h-3.5 w-3.5 text-green-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => beginEditSkill(skill)}
                        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-(--muted-foreground) transition hover:bg-(--nav-hover) hover:text-foreground"
                        disabled={isDeleting || isSavingSkill}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDeleteSkill(skill)}
                        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-red-500 transition hover:bg-red-500/15"
                        disabled={isDeleting || isSavingSkill}
                      >
                        {isDeleting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between rounded-md border border-(--card-border) bg-(--assistant-chip-bg) px-2 py-1.5">
                    <span
                      className={cn(
                        "text-xs",
                        skill.active
                          ? "text-green-700"
                          : "text-(--muted-foreground)",
                      )}
                    >
                      {isUpdating
                        ? "Updating..."
                        : skill.active
                          ? "Active"
                          : "Inactive"}
                    </span>
                    <Switch
                      checked={skill.active}
                      onCheckedChange={(checked) => {
                        void toggleSkillActive(skill, checked);
                      }}
                      disabled={isUpdating || isDeleting || isSavingSkill}
                      aria-label={`Toggle ${skill.name}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog
        open={isEditing}
        onOpenChange={(open) => {
          if (!open) {
            closeEditor();
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {isCreating ? "Create Skill" : "Edit Skill"}
            </DialogTitle>
            <DialogDescription>
              Configure reusable instructions for your organization.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-xs font-medium text-(--muted-foreground)">
                Name
              </label>
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                className="h-10 w-full rounded-lg border border-(--panel-border) bg-(--assistant-chip-bg) px-3 text-sm text-foreground outline-none transition placeholder:text-(--muted-foreground) focus:border-(--focus-border) disabled:cursor-not-allowed disabled:opacity-70"
                placeholder="Skill name"
                maxLength={120}
                disabled={isSavingSkill}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-(--muted-foreground)">
                Description
              </label>
              <Textarea
                value={draftDescription}
                onChange={(event) => setDraftDescription(event.target.value)}
                className="min-h-24 rounded-lg border border-(--card-border) bg-(--card-bg-solid) px-3 focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
                placeholder="What this skill is for"
                maxLength={4000}
                disabled={isSavingSkill}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-(--muted-foreground)">
                Instructions
              </label>
              <Textarea
                value={draftInstructions}
                onChange={(event) => setDraftInstructions(event.target.value)}
                className="min-h-56 rounded-lg border border-(--card-border) bg-(--card-bg-solid) px-3 focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
                placeholder="Detailed reusable instructions for the assistant"
                maxLength={20000}
                disabled={isSavingSkill}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border border-(--card-border) bg-(--assistant-chip-bg) px-3 py-2">
              <span className="text-xs text-(--muted-foreground)">Enabled</span>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-xs",
                    draftIsActive
                      ? "text-green-700"
                      : "text-(--muted-foreground)",
                  )}
                >
                  {draftIsActive ? "Active" : "Inactive"}
                </span>
                <Switch
                  checked={draftIsActive}
                  onCheckedChange={setDraftIsActive}
                  disabled={isSavingSkill}
                  aria-label="Toggle skill status"
                />
              </div>
            </div>

            {formError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError}
              </p>
            ) : null}
          </div>

          <DialogFooter className="py-4">
            <Button
              type="button"
              variant="secondary"
              onClick={closeEditor}
              disabled={isSavingSkill}
              size="sm"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void saveSkill()}
              disabled={isSavingSkill}
              size="sm"
            >
              {isSavingSkill ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : isCreating ? (
                "Create Skill"
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDeleteSkill !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteSkill(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this skill?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteSkill
                ? `This will permanently remove "${pendingDeleteSkill.name}". This action cannot be undone.`
                : "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingSkillId)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!pendingDeleteSkill || Boolean(deletingSkillId)}
              onClick={() => {
                if (!pendingDeleteSkill) return;
                void deleteSkill(pendingDeleteSkill.id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
