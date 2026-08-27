import "@tanstack/react-start/server-only";

import { z } from "zod";

import type { DepartureComparisonUiDto } from "@/components/routing/route-ui-dto";
import { createDefaultKmaClient, type KmaClient } from "@/integrations/kma/kma.server";
import type { VilageForecastSlot } from "@/integrations/kma/weather";
import { createTmapPedestrianClient } from "@/integrations/tmap/tmap.server";
import { getServerEnv } from "@/lib/env.server";
import { toKmaGrid } from "@/lib/geo/kma-grid";
import {
  buildDepartureSlots,
  calculateDirectSunMinutes,
  selectRecommendedDeparture,
} from "./departure-comparison";
import { forecastForDeparture } from "./departure-forecast";
import { toRoutePlanUiDto } from "./public-plan.server";
import { createSupabaseRoutingRepository } from "./repository.server";
import {
  planShadeRoute,
  type RoutePlanDto,
  type ShadeRouteRequest,
  type TmapPedestrianRoutingClient,
} from "./service.server";

const CoordinateSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
const DeparturePlannerInputSchema = z
  .object({
    start: CoordinateSchema,
    destinationPosition: CoordinateSchema,
    shelterId: z.string().regex(/^DG-\d{4}$/u),
    destination: z
      .object({
        name: z.string().trim().min(1).max(120),
        longitude: z.number().finite().min(-180).max(180),
        latitude: z.number().finite().min(-90).max(90),
      })
      .strict(),
  })
  .strict();

export interface DeparturePlannerDependencies {
  readonly now: () => Date;
  readonly getForecast: (input: {
    readonly nx: number;
    readonly ny: number;
    readonly at: string;
  }) => Promise<readonly VilageForecastSlot[]>;
  readonly planRoute: (input: ShadeRouteRequest) => Promise<RoutePlanDto>;
}

export interface DeparturePlannerInput {
  readonly start: readonly [longitude: number, latitude: number];
  readonly destinationPosition: readonly [longitude: number, latitude: number];
  readonly shelterId: string;
  readonly destination: {
    readonly name: string;
    readonly longitude: number;
    readonly latitude: number;
  };
}

export function createMemoizedTmapClient(
  upstream: TmapPedestrianRoutingClient,
): TmapPedestrianRoutingClient {
  const requests = new Map<string, ReturnType<TmapPedestrianRoutingClient["route"]>>();
  return {
    route(input) {
      const key = JSON.stringify([input.start, input.destination, input.searchOption]);
      const existing = requests.get(key);
      if (existing) return existing;
      const request = upstream.route(input).catch((error: unknown) => {
        requests.delete(key);
        throw error;
      });
      requests.set(key, request);
      return request;
    },
  };
}

function defaultDependencies(): DeparturePlannerDependencies {
  const environment = getServerEnv();
  const repository = createSupabaseRoutingRepository();
  const tmapClient = createMemoizedTmapClient(
    createTmapPedestrianClient({ appKey: environment.TMAP_APP_KEY }),
  );
  const kmaClient: KmaClient = createDefaultKmaClient();
  const now = () => new Date();
  return {
    now,
    getForecast: (input) => kmaClient.getVillageForecast(input),
    planRoute: (input) => planShadeRoute(input, { repository, tmapClient, now }),
  };
}

function selectedCandidate(plan: RoutePlanDto): RoutePlanDto["candidates"][number] {
  if (plan.state === "FAILED" || plan.selectedCandidateId === null) {
    throw new Error("ROUTE_PLAN_UNAVAILABLE");
  }
  const selected = plan.candidates.find(
    (candidate) => candidate.id === plan.selectedCandidateId && !candidate.excluded,
  );
  if (!selected) throw new Error("ROUTE_PLAN_UNAVAILABLE");
  return selected;
}

function shortestEligibleDuration(plan: RoutePlanDto): number {
  const durations = plan.candidates
    .filter((candidate) => !candidate.excluded)
    .map((candidate) => candidate.durationSec);
  if (durations.length === 0) throw new Error("ROUTE_PLAN_UNAVAILABLE");
  return Math.min(...durations);
}

export async function planDepartureComparison(
  rawInput: DeparturePlannerInput,
  providedDependencies?: DeparturePlannerDependencies,
): Promise<DepartureComparisonUiDto> {
  const input = DeparturePlannerInputSchema.parse(rawInput);
  const dependencies = providedDependencies ?? defaultDependencies();
  const baseTime = dependencies.now();
  if (!Number.isFinite(baseTime.getTime())) throw new TypeError("now must return a valid Date");

  const slots = buildDepartureSlots(baseTime);
  const grid = toKmaGrid(input.start[1], input.start[0]);
  const forecastPromise = dependencies
    .getForecast({ ...grid, at: baseTime.toISOString() })
    .catch(() => [] as readonly VilageForecastSlot[]);
  const plansPromise = Promise.all(
    slots.map((slot) =>
      dependencies.planRoute({
        start: input.start,
        destination: input.destinationPosition,
        shelterId: input.shelterId,
        at: slot.departureAt,
      }),
    ),
  );
  const [forecastSlots, plans] = await Promise.all([forecastPromise, plansPromise]);

  const resultSlots = slots.map((slot, index) => {
    const plan = plans[index];
    if (!plan) throw new Error("ROUTE_PLAN_UNAVAILABLE");
    const selected = selectedCandidate(plan);
    const forecast = forecastForDeparture(forecastSlots, slot.departureAt);
    const walkingMinutes = Math.max(1, Math.ceil(selected.durationSec / 60));
    const additionalWalkingMinutes = Math.max(
      0,
      Math.ceil((selected.durationSec - shortestEligibleDuration(plan)) / 60),
    );
    return {
      offsetMinutes: slot.offsetMinutes,
      label: slot.label,
      departureAt: slot.departureAt,
      feelsLikeC: forecast?.feelsLikeC ?? null,
      forecastAt: forecast?.forecastAt ?? null,
      forecastInterpolated: forecast?.interpolated ?? false,
      shadePercent:
        selected.shadeRatio === null ? null : Math.round(Math.max(0, selected.shadeRatio) * 100),
      directSunMinutes: calculateDirectSunMinutes(selected.durationSec, selected.shadeRatio),
      walkingMinutes,
      additionalWalkingMinutes,
      plan: toRoutePlanUiDto(plan, input.destination),
    } as const;
  });
  const recommendedOffsetMinutes = selectRecommendedDeparture(
    resultSlots.map((slot) => ({
      offsetMinutes: slot.offsetMinutes,
      feelsLikeC: slot.feelsLikeC,
      directSunMinutes: slot.directSunMinutes,
      durationMinutes: slot.walkingMinutes,
    })),
  );

  return {
    recommendedOffsetMinutes,
    forecastSource: forecastSlots.length > 0 ? "KMA_VILLAGE_FORECAST" : "UNAVAILABLE",
    slots: resultSlots,
  };
}
