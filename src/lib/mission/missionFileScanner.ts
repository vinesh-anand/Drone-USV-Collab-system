import type {
  MissionItem,
  MissionItemType,
  MissionVehicle,
} from "@/lib/mission/missionStore";

export interface MissionFileItem {
  type: MissionItemType;
  label?: string;
  latitude?: number | null;
  longitude?: number | null;
  altitude?: number | null;
  speed?: number | null;
  hold?: number | null;
}

export interface MissionFile {
  name?: string;
  vehicle: MissionVehicle;
  mission: MissionFileItem[];
}

export interface MissionScanResult {
  valid: boolean;
  mission: MissionFile | null;
  errors: string[];
  warnings: string[];
  summary: {
    name: string;
    vehicle: MissionVehicle | null;
    itemCount: number;
    types: MissionItemType[];
  };
}

const SUPPORTED_TYPES: MissionItemType[] = [
  "TAKEOFF",
  "WAYPOINT",
  "LOITER",
  "LAND",
  "RTL",
  "FASTY_TARGET",
];

const SUPPORTED_VEHICLES: MissionVehicle[] = [
  "DRONE",
  "FASTY",
];

function isObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isFiniteNumber(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}

function isMissionVehicle(
  value: unknown,
): value is MissionVehicle {
  return (
    value === "DRONE" ||
    value === "FASTY"
  );
}

function isMissionItemType(
  value: unknown,
): value is MissionItemType {
  return (
    typeof value === "string" &&
    SUPPORTED_TYPES.includes(
      value as MissionItemType,
    )
  );
}

function isValidLatitude(
  value: unknown,
): boolean {
  return (
    isFiniteNumber(value) &&
    value >= -90 &&
    value <= 90
  );
}

function isValidLongitude(
  value: unknown,
): boolean {
  return (
    isFiniteNumber(value) &&
    value >= -180 &&
    value <= 180
  );
}

function hasValue(
  value: unknown,
): boolean {
  return (
    value !== null &&
    value !== undefined
  );
}

function normalizeNumber(
  value: unknown,
): number | null {
  return isFiniteNumber(value)
    ? value
    : null;
}

function normalizeMissionItem(
  raw: Record<string, unknown>,
): MissionFileItem {
  const item: MissionFileItem = {
    type: raw["type"] as MissionItemType,
    latitude: normalizeNumber(
      raw["latitude"],
    ),
    longitude: normalizeNumber(
      raw["longitude"],
    ),
    altitude: normalizeNumber(
      raw["altitude"],
    ),
    speed: normalizeNumber(
      raw["speed"],
    ),
    hold: normalizeNumber(
      raw["hold"],
    ),
  };

  const label = raw["label"];

  if (typeof label === "string") {
    item.label = label;
  }

  return item;
}

function validateCoordinatePair(
  item: MissionFileItem,
  index: number,
  errors: string[],
): void {
  const itemNumber = index + 1;

  if (!hasValue(item.latitude)) {
    errors.push(
      `Item ${itemNumber}: latitude is required.`,
    );
  } else if (
    !isValidLatitude(item.latitude)
  ) {
    errors.push(
      `Item ${itemNumber}: latitude must be between -90 and 90.`,
    );
  }

  if (!hasValue(item.longitude)) {
    errors.push(
      `Item ${itemNumber}: longitude is required.`,
    );
  } else if (
    !isValidLongitude(item.longitude)
  ) {
    errors.push(
      `Item ${itemNumber}: longitude must be between -180 and 180.`,
    );
  }
}

function validateOptionalNonNegative(
  value: unknown,
  field: string,
  index: number,
  errors: string[],
): void {
  if (!hasValue(value)) {
    return;
  }

  if (
    !isFiniteNumber(value) ||
    value < 0
  ) {
    errors.push(
      `Item ${index + 1}: ${field} must be a non-negative number.`,
    );
  }
}

function validateMissionItem(
  item: MissionFileItem,
  index: number,
  vehicle: MissionVehicle,
  errors: string[],
  warnings: string[],
): void {
  const itemNumber = index + 1;

  if (!isMissionItemType(item.type)) {
    errors.push(
      `Item ${itemNumber}: unsupported mission type "${String(
        item.type,
      )}".`,
    );
    return;
  }

  if (
    item.type === "WAYPOINT" ||
    item.type === "LOITER" ||
    item.type === "FASTY_TARGET"
  ) {
    validateCoordinatePair(
      item,
      index,
      errors,
    );
  }

  if (item.type === "TAKEOFF") {
    if (!hasValue(item.altitude)) {
      errors.push(
        `Item ${itemNumber}: TAKEOFF requires altitude.`,
      );
    } else if (
      !isFiniteNumber(item.altitude) ||
      item.altitude <= 0
    ) {
      errors.push(
        `Item ${itemNumber}: TAKEOFF altitude must be greater than 0.`,
      );
    }
  }

  if (item.type === "WAYPOINT") {
    if (!hasValue(item.altitude)) {
      errors.push(
        `Item ${itemNumber}: WAYPOINT requires altitude.`,
      );
    }

    if (!hasValue(item.speed)) {
      errors.push(
        `Item ${itemNumber}: WAYPOINT requires speed.`,
      );
    }
  }

  if (item.type === "LOITER") {
    if (!hasValue(item.hold)) {
      errors.push(
        `Item ${itemNumber}: LOITER requires hold time.`,
      );
    }
  }

  validateOptionalNonNegative(
    item.altitude,
    "altitude",
    index,
    errors,
  );

  validateOptionalNonNegative(
    item.speed,
    "speed",
    index,
    errors,
  );

  validateOptionalNonNegative(
    item.hold,
    "hold",
    index,
    errors,
  );

  if (
    item.type === "FASTY_TARGET" &&
    vehicle !== "FASTY"
  ) {
    warnings.push(
      `Item ${itemNumber}: FASTY_TARGET is a GCS/rescue-layer item and is not uploaded as a normal ArduCopter mission command.`,
    );
  }
}

