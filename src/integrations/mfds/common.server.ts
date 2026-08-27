import "@tanstack/react-start/server-only";

import { z } from "zod";

const NumericStringSchema = z.preprocess(
  (value) => (typeof value === "number" ? String(value) : value),
  z.string().trim().min(1),
);

const ProviderHeaderSchema = z.object({
  resultCode: NumericStringSchema,
  resultMsg: z.string().optional(),
});

const PaginationSchema = z.object({
  pageNo: z.coerce.number().int().nonnegative(),
  numOfRows: z.coerce.number().int().nonnegative(),
  totalCount: z.coerce.number().int().nonnegative(),
});

export class MfdsProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "MfdsProviderError";
  }
}

function normalizeItemsContainer(value: unknown): unknown[] | unknown {
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== "object") return value;

  const item = (value as { item?: unknown }).item;
  if (item === null || item === undefined || item === "") return [];
  return Array.isArray(item) ? item : [item];
}

export interface MfdsPage<T> {
  pageNo: number;
  numOfRows: number;
  totalCount: number;
  items: T[];
}

export function parseMfdsPage<TSchema extends z.ZodTypeAny>(input: {
  value: unknown;
  itemSchema: TSchema;
  invalidCode: string;
}): MfdsPage<z.infer<TSchema>> {
  const BodySchema = PaginationSchema.extend({
    items: z.preprocess(normalizeItemsContainer, z.array(input.itemSchema)),
  });
  const ResponseSchema = z.object({
    header: ProviderHeaderSchema,
    body: BodySchema,
  });
  const result = ResponseSchema.safeParse(input.value);

  if (!result.success) {
    throw new MfdsProviderError(input.invalidCode, false);
  }
  if (result.data.header.resultCode !== "00") {
    const retryable = ["01", "05", "22", "23"].includes(result.data.header.resultCode);
    throw new MfdsProviderError("MFDS_PROVIDER_REJECTED", retryable);
  }

  return {
    pageNo: result.data.body.pageNo,
    numOfRows: result.data.body.numOfRows,
    totalCount: result.data.body.totalCount,
    items: result.data.body.items,
  };
}

export const OptionalProviderStringSchema = z.preprocess(
  (value) => (value === null || value === undefined || value === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

export function nullableString(value: string | undefined): string | null {
  return value ?? null;
}
