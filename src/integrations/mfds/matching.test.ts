import { describe, expect, it } from "vitest";
import { matchMedicationCandidate, type PillIdentificationItem } from "./matching";

const records: PillIdentificationItem[] = [
  {
    itemSeq: "1",
    itemName: "온중정 10mg",
    manufacturerName: "가제약",
    imprintFront: "ON",
    imprintBack: "10",
    shape: "원형",
    colors: ["하양"],
    productImageUrl: null,
  },
  {
    itemSeq: "2",
    itemName: "다른정",
    manufacturerName: "나제약",
    imprintFront: "SAFE",
    imprintBack: null,
    shape: "타원형",
    colors: ["노랑"],
    productImageUrl: null,
  },
];

describe("medication candidate matching", () => {
  it("matches exact product name before every later strategy", () => {
    const result = matchMedicationCandidate(
      { productName: "온중정 10mg", itemSeq: "2", imprint: "SAFE", shape: "타원형", color: "노랑" },
      records,
    );

    expect(result).toMatchObject({ status: "MATCHED", method: "PRODUCT_NAME_EXACT" });
    expect(result.candidates[0]?.itemSeq).toBe("1");
  });

  it("uses normalized product name when exact text differs only in formatting", () => {
    const result = matchMedicationCandidate({ productName: "온중정-10 MG" }, records);

    expect(result).toMatchObject({ status: "MATCHED", method: "PRODUCT_NAME_NORMALIZED" });
  });

  it("falls through to itemSeq and then imprint+shape+color", () => {
    expect(matchMedicationCandidate({ itemSeq: "2" }, records)).toMatchObject({
      status: "MATCHED",
      method: "ITEM_SEQ",
    });
    expect(
      matchMedicationCandidate({ imprint: "safe", shape: "타원형", color: "노랑" }, records),
    ).toMatchObject({ status: "MATCHED", method: "PHYSICAL" });
  });

  it("keeps multiple candidates in an explicit user-selection state", () => {
    const ambiguous = [...records, { ...records[0]!, itemSeq: "3", manufacturerName: "다제약" }];
    const result = matchMedicationCandidate({ productName: "온중정 10mg" }, ambiguous);

    expect(result).toMatchObject({ status: "AMBIGUOUS", requiresSelection: true });
    expect(result.candidates).toHaveLength(2);
  });

  it("returns NONE rather than guessing from partial physical evidence", () => {
    expect(matchMedicationCandidate({ imprint: "ON", shape: "원형" }, records)).toMatchObject({
      status: "NONE",
      candidates: [],
    });
  });
});
