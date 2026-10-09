/**
 * Shared telemetry types and dashboard state for the DRONE + FASTY (SROTA)
 * cockpit.
 *
 * The real Drone telemetry stream is handled by useDroneTelemetry().
 * FASTY telemetry is handled by useFastyTelemetry().
 *
 * This hook intentionally keeps the shared dashboard/system snapshot while
 * consuming the dedicated real Drone telemetry hook as the single Drone
 * telemetry source.
 */

import { useEffect, useState } from "react";
import rosbridge from "@/lib/ros/rosbridge";
import { useDroneTelemetry } from "@/lib/useDroneTelemetry";

export type LinkState =
  | "ONLINE"
  | "OFFLINE"
  | "CONNECTING"
  | "DEGRADED"
  | "ERROR"
  | "UNKNOWN"
  | "UNAVAILABLE";

/** A telemetry field that may not be supplied by the real vehicle. */
export type Field<T> = {
  value: T;
  state: Exclude<LinkState, "ONLINE"> | "ONLINE";
};

export const ok = <T>(value: T): Field<T> => ({
  value,
  state: "ONLINE",
});

export const na = <T>(): Field<T> => ({
  value: null as unknown as T,
  state: "UNAVAILABLE",
});

export function fmt<T>(
  f: Field<T>,
  unit = "",
  digits?: number,
): string {
  if (
    f.state === "UNAVAILABLE" ||
    f.value === null ||
    f.value === undefined
  ) {
    return "N/A";
  }

  if (f.state === "UNKNOWN") {
    return "—";
  }

  const v =
    typeof f.value === "number" && digits !== undefined
      ? f.value.toFixed(digits)
      : String(f.value);

  return unit ? `${v} ${unit}` : v;
}

export interface DroneTelemetry {
  link: LinkState;
  model: string;
  lat: Field<number>;
  lon: Field<number>;
  altAmsl: Field<number>;
  altRel: Field<number>;
  heading: Field<number>;
  pitch: Field<number>;
  roll: Field<number>;
  yaw: Field<number>;
  groundSpeed: Field<number>;
  verticalSpeed: Field<number>;
  flightMode: Field<string>;
  armed: Field<boolean>;
  gpsFix: Field<string>;
  satellites: Field<number>;
  homeDistance: Field<number>;
  batteryPct: Field<number>;
  voltage: Field<number>;
  current: Field<number>;
  estMinutes: Field<number>;
  rcSignal: Field<number>;
  videoLink: Field<number>;
}

export interface FastyTelemetry {
  link: LinkState;
  platform: string;
  lat: Field<number>;
  lon: Field<number>;
  heading: Field<number>;
  speed: Field<number>;
  mode: Field<string>;
  rthStatus: Field<string>;
  homeDistance: Field<number>;
  droneDistance: Field<number>;
  depth: Field<number>;
  gpsStatus: Field<string>;
  satellites: Field<number>;
  linkQuality: Field<number>;
  motorStatus: Field<string>;
  missionStatus: Field<string>;
  batteryPct: Field<number>;
  voltage: Field<number>;
  current: Field<number>;
  estMinutes: Field<number>;
  systems: { label: string; value: string; state: LinkState }[];
  rescueStatus: Field<string>;
  payloadStatus: Field<string>;
  safetyStatus: Field<string>;
  payloadCapacity: Field<string>;
  maxSpeed: Field<string>;
  endurance: Field<string>;
}

export interface SystemTelemetry {
  gps: LinkState;
  link: LinkState;
  telemetry: LinkState;
  system: LinkState;
}

export interface TelemetrySnapshot {
  drone: DroneTelemetry;
  fasty: FastyTelemetry;
  system: SystemTelemetry;
  mission: { name: string | null; status: string };
  alerts: {
    id: string;
    severity: "info" | "warn" | "fault";
    text: string;
  }[];
}

