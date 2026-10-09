import type { MissionAction, MissionVehicle } from "./missionScriptParser";
import type {
  VehicleExecutionContext,
  VehicleExecutor,
} from "./vehicleExecutor";

export interface FastyExecutorOptions {
  isConnected?: () => boolean;
  executeGoto?: (
    action: MissionAction,
    context?: VehicleExecutionContext,
  ) => Promise<void>;
  executeStop?: (context?: VehicleExecutionContext) => Promise<void>;
  executeRtl?: (context?: VehicleExecutionContext) => Promise<void>;
}

/**
 * FASTY-specific mission adapter.
 *
 * This adapter deliberately does not invent a MAVROS/ROS command path. The
 * optional callbacks can be wired to the existing FASTY control layer once
 * those command interfaces are verified.
 */
export class FastyExecutor implements VehicleExecutor {
  readonly vehicle: MissionVehicle = "FASTY";

  private readonly options: FastyExecutorOptions;

  constructor(options: FastyExecutorOptions = {}) {
    this.options = options;
  }

  isAvailable(): boolean {
    return this.options.isConnected?.() ?? false;
  }

  async execute(
    action: MissionAction,
    context?: VehicleExecutionContext,
  ): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error("FASTY executor is not connected; command was not sent.");
    }

    switch (action.type) {
      case "GOTO":
      case "WAYPOINT":
        if (!this.options.executeGoto) {
          throw this.unsupported(action);
        }
        await this.options.executeGoto(action, context);
        return;

      case "STOP":
        if (!this.options.executeStop) {
          throw this.unsupported(action);
        }
        await this.options.executeStop(context);
        return;

      case "RTL":
        if (!this.options.executeRtl) {
          throw this.unsupported(action);
        }
        await this.options.executeRtl(context);
        return;

      case "WAIT":
        await this.executeWait(action, context);
        return;

      case "SWIM_AROUND":
      case "SEARCH_PATTERN":
      case "TAKEOFF":
      case "LAND":
      case "LOITER":
      case "SET_SPEED":
      case "SET_ALTITUDE":
        throw this.unsupported(action);

      default:
        throw this.unsupported(action);
    }
  }

  private async executeWait(
    action: MissionAction,
    context?: VehicleExecutionContext,
  ): Promise<void> {
    const duration = action.parameters["duration"];

    if (typeof duration !== "number" || duration < 0) {
      throw new Error("FASTY WAIT requires a non-negative numeric duration.");
    }

    if (duration === 0) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      let timer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        context?.signal?.removeEventListener("abort", onAbort);
      };

      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (timer !== null) {
          clearTimeout(timer);
        }
        cleanup();
        callback();
      };

      const onAbort = () => {
        finish(() =>
          reject(
            new DOMException(
              "Mission action aborted",
              "AbortError",
            ),
          ),
        );
      };

      if (context?.signal?.aborted) {
        onAbort();
        return;
      }

      timer = setTimeout(() => {
        finish(resolve);
      }, duration * 1000);

      context?.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private unsupported(action: MissionAction): Error {
    return new Error(
      `FASTY action ${action.type} is not connected to a verified vehicle command path yet.`,
    );
  }
}

export function createFastyExecutor(
  options: FastyExecutorOptions = {},
): FastyExecutor {
  return new FastyExecutor(options);
}
