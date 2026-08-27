import { beforeEach, describe, expect, it, vi } from "vitest";

import { NaverMapsLoader } from "./maps-loader";

function createReadyMapsWindow() {
  return window as Window & {
    naver?: { maps?: unknown };
    navermap_authFailure?: () => void;
  };
}

describe("NaverMapsLoader", () => {
  beforeEach(() => {
    document.head.querySelectorAll("script[data-onjung-naver-maps]").forEach((script) => {
      script.remove();
    });
    const mapsWindow = createReadyMapsWindow();
    delete mapsWindow.naver;
    delete mapsWindow.navermap_authFailure;
  });

  it("loads Maps v3 with ncpKeyId and deduplicates concurrent calls", async () => {
    const loader = new NaverMapsLoader({ ncpKeyId: "public-client-id", document, window });
    const first = loader.load();
    const second = loader.load();

    const scripts = document.head.querySelectorAll("script[data-onjung-naver-maps]");
    expect(scripts).toHaveLength(1);
    const url = new URL((scripts[0] as HTMLScriptElement).src);
    expect(url.origin + url.pathname).toBe("https://oapi.map.naver.com/openapi/v3/maps.js");
    expect(url.searchParams.get("ncpKeyId")).toBe("public-client-id");

    createReadyMapsWindow().naver = { maps: {} };
    scripts.item(0).dispatchEvent(new Event("load"));

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(loader.getState()).toBe("READY");
  });

  it("surfaces the official global authentication failure callback", async () => {
    const listener = vi.fn();
    const loader = new NaverMapsLoader({ ncpKeyId: "public-client-id", document, window });
    loader.subscribe(listener);
    const pending = loader.load();

    createReadyMapsWindow().navermap_authFailure?.();

    await expect(pending).rejects.toMatchObject({ code: "AUTH_FAILED" });
    expect(loader.getState()).toBe("AUTH_FAILED");
    expect(listener).toHaveBeenCalledWith("AUTH_FAILED");
  });

  it("does not become ready when the script load event follows an authentication failure", async () => {
    const listener = vi.fn();
    const loader = new NaverMapsLoader({ ncpKeyId: "public-client-id", document, window });
    loader.subscribe(listener);
    const pending = loader.load();
    const script = document.head.querySelector("script[data-onjung-naver-maps]");

    createReadyMapsWindow().navermap_authFailure?.();
    createReadyMapsWindow().naver = { maps: {} };
    script?.dispatchEvent(new Event("load"));

    await expect(pending).rejects.toMatchObject({ code: "AUTH_FAILED" });
    expect(loader.getState()).toBe("AUTH_FAILED");
    expect(listener).not.toHaveBeenCalledWith("READY");
  });

  it("moves from ready to authentication failure when the auth response arrives late", async () => {
    const listener = vi.fn();
    const loader = new NaverMapsLoader({ ncpKeyId: "public-client-id", document, window });
    loader.subscribe(listener);
    const pending = loader.load();
    const script = document.head.querySelector("script[data-onjung-naver-maps]");

    createReadyMapsWindow().naver = { maps: {} };
    script?.dispatchEvent(new Event("load"));
    await expect(pending).resolves.toBeUndefined();
    expect(loader.getState()).toBe("READY");

    createReadyMapsWindow().navermap_authFailure?.();

    expect(loader.getState()).toBe("AUTH_FAILED");
    expect(listener).toHaveBeenLastCalledWith("AUTH_FAILED");
    await expect(loader.load()).resolves.toBeUndefined();
    expect(loader.getState()).toBe("AUTH_FAILED");
  });

  it("does not insert a script when the public identifier is missing", async () => {
    const loader = new NaverMapsLoader({ ncpKeyId: "  ", document, window });

    await expect(loader.load()).rejects.toMatchObject({ code: "MISSING_KEY_ID" });
    expect(document.head.querySelector("script[data-onjung-naver-maps]")).toBeNull();
    expect(loader.getState()).toBe("MISSING_KEY_ID");
  });

  it("reports a network load error without exposing the identifier", async () => {
    const loader = new NaverMapsLoader({ ncpKeyId: "do-not-echo", document, window });
    const pending = loader.load();
    const script = document.head.querySelector("script[data-onjung-naver-maps]");

    script?.dispatchEvent(new Event("error"));

    await expect(pending).rejects.toMatchObject({ code: "LOAD_FAILED" });
    await pending.catch((error: unknown) => {
      expect(String(error)).not.toContain("do-not-echo");
    });
    expect(loader.getState()).toBe("LOAD_FAILED");
  });
});
