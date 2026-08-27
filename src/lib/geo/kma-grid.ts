export interface KmaGridPoint {
  readonly nx: number;
  readonly ny: number;
}

const EARTH_RADIUS_KM = 6371.00877;
const GRID_SIZE_KM = 5;
const STANDARD_LATITUDE_1 = 30;
const STANDARD_LATITUDE_2 = 60;
const ORIGIN_LONGITUDE = 126;
const ORIGIN_LATITUDE = 38;
const ORIGIN_X = 43;
const ORIGIN_Y = 136;
const DEGREES_TO_RADIANS = Math.PI / 180;

function assertWgs84Coordinate(latitude: number, longitude: number): void {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new TypeError("Invalid WGS84 coordinate");
  }
}

/** Converts WGS84 latitude/longitude degrees to KMA's 5 km DFS Lambert grid. */
export function toKmaGrid(latitude: number, longitude: number): KmaGridPoint {
  assertWgs84Coordinate(latitude, longitude);

  const scaledEarthRadius = EARTH_RADIUS_KM / GRID_SIZE_KM;
  const standardLatitude1 = STANDARD_LATITUDE_1 * DEGREES_TO_RADIANS;
  const standardLatitude2 = STANDARD_LATITUDE_2 * DEGREES_TO_RADIANS;
  const originLongitude = ORIGIN_LONGITUDE * DEGREES_TO_RADIANS;
  const originLatitude = ORIGIN_LATITUDE * DEGREES_TO_RADIANS;

  const latitudeRatio =
    Math.tan(Math.PI / 4 + standardLatitude2 / 2) / Math.tan(Math.PI / 4 + standardLatitude1 / 2);
  const coneConstant =
    Math.log(Math.cos(standardLatitude1) / Math.cos(standardLatitude2)) / Math.log(latitudeRatio);
  const scaleFactor =
    (Math.pow(Math.tan(Math.PI / 4 + standardLatitude1 / 2), coneConstant) *
      Math.cos(standardLatitude1)) /
    coneConstant;
  const originRadius =
    (scaledEarthRadius * scaleFactor) /
    Math.pow(Math.tan(Math.PI / 4 + originLatitude / 2), coneConstant);
  const pointRadius =
    (scaledEarthRadius * scaleFactor) /
    Math.pow(Math.tan(Math.PI / 4 + (latitude * DEGREES_TO_RADIANS) / 2), coneConstant);

  let longitudeDelta = longitude * DEGREES_TO_RADIANS - originLongitude;
  if (longitudeDelta > Math.PI) longitudeDelta -= 2 * Math.PI;
  if (longitudeDelta < -Math.PI) longitudeDelta += 2 * Math.PI;
  const theta = longitudeDelta * coneConstant;

  return {
    nx: Math.floor(pointRadius * Math.sin(theta) + ORIGIN_X + 0.5),
    ny: Math.floor(originRadius - pointRadius * Math.cos(theta) + ORIGIN_Y + 0.5),
  };
}
