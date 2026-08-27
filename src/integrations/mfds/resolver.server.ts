import "@tanstack/react-start/server-only";

import {
  matchMedicationCandidate,
  type ExtractedMedicationCandidate,
  type MedicationCandidateMatch,
} from "./matching";
import type { PillIdentificationClient } from "./pill-identification.server";

const NO_MATCH: MedicationCandidateMatch = {
  status: "NONE",
  method: null,
  requiresSelection: false,
  candidates: [],
};

export async function resolvePillIdentificationCandidate(
  client: PillIdentificationClient,
  extracted: ExtractedMedicationCandidate,
): Promise<MedicationCandidateMatch> {
  if (extracted.productName?.trim()) {
    const productName = extracted.productName.trim();
    const page = await client.search({ itemName: productName });
    const match = matchMedicationCandidate({ productName }, page.items);
    if (match.status !== "NONE") return match;
  }

  if (extracted.itemSeq?.trim()) {
    const itemSeq = extracted.itemSeq.trim();
    const page = await client.search({ itemSeq });
    const match = matchMedicationCandidate({ itemSeq }, page.items);
    if (match.status !== "NONE") return match;
  }

  if (extracted.imprint?.trim() && extracted.shape?.trim() && extracted.color?.trim()) {
    const physical = {
      imprint: extracted.imprint.trim(),
      shape: extracted.shape.trim(),
      color: extracted.color.trim(),
    };
    const page = await client.search(physical);
    const match = matchMedicationCandidate(physical, page.items);
    if (match.status !== "NONE") return match;
  }

  return NO_MATCH;
}
