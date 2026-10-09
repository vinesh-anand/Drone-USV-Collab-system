/* -------------------------------------------------------------------------- */
/* Mission execution engine                                                   */
/*                                                                            */
/* This module owns mission sequencing only. It does NOT talk to ROS,         */
/* MAVLink, MAVROS, hardware, or the browser UI directly. Vehicle-specific   */
/* execution is injected through MissionActionExecutor and will be connected  */
/* in later steps.                                                            */
/* -------------------------------------------------------------------------- */

import type {
  MissionAction,
  MissionActionType,
  MissionVehicle,
  MissionScriptParseResult,
} from "@/lib/mission/missionScriptParser";

export type MissionEngineStatus =
  | "IDLE"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "ABORTED"
  | "ERROR";

export interface MissionEngineState {
  status: MissionEngineStatus;
  currentActionIndex: number;
  totalActions: number;
  currentAction: MissionAction | null;
  lastCompletedAction: MissionAction | null;
  error: string | null;
}

export interface MissionActionExecutionContext {
  signal: AbortSignal;
  wait: (durationSeconds: number) => Promise<void>;
}

export type MissionActionExecutor = (
  action: MissionAction,
  context: MissionActionExecutionContext,
) => Promise<void>;

export interface MissionEngineOptions {
  executeAction: MissionActionExecutor;
  onStateChange?: (state: MissionEngineState) => void;
}

const INITIAL_STATE: MissionEngineState = {
  status: "IDLE",
  currentActionIndex: -1,
  totalActions: 0,
  currentAction: null,
  lastCompletedAction: null,
  error: null,
};

