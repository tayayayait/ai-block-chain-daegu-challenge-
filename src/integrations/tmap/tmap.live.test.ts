import { describe, expect, it } from "vitest";

import { getServerEnv } from "@/lib/env.server";
import { createTmapPedestrianClient } from "./tmap.server";

if (process.env["LIVE_EXTERNAL_API_SMOKE"] === "1") {
  process.loadEnvFile(".env");
}

describe.skipIf(process.env["LIVE_EXTERNAL_API_SMOKE"] !== "1")(
  "TMAP pedestrian route live smoke",
  () => {
    it("returns a real walkable GeoJSON route through the production adapter", async () => {
      const route = await createTmapPedestrianClient({
        appKey: getServerEnv().TMAP_APP_KEY,
      }).route({
        start: [128.6014, 35.8714],
        destination: [128.6062, 35.8726],
        searchOption: "30",
      });

      expect(route.source).toBe("TMAP");
      expect(route.searchOption).toBe("30");
      expect(route.coordinates.length).toBeGreaterThan(1);
      expect(route.distanceM).toBeGreaterThan(0);
      expect(route.elderDurationSec).toBe(Math.ceil(route.distanceM / 0.75));
    }, 30_000);
  },
);
