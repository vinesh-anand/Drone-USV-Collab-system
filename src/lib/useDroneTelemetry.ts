import { useEffect, useState } from "react";
import {
  getRosbridgeClient,
  type RosbridgeConnectionState,
} from "./rosbridge";

const DRONE_NS = "/mavros_drone/mavros";

export interface DroneState {
  connected: boolean;
  armed: boolean;
  guided: boolean;
  manualInput: boolean;
  mode: string;
  systemStatus: number;
}

export interface DroneAttitude {
  roll: number | null;
  pitch: number | null;
  yaw: number | null;
}

export interface DroneImu {
  angularVelocity: {
    x: number | null;
    y: number | null;
    z: number | null;
  };
  linearAcceleration: {
    x: number | null;
    y: number | null;
    z: number | null;
  };
}

export interface DronePosition {
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  gpsFix: boolean;
}

export interface DroneFlightData {
  airspeed: number | null;
  groundSpeed: number | null;
  heading: number | null;
  throttle: number | null;
  altitude: number | null;
  climb: number | null;
}

export interface DroneBattery {
  voltage: number | null;
  current: number | null;
  percentage: number | null;
  present: boolean;
}

export interface DroneRc {
  rssi: number | null;
  channels: number[];
}

export interface DroneTelemetry {
  state: DroneState;
  attitude: DroneAttitude;
  imu: DroneImu;
  position: DronePosition;
  flight: DroneFlightData;
  battery: DroneBattery;
  rc: DroneRc;
  satellites: number | null;
}

export interface UseDroneTelemetryResult {
  rosConnection: boolean;
  telemetry: DroneTelemetry;
}

const DEFAULT_STATE: DroneState = {
  connected: false,
  armed: false,
  guided: false,
  manualInput: false,
  mode: "N/A",
  systemStatus: 0,
};

const DEFAULT_TELEMETRY: DroneTelemetry = {
  state: DEFAULT_STATE,

  attitude: {
    roll: null,
    pitch: null,
    yaw: null,
  },

  imu: {
    angularVelocity: {
      x: null,
      y: null,
      z: null,
    },

    linearAcceleration: {
      x: null,
      y: null,
      z: null,
    },
  },

  position: {
    latitude: null,
    longitude: null,
    altitude: null,
    gpsFix: false,
  },

  flight: {
    airspeed: null,
    groundSpeed: null,
    heading: null,
    throttle: null,
    altitude: null,
    climb: null,
  },

  battery: {
    voltage: null,
    current: null,
    percentage: null,
    present: false,
  },

  rc: {
    rssi: null,
    channels: [],
  },

  satellites: null,
};

function normalizeAngle(angle: number): number {
  let normalized = angle % 360;

  if (normalized < 0) {
    normalized += 360;
  }

  return normalized;
}

function quaternionToEuler(
  x: number,
  y: number,
  z: number,
  w: number,
): DroneAttitude {
  const sinrCosp = 2 * (w * x + y * z);
  const cosrCosp = 1 - 2 * (x * x + y * y);

  const roll = Math.atan2(sinrCosp, cosrCosp);

  const sinp = 2 * (w * y - z * x);

  const pitch =
    Math.abs(sinp) >= 1
      ? Math.sign(sinp) * (Math.PI / 2)
      : Math.asin(sinp);

  const sinyCosp = 2 * (w * z + x * y);
  const cosyCosp = 1 - 2 * (y * y + z * z);

  const yaw = Math.atan2(sinyCosp, cosyCosp);

  return {
    roll: (roll * 180) / Math.PI,
    pitch: (pitch * 180) / Math.PI,
    yaw: normalizeAngle((yaw * 180) / Math.PI),
  };
}

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function extractNumber(value: unknown): number | null {
  return validNumber(value) ? value : null;
}

