import { describe, expect, it } from "vitest";

import { loadProductionLiveHomeSummary } from "./live-summary.server";

if (process.env["LIVE_EXTERNAL_API_SMOKE"] === "1") {
  process.loadEnvFile(".env");
}

describe.skipIf(process.env["LIVE_EXTERNAL_API_SMOKE"] !== "1")(
  "public home live providers",
  () => {
    it("combines KMA weather and warning data with the real Supabase shelter count", async () => {
      const summary = await loadProductionLiveHomeSummary();

      expect(summary.availability.weather).toBe("AVAILABLE");
      expect(summary.weather?.source).toMatch(/^KMA_(?:APIHUB_500M|VILLAGE_FCST)$/u);
      expect(Number.isFinite(summary.weather?.feelsLikeC)).toBe(true);
      expect(Number.isFinite(summary.weather?.airTemperatureC)).toBe(true);
      expect(Number.isFinite(summary.weather?.relativeHumidityPct)).toBe(true);
      expect(summary.availability.heatAdvisory).toBe("AVAILABLE");
      expect(summary.heatAdvisory).toMatch(/^(?:NONE|WATCH|WARNING)$/u);
      expect(summary.availability.shelters).toBe("AVAILABLE");
      expect(summary.shelterCount).toBe(950);
    }, 30_000);
  },
);
