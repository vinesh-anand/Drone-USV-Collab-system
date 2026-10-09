import { useCallback, useEffect, useState } from "react";
import rosbridge from "@/lib/ros/rosbridge";

const FASTY_MAVROS_NAMESPACE = "/mavros_fasty/mavros";

const ARMING_SERVICE = `${FASTY_MAVROS_NAMESPACE}/cmd/arming`;
const SET_MODE_SERVICE = `${FASTY_MAVROS_NAMESPACE}/set_mode`;
const COMMAND_INT_SERVICE =
  `${FASTY_MAVROS_NAMESPACE}/cmd/command_int`;
const COMMAND_INT_SERVICE_TYPE = "mavros_msgs/CommandInt";

// Verified FASTY Rover GPS command:
// MAV_CMD_DO_REPOSITION = 192
const MAV_CMD_DO_REPOSITION = 192;

// Verified working frame:
// MAV_FRAME_GLOBAL_RELATIVE_ALT = 3
const MAV_FRAME_GLOBAL_RELATIVE_ALT = 3;

const ROSBRIDGE_URL =
  import.meta.env["VITE_ROSBRIDGE_URL"] || "ws://localhost:9090";

export type FastyControlStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "disconnected";

export interface FastyCommandResult {
  success: boolean;
  message: string;
  raw?: unknown;
}

export interface FastyControlState {
  status: FastyControlStatus;
  connected: boolean;
  busy: boolean;
  lastCommand: string | null;
  lastResult: FastyCommandResult | null;
  error: string | null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown FASTY control error";
}

function serviceSucceeded(response: any): boolean {
  if (!response) {
    return false;
  }

  if (response.success !== undefined) {
    return Boolean(response.success);
  }

  if (response.mode_sent !== undefined) {
    return Boolean(response.mode_sent);
  }

  if (response.result !== undefined) {
    return typeof response.result === "number"
      ? response.result === 0
      : Boolean(response.result);
  }

  return true;
}

function serviceFailureMessage(
  command: string,
  response: any,
): string {
  if (response?.result !== undefined) {
    return `${command} rejected by MAVROS (result: ${response.result})`;
  }

  if (response?.success === false) {
    return `${command} rejected by MAVROS`;
  }

  if (response?.mode_sent === false) {
    return `${command} was not accepted by MAVROS`;
  }

  return `${command} failed`;
}

/**
 * Real FASTY vehicle-control layer.
 *
 * Communication path:
 *
 * React
 *   ↓
 * useFastyControl()
 *   ↓
 * ROSBridge
 *   ↓
 * /mavros_fasty/mavros/*
 *   ↓
 * MAVROS
 *   ↓
 * Mini Pix / FASTY
 *
 * This hook intentionally does NOT simulate command success.
 */
