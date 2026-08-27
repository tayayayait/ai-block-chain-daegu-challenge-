import "@tanstack/react-start/server-only";

import { z } from "zod";
import { getServerEnv } from "@/lib/env.server";
import {
  createDefaultMedicationApiCacheRepository,
  type MedicationApiCacheRepository,
} from "./cache.server";
import {
  nullableString,
  OptionalProviderStringSchema,
  parseMfdsPage,
  type MfdsPage,
} from "./common.server";
import { createMfdsTransport, type MfdsTransportOptions } from "./transport.server";

export const DUR_OPERATIONS = [
  "PRODUCT",
  "COMBINATION_CONTRAINDICATION",
  "ELDERLY_CAUTION",
  "AGE_CONTRAINDICATION",
  "CAPACITY_CAUTION",
  "DURATION_CAUTION",
  "EFFICACY_DUPLICATION",
  "EXTENDED_RELEASE_SPLIT_CAUTION",
  "PREGNANCY_CONTRAINDICATION",
] as const;

export type DurOperation = (typeof DUR_OPERATIONS)[number];

const DUR_ENDPOINTS: Readonly<Record<DurOperation, string>> = {
  PRODUCT: "getDurPrdlstInfoList03",
  COMBINATION_CONTRAINDICATION: "getUsjntTabooInfoList03",
  ELDERLY_CAUTION: "getOdsnAtentInfoList03",
  AGE_CONTRAINDICATION: "getSpcifyAgrdeTabooInfoList03",
  CAPACITY_CAUTION: "getCpctyAtentInfoList03",
  DURATION_CAUTION: "getMdctnPdAtentInfoList03",
  EFFICACY_DUPLICATION: "getEfcyDplctInfoList03",
  EXTENDED_RELEASE_SPLIT_CAUTION: "getSeobangjeongPartitnAtentInfoList03",
  PREGNANCY_CONTRAINDICATION: "getPwnmTabooInfoList03",
};
const DUR_ITEMS_PER_OPERATION = 10;

const DurBaseProviderItemSchema = z.object({
  ITEM_SEQ: z.preprocess(
    (value) => (typeof value === "number" ? String(value) : value),
    z.string().trim().min(1),
  ),
  ITEM_NAME: OptionalProviderStringSchema,
  ENTP_NAME: OptionalProviderStringSchema,
  INGREDIENT_NAME: OptionalProviderStringSchema,
  TYPE_NAME: OptionalProviderStringSchema,
  DUR_TYPE_NAME: OptionalProviderStringSchema,
  PROHBT_CONTENT: OptionalProviderStringSchema,
  REMARK: OptionalProviderStringSchema,
});

const DurOperationSchemas = {
  PRODUCT: DurBaseProviderItemSchema,
  COMBINATION_CONTRAINDICATION: DurBaseProviderItemSchema.extend({
    MIXTURE_ITEM_SEQ: OptionalProviderStringSchema,
    MIXTURE_ITEM_NAME: OptionalProviderStringSchema,
    MIXTURE_INGREDIENT_NAME: OptionalProviderStringSchema,
  }),
  ELDERLY_CAUTION: DurBaseProviderItemSchema,
  AGE_CONTRAINDICATION: DurBaseProviderItemSchema.extend({
    SPECIFIC_AGE: OptionalProviderStringSchema,
  }),
  CAPACITY_CAUTION: DurBaseProviderItemSchema.extend({
    MAX_QTY: OptionalProviderStringSchema,
  }),
  DURATION_CAUTION: DurBaseProviderItemSchema.extend({
    MAX_DAYS: OptionalProviderStringSchema,
  }),
  EFFICACY_DUPLICATION: DurBaseProviderItemSchema,
  EXTENDED_RELEASE_SPLIT_CAUTION: DurBaseProviderItemSchema,
  PREGNANCY_CONTRAINDICATION: DurBaseProviderItemSchema.extend({
    GRADE: OptionalProviderStringSchema,
  }),
} satisfies Record<DurOperation, z.ZodTypeAny>;

type DurProviderItem = z.infer<(typeof DurOperationSchemas)[DurOperation]>;

const DurSearchSchema = z.object({
  itemSeq: z
    .string()
    .trim()
    .regex(/^\d{1,20}$/)
    .optional(),
  itemName: z.string().trim().min(1).max(200).optional(),
  ingredientName: z.string().trim().min(1).max(200).optional(),
  typeName: z.string().trim().min(1).max(200).optional(),
  pageNo: z.number().int().positive().default(1),
  numOfRows: z.number().int().positive().max(100).default(30),
});

export type DurSearch = z.input<typeof DurSearchSchema>;

