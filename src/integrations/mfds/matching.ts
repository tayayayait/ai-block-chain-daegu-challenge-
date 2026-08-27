export interface PillIdentificationItem {
  itemSeq: string;
  itemName: string;
  manufacturerName: string | null;
  imprintFront: string | null;
  imprintBack: string | null;
  shape: string | null;
  colors: string[];
  productImageUrl: string | null;
}

export interface ExtractedMedicationCandidate {
  productName?: string;
  itemSeq?: string;
  imprint?: string;
  shape?: string;
  color?: string;
}

export type MedicationMatchMethod =
  "PRODUCT_NAME_EXACT" | "PRODUCT_NAME_NORMALIZED" | "ITEM_SEQ" | "PHYSICAL";

export type MedicationCandidateMatch =
  | {
      status: "MATCHED";
      method: MedicationMatchMethod;
      requiresSelection: false;
      candidates: [PillIdentificationItem];
    }
  | {
      status: "AMBIGUOUS";
      method: MedicationMatchMethod;
      requiresSelection: true;
      candidates: PillIdentificationItem[];
    }
  | {
      status: "NONE";
      method: null;
      requiresSelection: false;
      candidates: [];
    };

function normalizeComparable(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR");
}

export function normalizeProductName(value: string): string {
  return normalizeComparable(value).replace(/[^\p{L}\p{N}]/gu, "");
}

function normalizePhysical(value: string): string {
  return normalizeComparable(value).replace(/[^\p{L}\p{N}]/gu, "");
}

function resultFor(
  method: MedicationMatchMethod,
  candidates: PillIdentificationItem[],
): MedicationCandidateMatch {
  if (candidates.length === 1) {
    return {
      status: "MATCHED",
      method,
      requiresSelection: false,
      candidates: [candidates[0]!],
    };
  }
  return { status: "AMBIGUOUS", method, requiresSelection: true, candidates };
}

export function matchMedicationCandidate(
  extracted: ExtractedMedicationCandidate,
  records: readonly PillIdentificationItem[],
): MedicationCandidateMatch {
  if (extracted.productName?.trim()) {
    const exactName = extracted.productName.normalize("NFKC").trim();
    const exact = records.filter(
      (record) => record.itemName.normalize("NFKC").trim() === exactName,
    );
    if (exact.length > 0) return resultFor("PRODUCT_NAME_EXACT", exact);

    const normalizedName = normalizeProductName(extracted.productName);
    const normalized = records.filter(
      (record) => normalizeProductName(record.itemName) === normalizedName,
    );
    if (normalized.length > 0) return resultFor("PRODUCT_NAME_NORMALIZED", normalized);
  }

  if (extracted.itemSeq?.trim()) {
    const itemSeq = extracted.itemSeq.trim();
    const identified = records.filter((record) => record.itemSeq === itemSeq);
    if (identified.length > 0) return resultFor("ITEM_SEQ", identified);
  }

  if (extracted.imprint?.trim() && extracted.shape?.trim() && extracted.color?.trim()) {
    const imprint = normalizePhysical(extracted.imprint);
    const shape = normalizePhysical(extracted.shape);
    const color = normalizePhysical(extracted.color);
    const physical = records.filter((record) => {
      const front = record.imprintFront ? normalizePhysical(record.imprintFront) : "";
      const back = record.imprintBack ? normalizePhysical(record.imprintBack) : "";
      const imprints = [front, back, `${front}${back}`, `${back}${front}`].filter(Boolean);
      return (
        imprints.includes(imprint) &&
        record.shape !== null &&
        normalizePhysical(record.shape) === shape &&
        record.colors.some((candidate) => normalizePhysical(candidate) === color)
      );
    });
    if (physical.length > 0) return resultFor("PHYSICAL", physical);
  }

  return { status: "NONE", method: null, requiresSelection: false, candidates: [] };
}