function isValidGps(
  latitude: unknown,
  longitude: unknown,
): boolean {
  return (
    validNumber(latitude) &&
    validNumber(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude !== 0 &&
    longitude !== 0
  );
}

function normalizeBattery(
  voltage: unknown,
  current: unknown,
  percentage: unknown,
  present: unknown,
): DroneBattery {
  const voltageValue = extractNumber(voltage);
  const currentValue = extractNumber(current);
  const rawPercentageValue = extractNumber(percentage);

  /*
   * sensor_msgs/BatteryState publishes percentage as a ratio from 0.0 to 1.0.
   * Keep compatibility with sources that may already provide 0 to 100.
   */
  const percentageValue =
    rawPercentageValue !== null &&
    rawPercentageValue >= 0 &&
    rawPercentageValue <= 1
      ? rawPercentageValue * 100
      : rawPercentageValue;

  /*
   * A standalone Pixhawk can publish a BatteryState message even when
   * no real flight battery is connected. Treat zero voltage / invalid
   * percentage as unavailable rather than displaying fake battery data.
   */
  const batteryAvailable =
    voltageValue !== null &&
    voltageValue > 0.1 &&
    percentageValue !== null &&
    percentageValue >= 0 &&
    percentageValue <= 100;

  return {
    voltage: batteryAvailable ? voltageValue : null,
    current: batteryAvailable ? currentValue : null,
    percentage: batteryAvailable ? percentageValue : null,
    present: batteryAvailable && present === true,
  };
}

export function useDroneTelemetry(): UseDroneTelemetryResult {
  const [rosConnectionState, setRosConnectionState] =
    useState<RosbridgeConnectionState>("DISCONNECTED");

  const [telemetry, setTelemetry] =
    useState<DroneTelemetry>(DEFAULT_TELEMETRY);

  useEffect(() => {
    const client = getRosbridgeClient();

    const removeConnectionListener =
      client.onConnectionStateChange(
        setRosConnectionState,
      );

    client.connect();

    const unsubscribeState = client.subscribe(
      {
        topic: `${DRONE_NS}/state`,
        type: "mavros_msgs/State",
      },
      (message) => {
        const msg = message.msg as
          | Partial<{
              connected: boolean;
              armed: boolean;
              guided: boolean;
              manual_input: boolean;
              mode: string;
              system_status: number;
            }>
          | undefined;

        if (!msg) {
          return;
        }

        setTelemetry((previous) => ({
          ...previous,

          state: {
            connected: msg.connected === true,
            armed: msg.armed === true,
            guided: msg.guided === true,
            manualInput: msg.manual_input === true,
            mode:
              typeof msg.mode === "string" &&
              msg.mode.length > 0
                ? msg.mode
                : "N/A",
            systemStatus: validNumber(
              msg.system_status,
            )
              ? msg.system_status
              : 0,
          },
        }));
      },
    );

    const unsubscribeImu = client.subscribe(
      {
        topic: `${DRONE_NS}/imu/data`,
        type: "sensor_msgs/Imu",
      },
      (message) => {
        const msg = message.msg as
          | {
              orientation?: {
                x?: number;
                y?: number;
                z?: number;
                w?: number;
              };
              angular_velocity?: {
                x?: number;
                y?: number;
                z?: number;
              };
              linear_acceleration?: {
                x?: number;
                y?: number;
                z?: number;
              };
            }
          | undefined;

        if (!msg) {
          return;
        }

        const orientation = msg.orientation ?? {};
        const angularVelocity =
          msg.angular_velocity ?? {};
        const linearAcceleration =
          msg.linear_acceleration ?? {};

        const attitude =
          validNumber(orientation.x) &&
          validNumber(orientation.y) &&
          validNumber(orientation.z) &&
          validNumber(orientation.w)
            ? quaternionToEuler(
                orientation.x,
                orientation.y,
                orientation.z,
                orientation.w,
              )
            : {
                roll: null,
                pitch: null,
                yaw: null,
              };

        setTelemetry((previous) => ({
          ...previous,

          attitude,

          imu: {
            angularVelocity: {
              x: extractNumber(
                angularVelocity.x,
              ),
              y: extractNumber(
                angularVelocity.y,
              ),
              z: extractNumber(
                angularVelocity.z,
              ),
            },

            linearAcceleration: {
              x: extractNumber(
                linearAcceleration.x,
              ),
              y: extractNumber(
                linearAcceleration.y,
              ),
              z: extractNumber(
                linearAcceleration.z,
              ),
            },
          },
        }));
      },
    );

    const unsubscribePosition = client.subscribe(
      {
        topic: `${DRONE_NS}/global_position/global`,
        type: "sensor_msgs/NavSatFix",
      },
      (message) => {
        const msg = message.msg as
          | {
              latitude?: number;
              longitude?: number;
              altitude?: number;
              status?: {
                status?: number;
              };
            }
          | undefined;

        if (!msg) {
          return;
        }

        const latitude = extractNumber(
          msg.latitude,
        );

        const longitude = extractNumber(
          msg.longitude,
        );

        const altitude = extractNumber(
          msg.altitude,
        );

        const gpsFix =
          msg.status &&
          validNumber(msg.status.status) &&
          msg.status.status >= 0 &&
          isValidGps(latitude, longitude);

        setTelemetry((previous) => ({
          ...previous,

          position: {
            latitude: gpsFix ? latitude : null,
            longitude: gpsFix ? longitude : null,
            altitude,
            gpsFix: Boolean(gpsFix),
          },
        }));
      },
    );

    const unsubscribeCompass = client.subscribe(
      {
        topic: `${DRONE_NS}/global_position/compass_hdg`,
        type: "std_msgs/Float64",
      },
      (message) => {
        const msg = message.msg as
          | {
              data?: number;
            }
          | undefined;

        if (!msg) {
          return;
        }

        const heading = extractNumber(msg.data);

        setTelemetry((previous) => ({
          ...previous,

          flight: {
            ...previous.flight,

            heading:
              heading !== null
                ? normalizeAngle(heading)
                : previous.flight.heading,
          },
        }));
      },
    );

    const unsubscribeVfrHud = client.subscribe(
      {
        topic: `${DRONE_NS}/vfr_hud`,
        type: "mavros_msgs/VFR_HUD",
      },
      (message) => {
        const msg = message.msg as
          | {
              airspeed?: number;
              groundspeed?: number;
              heading?: number;
              throttle?: number;
              altitude?: number;
              climb?: number;
            }
          | undefined;

        if (!msg) {
          return;
        }

        const vfrHeading =
          extractNumber(msg.heading);

        setTelemetry((previous) => ({
          ...previous,

          flight: {
            airspeed: extractNumber(
              msg.airspeed,
            ),

            groundSpeed: extractNumber(
              msg.groundspeed,
            ),

            heading:
              vfrHeading !== null
                ? normalizeAngle(vfrHeading)
                : previous.flight.heading,

            throttle: extractNumber(
              msg.throttle,
            ),

            altitude: extractNumber(
              msg.altitude,
            ),

            climb: extractNumber(
              msg.climb,
            ),
          },
        }));
      },
    );

    const unsubscribeBattery = client.subscribe(
      {
        topic: `${DRONE_NS}/battery`,
        type: "sensor_msgs/BatteryState",
      },
      (message) => {
        const msg = message.msg as
          | {
              voltage?: number;
              current?: number;
              percentage?: number;
              present?: boolean;
            }
          | undefined;

        if (!msg) {
          return;
        }

        setTelemetry((previous) => ({
          ...previous,

          battery: normalizeBattery(
            msg.voltage,
            msg.current,
            msg.percentage,
            msg.present,
          ),
        }));
      },
    );

    const unsubscribeRc = client.subscribe(
      {
        topic: `${DRONE_NS}/rc/in`,
        type: "mavros_msgs/RCIn",
      },
      (message) => {
        const msg = message.msg as
          | {
              rssi?: number;
              channels?: unknown;
            }
          | undefined;

        if (!msg) {
          return;
        }

        const channels = Array.isArray(
          msg.channels,
        )
          ? msg.channels.filter(validNumber)
          : [];

        const rssi = extractNumber(
          msg.rssi,
        );

        setTelemetry((previous) => ({
          ...previous,

          rc: {
            rssi,
            channels,
          },
        }));
      },
    );

    const unsubscribeSatellites = client.subscribe(
      {
        topic: `${DRONE_NS}/global_position/raw/satellites`,
        type: "std_msgs/UInt32",
      },
      (message) => {
        const msg = message.msg as
          | {
              data?: number;
            }
          | undefined;

        if (!msg) {
          return;
        }

        setTelemetry((previous) => ({
          ...previous,

          satellites: extractNumber(
            msg.data,
          ),
        }));
      },
    );

    return () => {
      unsubscribeState();
      unsubscribeImu();
      unsubscribePosition();
      unsubscribeCompass();
      unsubscribeVfrHud();
      unsubscribeBattery();
      unsubscribeRc();
      unsubscribeSatellites();

      removeConnectionListener();
    };
  }, []);

  return {
    rosConnection:
      rosConnectionState === "CONNECTED",

    telemetry,
  };
}