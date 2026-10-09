import { useCallback, useEffect, useState } from "react";
import rosbridge from "@/lib/ros/rosbridge";

const DRONE_MAVROS_NAMESPACE = "/mavros_drone/mavros";

const ARMING_SERVICE = `${DRONE_MAVROS_NAMESPACE}/cmd/arming`;
const SET_MODE_SERVICE = `${DRONE_MAVROS_NAMESPACE}/set_mode`;
const TAKEOFF_SERVICE = `${DRONE_MAVROS_NAMESPACE}/cmd/takeoff`;
const TAKEOFF_SERVICE_TYPE = "mavros_msgs/CommandTOL";

const ROSBRIDGE_URL =
  import.meta.env["VITE_ROSBRIDGE_URL"] || "ws://localhost:9090";

export type DroneControlStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "disconnected";

export interface DroneCommandResult {
  success: boolean;
  message: string;
  raw?: unknown;
}

export interface DroneControlState {
  status: DroneControlStatus;
  connected: boolean;
  busy: boolean;
  lastCommand: string | null;
  lastResult: DroneCommandResult | null;
  error: string | null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown Drone control error";
}

function serviceSucceeded(response: unknown): boolean {
  if (!response || typeof response !== "object") {
    return false;
  }

  const message = response as Record<string, unknown>;

  if (message["success"] !== undefined) {
    return Boolean(message["success"]);
  }

  if (message["mode_sent"] !== undefined) {
    return Boolean(message["mode_sent"]);
  }

  if (message["result"] !== undefined) {
    const result = message["result"];
    return typeof result === "number" ? result === 0 : Boolean(result);
  }

  return true;
}

function serviceFailureMessage(
  command: string,
  response: unknown,
): string {
  if (!response || typeof response !== "object") {
    return `${command} failed`;
  }

  const message = response as Record<string, unknown>;

  if (message["result"] !== undefined) {
    return `${command} rejected by MAVROS (result: ${String(message["result"])})`;
  }

  if (message["success"] === false) {
    return `${command} rejected by MAVROS`;
  }

  if (message["mode_sent"] === false) {
    return `${command} was not accepted by MAVROS`;
  }

  return `${command} failed`;
}

/**
 * Real Drone vehicle-control layer.
 *
 * Communication path:
 *
 * React
 *   ↓
 * useDroneControl()
 *   ↓
 * ROSBridge
 *   ↓
 * /mavros_drone/mavros/*
 *   ↓
 * MAVROS
 *   ↓
 * Drone Pixhawk
 *
 * This hook intentionally does NOT simulate command success.
 */
