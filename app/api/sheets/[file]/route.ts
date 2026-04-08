import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createCSVFromSheetData,
  createODSFile,
  createExcelFile,
} from "@rowsncolumns/toolkit/server";
import {
  convertV3ToSheetData,
  type CellDataV3,
} from "@rowsncolumns/sharedb/helpers";
import type { CellData } from "@rowsncolumns/common-types";

import { auth } from "@/lib/auth/server";
import { resolveActiveOrganizationIdForSession } from "@/lib/auth/organization";
import {
  authenticateUserApiKeyFromRequest,
  resolveFirstOrganizationIdForUser,
} from "@/lib/auth/user-api-keys";
import { db } from "@/lib/db/postgres";
import {
  documentExists,
  ensureDocumentAccess,
  ensureDocumentMetadata,
  getPublicDocumentAccessByShareToken,
  isTemplateDocumentPubliclyViewable,
} from "@/lib/documents/repository";
import type { ImportDocumentSnapshot } from "@/lib/documents/import/parsers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ file: string }>;
};

type ExportFormat = "xlsx" | "csv" | "ods";

type ExportRequest = {
  docId: string;
  format: ExportFormat;
};

type ExportPayload = Omit<Parameters<typeof createExcelFile>[0], "filename">;
type SheetDataPayload = ExportPayload["sheetData"];
type SharedStringsPayload = NonNullable<ExportPayload["sharedStrings"]>;

const SHAREDB_COLLECTION =
  process.env.SHAREDB_COLLECTION?.trim() || "spreadsheets";

const fileParamSchema = z
  .string()
  .trim()
  .min(1, "file path parameter is required.")
  .max(260, "file path parameter is too long.");

const docIdSchema = z
  .string()
  .trim()
  .min(1, "documentId is required.")
  .max(200, "documentId is too long.");

const parseExportRequest = (value: string): ExportRequest | null => {
  const match = /^(.+)\.(xlsx|csv|ods)$/i.exec(value.trim());
  if (!match) {
    return null;
  }

  const [, rawDocId, rawFormat] = match;
  const parsedDocId = docIdSchema.safeParse(rawDocId);
  if (!parsedDocId.success) {
    return null;
  }

  return {
    docId: parsedDocId.data,
    format: rawFormat.toLowerCase() as ExportFormat,
  };
};

const getShareTokenFromRequest = (request: Request): string | undefined => {
  const share = new URL(request.url).searchParams.get("share");
  if (!share) {
    return undefined;
  }
  const trimmed = share.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toDashSeparatedLowercase = (
  value: string | undefined,
  fallback: string,
): string => {
  const normalized = (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 120);

  return normalized || fallback;
};

const parseRequestedSheetId = (
  request: Request,
): { value: number | null; error: string | null } => {
  const param = new URL(request.url).searchParams.get("sheetId");
  if (param == null) {
    return { value: null, error: null };
  }

  const trimmed = param.trim();
  if (!trimmed) {
    return { value: null, error: "sheetId must be a positive integer." };
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { value: null, error: "sheetId must be a positive integer." };
  }

  return { value: parsed, error: null };
};

const jsonError = (error: string, status: number) =>
  NextResponse.json(
    { error },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );

const buildDownloadHeaders = (filename: string, contentType: string) => ({
  "Content-Type": contentType,
  "Content-Disposition": `attachment; filename="${filename}"`,
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
});

type AuthenticatedViewer = {
  userId: string;
  orgId: string | null;
};

const resolveAuthenticatedViewer = async (
  request: Request,
): Promise<AuthenticatedViewer | null> => {
  const { data: session } = await auth.getSession();
  const user = session?.user;

  if (user) {
    const orgId = await resolveActiveOrganizationIdForSession(session);
    return {
      userId: user.id,
      orgId,
    };
  }

  const apiKeyAuth = await authenticateUserApiKeyFromRequest(request);
  if (!apiKeyAuth) {
    return null;
  }

  const orgId =
    apiKeyAuth.organizationId ??
    (await resolveFirstOrganizationIdForUser(apiKeyAuth.userId));
  return {
    userId: apiKeyAuth.userId,
    orgId,
  };
};

const ensureCanDownload = async (
  request: Request,
  docId: string,
  shareToken?: string,
): Promise<NextResponse | null> => {
  const viewer = await resolveAuthenticatedViewer(request);
  if (viewer) {
    const [publicAccess, isPublicTemplate] = await Promise.all([
      getPublicDocumentAccessByShareToken({
        docId,
        shareToken,
      }),
      isTemplateDocumentPubliclyViewable({
        docId,
      }),
    ]);

    const orgId = viewer.orgId;
    if (orgId) {
      const access = await ensureDocumentAccess({
        docId,
        userId: viewer.userId,
        orgId,
        shareToken,
      });
      if (!access.canAccess) {
        return jsonError("Forbidden.", 403);
      }
      return null;
    }

    if (publicAccess.canAccess || isPublicTemplate) {
      return null;
    }

    return jsonError(
      "No active organization. Create an organization first.",
      409,
    );
  }

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
    return jsonError("Unauthorized.", 401);
  }

  return null;
};

type SnapshotRow = {
  data: unknown;
};

