import * as SunCalc from "suncalc";

import type { SunState } from "./types";

/**
 * SunCalc consumes an absolute instant, so a Date constructed from a KST
 * timestamp is evaluated at the correct UTC instant without manual offsets.
 */
export function calculateSunState(at: Date, latitude: number, longitude: number): SunState {
  const instant = at.getTime();
  if (
    !Number.isFinite(instant) ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    throw new RangeError("INVALID_SOLAR_POSITION_INPUT");
  }

  const { altitude: altitudeDeg, azimuth: azimuthDeg } = SunCalc.getPosition(
    at,
    latitude,
    longitude,
  );
  if (!Number.isFinite(altitudeDeg) || !Number.isFinite(azimuthDeg)) {
    throw new RangeError("INVALID_SOLAR_POSITION_RESULT");
  }
  if (altitudeDeg <= 0) return { kind: "AFTER_SUNSET" };

  const altitudeRad = (altitudeDeg * Math.PI) / 180;
  const azimuthRad = (azimuthDeg * Math.PI) / 180;

  return {
    kind: "DAYLIGHT",
    altitudeRad,
    azimuthRad,
  };
}

export function shadowLengthMeters(heightM: number, altitudeRad: number): number {
  if (
    !Number.isFinite(heightM) ||
    heightM <= 0 ||
    !Number.isFinite(altitudeRad) ||
    altitudeRad <= 0
  ) {
    throw new RangeError("INVALID_SHADOW_INPUT");
  }
  return heightM / Math.tan(altitudeRad);
}
