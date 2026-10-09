/**
 * Shared types for the Drone-OS mission map.
 *
 * The map is intentionally independent of React, MAVROS,
 * ROSBridge, or any particular tile provider.
 */

import type {
  GeoCoordinate,
  Bounds,
} from "./projection";

/* -------------------------------------------------------------------------- */
/* Map camera                                                                 */
/* -------------------------------------------------------------------------- */

export interface MapCamera {
  center: GeoCoordinate;
  zoom: number;
}

/* -------------------------------------------------------------------------- */
/* Vehicle map objects                                                        */
/* -------------------------------------------------------------------------- */

export type VehicleKind =
  | "DRONE"
  | "FASTY";

export interface VehicleMapState {
  id: string;
  kind: VehicleKind;

  /**
   * Current geographic position.
   */
  position: GeoCoordinate | null;

  /**
   * Heading in degrees.
   * 0 = North, 90 = East.
   */
  heading: number | null;

  /**
   * Whether the vehicle has a valid position.
   */
  positionValid: boolean;

  /**
   * Whether the vehicle is currently connected.
   */
  connected: boolean;

  /**
   * Whether the vehicle is armed.
   */
  armed: boolean;

  /**
   * Current vehicle mode.
   */
  mode: string;

  /**
   * Optional display label.
   */
  label?: string;
}

/* -------------------------------------------------------------------------- */
/* Mission target                                                             */
/* -------------------------------------------------------------------------- */

export type TargetStatus =
  | "NONE"
  | "DETECTED"
  | "CALCULATING"
  | "CALCULATED"
  | "PENDING_CONFIRMATION"
  | "VERIFIED"
  | "SENT_TO_FASTY"
  | "REACHED"
  | "RESCUE_IN_PROGRESS"
  | "RESCUED"
  | "ABORTED";

export interface MissionTarget {
  id: string;

  /**
   * Target position calculated from the drone's
   * observation system.
   */
  position: GeoCoordinate | null;

  status: TargetStatus;

  /**
   * Confidence of the detection.
   *
   * Range: 0 → 1.
   */
  confidence: number | null;

  /**
   * Detection timestamp.
   */
  detectedAt: number | null;

  /**
   * Whether an operator has manually verified
   * the target location.
   */
  verified: boolean;

  /**
   * Whether the target has been transmitted
   * to FASTY.
   */
  sentToFasty: boolean;
}

/* -------------------------------------------------------------------------- */
/* Mission route                                                              */
/* -------------------------------------------------------------------------- */

export type MissionPointType =
  | "WAYPOINT"
  | "LOITER"
  | "LAND"
  | "RTL"
  | "FASTY_TARGET";

export interface MissionPoint {
  id: string;

  sequence: number;

  type: MissionPointType;

  position: GeoCoordinate;

  /**
   * Optional altitude.
   *
   * Relevant primarily to the drone.
   */
  altitude?: number;

  /**
   * Optional radius for loiter/search operations.
   */
  radius?: number;

  /**
   * Optional human-readable name.
   */
  name?: string;
}

export interface MissionRoute {
  id: string;

  vehicle: VehicleKind;

  points: MissionPoint[];

  active: boolean;
}

/* -------------------------------------------------------------------------- */
/* Search area                                                                */
/* -------------------------------------------------------------------------- */

export interface SearchArea {
  id: string;

  /**
   * Polygon describing the area the drone should search.
   */
  polygon: GeoCoordinate[];

  /**
   * Optional generated search tracks.
   */
  tracks?: GeoCoordinate[][];

  active: boolean;
}

/* -------------------------------------------------------------------------- */
/* Geofence                                                                   */
/* -------------------------------------------------------------------------- */

export interface Geofence {
  id: string;

  polygon: GeoCoordinate[];

  enabled: boolean;

  /**
   * Whether the vehicle is currently inside the fence.
   */
  vehicleInside: boolean;
}

/* -------------------------------------------------------------------------- */
/* Map interaction                                                            */
/* -------------------------------------------------------------------------- */

export type MapInteractionMode =
  | "NORMAL"
  | "PAN"
  | "SELECT_TARGET"
  | "ADD_WAYPOINT"
  | "MEASURE"
  | "SET_HOME";

export interface MapPointerPosition {
  screenX: number;
  screenY: number;

  coordinate: GeoCoordinate;
}

/* -------------------------------------------------------------------------- */
/* Map layers                                                                 */
/* -------------------------------------------------------------------------- */

export interface MapLayerVisibility {
  basemap: boolean;
  drone: boolean;
  fasty: boolean;
  target: boolean;
  routes: boolean;
  waypoints: boolean;
  geofence: boolean;
  searchArea: boolean;
}

/* -------------------------------------------------------------------------- */
/* Complete mission-map state                                                 */
/* -------------------------------------------------------------------------- */

export interface MissionMapState {
  camera: MapCamera;

  drone: VehicleMapState;

  fasty: VehicleMapState;

  target: MissionTarget | null;

  droneRoute: MissionRoute | null;

  fastyRoute: MissionRoute | null;

  searchArea: SearchArea | null;

  geofence: Geofence | null;

  layers: MapLayerVisibility;

  interactionMode: MapInteractionMode;
}

/* -------------------------------------------------------------------------- */
/* Map fit / navigation helpers                                               */
/* -------------------------------------------------------------------------- */

export interface MapFitOptions {
  padding?: number;

  /**
   * Optional minimum zoom.
   */
  minZoom?: number;

  /**
   * Optional maximum zoom.
   */
  maxZoom?: number;
}

export interface MapMeasurement {
  start: GeoCoordinate | null;

  end: GeoCoordinate | null;

  distanceMeters: number | null;

  bearingDegrees: number | null;
}

/* -------------------------------------------------------------------------- */
/* Mission bounds                                                             */
/* -------------------------------------------------------------------------- */

export interface MissionBounds {
  bounds: Bounds | null;

  /**
   * Coordinates contributing to the bounds.
   */
  coordinates: GeoCoordinate[];
}

/* -------------------------------------------------------------------------- */
/* Map events                                                                 */
/* -------------------------------------------------------------------------- */

export type MissionMapEvent =
  | {
      type: "MAP_CLICK";
      coordinate: GeoCoordinate;
    }
  | {
      type: "TARGET_SELECTED";
      coordinate: GeoCoordinate;
    }
  | {
      type: "WAYPOINT_ADDED";
      point: MissionPoint;
    }
  | {
      type: "VEHICLE_SELECTED";
      vehicle: VehicleKind;
    }
  | {
      type: "MAP_DOUBLE_CLICK";
      coordinate: GeoCoordinate;
    };