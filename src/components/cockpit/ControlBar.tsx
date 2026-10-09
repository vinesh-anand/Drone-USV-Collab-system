import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  Square,
  Home,
  Navigation,
  FileCode2,
  FileText,
  OctagonAlert,
  X,
  Radio,
  Loader2,
  Upload,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TelemetrySnapshot } from "@/lib/telemetry";
import { useFastyControl } from "@/lib/useFastyControl";
import { useDroneControl } from "@/lib/useDroneControl";
import srotaControl from "@/lib/ros/srotaControl";
import {
  abortCustomMission as abortMissionScript,
  clearMissionScript,
  loadMissionScript,
  getMissionScriptState,
  pauseCustomMission as pauseMissionScript,
  resumeCustomMission as resumeMissionScript,
  returnToRescueWorkflow,
  setMissionMode,
  startCustomMission as startMissionScript,
  useMissionScriptState,
} from "@/lib/mission/missionScriptStore";

type Command =
  | "HOLD"
  | "STOP"
  | "RTL (DRONE)"
  | "RTH (FASTY)"
  | "EMERGENCY STOP";

/** Which SROTA movement service is currently blocking (if any). */
type SrotaTask = "GOTO" | "HOME" | "FOLLOW";

const critical: Command[] = [
  "STOP",
  "RTL (DRONE)",
  "RTH (FASTY)",
  "EMERGENCY STOP",
];

