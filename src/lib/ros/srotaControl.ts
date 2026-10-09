
import rosbridge from "./rosbridge";

interface SrotaRosbridgeResponse {
  values?: Record<string, unknown>;
  result?: boolean | string;
  [key: string]: unknown;
}

export interface SrotaServiceResult {
  success: boolean;
  message: string;
  raw?: unknown;
}

function getValues(
  response: SrotaRosbridgeResponse,
): Record<string, unknown> {
  if (
    response.values &&
    typeof response.values === "object"
  ) {
    return response.values;
  }

  return {};
}

function getServiceSuccess(
  response: SrotaRosbridgeResponse,
): boolean {
  const values = getValues(response);
  const valuesSuccess = values["success"];

  if (typeof valuesSuccess === "boolean") {
    return valuesSuccess;
  }

  if (typeof response.result === "boolean") {
    return response.result;
  }

  if (typeof response.result === "string") {
    return response.result.toLowerCase() === "true";
  }

  return false;
}

function getServiceMessage(
  response: SrotaRosbridgeResponse,
): string {
  const values = getValues(response);
  const valuesMessage = values["message"];

  if (typeof valuesMessage === "string") {
    return valuesMessage;
  }

  if (typeof response.result === "string") {
    return response.result;
  }

  return "SROTA service completed without a message.";
}

async function callTriggerService(
  service: string,
): Promise<SrotaServiceResult> {
  if (!rosbridge.isConnected()) {
    return {
      success: false,
      message:
        "SROTA control unavailable: ROSBridge is not connected.",
    };
  }

  try {
    const response =
      (await rosbridge.callService(
        service,
        {},
      )) as SrotaRosbridgeResponse;

    const success = getServiceSuccess(response);

    return {
      success,
      message: getServiceMessage(response),
      raw: response,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown ROSBridge service error.";

    return {
      success: false,
      message: `SROTA service error: ${message}`,
    };
  }
}

/**
 * Request SROTA to drive FASTY to the Drone's
 * current GPS position.
 */
export async function gotoDrone(): Promise<SrotaServiceResult> {
  return callTriggerService("/srota/goto_drone");
}

/**
 * Request SROTA to continuously follow the Drone.
 * Requires the /srota/follow service to exist
 * in the running SROTA ROS node.
 */
export async function follow(): Promise<SrotaServiceResult> {
  return callTriggerService("/srota/follow");
}

/**
 * Request SROTA to return FASTY to its
 * recorded launch/home position.
 */
export async function returnHome(): Promise<SrotaServiceResult> {
  return callTriggerService("/srota/return_home");
}

/**
 * Request SROTA to stop its current navigation task.
 */
export async function stop(): Promise<SrotaServiceResult> {
  return callTriggerService("/srota/stop");
}

/**
 * Query the SROTA package status.
 */
export async function status(): Promise<SrotaServiceResult> {
  return callTriggerService("/srota/status");
}

const srotaControl = {
  gotoDrone,
  follow,
  returnHome,
  stop,
  status,
};

export default srotaControl;