import { auth } from "@/lib/auth/server";
import {
  cloneResponseWithNormalizedNeonAuthCookies,
  type NeonAuthCookieCompatibilityMode,
  readSetCookieHeaders,
} from "@/lib/auth/cookie-compat";

const authHandler = auth.handler();
const COOKIE_COMPAT_PARAM = "cookieCompat";
const COOKIE_COMPAT_PRESERVE_VALUE = "preserve";

type AuthRouteContext = {
  params: Promise<{ path: string[] }>;
};

type AuthRouteHandler = (
  request: Request,
  context: AuthRouteContext,
) => Promise<Response>;

const AUTH_COOKIE_CLEANUP_NAMES = [
  "__Secure-neon-auth.session_token",
  "__Secure-neon-auth.local.session_data",
  "__Secure-neon-auth.session_challange",
  "__Secure-neon-auth.session_challenge",
  "neon-auth.session_token",
  "neon-auth.local.session_data",
  "neon-auth.session_challange",
  "neon-auth.session_challenge",
] as const;
const AUTH_COOKIE_CLEANUP_PATHS = ["/"] as const;
const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function shouldApplyAuthCookieCleanup(request: Request): boolean {
  const requestUrl = new URL(request.url);
  const pathname = requestUrl.pathname;
  const method = request.method.toUpperCase();
  if (method === "GET" && pathname.includes("/callback")) {
    return true;
  }
  if (method === "POST" && pathname.endsWith("/sign-out")) {
    return true;
  }
  return false;
}

function buildCookieDeleteHeader(
  name: string,
  path: string,
  secure: boolean,
  domain?: string,
): string {
  const secureDirective = secure ? "; Secure" : "";
  const domainDirective = domain ? `; Domain=${domain}` : "";
  return `${name}=; Path=${path}${domainDirective}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secureDirective}`;
}

function getCookieCleanupDomains(request: Request): Array<string | undefined> {
  const hostname = new URL(request.url).hostname.trim().toLowerCase();
  if (!hostname || LOCALHOST_HOSTNAMES.has(hostname)) {
    return [undefined];
  }

  const domains = new Set<string | undefined>();
  domains.add(undefined);
  domains.add(hostname);
  return [...domains];
}

function splitCookieSegments(cookieHeader: string): string[] {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseCookieSegment(
  segment: string,
): { name: string; value: string } | null {
  const separatorIndex = segment.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }

  const name = segment.slice(0, separatorIndex).trim();
  const value = segment.slice(separatorIndex + 1).trim();
  if (!name) {
    return null;
  }

  return { name, value };
}

function hasDuplicateSessionTokenValues(cookieHeader: string): boolean {
  const parsed = splitCookieSegments(cookieHeader)
    .map(parseCookieSegment)
    .filter((cookie): cookie is { name: string; value: string } => Boolean(cookie));
  const tokenValues = parsed
    .filter((cookie) => cookie.name === "__Secure-neon-auth.session_token")
    .map((cookie) => cookie.value);
  return new Set(tokenValues).size > 1;
}

function dedupeNeonAuthCookieHeader(cookieHeader: string): string {
  const segments = splitCookieSegments(cookieHeader);
  if (segments.length === 0) {
    return cookieHeader;
  }

  const parsed = segments.map(parseCookieSegment);
  const latestIndexByName = new Map<string, number>();

  for (let index = 0; index < parsed.length; index += 1) {
    const cookie = parsed[index];
    if (!cookie) continue;
    if (
      !cookie.name.startsWith("__Secure-neon-auth.") &&
      !cookie.name.startsWith("neon-auth.")
    ) {
      continue;
    }
    latestIndexByName.set(cookie.name, index);
  }

  if (latestIndexByName.size === 0) {
    return cookieHeader;
  }

  const normalizedSegments: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const cookie = parsed[index];
    if (!cookie) {
      normalizedSegments.push(segments[index]);
      continue;
    }
    const latestIndex = latestIndexByName.get(cookie.name);
    if (latestIndex !== undefined && latestIndex !== index) {
      continue;
    }
    normalizedSegments.push(segments[index]);
  }

  return normalizedSegments.join("; ");
}

