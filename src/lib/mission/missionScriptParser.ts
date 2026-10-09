/* -------------------------------------------------------------------------- */
/* Mission script parser                                                     */
/*                                                                            */
/* This parser intentionally does NOT execute Python. It accepts the small    */
/* mission-definition syntax used by the dashboard and converts it into a    */
/* validated action list that the mission engine can execute later.           */
/* -------------------------------------------------------------------------- */

export type MissionVehicle = "DRONE" | "FASTY";

export type MissionActionType =
  | "TAKEOFF"
  | "LAND"
  | "RTL"
  | "GOTO"
  | "WAYPOINT"
  | "LOITER"
  | "WAIT"
  | "STOP"
  | "SWIM_AROUND"
  | "SEARCH_PATTERN"
  | "SET_SPEED"
  | "SET_ALTITUDE";

export type MissionActionValue =
  | string
  | number
  | boolean
  | null
  | MissionActionValue[]
  | { [key: string]: MissionActionValue };

export interface MissionAction {
  index: number;
  vehicle: MissionVehicle;
  type: MissionActionType;
  parameters: Record<string, MissionActionValue>;
}

export interface ParsedMissionScript {
  source: string;
  actions: MissionAction[];
}

export interface MissionScriptParseResult {
  ok: boolean;
  mission: ParsedMissionScript | null;
  errors: string[];
  warnings: string[];
}

const SUPPORTED_ACTIONS = new Set<MissionActionType>([
  "TAKEOFF",
  "LAND",
  "RTL",
  "GOTO",
  "WAYPOINT",
  "LOITER",
  "WAIT",
  "STOP",
  "SWIM_AROUND",
  "SEARCH_PATTERN",
  "SET_SPEED",
  "SET_ALTITUDE",
]);

const ACTION_PATTERN =
  /^\s*\(\s*(["'])(DRONE|FASTY)\1\s*,\s*(["'])([A-Z_]+)\3\s*,\s*(\{.*\})\s*\)\s*,?\s*$/;

function stripComments(source: string): string {
  return source
    .split(/\r?\n/)
    .map((line) => {
      let quote: "'" | '"' | null = null;
      let escaped = false;

      for (let index = 0; index < line.length; index += 1) {
        const character = line[index];

        if (escaped) {
          escaped = false;
          continue;
        }

        if (character === "\\") {
          escaped = true;
          continue;
        }

        if (quote) {
          if (character === quote) {
            quote = null;
          }
          continue;
        }

        if (character === '"' || character === "'") {
          quote = character;
          continue;
        }

        if (character === "#") {
          return line.slice(0, index);
        }
      }

      return line;
    })
    .join("\n");
}

function normalizePythonObjectLiteral(value: string): string {
  return value
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null")
    .replace(/'/g, '"');
}

function parseParameters(
  raw: string,
  actionNumber: number,
): Record<string, MissionActionValue> {
  const normalized = normalizePythonObjectLiteral(raw);

  let parsed: unknown;

  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error(
      `Action ${actionNumber}: parameters must be a valid Python-style dictionary using simple values.`,
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      `Action ${actionNumber}: parameters must be an object/dictionary.`,
    );
  }

  return parsed as Record<string, MissionActionValue>;
}

function validateNumber(
  parameters: Record<string, MissionActionValue>,
  key: string,
  actionNumber: number,
): void {
  const value = parameters[key];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `Action ${actionNumber}: '${key}' must be a finite number.`,
    );
  }
}

function validateActionParameters(
  vehicle: MissionVehicle,
  type: MissionActionType,
  parameters: Record<string, MissionActionValue>,
  actionNumber: number,
): void {
  switch (type) {
    case "TAKEOFF":
      if (vehicle !== "DRONE") {
        throw new Error(
          `Action ${actionNumber}: TAKEOFF is only valid for DRONE.`,
        );
      }
      validateNumber(parameters, "altitude", actionNumber);
      break;

    case "LAND":
      if (vehicle !== "DRONE") {
        throw new Error(
          `Action ${actionNumber}: LAND is only valid for DRONE.`,
        );
      }
      break;

    case "RTL":
      break;

    case "GOTO":
    case "WAYPOINT":
      validateNumber(parameters, "lat", actionNumber);
      validateNumber(parameters, "lon", actionNumber);

      if (
        (parameters["lat"] as number) < -90 ||
        (parameters["lat"] as number) > 90
      ) {
        throw new Error(
          `Action ${actionNumber}: 'lat' must be between -90 and 90.`,
        );
      }

      if (
        (parameters["lon"] as number) < -180 ||
        (parameters["lon"] as number) > 180
      ) {
        throw new Error(
          `Action ${actionNumber}: 'lon' must be between -180 and 180.`,
        );
      }
      break;

    case "LOITER":
      validateNumber(parameters, "duration", actionNumber);
      if ((parameters["duration"] as number) < 0) {
        throw new Error(
          `Action ${actionNumber}: 'duration' cannot be negative.`,
        );
      }
      break;

    case "WAIT":
      validateNumber(parameters, "duration", actionNumber);
      if ((parameters["duration"] as number) < 0) {
        throw new Error(
          `Action ${actionNumber}: 'duration' cannot be negative.`,
        );
      }
      break;

    case "STOP":
      break;

    case "SWIM_AROUND":
      if (vehicle !== "FASTY") {
        throw new Error(
          `Action ${actionNumber}: SWIM_AROUND is only valid for FASTY.`,
        );
      }
      validateNumber(parameters, "radius", actionNumber);
      validateNumber(parameters, "duration", actionNumber);
      if ((parameters["radius"] as number) <= 0) {
        throw new Error(
          `Action ${actionNumber}: 'radius' must be greater than 0.`,
        );
      }
      if ((parameters["duration"] as number) < 0) {
        throw new Error(
          `Action ${actionNumber}: 'duration' cannot be negative.`,
        );
      }
      break;

    case "SEARCH_PATTERN":
      if (vehicle !== "DRONE" && vehicle !== "FASTY") {
        throw new Error(
          `Action ${actionNumber}: SEARCH_PATTERN has an invalid vehicle.`,
        );
      }
      break;

    case "SET_SPEED":
      validateNumber(parameters, "speed", actionNumber);
      if ((parameters["speed"] as number) < 0) {
        throw new Error(
          `Action ${actionNumber}: 'speed' cannot be negative.`,
        );
      }
      break;

    case "SET_ALTITUDE":
      if (vehicle !== "DRONE") {
        throw new Error(
          `Action ${actionNumber}: SET_ALTITUDE is only valid for DRONE.`,
        );
      }
      validateNumber(parameters, "altitude", actionNumber);
      break;
  }
}

function extractMissionBody(source: string): string | null {
  const match = source.match(/\bmission\s*=\s*\[/);

  if (!match || match.index === undefined) {
    return null;
  }

  const start = match.index + match[0].length;
  let depth = 1;
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(start, index);
      }
    }
  }

  return null;
}

