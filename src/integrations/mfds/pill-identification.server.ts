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
import type { PillIdentificationItem } from "./matching";
import { createMfdsTransport, type MfdsTransportOptions } from "./transport.server";

const ENDPOINT = "/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03";

const PillIdentificationProviderItemSchema = z.object({
  ITEM_SEQ: z.preprocess(
    (value) => (typeof value === "number" ? String(value) : value),
    z.string().trim().min(1),
  ),
  ITEM_NAME: z.string().trim().min(1),
  ENTP_NAME: OptionalProviderStringSchema,
  PRINT_FRONT: OptionalProviderStringSchema,
  PRINT_BACK: OptionalProviderStringSchema,
  DRUG_SHAPE: OptionalProviderStringSchema,
  COLOR_CLASS1: OptionalProviderStringSchema,
  COLOR_CLASS2: OptionalProviderStringSchema,
  ITEM_IMAGE: OptionalProviderStringSchema,
});

const PillSearchSchema = z
  .object({
    itemName: z.string().trim().min(1).max(200).optional(),
    itemSeq: z
      .string()
      .trim()
      .regex(/^\d{1,20}$/)
      .optional(),
    imprint: z.string().trim().min(1).max(80).optional(),
    shape: z.string().trim().min(1).max(40).optional(),
    color: z.string().trim().min(1).max(40).optional(),
    pageNo: z.number().int().positive().default(1),
    numOfRows: z.number().int().positive().max(100).default(30),
  })
  .refine(
    (value) =>
      Boolean(value.itemName || value.itemSeq || (value.imprint && value.shape && value.color)),
    "PILL_QUERY_REQUIRED",
  );

export type PillIdentificationSearch = z.input<typeof PillSearchSchema>;

export function parsePillIdentificationResponse(value: unknown): MfdsPage<PillIdentificationItem> {
  const page = parseMfdsPage({
    value,
    itemSchema: PillIdentificationProviderItemSchema,
    invalidCode: "MFDS_PILL_IDENTIFICATION_INVALID_RESPONSE",
  });
  return {
    ...page,
    items: page.items.map((item) => ({
      itemSeq: item.ITEM_SEQ,
      itemName: item.ITEM_NAME,
      manufacturerName: nullableString(item.ENTP_NAME),
      imprintFront: nullableString(item.PRINT_FRONT),
      imprintBack: nullableString(item.PRINT_BACK),
      shape: nullableString(item.DRUG_SHAPE),
      colors: [item.COLOR_CLASS1, item.COLOR_CLASS2].filter(
        (color): color is string => color !== undefined,
      ),
      productImageUrl: nullableString(item.ITEM_IMAGE),
    })),
  };
}

export interface PillIdentificationClient {
  search(input: PillIdentificationSearch): Promise<MfdsPage<PillIdentificationItem>>;
}

export function createPillIdentificationClient(
  options: MfdsTransportOptions,
): PillIdentificationClient {
  const transport = createMfdsTransport(options);
  return {
    async search(input) {
      const query = PillSearchSchema.parse(input);
      const params: Record<string, string> = {
        pageNo: String(query.pageNo),
        numOfRows: String(query.numOfRows),
        type: "json",
      };
      if (query.itemName) params["item_name"] = query.itemName;
      if (query.itemSeq) params["item_seq"] = query.itemSeq;
      if (query.imprint) params["print"] = query.imprint;
      if (query.shape) params["drug_shape"] = query.shape;
      if (query.color) params["color_class1"] = query.color;

      return transport.request({
        apiKind: "PILL_IDENTIFICATION",
        endpointPath: ENDPOINT,
        params,
        errorPrefix: "MFDS_PILL_IDENTIFICATION",
        parse: parsePillIdentificationResponse,
      });
    },
  };
}

export function createDefaultPillIdentificationClient(
  cache: MedicationApiCacheRepository = createDefaultMedicationApiCacheRepository(),
): PillIdentificationClient {
  return createPillIdentificationClient({ serviceKey: getServerEnv().DATA_GO_SERVICE_KEY, cache });
}
