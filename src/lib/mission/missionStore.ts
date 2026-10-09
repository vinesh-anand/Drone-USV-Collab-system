import { useSyncExternalStore } from "react";

export type MissionItemType =
  | "TAKEOFF"
  | "WAYPOINT"
  | "LOITER"
  | "LAND"
  | "RTL"
  | "FASTY_TARGET";

export interface MissionItem {
  id: number;
  type: MissionItemType;
  label: string;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  speed: number | null;
  hold: number | null;
}

export type MissionVehicle = "DRONE" | "FASTY";

export type MissionStatus =
  | "EDITING"
  | "READY"
  | "RUNNING"
  | "PAUSED"
  | "ABORTED"
  | "COMPLETED";

export type RescueTargetStatus =
  | "NONE"
  | "DETECTED"
  | "VERIFIED"
  | "ASSIGNED"
  | "EN_ROUTE"
  | "ON_TARGET"
  | "RESCUE"
  | "COMPLETED"
  | "ABORTED";

export type RescueTargetSource =
  | "DRONE"
  | "OPERATOR";

export interface RescueTarget {
  id: string;
  latitude: number;
  longitude: number;
  confidence: number | null;
  detectedBy: RescueTargetSource;
  status: RescueTargetStatus;
  assignedVehicle: MissionVehicle | null;
  createdAt: number;
  updatedAt: number;
}

export interface MissionState {
  mission: MissionItem[];
  selectedId: number;
  vehicle: MissionVehicle;
  status: MissionStatus;
  activeMissionItemId: number | null;

  /**
   * Current person-in-water rescue target.
   * This is shared by the planner, map, Drone workflow,
   * GCS coordination layer and FASTY workflow.
   */
  rescueTarget: RescueTarget | null;
}

const initialMission: MissionItem[] = [
  {
    id: 1,
    type: "TAKEOFF",
    label: "Takeoff",
    latitude: null,
    longitude: null,
    altitude: 40,
    speed: null,
    hold: null,
  },
];

const initialState: MissionState = {
  mission: initialMission,
  selectedId: 1,
  vehicle: "DRONE",
  status: "EDITING",
  activeMissionItemId: null,
  rescueTarget: null,
};

let state: MissionState = initialState;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function updateState(
  updater: (current: MissionState) => MissionState,
): void {
  state = updater(state);
  emit();
}

export function getMissionState(): MissionState {
  return state;
}

export function subscribeMissionState(
  listener: () => void,
): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function useMissionState(): MissionState {
  return useSyncExternalStore(
    subscribeMissionState,
    getMissionState,
    getMissionState,
  );
}

export function setMission(
  mission: MissionItem[],
): void {
  updateState((current) => ({
    ...current,
    mission,

    selectedId: mission.some(
      (item) => item.id === current.selectedId,
    )
      ? current.selectedId
      : (mission[0]?.id ?? 1),

    status:
      mission.length > 1
        ? current.status === "RUNNING" ||
          current.status === "PAUSED"
          ? current.status
          : "EDITING"
        : "EDITING",
  }));
}

export function setSelectedId(
  id: number,
): void {
  updateState((current) => {
    if (
      !current.mission.some(
        (item) => item.id === id,
      )
    ) {
      return current;
    }

    return {
      ...current,
      selectedId: id,
    };
  });
}

export function setVehicle(
  vehicle: MissionVehicle,
): void {
  updateState((current) => ({
    ...current,
    vehicle,
  }));
}

export function setMissionStatus(
  status: MissionStatus,
): void {
  updateState((current) => ({
    ...current,
    status,
  }));
}

export function setActiveMissionItemId(
  id: number | null,
): void {
  updateState((current) => ({
    ...current,
    activeMissionItemId: id,
  }));
}

export const missionTypeLabel: Record<
  MissionItemType,
  string
> = {
  TAKEOFF: "TAKEOFF",
  WAYPOINT: "WAYPOINT",
  LOITER: "LOITER",
  LAND: "LAND",
  RTL: "RETURN",
  FASTY_TARGET: "FASTY TARGET",
};

export function addMissionItem(
  type: MissionItemType,
): number {
  const nextId =
    Math.max(
      0,
      ...state.mission.map(
        (item) => item.id,
      ),
    ) + 1;

  const nextItem: MissionItem = {
    id: nextId,
    type,

    label:
      type === "FASTY_TARGET"
        ? "Rescue Target"
        : `${missionTypeLabel[type]} ${nextId}`,

    latitude: null,
    longitude: null,

    altitude:
      type === "WAYPOINT"
        ? 50
        : null,

    speed:
      type === "WAYPOINT"
        ? 8
        : null,

    hold:
      type === "LOITER"
        ? 30
        : null,
  };

  updateState((current) => ({
    ...current,
    mission: [
      ...current.mission,
      nextItem,
    ],
    selectedId: nextId,
    status: "EDITING",
  }));

  return nextId;
}

export function removeSelectedMissionItem(): void {
  updateState((current) => {
    const selectedItem =
      current.mission.find(
        (item) =>
          item.id === current.selectedId,
      ) ?? null;

    if (
      selectedItem === null ||
      selectedItem.type === "TAKEOFF"
    ) {
      return current;
    }

    const mission =
      current.mission.filter(
        (item) =>
          item.id !== selectedItem.id,
      );

    const fallback =
      mission[0] ?? null;

    return {
      ...current,
      mission,

      selectedId:
        fallback?.id ?? 1,

      status: "EDITING",

      activeMissionItemId:
        current.activeMissionItemId ===
        selectedItem.id
          ? null
          : current.activeMissionItemId,
    };
  });
}