const loadSnapshot = async (
  docId: string,
): Promise<Partial<ImportDocumentSnapshot> | null> => {
  const rows = await db<SnapshotRow[]>`
    SELECT data
    FROM public.snapshots
    WHERE collection = ${SHAREDB_COLLECTION}
      AND doc_id = ${docId}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row || typeof row.data !== "object" || row.data === null) {
    return null;
  }

  return row.data as Partial<ImportDocumentSnapshot>;
};

const normalizeExportData = (snapshot: Partial<ImportDocumentSnapshot>) => {
  const sheets = snapshot.sheets ?? [];
  const sheetData = convertV3ToSheetData<CellData>(
    (snapshot.sheetData ?? {}) as Record<string, CellDataV3<CellData>>,
  ) as SheetDataPayload;
  const sharedStrings = new Map<string, string>(
    Object.entries(snapshot.sharedStrings ?? {}),
  ) as SharedStringsPayload;
  const cellXfs = new Map<string, unknown>(
    Object.entries(snapshot.cellXfs ?? {}),
  ) as NonNullable<ExportPayload["cellXfs"]>;

  const exportData: ExportPayload = {
    sheets: snapshot.sheets ?? [{ title: "Sheet1", sheetId: 1 }],
    sheetData,
    sharedStrings,
    tables: snapshot.tables,
    charts: snapshot.charts,
    embeds: snapshot.embeds,
    namedRanges: snapshot.namedRanges,
    conditionalFormats: snapshot.conditionalFormats,
    dataValidations: snapshot.dataValidations ?? [],
    cellXfs,
    citations: snapshot.citations,
    slicers: snapshot.slicers,
    iterativeCalculationOptions: {
      enabled:
        snapshot.iterativeCalculation &&
        typeof snapshot.iterativeCalculation === "object"
          ? snapshot.iterativeCalculation.enabled
          : false,
    },
  };

  return {
    sheets,
    sheetData,
    sharedStrings,
    exportData,
  };
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { file: rawFile } = await context.params;
    const parsedFile = fileParamSchema.safeParse(rawFile);
    if (!parsedFile.success) {
      return jsonError("Invalid request.", 400);
    }

    const exportRequest = parseExportRequest(parsedFile.data);
    if (!exportRequest) {
      return jsonError("Unsupported file extension.", 400);
    }

    if (!(await documentExists(exportRequest.docId))) {
      return jsonError("Document not found.", 404);
    }

    const shareToken = getShareTokenFromRequest(request);
    const accessError = await ensureCanDownload(
      request,
      exportRequest.docId,
      shareToken,
    );
    if (accessError) {
      return accessError;
    }

    const snapshot = await loadSnapshot(exportRequest.docId);
    if (!snapshot) {
      return jsonError("Document snapshot not found.", 404);
    }

    const { sheets, sheetData, sharedStrings, exportData } =
      normalizeExportData(snapshot);
    const metadata = await ensureDocumentMetadata({
      docId: exportRequest.docId,
    });
    const baseFilename = toDashSeparatedLowercase(
      metadata.title,
      toDashSeparatedLowercase(exportRequest.docId, "spreadsheet"),
    );

    if (exportRequest.format === "xlsx") {
      const xlsxBuffer = await createExcelFile(exportData);
      const xlsxBytes = new Uint8Array(xlsxBuffer);
      return new NextResponse(xlsxBytes, {
        headers: buildDownloadHeaders(
          `${baseFilename}.xlsx`,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ),
      });
    }

    if (exportRequest.format === "csv") {
      const requestedSheetId = parseRequestedSheetId(request);
      if (requestedSheetId.error) {
        return jsonError(requestedSheetId.error, 400);
      }

      const availableSheetIds = sheets
        .map((sheet) => Number(sheet.sheetId))
        .filter((sheetId) => Number.isInteger(sheetId) && sheetId > 0);
      const targetSheetId = requestedSheetId.value ?? availableSheetIds[0] ?? 1;

      if (
        requestedSheetId.value !== null &&
        !availableSheetIds.includes(requestedSheetId.value)
      ) {
        return jsonError("Requested sheetId does not exist.", 400);
      }

      const csvSheet = sheets.find(
        (sheet) => Number(sheet.sheetId) === targetSheetId,
      );
      const csvRowData = sheetData[String(targetSheetId)] ?? [];
      const csv = createCSVFromSheetData(csvRowData, sharedStrings);
      const csvSheetSuffix = toDashSeparatedLowercase(
        csvSheet?.title,
        `sheet-${targetSheetId}`,
      );
      const csvFilename = `${baseFilename}-${csvSheetSuffix}.csv`;

      return new NextResponse(csv, {
        headers: buildDownloadHeaders(csvFilename, "text/csv; charset=utf-8"),
      });
    }

    const odsBuffer = await createODSFile(exportData);
    const odsBytes = new Uint8Array(odsBuffer);
    return new NextResponse(odsBytes, {
      headers: buildDownloadHeaders(
        `${baseFilename}.ods`,
        "application/vnd.oasis.opendocument.spreadsheet",
      ),
    });
  } catch (error) {
    console.error("[api/sheets/export] failed to export document", error);
    const message =
      error instanceof Error ? error.message : "Failed to export document.";
    return jsonError(message, 500);
  }
}