const baseSnapshot: TelemetrySnapshot = {
  system: {
    gps: "UNAVAILABLE",
    link: "CONNECTING",
    telemetry: "CONNECTING",
    system: "CONNECTING",
  },

  mission: {
    name: null,
    status: "No active mission",
  },

  alerts: [],

  drone: {
    link: "UNAVAILABLE",
    model: "CUSTOM",
    lat: na<number>(),
    lon: na<number>(),
    altAmsl: na<number>(),
    altRel: na<number>(),
    heading: na<number>(),
    pitch: na<number>(),
    roll: na<number>(),
    yaw: na<number>(),
    groundSpeed: na<number>(),
    verticalSpeed: na<number>(),
    flightMode: na<string>(),
    armed: na<boolean>(),
    gpsFix: na<string>(),
    satellites: na<number>(),
    homeDistance: na<number>(),
    batteryPct: na<number>(),
    voltage: na<number>(),
    current: na<number>(),
    estMinutes: na<number>(),
    rcSignal: na<number>(),
    videoLink: na<number>(),
  },

  fasty: {
    link: "UNAVAILABLE",
    platform: "SROTA ROBOTIC LIFEBUOY",
    lat: na<number>(),
    lon: na<number>(),
    heading: na<number>(),
    speed: na<number>(),
    mode: na<string>(),
    rthStatus: na<string>(),
    homeDistance: na<number>(),
    droneDistance: na<number>(),
    depth: na<number>(),
    gpsStatus: na<string>(),
    satellites: na<number>(),
    linkQuality: na<number>(),
    motorStatus: na<string>(),
    missionStatus: na<string>(),
    batteryPct: na<number>(),
    voltage: na<number>(),
    current: na<number>(),
    estMinutes: na<number>(),
    systems: [
      { label: "Motors", value: "N/A", state: "UNAVAILABLE" },
      { label: "GPS", value: "N/A", state: "UNAVAILABLE" },
      { label: "RC Link", value: "N/A", state: "UNAVAILABLE" },
      { label: "Video Link", value: "N/A", state: "UNAVAILABLE" },
      { label: "Payload", value: "N/A", state: "UNAVAILABLE" },
      { label: "System", value: "N/A", state: "UNAVAILABLE" },
    ],
    rescueStatus: na<string>(),
    payloadStatus: na<string>(),
    safetyStatus: na<string>(),
    payloadCapacity: na<string>(),
    maxSpeed: na<string>(),
    endurance: na<string>(),
  },
};

