import { describe, expect, it } from "vitest";

import { createDefaultGeminiMedicationExtractor } from "./gemini.server";

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

if (process.env["LIVE_EXTERNAL_API_SMOKE"] === "1") {
  process.loadEnvFile(".env");
}

describe.skipIf(process.env["LIVE_EXTERNAL_API_SMOKE"] !== "1")(
  "Gemini medication extractor live smoke",
  () => {
    it("accepts the production structured-output schema for an anonymous synthetic image", async () => {
      const result = await createDefaultGeminiMedicationExtractor().extract({
        image: { mimeType: "image/png", data: ONE_PIXEL_PNG },
        previousAttemptCount: 0,
      });

      expect(result.modelId).toBe("gemini-3.5-flash");
      expect(result.status).toMatch(/^(NEEDS_CONFIRMATION|NEEDS_RETAKE)$/u);
    }, 30_000);
  },
);
