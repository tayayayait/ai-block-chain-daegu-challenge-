const DENIAL_STORAGE_KEY = "onjung.geolocation-denied-at";

export const GEOLOCATION_DENIAL_TTL_MS = 24 * 60 * 60 * 1_000;

type StoragePort = Pick<Storage, "getItem" | "setItem">;
type GeolocationPort = Pick<Geolocation, "getCurrentPosition">;

export type CurrentLocationResult =
  | Readonly<{ kind: "SUCCESS"; latitude: number; longitude: number }>
  | Readonly<{ kind: "DENIED" | "RECENTLY_DENIED" | "UNAVAILABLE" }>;

export const shouldOfferGeolocationPrompt = (storage: StoragePort, now = Date.now()): boolean => {
  try {
    const value = storage.getItem(DENIAL_STORAGE_KEY);
    if (value === null) return true;
    const deniedAt = Number(value);
    return !Number.isFinite(deniedAt) || now - deniedAt >= GEOLOCATION_DENIAL_TTL_MS;
  } catch {
    return true;
  }
};

const recordDenial = (storage: StoragePort, deniedAt: number): void => {
  try {
    storage.setItem(DENIAL_STORAGE_KEY, String(deniedAt));
  } catch {
    // The address-search fallback remains available when storage is blocked.
  }
};

const isWgs84Coordinate = (latitude: number, longitude: number): boolean =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= -90 &&
  latitude <= 90 &&
  longitude >= -180 &&
  longitude <= 180;

export const requestCurrentLocation = async (options: {
  geolocation?: GeolocationPort | null;
  storage?: StoragePort;
  now?: () => number;
}): Promise<CurrentLocationResult> => {
  const now = options.now ?? Date.now;
  const storage = options.storage ?? window.localStorage;
  if (!shouldOfferGeolocationPrompt(storage, now())) return { kind: "RECENTLY_DENIED" };

  const geolocation = options.geolocation ?? navigator.geolocation;
  if (!geolocation) return { kind: "UNAVAILABLE" };

  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!isWgs84Coordinate(coords.latitude, coords.longitude)) {
          resolve({ kind: "UNAVAILABLE" });
          return;
        }
        resolve({
          kind: "SUCCESS",
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          recordDenial(storage, now());
          resolve({ kind: "DENIED" });
          return;
        }
        resolve({ kind: "UNAVAILABLE" });
      },
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 5 * 60 * 1_000 },
    );
  });
};