function withDedupedTokenRequestCookies(request: Request): Request {
  const requestUrl = new URL(request.url);
  if (
    request.method.toUpperCase() !== "GET" ||
    !requestUrl.pathname.endsWith("/token")
  ) {
    return request;
  }

  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return request;
  }
  if (!hasDuplicateSessionTokenValues(cookieHeader)) {
    return request;
  }

  const dedupedCookieHeader = dedupeNeonAuthCookieHeader(cookieHeader);
  if (dedupedCookieHeader === cookieHeader) {
    return request;
  }

  const headers = new Headers(request.headers);
  headers.set("cookie", dedupedCookieHeader);
  return new Request(request, { headers });
}

function addAuthCookieCleanupHeaders(
  response: Response,
  request: Request,
): Response {
  const existingSetCookies = readSetCookieHeaders(response.headers);
  const nextHeaders = new Headers(response.headers);
  nextHeaders.delete("set-cookie");
  const domains = getCookieCleanupDomains(request);

  for (const cookieName of AUTH_COOKIE_CLEANUP_NAMES) {
    const isSecureCookie = cookieName.startsWith("__Secure-");
    for (const path of AUTH_COOKIE_CLEANUP_PATHS) {
      for (const domain of domains) {
        nextHeaders.append(
          "set-cookie",
          buildCookieDeleteHeader(cookieName, path, isSecureCookie, domain),
        );
      }
    }
  }

  for (const setCookie of existingSetCookies) {
    nextHeaders.append("set-cookie", setCookie);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: nextHeaders,
  });
}

function getModeFromSearchParams(
  searchParams: URLSearchParams,
): NeonAuthCookieCompatibilityMode {
  return searchParams.get(COOKIE_COMPAT_PARAM) === COOKIE_COMPAT_PRESERVE_VALUE
    ? "preserve"
    : "normalize";
}

function getModeFromUrl(url: string): NeonAuthCookieCompatibilityMode {
  try {
    const parsedUrl = new URL(url);
    return getModeFromSearchParams(parsedUrl.searchParams);
  } catch {
    return "normalize";
  }
}

async function resolveCookieCompatibilityMode(
  request: Request,
): Promise<NeonAuthCookieCompatibilityMode> {
  const requestUrl = new URL(request.url);
  const modeFromRequestUrl = getModeFromSearchParams(requestUrl.searchParams);
  if (modeFromRequestUrl === "preserve") {
    return "preserve";
  }

  const modeFromHeader =
    request.headers.get("x-rnc-cookie-compat") === COOKIE_COMPAT_PRESERVE_VALUE
      ? "preserve"
      : "normalize";
  if (modeFromHeader === "preserve") {
    return "preserve";
  }

  if (request.method !== "POST" || !requestUrl.pathname.endsWith("/sign-in/social")) {
    return "normalize";
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return "normalize";
  }

  try {
    const requestBody = (await request.clone().json()) as {
      callbackURL?: unknown;
    };

    if (typeof requestBody.callbackURL !== "string") {
      return "normalize";
    }

    return getModeFromUrl(new URL(requestBody.callbackURL, request.url).toString());
  } catch {
    return "normalize";
  }
}

function withCookieCompatibility(handler: AuthRouteHandler): AuthRouteHandler {
  return async (request, context) => {
    const normalizedRequest = withDedupedTokenRequestCookies(request);
    const response = await handler(normalizedRequest, context);
    const cookieHeader = request.headers.get("cookie") ?? "";
    const shouldCleanupForDuplicateToken =
      request.method.toUpperCase() === "GET" &&
      new URL(request.url).pathname.endsWith("/token") &&
      cookieHeader.length > 0 &&
      hasDuplicateSessionTokenValues(cookieHeader);
    const cleanedResponse =
      shouldApplyAuthCookieCleanup(request) || shouldCleanupForDuplicateToken
        ? addAuthCookieCleanupHeaders(response, request)
        : response;
    const mode = await resolveCookieCompatibilityMode(request);
    return cloneResponseWithNormalizedNeonAuthCookies(cleanedResponse, mode);
  };
}

export const GET = withCookieCompatibility(authHandler.GET);
export const POST = withCookieCompatibility(authHandler.POST);
export const PUT = withCookieCompatibility(authHandler.PUT);
export const DELETE = withCookieCompatibility(authHandler.DELETE);
export const PATCH = withCookieCompatibility(authHandler.PATCH);
