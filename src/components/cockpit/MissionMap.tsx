import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";
import type {
  DroneTelemetry,
  FastyTelemetry,
} from "@/lib/telemetry";
import { createPortal } from "react-dom";
import {
  Crosshair,
  Home,
  LocateFixed,
  Layers,
  Minus,
  Plus,
  RotateCcw,
  Ruler,
  Maximize2,
  Target,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import type {
  GeoCoordinate,
  ScreenPoint,
} from "@/lib/map/projection";

import {
  bearingDegrees,
  distanceMeters,
  geoToScreen,
  screenToGeo,
} from "@/lib/map/projection";

import type {
  MissionMapState,
  MissionTarget,
  VehicleMapState,
} from "@/lib/map/mapTypes";

import {
  getVisibleTiles,
  OPEN_STREET_MAP_PROVIDER,
  tileKeyFromCoordinate,
  type VisibleTile,
} from "@/lib/map/tiles";

import {
  missionTileCache,
} from "@/lib/map/tileCache";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface MissionMapProps {
  /**
   * Existing dashboard Drone telemetry.
   *
   * Kept as an input so the map remains compatible with
   * the current cockpit route.
   */
  drone?: DroneTelemetry;

  /**
   * Existing dashboard FASTY telemetry.
   */
  fasty?: FastyTelemetry;

  /**
   * Optional real Drone position.
   */
  dronePosition?: GeoCoordinate | null;

  /**
   * Optional real FASTY position.
   */
  fastyPosition?: GeoCoordinate | null;

  /**
   * Optional Drone heading.
   */
  droneHeading?: number | null;

  /**
   * Optional FASTY heading.
   */
  fastyHeading?: number | null;

  /**
   * Optional rescue target.
   */
  target?: MissionTarget | null;

  /**
   * Optional complete map state for future mission integration.
   */
  mapState?: Partial<MissionMapState>;

  /**
   * Optional initial map center.
   */
  center?: GeoCoordinate;

  /**
   * Optional initial zoom.
   */
  zoom?: number;

  /**
   * Called when the operator clicks the map.
   */
  onMapClick?: (
    coordinate: GeoCoordinate,
  ) => void;

  /**
   * Called when the operator selects the target.
   */
  onTargetSelect?: (
    coordinate: GeoCoordinate,
  ) => void;

  className?: string;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const DEFAULT_CENTER: GeoCoordinate = {
  lat: 19.076,
  lon: 72.8777,
};

const DEFAULT_ZOOM = 12;

const MIN_ZOOM = 2;

const MAX_ZOOM = 19;
const MAX_SATELLITE_ZOOM = 18;

const ZOOM_STEP = 0.5;

const ROSBRIDGE_URL =
  import.meta.env["VITE_ROSBRIDGE_URL"] ??
  "ws://localhost:9090";

const DRONE_GPS_TOPIC =
  "/mavros_drone/mavros/global_position/global";

const FASTY_GPS_TOPIC =
  "/mavros_fasty/mavros/global_position/global";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function isValidCoordinate(
  coordinate:
    | GeoCoordinate
    | null
    | undefined,
): coordinate is GeoCoordinate {
  if (!coordinate) {
    return false;
  }

  return (
    Number.isFinite(coordinate.lat) &&
    Number.isFinite(coordinate.lon) &&
    coordinate.lat >= -90 &&
    coordinate.lat <= 90 &&
    coordinate.lon >= -180 &&
    coordinate.lon <= 180
  );
}

function isUsableVehicleCoordinate(
  coordinate:
    | GeoCoordinate
    | null
    | undefined,
): coordinate is GeoCoordinate {
  return (
    isValidCoordinate(coordinate) &&
    !(coordinate.lat === 0 && coordinate.lon === 0)
  );
}

function extractStatusNumber(
  value: unknown,
): number | null {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "value" in value
  ) {
    const candidate = (
      value as { value?: unknown }
    ).value;

    if (
      typeof candidate === "number" &&
      Number.isFinite(candidate)
    ) {
      return candidate;
    }
  }

  return null;
}

function extractStatusString(
  value: unknown,
): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "value" in value
  ) {
    const candidate = (
      value as { value?: unknown }
    ).value;

    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return null;
}

function formatCoordinate(
  coordinate:
    | GeoCoordinate
    | null,
): string {
  if (!coordinate) {
    return "N/A";
  }

  return `${coordinate.lat.toFixed(6)}, ${coordinate.lon.toFixed(6)}`;
}

function formatDistance(
  meters: number,
): string {
  if (meters < 1_000) {
    return `${Math.round(meters)} m`;
  }

  return `${(meters / 1_000).toFixed(2)} km`;
}

function formatBearing(
  bearing: number,
): string {
  return `${Math.round(bearing)}°`;
}

/* -------------------------------------------------------------------------- */
/* Vehicle marker                                                             */
/* -------------------------------------------------------------------------- */

interface VehicleMarkerProps {
  vehicle: VehicleMapState;
  screen: ScreenPoint;
}