function cloneState(state: MissionEngineState): MissionEngineState {
  return { ...state };
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Returns a human-readable action label for logs/UI.
 */
export function getMissionActionLabel(action: MissionAction): string {
  return `${action.vehicle} ${action.type}`;
}

/**
 * Small execution coordinator for a parsed mission.
 *
 * The engine deliberately knows nothing about how DRONE or FASTY moves. That
 * responsibility belongs to the injected executor/vehicle adapters.
 */
export class MissionEngine {
  private readonly executeAction: MissionActionExecutor;
  private readonly onStateChange: ((state: MissionEngineState) => void) | undefined;

  private actions: MissionAction[] = [];
  private state: MissionEngineState = cloneState(INITIAL_STATE);
  private listeners = new Set<(state: MissionEngineState) => void>();

  private runPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  private pauseRequested = false;
  private resumeResolver: (() => void) | null = null;

  constructor(options: MissionEngineOptions) {
    this.executeAction = options.executeAction;
    this.onStateChange = options.onStateChange;
  }

  getState(): MissionEngineState {
    return cloneState(this.state);
  }

  getActions(): MissionAction[] {
    return this.actions.map((action) => ({
      ...action,
      parameters: { ...action.parameters },
    }));
  }

  subscribe(listener: (state: MissionEngineState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Loads a validated parser result without starting the mission.
   * Loading is intentionally separate from execution: LOAD -> READY -> START.
   */
  load(parseResult: MissionScriptParseResult): void {
    if (!parseResult.ok || !parseResult.mission) {
      throw new Error(
        parseResult.errors.length > 0
          ? parseResult.errors.join("; ")
          : "Mission script is invalid.",
      );
    }

    if (parseResult.mission.actions.length === 0) {
      throw new Error("Mission script contains no actions.");
    }

    if (this.state.status === "RUNNING" || this.state.status === "PAUSED") {
      throw new Error("Cannot load a mission while another mission is running.");
    }

    this.actions = parseResult.mission.actions.map((action) => ({
      ...action,
      parameters: { ...action.parameters },
    }));

    this.pauseRequested = false;
    this.abortController = null;
    this.resolvePauseWaiter();

    this.setState({
      status: "IDLE",
      currentActionIndex: -1,
      totalActions: this.actions.length,
      currentAction: null,
      lastCompletedAction: null,
      error: null,
    });
  }

  /**
   * Starts execution from the beginning of the loaded action list.
   * This method only starts the mission engine. Vehicle I/O remains inside the
   * injected executor.
   */
  start(): Promise<void> {
    if (this.actions.length === 0) {
      return Promise.reject(new Error("No mission is loaded."));
    }

    if (this.state.status === "RUNNING") {
      return this.runPromise ?? Promise.resolve();
    }

    if (this.state.status === "PAUSED") {
      return Promise.reject(
        new Error("Mission is paused. Use resume() instead of start()."),
      );
    }

    this.pauseRequested = false;
    this.abortController = new AbortController();

    this.setState({
      status: "RUNNING",
      currentActionIndex: 0,
      totalActions: this.actions.length,
      currentAction: this.actions[0] ?? null,
      lastCompletedAction: null,
      error: null,
    });

    this.runPromise = this.runFromCurrentAction();

    return this.runPromise;
  }

  pause(): void {
    if (this.state.status !== "RUNNING") {
      return;
    }

    this.pauseRequested = true;
    this.setState({ status: "PAUSED" });
  }

  resume(): Promise<void> {
    if (this.state.status !== "PAUSED") {
      return Promise.resolve();
    }

    this.pauseRequested = false;
    this.setState({ status: "RUNNING" });
    this.resolvePauseWaiter();

    if (!this.runPromise) {
      this.runPromise = this.runFromCurrentAction();
    }

    return this.runPromise;
  }

  abort(): void {
    if (
      this.state.status !== "RUNNING" &&
      this.state.status !== "PAUSED"
    ) {
      return;
    }

    this.pauseRequested = false;
    this.abortController?.abort();
    this.resolvePauseWaiter();

    this.setState({
      status: "ABORTED",
      currentAction: null,
    });
  }

  reset(): void {
    if (this.state.status === "RUNNING" || this.state.status === "PAUSED") {
      this.abort();
    }

    this.actions = [];
    this.abortController = null;
    this.pauseRequested = false;
    this.resolvePauseWaiter();
    this.runPromise = null;

    this.setState(cloneState(INITIAL_STATE));
  }

  private async runFromCurrentAction(): Promise<void> {
    try {
      while (this.state.currentActionIndex < this.actions.length) {
        await this.waitIfPausedOrAborted();

        const index = this.state.currentActionIndex;
        const action = this.actions[index];

        if (!action) {
          break;
        }

        this.setState({
          status: "RUNNING",
          currentAction: action,
        });

        const signal = this.abortController?.signal;
        if (!signal) {
          throw new Error("Mission execution controller is unavailable.");
        }

        await this.executeAction(action, {
          signal,
          wait: (durationSeconds) => this.wait(durationSeconds),
        });

        if (signal.aborted || this.state.status === "ABORTED") {
          return;
        }

        await this.waitIfPausedOrAborted();

        this.setState({
          lastCompletedAction: action,
          currentActionIndex: index + 1,
          currentAction:
            this.actions[index + 1] ?? null,
        });
      }

      if (this.state.status !== "ABORTED") {
        this.setState({
          status: "COMPLETED",
          currentAction: null,
          currentActionIndex: this.actions.length,
        });
      }
    } catch (error) {
      if (this.state.status === "ABORTED") {
        return;
      }

      const message =
        error instanceof Error ? error.message : "Mission execution failed.";

      this.setState({
        status: "ERROR",
        currentAction: null,
        error: message,
      });
    } finally {
      this.runPromise = null;
      this.abortController = null;
    }
  }

  private async waitIfPausedOrAborted(): Promise<void> {
    const signal = this.abortController?.signal;

    if (signal?.aborted) {
      throw new Error("Mission aborted.");
    }

    if (!this.pauseRequested && this.state.status !== "PAUSED") {
      return;
    }

    await new Promise<void>((resolve) => {
      this.resumeResolver = resolve;
    });

    if (signal?.aborted) {
      throw new Error("Mission aborted.");
    }
  }

  private async wait(durationSeconds: number): Promise<void> {
    if (!isFiniteNonNegativeNumber(durationSeconds)) {
      throw new Error("WAIT duration must be a non-negative number.");
    }

    if (durationSeconds === 0) {
      await this.waitIfPausedOrAborted();
      return;
    }

    const signal = this.abortController?.signal;
    if (!signal) {
      throw new Error("Mission execution controller is unavailable.");
    }

    const durationMilliseconds = durationSeconds * 1000;
    const startedAt = Date.now();

    while (Date.now() - startedAt < durationMilliseconds) {
      await this.waitIfPausedOrAborted();

      const remaining = durationMilliseconds - (Date.now() - startedAt);
      const slice = Math.min(250, Math.max(0, remaining));

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, slice);

        const onAbort = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          reject(new Error("Mission aborted."));
        };

        signal.addEventListener("abort", onAbort, { once: true });

        if (signal.aborted) {
          onAbort();
        }
      });
    }
  }

  private resolvePauseWaiter(): void {
    const resolver = this.resumeResolver;
    this.resumeResolver = null;
    resolver?.();
  }

  private setState(patch: Partial<MissionEngineState>): void {
    this.state = {
      ...this.state,
      ...patch,
    };

    const snapshot = this.getState();
    this.onStateChange?.(snapshot);
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

/**
 * Helper for UI/logging code that needs to inspect a mission action without
 * executing it.
 */
export function describeMissionAction(action: MissionAction): {
  index: number;
  vehicle: MissionVehicle;
  type: MissionActionType;
  parameters: Record<string, unknown>;
} {
  return {
    index: action.index,
    vehicle: action.vehicle,
    type: action.type,
    parameters: { ...action.parameters },
  };
}
