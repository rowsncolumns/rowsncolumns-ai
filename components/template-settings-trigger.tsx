"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Loader2, Settings2, X } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  isSupportedImageFile,
  uploadAssistantImage,
} from "@/components/workspace-assistant/image-utils";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { IconButton } from "@rowsncolumns/ui";

type TemplateScope = "none" | "personal" | "organization" | "global";

type TemplateMetadataResponse = {
  templateScope?: TemplateScope;
  templateTitle?: string;
  tagline?: string;
  category?: string;
  descriptionMarkdown?: string;
  tags?: string[];
  previewImageUrl?: string;
  canPublishGlobal?: boolean;
  error?: string;
};

type TemplateFormState = {
  templateScope: TemplateScope;
  templateTitle: string;
  tagline: string;
  category: string;
  descriptionMarkdown: string;
  tagsInput: string;
  previewImageUrl: string;
};

type TemplateRecord = {
  docId: string;
  title: string;
  isTemplate?: boolean;
  templateScope?: TemplateScope;
  templateTitle?: string;
  tagline?: string;
  category?: string;
  descriptionMarkdown?: string;
  tags?: string[];
  previewImageUrl?: string;
};

type TemplateSettingsTriggerProps = {
  template: TemplateRecord;
  triggerMode?: "button" | "icon";
  triggerLabel?: string;
  triggerTooltip?: string;
  triggerClassName?: string;
  disabled?: boolean;
  ariaLabel?: string;
  refreshOnSave?: boolean;
  onSaved?: () => void;
};

const parseTagsInput = (tagsInput: string): string[] =>
  tagsInput
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

const toTemplateFormState = (template: TemplateRecord): TemplateFormState => ({
  templateScope:
    template.templateScope ??
    (template.isTemplate ? "personal" : "none"),
  templateTitle: template.templateTitle ?? template.title,
  tagline: template.tagline ?? "",
  category: template.category ?? "",
  descriptionMarkdown: template.descriptionMarkdown ?? "",
  tagsInput: Array.isArray(template.tags) ? template.tags.join(", ") : "",
  previewImageUrl: template.previewImageUrl ?? "",
});

