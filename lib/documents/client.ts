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

type CreateDocumentFromUploadOptions = {
  onUploadProgress?: (progress: UploadProgress) => void;
  onStageChange?: (stage: UploadStage) => void;
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

      if (
        !payload ||
        typeof payload !== "object" ||
        !("documentId" in payload) ||
        typeof payload.documentId !== "string" ||
        payload.documentId.trim().length === 0
      ) {
        reject(new Error("Document id missing in import response."));
        return;
      }

      options?.onUploadProgress?.({
        loaded: file.size,
        total: file.size,
        percent: 100,
      });

      resolve(payload.documentId);
    };

    xhr.send(formData);
  });
}
