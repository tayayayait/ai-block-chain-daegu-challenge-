import { describe, expect, it } from "vitest";

import { getServerEnv } from "@/lib/env.server";
import { createNaverGeocoder } from "./geocode.server";

if (process.env["LIVE_EXTERNAL_API_SMOKE"] === "1") {
  process.loadEnvFile(".env");
}

describe.skipIf(process.env["LIVE_EXTERNAL_API_SMOKE"] !== "1")(
  "NAVER geocoding live smoke",
  () => {
    it("resolves a public Daegu road address through the production adapter", async () => {
      const env = getServerEnv();
      const candidates = await createNaverGeocoder({
        clientId: env.NAVER_MAPS_CLIENT_ID,
        clientSecret: env.NAVER_MAPS_CLIENT_SECRET,
      }).search("대구광역시 중구 국채보상로 670");

      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0]).toMatchObject({ gu: "중구" });
      expect(candidates[0]?.label).toContain("대구광역시");
      expect(candidates[0]?.longitude).toBeGreaterThanOrEqual(124);
      expect(candidates[0]?.longitude).toBeLessThanOrEqual(132);
      expect(candidates[0]?.latitude).toBeGreaterThanOrEqual(33);
      expect(candidates[0]?.latitude).toBeLessThanOrEqual(39);
    }, 30_000);
  },
);