export function useFastyControl() {
  const [state, setState] = useState<FastyControlState>({
    status: "idle",
    connected: rosbridge.isConnected(),
    busy: false,
    lastCommand: null,
    lastResult: null,
    error: null,
  });

  /**
   * Keep the control layer connected to the same ROSBridge
   * singleton used by the telemetry system.
   */
  useEffect(() => {
    let cancelled = false;

    const connect = async () => {
      if (rosbridge.isConnected()) {
        if (!cancelled) {
          setState((previous) => ({
            ...previous,
            status: "connected",
            connected: true,
            error: null,
          }));
        }

        return;
      }

      if (!cancelled) {
        setState((previous) => ({
          ...previous,
          status: "connecting",
          connected: false,
          error: null,
        }));
      }

      try {
        await rosbridge.connect(ROSBRIDGE_URL);

        if (!cancelled) {
          setState((previous) => ({
            ...previous,
            status: "connected",
            connected: rosbridge.isConnected(),
            error: null,
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setState((previous) => ({
            ...previous,
            status: "error",
            connected: false,
            error: getErrorMessage(error),
          }));
        }
      }
    };

    connect();

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Arm/disarm FASTY.
   *
   * IMPORTANT:
   * Arming requires an explicit confirmation from the caller.
   * This prevents an accidental UI event from sending an
   * arm command to the real vehicle.
   */
  const setArmed = useCallback(
    async (
      armed: boolean,
      options?: {
        confirm?: boolean;
      },
    ): Promise<FastyCommandResult> => {
      const command = armed ? "ARM" : "DISARM";

      if (!options?.confirm) {
        const result: FastyCommandResult = {
          success: false,
          message: `${command} command requires explicit confirmation`,
        };

        setState((previous) => ({
          ...previous,
          lastCommand: command,
          lastResult: result,
          error: result.message,
        }));

        return result;
      }

      if (!rosbridge.isConnected()) {
        const result: FastyCommandResult = {
          success: false,
          message: "FASTY control unavailable: ROSBridge is not connected",
        };

        setState((previous) => ({
          ...previous,
          status: "disconnected",
          connected: false,
          lastCommand: command,
          lastResult: result,
          error: result.message,
        }));

        return result;
      }

      setState((previous) => ({
        ...previous,
        busy: true,
        lastCommand: command,
        lastResult: null,
        error: null,
      }));

      try {
        const response = await rosbridge.callService(
          ARMING_SERVICE,
          {
            value: armed,
          },
        );

        const success = serviceSucceeded(response);

        const result: FastyCommandResult = success
          ? {
              success: true,
              message: armed
                ? "FASTY arm command accepted by MAVROS"
                : "FASTY disarm command accepted by MAVROS",
              raw: response,
            }
          : {
              success: false,
              message: serviceFailureMessage(command, response),
              raw: response,
            };

        setState((previous) => ({
          ...previous,
          busy: false,
          status: rosbridge.isConnected()
            ? "connected"
            : "disconnected",
          connected: rosbridge.isConnected(),
          lastResult: result,
          error: success ? null : result.message,
        }));

        return result;
      } catch (error) {
        const result: FastyCommandResult = {
          success: false,
          message: `${command} command error: ${getErrorMessage(error)}`,
        };

        setState((previous) => ({
          ...previous,
          busy: false,
          status: rosbridge.isConnected()
            ? "connected"
            : "disconnected",
          connected: rosbridge.isConnected(),
          lastResult: result,
          error: result.message,
        }));

        return result;
      }
    },
    [],
  );

  /**
   * Arm FASTY.
   *
   * Caller must explicitly pass:
   *   arm({ confirm: true })
   */
  const arm = useCallback(
    async (options?: { confirm?: boolean }) => {
      return setArmed(true, options);
    },
    [setArmed],
  );

  /**
   * Disarm FASTY.
   *
   * Caller must explicitly pass:
   *   disarm({ confirm: true })
   */
  const disarm = useCallback(
    async (options?: { confirm?: boolean }) => {
      return setArmed(false, options);
    },
    [setArmed],
  );

  /**
   * Change FASTY flight/control mode through the real
   * MAVROS set_mode service.
   *
   * Examples:
   *
   *   setMode("HOLD")
   *   setMode("MANUAL")
   *   setMode("GUIDED")
   *
   * The actual mode must be supported by the firmware.
   */
  const setMode = useCallback(
    async (customMode: string): Promise<FastyCommandResult> => {
      const mode = customMode.trim();

      if (!mode) {
        const result: FastyCommandResult = {
          success: false,
          message: "FASTY mode cannot be empty",
        };

        setState((previous) => ({
          ...previous,
          lastCommand: "SET_MODE",
          lastResult: result,
          error: result.message,
        }));

        return result;
      }

      if (!rosbridge.isConnected()) {
        const result: FastyCommandResult = {
          success: false,
          message: "FASTY control unavailable: ROSBridge is not connected",
        };

        setState((previous) => ({
          ...previous,
          status: "disconnected",
          connected: false,
          lastCommand: `SET_MODE ${mode}`,
          lastResult: result,
          error: result.message,
        }));

        return result;
      }

      setState((previous) => ({
        ...previous,
        busy: true,
        lastCommand: `SET_MODE ${mode}`,
        lastResult: null,
        error: null,
      }));

      try {
        const response = await rosbridge.callService(
          SET_MODE_SERVICE,
          {
            base_mode: 0,
            custom_mode: mode,
          },
        );

        const success = serviceSucceeded(response);

        const result: FastyCommandResult = success
          ? {
              success: true,
              message: `FASTY mode change to ${mode} accepted by MAVROS`,
              raw: response,
            }
          : {
              success: false,
              message: serviceFailureMessage(
                `SET_MODE ${mode}`,
                response,
              ),
              raw: response,
            };

        setState((previous) => ({
          ...previous,
          busy: false,
          status: rosbridge.isConnected()
            ? "connected"
            : "disconnected",
          connected: rosbridge.isConnected(),
          lastResult: result,
          error: success ? null : result.message,
        }));

        return result;
      } catch (error) {
        const result: FastyCommandResult = {
          success: false,
          message: `SET_MODE ${mode} error: ${getErrorMessage(error)}`,
        };

        setState((previous) => ({
          ...previous,
          busy: false,
          status: rosbridge.isConnected()
            ? "connected"
            : "disconnected",
          connected: rosbridge.isConnected(),
          lastResult: result,
          error: result.message,
        }));

        return result;
      }
    },
    [],
  );

  /**
   * Send a real GPS GOTO command to FASTY.
   *
   * Verified in SITL with:
   *   /mavros_fasty/mavros/cmd/command_int
   *   MAV_CMD_DO_REPOSITION (192)
   *   MAV_FRAME_GLOBAL_RELATIVE_ALT (3)
   *
   * This function does NOT arm the vehicle.
   * FASTY must be armed separately by the operator.
   */
  const gotoPosition = useCallback(
    async (
      latitude: number,
      longitude: number,
    ): Promise<FastyCommandResult> => {
      if (
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90
      ) {
        const result: FastyCommandResult = {
          success: false,
          message: "FASTY GOTO requires a valid latitude between -90 and 90",
        };

        setState((previous) => ({
          ...previous,
          lastCommand: "GOTO",
          lastResult: result,
          error: result.message,
        }));

        return result;
      }

      if (
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180
      ) {
        const result: FastyCommandResult = {
          success: false,
          message:
            "FASTY GOTO requires a valid longitude between -180 and 180",
        };

        setState((previous) => ({
          ...previous,
          lastCommand: "GOTO",
          lastResult: result,
          error: result.message,
        }));

        return result;
      }

      if (!rosbridge.isConnected()) {
        const result: FastyCommandResult = {
          success: false,
          message:
            "FASTY control unavailable: ROSBridge is not connected",
        };

        setState((previous) => ({
          ...previous,
          status: "disconnected",
          connected: false,
          lastCommand: "GOTO",
          lastResult: result,
          error: result.message,
        }));

        return result;
      }

      setState((previous) => ({
        ...previous,
        busy: true,
        lastCommand: "GOTO",
        lastResult: null,
        error: null,
      }));

      try {
        // Rover GOTO requires GUIDED mode. This changes mode only;
        // it does NOT arm the vehicle.
        const modeResult = await setMode("GUIDED");

        if (!modeResult.success) {
          const result: FastyCommandResult = {
            success: false,
            message:
              `FASTY GOTO could not enter GUIDED mode: ${modeResult.message}`,
          };

          setState((previous) => ({
            ...previous,
            busy: false,
            status: rosbridge.isConnected()
              ? "connected"
              : "disconnected",
            connected: rosbridge.isConnected(),
            lastResult: result,
            error: result.message,
          }));

          return result;
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
          x: Math.round(latitude * 10_000_000),
          y: Math.round(longitude * 10_000_000),
          z: 0.0,
        };

        const response = await rosbridge.callService(
          COMMAND_INT_SERVICE,
          commandArgs,
          COMMAND_INT_SERVICE_TYPE,
        );

        const success = serviceSucceeded(response);

        const result: FastyCommandResult = success
          ? {
              success: true,
              message:
                `FASTY GOTO accepted by MAVROS: ${latitude.toFixed(7)}, ${longitude.toFixed(7)}`,
              raw: response,
            }
          : {
              success: false,
              message: serviceFailureMessage(
                "GOTO",
                response,
              ),
              raw: response,
            };

        setState((previous) => ({
          ...previous,
          busy: false,
          status: rosbridge.isConnected()
            ? "connected"
            : "disconnected",
          connected: rosbridge.isConnected(),
          lastResult: result,
          error: success ? null : result.message,
        }));

        return result;
      } catch (error) {
        const result: FastyCommandResult = {
          success: false,
          message:
            `FASTY GOTO command error: ${getErrorMessage(error)}`,
        };

        setState((previous) => ({
          ...previous,
          busy: false,
          status: rosbridge.isConnected()
            ? "connected"
            : "disconnected",
          connected: rosbridge.isConnected(),
          lastResult: result,
          error: result.message,
        }));

        return result;
      }
    },
    [setMode],
  );

  /**
   * Clear the most recent control result/error from the UI state.
   */
  const clearControlStatus = useCallback(() => {
    setState((previous) => ({
      ...previous,
      lastResult: null,
      error: null,
    }));
  }, []);

  return {
    ...state,

    /**
     * Low-level constants are exposed so future control
     * components can display the actual MAVROS endpoints.
     */
    services: {
      arming: ARMING_SERVICE,
      setMode: SET_MODE_SERVICE,
      commandInt: COMMAND_INT_SERVICE,
    },

    arm,
    disarm,
    setArmed,
    setMode,
    gotoPosition,
    clearControlStatus,

    /**
     * Useful for UI buttons that want to check the current
     * ROSBridge connection immediately.
     */
    isConnected: rosbridge.isConnected(),
  };
}

export default useFastyControl;