function buildDroneSnapshot(
  live: ReturnType<typeof useDroneTelemetry>["telemetry"],
  rosConnection: ReturnType<typeof useDroneTelemetry>["rosConnection"],
): DroneTelemetry {
  const connected = live.state.connected && rosConnection;
  const gpsAvailable =
    connected &&
    live.position.gpsFix &&
    live.position.latitude !== null &&
    live.position.longitude !== null;

  const headingAvailable =
    connected && live.flight.heading !== null;

  const speedAvailable =
    connected && live.flight.groundSpeed !== null;

  const attitudeAvailable =
    connected &&
    (live.attitude.roll !== null ||
      live.attitude.pitch !== null ||
      live.attitude.yaw !== null);

  const batteryAvailable =
    connected && live.battery.percentage !== null;

  const rcAvailable =
    connected && live.rc.rssi !== null;

  const satellitesAvailable =
    connected && live.satellites !== null;

  const link: LinkState = connected ? "ONLINE" : "OFFLINE";

  return {
    link,

    model: "CUSTOM",

    lat:
      gpsAvailable && live.position.latitude !== null
        ? ok(live.position.latitude)
        : na<number>(),

    lon:
      gpsAvailable && live.position.longitude !== null
        ? ok(live.position.longitude)
        : na<number>(),

    altAmsl:
      connected && live.position.altitude !== null
        ? ok(live.position.altitude)
        : na<number>(),

    altRel:
      connected && live.flight.altitude !== null
        ? ok(live.flight.altitude)
        : na<number>(),

    heading:
      headingAvailable && live.flight.heading !== null
        ? ok(live.flight.heading)
        : na<number>(),

    pitch:
      attitudeAvailable && live.attitude.pitch !== null
        ? ok(live.attitude.pitch)
        : na<number>(),

    roll:
      attitudeAvailable && live.attitude.roll !== null
        ? ok(live.attitude.roll)
        : na<number>(),

    yaw:
      attitudeAvailable && live.attitude.yaw !== null
        ? ok(live.attitude.yaw)
        : na<number>(),

    groundSpeed:
      speedAvailable && live.flight.groundSpeed !== null
        ? ok(live.flight.groundSpeed)
        : na<number>(),

    verticalSpeed:
      connected && live.flight.climb !== null
        ? ok(live.flight.climb)
        : na<number>(),

    flightMode:
      connected && live.state.mode !== "N/A"
        ? ok(live.state.mode)
        : na<string>(),

    armed:
      connected
        ? ok(live.state.armed)
        : na<boolean>(),

    gpsFix:
      gpsAvailable
        ? ok("FIX")
        : connected
          ? ok("NO FIX")
          : na<string>(),

    satellites:
      satellitesAvailable && live.satellites !== null
        ? ok(live.satellites)
        : na<number>(),

    homeDistance: na<number>(),

    batteryPct:
      batteryAvailable && live.battery.percentage !== null
        ? ok(live.battery.percentage)
        : na<number>(),

    voltage:
      connected && live.battery.voltage !== null
        ? ok(live.battery.voltage)
        : na<number>(),

    current:
      connected && live.battery.current !== null
        ? ok(live.battery.current)
        : na<number>(),

    estMinutes: na<number>(),

    rcSignal:
      rcAvailable && live.rc.rssi !== null
        ? ok(live.rc.rssi)
        : na<number>(),

    videoLink: na<number>(),
  };
}

export function useTelemetry(): TelemetrySnapshot {
  const droneTelemetry = useDroneTelemetry();

  const [snapshot, setSnapshot] =
    useState<TelemetrySnapshot>(baseSnapshot);

  const liveDrone = buildDroneSnapshot(
    droneTelemetry.telemetry,
    droneTelemetry.rosConnection,
  );

  useEffect(() => {
    const updateSystemConnection = () => {
      const connected = rosbridge.isConnected();
      const state: LinkState = connected
        ? "ONLINE"
        : "OFFLINE";

      setSnapshot((previous) => ({
        ...previous,

        system: {
          ...previous.system,
          gps:
            liveDrone.gpsFix.state === "ONLINE"
              ? liveDrone.gpsFix.value === "FIX"
                ? "ONLINE"
                : "DEGRADED"
              : previous.system.gps,
          link: state,
          telemetry: state,
          system: state,
        },

        drone: liveDrone,
      }));
    };

    updateSystemConnection();

    const connectionPoll = window.setInterval(
      updateSystemConnection,
      1000,
    );

    return () => {
      window.clearInterval(connectionPoll);
    };
  }, [
    liveDrone,
  ]);

  return {
    ...snapshot,
    drone: liveDrone,
  };
}

export const stateColor: Record<LinkState, string> = {
  ONLINE: "text-ok",
  OFFLINE: "text-neutral",
  CONNECTING: "text-warn",
  DEGRADED: "text-warn",
  ERROR: "text-fault",
  UNKNOWN: "text-neutral",
  UNAVAILABLE: "text-neutral",
};

export const stateDot: Record<LinkState, string> = {
  ONLINE: "bg-ok",
  OFFLINE: "bg-neutral",
  CONNECTING: "bg-warn",
  DEGRADED: "bg-warn",
  ERROR: "bg-fault",
  UNKNOWN: "bg-neutral",
  UNAVAILABLE: "bg-neutral",
};
