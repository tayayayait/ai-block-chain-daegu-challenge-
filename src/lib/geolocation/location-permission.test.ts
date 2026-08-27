import { describe, expect, it, vi } from "vitest";

import {
  GEOLOCATION_DENIAL_TTL_MS,
  requestCurrentLocation,
  shouldOfferGeolocationPrompt,
} from "./location-permission";

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
};

describe("progressive geolocation permission", () => {
  it("does not call the browser API until the explicit request function runs", () => {
    const getCurrentPosition = vi.fn();
    const storage = createStorage();

    expect(shouldOfferGeolocationPrompt(storage, 1_000)).toBe(true);
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("returns WGS84 coordinates after an explicit request", async () => {
    const storage = createStorage();
    const result = await requestCurrentLocation({
      storage,
      now: () => 1_000,
      geolocation: {
        getCurrentPosition: (success) =>
          success({ coords: { latitude: 35.87, longitude: 128.6 } } as GeolocationPosition),
      },
    });

    expect(result).toEqual({ kind: "SUCCESS", latitude: 35.87, longitude: 128.6 });
  });

  it("records denial and suppresses another prompt for 24 hours", async () => {
    const storage = createStorage();
    const deniedAt = 10_000;
    const geolocation = {
      getCurrentPosition: (
        _success: PositionCallback,
        error: PositionErrorCallback | null | undefined,
      ) =>
        error?.({ code: 1, message: "denied", PERMISSION_DENIED: 1 } as GeolocationPositionError),
    };

    await expect(
      requestCurrentLocation({ storage, geolocation, now: () => deniedAt }),
    ).resolves.toEqual({ kind: "DENIED" });
    expect(shouldOfferGeolocationPrompt(storage, deniedAt + GEOLOCATION_DENIAL_TTL_MS - 1)).toBe(
      false,
    );
    expect(shouldOfferGeolocationPrompt(storage, deniedAt + GEOLOCATION_DENIAL_TTL_MS)).toBe(true);
  });

  it("fails open when storage is unavailable and validates provider coordinates", async () => {
    const storage = {
      getItem: () => {
        throw new Error("privacy mode");
      },
      setItem: () => {
        throw new Error("privacy mode");
      },
    };
    const result = await requestCurrentLocation({
      storage,
      geolocation: {
        getCurrentPosition: (success) =>
          success({ coords: { latitude: 999, longitude: 999 } } as GeolocationPosition),
      },
    });

    expect(shouldOfferGeolocationPrompt(storage, 0)).toBe(true);
    expect(result).toEqual({ kind: "UNAVAILABLE" });
  });
});
