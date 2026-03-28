import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import sharp from "sharp";

import { auth } from "@/lib/auth/server";

export const runtime = "nodejs";

const DEFAULT_R2_BUCKET = "rowsncolumns-ai";
const DEFAULT_R2_PUBLIC_BASE_URL = "https://static.rowsncolumns.ai";
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_PROCESSED_UPLOAD_BYTES = 1_500_000;
const MAX_PROCESSED_IMAGE_DIMENSION = 600;
const JPEG_QUALITY_STEPS = [82, 74, 66, 58, 50] as const;
const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const HEIC_IMAGE_CONTENT_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);
const HEIC_IMAGE_EXTENSIONS = new Set(["heic", "heif"]);

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
};

let cachedClient: S3Client | null = null;
let cachedClientEndpoint: string | null = null;

const getFileNameExtension = (filename: string) =>
  filename.split(".").pop()?.trim().toLowerCase() ?? "";

const isHeicLikeUpload = (contentType: string, filename: string) => {
  if (HEIC_IMAGE_CONTENT_TYPES.has(contentType)) {
    return true;
  }
  if (
    contentType &&
    contentType !== "application/octet-stream" &&
    contentType !== "binary/octet-stream"
  ) {
    return false;
  }
  return HEIC_IMAGE_EXTENSIONS.has(getFileNameExtension(filename));
};

const getR2Config = (): R2Config | null => {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket =
    process.env.R2_BUCKET_NAME?.trim() ||
    process.env.R2_BUCKET?.trim() ||
    DEFAULT_R2_BUCKET;
  const publicBaseUrl =
    process.env.R2_PUBLIC_BASE_URL?.trim() || DEFAULT_R2_PUBLIC_BASE_URL;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl: publicBaseUrl.replace(/\/+$/, ""),
  };
};

const getR2Client = (config: R2Config) => {
  const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
  if (!cachedClient || cachedClientEndpoint !== endpoint) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    cachedClientEndpoint = endpoint;
  }

  return cachedClient;
};

const getFileExtension = (contentType: string, originalName: string) => {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  if (contentType === "image/jpeg") return "jpg";

  const fromName = originalName.split(".").pop()?.trim().toLowerCase();
  if (fromName && fromName.length <= 8) {
    return fromName;
  }

  return "jpg";
};

const buildOutputFilename = (originalName: string, contentType: string) => {
  const baseName = originalName.replace(/\.[^.]+$/, "") || "image";
  return `${baseName}.${getFileExtension(contentType, originalName)}`;
};

const transcodeHeicToJpeg = async (inputBytes: Buffer) => {
  let outputBytes: Buffer | null = null;
  for (const quality of JPEG_QUALITY_STEPS) {
    const encoded = await sharp(inputBytes, { failOn: "none" })
      .rotate()
      .resize({
        width: MAX_PROCESSED_IMAGE_DIMENSION,
        height: MAX_PROCESSED_IMAGE_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({
        quality,
        progressive: true,
        mozjpeg: true,
      })
      .toBuffer();

    outputBytes = encoded;
    if (encoded.length <= MAX_PROCESSED_UPLOAD_BYTES) {
      break;
    }
  }

  if (!outputBytes) {
    throw new Error("Unable to convert HEIC image.");
  }
  if (outputBytes.length > MAX_PROCESSED_UPLOAD_BYTES) {
    throw new Error("HEIC image is too large after conversion.");
  }

  return {
    bytes: outputBytes as Uint8Array,
    contentType: "image/jpeg",
    sizeBytes: outputBytes.length,
  } as const;
};

export async function POST(request: Request) {
  try {
    const { data: session } = await auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to continue." },
        { status: 401 },
      );
    }

    const config = getR2Config();
    if (!config) {
      return NextResponse.json(
        { error: "R2 is not configured for image uploads." },
        { status: 500 },
      );
    }

    const formData = await request.formData();
    const filePart = formData.get("file");
    if (!(filePart instanceof File)) {
      return NextResponse.json(
        { error: "Image file is required." },
        { status: 400 },
      );
    }

    const rawContentType = filePart.type?.trim().toLowerCase() || "";
    const isHeicUpload = isHeicLikeUpload(rawContentType, filePart.name);
    const isAllowedNativeContentType =
      rawContentType.length > 0 &&
      ALLOWED_IMAGE_CONTENT_TYPES.has(rawContentType);
    if (!isAllowedNativeContentType && !isHeicUpload) {
      return NextResponse.json(
        {
          error:
            "Unsupported image type. Use JPEG, PNG, WEBP, GIF, HEIC, or HEIF.",
        },
        { status: 400 },
      );
    }

    if (filePart.size <= 0 || filePart.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "Image is too large. Upload up to 8MB." },
        { status: 400 },
      );
    }

    const originalBytes = Buffer.from(await filePart.arrayBuffer());
    let uploadBody: Uint8Array = originalBytes;
    let uploadContentType = rawContentType;
    let outputFilename =
      filePart.name || buildOutputFilename("image.jpg", "image/jpeg");

    if (isHeicUpload) {
      try {
        const converted = await transcodeHeicToJpeg(originalBytes);
        uploadBody = converted.bytes;
        uploadContentType = converted.contentType;
        outputFilename = buildOutputFilename(filePart.name, uploadContentType);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to process HEIC/HEIF image.";
        return NextResponse.json({ error: message }, { status: 400 });
      }
    } else if (isAllowedNativeContentType) {
      uploadContentType = rawContentType;
      outputFilename =
        filePart.name || buildOutputFilename("image.jpg", uploadContentType);
    }

    const sanitizedUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const datePrefix = new Date().toISOString().slice(0, 10);
    const extension = getFileExtension(uploadContentType, outputFilename);
    const objectKey = `assistant-chat/${sanitizedUserId}/${datePrefix}/${crypto.randomUUID()}.${extension}`;

    const client = getR2Client(config);
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
        Body: uploadBody,
        ContentType: uploadContentType,
        CacheControl: "public, max-age=31536000, immutable",
        ContentDisposition: "inline",
      }),
    );

    return NextResponse.json({
      url: `${config.publicBaseUrl}/${objectKey}`,
      key: objectKey,
      filename: outputFilename || `image.${extension}`,
      contentType: uploadContentType,
      sizeBytes: uploadBody.byteLength,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to upload image.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
