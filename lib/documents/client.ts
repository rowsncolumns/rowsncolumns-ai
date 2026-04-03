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

const parseJsonText = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
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
  const formData = new FormData();
  formData.set("file", file);

  return await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/documents/import");
    xhr.responseType = "text";
    options?.onStageChange?.("uploading");

    xhr.upload.onprogress = (event) => {
      if (!options?.onUploadProgress) {
        return;
      }

      const total = event.lengthComputable ? event.total : null;
      const percent =
        total && total > 0
          ? Math.min(100, Math.round((event.loaded / total) * 100))
          : null;

      options.onUploadProgress({
        loaded: event.loaded,
        total,
        percent,
      });
    };

    xhr.upload.onload = () => {
      options?.onStageChange?.("saving");
    };

    xhr.onerror = () => {
      reject(new Error("Network error while uploading file."));
    };

    xhr.onabort = () => {
      reject(new Error("Upload was cancelled."));
    };

    xhr.onload = () => {
      const payload = parseJsonText(xhr.responseText);

      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          new Error(extractErrorMessage(payload, "Failed to import document.")),
        );
        return;
      }

      options?.onUploadProgress?.({
        loaded: file.size,
        total: file.size,
        percent: 100,
      });
      options?.onStageChange?.("saving");

      const payloadDocumentId =
        payload &&
        typeof payload === "object" &&
        "documentId" in payload &&
        typeof payload.documentId === "string"
          ? payload.documentId.trim()
          : "";
      if (payloadDocumentId) {
        resolve(payloadDocumentId);
        return;
      }

      const payloadJobId =
        payload &&
        typeof payload === "object" &&
        "jobId" in payload &&
        typeof payload.jobId === "string"
          ? payload.jobId.trim()
          : "";
      if (!payloadJobId) {
        reject(new Error("Import job id missing in import response."));
        return;
      }

      waitForImportJobCompletion({
        jobId: payloadJobId,
        file,
        options,
      })
        .then(resolve)
        .catch(reject);
    };

    xhr.send(formData);
  });
}
