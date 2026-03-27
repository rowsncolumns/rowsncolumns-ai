export type ModelOption = {
  value: string;
  label: string;
};

export type ModelOptionGroup = {
  label: string;
  options: ModelOption[];
};

export const MODEL_OPTION_GROUPS: ModelOptionGroup[] = [
  {
    label: "Anthropic",
    options: [
      {
        value: "claude-sonnet-4-6-low",
        label: "Claude Sonnet 4.6 (Low Effort)",
      },
      {
        value: "claude-opus-4-6",
        label: "Claude Opus 4.6",
      },
      {
        value: "claude-sonnet-4-6",
        label: "Claude Sonnet 4.6",
      },
      {
        value: "claude-sonnet-4-5-20250929",
        label: "Claude Sonnet 4.5",
      },
      {
        value: "claude-opus-4-5-20251101",
        label: "Claude Opus 4.5",
      },
      {
        value: "claude-haiku-4-5-20251001",
        label: "Claude Haiku 4.5",
      },
      {
        value: "claude-opus-4-1-20250805",
        label: "Claude Opus 4.1",
      },
    ],
  },
  {
    label: "OpenAI",
    options: [
      {
        value: "gpt-5.4",
        label: "GPT-5.4",
      },
      {
        value: "gpt-5.4-mini",
        label: "GPT-5.4 Mini",
      },
      {
        value: "gpt-5.4-nano",
        label: "GPT-5.4 Nano",
      },
      {
        value: "gpt-5.2-chat-latest",
        label: "GPT-5.2 Chat",
      },
      {
        value: "gpt-5-mini",
        label: "GPT-5 Mini",
      },
      {
        value: "gpt-5-nano",
        label: "GPT-5 Nano",
      },
      {
        value: "gpt-4.1",
        label: "GPT-4.1",
      },
      {
        value: "gpt-4.1-mini",
        label: "GPT-4.1 Mini",
      },
      {
        value: "gpt-4.1-nano",
        label: "GPT-4.1 Nano",
      },
      {
        value: "o3",
        label: "o3",
      },
      {
        value: "o4-mini",
        label: "o4-mini",
      },
    ],
  },
];

export const DEFAULT_MODEL =
  MODEL_OPTION_GROUPS[0]?.options[0]?.value ?? "gpt-5.2-chat-latest";

export const MODEL_OPTIONS: ModelOption[] = MODEL_OPTION_GROUPS.flatMap(
  (group) => group.options,
);

export const MODEL_OPTION_VALUES = new Set<string>(
  MODEL_OPTIONS.map((option) => option.value),
);

export const MODEL_STORAGE_KEY = "rnc.ai.workspace-assistant.model";
export const REASONING_STORAGE_KEY = "rnc.ai.workspace-assistant.reasoning-enabled";
export const SKILLS_API_ENDPOINT = "/api/skills";
export const CHAT_API_ENDPOINT = "/api/chat";
export const CHAT_HISTORY_API_ENDPOINT = "/api/chat/history";
export const INSUFFICIENT_CREDITS_ERROR_CODE = "INSUFFICIENT_CREDITS";
export const OUT_OF_CREDITS_MESSAGE =
  "You've run out of credits for today. Credits reset to 30 at the next daily reset.";

export const CHAT_EXTERNAL_API_BASE_URL = (
  process.env.NEXT_PUBLIC_CHAT_API_BASE_URL ?? ""
).trim();
export const CHAT_EXTERNAL_API_PATH = (
  process.env.NEXT_PUBLIC_CHAT_API_PATH ?? "/chat"
).trim();
export const CHAT_EXTERNAL_API_ENABLED = CHAT_EXTERNAL_API_BASE_URL.length > 0;

export const FORK_BUTTON_ENABLED = false;

const buildExternalChatApiUrl = () => {
  const base = CHAT_EXTERNAL_API_BASE_URL.replace(/\/+$/, "");
  const path = CHAT_EXTERNAL_API_PATH.startsWith("/")
    ? CHAT_EXTERNAL_API_PATH
    : `/${CHAT_EXTERNAL_API_PATH}`;
  return `${base}${path}`;
};

export const getChatRequestUrl = () => {
  if (CHAT_EXTERNAL_API_ENABLED) {
    return buildExternalChatApiUrl();
  }

  return CHAT_API_ENDPOINT;
};

export const getChatResumeUrl = () => {
  if (CHAT_EXTERNAL_API_ENABLED) {
    const base = CHAT_EXTERNAL_API_BASE_URL.replace(/\/+$/, "");
    return `${base}/chat/resume`;
  }

  return "/api/chat/resume";
};
