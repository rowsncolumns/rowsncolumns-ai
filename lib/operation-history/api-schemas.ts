import { z } from "zod";
import type { ActivityType, OperationSource } from "./types";

export const operationHistoryDocumentIdSchema = z
  .string()
  .trim()
  .min(1, "documentId is required.")
  .max(200, "documentId is too long.");

export const operationHistoryActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  by: z.string().optional(),
  activityTypes: z
    .string()
    .optional()
    .transform((value) =>
      value ? (value.split(",") as ActivityType[]) : undefined,
    ),
  sources: z
    .string()
    .optional()
    .transform((value) =>
      value ? (value.split(",") as OperationSource[]) : undefined,
    ),
  includeCount: z.coerce.boolean().optional().default(false),
});

export const operationHistoryUndoRequestSchema = z.object({
  operationId: z.string().uuid().optional(),
  preview: z.boolean().optional().default(false),
  confirm: z.boolean().optional(),
  reason: z.string().trim().max(500).optional(),
});

