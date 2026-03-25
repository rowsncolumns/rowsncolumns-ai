import { auth } from "@/lib/auth/server";
import {
  cloneResponseWithNormalizedNeonAuthCookies,
  type NeonAuthCookieCompatibilityMode,
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
    const mode = await resolveCookieCompatibilityMode(request);
    return await cloneResponseWithNormalizedNeonAuthCookies(response, mode);
  };
}

export const GET = withCookieCompatibility(authHandler.GET);
export const POST = withCookieCompatibility(authHandler.POST);
export const PUT = withCookieCompatibility(authHandler.PUT);
export const DELETE = withCookieCompatibility(authHandler.DELETE);
export const PATCH = withCookieCompatibility(authHandler.PATCH);
