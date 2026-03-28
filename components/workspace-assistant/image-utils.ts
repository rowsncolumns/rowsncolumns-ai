"use client";

const CHAT_IMAGE_UPLOAD_API_ENDPOINT = "/api/chat/attachments/image";
const ASSISTANT_MAX_IMAGE_DIMENSION = 600;
const ASSISTANT_MAX_IMAGE_BYTES = 1_500_000;
const ASSISTANT_IMAGE_QUALITY_START = 0.86;
const ASSISTANT_IMAGE_QUALITY_MIN = 0.5;
const ASSISTANT_IMAGE_QUALITY_STEP = 0.08;
const ASSISTANT_IMAGE_UPLOAD_MIME_TYPE = "image/jpeg";

const HEIC_IMAGE_CONTENT_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

const HEIC_IMAGE_EXTENSIONS = new Set(["heic", "heif"]);

export type UploadedAssistantImage = {
  url: string;
  key?: string;
  filename?: string;
  contentType?: string;
  sizeBytes?: number;
};

const canvasToBlob = async (
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
) => {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to encode image."));
          return;
        }
        resolve(blob);
      },
      type,
      quality,
    );
  });
};

const loadImageElementFromFile = async (file: File) => {
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Unable to read image file."));
      element.src = imageUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
};

export const resizeImageForAssistant = async (file: File) => {
  const image = await loadImageElementFromFile(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) {
    throw new Error("Image has invalid dimensions.");
  }

  const maxSourceDimension = Math.max(sourceWidth, sourceHeight);
  const scale =
    maxSourceDimension > ASSISTANT_MAX_IMAGE_DIMENSION
      ? ASSISTANT_MAX_IMAGE_DIMENSION / maxSourceDimension
      : 1;
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is unavailable for image resizing.");
  }

  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  let quality = ASSISTANT_IMAGE_QUALITY_START;
  let blob = await canvasToBlob(
    canvas,
    ASSISTANT_IMAGE_UPLOAD_MIME_TYPE,
    quality,
  );

  while (
    blob.size > ASSISTANT_MAX_IMAGE_BYTES &&
    quality > ASSISTANT_IMAGE_QUALITY_MIN
  ) {
    quality = Math.max(
      ASSISTANT_IMAGE_QUALITY_MIN,
      quality - ASSISTANT_IMAGE_QUALITY_STEP,
    );
    blob = await canvasToBlob(
      canvas,
      ASSISTANT_IMAGE_UPLOAD_MIME_TYPE,
      quality,
    );
  }

  const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
  const resizedFileName = `${baseName}.jpg`;
  const resizedFile = new File([blob], resizedFileName, {
    type: ASSISTANT_IMAGE_UPLOAD_MIME_TYPE,
  });

  return {
    file: resizedFile,
    width: targetWidth,
    height: targetHeight,
    contentType: ASSISTANT_IMAGE_UPLOAD_MIME_TYPE,
    sizeBytes: blob.size,
  };
};

const getFileExtension = (filename: string) =>
  filename.split(".").pop()?.trim().toLowerCase() ?? "";

export const isHeicLikeFile = (file: File) => {
  const contentType = file.type?.trim().toLowerCase() ?? "";
  if (HEIC_IMAGE_CONTENT_TYPES.has(contentType)) {
    return true;
  }
  return HEIC_IMAGE_EXTENSIONS.has(getFileExtension(file.name));
};

export const isSupportedImageFile = (file: File) => {
  const contentType = file.type?.trim().toLowerCase() ?? "";
  if (contentType.startsWith("image/")) {
    return true;
  }
  return isHeicLikeFile(file);
};

export const getImageFilesFromDataTransfer = (transfer: DataTransfer | null) => {
  if (!transfer) {
    return [] as File[];
  }

  const files = Array.from(transfer.files).filter((file) =>
    isSupportedImageFile(file),
  );
  if (files.length > 0) {
    return files;
  }

  return Array.from(transfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter(
      (file): file is File => file !== null && isSupportedImageFile(file),
    );
};

const hasFileItemsInDataTransfer = (transfer: DataTransfer | null) => {
  if (!transfer) {
    return false;
  }

  if (Array.from(transfer.types ?? []).includes("Files")) {
    return true;
  }

  return Array.from(transfer.items).some((item) => item.kind === "file");
};

export const hasImageFilesInDataTransfer = (
  transfer: DataTransfer | null,
  options?: { allowUnknownFiles?: boolean },
) => {
  if (getImageFilesFromDataTransfer(transfer).length > 0) {
    return true;
  }

  return options?.allowUnknownFiles === true
    ? hasFileItemsInDataTransfer(transfer)
    : false;
};

export const uploadAssistantImage = async (input: {
  file: File;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}): Promise<UploadedAssistantImage> => {
  return new Promise<UploadedAssistantImage>((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", input.file, input.file.name);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", CHAT_IMAGE_UPLOAD_API_ENDPOINT);
    xhr.withCredentials = true;
    xhr.responseType = "json";

    const abortHandler = () => {
      xhr.abort();
    };

    xhr.upload.onprogress = (event) => {
      if (!input.onProgress || !event.lengthComputable || event.total <= 0) {
        return;
      }
      input.onProgress(event.loaded / event.total);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const payload = (xhr.response ||
          JSON.parse(xhr.responseText || "{}")) as UploadedAssistantImage;
        resolve(payload);
        return;
      }

      const errorPayload =
        (xhr.response as { error?: string } | null) ??
        (() => {
          try {
            return JSON.parse(xhr.responseText || "{}") as { error?: string };
          } catch {
            return null;
          }
        })();
      reject(
        new Error(
          errorPayload?.error?.trim() || "Failed to upload image attachment.",
        ),
      );
    };

    xhr.onerror = () => {
      reject(new Error("Failed to upload image attachment."));
    };

    xhr.onabort = () => {
      reject(new Error("Upload cancelled."));
    };

    if (input.signal) {
      if (input.signal.aborted) {
        xhr.abort();
        return;
      }
      input.signal.addEventListener("abort", abortHandler, { once: true });
    }

    xhr.onloadend = () => {
      if (input.signal) {
        input.signal.removeEventListener("abort", abortHandler);
      }
    };

    xhr.send(formData);
  });
};