function validateMissionSequence(
  mission: MissionFileItem[],
  errors: string[],
): void {
  if (mission.length === 0) {
    errors.push(
      "Mission must contain at least one item.",
    );
    return;
  }

  if (mission[0]?.type !== "TAKEOFF") {
    errors.push(
      "The first mission item must be TAKEOFF.",
    );
  }

  const terminalTypes =
    new Set<MissionItemType>([
      "LAND",
      "RTL",
    ]);

  mission.forEach(
    (item, index) => {
      if (
        terminalTypes.has(item.type) &&
        index !== mission.length - 1
      ) {
        errors.push(
          `Item ${index + 1}: ${item.type} must be the final mission item.`,
        );
      }
    },
  );
}

function validateVehicleCompatibility(
  vehicle: MissionVehicle,
  mission: MissionFileItem[],
  warnings: string[],
): void {
  if (
    vehicle === "FASTY" &&
    mission.some(
      (item) =>
        item.type === "TAKEOFF" ||
        item.type === "LOITER" ||
        item.type === "LAND",
    )
  ) {
    warnings.push(
      "FASTY is represented by the ground-vehicle/rescue layer. TAKEOFF/LOITER/LAND may require vehicle-specific handling before execution.",
    );
  }
}

export function scanMissionFileText(
  text: string,
  fallbackName = "mission.json",
): MissionScanResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      valid: false,
      mission: null,
      errors: [
        `Invalid JSON: ${
          error instanceof Error
            ? error.message
            : "unable to parse file"
        }`,
      ],
      warnings: [],
      summary: {
        name: fallbackName,
        vehicle: null,
        itemCount: 0,
        types: [],
      },
    };
  }

  if (!isObject(parsed)) {
    return {
      valid: false,
      mission: null,
      errors: [
        "Mission file root must be a JSON object.",
      ],
      warnings: [],
      summary: {
        name: fallbackName,
        vehicle: null,
        itemCount: 0,
        types: [],
      },
    };
  }

  const rawVehicle = parsed["vehicle"];

  const vehicle =
    isMissionVehicle(rawVehicle)
      ? rawVehicle
      : null;

  if (!vehicle) {
    errors.push(
      `Unsupported or missing vehicle. Expected one of: ${SUPPORTED_VEHICLES.join(
        ", ",
      )}.`,
    );
  }

  const rawMission = parsed["mission"];

  if (!Array.isArray(rawMission)) {
    errors.push(
      "Mission file must contain a 'mission' array.",
    );
  }

  const mission: MissionFileItem[] = [];

  if (Array.isArray(rawMission)) {
    rawMission.forEach(
      (rawItem, index) => {
        if (!isObject(rawItem)) {
          errors.push(
            `Item ${index + 1}: mission item must be an object.`,
          );
          return;
        }

        const item =
          normalizeMissionItem(rawItem);

        mission.push(item);

        if (vehicle) {
          validateMissionItem(
            item,
            index,
            vehicle,
            errors,
            warnings,
          );
        } else if (
          !isMissionItemType(item.type)
        ) {
          errors.push(
            `Item ${index + 1}: unsupported mission type "${String(
              item.type,
            )}".`,
          );
        }
      },
    );

    validateMissionSequence(
      mission,
      errors,
    );

    if (vehicle) {
      validateVehicleCompatibility(
        vehicle,
        mission,
        warnings,
      );
    }
  }

  const rawName = parsed["name"];

  const name =
    typeof rawName === "string" &&
    rawName.trim().length > 0
      ? rawName.trim()
      : fallbackName;

  return {
    valid: errors.length === 0,
    mission:
      errors.length === 0 && vehicle
        ? {
            name,
            vehicle,
            mission,
          }
        : null,
    errors,
    warnings,
    summary: {
      name,
      vehicle,
      itemCount: mission.length,
      types: mission
        .map((item) => item.type)
        .filter(isMissionItemType),
    },
  };
}

export async function scanMissionFile(
  file: File,
): Promise<MissionScanResult> {
  const extension = file.name
    .toLowerCase()
    .split(".")
    .pop();

  if (extension !== "json") {
    return {
      valid: false,
      mission: null,
      errors: [
        "Unsupported mission file. Currently supported format: .json",
      ],
      warnings: [],
      summary: {
        name: file.name,
        vehicle: null,
        itemCount: 0,
        types: [],
      },
    };
  }

  try {
    const text = await file.text();

    return scanMissionFileText(
      text,
      file.name,
    );
  } catch (error) {
    return {
      valid: false,
      mission: null,
      errors: [
        `Unable to read mission file: ${
          error instanceof Error
            ? error.message
            : "unknown error"
        }`,
      ],
      warnings: [],
      summary: {
        name: file.name,
        vehicle: null,
        itemCount: 0,
        types: [],
      },
    };
  }
}

/**
 * Converts a validated mission-file item into
 * the existing mission-store representation.
 *
 * IDs are assigned sequentially so the existing
 * Mission Planner can load the result without
 * changing its current data model.
 */
export function missionFileToMissionItems(
  mission: MissionFile,
): MissionItem[] {
  return mission.mission.map(
    (item, index) => ({
      id: index + 1,
      type: item.type,
      label:
        item.label ??
        `${item.type} ${index + 1}`,
      latitude:
        item.latitude ?? null,
      longitude:
        item.longitude ?? null,
      altitude:
        item.altitude ?? null,
      speed:
        item.speed ?? null,
      hold:
        item.hold ?? null,
    }),
  );
}