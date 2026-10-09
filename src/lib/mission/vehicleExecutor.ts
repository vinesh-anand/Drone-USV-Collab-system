import type {
  MissionAction,
  MissionActionType,
  MissionVehicle,
} from "./missionScriptParser";

export interface VehicleExecutionContext {
  signal?: AbortSignal;
}

export interface VehicleExecutor {
  readonly vehicle: MissionVehicle;
  execute(
    action: MissionAction,
    context?: VehicleExecutionContext,
  ): Promise<void>;
}

export interface VehicleExecutorRegistry {
  get(vehicle: MissionVehicle): VehicleExecutor | undefined;
  has(vehicle: MissionVehicle): boolean;
  register(executor: VehicleExecutor): void;
  unregister(vehicle: MissionVehicle): void;
  clear(): void;
}

export const DRONE_ACTIONS: readonly MissionActionType[] = [
  "TAKEOFF",
  "LAND",
  "RTL",
  "GOTO",
  "WAYPOINT",
  "LOITER",
  "WAIT",
  "STOP",
  "SET_SPEED",
  "SET_ALTITUDE",
];

export const FASTY_ACTIONS: readonly MissionActionType[] = [
  "RTL",
  "GOTO",
  "WAYPOINT",
  "LOITER",
  "WAIT",
  "STOP",
  "SWIM_AROUND",
  "SEARCH_PATTERN",
  "SET_SPEED",
];

export function isVehicleActionSupported(
  vehicle: MissionVehicle,
  action: MissionActionType,
): boolean {
  const supported = vehicle === "DRONE" ? DRONE_ACTIONS : FASTY_ACTIONS;
  return supported.includes(action);
}

export function createVehicleExecutorRegistry(): VehicleExecutorRegistry {
  const executors = new Map<MissionVehicle, VehicleExecutor>();

  return {
    get(vehicle) {
      return executors.get(vehicle);
    },

    has(vehicle) {
      return executors.has(vehicle);
    },

    register(executor) {
      executors.set(executor.vehicle, executor);
    },

    unregister(vehicle) {
      executors.delete(vehicle);
    },

    clear() {
      executors.clear();
    },
  };
}

export function createUnavailableVehicleExecutor(
  vehicle: MissionVehicle,
): VehicleExecutor {
  return {
    vehicle,
    async execute(action) {
      throw new Error(
        `${vehicle} executor is not connected; cannot execute ${action.type}.`,
      );
    },
  };
}
