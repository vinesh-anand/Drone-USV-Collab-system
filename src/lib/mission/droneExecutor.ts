import rosbridge from "@/lib/ros/rosbridge";

import type {
  MissionAction,
  MissionActionValue,
} from "./missionScriptParser";
import type {
  VehicleExecutionContext,
  VehicleExecutor,
} from "./vehicleExecutor";

const DRONE_NS = "/mavros_drone/mavros";

const GLOBAL_POSITION_TOPIC =
  `${DRONE_NS}/global_position/global`;
const GLOBAL_POSITION_TYPE = "sensor_msgs/NavSatFix";

const RELATIVE_ALTITUDE_TOPIC =
  `${DRONE_NS}/global_position/rel_alt`;
const RELATIVE_ALTITUDE_TYPE = "std_msgs/Float64";

const COMMAND_INT_SERVICE =
  `${DRONE_NS}/cmd/command_int`;
const COMMAND_INT_SERVICE_TYPE = "mavros_msgs/CommandInt";

// MAV_CMD_DO_REPOSITION
const MAV_CMD_DO_REPOSITION = 192;

// MAV_FRAME_GLOBAL_RELATIVE_ALT
const MAV_FRAME_GLOBAL_RELATIVE_ALT = 3;

const GOTO_REACHED_RADIUS_METERS = 5;
const GOTO_TIMEOUT_MS = 180_000;

export interface DroneControlAdapter {
  isConnected: boolean;
  setMode(customMode: string): Promise<DroneCommandResult>;
  rtl(): Promise<DroneCommandResult>;
  /**
   * Optional mission-only arming hook. The cockpit route will be wired to the
   * existing useDroneControl arm() method in the next integration step.
   */
  arm?(options?: { confirm?: boolean }): Promise<DroneCommandResult>;
  /**
   * Optional mission-only takeoff hook. The cockpit route will be wired to the
   * existing useDroneControl takeoff() method in the next integration step.
   */
  takeoff?(
    altitude: number,
    options?: { confirm?: boolean },
  ): Promise<DroneCommandResult>;
}

export interface DroneCommandResult {
  success: boolean;
  message: string;
  raw?: unknown;
}

function getNumber(
  parameters: Record<string, MissionActionValue>,
  key: string,
): number | null {
  const value = parameters[key];

  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function unsupported(action: MissionAction): never {
  throw new Error(
    `DRONE action ${action.type} is not connected to a verified control command yet.`,
  );
}

function requireSuccess(
  action: MissionAction,
  result: DroneCommandResult,
): void {
  if (!result.success) {
    throw new Error(
      `DRONE ${action.type} failed: ${result.message}`,
    );
  }
}

/**
 * Adapter between the mission engine and the existing useDroneControl layer.
 *
 * Verified DRONE GOTO path:
 *
 *   Mission GOTO
 *      ↓
 *   GUIDED mode
 *      ↓
 *   MAVROS /cmd/command_int
 *      ↓
 *   MAV_CMD_DO_REPOSITION (192)
 *      ↓
 *   ArduPilot
 *      ↓
 *   Real GPS movement
 *
 * GOTO deliberately uses relative altitude (MAV_FRAME_GLOBAL_RELATIVE_ALT)
 * because that matches the working ArduPilot/MAVROS command path verified in SITL.
 *
 * Arming is intentionally NOT performed automatically.
 */
export function createDroneExecutor(
  control: DroneControlAdapter,
): VehicleExecutor {
  return {
    vehicle: "DRONE",

    async execute(
      action: MissionAction,
      context?: VehicleExecutionContext,
    ): Promise<void> {
      if (context?.signal?.aborted) {
        throw new DOMException(
          "Mission action aborted",
          "AbortError",
        );
      }

      if (!control.isConnected) {
        throw new Error(
          `DRONE control unavailable: ROSBridge is not connected; cannot execute ${action.type}.`,
        );
      }

      switch (action.type) {
        case "RTL": {
          const result = await control.rtl();
          requireSuccess(action, result);
          return;
        }

        case "LAND": {
          const result = await control.setMode("LAND");
          requireSuccess(action, result);
          return;
        }

        case "WAIT": {
          const duration = getNumber(
            action.parameters,
            "duration",
          );

          if (duration === null || duration < 0) {
            throw new Error(
              "DRONE WAIT requires a non-negative numeric duration parameter.",
            );
          }

          await waitWithAbort(
            duration * 1000,
            context?.signal,
          );
          return;
        }

        case "GOTO":
        case "WAYPOINT": {
          await executeGoto(
            action,
            control,
            context?.signal,
          );
          return;
        }

        case "STOP":
          throw new Error(
            "DRONE STOP is not mapped to disarm automatically; use an explicit control command instead.",
          );

        case "TAKEOFF": {
          await executeTakeoff(
            action,
            control,
            context?.signal,
          );
          return;
        }

        case "LOITER":
        case "SET_SPEED":
        case "SET_ALTITUDE":
        case "SWIM_AROUND":
        case "SEARCH_PATTERN":
          unsupported(action);
      }
    },
  };
}

async function executeTakeoff(
  action: MissionAction,
  control: DroneControlAdapter,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException(
      "Mission action aborted",
      "AbortError",
    );
  }

  const altitude = getNumber(action.parameters, "altitude");

  if (altitude === null || altitude <= 0) {
    throw new Error(
      `DRONE TAKEOFF requires a positive numeric altitude parameter.`,
    );
  }

  if (!control.arm || !control.takeoff) {
    throw new Error(
      "DRONE TAKEOFF is not wired to the existing Drone arm/takeoff controls yet.",
    );
  }

  const modeResult = await control.setMode("GUIDED");
  requireSuccess(action, modeResult);

  const armResult = await control.arm({ confirm: true });
  requireSuccess(action, armResult);

  const takeoffResult = await control.takeoff(altitude, {
    confirm: true,
  });
  requireSuccess(action, takeoffResult);
}

