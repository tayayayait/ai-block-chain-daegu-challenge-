import { z } from "zod";

export const DAEGU_GU = [
  "중구",
  "동구",
  "서구",
  "남구",
  "북구",
  "수성구",
  "달서구",
  "달성군",
] as const;

export const SHELTER_RADII_M = [500, 1_000, 3_000] as const;
export const SHELTER_SEARCH_LIMIT_MAX = 100;
export const DEFAULT_PUBLIC_SHELTER_ORIGIN = Object.freeze({
  lat: 35.8714,
  lng: 128.6014,
});

export type ShelterOriginSource =
  "DAEGU_CENTER" | "SELECTED_LOCATION" | "SUBJECT_LOCATION" | "ALERT_SUBJECT_LOCATION";

const numberFromQuery = (schema: z.ZodNumber) =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value;
    if (value.trim() === "") return value;
    return Number(value);
  }, schema);

const radiusFromQuery = z.preprocess(
  (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : value),
  z.union([z.literal(500), z.literal(1_000), z.literal(3_000)]),
);

const booleanFromQuery = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

const optionalGu = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.enum(DAEGU_GU).optional(),
);

export const ShelterSearchQuerySchema = z
  .object({
    lat: numberFromQuery(z.number().finite().min(-90).max(90)).default(
      DEFAULT_PUBLIC_SHELTER_ORIGIN.lat,
    ),
    lng: numberFromQuery(z.number().finite().min(-180).max(180)).default(
      DEFAULT_PUBLIC_SHELTER_ORIGIN.lng,
    ),
    radius: radiusFromQuery.default(500),
    gu: optionalGu,
    imBank: booleanFromQuery.default(false),
    open: z.enum(["ALL", "OPEN", "CLOSED", "UNKNOWN"]).default("ALL"),
    sort: z.enum(["priority", "distance"]).default("priority"),
    limit: numberFromQuery(z.number().int().min(1).max(SHELTER_SEARCH_LIMIT_MAX)).default(50),
  })
  .strict();

export type ShelterSearchQuery = z.infer<typeof ShelterSearchQuerySchema>;

export function inferPublicShelterOriginSource(
  origin: Readonly<Pick<ShelterSearchQuery, "lat" | "lng">>,
): Extract<ShelterOriginSource, "DAEGU_CENTER" | "SELECTED_LOCATION"> {
  return origin.lat === DEFAULT_PUBLIC_SHELTER_ORIGIN.lat &&
    origin.lng === DEFAULT_PUBLIC_SHELTER_ORIGIN.lng
    ? "DAEGU_CENTER"
    : "SELECTED_LOCATION";
}

type SearchParamSource = URLSearchParams | Readonly<Record<string, unknown>>;

export function parseShelterSearchParams(source: SearchParamSource): ShelterSearchQuery {
  const input =
    source instanceof URLSearchParams ? Object.fromEntries(source.entries()) : { ...source };
  return ShelterSearchQuerySchema.parse(input);
}

export function serializeShelterSearchParams(query: ShelterSearchQuery): URLSearchParams {
  const parsed = ShelterSearchQuerySchema.parse(query);
  const params = new URLSearchParams({
    lat: String(parsed.lat),
    lng: String(parsed.lng),
    radius: String(parsed.radius),
    imBank: String(parsed.imBank),
    open: parsed.open,
    sort: parsed.sort,
    limit: String(parsed.limit),
  });
  if (parsed.gu !== undefined) params.set("gu", parsed.gu);
  return params;
}
