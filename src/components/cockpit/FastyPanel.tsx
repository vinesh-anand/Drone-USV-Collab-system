import { useCallback, useEffect, useState } from "react";

import {
  Activity,
  BatteryMedium,
  Gauge,
  LifeBuoy,
  MapPin,
  Navigation,
  Pause,
  Radio,
} from "lucide-react";

import { fmt, type FastyTelemetry } from "@/lib/telemetry";
import { useFastyControl } from "@/lib/useFastyControl";
import { useFastyTelemetry } from "@/lib/useFastyTelemetry";
import srotaControl from "@/lib/ros/srotaControl";

import { Bar, Panel, StatusDot } from "./primitives";

interface FastyPanelProps {
  fasty: FastyTelemetry;
  attitude?: {
    roll: number | null;
    pitch: number | null;
    yaw: number | null;
  };
}

export function FastyPanel({ fasty }: FastyPanelProps) {
  const [controlMessage, setControlMessage] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLon, setManualLon] = useState("");
  const [srotaBusy, setSrotaBusy] = useState(false);
  const [srotaTask, setSrotaTask] = useState<"RESCUE" | "FOLLOW" | "HOME" | null>(null);

  const {
    connected: controlConnected,
    busy: controlBusy,
    lastResult: controlResult,
    error: controlError,
    arm,
    gotoPosition,
    setMode,
  } = useFastyControl();

  const { telemetry: liveFasty } = useFastyTelemetry();

  const liveArmed = liveFasty.state.connected
    ? liveFasty.state.armed
    : null;

  const liveMode =
    liveFasty.state.connected && liveFasty.state.mode
      ? liveFasty.state.mode
      : "N/A";

  useEffect(() => {
    if (controlResult?.message) {
      setControlMessage(controlResult.message);
    } else if (controlError) {
      setControlMessage(controlError);
    }
  }, [controlError, controlResult]);

  const handleDeploy = useCallback(async () => {
    if (!controlConnected) {
      setControlMessage("SROTA control unavailable: ROSBridge is not connected");
      return;
    }

    if (liveArmed === true) {
      setControlMessage("SROTA is already deployed");
      return;
    }

    if (!window.confirm("DEPLOY SROTA? This sends a real arm command to the vehicle.")) {
      return;
    }

    const result = await arm({ confirm: true });
    setControlMessage(result.message);
  }, [arm, controlConnected, liveArmed]);

  const executeSrotaTask = useCallback(
    async (
      operation: () => ReturnType<typeof srotaControl.gotoDrone>,
      task: "RESCUE" | "FOLLOW" | "HOME",
      label: string,
    ) => {
      if (srotaBusy) {
        return;
      }

      if (!controlConnected) {
        setControlMessage("SROTA control unavailable: ROSBridge is not connected");
        return;
      }

      setSrotaBusy(true);
      setSrotaTask(task);
      setControlMessage(`${label} requested…`);

      try {
        const result = await operation();
        setControlMessage(result.message);
      } catch (error) {
        setControlMessage(
          error instanceof Error ? error.message : `SROTA ${label.toLowerCase()} failed.`,
        );
      } finally {
        setSrotaBusy(false);
        setSrotaTask(null);
      }
    },
    [controlConnected, srotaBusy],
  );

  const handleRescue = useCallback(() => {
    void executeSrotaTask(
      srotaControl.gotoDrone,
      "RESCUE",
      "RESCUE WORKFLOW",
    );
  }, [executeSrotaTask]);

  const handleFollow = useCallback(() => {
    void executeSrotaTask(
      srotaControl.follow,
      "FOLLOW",
      "FOLLOW DRONE",
    );
  }, [executeSrotaTask]);

  const handleReturnHome = useCallback(() => {
    void executeSrotaTask(
      srotaControl.returnHome,
      "HOME",
      "RETURN HOME",
    );
  }, [executeSrotaTask]);

  const handleStop = useCallback(async () => {
    if (!controlConnected) {
      setControlMessage("SROTA STOP unavailable: ROSBridge is not connected");
      return;
    }

    try {
      const result = await srotaControl.stop();
      setControlMessage(result.message);
    } catch (error) {
      setControlMessage(
        error instanceof Error ? error.message : "SROTA STOP failed.",
      );
    }
  }, [controlConnected]);

  const handleHold = useCallback(async () => {
    if (!controlConnected) {
      setControlMessage("SROTA HOLD unavailable: ROSBridge is not connected");
      return;
    }

    if (srotaBusy) {
      await handleStop();
      return;
    }

    const result = await setMode("HOLD");
    setControlMessage(result.message);
  }, [controlConnected, handleStop, setMode, srotaBusy]);

  const handleDock = useCallback(() => {
    void handleReturnHome();
  }, [handleReturnHome]);

  const handleManualGoto = useCallback(async () => {
    if (!controlConnected || controlBusy || srotaBusy) {
      setControlMessage("SROTA manual GOTO unavailable while the vehicle is busy or disconnected");
      return;
    }

    const latitude = Number(manualLat.trim());
    const longitude = Number(manualLon.trim());

    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      setControlMessage("Enter a valid latitude and longitude.");
      return;
    }

    if (!window.confirm(
      `Send SROTA to ${latitude.toFixed(7)}, ${longitude.toFixed(7)}?`,
    )) {
      return;
    }

    try {
      const result = await gotoPosition(latitude, longitude);
      setControlMessage(result.message);
    } catch (error) {
      setControlMessage(
        error instanceof Error ? error.message : "SROTA manual GOTO failed.",
      );
    }
  }, [controlBusy, controlConnected, gotoPosition, manualLat, manualLon, srotaBusy]);

  const battery = fmt(fasty.batteryPct, "", 0);
  const speed = fmt(fasty.speed, "", 1);
  const signal =
    typeof fasty.linkQuality.value === "number" && Number.isFinite(fasty.linkQuality.value)
      ? `${Math.round(fasty.linkQuality.value)}%`
      : "N/A";
  const status = fasty.link === "ONLINE" ? "LIVE" : fasty.link;
  const panelDisabled = !controlConnected || controlBusy || srotaBusy;
  const stopDisabled = !controlConnected || controlBusy;

  return (
    <Panel tone="fasty" className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div title="SROTA status and command panel. Shows essential vehicle information and rescue controls." className="flex shrink-0 items-center justify-between border-b border-fasty/30 bg-panel-header px-2 py-1.5">
        <div className="flex items-center gap-2">
          <LifeBuoy size={18} className="text-fasty" />
          <div className="leading-none">
            <div className="text-[17px] font-bold tracking-wide text-fasty">SROTA</div>
            <div className="label-xs mt-1">Surface Rescue Vehicle</div>
          </div>
        </div>

        <div title="Current SROTA connection status." className="flex items-center gap-1.5 rounded-[3px] border border-ok/40 bg-ok/10 px-2 py-1">
          <StatusDot state={fasty.link} />
          <span className={`label-xs ${fasty.link === "ONLINE" ? "text-ok" : "text-muted-foreground"}`}>
            {status}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="shrink-0 border-b border-border bg-background/20 p-2">
          <div className="grid grid-cols-2 gap-1.5">
            <div title="Current SROTA battery level and remaining charge." className="rounded-[3px] border border-border bg-background/30 px-2 py-2">
              <div className="flex items-center gap-1.5">
                <BatteryMedium size={13} className="text-fasty" />
                <div className="label-xs">BATTERY</div>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <Bar pct={fasty.batteryPct.value} tone="fasty" />
                <div className="value-mono shrink-0 text-[16px] font-bold text-fasty">
                  {fasty.batteryPct.state === "UNAVAILABLE" ? "N/A" : `${battery}%`}
                </div>
              </div>
            </div>

            <div title="Current SROTA speed." className="rounded-[3px] border border-border bg-background/30 px-2 py-2">
              <div className="flex items-center gap-1.5">
                <Gauge size={13} className="text-fasty" />
                <div className="label-xs">SPEED</div>
              </div>
              <div className="value-mono mt-1 text-[16px] font-bold text-foreground">
                {speed}
                <span className="ml-1 text-[9px] font-medium text-muted-foreground">km/h</span>
              </div>
            </div>

            <div title="Current SROTA operating mode." className="rounded-[3px] border border-border bg-background/30 px-2 py-2">
              <div className="flex items-center gap-1.5">
                <Activity size={13} className="text-fasty" />
                <div className="label-xs">MODE</div>
              </div>
              <div className="value-mono mt-1 truncate text-[13px] font-bold text-fasty">{liveMode}</div>
            </div>

            <div title="Shows whether SROTA is deployed or in standby." className="rounded-[3px] border border-border bg-background/30 px-2 py-2">
              <div className="label-xs">STATUS</div>
              <div className={liveArmed === true ? "value-mono mt-1 text-[12px] font-bold text-ok" : "value-mono mt-1 text-[12px] font-bold text-warn"}>
                {liveArmed === true ? "DEPLOYED" : "STANDBY"}
              </div>
            </div>

            <div title="Current SROTA GPS latitude and longitude." className="rounded-[3px] border border-border bg-background/30 px-2 py-2">
              <div className="flex items-center gap-1.5">
                <MapPin size={13} className="text-fasty" />
                <div className="label-xs">GPS</div>
              </div>
              <div className="value-mono mt-1 text-[9px] font-bold leading-tight text-foreground">
                <div>LAT {fmt(fasty.lat, "", 6)}</div>
                <div>LON {fmt(fasty.lon, "", 6)}</div>
              </div>
            </div>

            <div title="Current SROTA communication signal quality." className="rounded-[3px] border border-border bg-background/30 px-2 py-2">
              <div className="flex items-center gap-1.5">
                <Radio size={13} className="text-fasty" />
                <div className="label-xs">SIGNAL</div>
              </div>
              <div className={`value-mono mt-1 text-[12px] font-bold ${fasty.link === "ONLINE" ? "text-ok" : "text-muted-foreground"}`}>
                {signal}
              </div>
            </div>
          </div>
        </div>

        <section className="border-b border-border p-2">
          <div className="label-xs mb-1.5">SROTA COMMAND</div>
          <div className="space-y-1.5">
            <button
              type="button"
              title="Deploy SROTA by sending the existing arm command."
              onClick={() => void handleDeploy()}
              disabled={panelDisabled || liveArmed === true}
              className="w-full rounded-[3px] border border-fasty/60 bg-fasty/15 px-2 py-2 text-[10px] font-bold tracking-[0.08em] text-fasty hover:bg-fasty/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              DEPLOY SROTA
            </button>

            <button
              type="button"
              title="Start the default SROTA rescue workflow and send SROTA to the detected Drone position."
              onClick={handleRescue}
              disabled={panelDisabled}
              className="w-full rounded-[3px] border border-ok/50 bg-ok/10 px-2 py-2 text-[10px] font-bold tracking-[0.08em] text-ok hover:bg-ok/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {srotaTask === "RESCUE" ? "STARTING RESCUE…" : "START RESCUE"}
            </button>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                title="Make SROTA follow the Drone's live GPS position."
                onClick={handleFollow}
                disabled={panelDisabled}
                className="inline-flex items-center justify-center gap-1 rounded-[3px] border border-drone/50 bg-drone/10 px-2 py-2 text-[10px] font-bold tracking-[0.08em] text-drone hover:bg-drone/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Navigation size={11} />
                {srotaTask === "FOLLOW" ? "FOLLOWING…" : "FOLLOW DRONE"}
              </button>
              <button
                type="button"
                title="Hold SROTA in its current position/mode."
                onClick={() => void handleHold()}
                disabled={stopDisabled}
                className="inline-flex items-center justify-center gap-1 rounded-[3px] border border-drone/40 bg-drone/5 px-2 py-2 text-[10px] font-bold tracking-[0.08em] text-drone hover:bg-drone/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Pause size={11} />
                HOLD
              </button>
            </div>

            <div>
              <button
                type="button"
                title="Stop SROTA's current target tracking or navigation command."
                onClick={() => void handleStop()}
                disabled={stopDisabled}
                className="w-full rounded-[3px] border border-fault/50 bg-fault/10 px-2 py-2 text-[10px] font-bold tracking-[0.08em] text-fault hover:bg-fault/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                STOP
              </button>
            </div>

            <button
              type="button"
              title="Return SROTA to its recorded home/docking position."
              onClick={handleDock}
              disabled={panelDisabled}
              className="w-full rounded-[3px] border border-fasty/40 bg-fasty/5 px-2 py-2 text-[10px] font-bold tracking-[0.08em] text-fasty hover:bg-fasty/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              RETURN HOME
            </button>
          </div>

          {controlMessage ? (
            <div className="mt-1.5 border border-border bg-background/40 px-2 py-1.5 text-[9px] leading-tight text-muted-foreground">
              {controlMessage}
            </div>
          ) : null}
        </section>

        <section className="border-b border-border">
          <button
            type="button"
            title="Open or close manual GPS navigation for SROTA."
            onClick={() => setManualOpen((open) => !open)}
            className="flex w-full items-center justify-between px-2 py-2 text-left hover:bg-accent"
            aria-expanded={manualOpen}
          >
            <div className="flex items-center gap-1.5">
              <Navigation size={11} className="text-fasty" />
              <span className="label-xs">MANUAL GOTO</span>
            </div>
            <span className="text-[8px] text-muted-foreground">{manualOpen ? "CLOSE" : "OPEN"}</span>
          </button>

          {manualOpen ? (
            <div className="space-y-1.5 border-t border-border bg-background/20 p-2">
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  title="Enter the target latitude for manual SROTA navigation."
                  value={manualLat}
                  onChange={(event) => setManualLat(event.target.value)}
                  inputMode="decimal"
                  placeholder="LATITUDE"
                  aria-label="SROTA manual target latitude"
                  disabled={srotaBusy || controlBusy}
                  className="min-w-0 rounded-[3px] border border-border bg-background px-2 py-2 text-[9px] font-semibold text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-40"
                />
                <input
                  title="Enter the target longitude for manual SROTA navigation."
                  value={manualLon}
                  onChange={(event) => setManualLon(event.target.value)}
                  inputMode="decimal"
                  placeholder="LONGITUDE"
                  aria-label="SROTA manual target longitude"
                  disabled={srotaBusy || controlBusy}
                  className="min-w-0 rounded-[3px] border border-border bg-background px-2 py-2 text-[9px] font-semibold text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-40"
                />
              </div>

              <button
                type="button"
                title="Send SROTA to the entered GPS coordinates."
                onClick={() => void handleManualGoto()}
                disabled={panelDisabled || !manualLat.trim() || !manualLon.trim()}
                className="w-full rounded-[3px] border border-fasty/60 bg-fasty/15 px-2 py-2 text-[10px] font-bold tracking-[0.08em] text-fasty hover:bg-fasty/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                GO TO LOCATION
              </button>

              <div className="text-[8px] leading-relaxed text-muted-foreground">
                Manual navigation is the operator entry point for a custom GPS destination.
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </Panel>
  );
}
