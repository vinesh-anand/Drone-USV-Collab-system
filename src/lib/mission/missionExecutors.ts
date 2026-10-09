import type {
  MissionAction,
  MissionVehicle,
} from "./missionScriptParser";
import type { MissionActionExecutionContext } from "./missionEngine";
import {
  createVehicleExecutorRegistry,
  createUnavailableVehicleExecutor,
  type VehicleExecutor,
  type VehicleExecutorRegistry,
} from "./vehicleExecutor";
import {
  createDroneExecutor,
  type DroneControlAdapter,
} from "./droneExecutor";
import {
  createFastyExecutor,
  type FastyExecutorOptions,
} from "./fastyExecutor";

export interface MissionExecutorOptions {
  droneControl?: DroneControlAdapter;
  fasty?: FastyExecutorOptions;
  useUnavailableExecutors?: boolean;
}

export interface MissionExecutors {
  registry: VehicleExecutorRegistry;
  executeAction: (
    action: MissionAction,
    context: MissionActionExecutionContext,
  ) => Promise<void>;
  get(vehicle: MissionVehicle): VehicleExecutor | undefined;
  has(vehicle: MissionVehicle): boolean;
  register(executor: VehicleExecutor): void;
  unregister(vehicle: MissionVehicle): void;
  clear(): void;
}

/**
 * Creates the shared execution wiring for DRONE and FASTY.
 *
 * This module only wires adapters into the common registry. It does not create
 * a ROSBridge connection, arm a vehicle, or start a mission by itself.
 *
 * When real control adapters are not supplied, unavailable executors can be
 * installed so a mission fails explicitly instead of silently doing nothing.
 */
export function createMissionExecutors(
  options: MissionExecutorOptions = {},
): MissionExecutors {
  const registry = createVehicleExecutorRegistry();
  const useUnavailableExecutors = options.useUnavailableExecutors ?? true;

  if (options.droneControl) {
    registry.register(createDroneExecutor(options.droneControl));
  } else if (useUnavailableExecutors) {
    registry.register(createUnavailableVehicleExecutor("DRONE"));
  }

  if (options.fasty) {
    registry.register(createFastyExecutor(options.fasty));
  } else if (useUnavailableExecutors) {
    registry.register(createUnavailableVehicleExecutor("FASTY"));
  }

  const executeAction = async (
    action: MissionAction,
    context: MissionActionExecutionContext,
  ): Promise<void> => {
    const executor = registry.get(action.vehicle);

    if (!executor) {
      throw new Error(
        `No executor is registered for ${action.vehicle}; cannot execute ${action.type}.`,
      );
    }

    await executor.execute(action, {
      signal: context.signal,
    });
  };

  return {
    registry,
    executeAction,
    get: (vehicle) => registry.get(vehicle),
    has: (vehicle) => registry.has(vehicle),
    register: (executor) => registry.register(executor),
    unregister: (vehicle) => registry.unregister(vehicle),
    clear: () => registry.clear(),
  };
}

export default createMissionExecutors;