export function parseMissionScript(source: string): MissionScriptParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof source !== "string" || source.trim().length === 0) {
    return {
      ok: false,
      mission: null,
      errors: ["Mission script is empty."],
      warnings,
    };
  }

  const cleaned = stripComments(source);
  const body = extractMissionBody(cleaned);

  if (body === null) {
    return {
      ok: false,
      mission: null,
      errors: ["No 'mission = [...]' definition was found."],
      warnings,
    };
  }

  const actions: MissionAction[] = [];
  const lines = body.split(/\r?\n/);

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim();

    if (!trimmed) {
      return;
    }

    const match = trimmed.match(ACTION_PATTERN);

    if (!match) {
      errors.push(
        `Line ${lineIndex + 1}: expected ('DRONE'|'FASTY', 'ACTION', {...}).`,
      );
      return;
    }

    const vehicle = match[2] as MissionVehicle;
    const actionName = match[4] as MissionActionType;

    if (!SUPPORTED_ACTIONS.has(actionName)) {
      errors.push(
        `Line ${lineIndex + 1}: unsupported action '${actionName}'.`,
      );
      return;
    }

    try {
      const parameters = parseParameters(
        match[5] ?? "{}",
        actions.length + 1,
      );

      validateActionParameters(
        vehicle,
        actionName,
        parameters,
        actions.length + 1,
      );

      actions.push({
        index: actions.length,
        vehicle,
        type: actionName,
        parameters,
      });
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message
          : `Action ${actions.length + 1}: invalid parameters.`,
      );
    }
  });

  if (actions.length === 0 && errors.length === 0) {
    errors.push("Mission script contains no actions.");
  }

  if (actions.some((action) => action.type === "SEARCH_PATTERN")) {
    warnings.push(
      "SEARCH_PATTERN is parsed for mission visualization; execution support will be provided by the mission engine.",
    );
  }

  return {
    ok: errors.length === 0,
    mission:
      errors.length === 0
        ? {
            source,
            actions,
          }
        : null,
    errors,
    warnings,
  };
}

export function isSupportedMissionAction(
  value: string,
): value is MissionActionType {
  return SUPPORTED_ACTIONS.has(value as MissionActionType);
}

export function getSupportedMissionActions(): MissionActionType[] {
  return Array.from(SUPPORTED_ACTIONS);
}
