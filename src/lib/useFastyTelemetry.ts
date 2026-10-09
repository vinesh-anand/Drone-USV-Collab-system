import { useEffect, useState } from "react";
import {
  getRosbridgeClient,
  type RosbridgeConnectionState,
} from "./rosbridge";

export interface FastyState {
  connected: boolean;
  armed: boolean;
  guided: boolean;
  manualInput: boolean;
  mode: string;
  systemStatus: number;
}

export interface FastyAttitude {
  roll: number | null;
  pitch: number | null;
  yaw: number | null;
}

export interface FastyAngularVelocity {
  x: number | null;
  y: number | null;
  z: number | null;
}

export interface FastyAcceleration {
  x: number | null;
  y: number | null;
  z: number | null;
}

export interface FastyMagnetometer {
  x: number | null;
  y: number | null;
  z: number | null;
}

export interface FastyGps {
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  fixType: number | null;
  satellites: number | null;
}

export interface FastyBattery {
  percentage: number | null;
  voltage: number | null;
  current: number | null;
  present: boolean | null;
}

export interface FastyTelemetry {
  state: FastyState;
  attitude: FastyAttitude;
  angularVelocity: FastyAngularVelocity;
  acceleration: FastyAcceleration;
  magnetometer: FastyMagnetometer;
  gps: FastyGps;
  battery: FastyBattery;
  heading: number | null;
  groundSpeed: number | null;
  climbRate: number | null;
  altitude: number | null;
}

interface RosStateMessage {
  connected?: boolean;
  armed?: boolean;
  guided?: boolean;
  manual_input?: boolean;
  mode?: string;
  system_status?: number;
}

