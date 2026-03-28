import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/server";

export const runtime = "nodejs";

const DEFAULT_R2_BUCKET = "rowsncolumns-ai";
const DEFAULT_R2_PUBLIC_BASE_URL = "https://static.rowsncolumns.ai";
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
};

let cachedClient: S3Client | null = null;
let cachedClientEndpoint: string | null = null;

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

    const contentType = filePart.type?.trim().toLowerCase();
    if (!contentType || !ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
      return NextResponse.json(
        { error: "Unsupported image type. Use JPEG, PNG, WEBP, or GIF." },
        { status: 400 },
      );
    }

    if (filePart.size <= 0 || filePart.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "Image is too large. Upload up to 8MB." },
        { status: 400 },
      );
    }

    const sanitizedUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const datePrefix = new Date().toISOString().slice(0, 10);
    const extension = getFileExtension(contentType, filePart.name);
    const objectKey = `assistant-chat/${sanitizedUserId}/${datePrefix}/${crypto.randomUUID()}.${extension}`;
    const fileBytes = Buffer.from(await filePart.arrayBuffer());

    const client = getR2Client(config);
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
        Body: fileBytes,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
        ContentDisposition: "inline",
      }),
    );

    return NextResponse.json({
      url: `${config.publicBaseUrl}/${objectKey}`,
      key: objectKey,
      filename: filePart.name || `image.${extension}`,
      contentType,
      sizeBytes: filePart.size,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to upload image.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
