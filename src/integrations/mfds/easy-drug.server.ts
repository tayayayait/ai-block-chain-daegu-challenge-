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

const ENDPOINT = "/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList";

const EasyDrugProviderItemSchema = z.object({
  entpName: OptionalProviderStringSchema,
  itemName: z.string().trim().min(1),
  itemSeq: z.preprocess(
    (value) => (typeof value === "number" ? String(value) : value),
    z.string().trim().min(1),
  ),
  efcyQesitm: OptionalProviderStringSchema,
  useMethodQesitm: OptionalProviderStringSchema,
  atpnWarnQesitm: OptionalProviderStringSchema,
  atpnQesitm: OptionalProviderStringSchema,
  intrcQesitm: OptionalProviderStringSchema,
  seQesitm: OptionalProviderStringSchema,
  depositMethodQesitm: OptionalProviderStringSchema,
  openDe: OptionalProviderStringSchema,
  updateDe: OptionalProviderStringSchema,
  itemImage: OptionalProviderStringSchema,
});

const EasyDrugSearchSchema = z.object({
  manufacturerName: z.string().trim().min(1).max(200).optional(),
  itemName: z.string().trim().min(1).max(200).optional(),
  itemSeq: z
    .string()
    .trim()
    .regex(/^\d{1,20}$/)
    .optional(),
  efficacy: z.string().trim().min(1).max(200).optional(),
  usage: z.string().trim().min(1).max(200).optional(),
  warning: z.string().trim().min(1).max(200).optional(),
  caution: z.string().trim().min(1).max(200).optional(),
  interaction: z.string().trim().min(1).max(200).optional(),
  sideEffect: z.string().trim().min(1).max(200).optional(),
  storage: z.string().trim().min(1).max(200).optional(),
  openDate: z
    .string()
    .trim()
    .regex(/^\d{8}$/)
    .optional(),
  updateDate: z
    .string()
    .trim()
    .regex(/^\d{8}$/)
    .optional(),
  pageNo: z.number().int().positive().default(1),
  numOfRows: z.number().int().positive().max(100).default(30),
});

export type EasyDrugSearch = z.input<typeof EasyDrugSearchSchema>;

export interface EasyDrugItem {
  itemSeq: string;
  itemName: string;
  manufacturerName: string | null;
  efficacy: string | null;
  usage: string | null;
  warning: string | null;
  caution: string | null;
  interaction: string | null;
  sideEffects: string | null;
  storage: string | null;
  openDate: string | null;
  updateDate: string | null;
  productImageUrl: string | null;
}

function normalizeProviderDate(value: string | undefined): string | null {
  if (!value) return null;
  const compact = /^(\d{4})(\d{2})(\d{2})$/u.exec(value);
  if (compact) return `${compact[1]}${compact[2]}${compact[3]}`;
  const dashed = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  return dashed ? `${dashed[1]}${dashed[2]}${dashed[3]}` : null;
}

export function parseEasyDrugResponse(value: unknown): MfdsPage<EasyDrugItem> {
  const page = parseMfdsPage({
    value,
    itemSchema: EasyDrugProviderItemSchema,
    invalidCode: "MFDS_E_DRUG_INVALID_RESPONSE",
  });
  return {
    ...page,
    items: page.items.map((item) => ({
      itemSeq: item.itemSeq,
      itemName: item.itemName,
      manufacturerName: nullableString(item.entpName),
      efficacy: nullableString(item.efcyQesitm),
      usage: nullableString(item.useMethodQesitm),
      warning: nullableString(item.atpnWarnQesitm),
      caution: nullableString(item.atpnQesitm),
      interaction: nullableString(item.intrcQesitm),
      sideEffects: nullableString(item.seQesitm),
      storage: nullableString(item.depositMethodQesitm),
      openDate: normalizeProviderDate(item.openDe),
      updateDate: normalizeProviderDate(item.updateDe),
      productImageUrl: nullableString(item.itemImage),
    })),
  };
}

export interface EasyDrugClient {
  search(input: EasyDrugSearch): Promise<MfdsPage<EasyDrugItem>>;
}

export function createEasyDrugClient(options: MfdsTransportOptions): EasyDrugClient {
  const transport = createMfdsTransport(options);
  return {
    async search(input) {
      const query = EasyDrugSearchSchema.parse(input);
      const params: Record<string, string> = {
        pageNo: String(query.pageNo),
        numOfRows: String(query.numOfRows),
        type: "json",
      };
      const mappings: ReadonlyArray<[string | undefined, string]> = [
        [query.manufacturerName, "entpName"],
        [query.itemName, "itemName"],
        [query.itemSeq, "itemSeq"],
        [query.efficacy, "efcyQesitm"],
        [query.usage, "useMethodQesitm"],
        [query.warning, "atpnWarnQesitm"],
        [query.caution, "atpnQesitm"],
        [query.interaction, "intrcQesitm"],
        [query.sideEffect, "seQesitm"],
        [query.storage, "depositMethodQesitm"],
        [query.openDate, "openDe"],
        [query.updateDate, "updateDe"],
      ];
      for (const [value, key] of mappings) if (value) params[key] = value;

      return transport.request({
        apiKind: "E_DRUG",
        endpointPath: ENDPOINT,
        params,
        errorPrefix: "MFDS_E_DRUG",
        parse: parseEasyDrugResponse,
      });
    },
  };
}

export function createDefaultEasyDrugClient(
  cache: MedicationApiCacheRepository = createDefaultMedicationApiCacheRepository(),
): EasyDrugClient {
  return createEasyDrugClient({ serviceKey: getServerEnv().DATA_GO_SERVICE_KEY, cache });
}