function ConfirmDialog({
  command,
  onCancel,
  onConfirm,
  busy,
}: {
  command: Command;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  const isFastyCommand =
    command === "STOP" ||
    command === "RTH (FASTY)" ||
    command === "EMERGENCY STOP";

  const isDroneCommand = command === "RTL (DRONE)";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4">
      <div className="w-full max-w-sm rounded-[3px] border border-fault/60 bg-popover shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="flex items-center gap-2 text-[12px] font-bold tracking-[0.08em] text-fault">
            <OctagonAlert size={15} />
            CONFIRM COMMAND
          </span>

          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Cancel"
            className="text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-3 py-3">
          <p className="text-[12px] text-muted-foreground">
            Execute safety-critical command
            <span className="value-mono ml-1 font-bold text-foreground">
              {command}
            </span>
            ?
          </p>

          {isFastyCommand ? (
            <div className="mt-3 border border-fasty/30 bg-fasty/5 px-2 py-2 text-[11px] text-fasty">
              This command can transmit a real command to the FASTY Mini Pix
              through the verified SROTA/MAVROS control path.
            </div>
          ) : isDroneCommand ? (
            <div className="mt-3 border border-drone/30 bg-drone/5 px-2 py-2 text-[11px] text-drone">
              This command can transmit a real RTL command to the Drone
              through MAVROS.
            </div>
          ) : null}

          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-[2px] border border-border px-3 py-1.5 text-[11px] font-bold tracking-wide hover:bg-accent disabled:opacity-40"
            >
              CANCEL
            </button>

            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="flex min-w-[92px] items-center justify-center gap-2 rounded-[2px] border border-fault bg-fault/20 px-3 py-1.5 text-[11px] font-bold tracking-wide text-fault hover:bg-fault/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 size={13} className="animate-spin" />
              ) : null}
              {busy ? "SENDING..." : "CONFIRM"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ControlBar({
  telemetry,
}: {
  telemetry: TelemetrySnapshot;
}) {
  // Keep the existing prop contract; the alert widget has been replaced.
  void telemetry;

  const [pending, setPending] = useState<Command | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [srotaBusy, setSrotaBusy] = useState(false);
  const [srotaTask, setSrotaTask] = useState<SrotaTask | null>(null);

  const [missionOpen, setMissionOpen] = useState(false);

  const missionScript = useMissionScriptState();

  const {
    mode: missionMode,
    customMissionStatus,
    scriptName,
    scriptText,
  } = missionScript;

  const fileInputRef =
    useRef<HTMLInputElement | null>(null);

  const {
    connected: fastyConnected,
    busy: fastyBusy,
    error: fastyError,
    lastResult: fastyResult,
    setMode,
  } = useFastyControl();

  const {
    connected: droneConnected,
    busy: droneBusy,
    error: droneError,
    lastResult: droneResult,
    rtl: droneRtl,
  } = useDroneControl();

  useEffect(() => {
    if (!fastyResult && !fastyError) {
      return;
    }

    const message =
      fastyResult?.message ??
      fastyError ??
      null;

    if (message) {
      setLast(message);
    }
  }, [fastyError, fastyResult]);

  useEffect(() => {
    if (!droneResult && !droneError) {
      return;
    }

    const message =
      droneResult?.message ??
      droneError ??
      null;

    if (message) {
      setLast(message);
    }
  }, [droneError, droneResult]);

  const executeSrota = async (
    operation: () => ReturnType<
      typeof srotaControl.gotoDrone
    >,
    task: SrotaTask,
  ): Promise<void> => {
    if (srotaBusy) {
      return;
    }

    if (!fastyConnected) {
      setLast(
        "SROTA command blocked: FASTY MAVROS / ROSBridge is not connected",
      );
      return;
    }

    setSrotaBusy(true);
    setSrotaTask(task);

    try {
      const result = await operation();
      setLast(result.message);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown SROTA control error.";

      setLast(`SROTA control error: ${message}`);
    } finally {
      setSrotaBusy(false);
      setSrotaTask(null);
    }
  };

  /**
   * Stop is intentionally separate from executeSrota().
   *
   * During an active rescue mission, srotaBusy is already true because
   * /srota/goto_drone is blocking until the leg finishes.
   *
   * /srota/stop must therefore bypass the normal busy guard so that
   * it can interrupt the active SROTA leg.
   */
  const interruptSrota = async (): Promise<void> => {
    if (!fastyConnected) {
      setLast(
        "SROTA STOP blocked: FASTY MAVROS / ROSBridge is not connected",
      );
      return;
    }

    try {
      const result = await srotaControl.stop();
      setLast(result.message);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown SROTA stop error.";

      setLast(`SROTA STOP error: ${message}`);
    }
  };

  const startRescueWorkflow = async (): Promise<void> => {
    await executeSrota(
      srotaControl.gotoDrone,
      "GOTO",
    );
  };

  /**
   * FOLLOW mode: FASTY continuously tracks the Drone's live GPS position.
   *
   * /srota/follow blocks until /srota/stop is called, so srotaBusy stays
   * true for the whole follow. HOLD and STOP remain enabled (they are not
   * gated on srotaBusy) and interrupt it via interruptSrota().
   */
  const startFollow = async (): Promise<void> => {
    if (srotaBusy || !fastyConnected) {
      if (!fastyConnected) {
        setLast(
          "SROTA FOLLOW blocked: FASTY MAVROS / ROSBridge is not connected",
        );
      }
      return;
    }

    setLast(
      "FOLLOW requested: FASTY will track the Drone until STOP",
    );

    await executeSrota(
      srotaControl.follow,
      "FOLLOW",
    );
  };

  const run = (cmd: Command) => {
    if (critical.includes(cmd)) {
      setPending(cmd);
      return;
    }

    if (cmd === "HOLD") {
      void executeCommand(cmd);
      return;
    }

    setLast(`${cmd} is not implemented`);
  };

  const executeCommand = async (
    cmd: Command,
  ): Promise<void> => {
    setPending(null);

    if (cmd === "RTL (DRONE)") {
      if (!droneConnected) {
        setLast(
          "DRONE RTL blocked: MAVROS / ROSBridge is not connected",
        );
        return;
      }

      const result = await droneRtl();

      setLast(result.message);
      return;
    }

    if (!fastyConnected) {
      setLast(
        "FASTY command blocked: MAVROS / ROSBridge is not connected",
      );
      return;
    }

    if (cmd === "HOLD") {
      /*
       * When SROTA is actively driving FASTY, direct HOLD is not enough
       * because SROTA is continuously publishing GUIDED setpoints.
       *
       * Interrupt the SROTA leg instead.
       */
      if (srotaBusy) {
        await interruptSrota();
        return;
      }

      const result = await setMode("HOLD");

      setLast(result.message);
      return;
    }

    if (cmd === "STOP") {
      /*
       * /srota/stop is specifically designed to interrupt an active
       * /srota/goto_drone, /srota/return_home or /srota/follow operation.
       */
      await interruptSrota();
      return;
    }

    if (cmd === "RTH (FASTY)") {
      await executeSrota(
        srotaControl.returnHome,
        "HOME",
      );
      return;
    }

    if (cmd === "EMERGENCY STOP") {
      /*
       * We do NOT invent a dedicated emergency-stop
       * hardware interface.
       */
      setLast(
        "EMERGENCY STOP is not yet mapped to a verified hardware emergency-stop interface",
      );
    }
  };

  const handleScriptSelect = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".py")) {
      setLast(
        "Mission script rejected: select a Python .py file",
      );
      event.target.value = "";
      return;
    }

    try {
      const text = await file.text();

      loadMissionScript(
        file.name,
        text,
      );

      const loadedMission = getMissionScriptState();

      if (!loadedMission.parseResult?.ok) {
        const errorMessage =
          loadedMission.parseResult?.errors?.join(" | ") ??
          "Mission script parsing failed.";

        setLast(
          `Mission script ERROR: ${errorMessage}`,
        );

        return;
      }

      setLast(
        `Mission script loaded: ${file.name} — READY`,
      );
    } catch {
      setLast(
        `Mission script could not be read: ${file.name}`,
      );
    } finally {
      event.target.value = "";
    }
  };

  const removeScript = () => {
    clearMissionScript();

    setLast(
      "Custom mission removed — RESCUE WORKFLOW active",
    );
  };

  const startCustomMission = () => {
    if (!scriptName || !scriptText) {
      setLast(
        "No custom mission script is loaded",
      );
      return;
    }

    /*
     * Existing CUSTOM mission behavior remains
     * UI-only for this step.
     *
     * This does NOT arm, move, upload, or command
     * either vehicle.
     */
    startMissionScript();

    setLast(
      `Custom mission START requested: ${scriptName}`,
    );
  };

  const pauseCustomMission = () => {
    if (
      customMissionStatus !==
      "RUNNING"
    ) {
      return;
    }

    pauseMissionScript();

    setLast(
      `Custom mission PAUSE requested: ${scriptName ?? "script"}`,
    );
  };

  const resumeCustomMission = () => {
    if (
      customMissionStatus !==
      "PAUSED"
    ) {
      return;
    }

    resumeMissionScript();

    setLast(
      `Custom mission RESUME requested: ${scriptName ?? "script"}`,
    );
  };

  const abortCustomMission = () => {
    if (
      customMissionStatus !== "RUNNING" &&
      customMissionStatus !== "PAUSED"
    ) {
      return;
    }

    abortMissionScript();
    returnToRescueWorkflow();

    setLast(
      "Custom mission ABORT requested — RESCUE WORKFLOW active",
    );
  };

  const customMissionActive =
    customMissionStatus === "RUNNING" ||
    customMissionStatus === "PAUSED";

  const missionStatusLabel =
    missionMode === "RESCUE"
      ? "RESCUE WORKFLOW"
      : customMissionStatus === "READY"
        ? "CUSTOM MISSION READY"
        : customMissionStatus === "RUNNING"
          ? "CUSTOM MISSION RUNNING"
          : customMissionStatus === "PAUSED"
            ? "CUSTOM MISSION PAUSED"
            : customMissionStatus === "ABORTED"
              ? "RESCUE WORKFLOW"
              : "CUSTOM MISSION";

  const missionStatusTone =
    missionMode === "RESCUE"
      ? "text-fasty"
      : customMissionStatus === "RUNNING"
        ? "text-ok"
        : customMissionStatus === "PAUSED"
          ? "text-drone"
          : "text-muted-foreground";

  const btn =
    "flex items-center justify-center gap-2 rounded-[3px] border px-3 py-2 text-[12px] font-bold tracking-[0.08em] transition-colors disabled:cursor-not-allowed disabled:opacity-40";

  /*
   * HOLD and STOP must remain available during an active SROTA rescue.
   * Therefore srotaBusy is intentionally NOT part of this disabled state.
   */
  const fastyControlDisabled =
    fastyBusy ||
    !fastyConnected;

  /*
   * RTH starts another SROTA movement leg, so keep it disabled while
   * another SROTA leg is currently active.
   */
  const rthDisabled =
    fastyBusy ||
    !fastyConnected ||
    srotaBusy;

  /*
   * FOLLOW is also a SROTA movement leg, so it follows the same rule as
   * RTH: disabled while any other SROTA leg is active.
   */
  const followDisabled = rthDisabled;

  const droneControlDisabled =
    droneBusy ||
    !droneConnected;

  return (
    <>
      <footer className="relative flex h-16 shrink-0 items-center gap-2 border-t border-border bg-panel px-2">
        <button
          type="button"
          onClick={() =>
            setMissionOpen(
              (open) => !open,
            )
          }
          aria-expanded={missionOpen}
          className={cn(
            "flex h-11 min-w-[230px] items-center gap-2 rounded-[3px] border px-2 text-left transition-colors",
            missionOpen
              ? "border-drone/60 bg-drone/10"
              : "border-border hover:bg-accent",
          )}
        >
          <FileText
            size={16}
            className={cn(
              missionMode === "CUSTOM"
                ? "text-drone"
                : "text-fasty",
            )}
          />

          <div className="min-w-0 flex-1 leading-tight">
            <div className="label-xs">
              MISSION
            </div>

            <div
              className={cn(
                "truncate text-[11px] font-bold tracking-wide",
                missionStatusTone,
              )}
            >
              {missionStatusLabel}
            </div>
          </div>

          <span className="text-[10px] text-muted-foreground">
            {missionOpen
              ? "CLOSE"
              : "OPEN"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (
              missionMode === "CUSTOM"
            ) {
              if (
                customMissionStatus ===
                "RUNNING"
              ) {
                pauseCustomMission();
              } else if (
                customMissionStatus ===
                "PAUSED"
              ) {
                resumeCustomMission();
              } else {
                startCustomMission();
              }

              return;
            }

            void startRescueWorkflow();
          }}
          disabled={
            (missionMode === "CUSTOM" &&
              !scriptName) ||
            (missionMode === "RESCUE" &&
              srotaBusy)
          }
          className={cn(
            btn,
            "h-11 flex-1 border-ok/60 bg-ok/15 text-ok hover:bg-ok/25",
          )}
          title={
            missionMode === "CUSTOM"
              ? customMissionStatus ===
                "RUNNING"
                ? "Pause custom mission"
                : customMissionStatus ===
                    "PAUSED"
                  ? "Resume custom mission"
                  : "Start loaded custom mission"
              : "Dispatch FASTY through SROTA to the Drone's current GPS position"
          }
        >
          {missionMode ===
            "RESCUE" &&
          srotaTask === "GOTO" ? (
            <>
              <Loader2
                size={15}
                className="animate-spin"
              />
              DISPATCHING
            </>
          ) : missionMode ===
              "RESCUE" ? (
            <>
              <Play size={15} />
              START
            </>
          ) : missionMode ===
              "CUSTOM" &&
            customMissionStatus ===
              "RUNNING" ? (
            <>
              <Pause size={15} />
              PAUSE
            </>
          ) : missionMode ===
              "CUSTOM" &&
            customMissionStatus ===
              "PAUSED" ? (
            <>
              <Play size={15} />
              RESUME
            </>
          ) : (
            <>
              <Play size={15} />
              START
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() =>
            run("HOLD")
          }
          disabled={
            fastyControlDisabled
          }
          title={
            srotaBusy
              ? "Interrupt the active SROTA rescue and hold FASTY"
              : fastyConnected
                ? "Send HOLD mode to FASTY"
                : "FASTY MAVROS is not connected"
          }
          className={cn(
            btn,
            "h-11 flex-1 border-drone/60 bg-drone/15 text-drone hover:bg-drone/25",
          )}
        >
          {fastyBusy || srotaBusy ? (
            <Loader2
              size={15}
              className="animate-spin"
            />
          ) : (
            <Pause size={15} />
          )}
          HOLD
        </button>

        <button
          type="button"
          onClick={() =>
            run("STOP")
          }
          disabled={
            fastyControlDisabled
          }
          title={
            srotaBusy
              ? "Interrupt the active SROTA rescue"
              : fastyConnected
                ? "Stop the active SROTA task"
                : "FASTY MAVROS is not connected"
          }
          className={cn(
            btn,
            "h-11 flex-1 border-fault/60 bg-fault/15 text-fault hover:bg-fault/25",
          )}
        >
          {srotaBusy ? (
            <Loader2
              size={14}
              className="animate-spin"
            />
          ) : (
            <Square size={14} />
          )}
          STOP
        </button>

        <button
          type="button"
          onClick={() =>
            run("RTL (DRONE)")
          }
          disabled={
            droneControlDisabled
          }
          title={
            droneConnected
              ? "Send RTL mode to Drone"
              : "Drone MAVROS is not connected"
          }
          className={cn(
            btn,
            "h-11 flex-1 border-drone/50 text-drone hover:bg-drone/15",
          )}
        >
          <Home size={15} />
          RTL (DRONE)
        </button>

        <button
          type="button"
          onClick={() =>
            run("RTH (FASTY)")
          }
          disabled={
            rthDisabled
          }
          title={
            srotaBusy
              ? "FASTY is currently executing a SROTA navigation task"
              : fastyConnected
                ? "Return FASTY through SROTA to its recorded launch point"
                : "FASTY MAVROS is not connected"
          }
          className={cn(
            btn,
            "h-11 flex-1 border-fasty/50 text-fasty hover:bg-fasty/15",
          )}
        >
          {srotaTask === "HOME" ? (
            <Loader2
              size={15}
              className="animate-spin"
            />
          ) : (
            <Home size={15} />
          )}
          RTH (FASTY)
        </button>

        <button
          type="button"
          onClick={() => void startFollow()}
          disabled={followDisabled}
          aria-pressed={srotaTask === "FOLLOW"}
          title={
            srotaTask === "FOLLOW"
              ? "FASTY is following the Drone. Press STOP or HOLD to end."
              : srotaBusy
                ? "FASTY is currently executing a SROTA navigation task"
                : fastyConnected
                  ? "Follow the Drone's live GPS position automatically"
                  : "FASTY MAVROS is not connected"
          }
          className={cn(
            btn,
            "h-11 min-w-[170px] border-fasty/50 text-fasty hover:bg-fasty/15",
            srotaTask === "FOLLOW" && "bg-fasty/15",
          )}
        >
          {srotaTask === "FOLLOW" ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Navigation size={15} />
          )}
          {srotaTask === "FOLLOW" ? "FOLLOWING" : "FOLLOW DRONE"}
        </button>

        <div
          className={cn(
            "flex h-11 min-w-[118px] items-center gap-2 rounded-[3px] border px-2",
            fastyConnected
              ? "border-ok/40 bg-ok/5"
              : "border-fault/40 bg-fault/5",
          )}
        >
          <Radio
            size={15}
            className={
              fastyConnected
                ? "text-ok"
                : "text-fault"
            }
          />

          <div className="leading-tight">
            <div className="label-xs">
              FASTY LINK
            </div>

            <div
              className={cn(
                "value-mono text-[11px] font-bold",
                fastyConnected
                  ? "text-ok"
                  : "text-fault",
              )}
            >
              {fastyConnected
                ? "CONNECTED"
                : "OFFLINE"}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            run(
              "EMERGENCY STOP",
            )
          }
          className={cn(
            btn,
            "h-11 w-[150px] border-fault bg-fault/30 text-[11px] text-fault-foreground hover:bg-fault/45",
          )}
        >
          <OctagonAlert
            size={16}
          />
          E-STOP
        </button>

        {last ? (
          <div className="absolute bottom-[68px] left-1/2 z-40 max-w-[520px] -translate-x-1/2 rounded-[2px] border border-border bg-popover px-3 py-2 shadow-lg">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  fastyResult?.success ===
                    false ||
                    fastyError
                    ? "bg-fault"
                    : fastyResult?.success
                      ? "bg-ok"
                      : "bg-muted-foreground",
                )}
              />

              <span className="value-mono text-[11px]">
                {last}
              </span>
            </div>
          </div>
        ) : null}
      </footer>

      {missionOpen ? (
        <div className="fixed bottom-[72px] left-2 z-40 w-[390px] rounded-[4px] border border-border bg-popover shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div>
              <div className="label-xs">
                MISSION CONTROL
              </div>

              <div
                className={cn(
                  "text-[12px] font-bold",
                  missionStatusTone,
                )}
              >
                {missionStatusLabel}
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                setMissionOpen(
                  false,
                )
              }
              aria-label="Close mission control"
              className="text-muted-foreground hover:text-foreground"
            >
              <X size={15} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 p-3">
            <button
              type="button"
              onClick={() => {
                if (customMissionActive) {
                  setLast(
                    "Custom mission is active — abort it before returning to RESCUE WORKFLOW",
                  );
                  return;
                }

                setMissionMode(
                  "RESCUE",
                );

                setLast(
                  "RESCUE WORKFLOW selected",
                );
              }}
              className={cn(
                "rounded-[3px] border px-3 py-2 text-left",
                missionMode ===
                  "RESCUE"
                  ? "border-fasty/60 bg-fasty/10"
                  : "border-border hover:bg-accent",
              )}
            >
              <div className="text-[11px] font-bold tracking-wide text-fasty">
                RESCUE WORKFLOW
              </div>

              <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                Normal operation. Drone
                searches and reports a target;
                GCS dispatches FASTY through
                SROTA.
              </div>
            </button>

            <button
              type="button"
              onClick={() =>
                setMissionMode(
                  "CUSTOM",
                )
              }
              className={cn(
                "rounded-[3px] border px-3 py-2 text-left",
                missionMode ===
                  "CUSTOM"
                  ? "border-drone/60 bg-drone/10"
                  : "border-border hover:bg-accent",
              )}
            >
              <div className="text-[11px] font-bold tracking-wide text-drone">
                CUSTOM MISSION
              </div>

              <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                Optional Python script for
                survey, observation, or custom
                vehicle behavior.
              </div>
            </button>
          </div>

          <div className="border-t border-border px-3 py-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="label-xs">
                PYTHON MISSION SCRIPT
              </div>

              {scriptName ? (
                <span
                  className={cn(
                    "text-[10px] font-bold",
                    !missionScript.parseResult?.ok
                      ? "text-fault"
                      : customMissionStatus ===
                          "RUNNING"
                        ? "text-ok"
                        : customMissionStatus ===
                            "PAUSED"
                          ? "text-drone"
                          : "text-muted-foreground",
                  )}
                >
                  {!missionScript.parseResult?.ok
                    ? "ERROR"
                    : customMissionStatus}
                </span>
              ) : null}
            </div>

            {scriptName ? (
              <div className="flex items-center gap-2 rounded-[3px] border border-border bg-background/40 px-2 py-2">
                <FileCode2
                  size={15}
                  className="shrink-0 text-drone"
                />

                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-bold">
                    {scriptName}
                  </div>

                  <div className={cn(
                    "text-[10px]",
                    missionScript.parseResult?.ok
                      ? "text-muted-foreground"
                      : "text-fault",
                  )}>
                    {missionScript.parseResult?.ok
                      ? "Loaded locally — ready for execution"
                      : missionScript.parseResult?.errors?.join(" | ") ??
                        "Mission script parsing failed."}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={removeScript}
                  disabled={
                    customMissionActive
                  }
                  title={
                    customMissionActive
                      ? "Abort the mission before removing the script"
                      : "Remove script"
                  }
                  className="rounded-[2px] p-1.5 text-muted-foreground hover:bg-fault/10 hover:text-fault disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2
                    size={14}
                  />
                </button>
              </div>
            ) : (
              <div className="rounded-[3px] border border-dashed border-border px-3 py-3 text-center text-[10px] text-muted-foreground">
                No custom script loaded.
                <br />
                Rescue workflow does not
                require one.
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".py,text/x-python"
              className="hidden"
              onChange={(event) =>
                void handleScriptSelect(
                  event,
                )
              }
            />

            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() =>
                  fileInputRef.current?.click()
                }
                disabled={
                  customMissionActive
                }
                className="flex flex-1 items-center justify-center gap-2 rounded-[2px] border border-border px-3 py-2 text-[10px] font-bold tracking-wide hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Upload
                  size={13}
                />
                {scriptName
                  ? "REPLACE SCRIPT"
                  : "LOAD .PY"}
              </button>

              {customMissionActive ? (
                <button
                  type="button"
                  onClick={
                    abortCustomMission
                  }
                  className="flex flex-1 items-center justify-center gap-2 rounded-[2px] border border-fault/60 bg-fault/10 px-3 py-2 text-[10px] font-bold tracking-wide text-fault hover:bg-fault/20"
                >
                  <Square
                    size={12}
                  />
                  ABORT
                </button>
              ) : null}
            </div>

            <div className="mt-3 border border-border bg-background/30 px-2 py-2 text-[10px] leading-relaxed text-muted-foreground">
              <span className="font-bold text-foreground">
                RESCUE execution model:
              </span>{" "}
              Drone reaches the verified target
              position → GCS dispatches FASTY
              through SROTA → FASTY navigates
              autonomously.
              <br />
              <span className="font-bold text-foreground">
                CUSTOM execution model:
              </span>{" "}
              LOAD → READY → START. Loading a
              script never arms or moves either
              vehicle.
            </div>
          </div>
        </div>
      ) : null}

      {pending ? (
        <ConfirmDialog
          command={pending}
          busy={
            pending ===
            "RTL (DRONE)"
              ? droneBusy
              : fastyBusy
          }
          onCancel={() => {
            if (
              !fastyBusy &&
              !srotaBusy
            ) {
              setPending(null);
            }
          }}
          onConfirm={() => {
            if (
              pending === "STOP"
            ) {
              void executeCommand(
                pending,
              );
              return;
            }

            if (
              !fastyBusy &&
              !srotaBusy
            ) {
              void executeCommand(
                pending,
              );
            }
          }}
        />
      ) : null}
    </>
  );
}