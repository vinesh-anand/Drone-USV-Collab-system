/**
 * Geographic projection utilities for Drone-OS.
 *
 * The mission map uses Web Mercator coordinates, matching the
 * geographic projection approach used by the Omastorm map.
 *
 * Responsibilities:
 * - Latitude/longitude → normalized world coordinates
 * - Normalized world coordinates → latitude/longitude
 * - Geographic distance
 * - Geographic bearing
 * - Destination coordinate calculation
 * - World/screen coordinate conversion
 *
 * This file contains no React code and no map-rendering code.
 */

export interface GeoCoordinate {
  lat: number;
  lon: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface MapViewport {
  width: number;
  height: number;
  center: GeoCoordinate;
  zoom: number;
}

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * Web Mercator latitude limits.
 *
 * Web Mercator approaches infinity near the poles, so geographic
 * map implementations normally clamp latitude to this range.
 */
export const MAX_MERCATOR_LATITUDE = 85.05112878;

export const MIN_MERCATOR_LATITUDE =
  -MAX_MERCATOR_LATITUDE;

/**
 * Mean Earth radius used for geographic calculations.
 *
 * Unit: meters.
 */
export const EARTH_RADIUS_METERS = 6_371_008.8;

/* XYZ tiles in this renderer are 256 CSS pixels per tile. */
export const MAP_TILE_SIZE_PIXELS = 256;

/**
 * Clamp a number to a range.
 */
export function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Normalize longitude to [-180, 180).
 */
export function normalizeLongitude(
  longitude: number,
): number {
  let normalized = longitude;

  while (normalized >= 180) {
    normalized -= 360;
  }

  while (normalized < -180) {
    normalized += 360;
  }

  return normalized;
}

/**
 * Clamp latitude to the valid Web Mercator range.
 */
export function clampLatitude(
  latitude: number,
): number {
  return clamp(
    latitude,
    MIN_MERCATOR_LATITUDE,
    MAX_MERCATOR_LATITUDE,
  );
}

/**
 * Convert latitude/longitude to normalized Web Mercator
 * world coordinates.
 *
 * Result:
 *
 * x = 0   → longitude -180°
 * x = 0.5 → longitude 0°
 * x = 1   → longitude +180°
 *
 * y = 0   → northern Web Mercator limit
 * y = 0.5 → equator
 * y = 1   → southern Web Mercator limit
 */
export function geoToWorld(
  coordinate: GeoCoordinate,
): WorldPoint {
  const longitude = normalizeLongitude(
    coordinate.lon,
  );

  const latitude = clampLatitude(
    coordinate.lat,
  );

  const x = (longitude + 180) / 360;

  const latitudeRadians =
    (latitude * Math.PI) / 180;

  const mercatorY =
    Math.log(
      Math.tan(
        Math.PI / 4 +
          latitudeRadians / 2,
      ),
    );

  const y =
    (1 -
      mercatorY / Math.PI) /
    2;

  return {
    x,
    y,
  };
}

/**
 * Convert normalized Web Mercator world coordinates back
 * into latitude/longitude.
 */
export function worldToGeo(
  point: WorldPoint,
): GeoCoordinate {
  const longitude =
    point.x * 360 - 180;

  const mercatorY =
    Math.PI * (1 - 2 * point.y);

  const latitudeRadians =
    2 *
      Math.atan(
        Math.exp(mercatorY),
      ) -
    Math.PI / 2;

  const latitude =
    (latitudeRadians * 180) /
    Math.PI;

  return {
    lat: clampLatitude(latitude),
    lon: normalizeLongitude(longitude),
  };
}

/**
 * Calculate the world size for a given zoom level.
 *
 * At zoom 0 the entire world is represented by 1 world unit.
 * Each zoom level doubles the map resolution.
 */
export function worldSize(
  zoom: number,
): number {
  return 2 ** zoom;
}

/**
 * Convert normalized world coordinates to pixel coordinates
 * at a given zoom level.
 */
export function worldToPixels(
  point: WorldPoint,
  zoom: number,
): ScreenPoint {
  const size = worldSize(zoom);

  return {
    x: point.x * size,
    y: point.y * size,
  };
}

/**
 * Convert pixel/world coordinates back into normalized
 * Web Mercator coordinates.
 */
export function pixelsToWorld(
  point: ScreenPoint,
  zoom: number,
): WorldPoint {
  const size = worldSize(zoom);

  if (size === 0) {
    return {
      x: 0,
      y: 0,
    };
  }

  return {
    x: point.x / size,
    y: point.y / size,
  };
}

/**
 * Convert a geographic coordinate into a screen coordinate
 * for the supplied map viewport.
 *
 * The viewport center remains fixed in the middle of the map.
 */
export function geoToScreen(
  coordinate: GeoCoordinate,
  viewport: MapViewport,
): ScreenPoint {
  const targetWorld =
    geoToWorld(coordinate);

  const centerWorld =
    geoToWorld(viewport.center);

  const scale =
    worldSize(viewport.zoom) *
    MAP_TILE_SIZE_PIXELS;

  let deltaX =
    (targetWorld.x -
      centerWorld.x) *
    scale;

  const deltaY =
    (targetWorld.y -
      centerWorld.y) *
    scale;

  /**
   * Handle crossing the international date line.
   *
   * Without this adjustment, a point just east of +180°
   * could appear thousands of pixels away from a point just
   * west of -180°.
   */
  if (deltaX > scale / 2) {
    deltaX -= scale;
  } else if (deltaX < -scale / 2) {
    deltaX += scale;
  }

  return {
    x:
      viewport.width / 2 +
      deltaX,
    y:
      viewport.height / 2 +
      deltaY,
  };
}

/**
 * Convert a screen coordinate into a geographic coordinate
 * for the supplied viewport.
 */
export function screenToGeo(
  point: ScreenPoint,
  viewport: MapViewport,
): GeoCoordinate {
  const centerWorld =
    geoToWorld(viewport.center);

  const scale =
    worldSize(viewport.zoom) *
    MAP_TILE_SIZE_PIXELS;

  if (scale === 0) {
    return viewport.center;
  }

  let worldX =
    centerWorld.x +
    (point.x -
      viewport.width / 2) /
      scale;

  const worldY =
    centerWorld.y +
    (point.y -
      viewport.height / 2) /
      scale;

  /**
   * Wrap the world horizontally so map panning can continue
   * across the international date line.
   */
  worldX =
    ((worldX % 1) + 1) % 1;

  const worldPoint: WorldPoint = {
    x: worldX,
    y: worldY,
  };

  return worldToGeo(worldPoint);
}

/**
 * Convert degrees to radians.
 */
export function degreesToRadians(
  degrees: number,
): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Convert radians to degrees.
 */
export function radiansToDegrees(
  radians: number,
): number {
  return (radians * 180) / Math.PI;
}

/**
 * Calculate the great-circle distance between two points.
 *
 * Result is returned in meters.
 */
export function distanceMeters(
  a: GeoCoordinate,
  b: GeoCoordinate,
): number {
  const lat1 =
    degreesToRadians(a.lat);
  const lat2 =
    degreesToRadians(b.lat);

  const deltaLat =
    degreesToRadians(
      b.lat - a.lat,
    );

  const deltaLon =
    degreesToRadians(
      b.lon - a.lon,
    );

  const sinLat =
    Math.sin(deltaLat / 2);

  const sinLon =
    Math.sin(deltaLon / 2);

  const haversine =
    sinLat * sinLat +
    Math.cos(lat1) *
      Math.cos(lat2) *
      sinLon *
      sinLon;

  const angularDistance =
    2 *
    Math.atan2(
      Math.sqrt(haversine),
      Math.sqrt(
        Math.max(
          0,
          1 - haversine,
        ),
      ),
    );

  return (
    EARTH_RADIUS_METERS *
    angularDistance
  );
}

/**
 * Calculate the initial bearing from point A to point B.
 *
 * Result:
 * 0°   = North
 * 90°  = East
 * 180° = South
 * 270° = West
 */
export function bearingDegrees(
  a: GeoCoordinate,
  b: GeoCoordinate,
): number {
  const latitude1 =
    degreesToRadians(a.lat);

  const latitude2 =
    degreesToRadians(b.lat);

  const deltaLongitude =
    degreesToRadians(
      b.lon - a.lon,
    );

  const y =
    Math.sin(deltaLongitude) *
    Math.cos(latitude2);

  const x =
    Math.cos(latitude1) *
      Math.sin(latitude2) -
    Math.sin(latitude1) *
      Math.cos(latitude2) *
      Math.cos(deltaLongitude);

  const bearing =
    radiansToDegrees(
      Math.atan2(y, x),
    );

  return (
    (bearing + 360) %
    360
  );
}

/**
 * Calculate a destination point from a starting coordinate,
 * bearing and distance.
 *
 * Distance is in meters.
 * Bearing is in degrees.
 */
export function destinationPoint(
  start: GeoCoordinate,
  bearing: number,
  distance: number,
): GeoCoordinate {
  const angularDistance =
    distance /
    EARTH_RADIUS_METERS;

  const bearingRadians =
    degreesToRadians(bearing);

  const latitude1 =
    degreesToRadians(start.lat);

  const longitude1 =
    degreesToRadians(start.lon);

  const latitude2 =
    Math.asin(
      Math.sin(latitude1) *
        Math.cos(
          angularDistance,
        ) +
        Math.cos(latitude1) *
          Math.sin(
            angularDistance,
          ) *
          Math.cos(
            bearingRadians,
          ),
    );

  const longitude2 =
    longitude1 +
    Math.atan2(
      Math.sin(
        bearingRadians,
      ) *
        Math.sin(
          angularDistance,
        ) *
        Math.cos(
          latitude1,
        ),
      Math.cos(
        angularDistance,
      ) -
        Math.sin(latitude1) *
          Math.sin(latitude2),
    );

  return {
    lat:
      (latitude2 * 180) /
      Math.PI,
    lon: normalizeLongitude(
      (longitude2 * 180) /
        Math.PI,
    ),
  };
}

/**
 * Calculate the geographic midpoint between two coordinates.
 *
 * This is useful for automatically centering the mission map
 * between Drone and FASTY.
 */
export function midpoint(
  a: GeoCoordinate,
  b: GeoCoordinate,
): GeoCoordinate {
  const latitude1 =
    degreesToRadians(a.lat);

  const longitude1 =
    degreesToRadians(a.lon);

  const latitude2 =
    degreesToRadians(b.lat);

  const deltaLongitude =
    degreesToRadians(
      b.lon - a.lon,
    );

  const x =
    Math.cos(latitude2) *
    Math.cos(deltaLongitude);

  const y =
    Math.cos(latitude2) *
    Math.sin(deltaLongitude);

  const latitude =
    Math.atan2(
      Math.sin(latitude1) +
        Math.sin(latitude2),
      Math.sqrt(
        (Math.cos(latitude1) +
          x) *
          (Math.cos(latitude1) +
            x) +
          y * y,
      ),
    );

  const longitude =
    longitude1 +
    Math.atan2(y, Math.cos(latitude1) + x);

  return {
    lat:
      (latitude * 180) /
      Math.PI,
    lon: normalizeLongitude(
      (longitude * 180) /
        Math.PI,
    ),
  };
}

/**
 * Calculate the geographic bounds containing two coordinates.
 */
export function boundsFromCoordinates(
  coordinates: GeoCoordinate[],
): Bounds | null {
  if (coordinates.length === 0) {
    return null;
  }

  let north = coordinates[0]?.lat ?? 0;
  let south = coordinates[0]?.lat ?? 0;
  let east = coordinates[0]?.lon ?? 0;
  let west = coordinates[0]?.lon ?? 0;

  for (const coordinate of coordinates.slice(1)) {
    north = Math.max(
      north,
      coordinate.lat,
    );

    south = Math.min(
      south,
      coordinate.lat,
    );

    east = Math.max(
      east,
      coordinate.lon,
    );

    west = Math.min(
      west,
      coordinate.lon,
    );
  }

  return {
    north,
    south,
    east,
    west,
  };
}

/**
 * Return the geographic center of bounds.
 */
export function centerOfBounds(
  bounds: Bounds,
): GeoCoordinate {
  return {
    lat:
      (bounds.north +
        bounds.south) /
      2,

    lon: normalizeLongitude(
      (bounds.east +
        bounds.west) /
        2,
    ),
  };
}