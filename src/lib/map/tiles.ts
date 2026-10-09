/**
 * Mission map tile utilities.
 *
 * The renderer does not need to know how tile coordinates work.
 * This module converts geographic/map coordinates into standard
 * XYZ Web Mercator tiles.
 *
 * The implementation follows the same general Web Mercator /
 * tile-grid architecture used by modern lightweight map engines.
 */

import type {
  GeoCoordinate,
  WorldPoint,
} from "./projection";

import {
  clamp,
  geoToWorld,
  worldToGeo,
} from "./projection";

/* -------------------------------------------------------------------------- */
/* Tile configuration                                                         */
/* -------------------------------------------------------------------------- */

export const DEFAULT_TILE_SIZE = 256;

export const DEFAULT_MIN_ZOOM = 0;

export const DEFAULT_MAX_ZOOM = 19;

/**
 * OpenStreetMap raster tile endpoint.
 *
 * Keep the provider isolated here so it can be replaced later
 * without changing MissionMap.tsx.
 */
export const DEFAULT_TILE_URL =
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface TileCoordinate {
  z: number;
  x: number;
  y: number;
}

export interface TileBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface TileProvider {
  id: string;

  name: string;

  urlTemplate: string;

  tileSize: number;

  minZoom: number;

  maxZoom: number;

  attribution: string;
}

export interface TileRange {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface VisibleTile {
  tile: TileCoordinate;

  /**
   * Pixel position where the tile should be rendered.
   */
  pixelX: number;

  pixelY: number;

