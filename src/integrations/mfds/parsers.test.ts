import { describe, expect, it } from "vitest";
import {
  durResponseFixtures,
  easyDrugResponseFixture,
  emptyMfdsResponseFixture,
  pillResponseFixture,
} from "./fixtures/mfds-fixtures";
import { parseDurResponse, DUR_OPERATIONS } from "./dur.server";
import { parseEasyDrugResponse } from "./easy-drug.server";
import { parsePillIdentificationResponse } from "./pill-identification.server";

describe("MFDS response boundaries", () => {
  it("parses and normalizes the pill-identification v03 response", () => {
    const result = parsePillIdentificationResponse(pillResponseFixture);

    expect(result.totalCount).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        itemSeq: "200000001",
        itemName: "온중정10밀리그램",
        manufacturerName: "온중제약",
        imprintFront: "ON",
        imprintBack: "10",
        shape: "원형",
        colors: ["하양"],
      }),
    ]);
  });

  it("parses the e약은요 response documented for getDrbEasyDrugList", () => {
    const result = parseEasyDrugResponse(easyDrugResponseFixture);

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        itemSeq: "200000001",
        itemName: "온중정10밀리그램",
        efficacy: "허가된 효능 정보",
        interaction: "상호작용 정보",
      }),
    );
  });

  it("normalizes the live e약은요 dashed update date to the bounded DTO format", () => {
    const fixture = {
      ...easyDrugResponseFixture,
      body: {
        ...easyDrugResponseFixture.body,
        items: [{ ...easyDrugResponseFixture.body.items[0], updateDe: "2026-08-01" }],
      },
    };

    expect(parseEasyDrugResponse(fixture).items[0]?.updateDate).toBe("20260801");
  });

  it.each(DUR_OPERATIONS)("parses %s through its operation-specific DUR schema", (operation) => {
    const result = parseDurResponse(operation, durResponseFixtures[operation]);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({ operation, itemSeq: "200000001" }));
  });

  it("accepts an official zero-result body", () => {
    expect(parsePillIdentificationResponse(emptyMfdsResponseFixture).items).toEqual([]);
    expect(parseEasyDrugResponse(emptyMfdsResponseFixture).items).toEqual([]);
  });

  it("rejects a provider success body that lacks the official item identifier", () => {
    const invalid = {
      ...pillResponseFixture,
      body: { ...pillResponseFixture.body, items: [{ ITEM_NAME: "식별자 없는 약" }] },
    };

    expect(() => parsePillIdentificationResponse(invalid)).toThrow();
  });

  it("rejects non-success provider result codes without exposing provider text", () => {
    const invalid = {
      header: { resultCode: "30", resultMsg: "SECRET KEY DETAIL" },
      body: emptyMfdsResponseFixture.body,
    };

    expect(() => parseEasyDrugResponse(invalid)).toThrowError("MFDS_PROVIDER_REJECTED");
    expect(() => parseEasyDrugResponse(invalid)).not.toThrowError(/SECRET KEY DETAIL/);
  });
});