export function useDroneControl() {
  const [state, setState] = useState<DroneControlState>({
    status: "idle",
    connected: rosbridge.isConnected(),
    busy: false,
    lastCommand: null,
    lastResult: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const updateConnectionState = () => {
      if (cancelled) {
        return;
      }

      const connected = rosbridge.isConnected();

      setState((previous) => ({
        ...previous,
        status: connected ? "connected" : "disconnected",
        connected,
      }));
    };

    const connect = () => {
      if (cancelled) {
        return;
      }

      if (rosbridge.isConnected()) {
        updateConnectionState();
        return;
      }

      setState((previous) => ({
        ...previous,
        status: "connecting",
        connected: false,
        error: null,
      }));

      rosbridge.connect(ROSBRIDGE_URL);
    };

    const connectionPoll = window.setInterval(() => {
      if (cancelled) {
        return;
      }

      const connected = rosbridge.isConnected();

      setState((previous) => ({
        ...previous,
        status: connected
          ? "connected"
          : previous.status === "connecting"
            ? "connecting"
            : "disconnected",
        connected,
      }));
    }, 500);

    connect();

    return () => {
      cancelled = true;
      window.clearInterval(connectionPoll);
    };
  }, []);

  const setArmed = useCallback(
    async (
      armed: boolean,
      options?: { confirm?: boolean },
    ): Promise<DroneCommandResult> => {
      const command = armed ? "ARM" : "DISARM";

      if (!options?.confirm) {
        const result: DroneCommandResult = {
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
        const result: DroneCommandResult = {
          success: false,
          message: "DRONE control unavailable: ROSBridge is not connected",
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
          { value: armed },
        );

        const success = serviceSucceeded(response);

        const result: DroneCommandResult = success
          ? {
              success: true,
              message: armed
                ? "DRONE arm command accepted by MAVROS"
                : "DRONE disarm command accepted by MAVROS",
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
          status: rosbridge.isConnected() ? "connected" : "disconnected",
          connected: rosbridge.isConnected(),
          lastResult: result,
          error: success ? null : result.message,
        }));

        return result;
      } catch (error) {
        const result: DroneCommandResult = {
          success: false,
          message: `${command} command error: ${getErrorMessage(error)}`,
        };

        setState((previous) => ({
          ...previous,
          busy: false,
          status: rosbridge.isConnected() ? "connected" : "disconnected",
          connected: rosbridge.isConnected(),
          lastResult: result,
          error: result.message,
        }));

        return result;
      }
    },
    [],
  );

  const arm = useCallback(
    async (options?: { confirm?: boolean }) => {
      return setArmed(true, options);
    },
    [setArmed],
  );

  const disarm = useCallback(
    async (options?: { confirm?: boolean }) => {
      return setArmed(false, options);
    },
    [setArmed],
  );

  const setMode = useCallback(
    async (customMode: string): Promise<DroneCommandResult> => {
      const mode = customMode.trim();

      if (!mode) {
        const result: DroneCommandResult = {
          success: false,
          message: "DRONE mode cannot be empty",
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
        const result: DroneCommandResult = {
          success: false,
          message: "DRONE control unavailable: ROSBridge is not connected",
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

        const result: DroneCommandResult = success
          ? {
              success: true,
              message: `DRONE mode change to ${mode} accepted by MAVROS`,
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
          status: rosbridge.isConnected() ? "connected" : "disconnected",
          connected: rosbridge.isConnected(),
          lastResult: result,
          error: success ? null : result.message,
        }));

        return result;
      } catch (error) {
        const result: DroneCommandResult = {
          success: false,
          message: `SET_MODE ${mode} error: ${getErrorMessage(error)}`,
        };

        setState((previous) => ({
          ...previous,
          busy: false,
          status: rosbridge.isConnected() ? "connected" : "disconnected",
          connected: rosbridge.isConnected(),
          lastResult: result,
          error: result.message,
        }));

        return result;
      }
    },
    [],
  );

  const takeoff = useCallback(
    async (
      altitude: number,
      options?: { confirm?: boolean },
    ): Promise<DroneCommandResult> => {
      if (!Number.isFinite(altitude) || altitude <= 0) {
        const result: DroneCommandResult = {
          success: false,
          message: "DRONE takeoff altitude must be a positive number",
        };

        setState((previous) => ({
          ...previous,
          lastCommand: "TAKEOFF",
          lastResult: result,
          error: result.message,
        }));

        return result;
      }

      if (!options?.confirm) {
        const result: DroneCommandResult = {
          success: false,
          message: "TAKEOFF command requires explicit confirmation",
        };

        setState((previous) => ({
          ...previous,
          lastCommand: `TAKEOFF ${altitude}m`,
          lastResult: result,
          error: result.message,
        }));

        return result;
      }

      if (!rosbridge.isConnected()) {
        const result: DroneCommandResult = {
          success: false,
          message: "DRONE control unavailable: ROSBridge is not connected",
        };

        setState((previous) => ({
          ...previous,
          status: "disconnected",
          connected: false,
          lastCommand: `TAKEOFF ${altitude}m`,
          lastResult: result,
          error: result.message,
        }));

        return result;
      }

      setState((previous) => ({
        ...previous,
        busy: true,
        lastCommand: `TAKEOFF ${altitude}m`,
        lastResult: null,
        error: null,
      }));

      try {
        const guidedResult = await setMode("GUIDED");

        if (!guidedResult.success) {
          const result: DroneCommandResult = {
            success: false,
            message: `TAKEOFF blocked: GUIDED mode was not accepted by MAVROS (${guidedResult.message})`,
            raw: guidedResult.raw,
          };

          setState((previous) => ({
            ...previous,
            busy: false,
            status: rosbridge.isConnected() ? "connected" : "disconnected",
            connected: rosbridge.isConnected(),
            lastResult: result,
            error: result.message,
          }));

          return result;
        }

        // Give MAVROS/ArduPilot a moment to apply GUIDED before sending takeoff.
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 250);
        });

        const response = await rosbridge.callService(
          TAKEOFF_SERVICE,
          {
            min_pitch: 0,
            yaw: 0,
            latitude: 0,
            longitude: 0,
            altitude,
          },
          TAKEOFF_SERVICE_TYPE,
        );

        const success = serviceSucceeded(response);

        const result: DroneCommandResult = success
          ? {
              success: true,
              message: `DRONE takeoff to ${altitude} m accepted by MAVROS`,
              raw: response,
            }
          : {
              success: false,
              message: serviceFailureMessage(
                `TAKEOFF ${altitude}m`,
                response,
              ),
              raw: response,
            };

        setState((previous) => ({
          ...previous,
          busy: false,
          status: rosbridge.isConnected() ? "connected" : "disconnected",
          connected: rosbridge.isConnected(),
          lastResult: result,
          error: success ? null : result.message,
        }));

        return result;
      } catch (error) {
        const result: DroneCommandResult = {
          success: false,
          message: `TAKEOFF command error: ${getErrorMessage(error)}`,
        };

        setState((previous) => ({
          ...previous,
          busy: false,
          status: rosbridge.isConnected() ? "connected" : "disconnected",
          connected: rosbridge.isConnected(),
          lastResult: result,
          error: result.message,
        }));

        return result;
      }
    },
    [],
  );

  const rtl = useCallback(async (): Promise<DroneCommandResult> => {
    return setMode("RTL");
  }, [setMode]);

  const clearControlStatus = useCallback(() => {
    setState((previous) => ({
      ...previous,
      lastResult: null,
      error: null,
    }));
  }, []);

  return {
    ...state,
    services: {
      arming: ARMING_SERVICE,
      setMode: SET_MODE_SERVICE,
      takeoff: TAKEOFF_SERVICE,
    },
    arm,
    disarm,
    setArmed,
    setMode,
    takeoff,
    rtl,
    clearControlStatus,
    isConnected: rosbridge.isConnected(),
  };
}

export default useDroneControl;
