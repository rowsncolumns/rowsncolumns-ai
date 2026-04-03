import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";

const DEFAULT_R2_BUCKET = "rowsncolumns-ai";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
};

let cachedClient: S3Client | null = null;
let cachedClientEndpoint: string | null = null;

export const getR2Config = (): R2Config | null => {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket =
    process.env.R2_BUCKET_NAME?.trim() ||
    process.env.R2_BUCKET?.trim() ||
    DEFAULT_R2_BUCKET;
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.trim() || "";

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

const bodyToBuffer = async (body: unknown): Promise<Buffer> => {
  if (!body) {
    throw new Error("R2 object body is empty.");
  }

  if (
    typeof body === "object" &&
    body !== null &&
    "transformToByteArray" in body &&
    typeof (body as { transformToByteArray?: unknown }).transformToByteArray ===
      "function"
  ) {
    const bytes = await (
      body as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray();
    return Buffer.from(bytes);
  }

  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new Error("Unsupported R2 object body type.");
};

export const putR2Object = async (input: {
  key: string;
  body: Uint8Array;
  contentType?: string;
  cacheControl?: string;
  contentDisposition?: string;
}) => {
  const config = getR2Config();
  if (!config) {
    throw new Error("R2 is not configured.");
  }

  const client = getR2Client(config);
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: input.cacheControl,
      ContentDisposition: input.contentDisposition,
    }),
  );
};

const isR2NotFoundError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const e = error as {
    name?: unknown;
    Code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  const name = typeof e.name === "string" ? e.name : "";
  const code = typeof e.Code === "string" ? e.Code : "";
  const statusCode =
    typeof e.$metadata?.httpStatusCode === "number"
      ? e.$metadata.httpStatusCode
      : null;

  return (
    name === "NotFound" ||
    name === "NoSuchKey" ||
    code === "NotFound" ||
    code === "NoSuchKey" ||
    statusCode === 404
  );
};

export const headR2Object = async (
  key: string,
): Promise<{
  contentLength: number | null;
  contentType: string | null;
  eTag: string | null;
  lastModified: string | null;
} | null> => {
  const config = getR2Config();
  if (!config) {
    throw new Error("R2 is not configured.");
  }

  const client = getR2Client(config);
  try {
    const response = await client.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: key,
      }),
    );

    return {
      contentLength:
        typeof response.ContentLength === "number"
          ? response.ContentLength
          : null,
      contentType: response.ContentType ?? null,
      eTag: response.ETag ?? null,
      lastModified: response.LastModified
        ? response.LastModified.toISOString()
        : null,
    };
  } catch (error) {
    if (isR2NotFoundError(error)) {
      return null;
    }
    throw error;
  }
};

export const createR2PresignedPutUrl = async (input: {
  key: string;
  contentType?: string;
  expiresInSeconds?: number;
}) => {
  const config = getR2Config();
  if (!config) {
    throw new Error("R2 is not configured.");
  }

  const expiresInSeconds = Math.max(
    60,
    Math.min(input.expiresInSeconds ?? 900, 3600),
  );

  const client = getR2Client(config);
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: input.key,
    ContentType: input.contentType,
  });

  return getSignedUrl(client, command, {
    expiresIn: expiresInSeconds,
  });
};

export const getR2ObjectBuffer = async (key: string): Promise<Buffer> => {
  const config = getR2Config();
  if (!config) {
    throw new Error("R2 is not configured.");
  }

  const client = getR2Client(config);
  const response = await client.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }),
  );

  return bodyToBuffer(response.Body);
};

export const deleteR2Object = async (key: string): Promise<void> => {
  const config = getR2Config();
  if (!config) {
    return;
  }

  const client = getR2Client(config);
  await client.send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }),
  );
};