interface RosImuMessage {
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

interface RosMagnetometerMessage {
  magnetic_field?: {
    x?: number;
    y?: number;
    z?: number;
  };
}

interface RosFloat64Message {
  data?: number;
}

interface RosVfrHudMessage {
  airspeed?: number;
  groundspeed?: number;
  heading?: number;
  throttle?: number;
  altitude?: number;
  climb?: number;
}

interface RosNavSatFixMessage {
  latitude?: number;
  longitude?: number;
  altitude?: number;
  status?: {
    status?: number;
  };
}

interface RosGpsRawMessage {
  fix_type?: number;
  satellites_visible?: number;
}

interface RosBatteryStateMessage {
  voltage?: number;
  current?: number;
  percentage?: number;
  present?: boolean;
}

const initialState: FastyState = {
  connected: false,
  armed: false,
  guided: false,
  manualInput: false,
  mode: "UNKNOWN",
  systemStatus: 0,
};

const initialTelemetry: FastyTelemetry = {
  state: initialState,

  attitude: {
    roll: null,
    pitch: null,
    yaw: null,
  },

  angularVelocity: {
    x: null,
    y: null,
    z: null,
  },

  acceleration: {
    x: null,
    y: null,
    z: null,
  },

  magnetometer: {
    x: null,
    y: null,
    z: null,
  },

  gps: {
    latitude: null,
    longitude: null,
    altitude: null,
    fixType: null,
    satellites: null,
  },

  battery: {
    percentage: null,
    voltage: null,
    current: null,
    present: null,
  },

  heading: null,
  groundSpeed: null,
  climbRate: null,
  altitude: null,
};

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

/**
 * Converts a quaternion into aerospace-style Euler angles.
 *
 * Output:
 *   roll  = rotation around X
 *   pitch = rotation around Y
 *   yaw   = rotation around Z
 *
 * Returned values are degrees.
 */
function quaternionToEuler(
  x: number,
  y: number,
  z: number,
  w: number,
): FastyAttitude {
  const sinrCosp =
    2 * (w * x + y * z);

  const cosrCosp =
    1 - 2 * (x * x + y * y);

  const roll =
    Math.atan2(
      sinrCosp,
      cosrCosp,
    );

  const sinp =
    2 * (w * y - z * x);

  const pitch =
    Math.abs(sinp) >= 1
      ? Math.sign(sinp) *
        (Math.PI / 2)
      : Math.asin(sinp);

  const sinyCosp =
    2 * (w * z + x * y);

  const cosyCosp =
    1 - 2 * (y * y + z * z);

  const yaw =
    Math.atan2(
      sinyCosp,
      cosyCosp,
    );

  return {
    roll:
      (roll * 180) /
      Math.PI,

    pitch:
      (pitch * 180) /
      Math.PI,

    yaw:
      (yaw * 180) /
      Math.PI,
  };
}

export function useFastyTelemetry() {
  const [rosConnection, setRosConnection] =
    useState<RosbridgeConnectionState>(
      "DISCONNECTED",
    );

  const [telemetry, setTelemetry] =
    useState<FastyTelemetry>(
      initialTelemetry,
    );

  useEffect(() => {
    const client =
      getRosbridgeClient();

    const removeConnectionListener =
      client.onConnectionStateChange(
        setRosConnection,
      );

    client.connect();

    const unsubscribeState =
      client.subscribe(
        {
          topic:
            "/mavros_fasty/mavros/state",
          type:
            "mavros_msgs/State",
        },
        (message) => {
          const msg =
            message.msg as
              | RosStateMessage
              | undefined;

          if (!msg) {
            return;
          }

          setTelemetry(
            (previous) => ({
              ...previous,
              state: {
                connected:
                  Boolean(
                    msg.connected,
                  ),
                armed:
                  Boolean(
                    msg.armed,
                  ),
                guided:
                  Boolean(
                    msg.guided,
                  ),
                manualInput:
                  Boolean(
                    msg.manual_input,
                  ),
                mode:
                  msg.mode ??
                  "UNKNOWN",
                systemStatus:
                  msg.system_status ??
                  0,
              },
            }),
          );
        },
      );

    const unsubscribeImu =
      client.subscribe(
        {
          topic:
            "/mavros_fasty/mavros/imu/data",
          type:
            "sensor_msgs/Imu",
        },
        (message) => {
          const msg =
            message.msg as
              | RosImuMessage
              | undefined;

          if (!msg) {
            return;
          }

          const orientation =
            msg.orientation;

          const angularVelocity =
            msg.angular_velocity;

          const acceleration =
            msg.linear_acceleration;

          let attitude:
            | FastyAttitude
            | null = null;

          if (
            orientation &&
            Number.isFinite(
              orientation.x,
            ) &&
            Number.isFinite(
              orientation.y,
            ) &&
            Number.isFinite(
              orientation.z,
            ) &&
            Number.isFinite(
              orientation.w,
            )
          ) {
            attitude =
              quaternionToEuler(
                orientation.x!,
                orientation.y!,
                orientation.z!,
                orientation.w!,
              );
          }

          setTelemetry(
            (previous) => ({
              ...previous,

              attitude:
                attitude ??
                previous.attitude,

              angularVelocity: {
                x: finiteOrNull(
                  angularVelocity?.x,
                ),
                y: finiteOrNull(
                  angularVelocity?.y,
                ),
                z: finiteOrNull(
                  angularVelocity?.z,
                ),
              },

              acceleration: {
                x: finiteOrNull(
                  acceleration?.x,
                ),
                y: finiteOrNull(
                  acceleration?.y,
                ),
                z: finiteOrNull(
                  acceleration?.z,
                ),
              },
            }),
          );
        },
      );

    const unsubscribeMagnetometer =
      client.subscribe(
        {
          topic:
            "/mavros_fasty/mavros/imu/mag",
          type:
            "sensor_msgs/MagneticField",
        },
        (message) => {
          const msg =
            message.msg as
              | RosMagnetometerMessage
              | undefined;

          if (!msg) {
            return;
          }

          setTelemetry(
            (previous) => ({
              ...previous,

              magnetometer: {
                x: finiteOrNull(
                  msg.magnetic_field?.x,
                ),
                y: finiteOrNull(
                  msg.magnetic_field?.y,
                ),
                z: finiteOrNull(
                  msg.magnetic_field?.z,
                ),
              },
            }),
          );
        },
      );

    const unsubscribeGpsPosition =
      client.subscribe(
        {
          topic:
            "/mavros_fasty/mavros/global_position/global",
          type:
            "sensor_msgs/NavSatFix",
        },
        (message) => {
          const msg =
            message.msg as
              | RosNavSatFixMessage
              | undefined;

          if (!msg) {
            return;
          }

          setTelemetry(
            (previous) => ({
              ...previous,
              gps: {
                ...previous.gps,
                latitude: finiteOrNull(
                  msg.latitude,
                ),
                longitude: finiteOrNull(
                  msg.longitude,
                ),
                altitude: finiteOrNull(
                  msg.altitude,
                ),
                fixType:
                  typeof msg.status?.status ===
                  "number"
                    ? msg.status.status
                    : previous.gps.fixType,
              },
            }),
          );
        },
      );

    const unsubscribeGpsRaw =
      client.subscribe(
        {
          topic:
            "/mavros_fasty/mavros/gpsstatus/gps1/raw",
          type:
            "mavros_msgs/GPSRAW",
        },
        (message) => {
          const msg =
            message.msg as
              | RosGpsRawMessage
              | undefined;

          if (!msg) {
            return;
          }

          setTelemetry(
            (previous) => ({
              ...previous,
              gps: {
                ...previous.gps,
                fixType:
                  typeof msg.fix_type ===
                  "number"
                    ? msg.fix_type
                    : previous.gps.fixType,
                satellites:
                  typeof msg.satellites_visible ===
                  "number"
                    ? msg.satellites_visible
                    : previous.gps.satellites,
              },
            }),
          );
        },
      );

    const unsubscribeBattery =
      client.subscribe(
        {
          topic:
            "/mavros_fasty/mavros/battery",
          type:
            "sensor_msgs/BatteryState",
        },
        (message) => {
          const msg =
            message.msg as
              | RosBatteryStateMessage
              | undefined;

          if (!msg) {
            return;
          }

          const rawPercentage =
  finiteOrNull(
    msg.percentage,
  );

const percentage =
  rawPercentage !== null
    ? rawPercentage >= 0 &&
      rawPercentage <= 1
      ? rawPercentage * 100
      : rawPercentage >= 0 &&
        rawPercentage <= 100
        ? rawPercentage
        : null
    : null;

          const voltage =
            finiteOrNull(
              msg.voltage,
            );

          const current =
            finiteOrNull(
              msg.current,
            );

          setTelemetry(
            (previous) => ({
              ...previous,
              battery: {
                percentage:
  percentage !== null
    ? percentage
    : previous.battery.percentage,

                voltage:
                  voltage !== null &&
                  voltage >= 0
                    ? voltage
                    : previous.battery.voltage,

                current,
                present:
                  typeof msg.present ===
                  "boolean"
                    ? msg.present
                    : previous.battery.present,
              },
            }),
          );
        },
      );

    const unsubscribeHeading =
      client.subscribe(
        {
          topic:
            "/mavros_fasty/mavros/global_position/compass_hdg",
          type:
            "std_msgs/Float64",
        },
        (message) => {
          const msg =
            message.msg as
              | RosFloat64Message
              | undefined;

          if (!msg) {
            return;
          }

          const heading =
            finiteOrNull(
              msg.data,
            );

          setTelemetry(
            (previous) => ({
              ...previous,
              heading,
            }),
          );
        },
      );

    const unsubscribeVfrHud =
      client.subscribe(
        {
          topic:
            "/mavros_fasty/mavros/vfr_hud",
          type:
            "mavros_msgs/VFR_HUD",
        },
        (message) => {
          const msg =
            message.msg as
              | RosVfrHudMessage
              | undefined;

          if (!msg) {
            return;
          }

          setTelemetry(
            (previous) => ({
              ...previous,

              groundSpeed:
                finiteOrNull(
                  msg.groundspeed,
                ),

              climbRate:
                finiteOrNull(
                  msg.climb,
                ),

              altitude:
                finiteOrNull(
                  msg.altitude,
                ),

              heading:
                finiteOrNull(
                  msg.heading,
                ) ??
                previous.heading,
            }),
          );
        },
      );

    return () => {
      unsubscribeState();
      unsubscribeImu();
      unsubscribeMagnetometer();
      unsubscribeGpsPosition();
      unsubscribeGpsRaw();
      unsubscribeBattery();
      unsubscribeHeading();
      unsubscribeVfrHud();
      removeConnectionListener();
    };
  }, []);

  return {
    rosConnection,
    telemetry,
    state: telemetry.state,
  };
}