function VehicleMarker({
  vehicle,
  screen,
}: VehicleMarkerProps) {
  const isDrone =
    vehicle.kind === "DRONE";

  const heading =
    vehicle.heading ?? 0;

  const label =
    vehicle.label ??
    (isDrone ? "DRONE" : "SROTA");

  return (
    <div
      className="pointer-events-none absolute z-30"
      style={{
        left: screen.x,
        top: screen.y,
        transform:
          "translate(-50%, -50%)",
      }}
    >
      <div className="relative">
        {/* Heading pointer */}
        <div
          className="absolute left-1/2 top-1/2 h-10 w-1 origin-bottom"
          style={{
            transform:
              `translate(-50%, -100%) rotate(${heading}deg)`,
          }}
        >
          <div
            className={[
              "absolute bottom-0 left-1/2 h-8 w-px -translate-x-1/2",
              isDrone
                ? "bg-cyan-300"
                : "bg-orange-300",
            ].join(" ")}
          />

          <div
            className={[
              "absolute -top-1 left-1/2 -translate-x-1/2",
              "border-l-[4px] border-r-[4px] border-b-[7px]",
              "border-l-transparent border-r-transparent",
              isDrone
                ? "border-b-cyan-300"
                : "border-b-orange-300",
            ].join(" ")}
          />
        </div>

        {/* Vehicle body */}
        <div
          className={[
            "flex h-8 w-8 items-center justify-center",
            "border-2 bg-black/90 shadow-lg",
            isDrone
              ? "border-cyan-400 shadow-cyan-400/30"
              : "border-orange-400 shadow-orange-400/30",
          ].join(" ")}
        >
          {isDrone ? (
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 text-cyan-300"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M12 5v14M5 12h14" />
              <path d="M7 7l-2-2M17 7l2-2M7 17l-2 2M17 17l2 2" />
              <circle
                cx="12"
                cy="12"
                r="2"
              />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 text-orange-300"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M4 15h16" />
              <path d="M6 15l2-5h8l2 5" />
              <path d="M8 18h8" />
              <circle
                cx="8"
                cy="18"
                r="1"
              />
              <circle
                cx="16"
                cy="18"
                r="1"
              />
            </svg>
          )}
        </div>

        {/* Label */}
        <div
          className={[
            "absolute left-1/2 top-full mt-1 -translate-x-1/2",
            "whitespace-nowrap border bg-black/90 px-1.5 py-0.5",
            "font-mono text-[9px] font-semibold tracking-wider",
            isDrone
              ? "border-cyan-500/40 text-cyan-300"
              : "border-orange-500/40 text-orange-300",
          ].join(" ")}
        >
          {label}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Target marker                                                              */
/* -------------------------------------------------------------------------- */

interface TargetMarkerProps {
  target: MissionTarget;
  screen: ScreenPoint;
  onSelect:
    | ((
        coordinate: GeoCoordinate,
      ) => void)
    | undefined;
}

function TargetMarker({
  target,
  screen,
  onSelect,
}: TargetMarkerProps) {
  if (
    !target.position ||
    !isValidCoordinate(
      target.position,
    )
  ) {
    return null;
  }

  const statusLabel =
    target.status ===
    "VERIFIED"
      ? "VERIFIED"
      : target.status ===
          "SENT_TO_FASTY"
        ? "SROTA TARGET"
        : "TARGET";

  return (
    <button
      type="button"
      className="absolute z-40 -translate-x-1/2 -translate-y-1/2"
      style={{
        left: screen.x,
        top: screen.y,
      }}
      onClick={(event) => {
        event.stopPropagation();

        onSelect?.(
          target.position!,
        );
      }}
      title={`Rescue target at ${formatCoordinate(target.position)}. Click to select this target.`}
    >
      <div className="relative">
        <div className="absolute -inset-3 animate-pulse border border-red-400/40" />

        <div className="flex h-9 w-9 items-center justify-center border-2 border-red-400 bg-red-950/80 shadow-lg shadow-red-500/20">
          <Target
            className="h-5 w-5 text-red-300"
            strokeWidth={2}
          />
        </div>

        <div className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap border border-red-500/40 bg-black/90 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-red-300">
          {statusLabel}
        </div>
      </div>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Route renderer                                                             */
/* -------------------------------------------------------------------------- */

interface RouteLineProps {
  coordinates: GeoCoordinate[];
  viewport: {
    width: number;
    height: number;
    center: GeoCoordinate;
    zoom: number;
  };
  className: string;
}

function RouteLine({
  coordinates,
  viewport,
  className,
}: RouteLineProps) {
  const points =
    coordinates
      .filter(isValidCoordinate)
      .map((coordinate) =>
        geoToScreen(
          coordinate,
          viewport,
        ),
      );

  if (points.length < 2) {
    return null;
  }

  const path =
    points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
      )
      .join(" ");

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      viewBox={`0 0 ${viewport.width} ${viewport.height}`}
      preserveAspectRatio="none"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="7 5"
        vectorEffect="non-scaling-stroke"
        className={className}
      />
    </svg>
  );
}

function buildEsriWorldImageryTileUrl(
  tile: VisibleTile["tile"],
): string {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${tile.z}/${tile.y}/${tile.x}`;
}

/* -------------------------------------------------------------------------- */
/* Tile component                                                             */
/* -------------------------------------------------------------------------- */

interface MapTileProps {
  tile: VisibleTile;
  loadedImage: HTMLImageElement | null;
  directImageUrl?: string | null;
  onDirectImageError?: () => void;
}

function MapTile({
  tile,
  loadedImage,
  directImageUrl,
  onDirectImageError,
}: MapTileProps) {
  if (directImageUrl) {
    return (
      <img
        src={directImageUrl}
        alt=""
        draggable={false}
        onError={onDirectImageError}
        className="pointer-events-none absolute select-none"
        style={{
          left: tile.pixelX,
          top: tile.pixelY,
          width: tile.size,
          height: tile.size,
        }}
      />
    );
  }

  if (!loadedImage) {
    return (
      <div
        className="absolute bg-[#101820]"
        style={{
          left: tile.pixelX,
          top: tile.pixelY,
          width: tile.size,
          height: tile.size,
        }}
      />
    );
  }

  return (
    <img
      src={loadedImage.src}
      alt=""
      draggable={false}
      className="pointer-events-none absolute select-none"
      style={{
        left: tile.pixelX,
        top: tile.pixelY,
        width: tile.size,
        height: tile.size,
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Main component                                                             */
/* -------------------------------------------------------------------------- */

export function MissionMap({
  drone,
  fasty,
  dronePosition,
  fastyPosition,
  droneHeading,
  fastyHeading,
  target,
  mapState,
  center,
  zoom,
  onMapClick,
  onTargetSelect,
  className,
}: MissionMapProps) {
  const containerRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const [size, setSize] =
    useState({
      width: 0,
      height: 0,
    });

  const [mapCenter, setMapCenter] =
    useState<GeoCoordinate>(
      mapState?.camera?.center ??
        center ??
        DEFAULT_CENTER,
    );

  const [mapZoom, setMapZoom] =
    useState(
      mapState?.camera?.zoom ??
        zoom ??
        DEFAULT_ZOOM,
    );

  const [isDragging, setIsDragging] =
    useState(false);

  const [dragStart, setDragStart] =
    useState<{
      x: number;
      y: number;
    } | null>(null);

  const [
    dragStartCenter,
    setDragStartCenter,
  ] =
    useState<GeoCoordinate | null>(
      null,
    );

  const [
    measurementStart,
    setMeasurementStart,
  ] =
    useState<GeoCoordinate | null>(
      null,
    );

  const [
    measurementEnd,
    setMeasurementEnd,
  ] =
    useState<GeoCoordinate | null>(
      null,
    );

  const [measureMode, setMeasureMode] =
    useState(false);

  const [
    followVehicle,
    setFollowVehicle,
  ] =
    useState<
      "DRONE" | "FASTY" | null
    >(null);

  const [
    loadedTiles,
    setLoadedTiles,
  ] =
    useState<
      Map<string, HTMLImageElement>
    >(
      new Map(),
    );

  const [
    tileErrors,
    setTileErrors,
  ] =
    useState<
      Set<string>
    >(
      new Set(),
    );

  const [mapLayer, setMapLayer] =
    useState<"STREET" | "SATELLITE">("SATELLITE");

  const [locationState, setLocationState] =
    useState<"IDLE" | "LOCATING" | "READY" | "DENIED" | "UNAVAILABLE">("IDLE");

  const [laptopLocation, setLaptopLocation] =
    useState<GeoCoordinate | null>(null);

  const [rosDronePosition, setRosDronePosition] =
    useState<GeoCoordinate | null>(null);

  const [rosFastyPosition, setRosFastyPosition] =
    useState<GeoCoordinate | null>(null);

  const [rosConnected, setRosConnected] =
    useState(false);

  // The first valid Drone GPS fix received from ROSBridge becomes the
  // mission home position. It is intentionally never updated afterwards.
  const [homeLocation, setHomeLocation] =
    useState<GeoCoordinate | null>(null);

  /* ------------------------------------------------------------------------ */
  /* Operator mini-map / floating map                                       */
  /* ------------------------------------------------------------------------ */

  // The cockpit uses a clean mini-map. The Mission Planner passes onMapClick,
  // so it keeps the existing full map UI and controls.
  const compactUi = onMapClick == null;

  const [isFloatingMapOpen, setIsFloatingMapOpen] =
    useState(false);

  const [floatingPosition, setFloatingPosition] =
    useState({ x: 0, y: 0 });

  const [floatingDrag, setFloatingDrag] =
    useState<{ offsetX: number; offsetY: number } | null>(null);

  const openFloatingMap = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const popupWidth = Math.min(
      720,
      Math.max(320, window.innerWidth * 0.52),
    );

    setFloatingPosition({
      x: Math.max(16, Math.round(window.innerWidth - popupWidth - 24)),
      y: Math.max(72, Math.round(window.innerHeight * 0.14)),
    });
    setIsFloatingMapOpen(true);
  }, []);

  const closeFloatingMap = useCallback(() => {
    setFloatingDrag(null);
    setIsFloatingMapOpen(false);
  }, []);

  const handleFloatingHeaderPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      const element = containerRef.current;
      if (!element) {
        return;
      }

      const rect = element.getBoundingClientRect();
      setFloatingDrag({
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      });

      event.currentTarget.setPointerCapture(event.pointerId);
      event.stopPropagation();
    },
    [],
  );

  const handleFloatingHeaderPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!floatingDrag || typeof window === "undefined") {
        return;
      }

      const element = containerRef.current;
      if (!element) {
        return;
      }

      const rect = element.getBoundingClientRect();
      const nextX = event.clientX - floatingDrag.offsetX;
      const nextY = event.clientY - floatingDrag.offsetY;
      const maxX = Math.max(8, window.innerWidth - rect.width - 8);
      const maxY = Math.max(56, window.innerHeight - rect.height - 8);

      setFloatingPosition({
        x: Math.min(maxX, Math.max(8, nextX)),
        y: Math.min(maxY, Math.max(56, nextY)),
      });
    },
    [floatingDrag],
  );

  const stopFloatingDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (floatingDrag) {
        event.stopPropagation();
      }
      setFloatingDrag(null);
    },
    [floatingDrag],
  );

  useEffect(() => {
    if (!compactUi || !isFloatingMapOpen || typeof window === "undefined") {
      return;
    }

    const handleWindowResize = () => {
      const element = containerRef.current;
      if (!element) {
        return;
      }

      const rect = element.getBoundingClientRect();
      const maxX = Math.max(8, window.innerWidth - rect.width - 8);
      const maxY = Math.max(56, window.innerHeight - rect.height - 8);

      setFloatingPosition((previous) => ({
        x: Math.min(maxX, Math.max(8, previous.x)),
        y: Math.min(maxY, Math.max(56, previous.y)),
      }));
    };

    handleWindowResize();
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [compactUi, isFloatingMapOpen]);

  /* ------------------------------------------------------------------------ */
  /* ROSBridge GPS telemetry                                                 */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    const socket = new WebSocket(ROSBRIDGE_URL);

    socket.onopen = () => {
      setRosConnected(true);

      socket.send(
        JSON.stringify({
          op: "subscribe",
          topic: DRONE_GPS_TOPIC,
          type: "sensor_msgs/NavSatFix",
        }),
      );

      socket.send(
        JSON.stringify({
          op: "subscribe",
          topic: FASTY_GPS_TOPIC,
          type: "sensor_msgs/NavSatFix",
        }),
      );

      console.log(
        "[MissionMap] Connected to ROSBridge:",
        ROSBRIDGE_URL,
      );
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.op !== "publish" || !data.msg) {
          return;
        }

        const lat = Number(data.msg.latitude);
        const lon = Number(data.msg.longitude);

        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lon) ||
          lat < -90 ||
          lat > 90 ||
          lon < -180 ||
          lon > 180 ||
          (lat === 0 && lon === 0)
        ) {
          return;
        }

        const coordinate: GeoCoordinate = {
          lat,
          lon,
        };

        if (data.topic === DRONE_GPS_TOPIC) {
          setRosDronePosition(coordinate);
        }

        if (data.topic === FASTY_GPS_TOPIC) {
          setHomeLocation((previous) =>
            previous ?? coordinate,
          );

          setRosFastyPosition(coordinate);
        }
      } catch (error) {
        console.error(
          "[MissionMap] ROSBridge message error:",
          error,
        );
      }
    };

    socket.onerror = (error) => {
      setRosConnected(false);
      console.error(
        "[MissionMap] ROSBridge WebSocket error:",
        error,
      );
    };

    socket.onclose = () => {
      setRosConnected(false);
      console.log(
        "[MissionMap] ROSBridge connection closed",
      );
    };

    return () => {
      socket.close();
    };
  }, []);


  /* ------------------------------------------------------------------------ */
  /* Live vehicle inputs                                                      */
  /* ------------------------------------------------------------------------ */

  const fastyTelemetryPosition =
    useMemo<GeoCoordinate | null>(() => {
      const lat = extractStatusNumber(
        fasty?.lat,
      );
      const lon = extractStatusNumber(
        fasty?.lon,
      );

      if (
        lat === null ||
        lon === null
      ) {
        return null;
      }

      const coordinate = { lat, lon };

      return isUsableVehicleCoordinate(
        coordinate,
      )
        ? coordinate
        : null;
    }, [fasty?.lat, fasty?.lon]);

  const liveDronePosition =
    isUsableVehicleCoordinate(
      rosDronePosition,
    )
      ? rosDronePosition
      : dronePosition;

  const liveFastyPosition =
    isUsableVehicleCoordinate(
      rosFastyPosition,
    )
      ? rosFastyPosition
      : isUsableVehicleCoordinate(
          fastyPosition,
        )
        ? fastyPosition
        : fastyTelemetryPosition;

  const fastyTelemetryHeading =
    extractStatusNumber(
      fasty?.heading,
    );

  const liveFastyHeading =
    typeof fastyHeading === "number" &&
    Number.isFinite(fastyHeading)
      ? fastyHeading
      : fastyTelemetryHeading;

  const fastyOnline =
    fasty?.link === "ONLINE";

  const fastyGpsAvailable =
    isUsableVehicleCoordinate(
      liveFastyPosition,
    );

  /* ------------------------------------------------------------------------ */
  /* Resize observer                                                          */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    const element =
      containerRef.current;

    if (!element) {
      return;
    }

    const updateSize =
      () => {
        const rect =
          element.getBoundingClientRect();

        setSize({
          width: Math.max(
            0,
            Math.round(rect.width),
          ),
          height: Math.max(
            0,
            Math.round(rect.height),
          ),
        });
      };

    updateSize();

    const observer =
      new ResizeObserver(
        updateSize,
      );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [isFloatingMapOpen]);

  /* ------------------------------------------------------------------------ */
  /* Follow vehicle                                                           */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (
      followVehicle ===
      "DRONE" &&
      isUsableVehicleCoordinate(
        liveDronePosition,
      )
    ) {
      setMapCenter(
        liveDronePosition,
      );
    }

    if (
      followVehicle ===
      "FASTY" &&
      isUsableVehicleCoordinate(
        liveFastyPosition,
      )
    ) {
      setMapCenter(
        liveFastyPosition,
      );
    }
  }, [
    followVehicle,
    liveDronePosition,
    liveFastyPosition,
  ]);

  useEffect(() => {
    if (mapLayer === "SATELLITE") {
      setMapZoom((current) =>
        Math.min(current, MAX_SATELLITE_ZOOM),
      );
    }

    setTileErrors(new Set());
  }, [mapLayer]);

  /* ------------------------------------------------------------------------ */
  /* Viewport                                                                 */
  /* ------------------------------------------------------------------------ */

  const viewport = useMemo(
    () => ({
      width: size.width,
      height: size.height,
      center: mapCenter,
      zoom: mapZoom,
    }),
    [
      mapCenter,
      mapZoom,
      size.height,
      size.width,
    ],
  );

  /* ------------------------------------------------------------------------ */
  /* Visible tiles                                                            */
  /* ------------------------------------------------------------------------ */

  const visibleTiles =
    useMemo(() => {
      if (
        size.width <= 0 ||
        size.height <= 0
      ) {
        return [];
      }

      return getVisibleTiles(
        mapCenter,
        mapZoom,
        size.width,
        size.height,
        OPEN_STREET_MAP_PROVIDER,
        1,
      );
    }, [
      mapCenter,
      mapZoom,
      size.height,
      size.width,
    ]);

  /* ------------------------------------------------------------------------ */
  /* Tile loading                                                             */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (mapLayer !== "STREET") {
      return;
    }

    let cancelled = false;

    const loadTiles =
      async () => {
        const requests =
          visibleTiles.map(
            async (visibleTile) => {
              const key =
                tileKeyFromCoordinate(
                  visibleTile.tile,
                );

              try {
                const result =
                  await missionTileCache.load(
                    visibleTile.tile,
                    {
                      provider:
                        OPEN_STREET_MAP_PROVIDER,
                    },
                  );

                if (cancelled) {
                  return;
                }

                setLoadedTiles(
                  (previous) => {
                    const next =
                      new Map(
                        previous,
                      );

                    next.set(
                      key,
                      result.image,
                    );

                    return next;
                  },
                );

                setTileErrors(
                  (previous) => {
                    if (
                      !previous.has(
                        key,
                      )
                    ) {
                      return previous;
                    }

                    const next =
                      new Set(
                        previous,
                      );

                    next.delete(
                      key,
                    );

                    return next;
                  },
                );
              } catch {
                if (cancelled) {
                  return;
                }

                setTileErrors(
                  (previous) => {
                    const next =
                      new Set(
                        previous,
                      );

                    next.add(key);

                    return next;
                  },
                );
              }
            },
          );

        await Promise.allSettled(
          requests,
        );
      };

    void loadTiles();

    return () => {
      cancelled = true;
    };
  }, [mapLayer, visibleTiles]);

  /* ------------------------------------------------------------------------ */
  /* Vehicle map state                                                        */
  /* ------------------------------------------------------------------------ */

  const droneVehicle =
    useMemo<VehicleMapState>(
      () => ({
        id: "drone",
        kind: "DRONE",
        position:
          liveDronePosition ??
          null,
        heading:
          droneHeading ??
          null,
        positionValid:
          isUsableVehicleCoordinate(
            liveDronePosition,
          ),
        connected:
          rosConnected &&
          isUsableVehicleCoordinate(
            liveDronePosition,
          ),
        armed: false,
        mode: "N/A",
        label: "DRONE",
      }),
      [
        droneHeading,
        liveDronePosition,
        rosConnected,
      ],
    );

  const fastyVehicle =
    useMemo<VehicleMapState>(
      () => ({
        id: "fasty",
        kind: "FASTY",
        position:
          liveFastyPosition ??
          null,
        heading:
          liveFastyHeading ??
          null,
        positionValid:
          isUsableVehicleCoordinate(
            liveFastyPosition,
          ),
        connected:
          rosConnected &&
          isUsableVehicleCoordinate(
            liveFastyPosition,
          ),
        armed: false,
        mode:
          extractStatusString(
            fasty?.mode,
          ) ?? "N/A",
        label: "SROTA",
      }),
      [
        fasty,
        liveFastyHeading,
        rosConnected,
        liveFastyPosition,
      ],
    );

  /* ------------------------------------------------------------------------ */
  /* Screen positions                                                         */
  /* ------------------------------------------------------------------------ */

  const droneScreen =
    isValidCoordinate(
      droneVehicle.position,
    )
      ? geoToScreen(
          droneVehicle.position,
          viewport,
        )
      : null;

  const fastyScreen =
    isValidCoordinate(
      fastyVehicle.position,
    )
      ? geoToScreen(
          fastyVehicle.position,
          viewport,
        )
      : null;

  const targetScreen =
    target?.position &&
    isValidCoordinate(
      target.position,
    )
      ? geoToScreen(
          target.position,
          viewport,
        )
      : null;

  /* ------------------------------------------------------------------------ */
  /* Measurement                                                              */
  /* ------------------------------------------------------------------------ */

  const measurement =
    useMemo(() => {
      if (
        !measurementStart ||
        !measurementEnd
      ) {
        return null;
      }

      return {
        distance:
          distanceMeters(
            measurementStart,
            measurementEnd,
          ),
        bearing:
          bearingDegrees(
            measurementStart,
            measurementEnd,
          ),
      };
    }, [
      measurementEnd,
      measurementStart,
    ]);

  /* ------------------------------------------------------------------------ */
  /* Pointer interaction                                                      */
  /* ------------------------------------------------------------------------ */

  const handlePointerDown =
    useCallback(
      (
        event: ReactPointerEvent<HTMLDivElement>,
      ) => {
        if (
          event.button !== 0
        ) {
          return;
        }

        const rect =
          containerRef.current?.getBoundingClientRect();

        if (!rect) {
          return;
        }

        setIsDragging(true);

        setDragStart({
          x:
            event.clientX -
            rect.left,
          y:
            event.clientY -
            rect.top,
        });

        setDragStartCenter(
          mapCenter,
        );

        event.currentTarget.setPointerCapture(
          event.pointerId,
        );
      },
      [mapCenter],
    );

  const handlePointerMove =
    useCallback(
      (
        event: ReactPointerEvent<HTMLDivElement>,
      ) => {
        if (
          !isDragging ||
          !dragStart ||
          !dragStartCenter
        ) {
          return;
        }

        const rect =
          containerRef.current?.getBoundingClientRect();

        if (!rect) {
          return;
        }

        const currentX =
          event.clientX -
          rect.left;

        const currentY =
          event.clientY -
          rect.top;

        const startWorld =
          screenToGeo(
            {
              x: dragStart.x,
              y: dragStart.y,
            },
            {
              ...viewport,
              center:
                dragStartCenter,
            },
          );

        const currentWorld =
          screenToGeo(
            {
              x: currentX,
              y: currentY,
            },
            {
              ...viewport,
              center:
                dragStartCenter,
            },
          );

        const latitudeDelta =
          startWorld.lat -
          currentWorld.lat;

        const longitudeDelta =
          startWorld.lon -
          currentWorld.lon;

        setMapCenter({
          lat: Math.max(
            -85,
            Math.min(
              85,
              dragStartCenter.lat +
                latitudeDelta,
            ),
          ),

          lon:
            (
              dragStartCenter.lon +
              longitudeDelta +
              540
            ) %
              360 -
            180,
        });
      },
      [
        dragStart,
        dragStartCenter,
        isDragging,
        viewport,
      ],
    );

  const handlePointerUp =
    useCallback(
      (
        event: ReactPointerEvent<HTMLDivElement>,
      ) => {
        if (!isDragging) {
          return;
        }

        const rect =
          containerRef.current?.getBoundingClientRect();

        const moved =
          dragStart
            ? Math.hypot(
                event.clientX -
                  rect!.left -
                  dragStart.x,
                event.clientY -
                  rect!.top -
                  dragStart.y,
              )
            : 0;

        setIsDragging(false);
        setDragStart(null);
        setDragStartCenter(null);

        if (
          moved > 6
        ) {
          return;
        }

        if (!rect) {
          return;
        }

        const coordinate =
          screenToGeo(
            {
              x:
                event.clientX -
                rect.left,
              y:
                event.clientY -
                rect.top,
            },
            viewport,
          );

        if (measureMode) {
          if (
            !measurementStart
          ) {
            setMeasurementStart(
              coordinate,
            );

            setMeasurementEnd(
              null,
            );
          } else {
            setMeasurementEnd(
              coordinate,
            );
          }

          return;
        }

        onMapClick?.(
          coordinate,
        );
      },
      [
        dragStart,
        isDragging,
        measureMode,
        measurementStart,
        onMapClick,
        viewport,
      ],
    );

  /* ------------------------------------------------------------------------ */
  /* Wheel zoom                                                               */
  /* ------------------------------------------------------------------------ */

  const handleWheel =
    useCallback(
      (
        event: WheelEvent<HTMLDivElement>,
      ) => {
        // React/browser wheel listeners may be passive. Do not call
        // preventDefault() here; the map lives inside an overflow-hidden
        // cockpit surface, so zoom remains local without generating the
        // passive-listener console error.
        const direction =
          event.deltaY > 0
            ? -1
            : 1;

        setMapZoom(
          (current) => {
            const maximumZoom =
              mapLayer === "SATELLITE"
                ? MAX_SATELLITE_ZOOM
                : MAX_ZOOM;

            return Math.max(
              MIN_ZOOM,
              Math.min(
                maximumZoom,
                current +
                  direction *
                    ZOOM_STEP,
              ),
            );
          },
        );
      },
      [mapLayer],
    );

  /* ------------------------------------------------------------------------ */
  /* Zoom controls                                                             */
  /* ------------------------------------------------------------------------ */

  const changeZoom =
    useCallback(
      (delta: number) => {
        setMapZoom(
          (current) => {
            const maximumZoom =
              mapLayer === "SATELLITE"
                ? MAX_SATELLITE_ZOOM
                : MAX_ZOOM;

            return Math.max(
              MIN_ZOOM,
              Math.min(
                maximumZoom,
                current + delta,
              ),
            );
          },
        );
      },
      [mapLayer],
    );

  /* ------------------------------------------------------------------------ */
  /* Reset view                                                                */
  /* ------------------------------------------------------------------------ */

  const resetView =
    useCallback(() => {
      setMapCenter(
        center ??
          DEFAULT_CENTER,
      );

      setMapZoom(
        zoom ??
          DEFAULT_ZOOM,
      );

      setFollowVehicle(
        null,
      );
    }, [center, zoom]);

  /* ------------------------------------------------------------------------ */
  /* Laptop / browser location                                                */
  /* ------------------------------------------------------------------------ */

  const recenterOnLaptop =
    useCallback(() => {
      if (!("geolocation" in navigator)) {
        setLocationState("UNAVAILABLE");
        return;
      }

      setLocationState("LOCATING");

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const nextCenter: GeoCoordinate = {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          };

          setLaptopLocation(nextCenter);
          setMapCenter(nextCenter);
          setFollowVehicle(null);
          setLocationState("READY");
        },
        () => {
          setLocationState("DENIED");
        },
        {
          enableHighAccuracy: true,
          maximumAge: 60_000,
          timeout: 10_000,
        },
      );
    }, []);

  useEffect(() => {
    // Use the laptop/browser location for the initial map center only when
    // the caller did not explicitly provide a center or saved map camera.
    if (
      center ||
      mapState?.camera?.center
    ) {
      return;
    }

    recenterOnLaptop();
  }, [
    center,
    mapState?.camera?.center,
    recenterOnLaptop,
  ]);

  /* ------------------------------------------------------------------------ */
  /* Center helpers                                                            */
  /* ------------------------------------------------------------------------ */

  const centerOnDrone =
    useCallback(() => {
      if (
        isUsableVehicleCoordinate(
          liveDronePosition,
        )
      ) {
        setMapCenter(
          liveDronePosition,
        );

        setFollowVehicle(
          "DRONE",
        );
      }
    }, [liveDronePosition]);

  const centerOnFasty =
    useCallback(() => {
      if (
        isUsableVehicleCoordinate(
          liveFastyPosition,
        )
      ) {
        setMapCenter(
          liveFastyPosition,
        );

        setFollowVehicle(
          "FASTY",
        );
      }
    }, [liveFastyPosition]);

  const laptopScreen =
    laptopLocation
      ? geoToScreen(
          laptopLocation,
          viewport,
        )
      : null;

  const homeScreen =
    homeLocation
      ? geoToScreen(
          homeLocation,
          viewport,
        )
      : null;

  /* ------------------------------------------------------------------------ */
  /* Measurement line                                                          */
  /* ------------------------------------------------------------------------ */

  const measurementLine =
    useMemo(() => {
      if (
        !measurementStart ||
        !measurementEnd
      ) {
        return null;
      }

      const start =
        geoToScreen(
          measurementStart,
          viewport,
        );

      const end =
        geoToScreen(
          measurementEnd,
          viewport,
        );

      return {
        start,
        end,
      };
    }, [
      measurementEnd,
      measurementStart,
      viewport,
    ]);

  /* ------------------------------------------------------------------------ */
  /* Render                                                                   */
  /* ------------------------------------------------------------------------ */

  const mapRoot = (
    <div
      ref={containerRef}
      title={compactUi
        ? "Mission map showing the live Drone, SROTA, home, and target positions."
        : "Interactive mission map for viewing vehicle positions, routes, GPS, map layers, and measurements."}
      className={[
        "relative h-full w-full overflow-hidden overscroll-none",
        "select-none touch-none bg-[#0a1016]",
        compactUi && isFloatingMapOpen
          ? "fixed z-[130] border border-cyan-400/60 bg-[#071019] shadow-2xl shadow-black/70"
          : "",
        isDragging
          ? "cursor-grabbing"
          : "cursor-crosshair",
        className ?? "",
      ].join(" ")}
      style={
        compactUi && isFloatingMapOpen
          ? {
              // Keep the expanded map pinned to the browser viewport.
              // The base map surface uses `relative`, so position must be
              // explicit here to prevent the floating map from remaining
              // in the dashboard document flow.
              position: "fixed",
              left: floatingPosition.x,
              top: floatingPosition.y,
              width: "min(52vw, 720px)",
              height: "min(58vh, 520px)",
              zIndex: 130,
              margin: 0,
            }
          : undefined
      }
      onPointerDown={
        handlePointerDown
      }
      onPointerMove={
        handlePointerMove
      }
      onPointerUp={
        handlePointerUp
      }
      onPointerCancel={
        handlePointerUp
      }
      onWheel={
        handleWheel
      }
    >
      {compactUi && isFloatingMapOpen && (
        <div
          className="absolute inset-x-0 top-0 z-[90] flex h-9 cursor-move items-center justify-between border-b border-cyan-400/30 bg-[#071019]/95 px-2"
          onPointerDown={handleFloatingHeaderPointerDown}
          onPointerMove={handleFloatingHeaderPointerMove}
          onPointerUp={stopFloatingDrag}
          onPointerCancel={stopFloatingDrag}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="border border-cyan-400/40 bg-black/40 px-1.5 py-0.5 text-[9px] font-bold tracking-[0.12em] text-cyan-300">
              MISSION MAP
            </span>
            <span className="truncate text-[8px] uppercase tracking-[0.1em] text-slate-500">
              Drag to move
            </span>
          </div>
          <button
            type="button"
            title="Close the expanded Mission Map and return it to the compact view."
            aria-label="Close mission map"
            className="flex h-7 w-7 shrink-0 items-center justify-center border border-slate-600 bg-black/60 text-slate-300 hover:border-cyan-400 hover:text-cyan-300"
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={closeFloatingMap}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Map tiles                                                          */}
      {/* ------------------------------------------------------------------ */}

      <div className="absolute inset-0 overflow-hidden bg-[#0a1016]">
        {visibleTiles.map(
          (visibleTile) => {
            const key =
              tileKeyFromCoordinate(
                visibleTile.tile,
              );

            const satelliteUrl =
              mapLayer === "SATELLITE"
                ? buildEsriWorldImageryTileUrl(
                    visibleTile.tile,
                  )
                : null;

            return (
              <MapTile
                key={`${mapLayer}-${key}`}
                tile={visibleTile}
                loadedImage={
                  mapLayer === "STREET"
                    ? loadedTiles.get(key) ?? null
                    : null
                }
                directImageUrl={satelliteUrl}
                onDirectImageError={() => {
                  setTileErrors(
                    (previous) => {
                      if (previous.has(key)) {
                        return previous;
                      }

                      const next = new Set(previous);
                      next.add(key);
                      return next;
                    },
                  );
                }}
              />
            );
          },
        )}

        {/* Dark operational overlay */}
        <div
          className={[
            "pointer-events-none absolute inset-0",
            mapLayer === "SATELLITE"
              ? "bg-slate-950/10"
              : "bg-slate-950/35",
          ].join(" ")}
        />

        {/* Technical grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(120,180,220,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(120,180,220,0.18) 1px, transparent 1px)",
            backgroundSize:
              "64px 64px",
          }}
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Routes                                                             */}
      {/* ------------------------------------------------------------------ */}

      {mapState?.droneRoute &&
        mapState.droneRoute.points.length >
          1 && (
          <RouteLine
            coordinates={mapState.droneRoute.points.map(
              (point) =>
                point.position,
            )}
            viewport={viewport}
            className="text-cyan-400"
          />
        )}

      {mapState?.fastyRoute &&
        mapState.fastyRoute.points.length >
          1 && (
          <RouteLine
            coordinates={mapState.fastyRoute.points.map(
              (point) =>
                point.position,
            )}
            viewport={viewport}
            className="text-orange-400"
          />
        )}

      {/* ------------------------------------------------------------------ */}
      {/* Search area                                                         */}
      {/* ------------------------------------------------------------------ */}

      {mapState?.searchArea &&
        mapState.searchArea.polygon.length >
          2 && (
          <svg
            className="pointer-events-none absolute inset-0 z-[8] h-full w-full"
            viewBox={`0 0 ${size.width} ${size.height}`}
            preserveAspectRatio="none"
          >
            <polygon
              points={mapState.searchArea.polygon
                .map(
                  (coordinate) => {
                    const point =
                      geoToScreen(
                        coordinate,
                        viewport,
                      );

                    return `${point.x},${point.y}`;
                  },
                )
                .join(" ")}
              fill="rgba(234,179,8,0.06)"
              stroke="currentColor"
              strokeWidth="1"
              strokeDasharray="5 4"
              className="text-yellow-400"
            />
          </svg>
        )}

      {/* ------------------------------------------------------------------ */}
      {/* Geofence                                                           */}
      {/* ------------------------------------------------------------------ */}

      {mapState?.geofence &&
        mapState.geofence.polygon.length >
          2 && (
          <svg
            className="pointer-events-none absolute inset-0 z-[9] h-full w-full"
            viewBox={`0 0 ${size.width} ${size.height}`}
            preserveAspectRatio="none"
          >
            <polygon
              points={mapState.geofence.polygon
                .map(
                  (coordinate) => {
                    const point =
                      geoToScreen(
                        coordinate,
                        viewport,
                      );

                    return `${point.x},${point.y}`;
                  },
                )
                .join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="10 6"
              className="text-red-400"
            />
          </svg>
        )}

      {/* ------------------------------------------------------------------ */}
      {/* Measurement                                                        */}
      {/* ------------------------------------------------------------------ */}

      {measurementLine && (
        <svg
          className="pointer-events-none absolute inset-0 z-20 h-full w-full"
          viewBox={`0 0 ${size.width} ${size.height}`}
          preserveAspectRatio="none"
        >
          <line
            x1={
              measurementLine.start.x
            }
            y1={
              measurementLine.start.y
            }
            x2={
              measurementLine.end.x
            }
            y2={
              measurementLine.end.y
            }
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="6 4"
            className="text-yellow-300"
          />

          <circle
            cx={
              measurementLine.start.x
            }
            cy={
              measurementLine.start.y
            }
            r="4"
            className="fill-yellow-300"
          />

          <circle
            cx={
              measurementLine.end.x
            }
            cy={
              measurementLine.end.y
            }
            r="4"
            className="fill-yellow-300"
          />
        </svg>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Mission objects                                                    */}
      {/* ------------------------------------------------------------------ */}

      {homeScreen && (
        <div
          className="pointer-events-none absolute z-25 -translate-x-1/2 -translate-y-1/2"
          style={{
            left: homeScreen.x,
            top: homeScreen.y,
          }}
        >
          <div className="relative flex h-9 w-9 items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-emerald-400/40 bg-emerald-400/10" />
            <div className="relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-emerald-300 bg-black/90 shadow-lg shadow-emerald-400/30">
              <Home
                className="h-4 w-4 text-emerald-300"
                strokeWidth={2}
              />
            </div>
            <div className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap border border-emerald-500/50 bg-black/90 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-emerald-300">
              HOME
            </div>
          </div>
        </div>
      )}

      {droneScreen && (
        <VehicleMarker
          vehicle={
            droneVehicle
          }
          screen={
            droneScreen
          }
        />
      )}

      {fastyScreen && (
        <VehicleMarker
          vehicle={
            fastyVehicle
          }
          screen={
            fastyScreen
          }
        />
      )}

      {target &&
        targetScreen && (
          <TargetMarker
            target={
              target
            }
            screen={
              targetScreen
            }
            onSelect={
              onTargetSelect
            }
          />
        )}

      {laptopScreen && (
        <div
          className="pointer-events-none absolute z-35 -translate-x-1/2 -translate-y-full"
          style={{
            left: laptopScreen.x,
            top: laptopScreen.y,
          }}
        >
          <div className="relative flex h-9 w-9 items-center justify-center">
            <div className="absolute inset-0 animate-pulse rounded-full bg-red-500/25 blur-sm" />
            <div
              className="relative h-7 w-7 rotate-45 rounded-[55%_55%_55%_0] border-2 border-white bg-red-500 shadow-lg shadow-red-500/50"
              aria-hidden="true"
            >
              <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-white" />
            </div>
            <div className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap border border-red-400/50 bg-black/90 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-red-200">
              LAPTOP
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Top status                                                         */}
      {/* ------------------------------------------------------------------ */}

      <div
        className={[
          "pointer-events-none absolute left-3 top-3 z-50 flex items-center gap-2",
          compactUi ? "hidden" : "",
        ].join(" ")}
      >
        <div className="border border-cyan-500/40 bg-black/80 px-2 py-1 font-mono text-[10px] tracking-widest text-cyan-300">
          MISSION MAP
        </div>

        <div className="border border-slate-600 bg-black/75 px-2 py-1 font-mono text-[10px] text-slate-300">
          Z {mapZoom.toFixed(1)}
        </div>

        <div className="border border-slate-600 bg-black/75 px-2 py-1 font-mono text-[10px] text-slate-400">
          {mapCenter.lat.toFixed(
            4,
          )}
          °
          {" "}
          {mapCenter.lon.toFixed(
            4,
          )}
          °
        </div>

        {locationState === "LOCATING" && (
          <div className="border border-yellow-500/50 bg-black/85 px-2 py-1 font-mono text-[10px] font-semibold tracking-wider text-yellow-300">
            LOCATING LAPTOP…
          </div>
        )}

        {locationState === "READY" && (
          <div className="border border-cyan-500/40 bg-black/85 px-2 py-1 font-mono text-[10px] font-semibold tracking-wider text-cyan-300">
            LAPTOP LOCATION
          </div>
        )}

        {locationState === "DENIED" && (
          <div className="border border-red-500/40 bg-black/85 px-2 py-1 font-mono text-[10px] font-semibold tracking-wider text-red-300">
            LOCATION ACCESS DENIED
          </div>
        )}

        {fastyOnline && (
          <div
            className={[
              "border bg-black/85 px-2 py-1 font-mono text-[10px] font-semibold tracking-wider",
              fastyGpsAvailable
                ? "border-orange-500/50 text-orange-300"
                : "border-orange-500/40 text-orange-300",
            ].join(" ")}
          >
            SROTA ONLINE · {
              fastyGpsAvailable
                ? "GPS FIX"
                : "GPS NO FIX"
            }
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Map controls                                                       */}
      {/* ------------------------------------------------------------------ */}

      <div
        className="absolute right-3 top-3 z-50 flex flex-col items-end gap-1"
      >
        <div className="flex items-center border border-slate-600 bg-black/85 p-0.5 font-mono text-[9px] tracking-wider">
          <button
            type="button"
            title="Switch the mission map to the street/road view."
            className={[
              "flex h-7 items-center gap-1.5 px-2",
              mapLayer === "STREET"
                ? "bg-cyan-500/15 text-cyan-300"
                : "text-slate-400 hover:text-slate-200",
            ].join(" ")}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={() => {
              setTileErrors(new Set());
              setMapLayer("STREET");
            }}
          >
            <Layers className="h-3.5 w-3.5" />
            STREET
          </button>

          <button
            type="button"
            title="Switch the mission map to satellite imagery."
            className={[
              "flex h-7 items-center gap-1.5 border-l border-slate-700 px-2",
              mapLayer === "SATELLITE"
                ? "bg-cyan-500/15 text-cyan-300"
                : "text-slate-400 hover:text-slate-200",
            ].join(" ")}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={() => {
              setMapZoom((current) =>
                Math.min(
                  current,
                  MAX_SATELLITE_ZOOM,
                ),
              );
              setMapLayer("SATELLITE");
            }}
          >
            SATELLITE
          </button>
        </div>

        <div className="flex flex-col gap-1">
        <button
          type="button"
          title="Zoom in to view a smaller geographic area with more detail."
          className="flex h-8 w-8 items-center justify-center border border-slate-600 bg-black/80 text-slate-300 hover:border-cyan-500 hover:text-cyan-300"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={() =>
            changeZoom(
              ZOOM_STEP,
            )
          }
        >
          <Plus className="h-4 w-4" />
        </button>

        <button
          type="button"
          title="Zoom out to view a larger geographic area."
          className="flex h-8 w-8 items-center justify-center border border-slate-600 bg-black/80 text-slate-300 hover:border-cyan-500 hover:text-cyan-300"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={() =>
            changeZoom(
              -ZOOM_STEP,
            )
          }
        >
          <Minus className="h-4 w-4" />
        </button>

        <button
          type="button"
          title="Reset the map to its starting center and zoom level."
          className="mt-1 flex h-8 w-8 items-center justify-center border border-slate-600 bg-black/80 text-slate-300 hover:border-cyan-500 hover:text-cyan-300"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={
            resetView
          }
        >
          <RotateCcw className="h-4 w-4" />
        </button>

        <button
          type="button"
          title="Center the map on the ground-control laptop location."
          className={[
            "flex h-8 w-8 items-center justify-center border bg-black/80",
            locationState === "LOCATING"
              ? "border-yellow-400 text-yellow-300"
              : locationState === "READY"
                ? "border-cyan-500 text-cyan-300"
                : "border-slate-600 text-slate-300",
          ].join(" ")}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={recenterOnLaptop}
        >
          <LocateFixed
            className={[
              "h-4 w-4",
              locationState === "LOCATING"
                ? "animate-pulse"
                : "",
            ].join(" ")}
          />
        </button>

        <button
          type="button"
          title="Center the map on the Drone position and continue following it."
          disabled={
            !isValidCoordinate(
              dronePosition,
            )
          }
          className="flex h-8 w-8 items-center justify-center border border-cyan-600/50 bg-black/80 text-cyan-300 disabled:cursor-not-allowed disabled:opacity-30"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={
            centerOnDrone
          }
        >
          <Crosshair className="h-4 w-4" />
        </button>

        <button
          type="button"
          title="Center the map on the SROTA position and continue following it."
          disabled={
            !isUsableVehicleCoordinate(
              liveFastyPosition,
            )
          }
          className="flex h-8 w-8 items-center justify-center border border-orange-600/50 bg-black/80 text-orange-300 disabled:cursor-not-allowed disabled:opacity-30"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={
            centerOnFasty
          }
        >
          <LocateFixed className="h-4 w-4" />
        </button>

        <button
          type="button"
          title="Measure distance and bearing between two points on the map."
          className={[
            "flex h-8 w-8 items-center justify-center border bg-black/80",
            measureMode
              ? "border-yellow-400 text-yellow-300"
              : "border-slate-600 text-slate-300",
          ].join(" ")}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={() => {
            setMeasureMode(
              (current) =>
                !current,
            );

            setMeasurementStart(
              null,
            );

            setMeasurementEnd(
              null,
            );
          }}
        >
          <Ruler className="h-4 w-4" />
        </button>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Measurement information                                            */}
      {/* ------------------------------------------------------------------ */}

      {!compactUi && measureMode && (
        <div className="absolute bottom-3 left-3 z-50 border border-yellow-500/40 bg-black/85 px-3 py-2 font-mono text-[10px] text-yellow-300">
          {!measurementStart
            ? "SELECT START POINT"
            : !measurementEnd
              ? "SELECT END POINT"
              : measurement
                ? `${formatDistance(measurement.distance)} · ${formatBearing(measurement.bearing)}`
                : "MEASURING"}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Target information                                                 */}
      {/* ------------------------------------------------------------------ */}

      {!compactUi && target?.position && (
        <div className="absolute bottom-3 right-3 z-50 border border-red-500/40 bg-black/85 px-3 py-2 font-mono text-[10px]">
          <div className="mb-1 flex items-center gap-2 text-red-300">
            <Target className="h-3 w-3" />
            <span>
              RESCUE TARGET
            </span>
          </div>

          <div className="text-slate-300">
            {formatCoordinate(
              target.position,
            )}
          </div>

          <div className="mt-1 text-slate-500">
            STATUS:{" "}
            <span className="text-red-300">
              {target.status}
            </span>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Loading/error status                                               */}
      {/* ------------------------------------------------------------------ */}

      {!compactUi && mapLayer === "STREET" &&
        visibleTiles.length >
          0 &&
        loadedTiles.size ===
          0 && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2 border border-cyan-500/30 bg-black/75 px-3 py-2 font-mono text-[10px] tracking-wider text-cyan-300">
            LOADING MAP DATA...
          </div>
        )}

      {!compactUi && tileErrors.size >
        0 && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-50 -translate-x-1/2 border border-red-500/30 bg-black/80 px-2 py-1 font-mono text-[9px] text-red-300">
          MAP TILE ERRORS:{" "}
          {tileErrors.size}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Attribution                                                        */}
      {/* ------------------------------------------------------------------ */}

      {!compactUi && (
        <div className="pointer-events-none absolute bottom-1 right-1 z-40 bg-black/60 px-1 font-mono text-[8px] text-slate-500">
        {mapLayer === "SATELLITE"
          ? "© Esri, Maxar, Earthstar Geographics, and the GIS User Community"
          : "© OpenStreetMap contributors"}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Center marker                                                       */}
      {/* ------------------------------------------------------------------ */}

      {!compactUi && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 opacity-20">
          <ZoomIn className="h-4 w-4 text-cyan-300" />
        </div>
      )}

      {compactUi && !isFloatingMapOpen && (
        <button
          type="button"
          title="Expand the Mission Map into a larger floating window."
          aria-label="Expand mission map"
          className="absolute bottom-2 right-2 z-[80] flex h-8 w-8 items-center justify-center border border-cyan-400/60 bg-black/85 text-cyan-300 shadow-lg shadow-black/40 hover:border-cyan-300 hover:bg-black/95 hover:text-cyan-200"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={openFloatingMap}
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Hidden semantic state                                               */}
      {/* ------------------------------------------------------------------ */}

      <div
        className="sr-only"
        aria-live="polite"
      >
        Map center{" "}
        {formatCoordinate(
          mapCenter,
        )}
        , zoom{" "}
        {mapZoom.toFixed(1)}
        . Follow{" "}
        {followVehicle ??
          "none"}
      </div>
    </div>
  );

  if (compactUi && isFloatingMapOpen && typeof document !== "undefined") {
    return (
      <>
        <div
          aria-hidden="true"
          className={[
            "h-full w-full",
            className ?? "",
            "pointer-events-none opacity-0",
          ].join(" ")}
        />
        {createPortal(
          mapRoot,
          document.body,
        )}
      </>
    );
  }

  return mapRoot;
}