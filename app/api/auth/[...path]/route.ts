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
const AUTH_COOKIE_CLEANUP_PATHS = ["/", "/api", "/api/auth", "/auth"] as const;

function shouldApplyAuthCookieCleanup(request: Request): boolean {
  const requestUrl = new URL(request.url);
  const pathname = requestUrl.pathname;
  const method = request.method.toUpperCase();
  if (method === "POST" && pathname.endsWith("/sign-in/social")) {
    return true;
  }
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
): string {
  const secureDirective = secure ? "; Secure" : "";
  return `${name}=; Path=${path}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secureDirective}`;
}

function addAuthCookieCleanupHeaders(response: Response): Response {
  const existingSetCookies = readSetCookieHeaders(response.headers);
  const nextHeaders = new Headers(response.headers);
  nextHeaders.delete("set-cookie");

  for (const cookieName of AUTH_COOKIE_CLEANUP_NAMES) {
    const isSecureCookie = cookieName.startsWith("__Secure-");
    for (const path of AUTH_COOKIE_CLEANUP_PATHS) {
      nextHeaders.append(
        "set-cookie",
        buildCookieDeleteHeader(cookieName, path, isSecureCookie),
      );
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
    const response = await handler(request, context);
    const cleanedResponse = shouldApplyAuthCookieCleanup(request)
      ? addAuthCookieCleanupHeaders(response)
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
