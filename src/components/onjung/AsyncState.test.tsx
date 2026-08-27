import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createPublicError, type PublicErrorDto } from "@/lib/error-dto";

import {
  AsyncState,
  EmptyState,
  ErrorState,
  PartialDataBanner,
  RefreshingIndicator,
} from "./AsyncState";
import asyncStateSource from "./AsyncState.tsx?raw";

const renderState = (state: Parameters<typeof AsyncState>[0]["state"]) =>
  render(
    <AsyncState
      state={state}
      loadingFallback={<div data-testid="loading">loading</div>}
      emptyFallback={<div data-testid="empty">empty</div>}
      errorFallback={<div data-testid="error">error</div>}
      partialBanner={
        <PartialDataBanner missingSources={["기상"]} lastSuccessfulAtLabel="13:30 KST" />
      }
    >
      <div data-testid="content">content</div>
    </AsyncState>,
  );

describe("AsyncState seven-state contract", () => {
  it.each([
    ["idle", true, false, false, false],
    ["loading", true, false, false, false],
    ["success", false, true, false, false],
    ["empty", false, false, true, false],
    ["error", false, false, false, true],
  ] as const)(
    "%s 상태는 계약된 단일 슬롯만 렌더한다",
    (state, hasLoading, hasContent, hasEmpty, hasError) => {
      renderState(state);

      expect(screen.queryByTestId("loading") !== null).toBe(hasLoading);
      expect(screen.queryByTestId("content") !== null).toBe(hasContent);
      expect(screen.queryByTestId("empty") !== null).toBe(hasEmpty);
      expect(screen.queryByTestId("error") !== null).toBe(hasError);
    },
  );

  it("loading에만 데이터 영역의 busy 상태를 표시한다", () => {
    const loading = renderState("loading");
    expect(screen.getByRole("region", { name: "비동기 데이터 영역" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByTestId("loading").parentElement).toHaveAttribute("aria-hidden", "true");

    loading.unmount();
    renderState("idle");
    expect(screen.getByRole("region", { name: "비동기 데이터 영역" })).not.toHaveAttribute(
      "aria-busy",
    );
  });

  it("refreshing은 기존 DOM을 유지하면서 polite 갱신 표시만 더한다", () => {
    const view = render(
      <AsyncState
        state="success"
        loadingFallback={<div>loading</div>}
        emptyFallback={<div>empty</div>}
        errorFallback={<div>error</div>}
        partialBanner={
          <PartialDataBanner missingSources={["기상"]} lastSuccessfulAtLabel="13:30 KST" />
        }
      >
        <input aria-label="유지할 입력" defaultValue="작성 중" />
      </AsyncState>,
    );
    const inputBefore = screen.getByRole("textbox", { name: "유지할 입력" });

    view.rerender(
      <AsyncState
        state="refreshing"
        loadingFallback={<div>loading</div>}
        emptyFallback={<div>empty</div>}
        errorFallback={<div>error</div>}
        partialBanner={
          <PartialDataBanner missingSources={["기상"]} lastSuccessfulAtLabel="13:30 KST" />
        }
      >
        <input aria-label="유지할 입력" defaultValue="작성 중" />
      </AsyncState>,
    );

    expect(screen.getByRole("textbox", { name: "유지할 입력" })).toBe(inputBefore);
    expect(screen.queryByText("loading")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "데이터 갱신 상태" })).toHaveTextContent("갱신 중…");
  });

  it("partial은 누락 소스와 마지막 정상 시각을 콘텐츠보다 먼저 알린다", () => {
    render(
      <AsyncState
        state="partial"
        loadingFallback={<div>loading</div>}
        emptyFallback={<div>empty</div>}
        errorFallback={<div>error</div>}
        partialBanner={
          <PartialDataBanner
            missingSources={["기상", "쉼터 혼잡도"]}
            lastSuccessfulAtLabel="13:30 KST"
          />
        }
      >
        <div data-testid="content">기존 데이터</div>
      </AsyncState>,
    );

    const banner = screen.getByRole("status", { name: "부분 데이터 안내" });
    const content = screen.getByTestId("content");
    expect(banner).toHaveAttribute("aria-live", "polite");
    expect(banner).toHaveTextContent("기상");
    expect(banner).toHaveTextContent("쉼터 혼잡도");
    expect(banner).toHaveTextContent("13:30 KST");
    expect(banner.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("async state building blocks", () => {
  it("빈 상태와 비재시도 오류의 필수 액션은 null이 아닌 ReactElement로 제한한다", () => {
    expect(asyncStateSource).toMatch(/action:\s*ReactElement;/);
    expect(asyncStateSource).not.toMatch(/action:\s*ReactNode;/);
  });

  it("EmptyState는 제목, 설명, 액션을 모두 제공한다", () => {
    render(
      <EmptyState
        title="등록된 복약 정보가 없습니다"
        description="약봉투를 촬영하면 폭염 위험 약물을 찾아드립니다"
        action={<button type="button">약봉투 촬영</button>}
      />,
    );

    expect(screen.getByRole("heading", { name: "등록된 복약 정보가 없습니다" })).toBeVisible();
    expect(screen.getByText("약봉투를 촬영하면 폭염 위험 약물을 찾아드립니다")).toBeVisible();
    expect(screen.getByRole("button", { name: "약봉투 촬영" })).toBeEnabled();
  });

  it("ErrorState는 안전한 설명과 동작 가능한 재시도를 제공한다", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState error={createPublicError("WEATHER_UNAVAILABLE")} onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "기상 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("ErrorState 재시도 중에는 중복 동작을 막는다", () => {
    render(
      <ErrorState error={createPublicError("NETWORK_UNAVAILABLE")} onRetry={vi.fn()} retrying />,
    );

    expect(screen.getByRole("button", { name: "다시 시도" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "다시 시도" })).toHaveAttribute("aria-busy", "true");
  });

  it("비재시도 오류는 대체 액션만 제공한다", () => {
    render(
      <ErrorState
        error={createPublicError("AI_UNAVAILABLE")}
        action={<button type="button">직접 입력하기</button>}
      />,
    );

    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "직접 입력하기" })).toBeEnabled();
  });

  it("위조된 message, stack, URL, provider body를 렌더하지 않는다", () => {
    const forgedError = {
      ...createPublicError("WEATHER_UNAVAILABLE"),
      userMessage: "RAW_PROVIDER_MESSAGE",
      stack: "RAW_STACK",
      url: "https://example.test?authKey=RAW_KEY",
      providerBody: "RAW_PROVIDER_BODY",
    } as unknown as PublicErrorDto & { retryable: true };

    render(<ErrorState error={forgedError} onRetry={vi.fn()} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    expect(alert).not.toHaveTextContent(
      /RAW_PROVIDER_MESSAGE|RAW_STACK|RAW_KEY|RAW_PROVIDER_BODY|example\.test/,
    );
  });

  it("RefreshingIndicator는 장식 아이콘을 숨기고 polite live region을 쓴다", () => {
    const { container } = render(<RefreshingIndicator />);
    const status = screen.getByRole("status", { name: "데이터 갱신 상태" });

    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
    expect(status).toHaveTextContent("갱신 중…");
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });
});
