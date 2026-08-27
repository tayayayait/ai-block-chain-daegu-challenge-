import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MedicationCandidate } from "@/lib/medication/scan/schema";

const routeState = vi.hoisted(() => ({
  loader: {} as unknown,
  navigate: vi.fn(async () => undefined),
  params: { subjectId: "00000000-0000-4000-8000-000000000001" },
  search: {
    step: "review",
    scan: "00000000-0000-4000-8000-000000000002",
  } as { step: string; scan?: string },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    options,
    useLoaderData: () => routeState.loader,
    useNavigate: () => routeState.navigate,
    useParams: () => routeState.params,
    useSearch: () => routeState.search,
  }),
  redirect: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const chain = {
      handler: () => vi.fn(),
      validator: () => chain,
    };
    return chain;
  },
}));

vi.mock("@/lib/auth/route-access", () => ({
  protectedLocationPath: vi.fn(),
  requireMedicationSubjectRouteAccess: vi.fn(),
}));

vi.mock("@/lib/medication/image-input", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/medication/image-input")>();
  return {
    ...actual,
    preprocessMedicationImage: vi.fn(async (file: File) => ({
      blob: new Blob([await file.arrayBuffer()], { type: "image/jpeg" }),
      mimeType: "image/jpeg" as const,
      size: file.size,
      width: 640,
      height: 480,
    })),
  };
});

vi.mock("@/lib/medication/scan/schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/medication/scan/schema")>();
  return {
    ...actual,
    medicationReviewDefaultValues: (
      input: Parameters<typeof actual.medicationReviewDefaultValues>[0],
    ) => {
      const values = actual.medicationReviewDefaultValues(input);
      return { ...values, medications: [...values.medications].reverse() };
    },
  };
});

import { Route } from "./medication.$subjectId";

afterEach(() => {
  vi.unstubAllGlobals();
});

const emptyOperation = {
  status: "AVAILABLE" as const,
  totalCount: 0,
  items: [],
};

const candidates: readonly MedicationCandidate[] = [
  {
    candidateId: "00000000-0000-4000-8000-000000000010",
    productName: "첫째약",
    itemSeq: null,
    manufacturerName: null,
    ingredientName: null,
    heatClass: null,
    riskTier: "NONE",
    confidence: 0.7,
    source: "AI_CONFIRMED",
    evidenceSource: "GEMINI_ONLY",
    selected: true,
  },
  {
    candidateId: "00000000-0000-4000-8000-000000000020",
    productName: "둘째약",
    itemSeq: "200000001",
    manufacturerName: "대구제약",
    ingredientName: "푸로세미드",
    heatClass: "이뇨제",
    riskTier: "HIGH",
    confidence: 0.94,
    source: "AI_AUTO",
    evidenceSource: "GEMINI_MFDS",
    selected: true,
    mfds: {
      matchMethod: "PHYSICAL",
      productImageUrl: "https://example.test/second-pill.png",
      sourceStatus: {
        pillIdentification: "AVAILABLE",
        easyDrug: "PARTIAL",
        dur: "AVAILABLE",
      },
      easyDrug: {
        itemSeq: "200000001",
        itemName: "둘째약",
        manufacturerName: "대구제약",
        efficacy: "부종과 고혈압 치료에 사용",
        usage: "식약처 허가 용법 문구",
        warning: "투여 전 확인할 경고 문구",
        caution: "사용상의 주의사항 문구",
        interaction: "병용 시 확인할 상호작용 문구",
        sideEffects: "확인된 이상반응 문구",
        storage: "기밀용기에 실온 보관",
        openDate: "20260101",
        updateDate: "20260801",
        productImageUrl: null,
      },
      dur: {
        PRODUCT: {
          status: "AVAILABLE",
          totalCount: 1,
          items: [
            {
              operation: "PRODUCT",
              itemSeq: "200000001",
              itemName: "둘째약",
              manufacturerName: "대구제약",
              ingredientName: "푸로세미드",
              relatedItemSeq: null,
              relatedItemName: null,
              relatedIngredientName: null,
              typeName: null,
              cautionText: "제품 기본 정보는 DUR 주의 유형이 아님",
              threshold: null,
            },
          ],
        },
        COMBINATION_CONTRAINDICATION: {
          status: "AVAILABLE",
          totalCount: 1,
          items: [
            {
              operation: "COMBINATION_CONTRAINDICATION",
              itemSeq: "200000001",
              itemName: "둘째약",
              manufacturerName: "대구제약",
              ingredientName: "푸로세미드",
              relatedItemSeq: "200000002",
              relatedItemName: "함께확인약",
              relatedIngredientName: "테스트성분",
              typeName: "병용금기",
              cautionText: "동시 사용 금기 공개 문구",
              threshold: null,
            },
          ],
        },
        ELDERLY_CAUTION: emptyOperation,
        AGE_CONTRAINDICATION: emptyOperation,
        CAPACITY_CAUTION: emptyOperation,
        DURATION_CAUTION: emptyOperation,
        EFFICACY_DUPLICATION: emptyOperation,
        EXTENDED_RELEASE_SPLIT_CAUTION: emptyOperation,
        PREGNANCY_CONTRAINDICATION: {
          status: "PARTIAL",
          totalCount: 1,
          items: [
            {
              operation: "PREGNANCY_CONTRAINDICATION",
              itemSeq: "200000001",
              itemName: "둘째약",
              manufacturerName: "대구제약",
              ingredientName: "푸로세미드",
              relatedItemSeq: null,
              relatedItemName: null,
              relatedIngredientName: null,
              typeName: "임부금기",
              cautionText: "임부 관련 공개 주의 문구",
              threshold: "1등급",
            },
          ],
        },
      },
    },
  },
];

