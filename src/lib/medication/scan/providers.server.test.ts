import { describe, expect, it, vi } from "vitest";

import {
  DUR_OPERATIONS,
  type DurItem,
  type DurItemResult,
  type DurOperation,
  type DurOperationResult,
} from "@/integrations/mfds/dur.server";

import {
  createMedicationCandidateResolver,
  createSelectedMedicationCandidateEnricher,
} from "./providers.server";

const candidateId = "00000000-0000-4000-8000-000000000010";

function durItem(operation: DurOperation, itemSeq = "200000001"): DurItem {
  return {
    operation,
    itemSeq,
    itemName: "라식스정",
    manufacturerName: "테스트제약",
    ingredientName: operation === "PRODUCT" ? "푸로세미드" : null,
    relatedItemSeq: null,
    relatedItemName: null,
    relatedIngredientName: null,
    typeName: operation === "PREGNANCY_CONTRAINDICATION" ? "임부금기" : null,
    cautionText: operation === "PREGNANCY_CONTRAINDICATION" ? "임부 투여 금기" : null,
    threshold: operation === "PREGNANCY_CONTRAINDICATION" ? "1등급" : null,
  };
}

function allDurAvailable(itemSeq = "200000001"): DurItemResult {
  return {
    status: "AVAILABLE" as const,
    operations: Object.fromEntries(
      DUR_OPERATIONS.map((operation) => [
        operation,
        {
          status: "AVAILABLE" as const,
          page: {
            pageNo: 1,
            numOfRows: 10,
            totalCount: 1,
            items: [durItem(operation, itemSeq)],
          },
        },
      ]),
    ) as Record<DurOperation, DurOperationResult>,
  };
}

function easyDrugClient() {
  return {
    search: vi.fn(async () => ({
      pageNo: 1,
      numOfRows: 1,
      totalCount: 1,
      items: [
        {
          itemSeq: "200000001",
          itemName: "라식스정",
          manufacturerName: "테스트제약",
          efficacy: "부종 치료",
          usage: "의사의 지시에 따라 복용",
          warning: null,
          caution: "탈수에 주의",
          interaction: "병용약 확인",
          sideEffects: "어지러움",
          storage: "실온 보관",
          openDate: null,
          updateDate: null,
          productImageUrl: "https://example.test/easy-drug.png",
        },
      ],
    })),
  };
}

