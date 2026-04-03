const BYTES_PER_MB = 1024 * 1024;
const DEFAULT_MAX_UPLOAD_MB = 30;

const parsePositiveInt = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

export const getMaxImportUploadBytes = (): number => {
  const configuredMb = parsePositiveInt(process.env.DOCUMENT_IMPORT_MAX_UPLOAD_MB);
  const effectiveMb = configuredMb ?? DEFAULT_MAX_UPLOAD_MB;
  return effectiveMb * BYTES_PER_MB;
};

export const formatMaxUploadSizeLabel = (bytes: number): string => {
  const mb = Math.max(1, Math.round(bytes / BYTES_PER_MB));
  return `${mb} MB`;
};
