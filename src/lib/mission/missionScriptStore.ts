import { useSyncExternalStore } from "react";

import {
  MissionEngine,
  type MissionEngineState,
  type MissionActionExecutor,
} from "@/lib/mission/missionEngine";
import {
  parseMissionScript,
  type MissionScriptParseResult,
} from "@/lib/mission/missionScriptParser";
import { createMissionExecutors } from "@/lib/mission/missionExecutors";

export type MissionMode = "RESCUE" | "CUSTOM";

export type CustomMissionStatus =
  | "EMPTY"
  | "READY"
  | "RUNNING"
  | "PAUSED"
  | "ABORTED";

export interface MissionScriptState {
  mode: MissionMode;
  customMissionStatus: CustomMissionStatus;
  scriptName: string | null;
  scriptText: string | null;
  parseResult: MissionScriptParseResult | null;
  engineState: MissionEngineState;
}

const EMPTY_ENGINE_STATE: MissionEngineState = {
  status: "IDLE",
  currentActionIndex: -1,
  totalActions: 0,
  currentAction: null,
  lastCompletedAction: null,
  error: null,
};

const EMPTY_STATE: MissionScriptState = {
  mode: "RESCUE",
  customMissionStatus: "EMPTY",
  scriptName: null,
  scriptText: null,
  parseResult: null,
  engineState: EMPTY_ENGINE_STATE,
};

let state: MissionScriptState = EMPTY_STATE;
const listeners = new Set<() => void>();

/**
 * Shared execution registry for the mission engine.
 *
 * By default this installs explicit unavailable executors for DRONE and FASTY.
 * That means the software execution chain is connected, while real vehicle
 * control remains disabled until real adapters are supplied intentionally.
 */
const missionExecutors = createMissionExecutors({
  useUnavailableExecutors: true,
});

/**
 * Optional compatibility override for callers that need to inject a custom
 * action executor. The shared registry remains the default execution path.
 */
let missionExecutorOverride: MissionActionExecutor | null = null;

const missionEngine = new MissionEngine({
  executeAction: async (action, context) => {
    if (missionExecutorOverride) {
      await missionExecutorOverride(action, context);
      return;
    }

    await missionExecutors.executeAction(action, context);
  },
  onStateChange: (engineState) => {
    state = {
      ...state,
      engineState,
      customMissionStatus: mapEngineStatusToCustomStatus(
        engineState.status,
        state.customMissionStatus,
      ),
    };
    emit();
  },
});

function emit(): void {
  listeners.forEach((listener) => listener());
}

function update(next: MissionScriptState): void {
  state = next;
  emit();
}

function mapEngineStatusToCustomStatus(
  engineStatus: MissionEngineState["status"],
  currentStatus: CustomMissionStatus,
): CustomMissionStatus {
  switch (engineStatus) {
    case "RUNNING":
      return "RUNNING";
    case "PAUSED":
      return "PAUSED";
    case "ABORTED":
      return "ABORTED";
    case "COMPLETED":
      return "READY";
    case "ERROR":
      return "ABORTED";
    case "IDLE":
    default:
      return currentStatus === "EMPTY" ? "EMPTY" : "READY";
  }
}

export function getMissionScriptState(): MissionScriptState {
  return state;
}

export function subscribeMissionScriptState(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMissionScriptState(): MissionScriptState {
  return useSyncExternalStore(
    subscribeMissionScriptState,
    getMissionScriptState,
    getMissionScriptState,
  );
}

/**
 * Connects the mission engine to a custom vehicle execution adapter.
 *
 * Passing null restores the shared DRONE/FASTY executor registry as the
 * default execution path.
 */
export function setMissionExecutor(executor: MissionActionExecutor | null): void {
  missionExecutorOverride = executor;
}

export function loadMissionScript(
  scriptName: string,
  scriptText: string,
): void {
  const parseResult = parseMissionScript(scriptText);

  if (parseResult.ok) {
    missionEngine.load(parseResult);
  }

  update({
    mode: "CUSTOM",
    customMissionStatus: parseResult.ok ? "READY" : "EMPTY",
    scriptName,
    scriptText,
    parseResult,
    engineState: parseResult.ok
      ? missionEngine.getState()
      : EMPTY_ENGINE_STATE,
  });
}

export function clearMissionScript(): void {
  missionEngine.reset();
  update({
    ...EMPTY_STATE,
  });
}

export function setMissionMode(mode: MissionMode): void {
  update({
    ...state,
    mode,
  });
}

export function startCustomMission(): void {
  if (
    !state.scriptName ||
    !state.scriptText ||
    !state.parseResult?.ok
  ) {
    return;
  }

  if (state.customMissionStatus === "RUNNING") {
    return;
  }

  void missionEngine.start();
}

export function pauseCustomMission(): void {
  if (state.customMissionStatus !== "RUNNING") {
    return;
  }

  missionEngine.pause();
}

export function resumeCustomMission(): void {
  if (state.customMissionStatus !== "PAUSED") {
    return;
  }

  void missionEngine.resume();
}

export function abortCustomMission(): void {
  if (
    state.customMissionStatus !== "RUNNING" &&
    state.customMissionStatus !== "PAUSED"
  ) {
    return;
  }

  missionEngine.abort();
}

export function returnToRescueWorkflow(): void {
  if (
    state.customMissionStatus === "RUNNING" ||
    state.customMissionStatus === "PAUSED"
  ) {
    missionEngine.abort();
  }

  update({
    ...state,
    mode: "RESCUE",
  });
}

export function getMissionEngine(): MissionEngine {
  return missionEngine;
}

export function getMissionExecutors() {
  return missionExecutors;
}