describe("Gemini to MFDS medication candidate adapter", () => {
  it("lets a physical-only Gemini item reach pill identification and enriches it with e약은요 plus all DUR data", async () => {
    const easyDrug = easyDrugClient();
    const getAllForItem = vi.fn(async () => allDurAvailable());
    const pillSearch = vi.fn(async () => ({
      pageNo: 1,
      numOfRows: 30,
      totalCount: 1,
      items: [
        {
          itemSeq: "200000001",
          itemName: "라식스정",
          manufacturerName: "테스트제약",
          imprintFront: "LX",
          imprintBack: null,
          shape: "원형",
          colors: ["백색"],
          productImageUrl: "https://example.test/pill.png",
        },
      ],
    }));
    const resolver = createMedicationCandidateResolver({
      candidateIdFactory: () => candidateId,
      pillClient: { search: pillSearch },
      easyDrugClient: easyDrug,
      durClient: {
        search: vi.fn(async () => ({
          pageNo: 1,
          numOfRows: 30,
          totalCount: 1,
          items: [
            {
              operation: "PRODUCT" as const,
              itemSeq: "200000001",
              itemName: "라식스정",
              manufacturerName: "테스트제약",
              ingredientName: "푸로세미드",
              relatedItemSeq: null,
              relatedItemName: null,
              relatedIngredientName: null,
              typeName: null,
              cautionText: null,
              threshold: null,
            },
          ],
        })),
        getAllForItem,
      },
    });

    const candidates = await resolver.resolve({
      imageQuality: "GOOD",
      items: [
        {
          rawText: "LX 백색 원형",
          imprint: "LX",
          shape: "원형",
          color: "백색",
          confidence: 0.9,
        },
      ],
    });

    expect(pillSearch).toHaveBeenCalledWith({ imprint: "LX", shape: "원형", color: "백색" });
    expect(easyDrug.search).toHaveBeenCalledWith({ itemSeq: "200000001", numOfRows: 1 });
    expect(getAllForItem).toHaveBeenCalledWith("200000001");
    expect(candidates).toEqual([
      expect.objectContaining({
        candidateId,
        productName: "라식스정",
        itemSeq: "200000001",
        ingredientName: "푸로세미드",
        heatClass: "이뇨제",
        riskTier: "HIGH",
        source: "AI_AUTO",
        evidenceSource: "GEMINI_MFDS",
        selected: true,
        mfds: expect.objectContaining({
          matchMethod: "PHYSICAL",
          productImageUrl: "https://example.test/pill.png",
          sourceStatus: {
            pillIdentification: "AVAILABLE",
            easyDrug: "AVAILABLE",
            dur: "AVAILABLE",
          },
          easyDrug: expect.objectContaining({
            efficacy: "부종 치료",
            openDate: null,
            updateDate: null,
          }),
          dur: expect.objectContaining({
            PREGNANCY_CONTRAINDICATION: expect.objectContaining({
              status: "AVAILABLE",
              items: [expect.objectContaining({ cautionText: "임부 투여 금기" })],
            }),
          }),
        }),
      }),
    ]);
  });

  it("keeps a safe editable Gemini-only candidate when MFDS has no match", async () => {
    const resolver = createMedicationCandidateResolver({
      candidateIdFactory: () => candidateId,
      pillClient: {
        search: vi.fn(async () => ({ pageNo: 1, numOfRows: 30, totalCount: 0, items: [] })),
      },
      easyDrugClient: { search: vi.fn() },
      durClient: { search: vi.fn(), getAllForItem: vi.fn() },
    });

    const candidates = await resolver.resolve({
      imageQuality: "GOOD",
      items: [{ rawText: "미상정", productName: "미상정", confidence: 0.7 }],
    });

    expect(candidates[0]).toMatchObject({
      productName: "미상정",
      itemSeq: null,
      evidenceSource: "GEMINI_ONLY",
      source: "AI_CONFIRMED",
      selected: true,
      riskTier: "NONE",
      mfds: expect.objectContaining({
        sourceStatus: {
          pillIdentification: "PARTIAL",
          easyDrug: "UNAVAILABLE",
          dur: "UNAVAILABLE",
        },
      }),
    });
  });

  it("keeps the editable Gemini candidate when pill identification is unavailable", async () => {
    const easySearch = vi.fn();
    const getAllForItem = vi.fn();
    const resolver = createMedicationCandidateResolver({
      candidateIdFactory: () => candidateId,
      pillClient: { search: vi.fn(async () => Promise.reject(new Error("private provider body"))) },
      easyDrugClient: { search: easySearch },
      durClient: { search: vi.fn(), getAllForItem },
    });

    const candidates = await resolver.resolve({
      imageQuality: "GOOD",
      items: [{ rawText: "미상정", productName: "미상정", confidence: 0.7 }],
    });

    expect(candidates[0]).toMatchObject({
      productName: "미상정",
      evidenceSource: "GEMINI_ONLY",
      mfds: {
        matchMethod: null,
        productImageUrl: null,
        easyDrug: null,
        dur: null,
        sourceStatus: {
          pillIdentification: "UNAVAILABLE",
          easyDrug: "UNAVAILABLE",
          dur: "UNAVAILABLE",
        },
      },
    });
    expect(easySearch).not.toHaveBeenCalled();
    expect(getAllForItem).not.toHaveBeenCalled();
  });

  it("preserves identified candidates when e약은요 or individual DUR operations are unavailable", async () => {
    const operations = {
      ...allDurAvailable().operations,
      PREGNANCY_CONTRAINDICATION: {
        status: "UNAVAILABLE",
        page: null,
      },
    } satisfies Record<DurOperation, DurOperationResult>;
    const resolver = createMedicationCandidateResolver({
      candidateIdFactory: () => candidateId,
      pillClient: {
        search: vi.fn(async () => ({
          pageNo: 1,
          numOfRows: 30,
          totalCount: 1,
          items: [
            {
              itemSeq: "200000001",
              itemName: "라식스정",
              manufacturerName: "테스트제약",
              imprintFront: "LX",
              imprintBack: null,
              shape: "원형",
              colors: ["백색"],
              productImageUrl: null,
            },
          ],
        })),
      },
      easyDrugClient: {
        search: vi.fn(async () => Promise.reject(new Error("private e-drug diagnostic"))),
      },
      durClient: {
        search: vi.fn(),
        getAllForItem: vi.fn(async () => ({ status: "PARTIAL" as const, operations })),
      },
    });

    const candidates = await resolver.resolve({
      imageQuality: "GOOD",
      items: [{ rawText: "라식스정", productName: "라식스정", confidence: 0.9 }],
    });

    expect(candidates[0]).toMatchObject({
      productName: "라식스정",
      ingredientName: "푸로세미드",
      mfds: {
        sourceStatus: {
          pillIdentification: "AVAILABLE",
          easyDrug: "UNAVAILABLE",
          dur: "PARTIAL",
        },
        easyDrug: null,
        dur: {
          PREGNANCY_CONTRAINDICATION: { status: "UNAVAILABLE", totalCount: null, items: [] },
        },
      },
    });
    expect(JSON.stringify(candidates)).not.toContain("private e-drug diagnostic");
  });

  it("requires user selection for ambiguous pill matches without fanning out detail APIs", async () => {
    const easyDrug = easyDrugClient();
    const getAllForItem = vi.fn(async () => allDurAvailable());
    const pillSearch = vi.fn(async () => ({
      pageNo: 1,
      numOfRows: 30,
      totalCount: 2,
      items: [
        {
          itemSeq: "200000001",
          itemName: "라식스정",
          manufacturerName: "테스트제약",
          imprintFront: "LX",
          imprintBack: null,
          shape: "원형",
          colors: ["백색"],
          productImageUrl: null,
        },
        {
          itemSeq: "200000002",
          itemName: "라식스정",
          manufacturerName: "다른제약",
          imprintFront: "LX2",
          imprintBack: null,
          shape: "원형",
          colors: ["백색"],
          productImageUrl: null,
        },
      ],
    }));
    const resolver = createMedicationCandidateResolver({
      candidateIdFactory: () => candidateId,
      pillClient: { search: pillSearch },
      easyDrugClient: easyDrug,
      durClient: { search: vi.fn(), getAllForItem },
    });

    const candidates = await resolver.resolve({
      imageQuality: "GOOD",
      items: [
        { rawText: "라식스정", productName: "라식스정", confidence: 0.95 },
        { rawText: "라식스정", productName: "라식스정", confidence: 0.95 },
      ],
    });

    expect(candidates).toHaveLength(2);
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "AI_CONFIRMED", selected: false }),
      ]),
    );
    expect(easyDrug.search).not.toHaveBeenCalled();
    expect(getAllForItem).not.toHaveBeenCalled();
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mfds: expect.objectContaining({
            sourceStatus: {
              pillIdentification: "AVAILABLE",
              easyDrug: "PARTIAL",
              dur: "PARTIAL",
            },
            easyDrug: null,
            dur: null,
          }),
        }),
      ]),
    );
  });

  it("caps one scan to five pill lookups and three full e약은요/DUR enrichments", async () => {
    let pillCall = 0;
    let idCall = 0;
    const pillSearch = vi.fn(async (input: { itemName?: string }) => {
      pillCall += 1;
      const itemSeq = String(200000000 + pillCall);
      return {
        pageNo: 1,
        numOfRows: 30,
        totalCount: 1,
        items: [
          {
            itemSeq,
            itemName: input.itemName ?? `실제후보${pillCall}`,
            manufacturerName: "테스트제약",
            imprintFront: null,
            imprintBack: null,
            shape: "원형",
            colors: ["백색"],
            productImageUrl: null,
          },
        ],
      };
    });
    const easySearch = vi.fn(async ({ itemSeq }: { itemSeq: string }) => ({
      pageNo: 1,
      numOfRows: 1,
      totalCount: 0,
      items: [],
      itemSeq,
    }));
    const getAllForItem = vi.fn(async (itemSeq: string) => allDurAvailable(itemSeq));
    const resolver = createMedicationCandidateResolver({
      candidateIdFactory: () => {
        idCall += 1;
        return `00000000-0000-4000-8000-${String(idCall).padStart(12, "0")}`;
      },
      pillClient: { search: pillSearch },
      easyDrugClient: { search: easySearch },
      durClient: { search: vi.fn(), getAllForItem },
    });

    const candidates = await resolver.resolve({
      imageQuality: "GOOD",
      items: Array.from({ length: 8 }, (_, index) => ({
        rawText: `후보 ${index + 1}`,
        productName: `후보 ${index + 1}`,
        confidence: 0.9,
      })),
    });

    expect(candidates).toHaveLength(8);
    expect(pillSearch).toHaveBeenCalledTimes(5);
    expect(easySearch).toHaveBeenCalledTimes(3);
    expect(getAllForItem).toHaveBeenCalledTimes(3);
  });

  it("returns editable fallbacks when the request-wide provider deadline is exhausted", async () => {
    vi.useFakeTimers();
    try {
      const pillSearch = vi.fn(() => new Promise<never>(() => undefined));
      const resolver = createMedicationCandidateResolver({
        candidateIdFactory: () => candidateId,
        pillClient: { search: pillSearch },
        easyDrugClient: { search: vi.fn() },
        durClient: { search: vi.fn(), getAllForItem: vi.fn() },
        resolutionDeadlineMs: 50,
      });

      const pending = resolver.resolve({
        imageQuality: "GOOD",
        items: [
          { rawText: "첫 후보", productName: "첫 후보", confidence: 0.9 },
          { rawText: "둘째 후보", productName: "둘째 후보", confidence: 0.8 },
        ],
      });
      await vi.advanceTimersByTimeAsync(50);

      await expect(pending).resolves.toEqual([
        expect.objectContaining({ productName: "첫 후보", evidenceSource: "GEMINI_ONLY" }),
        expect.objectContaining({ productName: "둘째 후보", evidenceSource: "GEMINI_ONLY" }),
      ]);
      expect(pillSearch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("selected medication MFDS enrichment", () => {
  const manualCandidate = {
    candidateId,
    productName: "사용자 입력 라식스정",
    itemSeq: "200000001",
    manufacturerName: null,
    ingredientName: null,
    heatClass: null,
    riskTier: "NONE" as const,
    confidence: null,
    source: "MANUAL" as const,
    evidenceSource: "MANUAL" as const,
    selected: true,
  };

  it("uses the explicitly reviewed item code to enrich exactly one candidate", async () => {
    const easyDrug = easyDrugClient();
    const getAllForItem = vi.fn(async () => allDurAvailable());
    const pillSearch = vi.fn(async () => ({
      pageNo: 1,
      numOfRows: 30,
      totalCount: 1,
      items: [
        {
          itemSeq: "200000001",
          itemName: "라식스정",
          manufacturerName: "테스트제약",
          imprintFront: "LX",
          imprintBack: null,
          shape: "원형",
          colors: ["백색"],
          productImageUrl: "https://example.test/pill.png",
        },
      ],
    }));
    const enricher = createSelectedMedicationCandidateEnricher({
      pillClient: { search: pillSearch },
      easyDrugClient: easyDrug,
      durClient: { search: vi.fn(), getAllForItem },
    });

    const result = await enricher.enrich({
      candidate: manualCandidate,
      productName: "사용자가 수정한 이름",
      itemSeq: "200000001",
      ingredientName: "",
    });

    expect(pillSearch).toHaveBeenCalledTimes(1);
    expect(pillSearch).toHaveBeenCalledWith({ itemSeq: "200000001" });
    expect(easyDrug.search).toHaveBeenCalledTimes(1);
    expect(getAllForItem).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      outcome: "ENRICHED",
      candidate: {
        candidateId,
        productName: "라식스정",
        itemSeq: "200000001",
        ingredientName: "푸로세미드",
        heatClass: "이뇨제",
        riskTier: "HIGH",
        source: "MANUAL",
        evidenceSource: "MANUAL",
        selected: true,
        mfds: {
          matchMethod: "ITEM_SEQ",
          sourceStatus: {
            pillIdentification: "AVAILABLE",
            easyDrug: "AVAILABLE",
            dur: "AVAILABLE",
          },
        },
      },
    });
  });

  it("does not choose an arbitrary product or fan out details when a name is ambiguous", async () => {
    const getAllForItem = vi.fn();
    const easySearch = vi.fn();
    const enricher = createSelectedMedicationCandidateEnricher({
      pillClient: {
        search: vi.fn(async () => ({
          pageNo: 1,
          numOfRows: 30,
          totalCount: 2,
          items: [
            { ...manualCandidate, itemName: "라식스정", itemSeq: "200000001", colors: [] },
            { ...manualCandidate, itemName: "라식스정", itemSeq: "200000002", colors: [] },
          ].map((item) => ({
            itemSeq: item.itemSeq,
            itemName: item.itemName,
            manufacturerName: null,
            imprintFront: null,
            imprintBack: null,
            shape: null,
            colors: item.colors,
            productImageUrl: null,
          })),
        })),
      },
      easyDrugClient: { search: easySearch },
      durClient: { search: vi.fn(), getAllForItem },
    });

    const result = await enricher.enrich({
      candidate: { ...manualCandidate, itemSeq: null },
      productName: "라식스정",
      itemSeq: "",
      ingredientName: "",
    });

    expect(result).toMatchObject({
      outcome: "SELECTION_REQUIRED",
      candidate: {
        candidateId,
        productName: "라식스정",
        itemSeq: null,
        mfds: {
          sourceStatus: {
            pillIdentification: "PARTIAL",
            easyDrug: "UNAVAILABLE",
            dur: "UNAVAILABLE",
          },
        },
      },
    });
    expect(easySearch).not.toHaveBeenCalled();
    expect(getAllForItem).not.toHaveBeenCalled();
  });

  it("returns a partial editable candidate when the single-candidate deadline expires", async () => {
    vi.useFakeTimers();
    try {
      const enricher = createSelectedMedicationCandidateEnricher({
        pillClient: {
          search: vi.fn(async () => ({
            pageNo: 1,
            numOfRows: 30,
            totalCount: 1,
            items: [
              {
                itemSeq: "200000001",
                itemName: "라식스정",
                manufacturerName: "테스트제약",
                imprintFront: null,
                imprintBack: null,
                shape: null,
                colors: [],
                productImageUrl: null,
              },
            ],
          })),
        },
        easyDrugClient: {
          search: vi.fn((): Promise<never> => new Promise<never>(() => undefined)),
        },
        durClient: {
          search: vi.fn(),
          getAllForItem: vi.fn((): Promise<never> => new Promise<never>(() => undefined)),
        },
        resolutionDeadlineMs: 50,
      });

      const pending = enricher.enrich({
        candidate: manualCandidate,
        productName: "라식스정",
        itemSeq: "200000001",
        ingredientName: "",
      });
      await vi.advanceTimersByTimeAsync(50);

      await expect(pending).resolves.toMatchObject({
        outcome: "SOURCE_UNAVAILABLE",
        candidate: {
          productName: "라식스정",
          itemSeq: "200000001",
          mfds: {
            sourceStatus: {
              pillIdentification: "AVAILABLE",
              easyDrug: "PARTIAL",
              dur: "PARTIAL",
            },
          },
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
