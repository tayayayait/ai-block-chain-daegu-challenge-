import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { isNotFound } from "@tanstack/react-router";

import { assertDevComponentsAccess } from "@/demo/dev-components-access";

const routePath = resolve(process.cwd(), "src/routes/dev.components.tsx");
const source = existsSync(routePath) ? readFileSync(routePath, "utf8") : "";
const galleryPath = resolve(process.cwd(), "src/demo/DevComponentsGallery.tsx");
const nativeResizeObserver = globalThis.ResizeObserver;

class DemoResizeObserver implements ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

beforeAll(() => {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: DemoResizeObserver,
  });
});

afterEach(cleanup);

afterAll(() => {
  if (nativeResizeObserver) {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: nativeResizeObserver,
    });
  } else {
    Reflect.deleteProperty(globalThis, "ResizeObserver");
  }
});

describe("development component gallery route contract", () => {
  it("uses an explicit TanStack beforeLoad guard backed by import.meta.env.DEV", () => {
    expect(source).toContain('createFileRoute("/dev/components")');
    expect(source).toMatch(/beforeLoad\s*:\s*\(\)\s*=>/);
    expect(source).toContain("import.meta.env.DEV");
    expect(source).toContain("assertDevComponentsAccess(import.meta.env.DEV)");
  });

  it("only imports the gallery component through a development-gated lazy boundary", () => {
    expect(source).not.toMatch(/import\s+\{\s*DevComponentsGallery\s*\}\s+from/);
    expect(source).toMatch(/import\.meta\.env\.DEV\s*\?\s*lazyRouteComponent/);
    expect(source).toContain('import("@/demo/DevComponentsGallery")');
    expect(source).toMatch(/\.\.\.\(devRouteComponent\s*\?\s*\{\s*component:/);
  });

  it("allows development mode and becomes TanStack not-found outside development", () => {
    expect(() => assertDevComponentsAccess(true)).not.toThrow();

    let denied: unknown;
    try {
      assertDevComponentsAccess(false);
    } catch (error) {
      denied = error;
    }

    expect(isNotFound(denied)).toBe(true);
  });

  it("renders every common component state in Paper 360px and Shade 1024px previews", async () => {
    expect(existsSync(galleryPath)).toBe(true);
    if (!existsSync(galleryPath)) return;

    const { DevComponentsGallery } = await import("@/demo/DevComponentsGallery");
    render(<DevComponentsGallery />);

    expect(screen.getByTestId("dev-components-gallery")).toBeInTheDocument();
    expect(screen.getByTestId("paper-360-preview")).toHaveAttribute("data-surface", "paper");
    expect(screen.getByTestId("paper-360-preview")).toHaveAttribute("data-viewport-width", "360px");
    expect(screen.getByTestId("shade-1024-preview")).toHaveAttribute("data-surface", "shade");
    expect(screen.getByTestId("shade-1024-preview")).toHaveAttribute(
      "data-viewport-width",
      "1024px",
    );

    for (const componentName of [
      "RiskBadge",
      "Btn",
      "AsyncState",
      "RiskCard",
      "ShelterCard",
      "FormField",
      "Modal",
      "BottomSheet",
      "Toast",
      "DataTable",
      "MapFallbackList",
    ]) {
      expect(
        screen.getAllByTestId(`demo-component-${componentName}`).length,
        `${componentName} demo is missing`,
      ).toBeGreaterThan(0);
    }

    for (const level of ["L0", "L1", "L2", "L3", "L4"]) {
      expect(screen.getAllByTestId(`demo-risk-${level}`).length).toBeGreaterThanOrEqual(2);
    }

    for (const state of ["idle", "loading", "refreshing", "success", "empty", "error", "partial"]) {
      expect(screen.getAllByTestId(`demo-async-${state}`).length).toBeGreaterThanOrEqual(2);
    }

    expect(screen.getAllByTestId("toast-item")).toHaveLength(6);
    expect(screen.getAllByRole("table").length).toBeGreaterThanOrEqual(4);
  }, 15_000);

  it("keeps both dialog surfaces inspectable from keyboard-accessible triggers", async () => {
    expect(existsSync(galleryPath)).toBe(true);
    if (!existsSync(galleryPath)) return;

    const { DevComponentsGallery } = await import("@/demo/DevComponentsGallery");
    const user = userEvent.setup();
    render(<DevComponentsGallery />);

    await user.click(screen.getByRole("button", { name: "Shade 모달 열기" }));
    expect(screen.getByRole("dialog", { name: "Shade 모달" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Shade 모달" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Paper 바텀시트 열기" }));
    expect(screen.getByRole("dialog", { name: "Paper 바텀시트" })).toBeInTheDocument();
  });
});
