import { fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    activeProps: _activeProps,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    to: string;
    children: ReactNode;
    activeProps?: unknown;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

import { PaperShell, ShadeShell } from "./Shells";

function shell(container: HTMLElement) {
  const element = container.firstElementChild;

  if (!(element instanceof HTMLElement)) {
    throw new Error("PaperShell root was not rendered");
  }

  return element;
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("ShadeShell live weather header", () => {
  it("renders the injected operating snapshot without reading a UI fixture", () => {
    render(
      <ShadeShell
        weather={{
          gu: "수성구",
          feelsLikeC: 39.2,
          advisory: "WARNING",
          observedAt: "2026-08-23T20:30:00+09:00",
          isPartial: false,
          isStale: true,
        }}
      >
        관제 본문
      </ShadeShell>,
    );

    expect(screen.getByText("대구 수성구")).toBeInTheDocument();
    expect(screen.getByText(/체감 39\.2/)).toBeInTheDocument();
    expect(screen.getByText("폭염경보 발효 중")).toBeInTheDocument();
    expect(screen.getByText(/이전 유효값/)).toBeInTheDocument();
  });

  it("shows an honest pending state when no weather snapshot is available", () => {
    render(<ShadeShell weather={null}>관제 본문</ShadeShell>);

    expect(screen.getByText("기상 데이터 준비 중")).toBeInTheDocument();
    expect(screen.getByText("관측 대기")).toBeInTheDocument();
  });
});

describe("PaperShell senior preference priority", () => {
  it("uses an explicit true server profile before a stored false value", () => {
    window.localStorage.setItem("onjung.senior", "0");

    const { container } = render(<PaperShell serverSeniorMode={true}>본문</PaperShell>);

    expect(shell(container)).toHaveClass("senior");
    expect(shell(container)).toHaveAttribute("data-senior", "true");
    expect(screen.getByRole("button", { name: "큰 글씨 모드 켜짐" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("uses an explicit false server profile before a stored true value", () => {
    window.localStorage.setItem("onjung.senior", "1");

    const { container } = render(<PaperShell serverSeniorMode={false}>본문</PaperShell>);

    expect(shell(container)).not.toHaveClass("senior");
    expect(shell(container)).toHaveAttribute("data-senior", "false");
    expect(screen.getByRole("button", { name: "큰 글씨 모드 꺼짐" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("uses localStorage on the first client render when the server value is absent", () => {
    window.localStorage.setItem("onjung.senior", "1");

    const html = renderToString(<PaperShell>본문</PaperShell>);

    expect(html).toContain(" senior");
    expect(html).toContain('data-senior="true"');
    expect(html).toContain('aria-pressed="true"');
  });

  it("falls back to the serializable default for a damaged stored value", () => {
    window.localStorage.setItem("onjung.senior", "not-a-boolean");

    const { container } = render(<PaperShell defaultSeniorMode={true}>본문</PaperShell>);

    expect(shell(container)).toHaveClass("senior");
    expect(shell(container)).toHaveAttribute("data-senior", "true");
  });

  it("falls back safely when localStorage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("storage denied", "SecurityError");
    });

    const { container } = render(<PaperShell defaultSeniorMode={false}>본문</PaperShell>);

    expect(shell(container)).not.toHaveClass("senior");
    expect(shell(container)).toHaveAttribute("data-senior", "false");
  });

  it("synchronizes an explicit server value into localStorage", () => {
    window.localStorage.setItem("onjung.senior", "0");

    render(<PaperShell serverSeniorMode={true}>본문</PaperShell>);

    expect(window.localStorage.getItem("onjung.senior")).toBe("1");
  });
});

describe("PaperShell senior preference interaction and hydration", () => {
  it("keeps the toggle usable when localStorage cannot be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("storage full", "QuotaExceededError");
    });

    const { container } = render(<PaperShell>본문</PaperShell>);
    fireEvent.click(screen.getByRole("button", { name: "큰 글씨 모드 꺼짐" }));

    expect(shell(container)).toHaveClass("senior");
    expect(screen.getByRole("button", { name: "큰 글씨 모드 켜짐" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("serializes a pre-hydration bootstrap before Paper content", () => {
    const { container } = render(<PaperShell>본문</PaperShell>);
    const bootstrap = container.querySelector<HTMLScriptElement>("script[data-senior-bootstrap]");

    expect(bootstrap).not.toBeNull();
    expect(bootstrap?.textContent).toContain("onjung.senior");
    expect(bootstrap?.textContent).toContain("document.currentScript");
    expect(bootstrap?.compareDocumentPosition(screen.getByText("본문"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("senior 모드에서 shell 이동·토글 컨트롤의 최소 탭 크기를 토큰으로 보장한다", () => {
    render(
      <PaperShell serverSeniorMode back="/shelters" backLabel="쉼터로">
        본문
      </PaperShell>,
    );

    expect(screen.getByRole("link", { name: "← 쉼터로" }).style.minHeight).toBe("var(--tap-min)");
    expect(screen.getByRole("button", { name: "큰 글씨 모드 켜짐" }).style.minHeight).toBe(
      "var(--tap-min)",
    );
  });
});
