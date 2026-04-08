"use client";

import * as React from "react";
import { Sparkles, Table2, Wrench } from "lucide-react";

import { type MentionKind } from "@/components/workspace-assistant/mention-config";
import { cn } from "@/lib/utils";

export const MENTION_PILL_BASE_CLASSNAME =
  "inline-flex items-center gap-1 rounded-full border border-(--panel-border) bg-(--assistant-chip-bg) px-2 py-0.5 text-sm text-foreground";

const MentionPillIcon = ({
  mentionKind,
}: {
  mentionKind: MentionKind | null;
}) => {
  switch (mentionKind) {
    case "tool":
      return (
        <Wrench
          aria-hidden="true"
          className="h-3 w-3 shrink-0 text-(--muted-foreground)"
        />
      );
    case "skill":
      return (
        <Sparkles
          aria-hidden="true"
          className="h-3 w-3 shrink-0 text-(--muted-foreground)"
        />
      );
    case "sheet":
      return (
        <Table2
          aria-hidden="true"
          className="h-3 w-3 shrink-0 text-(--muted-foreground)"
        />
      );
    default:
      return null;
  }
};

export function MentionPill({
  mentionKind,
  className,
  children,
}: {
  mentionKind: MentionKind | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn(MENTION_PILL_BASE_CLASSNAME, className)}>
      <MentionPillIcon mentionKind={mentionKind} />
      <span>{children}</span>
    </span>
  );
}