describe("medication review MFDS evidence", () => {
  it("links real evidence by candidateId and renders only non-empty DUR warning operations", () => {
    routeState.search = {
      step: "review",
      scan: "00000000-0000-4000-8000-000000000002",
    };
    routeState.loader = {
      step: "review",
      requestId: "00000000-0000-4000-8000-000000000003",
      result: {
        kind: "success",
        data: {
          sessionId: "00000000-0000-4000-8000-000000000002",
          status: "REVIEW_REQUIRED",
          candidates,
        },
      },
    };

    const Component = Route.options.component as ComponentType;
    render(<Component />);

    const secondCandidate = screen.getByDisplayValue("둘째약").closest("article");
    expect(secondCandidate).not.toBeNull();
    const evidence = within(secondCandidate!).getByRole("region", {
      name: "둘째약 식약처 확인 자료",
    });

    expect(within(evidence).getByLabelText("낱알식별: 조회됨")).toBeInTheDocument();
    expect(within(evidence).getByLabelText("e약은요: 일부 조회됨")).toBeInTheDocument();
    expect(within(evidence).getByLabelText("DUR: 조회됨")).toBeInTheDocument();
    expect(within(evidence).getByRole("img", { name: "둘째약 제품 이미지" })).toHaveAttribute(
      "src",
      "https://example.test/second-pill.png",
    );

    expect(within(evidence).getByText("부종과 고혈압 치료에 사용")).toBeInTheDocument();
    expect(within(evidence).getByText("식약처 허가 용법 문구")).toBeInTheDocument();
    expect(within(evidence).getByText("투여 전 확인할 경고 문구")).toBeInTheDocument();
    expect(within(evidence).getByText("사용상의 주의사항 문구")).toBeInTheDocument();
    expect(within(evidence).getByText("병용 시 확인할 상호작용 문구")).toBeInTheDocument();
    expect(within(evidence).getByText("확인된 이상반응 문구")).toBeInTheDocument();
    expect(within(evidence).getByText("기밀용기에 실온 보관")).toBeInTheDocument();

    expect(within(evidence).getByText("병용 금기 · 1건")).toBeInTheDocument();
    expect(within(evidence).getByText("임부 금기 · 1건")).toBeInTheDocument();
    expect(within(evidence).queryByText("노인 주의")).not.toBeInTheDocument();
    expect(
      within(evidence).queryByText("제품 기본 정보는 DUR 주의 유형이 아님"),
    ).not.toBeInTheDocument();
  });

  it("seeds safe scan text into the editable manual review field without adding raw payload", async () => {
    const user = userEvent.setup();
    routeState.search = { step: "capture" };
    routeState.loader = { step: "capture" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          ok: true,
          data: {
            kind: "manual",
            userMessage: "판독 문구를 확인해 주세요.",
            safeRawText: "라식스정 40mg",
          },
        }),
      })),
    );

    const Component = Route.options.component as ComponentType;
    const { container } = render(<Component />);
    const image = new File(["pill image"], "pill.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText("앨범에서 선택"), image);

    const productName = await screen.findByRole("textbox", { name: "제품명" });
    expect(productName).toHaveValue("라식스정 40mg");
    expect(container.querySelector('[name="safeRawText"]')).toBeNull();

    await user.clear(productName);
    await user.type(productName, "라식스정 20mg");
    expect(productName).toHaveValue("라식스정 20mg");
  });

  it("enriches the one reviewed candidate and displays the returned real MFDS evidence", async () => {
    const user = userEvent.setup();
    routeState.search = {
      step: "review",
      scan: "00000000-0000-4000-8000-000000000002",
    };
    routeState.loader = {
      step: "review",
      requestId: "00000000-0000-4000-8000-000000000003",
      result: {
        kind: "success",
        data: {
          sessionId: "00000000-0000-4000-8000-000000000002",
          status: "NEEDS_CONFIRMATION",
          candidates,
        },
      },
    };
    const enriched = {
      ...candidates[0],
      productName: "첫째약 식약처 품목",
      itemSeq: "200000009",
      ingredientName: "푸로세미드",
      heatClass: "이뇨제" as const,
      riskTier: "HIGH" as const,
      mfds: {
        matchMethod: "ITEM_SEQ" as const,
        productImageUrl: null,
        sourceStatus: {
          pillIdentification: "AVAILABLE" as const,
          easyDrug: "AVAILABLE" as const,
          dur: "AVAILABLE" as const,
        },
        easyDrug: {
          itemSeq: "200000009",
          itemName: "첫째약 식약처 품목",
          manufacturerName: "실제제약",
          efficacy: "공개 효능 정보",
          usage: null,
          warning: null,
          caution: null,
          interaction: null,
          sideEffects: null,
          storage: null,
          openDate: null,
          updateDate: null,
          productImageUrl: null,
        },
        dur: {
          PRODUCT: emptyOperation,
          COMBINATION_CONTRAINDICATION: emptyOperation,
          ELDERLY_CAUTION: emptyOperation,
          AGE_CONTRAINDICATION: emptyOperation,
          CAPACITY_CAUTION: emptyOperation,
          DURATION_CAUTION: emptyOperation,
          EFFICACY_DUPLICATION: emptyOperation,
          EXTENDED_RELEASE_SPLIT_CAUTION: emptyOperation,
          PREGNANCY_CONTRAINDICATION: emptyOperation,
        },
      },
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body as FormData;
      expect(body.get("operation")).toBe("enrich");
      expect(body.get("candidateId")).toBe(candidates[0]!.candidateId);
      expect(body.get("candidatePayload")).toBeNull();
      return {
        json: async () => ({ ok: true, data: { outcome: "ENRICHED", candidate: enriched } }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const Component = Route.options.component as ComponentType;
    render(<Component />);
    const firstCandidate = screen.getByDisplayValue("첫째약").closest("article");
    expect(firstCandidate).not.toBeNull();
    await user.click(
      within(firstCandidate!).getByRole("button", { name: "식약처 실제 자료 확인" }),
    );

    expect(await screen.findByDisplayValue("첫째약 식약처 품목")).toBeInTheDocument();
    expect(screen.getByDisplayValue("200000009")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "첫째약 식약처 품목 식약처 확인 자료" }),
    ).toBeInTheDocument();
    expect(screen.getByText("공개 효능 정보")).toBeInTheDocument();
    expect(screen.getByText("식약처 자료를 조회해 검토 항목에 반영했습니다.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks stale confirmation and requires a reload after a concurrent review change", async () => {
    const user = userEvent.setup();
    routeState.search = {
      step: "review",
      scan: "00000000-0000-4000-8000-000000000002",
    };
    routeState.loader = {
      step: "review",
      requestId: "00000000-0000-4000-8000-000000000003",
      result: {
        kind: "success",
        data: {
          sessionId: "00000000-0000-4000-8000-000000000002",
          status: "NEEDS_CONFIRMATION",
          candidates,
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => ({ ok: false, code: "REVIEW_CHANGED" }) })),
    );

    const Component = Route.options.component as ComponentType;
    render(<Component />);
    const firstCandidate = screen.getByDisplayValue("첫째약").closest("article");
    await user.click(
      within(firstCandidate!).getByRole("button", { name: "식약처 실제 자료 확인" }),
    );

    expect(
      await screen.findByText(
        "다른 화면에서 검토 내용이 변경되었습니다. 최신 내용을 다시 불러와 확인해 주세요.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "최신 검토 내용 다시 불러오기" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "확정하고 위험도 재계산" })).toBeDisabled();
  });
});
