import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const toRedirect = (requestUrl: string, path: string) =>
  NextResponse.redirect(new URL(path, requestUrl), { status: 303 });

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const invitationId = formData?.get("invitationId");
  const action = formData?.get("action");

  const normalizedInvitationId =
    typeof invitationId === "string" ? invitationId.trim() : "";
  const normalizedAction = typeof action === "string" ? action.trim() : "";

  if (!normalizedInvitationId) {
    return toRedirect(request.url, "/sheets?invitation=missing");
  }
  if (normalizedAction !== "accept" && normalizedAction !== "decline") {
    return toRedirect(
      request.url,
      `/organization/accept-invitation?id=${encodeURIComponent(normalizedInvitationId)}`,
    );
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    const callbackPath = `/organization/accept-invitation?id=${encodeURIComponent(normalizedInvitationId)}`;
    return toRedirect(
      request.url,
      `/auth/sign-in?callbackURL=${encodeURIComponent(callbackPath)}`,
    );
  }

  try {
    if (normalizedAction === "accept") {
      const accepted = await auth.api.acceptInvitation({
        headers: request.headers,
        body: {
          invitationId: normalizedInvitationId,
        },
      });

      const acceptedOrganizationId = accepted?.invitation?.organizationId?.trim();
      if (!acceptedOrganizationId) {
        return toRedirect(request.url, "/sheets?invitation=accepted");
      }

      try {
        await auth.api.setActiveOrganization({
          headers: request.headers,
          body: {
            organizationId: acceptedOrganizationId,
          },
        });
      } catch {
        // Best-effort active organization switch before landing on /sheets.
      }

      return toRedirect(request.url, "/sheets?invitation=accepted");
    }

    await auth.api.rejectInvitation({
      headers: request.headers,
      body: {
        invitationId: normalizedInvitationId,
      },
    });
    return toRedirect(request.url, "/sheets?invitation=declined");
  } catch {
    return toRedirect(request.url, "/sheets?invitation=failed");
  }
}
