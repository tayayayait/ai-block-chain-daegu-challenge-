import { describe, expect, it, vi } from "vitest";
import type { PillIdentificationClient } from "./pill-identification.server";
import { resolvePillIdentificationCandidate } from "./resolver.server";
import type { PillIdentificationItem } from "./matching";

const identified: PillIdentificationItem = {
  itemSeq: "200000001",
  itemName: "온중정 10mg",
  manufacturerName: "온중제약",
  imprintFront: "ON",
  imprintBack: "10",
  shape: "원형",
  colors: ["하양"],
  productImageUrl: null,
};

function page(items: PillIdentificationItem[]) {
  return { pageNo: 1, numOfRows: 30, totalCount: items.length, items };
}

describe("pill-identification resolver", () => {
  it("stops at an exact/normalized product-name match", async () => {
    const search = vi.fn(async () => page([identified]));
    const client: PillIdentificationClient = { search };

    const result = await resolvePillIdentificationCandidate(client, {
      productName: "온중정-10 MG",
      itemSeq: "999999999",
      imprint: "OTHER",
      shape: "타원형",
      color: "노랑",
    });

    expect(result).toMatchObject({ status: "MATCHED", method: "PRODUCT_NAME_NORMALIZED" });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith({ itemName: "온중정-10 MG" });
  });

  it("falls through from a zero-name result to itemSeq", async () => {
    const search = vi
      .fn<PillIdentificationClient["search"]>()
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([identified]));

    const result = await resolvePillIdentificationCandidate(
      { search },
      {
        productName: "OCR 오독",
        itemSeq: "200000001",
      },
    );

    expect(result).toMatchObject({ status: "MATCHED", method: "ITEM_SEQ" });
    expect(search.mock.calls).toEqual([[{ itemName: "OCR 오독" }], [{ itemSeq: "200000001" }]]);
  });

  it("queries imprint+shape+color only after name and itemSeq have no match", async () => {
    const search = vi
      .fn<PillIdentificationClient["search"]>()
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([identified]));

    const result = await resolvePillIdentificationCandidate(
      { search },
      {
        productName: "OCR 오독",
        itemSeq: "999999999",
        imprint: "ON",
        shape: "원형",
        color: "하양",
      },
    );

    expect(result).toMatchObject({ status: "MATCHED", method: "PHYSICAL" });
    expect(search.mock.calls[2]).toEqual([{ imprint: "ON", shape: "원형", color: "하양" }]);
  });

  it("returns an explicit selection state for ambiguous provider candidates", async () => {
    const search = vi.fn(async () =>
      page([identified, { ...identified, itemSeq: "200000002", manufacturerName: "다른제약" }]),
    );

    const result = await resolvePillIdentificationCandidate(
      { search },
      {
        productName: "온중정 10mg",
      },
    );

    expect(result).toMatchObject({ status: "AMBIGUOUS", requiresSelection: true });
    expect(result.candidates).toHaveLength(2);
  });

  it("does not call the provider when there is no complete lookup key", async () => {
    const search = vi.fn<PillIdentificationClient["search"]>();

    const result = await resolvePillIdentificationCandidate({ search }, { imprint: "ON" });

    expect(result).toMatchObject({ status: "NONE", candidates: [] });
    expect(search).not.toHaveBeenCalled();
  });
});
