import { auth } from "@/lib/auth/server";
import { cloneResponseWithNormalizedNeonAuthCookies } from "@/lib/auth/cookie-compat";

const authHandler = auth.handler();

type AuthRouteContext = {
  params: Promise<{ path: string[] }>;
};

type AuthRouteHandler = (
  request: Request,
  context: AuthRouteContext,
) => Promise<Response>;

function withCookieCompatibility(handler: AuthRouteHandler): AuthRouteHandler {
  return async (request, context) => {
    const response = await handler(request, context);
    return cloneResponseWithNormalizedNeonAuthCookies(response);
  };
}

export const GET = withCookieCompatibility(authHandler.GET);
export const POST = withCookieCompatibility(authHandler.POST);
export const PUT = withCookieCompatibility(authHandler.PUT);
export const DELETE = withCookieCompatibility(authHandler.DELETE);
export const PATCH = withCookieCompatibility(authHandler.PATCH);
