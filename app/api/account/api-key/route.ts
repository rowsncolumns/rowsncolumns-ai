import { NextResponse } from "next/server";

import {
  getActiveOrganizationIdFromSession,
  resolveActiveOrganizationIdForSession,
} from "@/lib/auth/organization";
import { getOrganizationRoleForUser } from "@/lib/auth/organization-membership";
import { auth } from "@/lib/auth/server";
import {
  createOrRotateUserApiKey,
  getActiveUserApiKeyMetadata,
  resolveFirstOrganizationIdForUser,
  revokeActiveUserApiKey,
} from "@/lib/auth/user-api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unauthorizedResponse = () =>
  NextResponse.json({ error: "Unauthorized." }, { status: 401 });

const parseOrganizationIdFromUrl = (request: Request): string | null => {
  const value = new URL(request.url).searchParams.get("organizationId");
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const parseOrganizationIdFromBody = async (
  request: Request,
): Promise<string | null> => {
  const payload = (await request.json().catch(() => null)) as
    | { organizationId?: unknown }
    | null;
  const raw = payload?.organizationId;
  if (typeof raw !== "string") {
    return null;
  }
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : null;
};

const resolveOrganizationIdForRequest = async ({
  request,
  session,
  userId,
  fromBody,
}: {
  request: Request;
  session: unknown;
  userId: string;
  fromBody: boolean;
}): Promise<string | null> => {
  const explicitOrganizationId = fromBody
    ? await parseOrganizationIdFromBody(request)
    : parseOrganizationIdFromUrl(request);

  const fallbackOrganizationId =
    explicitOrganizationId ??
    getActiveOrganizationIdFromSession(session) ??
    (await resolveActiveOrganizationIdForSession(session)) ??
    (await resolveFirstOrganizationIdForUser(userId));

  if (!fallbackOrganizationId) {
    return null;
  }

  const role = await getOrganizationRoleForUser({
    userId,
    organizationId: fallbackOrganizationId,
  });

  if (!role) {
    return null;
  }

  return fallbackOrganizationId;
};

export async function GET(request: Request) {
  try {
    const { data: session } = await auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return unauthorizedResponse();
    }

    const organizationId = await resolveOrganizationIdForRequest({
      request,
      session,
      userId,
      fromBody: false,
    });
    if (!organizationId) {
      return NextResponse.json(
        {
          hasKey: false,
          key: null,
          organizationId: null,
        },
        { status: 200 },
      );
    }

    const key = await getActiveUserApiKeyMetadata(userId, organizationId);

    return NextResponse.json({
      hasKey: Boolean(key),
      key,
      organizationId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch API key.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { data: session } = await auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return unauthorizedResponse();
    }

    const organizationId = await resolveOrganizationIdForRequest({
      request,
      session,
      userId,
      fromBody: true,
    });
    if (!organizationId) {
      return NextResponse.json(
        { error: "Invalid or unauthorized organization." },
        { status: 403 },
      );
    }

    const created = await createOrRotateUserApiKey(userId, organizationId);
    return NextResponse.json({
      apiKey: created.apiKey,
      key: created.key,
      organizationId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create API key.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { data: session } = await auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return unauthorizedResponse();
    }

    const organizationId = await resolveOrganizationIdForRequest({
      request,
      session,
      userId,
      fromBody: true,
    });
    if (!organizationId) {
      return NextResponse.json(
        { error: "Invalid or unauthorized organization." },
        { status: 403 },
      );
    }

    const revoked = await revokeActiveUserApiKey(userId, organizationId);
    return NextResponse.json({ revoked, organizationId });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to revoke API key.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
