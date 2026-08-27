import { describe, expect, it, vi } from "vitest";

import {
  apiHub500mPointTextFixture,
  apiHubWarningTextFixture,
  vilageForecastJsonFixture,
} from "./fixtures/weather-fixtures";
import { createKmaClient, latestVillageForecastBase } from "./kma.server";

describe("latestVillageForecastBase", () => {
  it("waits ten minutes after a KMA issue slot before selecting it", () => {
    expect(latestVillageForecastBase("2026-08-23T02:09:00+09:00")).toEqual({
      baseDate: "20260822",
      baseTime: "2300",
    });
    expect(latestVillageForecastBase("2026-08-23T02:10:00+09:00")).toEqual({
      baseDate: "20260823",
      baseTime: "0200",
    });
  });
});

describe("createKmaClient", () => {
  it("calls the approved endpoints and parses only normalized provider contracts", async () => {
    const requested: URL[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requested.push(url);

      if (url.pathname.endsWith("/sfc_nc_var.php")) {
        return new Response(apiHub500mPointTextFixture);
      }
      if (url.pathname.endsWith("/wrn_now_data_new.php")) {
        return new Response(apiHubWarningTextFixture);
      }
      return Response.json(vilageForecastJsonFixture);
    });
    const client = createKmaClient({
      apiHubAuthKey: "fixture-kma-key",
      dataGoServiceKey: "fixture-data-go-key==",
      fetcher,
      timeoutMs: 1_000,
    });

    const point = await client.getPointObservations({
      longitude: 128.6035,
      latitude: 35.8685,
      at: "2026-08-23T15:00:00+09:00",
    });
    const warnings = await client.getCurrentHeatWarnings("2026-08-23T15:00:00+09:00");
    const forecast = await client.getVillageForecast({
      nx: 89,
      ny: 90,
      at: "2026-08-23T15:00:00+09:00",
    });

    expect(point.at(-1)?.apparentTemperatureC).toBe(34.6);
    expect(warnings[0]?.level).toBe("WATCH");
    expect(forecast[0]?.grid).toEqual({ nx: 89, ny: 90 });
    expect(requested.map(({ pathname }) => pathname)).toEqual([
      "/api/typ01/url/sfc_nc_var.php",
      "/api/typ01/url/wrn_now_data_new.php",
      "/1360000/VilageFcstInfoService_2.0/getVilageFcst",
    ]);
    expect(requested[0]?.searchParams.get("obs")).toBe("ta_chi,ta,hm");
    expect(requested[1]?.searchParams.get("fe")).toBe("e");
    expect(requested[2]?.searchParams.get("serviceKey")).toBe("fixture-data-go-key==");
  });

  it("never exposes auth keys, full request URLs, or provider bodies in errors", async () => {
    const sentinels = ["SENSITIVE-KMA", "SENSITIVE-DATA-GO", "SENSITIVE-PROVIDER-BODY"];
    const client = createKmaClient({
      apiHubAuthKey: sentinels[0]!,
      dataGoServiceKey: sentinels[1]!,
      fetcher: vi.fn(async () => new Response(sentinels[2], { status: 503 })),
      timeoutMs: 1_000,
    });

    let message = "";
    try {
      await client.getCurrentHeatWarnings("2026-08-23T15:00:00+09:00");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("KMA_APIHUB_HTTP_503");
    for (const sentinel of sentinels) expect(message).not.toContain(sentinel);
    expect(message).not.toContain("https://");
  });

  it.each([429, 503])(
    "retries HTTP %i once and succeeds without exceeding the two-attempt budget",
    async (status) => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(new Response("retryable", { status }))
        .mockResolvedValueOnce(new Response(apiHubWarningTextFixture));
      const client = createKmaClient({
        apiHubAuthKey: "fixture-kma-key",
        dataGoServiceKey: "fixture-data-go-key",
        fetcher,
        timeoutMs: 1_000,
      });

      await expect(
        client.getCurrentHeatWarnings("2026-08-23T15:00:00+09:00"),
      ).resolves.toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it("retries a timeout once, then returns the stable timeout code", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(
        async (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted")));
          }),
      );
      const client = createKmaClient({
        apiHubAuthKey: "fixture-kma-key",
        dataGoServiceKey: "fixture-data-go-key",
        fetcher,
        timeoutMs: 100,
      });
      const request = client.getCurrentHeatWarnings("2026-08-23T15:00:00+09:00");
      const expectation = expect(request).rejects.toMatchObject({
        code: "KMA_APIHUB_TIMEOUT",
        retryable: true,
      });

      await vi.advanceTimersByTimeAsync(30_000);
      await expectation;
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([400, 404])("does not retry permanent HTTP %i responses", async (status) => {
    const fetcher = vi.fn(async () => new Response("permanent", { status }));
    const client = createKmaClient({
      apiHubAuthKey: "fixture-kma-key",
      dataGoServiceKey: "fixture-data-go-key",
      fetcher,
      timeoutMs: 1_000,
    });

    await expect(client.getCurrentHeatWarnings("2026-08-23T15:00:00+09:00")).rejects.toMatchObject({
      retryable: false,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