  /**
   * Tile size in pixels.
   */
  size: number;
}

/* -------------------------------------------------------------------------- */
/* Default provider                                                           */
/* -------------------------------------------------------------------------- */

export const OPEN_STREET_MAP_PROVIDER: TileProvider = {
  id: "osm",

  name: "OpenStreetMap",

  urlTemplate:
    DEFAULT_TILE_URL,

  tileSize:
    DEFAULT_TILE_SIZE,

  minZoom:
    DEFAULT_MIN_ZOOM,

  maxZoom:
    DEFAULT_MAX_ZOOM,

  attribution:
    "© OpenStreetMap contributors",
};

/* -------------------------------------------------------------------------- */
/* Zoom helpers                                                               */
/* -------------------------------------------------------------------------- */

export function clampZoom(
  zoom: number,
  provider: TileProvider =
    OPEN_STREET_MAP_PROVIDER,
): number {
  return clamp(
    zoom,
    provider.minZoom,
    provider.maxZoom,
  );
}

/**
 * Convert a floating-point map zoom into the integer tile
 * zoom used by an XYZ tile provider.
 *
 * The fractional part is handled by the renderer through
 * scaling.
 */
export function tileZoom(
  zoom: number,
  provider: TileProvider =
    OPEN_STREET_MAP_PROVIDER,
): number {
  return Math.floor(
    clampZoom(zoom, provider),
  );
}

/* -------------------------------------------------------------------------- */
/* Coordinate → tile                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Convert a geographic coordinate into an XYZ tile.
 */
export function geoToTile(
  coordinate: GeoCoordinate,
  zoom: number,
): TileCoordinate {
  const safeZoom =
    Math.max(
      0,
      Math.floor(zoom),
    );

  const tilesPerAxis =
    2 ** safeZoom;

  const world =
    geoToWorld(coordinate);

  const x =
    Math.floor(
      world.x *
        tilesPerAxis,
    );

  const y =
    Math.floor(
      world.y *
        tilesPerAxis,
    );

  return {
    z: safeZoom,

    x: wrapTileX(
      x,
      safeZoom,
    ),

    y: clampTileY(
      y,
      safeZoom,
    ),
  };
}

/**
 * Convert a normalized Web Mercator world point into a tile.
 */
export function worldToTile(
  world: WorldPoint,
  zoom: number,
): TileCoordinate {
  const safeZoom =
    Math.max(
      0,
      Math.floor(zoom),
    );

  const tilesPerAxis =
    2 ** safeZoom;

  const x =
    Math.floor(
      world.x *
        tilesPerAxis,
    );

  const y =
    Math.floor(
      world.y *
        tilesPerAxis,
    );

  return {
    z: safeZoom,

    x: wrapTileX(
      x,
      safeZoom,
    ),

    y: clampTileY(
      y,
      safeZoom,
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Tile → coordinate                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Return the geographic coordinate at the top-left corner
 * of a tile.
 */
export function tileToGeo(
  tile: TileCoordinate,
): GeoCoordinate {
  const tilesPerAxis =
    2 ** tile.z;

  const world: WorldPoint = {
    x:
      tile.x /
      tilesPerAxis,

    y:
      tile.y /
      tilesPerAxis,
  };

  return worldToGeo(world);
}

/**
 * Return the geographic bounds of an XYZ tile.
 */
export function tileBounds(
  tile: TileCoordinate,
): TileBounds {
  const tilesPerAxis =
    2 ** tile.z;

  const northWest =
    worldToGeo({
      x:
        tile.x /
        tilesPerAxis,

      y:
        tile.y /
        tilesPerAxis,
    });

  const southEast =
    worldToGeo({
      x:
        (tile.x + 1) /
        tilesPerAxis,

      y:
        (tile.y + 1) /
        tilesPerAxis,
    });

  return {
    north:
      northWest.lat,

    west:
      northWest.lon,

    south:
      southEast.lat,

    east:
      southEast.lon,
  };
}

/* -------------------------------------------------------------------------- */
/* Tile wrapping / clamping                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Wrap an X tile horizontally around the world.
 *
 * This allows continuous east/west panning across the
 * international date line.
 */
export function wrapTileX(
  x: number,
  zoom: number,
): number {
  const count =
    2 ** zoom;

  return (
    ((x % count) + count) %
    count
  );
}

/**
 * Clamp a Y tile because the Web Mercator world has a finite
 * north/south extent.
 */
export function clampTileY(
  y: number,
  zoom: number,
): number {
  const count =
    2 ** zoom;

  return clamp(
    y,
    0,
    count - 1,
  );
}

/* -------------------------------------------------------------------------- */
/* Tile URL                                                                   */
/* -------------------------------------------------------------------------- */

export function tileUrl(
  tile: TileCoordinate,
  provider: TileProvider =
    OPEN_STREET_MAP_PROVIDER,
): string {
  const x =
    wrapTileX(
      tile.x,
      tile.z,
    );

  const y =
    clampTileY(
      tile.y,
      tile.z,
    );

  return provider.urlTemplate
    .replace(
      "{z}",
      String(tile.z),
    )
    .replace(
      "{x}",
      String(x),
    )
    .replace(
      "{y}",
      String(y),
    );
}

/* -------------------------------------------------------------------------- */
/* Visible tile range                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Calculate the tile range covering a geographic bounding box.
 */
export function tilesForBounds(
  bounds: TileBounds,
  zoom: number,
): TileRange {
  const safeZoom =
    Math.max(
      0,
      Math.floor(zoom),
    );

  const northWest =
    geoToTile(
      {
        lat: bounds.north,
        lon: bounds.west,
      },
      safeZoom,
    );

  const southEast =
    geoToTile(
      {
        lat: bounds.south,
        lon: bounds.east,
      },
      safeZoom,
    );

  return {
    minX: northWest.x,
    maxX: southEast.x,

    minY: northWest.y,
    maxY: southEast.y,
  };
}

/**
 * Return every tile required to cover a geographic bounding box.
 *
 * Handles normal geographic bounds. Antimeridian-aware
 * horizontal wrapping is handled by wrapTileX().
 */
export function getTilesForBounds(
  bounds: TileBounds,
  zoom: number,
): TileCoordinate[] {
  const safeZoom =
    Math.max(
      0,
      Math.floor(zoom),
    );

  const tilesPerAxis =
    2 ** safeZoom;

  const northWestWorld =
    geoToWorld({
      lat: bounds.north,
      lon: bounds.west,
    });

  const southEastWorld =
    geoToWorld({
      lat: bounds.south,
      lon: bounds.east,
    });

  const minY =
    clampTileY(
      Math.floor(
        northWestWorld.y *
          tilesPerAxis,
      ),
      safeZoom,
    );

  const maxY =
    clampTileY(
      Math.floor(
        southEastWorld.y *
          tilesPerAxis,
      ),
      safeZoom,
    );

  const westX =
    northWestWorld.x *
    tilesPerAxis;

  const eastX =
    southEastWorld.x *
    tilesPerAxis;

  const tiles: TileCoordinate[] =
    [];

  /**
   * Detect whether the geographic bounds cross the
   * international date line.
   */
  const crossesAntimeridian =
    bounds.west >
    bounds.east;

  if (!crossesAntimeridian) {
    const minX =
      Math.floor(westX);

    const maxX =
      Math.floor(eastX);

    for (
      let y = minY;
      y <= maxY;
      y += 1
    ) {
      for (
        let x = minX;
        x <= maxX;
        x += 1
      ) {
        tiles.push({
          z: safeZoom,

          x: wrapTileX(
            x,
            safeZoom,
          ),

          y,
        });
      }
    }

    return deduplicateTiles(
      tiles,
    );
  }

  /**
   * Antimeridian case:
   *
   * Example:
   *
   * west = 179°
   * east = -179°
   *
   * The desired area is only a small region around the
   * international date line, not almost the entire world.
   */
  const westXFloor =
    Math.floor(westX);

  const eastXFloor =
    Math.floor(eastX);

  for (
    let y = minY;
    y <= maxY;
    y += 1
  ) {
    for (
      let x =
        westXFloor;
      x <
        tilesPerAxis;
      x += 1
    ) {
      tiles.push({
        z: safeZoom,

        x: wrapTileX(
          x,
          safeZoom,
        ),

        y,
      });
    }

    for (
      let x = 0;
      x <= eastXFloor;
      x += 1
    ) {
      tiles.push({
        z: safeZoom,

        x: wrapTileX(
          x,
          safeZoom,
        ),

        y,
      });
    }
  }

  return deduplicateTiles(
    tiles,
  );
}

/* -------------------------------------------------------------------------- */
/* Visible tiles for a screen viewport                                        */
/* -------------------------------------------------------------------------- */

/**
 * Calculate the tiles required for a map viewport.
 *
 * This is the function MissionMap.tsx will eventually use to
 * decide which raster tiles need to be loaded.
 */
export function getVisibleTiles(
  center: GeoCoordinate,
  zoom: number,
  width: number,
  height: number,
  provider: TileProvider =
    OPEN_STREET_MAP_PROVIDER,
  paddingTiles = 1,
): VisibleTile[] {
  const safeZoom =
    clampZoom(
      zoom,
      provider,
    );

  const integerZoom =
    Math.floor(safeZoom);

  const tileSize =
    provider.tileSize;

  const scale =
    2 ** safeZoom;

  const centerWorld =
    geoToWorld(center);

  const centerPixelX =
    centerWorld.x *
    tileSize *
    scale;

  const centerPixelY =
    centerWorld.y *
    tileSize *
    scale;

  const minPixelX =
    centerPixelX -
    width / 2;

  const maxPixelX =
    centerPixelX +
    width / 2;

  const minPixelY =
    centerPixelY -
    height / 2;

  const maxPixelY =
    centerPixelY +
    height / 2;

  const integerScale =
    2 ** integerZoom;

  const integerWorldSize =
    tileSize *
    integerScale;

  /**
   * Fractional zoom is represented by scaling the complete
   * integer tile grid around the viewport center.
   */
  const fractionalScale =
    scale /
    integerScale;

  const tilesMinX =
    Math.floor(
      minPixelX /
        tileSize /
        fractionalScale,
    ) -
    paddingTiles;

  const tilesMaxX =
    Math.floor(
      maxPixelX /
        tileSize /
        fractionalScale,
    ) +
    paddingTiles;

  const tilesMinY =
    Math.floor(
      minPixelY /
        tileSize /
        fractionalScale,
    ) -
    paddingTiles;

  const tilesMaxY =
    Math.floor(
      maxPixelY /
        tileSize /
        fractionalScale,
    ) +
    paddingTiles;

  const result: VisibleTile[] =
    [];

  for (
    let tileY =
      tilesMinY;
    tileY <= tilesMaxY;
    tileY += 1
  ) {
    if (
      tileY < 0 ||
      tileY >= integerScale
    ) {
      continue;
    }

    for (
      let tileX =
        tilesMinX;
      tileX <= tilesMaxX;
      tileX += 1
    ) {
      const wrappedX =
        wrapTileX(
          tileX,
          integerZoom,
        );

      /**
       * Position relative to the current map center.
       *
       * The unwrapped X value is intentionally retained here
       * so tiles close to the date line appear beside each other.
       */
      let unwrappedX =
        tileX;

      const centerTileX =
        centerWorld.x *
        integerScale;

      if (
        unwrappedX -
          centerTileX >
        integerScale / 2
      ) {
        unwrappedX -=
          integerScale;
      } else if (
        unwrappedX -
          centerTileX <
        -integerScale / 2
      ) {
        unwrappedX +=
          integerScale;
      }

      const tilePixelX =
        (
          unwrappedX *
            tileSize -
          centerWorld.x *
            integerWorldSize
        ) *
          fractionalScale +
        width / 2;

      const tilePixelY =
        (
          tileY *
            tileSize -
          centerWorld.y *
            integerWorldSize
        ) *
          fractionalScale +
        height / 2;

      result.push({
        tile: {
          z: integerZoom,
          x: wrappedX,
          y: tileY,
        },

        pixelX:
          tilePixelX,

        pixelY:
          tilePixelY,

        size:
          tileSize *
          fractionalScale,
      });
    }
  }

  return deduplicateVisibleTiles(
    result,
  );
}

/* -------------------------------------------------------------------------- */
/* Utility functions                                                          */
/* -------------------------------------------------------------------------- */

function tileKey(
  tile: TileCoordinate,
): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

function deduplicateTiles(
  tiles: TileCoordinate[],
): TileCoordinate[] {
  const seen =
    new Set<string>();

  const result: TileCoordinate[] =
    [];

  for (const tile of tiles) {
    const key =
      tileKey(tile);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(tile);
  }

  return result;
}

function deduplicateVisibleTiles(
  tiles: VisibleTile[],
): VisibleTile[] {
  const seen =
    new Set<string>();

  const result: VisibleTile[] =
    [];

  for (const item of tiles) {
    const key =
      tileKey(item.tile);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Tile identification                                                        */
/* -------------------------------------------------------------------------- */

export function tileKeyFromCoordinate(
  tile: TileCoordinate,
): string {
  return tileKey(tile);
}

/**
 * Parse a standard "z/x/y" tile key.
 */
export function tileFromKey(
  key: string,
): TileCoordinate | null {
  const parts =
    key.split("/");

  if (parts.length !== 3) {
    return null;
  }

  const z =
    Number(parts[0]);

  const x =
    Number(parts[1]);

  const y =
    Number(parts[2]);

  if (
    !Number.isInteger(z) ||
    !Number.isInteger(x) ||
    !Number.isInteger(y)
  ) {
    return null;
  }

  if (z < 0) {
    return null;
  }

  const max =
    2 ** z;

  if (
    x < 0 ||
    x >= max ||
    y < 0 ||
    y >= max
  ) {
    return null;
  }

  return {
    z,
    x,
    y,
  };
}