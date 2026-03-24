const NEON_AUTH_COOKIE_PREFIX = "__Secure-neon-auth.";

export type NeonAuthCookieCompatibilityMode = "normalize" | "preserve";

function splitCombinedSetCookieHeader(setCookieHeader: string): string[] {
  const parts: string[] = [];
  let segmentStart = 0;

  for (let index = 0; index < setCookieHeader.length; index += 1) {
    if (setCookieHeader[index] !== ",") {
      continue;
    }

    const potentialCookie = setCookieHeader.slice(index + 1);
    const nextCookieStartsHere = /^\s*[-!#$%&'*+.^_`|~0-9A-Za-z]+=/.test(
      potentialCookie,
    );

    if (!nextCookieStartsHere) {
      continue;
    }

    const segment = setCookieHeader.slice(segmentStart, index).trim();
    if (segment.length > 0) {
      parts.push(segment);
    }
    segmentStart = index + 1;
  }

  const lastSegment = setCookieHeader.slice(segmentStart).trim();
  if (lastSegment.length > 0) {
    parts.push(lastSegment);
  }

  return parts;
}

export function readSetCookieHeaders(headers: Headers): string[] {
  const headerWithGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headerWithGetSetCookie.getSetCookie === "function") {
    return headerWithGetSetCookie.getSetCookie();
  }

  const setCookie = headers.get("set-cookie");
  if (!setCookie) {
    return [];
  }
  return splitCombinedSetCookieHeader(setCookie);
}

export function copySetCookieHeaders(source: Headers, target: Headers): void {
  const setCookies = readSetCookieHeaders(source);
  for (const setCookie of setCookies) {
    target.append("set-cookie", setCookie);
  }
}

function isNeonAuthSetCookie(setCookieHeader: string): boolean {
  const [cookieName] = setCookieHeader.split("=", 1);
  return cookieName.trimStart().startsWith(NEON_AUTH_COOKIE_PREFIX);
}

function normalizeNeonAuthSetCookieWithMode(
  setCookieHeader: string,
  mode: NeonAuthCookieCompatibilityMode,
): string {
  if (mode === "preserve") {
    return setCookieHeader;
  }

  if (!isNeonAuthSetCookie(setCookieHeader)) {
    return setCookieHeader;
  }

  const parts = setCookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return setCookieHeader;
  }

  const normalizedParts: string[] = [];
  for (const part of parts) {
    if (/^partitioned$/i.test(part)) {
      continue;
    }

    if (/^samesite=/i.test(part)) {
      const sameSiteValue = part
        .slice(part.indexOf("=") + 1)
        .trim()
        .toLowerCase();
      if (sameSiteValue === "none") {
        normalizedParts.push("SameSite=Lax");
        continue;
      }
    }

    normalizedParts.push(part);
  }

  return normalizedParts.join("; ");
}

function didSetCookieHeadersChange(
  original: string[],
  normalized: string[],
): boolean {
  if (original.length !== normalized.length) {
    return true;
  }

  for (let index = 0; index < original.length; index += 1) {
    if (original[index] !== normalized[index]) {
      return true;
    }
  }

  return false;
}

export function normalizeNeonAuthSetCookieHeadersInPlace(
  headers: Headers,
  mode: NeonAuthCookieCompatibilityMode = "normalize",
): boolean {
  const originalSetCookies = readSetCookieHeaders(headers);
  if (originalSetCookies.length === 0) {
    return false;
  }

  const normalizedSetCookies = originalSetCookies.map((setCookie) =>
    normalizeNeonAuthSetCookieWithMode(setCookie, mode),
  );
  if (!didSetCookieHeadersChange(originalSetCookies, normalizedSetCookies)) {
    return false;
  }

  headers.delete("set-cookie");
  for (const setCookie of normalizedSetCookies) {
    headers.append("set-cookie", setCookie);
  }

  return true;
}

export function cloneResponseWithNormalizedNeonAuthCookies(
  response: Response,
  mode: NeonAuthCookieCompatibilityMode = "normalize",
): Response {
  const headers = new Headers(response.headers);
  const changed = normalizeNeonAuthSetCookieHeadersInPlace(headers, mode);
  if (!changed) {
    return response;
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
