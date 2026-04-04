import { getChatToolDisplayName } from "@/lib/chat/tool-metadata";

export const getToolMentionLabel = (toolName: string): string =>
  getChatToolDisplayName(toolName);
