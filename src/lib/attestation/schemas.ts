import { z } from "zod";

export type Bytes32Hex = `0x${string}`;
export type EasAttestationUid = Bytes32Hex;
export type EasFieldType = "bytes32" | "uint8" | "uint16" | "uint64" | "string" | "bool";
export type EasFieldValue = string | boolean | number | bigint;

export type EasEncodedField = Readonly<{
  name: string;
  type: EasFieldType;
  value: EasFieldValue;
}>;

const UINT64_MAX = (1n << 64n) - 1n;
const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/iu)
  .transform((value) => value.toLowerCase() as Bytes32Hex);
const uint64Schema = z
  .union([z.bigint(), z.number().int().safe()])
  .transform((value) => (typeof value === "bigint" ? value : BigInt(value)))
  .refine((value) => value >= 0n && value <= UINT64_MAX, "Expected an unsigned 64-bit integer");

export const CARE_EVENT_TYPE = Object.freeze({
  VISIT: 0,
  SHELTER_CHECKIN: 1,
  ALERT_SENT: 2,
} as const);

export const RISK_LEVEL_CODE = Object.freeze({
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
} as const);

export const CARE_EVENT_FIELDS = Object.freeze([
  ["subjectHash", "bytes32"],
  ["eventType", "uint8"],
  ["riskLevel", "uint8"],
  ["hriScore", "uint16"],
  ["occurredAt", "uint64"],
  ["payloadHash", "bytes32"],
] as const satisfies readonly (readonly [string, EasFieldType])[]);

export const CARE_EVENT_SCHEMA =
  "bytes32 subjectHash,uint8 eventType,uint8 riskLevel,uint16 hriScore,uint64 occurredAt,bytes32 payloadHash" as const;

export const CareEventValueSchema = z
  .object({
    subjectHash: bytes32Schema,
    eventType: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    riskLevel: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    hriScore: z.number().int().min(0).max(100),
    occurredAt: uint64Schema,
    payloadHash: bytes32Schema,
  })
  .strict();

export type CareEventValue = Readonly<z.output<typeof CareEventValueSchema>>;

export const SHELTER_STATUS_FIELDS = Object.freeze([
  ["shelterId", "string"],
  ["isOpen", "bool"],
  ["crowdLevel", "uint8"],
  ["observedAt", "uint64"],
  ["reporterHash", "bytes32"],
] as const satisfies readonly (readonly [string, EasFieldType])[]);

export const SHELTER_STATUS_SCHEMA =
  "string shelterId,bool isOpen,uint8 crowdLevel,uint64 observedAt,bytes32 reporterHash" as const;

export const ShelterStatusValueSchema = z
  .object({
    shelterId: z.string().regex(/^DG-\d{4}$/u),
    isOpen: z.boolean(),
    crowdLevel: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    observedAt: uint64Schema,
    reporterHash: bytes32Schema,
  })
  .strict();

export type ShelterStatusValue = Readonly<z.output<typeof ShelterStatusValueSchema>>;

function encodeFields(
  parsed: Readonly<Record<string, EasFieldValue>>,
  fields: readonly (readonly [string, EasFieldType])[],
): readonly EasEncodedField[] {
  return Object.freeze(
    fields.map(([name, type]) =>
      Object.freeze({ name, type, value: parsed[name] as EasFieldValue }),
    ),
  );
}

export const CareEventCodec = Object.freeze({
  parse(input: unknown): CareEventValue {
    return Object.freeze(CareEventValueSchema.parse(input));
  },
  safeParse(input: unknown) {
    return CareEventValueSchema.safeParse(input);
  },
  encode(input: unknown): readonly EasEncodedField[] {
    const parsed = CareEventValueSchema.parse(input);
    return encodeFields(parsed, CARE_EVENT_FIELDS);
  },
});

export const ShelterStatusCodec = Object.freeze({
  parse(input: unknown): ShelterStatusValue {
    return Object.freeze(ShelterStatusValueSchema.parse(input));
  },
  safeParse(input: unknown) {
    return ShelterStatusValueSchema.safeParse(input);
  },
  encode(input: unknown): readonly EasEncodedField[] {
    const parsed = ShelterStatusValueSchema.parse(input);
    return encodeFields(parsed, SHELTER_STATUS_FIELDS);
  },
});

export function parseEasUid(value: unknown): EasAttestationUid {
  return bytes32Schema.parse(value);
}