async function executeGoto(
  action: MissionAction,
  control: DroneControlAdapter,
  signal?: AbortSignal,
): Promise<void> {
  const lat = getNumber(action.parameters, "lat");
  const lon = getNumber(action.parameters, "lon");

  if (lat === null || lat < -90 || lat > 90) {
    throw new Error(
      `DRONE ${action.type} requires a valid numeric lat parameter.`,
    );
  }

  if (lon === null || lon < -180 || lon > 180) {
    throw new Error(
      `DRONE ${action.type} requires a valid numeric lon parameter.`,
    );
  }

  const ros = rosbridge;

  if (!ros.isConnected()) {
    throw new Error(
      "DRONE GOTO cannot start because ROSBridge is disconnected.",
    );
  }

  const currentRelativeAltitude =
    await waitForCurrentDroneRelativeAltitude(
      ros,
      signal,
    );

  const modeResult = await control.setMode("GUIDED");

  if (!modeResult.success) {
    throw new Error(
      `DRONE ${action.type} failed to enter GUIDED mode: ${modeResult.message}`,
    );
  }

  const commandArgs = {
    broadcast: false,
    frame: MAV_FRAME_GLOBAL_RELATIVE_ALT,
    command: MAV_CMD_DO_REPOSITION,
    current: 0,
    autocontinue: 0,
    param1: -1.0,
    param2: 0.0,
    param3: 0.0,
    param4: 0.0,
    x: Math.round(lat * 10_000_000),
    y: Math.round(lon * 10_000_000),
    z: currentRelativeAltitude,
  };

  const response = await ros.callService(
    COMMAND_INT_SERVICE,
    commandArgs,
    COMMAND_INT_SERVICE_TYPE,
  );

  const result = response as {
    success?: unknown;
    result?: unknown;
    message?: unknown;
  };

  if (result.success !== true) {
    throw new Error(
      `DRONE ${action.type} command_int failed: ${formatServiceError(result)}`,
    );
  }

  await waitForGotoTarget(
    ros,
    lat,
    lon,
    signal,
  );
}