export function TemplateSettingsTrigger({
  template,
  triggerMode = "button",
  triggerLabel = "Template",
  triggerTooltip = "Template settings",
  triggerClassName,
  disabled = false,
  ariaLabel,
  refreshOnSave = true,
  onSaved,
}: TemplateSettingsTriggerProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [canPublishGlobal, setCanPublishGlobal] = useState(false);
  const [form, setForm] = useState<TemplateFormState>(() =>
    toTemplateFormState(template),
  );

  const handleOpen = async () => {
    if (loading || saving || disabled) {
      return;
    }

    setOpen(true);
    setLoading(true);
    setCanPublishGlobal(false);
    setForm(toTemplateFormState(template));

    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(template.docId)}/template`,
        {
          method: "GET",
        },
      );
      const payload = (await response
        .json()
        .catch(() => null)) as TemplateMetadataResponse | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load template settings.");
      }

      const canPublish = payload?.canPublishGlobal === true;
      setCanPublishGlobal(canPublish);
      const resolvedTemplateScope =
        payload?.templateScope === "global" ||
        payload?.templateScope === "organization" ||
        payload?.templateScope === "personal" ||
        payload?.templateScope === "none"
          ? payload.templateScope
          : template.templateScope ??
            (template.isTemplate ? "personal" : "none");
      const userSafeTemplateScope =
        !canPublish && resolvedTemplateScope === "global"
          ? "personal"
          : resolvedTemplateScope;
      setForm({
        templateScope: userSafeTemplateScope,
        templateTitle: payload?.templateTitle?.trim() || template.title,
        tagline: payload?.tagline?.trim() || "",
        category: payload?.category?.trim() || "",
        descriptionMarkdown: payload?.descriptionMarkdown || "",
        tagsInput: Array.isArray(payload?.tags) ? payload.tags.join(", ") : "",
        previewImageUrl: payload?.previewImageUrl?.trim() || "",
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load template settings.";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (saving || disabled) {
      return;
    }

    setSaving(true);
    try {
      const templateScopeForSave =
        !canPublishGlobal && form.templateScope === "global"
          ? "personal"
          : form.templateScope;
      const response = await fetch(
        `/api/documents/${encodeURIComponent(template.docId)}/template`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            templateScope: templateScopeForSave,
            templateTitle: form.templateTitle,
            tagline: form.tagline,
            category: form.category,
            descriptionMarkdown: form.descriptionMarkdown,
            tags: parseTagsInput(form.tagsInput),
            previewImageUrl: form.previewImageUrl,
          }),
        },
      );

      const payload = (await response
        .json()
        .catch(() => null)) as TemplateMetadataResponse | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to save template settings.");
      }

      toast.success(
        form.templateScope === "global"
          ? "Global template settings saved."
          : form.templateScope === "organization"
            ? "Organization template settings saved."
          : form.templateScope === "personal"
            ? "Personal template settings saved."
            : "Template disabled for this sheet.",
      );
      setOpen(false);
      if (refreshOnSave) {
        router.refresh();
      }
      onSaved?.();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to save template settings.";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handlePickImage = () => {
    if (saving || uploading) {
      return;
    }
    fileInputRef.current?.click();
  };

  const handleUploadImage = async (file: File) => {
    if (saving || uploading) {
      return;
    }

    if (!isSupportedImageFile(file)) {
      toast.error("Please select an image file.");
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      const payload = await uploadAssistantImage({
        file,
        onProgress: (fraction) => {
          const next = Math.max(0, Math.min(100, Math.round(fraction * 100)));
          setUploadProgress(next);
        },
      });

      const url = payload?.url?.trim();
      if (!url) {
        throw new Error("Image upload succeeded but URL was missing.");
      }

      setForm((current) => ({
        ...current,
        previewImageUrl: url,
      }));
      setUploadProgress(100);
      toast.success("Preview image uploaded.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to upload image.";
      toast.error(message);
    } finally {
      setUploading(false);
      setTimeout(() => {
        setUploadProgress(null);
      }, 500);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSave();
  };

  return (
    <>
      {triggerMode === "icon" ? (
        <IconButton
          tooltip={triggerTooltip}
          className={triggerClassName}
          disabled={disabled || loading || saving}
          onClick={() => {
            void handleOpen();
          }}
          aria-label={ariaLabel ?? `Template settings for ${template.title}`}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Settings2 className="h-4 w-4" />
          )}
        </IconButton>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className={triggerClassName}
          onClick={() => {
            void handleOpen();
          }}
          disabled={disabled || loading || saving}
          aria-label={ariaLabel ?? `Template settings for ${template.title}`}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Settings2 className="h-3.5 w-3.5" />
          )}
          {triggerLabel}
        </Button>
      )}

      <Drawer
        open={open}
        onOpenChange={(nextOpen) => {
          if (!saving) {
            setOpen(nextOpen);
          }
        }}
        direction="right"
      >
        <DrawerContent className="left-auto right-0 w-[min(92vw,460px)] border-l border-r-0 border-(--panel-border) bg-(--drawer-bg)">
          <DrawerHeader>
            <div className="space-y-1">
              <DrawerTitle>Template Settings</DrawerTitle>
              <DrawerDescription>
                Configure template metadata for &quot;{template.title}&quot;.
              </DrawerDescription>
            </div>
            <DrawerClose asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 rounded-md p-0"
                disabled={saving}
                aria-label="Close template settings"
              >
                <X className="h-4 w-4" />
              </Button>
            </DrawerClose>
          </DrawerHeader>

          <form
            onSubmit={handleSubmit}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              <div className="rounded-lg border border-(--panel-border) bg-(--card-bg-solid) p-3">
                <p className="text-sm font-medium text-foreground">
                  Template visibility
                </p>
                <p className="mt-0.5 text-xs text-(--muted-foreground)">
                  {canPublishGlobal
                    ? "Personal templates are private to your workspace. Organization templates are visible to your organization. Global templates are visible on `/templates`."
                    : "Personal templates are private to your workspace. Organization templates are visible to your organization."}
                </p>
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between rounded-md border border-(--panel-border) px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Mark as template
                      </p>
                      <p className="text-xs text-(--muted-foreground)">
                        Include this sheet in template mentions and filters.
                      </p>
                    </div>
                    <Switch
                      checked={form.templateScope !== "none"}
                      disabled={saving || uploading}
                      onCheckedChange={(checked) => {
                        setForm((current) => ({
                          ...current,
                          templateScope: checked
                            ? current.templateScope === "none"
                              ? "personal"
                              : current.templateScope
                            : "none",
                        }));
                      }}
                      aria-label="Mark as template"
                    />
                  </div>

                  {form.templateScope !== "none" ? (
                    <div className="flex items-center justify-between rounded-md border border-(--panel-border) px-3 py-2.5">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Visible to organization
                        </p>
                        <p className="text-xs text-(--muted-foreground)">
                          Let members in your organization discover and use this template.
                        </p>
                      </div>
                      <Switch
                        checked={form.templateScope === "organization"}
                        disabled={saving || uploading}
                        onCheckedChange={(checked) => {
                          setForm((current) => ({
                            ...current,
                            templateScope: checked
                              ? "organization"
                              : current.templateScope === "organization"
                                ? "personal"
                                : current.templateScope,
                          }));
                        }}
                        aria-label="Visible to organization"
                      />
                    </div>
                  ) : null}

                  {form.templateScope !== "none" && canPublishGlobal ? (
                    <div className="flex items-center justify-between rounded-md border border-(--panel-border) px-3 py-2.5">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Publish globally
                        </p>
                        <p className="text-xs text-(--muted-foreground)">
                          Show this template publicly on `/templates`.
                        </p>
                      </div>
                      <Switch
                        checked={form.templateScope === "global"}
                        disabled={saving || uploading}
                        onCheckedChange={(checked) => {
                          setForm((current) => ({
                            ...current,
                            templateScope: checked ? "global" : "organization",
                          }));
                        }}
                        aria-label="Publish globally"
                      />
                    </div>
                  ) : null}
                </div>
              </div>

            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                Template Title
              </span>
              <input
                type="text"
                value={form.templateTitle}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    templateTitle: event.target.value.slice(0, 160),
                  }));
                }}
                disabled={saving || uploading}
                placeholder="Template name shown in listing"
                className="h-10 w-full rounded-lg border border-(--panel-border) bg-(--card-bg-solid) px-3 text-sm text-foreground outline-none placeholder:text-(--muted-foreground) focus:border-(--focus-border)"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                Tagline
              </span>
              <input
                type="text"
                value={form.tagline}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    tagline: event.target.value.slice(0, 220),
                  }));
                }}
                disabled={saving || uploading}
                placeholder="Short one-line summary shown in cards and details"
                className="h-10 w-full rounded-lg border border-(--panel-border) bg-(--card-bg-solid) px-3 text-sm text-foreground outline-none placeholder:text-(--muted-foreground) focus:border-(--focus-border)"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                Category
              </span>
              <input
                type="text"
                value={form.category}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    category: event.target.value.slice(0, 80),
                  }));
                }}
                disabled={saving || uploading}
                placeholder="Finance, Operations, Reporting..."
                className="h-10 w-full rounded-lg border border-(--panel-border) bg-(--card-bg-solid) px-3 text-sm text-foreground outline-none placeholder:text-(--muted-foreground) focus:border-(--focus-border)"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                Tags
              </span>
              <input
                type="text"
                value={form.tagsInput}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    tagsInput: event.target.value.slice(0, 300),
                  }));
                }}
                disabled={saving || uploading}
                placeholder="budget, forecast, invoice"
                className="h-10 w-full rounded-lg border border-(--panel-border) bg-(--card-bg-solid) px-3 text-sm text-foreground outline-none placeholder:text-(--muted-foreground) focus:border-(--focus-border)"
              />
              <p className="text-xs text-(--muted-foreground)">
                Comma separated.
              </p>
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                Description (Markdown)
              </span>
              <Textarea
                value={form.descriptionMarkdown}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    descriptionMarkdown: event.target.value.slice(0, 20000),
                  }));
                }}
                disabled={saving || uploading}
                rows={8}
                placeholder="Explain what this template does and how to use it."
                className="rounded-lg border border-(--panel-border) bg-(--card-bg-solid) px-3 py-2 text-sm"
              />
            </label>

            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.heic,.heif"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void handleUploadImage(file);
                  }
                  event.currentTarget.value = "";
                }}
              />
              <div className="flex items-center justify-between rounded-lg border border-(--panel-border) bg-(--card-bg-solid) px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Upload Preview Image
                  </p>
                  <p className="text-xs text-(--muted-foreground)">
                    Uploads and sets preview URL automatically.
                  </p>
                </div>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-8 rounded-md px-3 text-xs whitespace-nowrap"
                    onClick={handlePickImage}
                    disabled={saving || uploading}
                  >
                    {uploading ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Uploading...
                      </span>
                    ) : (
                      "Choose Image"
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-md px-3 text-xs whitespace-nowrap"
                    onClick={() => {
                      setForm((current) => ({
                        ...current,
                        previewImageUrl: "",
                      }));
                    }}
                    disabled={
                      saving || uploading || form.previewImageUrl.trim().length === 0
                    }
                  >
                    Remove
                  </Button>
                </div>
              </div>
              {uploadProgress !== null ? (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-(--assistant-chip-bg)">
                  <div
                    className="h-full rounded-full bg-(--accent) transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              ) : null}
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                Preview Image URL
              </span>
              <input
                type="text"
                value={form.previewImageUrl}
                readOnly
                disabled={saving || uploading}
                placeholder="Upload an image to generate URL"
                className="h-10 w-full rounded-lg border border-(--panel-border) bg-(--card-bg-solid) px-3 text-sm text-foreground outline-none placeholder:text-(--muted-foreground) focus:border-(--focus-border)"
              />
            </label>

            <div className="overflow-hidden rounded-lg border border-(--panel-border) bg-(--card-bg-solid)">
              <div className="border-b border-(--panel-border) px-3 py-2 text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
                Image Preview
              </div>
              <div className="relative aspect-[16/9] bg-[linear-gradient(120deg,#eef2ff,#f8fafc)]">
                {form.previewImageUrl.trim() ? (
                  <Image
                    src={form.previewImageUrl.trim()}
                    alt="Template preview"
                    fill
                    unoptimized
                    sizes="(min-width: 640px) 420px, 92vw"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-4 text-center text-xs text-(--muted-foreground)">
                    Upload a preview image to show the template thumbnail.
                  </div>
                )}
              </div>
            </div>
          </div>

            <DrawerFooter>
              <Button
                type="submit"
                disabled={saving || uploading}
                className="h-10 rounded-lg"
              >
              {saving ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </span>
              ) : uploading ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading image...
                </span>
              ) : (
                "Save template settings"
              )}
              </Button>
              <DrawerClose asChild>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-10 rounded-lg"
                  disabled={saving || uploading}
                >
                  Cancel
                </Button>
              </DrawerClose>
            </DrawerFooter>
          </form>
        </DrawerContent>
      </Drawer>
    </>
  );
}