export function moveSelectedMissionItem(
  direction: "UP" | "DOWN",
): void {
  updateState((current) => {
    const index =
      current.mission.findIndex(
        (item) =>
          item.id ===
          current.selectedId,
      );

    if (index < 0) {
      return current;
    }

    if (
      current.mission[index]?.type ===
      "TAKEOFF"
    ) {
      return current;
    }

    const nextIndex =
      direction === "UP"
        ? index - 1
        : index + 1;

    if (
      nextIndex < 0 ||
      nextIndex >=
        current.mission.length
    ) {
      return current;
    }

    const reordered =
      [...current.mission];

    const [moved] =
      reordered.splice(
        index,
        1,
      );

    if (!moved) {
      return current;
    }

    reordered.splice(
      nextIndex,
      0,
      moved,
    );

    return {
      ...current,
      mission: reordered,
      status: "EDITING",
    };
  });
}

export function updateSelectedMissionField<
  K extends keyof MissionItem,
>(
  field: K,
  value: MissionItem[K],
): void {
  updateState((current) => ({
    ...current,

    mission:
      current.mission.map(
        (item) =>
          item.id ===
          current.selectedId
            ? {
                ...item,
                [field]: value,
              }
            : item,
      ),

    status:
      current.status === "RUNNING" ||
      current.status === "PAUSED"
        ? current.status
        : "EDITING",
  }));
}

/* -------------------------------------------------------------------------- */
/* Rescue target                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Create or replace the current rescue target.
 *
 * Example:
 *
 * {
 *   id: "TARGET-001",
 *   latitude: 19.076421,
 *   longitude: 72.884216,
 *   confidence: 0.94,
 *   detectedBy: "DRONE",
 *   status: "DETECTED",
 *   assignedVehicle: null
 * }
 */
export function setRescueTarget(
  target: Omit<
    RescueTarget,
    "createdAt" | "updatedAt"
  > &
    Partial<
      Pick<
        RescueTarget,
        "createdAt" | "updatedAt"
      >
    >,
): void {
  const now =
    Date.now();

  updateState((current) => ({
    ...current,

    rescueTarget: {
      ...target,

      createdAt:
        target.createdAt ??
        now,

      updatedAt:
        target.updatedAt ??
        now,
    },
  }));
}

/**
 * Update only the fields supplied by the caller.
 */
export function updateRescueTarget(
  patch: Partial<
    Pick<
      RescueTarget,
      | "latitude"
      | "longitude"
      | "confidence"
      | "detectedBy"
      | "status"
      | "assignedVehicle"
    >
  >,
): void {
  updateState((current) => {
    if (!current.rescueTarget) {
      return current;
    }

    return {
      ...current,

      rescueTarget: {
        ...current.rescueTarget,
        ...patch,
        updatedAt:
          Date.now(),
      },
    };
  });
}

export function setRescueTargetStatus(
  status: RescueTargetStatus,
): void {
  updateRescueTarget({
    status,
  });
}

export function assignRescueTarget(
  vehicle: MissionVehicle,
): void {
  updateRescueTarget({
    assignedVehicle:
      vehicle,

    status:
      "ASSIGNED",
  });
}

export function clearRescueTarget(): void {
  updateState((current) => ({
    ...current,
    rescueTarget: null,
  }));
}

/**
 * Create or update the FASTY_TARGET mission item
 * from the currently stored rescue target.
 *
 * This keeps the rescue target connected to the
 * normal Mission Planner item list.
 */
export function syncRescueTargetMissionItem():
  | number
  | null {
  const target =
    state.rescueTarget;

  if (!target) {
    return null;
  }

  const existing =
    state.mission.find(
      (item) =>
        item.type ===
        "FASTY_TARGET",
    );

  if (existing) {
    updateState((current) => ({
      ...current,

      mission:
        current.mission.map(
          (item) =>
            item.id ===
            existing.id
              ? {
                  ...item,
                  label:
                    target.id,
                  latitude:
                    target.latitude,
                  longitude:
                    target.longitude,
                }
              : item,
        ),

      selectedId:
        existing.id,

      status:
        "EDITING",
    }));

    return existing.id;
  }

  const nextId =
    Math.max(
      0,
      ...state.mission.map(
        (item) => item.id,
      ),
    ) + 1;

  const targetItem:
    MissionItem = {
      id: nextId,
      type:
        "FASTY_TARGET",

      label:
        target.id,

      latitude:
        target.latitude,

      longitude:
        target.longitude,

      altitude: null,
      speed: null,
      hold: null,
    };

  updateState((current) => ({
    ...current,

    mission: [
      ...current.mission,
      targetItem,
    ],

    selectedId:
      nextId,

    status:
      "EDITING",
  }));

  return nextId;
}

/* -------------------------------------------------------------------------- */
/* Reset / mission replacement                                                */
/* -------------------------------------------------------------------------- */

export function clearMission(): void {
  state = {
    ...initialState,

    mission:
      initialMission.map(
        (item) => ({
          ...item,
        }),
      ),

    rescueTarget:
      null,
  };

  emit();
}

export function replaceMission(
  mission: MissionItem[],
): void {
  state = {
    ...state,

    mission,

    selectedId:
      mission[0]?.id ??
      1,

    status:
      mission.length > 1
        ? "READY"
        : "EDITING",

    activeMissionItemId:
      null,
  };

  emit();
}