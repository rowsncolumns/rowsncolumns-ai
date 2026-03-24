const normalizeBaseUrl = (value: string | undefined) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
};

export const resolveAppBaseUrl = () =>
  normalizeBaseUrl(process.env.MCP_APP_BASE_URL) ||
  normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ||
  normalizeBaseUrl(process.env.APP_URL) ||
  normalizeBaseUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
  normalizeBaseUrl(process.env.VERCEL_URL) ||
  "http://localhost:3000";

export const resolveAppOrigin = () => {
  try {
    return new URL(resolveAppBaseUrl()).origin;
  } catch {
    return null;
  }
};
