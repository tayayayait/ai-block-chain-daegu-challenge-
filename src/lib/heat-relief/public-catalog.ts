import { z } from "zod";

const HeatReliefPointSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    type: z.enum(["BENCH", "PAVILION", "SHADE_CANOPY", "PARK_FACILITY"]),
    name: z.string().trim().min(1).max(200),
    district: z.string().trim().min(1).max(40).nullable(),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    detail: z.string().trim().min(1).max(300).nullable(),
    address: z.string().trim().min(1).max(300).nullable(),
    source: z.enum([
      "NATIONAL_STANDARD_CSV",
      "DAEGU_DISTRICT_CSV",
      "SUSEONG_SHADE_API",
      "DONGGU_SMART_SHADE_API",
      "DAEGU_PARK_FACILITY_API",
      "OPENSTREETMAP",
    ]),
    datasetUpdatedAt: z.string().trim().min(1).max(40).nullable(),
    coordinateSource: z.enum(["PROVIDED", "ADDRESS_GEOCODE"]).optional(),
  })
  .strict();

const HeatReliefCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.string().trim().min(1).max(160),
    datasetUpdatedAt: z.string().datetime({ offset: true }),
    summary: z
      .object({
        total: z.number().int().nonnegative(),
        shadeCanopy: z.number().int().nonnegative(),
        bench: z.number().int().nonnegative(),
        pavilion: z.number().int().nonnegative(),
        parkFacility: z.number().int().nonnegative(),
      })
      .strict(),
    sources: z.array(
      z
        .object({
          name: z.string().trim().min(1).max(200),
          url: z.string().url(),
        })
        .strict(),
    ),
    points: z.array(HeatReliefPointSchema),
  })
  .strict()
  .superRefine((catalog, context) => {
    if (catalog.summary.total !== catalog.points.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary", "total"],
        message: "Catalog total must match points length",
      });
    }
  });

export type HeatReliefPointDto = Readonly<z.infer<typeof HeatReliefPointSchema>>;
export type HeatReliefCatalogDto = Readonly<z.infer<typeof HeatReliefCatalogSchema>>;
export type NearbyHeatReliefPointDto = HeatReliefPointDto & Readonly<{ distanceM: number }>;

export function parseHeatReliefCatalog(input: unknown): HeatReliefCatalogDto {
  return HeatReliefCatalogSchema.parse(input);
}

let defaultCatalogRequest: Promise<HeatReliefCatalogDto> | null = null;

export function loadHeatReliefCatalog(
  fetcher: typeof fetch = fetch,
): Promise<HeatReliefCatalogDto> {
  const request = async () => {
    const response = await fetcher("/data/heat-relief/daegu-points.json", {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Heat-relief catalog request failed (${response.status})`);
    return parseHeatReliefCatalog(await response.json());
  };
  if (fetcher !== fetch) return request();
  defaultCatalogRequest ??= request().catch((error: unknown) => {
    defaultCatalogRequest = null;
    throw error;
  });
  return defaultCatalogRequest;
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export type HeatReliefCoordinate = Readonly<{ latitude: number; longitude: number }>;

export function distanceBetweenM(
  origin: HeatReliefCoordinate,
  point: HeatReliefCoordinate,
): number {
  const latitudeDelta = radians(point.latitude - origin.latitude);
  const longitudeDelta = radians(point.longitude - origin.longitude);
  const originLatitude = radians(origin.latitude);
  const pointLatitude = radians(point.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) * Math.cos(pointLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

// A district label from the source is authoritative: a facility tagged with another district never
// belongs to the selected one, and a facility tagged with the selected district belongs to it at
// any distance from the search origin.
function taggedWithOtherDistrict(point: HeatReliefPointDto, district: string | null): boolean {
  return district !== null && point.district !== null && point.district !== district;
}

function taggedWithDistrict(point: HeatReliefPointDto, district: string | null): boolean {
  return district !== null && point.district === district;
}

export function findNearbyHeatReliefPoints(
  points: readonly HeatReliefPointDto[],
  input: Readonly<{
    latitude: number;
    longitude: number;
    radiusM: number;
    limit?: number;
    district?: string | null;
  }>,
): NearbyHeatReliefPointDto[] {
  const limit = input.limit ?? 300;
  const district = input.district ?? null;
  if (
    !Number.isFinite(input.latitude) ||
    !Number.isFinite(input.longitude) ||
    !Number.isFinite(input.radiusM) ||
    input.radiusM < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1
  ) {
    return [];
  }
  return points
    .filter((point) => !taggedWithOtherDistrict(point, district))
    .map((point) => ({ ...point, distanceM: Math.round(distanceBetweenM(input, point)) }))
    .filter((point) => taggedWithDistrict(point, district) || point.distanceM <= input.radiusM)
    .sort(
      (left, right) =>
        left.distanceM - right.distanceM || left.name.localeCompare(right.name, "ko"),
    )
    .slice(0, limit);
}