function formatServiceError(
  response: {
    result?: unknown;
    message?: unknown;
  },
): string {
  if (typeof response.message === "string" && response.message.length > 0) {
    return response.message;
  }

  if (typeof response.result === "string") {
    return response.result;
  }

  if (typeof response.result === "number") {
    return `service result ${response.result}`;
  }

  return "service returned success=false";
}

function waitForCurrentDroneRelativeAltitude(
  ros: typeof rosbridge,
  signal?: AbortSignal,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;

    const finish = (
      callback: () => void,
    ): void => {
      if (settled) {
        return;
      }

      settled = true;
      unsubscribe?.();
      signal?.removeEventListener(
        "abort",
        onAbort,
      );
      callback();
    };

    const onAbort = (): void => {
      finish(() =>
        reject(
          new DOMException(
            "Mission action aborted",
            "AbortError",
          ),
        ),
      );
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    unsubscribe = ros.subscribe(
      RELATIVE_ALTITUDE_TOPIC,
      RELATIVE_ALTITUDE_TYPE,
      (message) => {
        const data = (
          message as {
            data?: unknown;
          }
        ).data;

        if (
          typeof data !== "number" ||
          !Number.isFinite(data)
        ) {
          return;
        }

        finish(() => resolve(data));
      },
    );

    signal?.addEventListener(
      "abort",
      onAbort,
      { once: true },
    );
  });
}

async function waitForGotoTarget(
  ros: typeof rosbridge,
  targetLat: number,
  targetLon: number,
  signal?: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    let timeoutTimer: number | null = null;

    const finish = (
      callback: () => void,
    ): void => {
      if (settled) {
        return;
      }

      settled = true;

      if (timeoutTimer !== null) {
        window.clearTimeout(timeoutTimer);
      }

      unsubscribe?.();

      signal?.removeEventListener(
        "abort",
        onAbort,
      );

      callback();
    };

    const onAbort = (): void => {
      finish(() =>
        reject(
          new DOMException(
            "Mission action aborted",
            "AbortError",
          ),
        ),
      );
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    unsubscribe = ros.subscribe(
      GLOBAL_POSITION_TOPIC,
      GLOBAL_POSITION_TYPE,
      (message) => {
        const msg = message as {
          latitude?: unknown;
          longitude?: unknown;
        };

        const latitude = msg.latitude;
        const longitude = msg.longitude;

        if (
          typeof latitude !== "number" ||
          !Number.isFinite(latitude) ||
          typeof longitude !== "number" ||
          !Number.isFinite(longitude)
        ) {
          return;
        }

        const distance = distanceMeters(
          latitude,
          longitude,
          targetLat,
          targetLon,
        );

        if (distance <= GOTO_REACHED_RADIUS_METERS) {
          finish(resolve);
        }
      },
    );

    timeoutTimer = window.setTimeout(
      () => {
        finish(() =>
          reject(
            new Error(
              `DRONE GOTO timed out after ${GOTO_TIMEOUT_MS / 1000} seconds before reaching the target.`,
            ),
          ),
        );
      },
      GOTO_TIMEOUT_MS,
    );

    signal?.addEventListener(
      "abort",
      onAbort,
      { once: true },
    );
  });
}

function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (degrees: number): number =>
    (degrees * Math.PI) / 180;

  const latitudeDelta = toRadians(
    lat2 - lat1,
  );
  const longitudeDelta = toRadians(
    lon2 - lon1,
  );

  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    2 *
    earthRadiusMeters *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a),
    )
  );
}

async function waitWithAbort(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException(
      "Mission action aborted",
      "AbortError",
    );
  }

  if (milliseconds === 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const finish = (
      callback: () => void,
    ): void => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timer);
      signal?.removeEventListener(
        "abort",
        onAbort,
      );
      callback();
    };

    const onAbort = (): void => {
      finish(() =>
        reject(
          new DOMException(
            "Mission action aborted",
            "AbortError",
          ),
        ),
      );
    };

    const timer = window.setTimeout(
      () => {
        finish(resolve);
      },
      milliseconds,
    );

    signal?.addEventListener(
      "abort",
      onAbort,
      { once: true },
    );
  });
}

export default createDroneExecutor;
