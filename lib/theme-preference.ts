export const THEME_COOKIE = "rnc-theme";
export const DARK_THEME_CLASS = "rnc-dark";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type ThemeMode = "light" | "dark";

export function parseThemeCookie(value: string | null | undefined): ThemeMode {
  return value === "dark" ? "dark" : "light";
}

export function getThemeModeFromBodyClass(): ThemeMode {
  if (typeof document === "undefined") return "light";
  return document.body.classList.contains(DARK_THEME_CLASS) ? "dark" : "light";
}

export function writeThemeCookie(mode: ThemeMode): void {
  if (typeof document === "undefined") return;

  document.cookie = [
    `${THEME_COOKIE}=${mode}`,
    "Path=/",
    `Max-Age=${THEME_COOKIE_MAX_AGE}`,
    "SameSite=Lax",
  ].join("; ");
}

export function applyThemeMode(mode: ThemeMode): void {
  if (typeof document === "undefined") return;

  document.body.classList.toggle(DARK_THEME_CLASS, mode === "dark");
  writeThemeCookie(mode);
}

export function toggleThemeMode(): ThemeMode {
  const nextMode = getThemeModeFromBodyClass() === "dark" ? "light" : "dark";
  applyThemeMode(nextMode);
  return nextMode;
}
