import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/server";
import {
  ensureDocumentAccess,
  getPublicDocumentAccessByShareToken,
  isTemplateDocumentPubliclyViewable,
} from "@/lib/documents/repository";
import {
  canIssueShareDbWsAccessToken,
  issueShareDbWsAccessToken,
} from "@/lib/sharedb/ws-token";

const WS_TOKEN_TTL_SECONDS = 60;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

const getDocIdFromRequest = (request: Request): string | null => {
  const { searchParams } = new URL(request.url);
  const docId = searchParams.get("docId");
  if (!docId) {
    return null;
  }
  const trimmed = docId.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getShareTokenFromRequest = (request: Request): string | undefined => {
  const { searchParams } = new URL(request.url);
  const share = searchParams.get("share");
  if (!share) {
    return undefined;
  }
  const trimmed = share.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export async function GET(request: Request) {
  try {
    const docId = getDocIdFromRequest(request);
    if (!docId) {
      return NextResponse.json(
        { error: "Missing docId query parameter." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const shareToken = getShareTokenFromRequest(request);
    const { data: session } = await auth.getSession();
    const user = session?.user;

    let tokenUserId: string;
    let tokenPermission: "view" | "edit";
    let tokenEmail: string | null = null;
    let tokenName: string | null = null;

    if (user) {
      const [access, isTemplateDocument] = await Promise.all([
        ensureDocumentAccess({
          docId,
          userId: user.id,
          shareToken,
        }),
        isTemplateDocumentPubliclyViewable({
          docId,
        }),
      ]);
      if (!access.canAccess) {
        return NextResponse.json(
          { error: "Forbidden." },
          { status: 403, headers: NO_STORE_HEADERS },
        );
      }

      const isReadOnlyTemplateView = isTemplateDocument && !access.isOwner;
      tokenUserId = user.id;
      tokenPermission = isReadOnlyTemplateView ? "view" : access.permission;
      tokenEmail = user.email ?? null;
      tokenName = user.name ?? null;
    } else {
      const [publicAccess, isPublicTemplate] = await Promise.all([
        getPublicDocumentAccessByShareToken({
          docId,
          shareToken,
        }),
        isTemplateDocumentPubliclyViewable({
          docId,
        }),
      ]);
      if (!publicAccess.canAccess && !isPublicTemplate) {
        return NextResponse.json(
          { error: "Unauthorized." },
          { status: 401, headers: NO_STORE_HEADERS },
        );
      }

      // Logged-out viewers with a share link are always read-only.
      tokenUserId = `public:${docId}:${crypto.randomUUID()}`;
      tokenPermission = "view";
      tokenName = "Public Viewer";
    }

    const token = await issueShareDbWsAccessToken({
      userId: tokenUserId,
      docId,
      permission: tokenPermission,
      email: tokenEmail,
      name: tokenName,
      ttlSeconds: WS_TOKEN_TTL_SECONDS,
    });

    if (!token) {
      return NextResponse.json(
        {
          error: canIssueShareDbWsAccessToken()
            ? "Unable to issue websocket token."
            : "Websocket token secret is not configured.",
        },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      {
        token,
        expiresInSeconds: WS_TOKEN_TTL_SECONDS,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("[api/sharedb/ws-token] failed to issue ws token", error);
    return NextResponse.json(
      { error: "Failed to issue websocket token." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
