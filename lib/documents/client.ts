const parseErrorMessage = async (response: Response, fallback: string) => {
  const payload = await response.json().catch(() => null);
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string" &&
    payload.error.trim().length > 0
  ) {
    return payload.error;
  }
  return fallback;
};

const extractErrorMessage = (payload: unknown, fallback: string) => {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string" &&
    payload.error.trim().length > 0
  ) {
    return payload.error;
  }
  return fallback;
};

export type UploadProgress = {
  loaded: number;
  total: number | null;
  percent: number | null;
};

export type UploadStage = "uploading" | "saving";

type ImportJobStatus = "queued" | "processing" | "completed" | "failed";

type ImportJobStatusPayload = {
  jobId?: string;
  status?: ImportJobStatus;
  phase?: string;
  progressPercent?: number;
  documentId?: string;
  error?: string;
};

type CreateDocumentFromUploadOptions = {
  onUploadProgress?: (progress: UploadProgress) => void;
  onStageChange?: (stage: UploadStage) => void;
};

const IMPORT_JOB_POLL_INTERVAL_MS = 1000;
const IMPORT_JOB_TIMEOUT_MS = 8 * 60 * 1000;
const FALLBACK_UPLOAD_CONTENT_TYPE = "application/octet-stream";

const getFileExtension = (filename: string): string => {
  const parts = filename.toLowerCase().split(".");
  return parts.length > 1 ? (parts.at(-1) ?? "") : "";
};

type ImportUploadUrlResponse = {
  uploadUrl?: string;
  objectKey?: string;
  contentType?: string;
};

const requestImportUploadUrl = async (
  file: File,
): Promise<{
  uploadUrl: string;
  objectKey: string;
  contentType: string;
}> => {
  const response = await fetch("/api/documents/import/upload-url", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      fileName: file.name,
      fileSizeBytes: file.size,
      contentType: file.type,
    }),
  });

  if (!response.ok) {
    throw new Error(
      await parseErrorMessage(response, "Failed to start upload."),
    );
  }

  const payload = (await response.json()) as ImportUploadUrlResponse;
  const uploadUrl = payload.uploadUrl?.trim() || "";
  const objectKey = payload.objectKey?.trim() || "";
  const contentType =
    payload.contentType?.trim() || file.type || FALLBACK_UPLOAD_CONTENT_TYPE;

  if (!uploadUrl || !objectKey) {
    throw new Error("Upload URL response is missing required fields.");
  }

  return {
    uploadUrl,
    objectKey,
    contentType,
  };
};

const uploadFileDirectlyToStorage = async (input: {
  file: File;
  uploadUrl: string;
  contentType: string;
  options?: CreateDocumentFromUploadOptions;
}) =>
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", input.uploadUrl);
    xhr.responseType = "text";
    xhr.setRequestHeader("Content-Type", input.contentType);

    input.options?.onStageChange?.("uploading");

    xhr.upload.onprogress = (event) => {
      if (!input.options?.onUploadProgress) {
        return;
      }

      const total = event.lengthComputable ? event.total : null;
      const percent =
        total && total > 0
          ? Math.min(100, Math.round((event.loaded / total) * 100))
          : null;

      input.options.onUploadProgress({
        loaded: event.loaded,
        total,
        percent,
      });
    };

    xhr.upload.onload = () => {
      input.options?.onStageChange?.("saving");
    };

    xhr.onerror = () => {
      reject(new Error("Network error while uploading file."));
    };

    xhr.onabort = () => {
      reject(new Error("Upload was cancelled."));
    };

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error("Failed to upload file to storage."));
        return;
      }

      input.options?.onUploadProgress?.({
        loaded: input.file.size,
        total: input.file.size,
        percent: 100,
      });
      input.options?.onStageChange?.("saving");
      resolve();
    };

    xhr.send(input.file);
  });

const createImportJobFromUploadedObject = async (input: {
  file: File;
  objectKey: string;
}): Promise<{ documentId?: string; jobId?: string }> => {
  const response = await fetch("/api/documents/import", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      objectKey: input.objectKey,
      fileName: input.file.name,
      fileExtension: getFileExtension(input.file.name),
      fileSizeBytes: input.file.size,
    }),
  });

  if (!response.ok) {
    throw new Error(
      await parseErrorMessage(response, "Failed to import document."),
    );
  }

  return (await response.json()) as { documentId?: string; jobId?: string };
};

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const waitForImportJobCompletion = async (input: {
  jobId: string;
  file: File;
  options?: CreateDocumentFromUploadOptions;
}): Promise<string> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < IMPORT_JOB_TIMEOUT_MS) {
    const response = await fetch(
      `/api/documents/import/jobs/${encodeURIComponent(input.jobId)}`,
      {
        method: "GET",
        cache: "no-store",
      },
    );

    const payload = (await response.json().catch(() => null)) as
      | ImportJobStatusPayload
      | null;

    if (!response.ok) {
      throw new Error(
        extractErrorMessage(payload, "Failed to fetch import status."),
      );
    }

    const status = payload?.status;
    if (status === "completed") {
      const documentId = payload?.documentId?.trim();
      if (!documentId) {
        throw new Error("Document id missing in import completion response.");
      }
      return documentId;
    }

    if (status === "failed") {
      throw new Error(
        extractErrorMessage(payload, "Spreadsheet import failed."),
      );
    }

    input.options?.onStageChange?.("saving");
    input.options?.onUploadProgress?.({
      loaded: input.file.size,
      total: input.file.size,
      percent: 100,
    });

    await delay(IMPORT_JOB_POLL_INTERVAL_MS);
  }

  throw new Error("Import timed out. Please try again.");
};

export async function createBlankDocument(): Promise<string> {
  const response = await fetch("/api/documents", { method: "POST" });

  if (!response.ok) {
    throw new Error(
      await parseErrorMessage(response, "Failed to create document."),
    );
  }

  const payload = (await response.json()) as { documentId?: string };
  if (!payload.documentId) {
    throw new Error("Document id missing in create response.");
  }

  return payload.documentId;
}

export async function createDocumentFromUpload(
  file: File,
  options?: CreateDocumentFromUploadOptions,
): Promise<string> {
  const uploadTarget = await requestImportUploadUrl(file);
  await uploadFileDirectlyToStorage({
    file,
    uploadUrl: uploadTarget.uploadUrl,
    contentType: uploadTarget.contentType,
    options,
  });

  const payload = await createImportJobFromUploadedObject({
    file,
    objectKey: uploadTarget.objectKey,
  });

  const payloadDocumentId =
    typeof payload?.documentId === "string" ? payload.documentId.trim() : "";
  if (payloadDocumentId) {
    return payloadDocumentId;
  }

  const payloadJobId = typeof payload?.jobId === "string" ? payload.jobId.trim() : "";
  if (!payloadJobId) {
    throw new Error("Import job id missing in import response.");
  }

  return waitForImportJobCompletion({
    jobId: payloadJobId,
    file,
    options,
  });
}
