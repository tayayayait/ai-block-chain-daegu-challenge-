import { describe, expect, it } from "vitest";

import {
  createDefaultMedicationCandidateResolver,
  createDefaultSelectedMedicationCandidateEnricher,
} from "./providers.server";

if (process.env["LIVE_EXTERNAL_API_SMOKE"] === "1") {
  process.loadEnvFile(".env");
}

describe.skipIf(process.env["LIVE_EXTERNAL_API_SMOKE"] !== "1")(
  "MFDS medication enrichment live smoke",
  () => {
    it("resolves a public medicine through pill identification, e약은요, DUR, and the shared cache", async () => {
      const candidates = await createDefaultMedicationCandidateResolver().resolve({
        imageQuality: "GOOD",
        items: [
          {
            rawText: "타이레놀정500밀리그람(아세트아미노펜)",
            productName: "타이레놀정500밀리그람(아세트아미노펜)",
            confidence: 0.95,
          },
        ],
      });

      const candidate = candidates.find((value) => value.evidenceSource === "GEMINI_MFDS");
      expect(candidate?.itemSeq).toMatch(/^\d{1,20}$/u);
      expect(candidate?.mfds?.sourceStatus.pillIdentification).toBe("AVAILABLE");
      expect(candidate?.mfds?.sourceStatus.easyDrug).toMatch(/^(AVAILABLE|PARTIAL)$/u);
      expect(candidate?.mfds?.sourceStatus.dur).toMatch(/^(AVAILABLE|PARTIAL)$/u);
      expect(candidate?.mfds?.dur).toBeTruthy();

      if (!candidate?.itemSeq) throw new Error("MFDS_LIVE_CANDIDATE_MISSING");
      const selected = await createDefaultSelectedMedicationCandidateEnricher().enrich({
        candidate,
        productName: candidate.productName,
        itemSeq: candidate.itemSeq,
        ingredientName: candidate.ingredientName ?? "",
      });
      expect(selected.outcome).toBe("ENRICHED");
      expect(selected.candidate.candidateId).toBe(candidate.candidateId);
      expect(selected.candidate.mfds?.matchMethod).toBe("ITEM_SEQ");
      expect(selected.candidate.mfds?.dur).toBeTruthy();
    }, 60_000);
  },
);