export interface DurItem {
  operation: DurOperation;
  itemSeq: string;
  itemName: string | null;
  manufacturerName: string | null;
  ingredientName: string | null;
  relatedItemSeq: string | null;
  relatedItemName: string | null;
  relatedIngredientName: string | null;
  typeName: string | null;
  cautionText: string | null;
  threshold: string | null;
}

export type MfdsAvailability = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";

export interface DurOperationResult {
  status: MfdsAvailability;
  page: MfdsPage<DurItem> | null;
}

export interface DurItemResult {
  status: MfdsAvailability;
  operations: Readonly<Record<DurOperation, DurOperationResult>>;
}

function optionalField(item: DurProviderItem, key: string): string | undefined {
  const value = (item as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseDurResponse(operation: DurOperation, value: unknown): MfdsPage<DurItem> {
  const page = parseMfdsPage({
    value,
    itemSchema: DurOperationSchemas[operation],
    invalidCode: `MFDS_DUR_${operation}_INVALID_RESPONSE`,
  });
  return {
    ...page,
    items: page.items.map((item) => ({
      operation,
      itemSeq: item.ITEM_SEQ,
      itemName: nullableString(item.ITEM_NAME),
      manufacturerName: nullableString(item.ENTP_NAME),
      ingredientName: nullableString(item.INGREDIENT_NAME),
      relatedItemSeq: nullableString(optionalField(item, "MIXTURE_ITEM_SEQ")),
      relatedItemName: nullableString(optionalField(item, "MIXTURE_ITEM_NAME")),
      relatedIngredientName: nullableString(optionalField(item, "MIXTURE_INGREDIENT_NAME")),
      typeName: nullableString(item.DUR_TYPE_NAME ?? item.TYPE_NAME),
      cautionText: nullableString(item.PROHBT_CONTENT ?? item.REMARK),
      threshold: nullableString(
        optionalField(item, "SPECIFIC_AGE") ??
          optionalField(item, "MAX_QTY") ??
          optionalField(item, "MAX_DAYS") ??
          optionalField(item, "GRADE"),
      ),
    })),
  };
}

export interface DurClient {
  search(operation: DurOperation, input: DurSearch): Promise<MfdsPage<DurItem>>;
  getAllForItem(itemSeq: string): Promise<DurItemResult>;
}

export function createDurClient(options: MfdsTransportOptions): DurClient {
  const transport = createMfdsTransport(options);

  async function search(operation: DurOperation, input: DurSearch): Promise<MfdsPage<DurItem>> {
    const query = DurSearchSchema.parse(input);
    const params: Record<string, string> = {
      pageNo: String(query.pageNo),
      numOfRows: String(query.numOfRows),
      type: "json",
    };
    if (query.itemSeq) params["itemSeq"] = query.itemSeq;
    if (query.itemName) params["itemName"] = query.itemName;
    if (query.ingredientName) params["ingrName"] = query.ingredientName;
    if (query.typeName) params["typeName"] = query.typeName;

    return transport.request({
      apiKind: "DUR",
      endpointPath: `/1471000/DURPrdlstInfoService03/${DUR_ENDPOINTS[operation]}`,
      params,
      errorPrefix: `MFDS_DUR_${operation}`,
      parse: (value) => parseDurResponse(operation, value),
    });
  }

  return {
    search,
    async getAllForItem(itemSeq) {
      const settled = await Promise.allSettled(
        DUR_OPERATIONS.map((operation) =>
          search(operation, { itemSeq, numOfRows: DUR_ITEMS_PER_OPERATION }),
        ),
      );
      const operations = Object.fromEntries(
        DUR_OPERATIONS.map((operation, index) => {
          const result = settled[index]!;
          if (result.status === "rejected") {
            return [operation, { status: "UNAVAILABLE", page: null }] as const;
          }
          const page = {
            ...result.value,
            items: result.value.items.slice(0, DUR_ITEMS_PER_OPERATION),
          };
          const status: MfdsAvailability =
            page.totalCount > page.items.length ? "PARTIAL" : "AVAILABLE";
          return [operation, { status, page }] as const;
        }),
      ) as Record<DurOperation, DurOperationResult>;
      const values = Object.values(operations);
      const status: MfdsAvailability = values.every((result) => result.status === "UNAVAILABLE")
        ? "UNAVAILABLE"
        : values.every((result) => result.status === "AVAILABLE")
          ? "AVAILABLE"
          : "PARTIAL";
      return { status, operations };
    },
  };
}

export function createDefaultDurClient(
  cache: MedicationApiCacheRepository = createDefaultMedicationApiCacheRepository(),
): DurClient {
  return createDurClient({ serviceKey: getServerEnv().DATA_GO_SERVICE_KEY, cache });
}
