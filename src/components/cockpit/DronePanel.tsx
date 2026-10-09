import { useCallback, useEffect, useRef, useState } from "react";

import {
  BatteryMedium,
  Camera,
  BrainCircuit,
  Home,
  MapPin,
  Navigation,
  Pause,
  Plane,
} from "lucide-react";

import {
  fmt,
  stateColor,
  type DroneTelemetry,
} from "@/lib/telemetry";

import { useDroneControl } from "@/lib/useDroneControl";
import rosbridge from "@/lib/ros/rosbridge";

import {
  Bar,
  Panel,
  StatusDot,
} from "./primitives";

interface DroneAttitude {
  pitch: number | null;
  roll: number | null;
  yaw: number | null;
}

interface DronePanelProps {
  drone: DroneTelemetry;
  attitude?: DroneAttitude;
}

export interface DroneCameraPanelProps {
  className?: string;
}

export function DroneCameraPanel({
  className,
}: DroneCameraPanelProps) {
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiState, setAiState] = useState<"IDLE" | "LOADING" | "READY" | "ERROR">("IDLE");
  const [aiError, setAiError] = useState<string | null>(null);
  const [videoConnected, setVideoConnected] = useState(false);
  const [videoRequested, setVideoRequested] = useState(false);
  const videoRef = useRef<HTMLImageElement | null>(null);

  const videoUrl =
    import.meta.env["VITE_DRONE_VIDEO_URL"] ||
    "http://localhost:8765/video";

  const connectDroneVideo = useCallback(() => {
    setAiError(null);
    setAiState("LOADING");
    setVideoConnected(false);
    setVideoRequested(true);
  }, [videoUrl]);

  const handleVideoLoad = useCallback(() => {
    setVideoConnected(true);
    setAiState(aiEnabled ? "READY" : "IDLE");
    setAiError(null);
  }, [aiEnabled]);

  const handleVideoError = useCallback(() => {
    setVideoConnected(false);
    setAiState("ERROR");
    setAiError(
      "Drone video playback failed. Check the HM30 stream and GStreamer WebRTC bridge.",
    );
  }, []);

  const disconnectDroneVideo = useCallback(() => {
    const image = videoRef.current;
    if (image) {
      image.removeAttribute("src");
      image.src = "";
    }

    setVideoConnected(false);
    setVideoRequested(false);
    setAiError(null);
    setAiState("IDLE");
  }, []);

  useEffect(() => {
    if (!videoRequested) return;
    const image = videoRef.current;
    if (!image) return;

    image.src = `${videoUrl}${videoUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
  }, [videoRequested, videoUrl]);

  useEffect(() => {
    if (!aiEnabled) {
      setAiState("IDLE");
      setAiError(null);
      return;
    }

    if (videoConnected) {
      setAiState("READY");
      setAiError(null);
    }
  }, [aiEnabled, videoConnected]);

  useEffect(() => {
    return () => {
      const image = videoRef.current;
      if (image) {
        image.removeAttribute("src");
        image.src = "";
      }
    };
  }, []);

  return (
    <section
      title="Live Drone camera feed. Use this panel to connect, monitor, and control the video/AI display."
      className={[
        "relative min-h-0 min-w-0 overflow-hidden border border-border bg-black",
        className ?? "",
      ].join(" ")}
    >
      <div className="absolute left-3 top-3 z-40 flex items-center gap-2">
        <div className="border border-drone/50 bg-black/80 px-2 py-1 text-[10px] font-bold tracking-[0.12em] text-drone">
          DRONE CAMERA
        </div>

        <div className="flex items-center gap-1 border border-ok/40 bg-black/80 px-2 py-1">
          <span className="size-1.5 rounded-full bg-ok" />
          <span className="text-[9px] font-bold tracking-[0.08em] text-ok">
            {videoConnected ? "LIVE" : "STANDBY"}
          </span>
        </div>
      </div>

      {videoRequested ? (
        <div className="relative flex h-full min-h-0 w-full items-center justify-center bg-black">
          <img
            ref={videoRef}
            src={videoUrl}
            alt="Live drone camera"
            onLoad={handleVideoLoad}
            onError={handleVideoError}
            className="block h-full w-full object-contain"
          />

          <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-1 border border-drone/50 bg-black/75 px-2 py-1">
            <span className="text-[9px] font-bold tracking-[0.08em] text-drone">
              AI {aiState}
            </span>
          </div>

          {aiState === "ERROR" && aiError ? (
            <div className="pointer-events-none absolute bottom-14 left-3 right-3 border border-fault/50 bg-black/85 px-2 py-2">
              <div className="text-[9px] font-bold tracking-[0.08em] text-fault">
                AI ERROR
              </div>
              <div className="mt-0.5 break-words text-[9px] leading-tight text-muted-foreground">
                {aiError}
              </div>
            </div>
          ) : null}

          <div className="absolute bottom-3 left-3 flex items-center gap-2 border border-border bg-black/75 px-2 py-1">
            <span className="value-mono text-[9px] text-muted-foreground">
              RTSP / YOLO / GPU
            </span>
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-0 items-center justify-center bg-black">
          <div className="text-center">
            <Camera size={34} className="mx-auto mb-3 text-drone" />
            <div className="mb-1 text-[15px] font-bold tracking-[0.12em] text-drone">
              DRONE CAMERA
            </div>
            <div className="value-mono text-[10px] text-muted-foreground">
              {aiState === "LOADING"
                ? "CONNECTING TO RTSP STREAM…"
                : aiState === "ERROR"
                  ? "DRONE VIDEO UNAVAILABLE"
                  : "NO ACTIVE DRONE VIDEO"}
            </div>
            <button
              type="button"
              title="Connect the Drone camera video stream."
              onClick={connectDroneVideo}
              className="mt-3 inline-flex items-center gap-2 border border-drone bg-drone/15 px-3 py-2 text-[10px] font-bold tracking-[0.08em] text-drone hover:bg-drone/25"
            >
              <Camera size={12} />
              CONNECT DRONE VIDEO
            </button>
          </div>
        </div>
      )}

      {aiError && aiState === "ERROR" ? (
        <div className="absolute bottom-11 left-3 right-3 border border-fault/30 bg-fault/10 px-2 py-1.5 text-[9px] text-fault">
          {aiError}
        </div>
      ) : null}

      <div className="absolute bottom-0 left-0 right-0 z-40 flex items-center justify-between border-t border-border bg-black/85 px-3 py-1.5">
        <div className="label-xs">
          {videoConnected ? "SIYI / HM30 RTSP" : "DRONE VIDEO"}
        </div>

        <div className="flex items-center gap-2">
          {videoConnected ? (
            <button
              type="button"
              onClick={disconnectDroneVideo}
              className="flex items-center gap-1 border border-fault/50 bg-fault/10 px-2 py-1 text-[9px] font-bold text-fault hover:bg-fault/15"
              title="Stop the Drone camera video stream."
            >
              <Camera size={10} />
              VIDEO OFF
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => {
              setAiEnabled((previous) => !previous);
            }}
            className={[
              "flex items-center gap-1 border px-2 py-1 text-[9px] font-bold",
              aiEnabled
                ? "border-drone/50 bg-drone/10 text-drone"
                : "border-border text-muted-foreground",
            ].join(" ")}
            title="Turn AI person detection on or off for the camera feed."
          >
            <BrainCircuit size={10} />
            AI {aiEnabled ? "ON" : "OFF"}
          </button>
        </div>
      </div>
    </section>
  );
}

export function DronePanel({
  drone,
}: DronePanelProps) {
  const [controlMessage, setControlMessage] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLon, setManualLon] = useState("");
  const [manualGotoBusy, setManualGotoBusy] = useState(false);

  const {
    connected: droneControlConnected,
    busy: droneControlBusy,
    error: droneControlError,
    lastResult: droneControlResult,
    setArmed,
    setMode,
    takeoff,
  } = useDroneControl();

  useEffect(() => {
    if (droneControlResult?.message) {
      setControlMessage(droneControlResult.message);
    } else if (droneControlError) {
      setControlMessage(droneControlError);
    }
  }, [droneControlError, droneControlResult]);

  const handleArm = useCallback(async () => {
    if (!droneControlConnected) {
      setControlMessage("DRONE control unavailable: ROSBridge is not connected");
      return;
    }

    if (drone.armed.value) {
      setControlMessage("DRONE is already armed");
      return;
    }

    if (!window.confirm("ARM the Drone? This sends a real arming command to MAVROS.")) {
      return;
    }

    const result = await setArmed(true, { confirm: true });
    setControlMessage(result.message);
  }, [drone.armed.value, droneControlConnected, setArmed]);

  const handleTakeoff = useCallback(async () => {
    const altitude = 10;

    if (!droneControlConnected) {
      setControlMessage("DRONE control unavailable: ROSBridge is not connected");
      return;
    }

    if (!drone.armed.value) {
      setControlMessage("TAKEOFF blocked: ARM the Drone first");
      return;
    }

    if (!window.confirm(`Take off the Drone to ${altitude} m?`)) {
      return;
    }

    const result = await takeoff(altitude, { confirm: true });
    setControlMessage(result.message);
  }, [drone.armed.value, droneControlConnected, takeoff]);

  const handleSafetyMode = useCallback(async (mode: "RTL" | "LAND") => {
    if (!droneControlConnected) {
      setControlMessage("DRONE control unavailable: ROSBridge is not connected");
      return;
    }

    const label = mode === "RTL" ? "return-to-launch (RTL)" : "LAND";
    if (!window.confirm(`Send ${label} command to the Drone?`)) {
      return;
    }

    const result = await setMode(mode);
    setControlMessage(result.message);
  }, [droneControlConnected, setMode]);

  const handleManualGoto = useCallback(async () => {
    if (manualGotoBusy) {
      return;
    }

    if (!droneControlConnected || !rosbridge.isConnected()) {
      setControlMessage("DRONE manual GOTO unavailable: ROSBridge is not connected");
      return;
    }

    const latitude = Number(manualLat.trim());
    const longitude = Number(manualLon.trim());
    const altitude =
      typeof drone.altAmsl.value === "number" &&
      Number.isFinite(drone.altAmsl.value)
        ? drone.altAmsl.value
        : null;

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

    if (altitude === null) {
      setControlMessage("DRONE manual GOTO requires a valid current altitude.");
      return;
    }

    if (!window.confirm(
      `Send the Drone to ${latitude.toFixed(7)}, ${longitude.toFixed(7)} at its current altitude (${altitude.toFixed(1)} m AMSL)?`,
    )) {
      return;
    }

    const publishTarget = () => {
      rosbridge.publish(
        "/mavros_drone/mavros/setpoint_raw/global",
        {
          header: {
            frame_id: "",
          },
          coordinate_frame: 5,
          type_mask: 4088,
          latitude,
          longitude,
          altitude,
          velocity: {
            x: 0,
            y: 0,
            z: 0,
          },
          acceleration_or_force: {
            x: 0,
            y: 0,
            z: 0,
          },
          yaw: 0,
          yaw_rate: 0,
        },
        "mavros_msgs/GlobalPositionTarget",
      );
    };

    setManualGotoBusy(true);
    setControlMessage("DRONE manual GOTO: sending GPS setpoints…");

    try {
      const modeResult = await setMode("GUIDED");
      if (!modeResult.success) {
        setManualGotoBusy(false);
        setControlMessage(modeResult.message);
        return;
      }

      publishTarget();
      const intervalId = window.setInterval(() => {
        try {
          publishTarget();
        } catch (error) {
          window.clearInterval(intervalId);
          setManualGotoBusy(false);
          setControlMessage(
            error instanceof Error
              ? error.message
              : "DRONE manual GOTO publish failed.",
          );
        }
      }, 200);

      window.setTimeout(() => {
        window.clearInterval(intervalId);
        setManualGotoBusy(false);
        setControlMessage(
          `DRONE manual GOTO sent to ${latitude.toFixed(7)}, ${longitude.toFixed(7)}.`,
        );
      }, 5000);
    } catch (error) {
      setManualGotoBusy(false);
      setControlMessage(
        error instanceof Error
          ? error.message
          : "DRONE manual GOTO failed.",
      );
    }
  }, [drone.altAmsl.value, droneControlConnected, manualGotoBusy, manualLat, manualLon, setMode]);

  const droneControlDisabled =
    !droneControlConnected || droneControlBusy || manualGotoBusy;

  return (
    <Panel
      tone="drone"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-drone/30 bg-panel-header px-2 py-1.5">
        <div className="flex items-center gap-2">
          <Plane size={18} className="text-drone" />
          <div className="leading-none">
            <div className="text-[17px] font-bold tracking-wide text-drone">
              DRONE
            </div>
            <div className="label-xs mt-1">Aerial Reconnaissance</div>
          </div>
        </div>

        <div title="Current Drone connection status." className="flex items-center gap-1.5 rounded-[3px] border border-ok/40 bg-ok/10 px-2 py-1">
          <StatusDot state={drone.link} />
          <span className={`label-xs ${stateColor[drone.link]}`}>
            {drone.link}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="shrink-0 border-b border-border bg-background/20 p-2">
          <div className="grid grid-cols-2 gap-1.5">
            <div title="Current Drone battery level and remaining charge." className="rounded-[3px] border border-border bg-background/30 px-2 py-2">
              <div className="flex items-center gap-1.5">
                <BatteryMedium size={13} className="text-drone" />
                <div className="label-xs">BATTERY</div>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <Bar pct={drone.batteryPct.value} tone="drone" />
                <div className="value-mono shrink-0 text-[16px] font-bold text-drone">
                  {drone.batteryPct.state === "UNAVAILABLE"
                    ? "N/A"
                    : `${fmt(drone.batteryPct, "", 0)}%`}
                </div>
              </div>
            </div>

            <div title="Drone altitude above the configured reference level." className="rounded-[3px] border border-border bg-background/30 px-2 py-2">
              <div className="label-xs">ALTITUDE</div>
              <div className="value-mono mt-1 text-[16px] font-bold text-drone">
                {fmt(drone.altRel, "", 1)}
                <span className="ml-1 text-[9px] font-medium text-muted-foreground">m</span>
              </div>
            </div>

            <div title="Drone ground speed." className="rounded-[3px] border border-border bg-background/30 px-2 py-2">
              <div className="label-xs">SPEED</div>
              <div className="value-mono mt-1 text-[16px] font-bold text-foreground">
                {fmt(drone.groundSpeed, "", 1)}
                <span className="ml-1 text-[9px] font-medium text-muted-foreground">km/h</span>
              </div>
            </div>

            <div title="Current Drone flight-control mode." className="rounded-[3px] border border-border bg-background/30 px-2 py-2">
              <div className="label-xs">FLIGHT MODE</div>
              <div className="value-mono mt-1 truncate text-[13px] font-bold text-mission">
                {fmt(drone.flightMode)}
              </div>
            </div>
          </div>

          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <div title="Shows whether the Drone is armed and able to execute flight commands." className="rounded-[3px] border border-border bg-background/30 px-2 py-1.5">
              <div className="label-xs">ARM STATE</div>
              <div className={drone.armed.value ? "value-mono mt-0.5 text-[11px] font-bold text-ok" : "value-mono mt-0.5 text-[11px] font-bold text-warn"}>
                {drone.armed.value ? "ARMED" : "DISARMED"}
              </div>
            </div>

            <div title="Current Drone GPS latitude and longitude." className="rounded-[3px] border border-border bg-background/30 px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <MapPin size={11} className="text-drone" />
                <div className="label-xs">GPS</div>
              </div>
              <div className="value-mono mt-0.5 text-[9px] font-bold leading-tight text-ok">
                <div>LAT {fmt(drone.lat, "", 6)}</div>
                <div>LON {fmt(drone.lon, "", 6)}</div>
              </div>
            </div>
          </div>
        </div>

        <section className="border-b border-border p-2">
          <div className="label-xs mb-1.5">DRONE CONTROL</div>
          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              title="Arm the Drone so it can execute flight commands."
              onClick={() => void handleArm()}
              disabled={droneControlDisabled || drone.armed.value}
              className="w-full rounded-[3px] border border-ok/50 bg-ok/10 px-3 py-3 text-[11px] font-bold tracking-[0.08em] text-ok hover:bg-ok/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ARM
            </button>
            <button
              type="button"
              title="Command the armed Drone to take off to 10 meters."
              onClick={() => void handleTakeoff()}
              disabled={droneControlDisabled || !drone.armed.value}
              className="w-full rounded-[3px] border border-drone/60 bg-drone/15 px-3 py-3 text-[11px] font-bold tracking-[0.08em] text-drone hover:bg-drone/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              TAKEOFF 10M
            </button>
            <button
              type="button"
              title="Command the Drone to return to its launch/home location."
              onClick={() => void handleSafetyMode("RTL")}
              disabled={droneControlDisabled}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[3px] border border-drone/50 bg-drone/10 px-3 py-3 text-[11px] font-bold tracking-[0.08em] text-drone hover:bg-drone/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Home size={13} />
              RETURN HOME
            </button>
            <button
              type="button"
              title="Command the Drone to land."
              onClick={() => void handleSafetyMode("LAND")}
              disabled={droneControlDisabled}
              className="w-full rounded-[3px] border border-fault/50 bg-fault/10 px-3 py-3 text-[11px] font-bold tracking-[0.08em] text-fault hover:bg-fault/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              LAND
            </button>
          </div>
        </section>

        <section className="border-b border-border">
          <button
            type="button"
            title="Open or close manual GPS navigation for the Drone."
            onClick={() => setManualOpen((open) => !open)}
            className="flex w-full items-center justify-between px-2 py-2 text-left hover:bg-accent"
            aria-expanded={manualOpen}
          >
            <div className="flex items-center gap-1.5">
              <Navigation size={11} className="text-drone" />
              <span className="label-xs">MANUAL GOTO</span>
            </div>
            <span className="text-[8px] text-muted-foreground">
              {manualOpen ? "CLOSE" : "OPEN"}
            </span>
          </button>

          {manualOpen ? (
            <div className="space-y-1.5 border-t border-border bg-background/20 p-2">
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  title="Enter the target latitude for manual Drone navigation."
                  value={manualLat}
                  onChange={(event) => setManualLat(event.target.value)}
                  inputMode="decimal"
                  placeholder="LATITUDE"
                  aria-label="Drone manual target latitude"
                  disabled={manualGotoBusy}
                  className="min-w-0 rounded-[3px] border border-border bg-background px-2 py-2 text-[9px] font-semibold text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-40"
                />
                <input
                  title="Enter the target longitude for manual Drone navigation."
                  value={manualLon}
                  onChange={(event) => setManualLon(event.target.value)}
                  inputMode="decimal"
                  placeholder="LONGITUDE"
                  aria-label="Drone manual target longitude"
                  disabled={manualGotoBusy}
                  className="min-w-0 rounded-[3px] border border-border bg-background px-2 py-2 text-[9px] font-semibold text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-40"
                />
              </div>

              <button
                type="button"
                title="Send the Drone to the entered GPS coordinates at its current reported altitude."
                onClick={() => void handleManualGoto()}
                disabled={droneControlDisabled || !manualLat.trim() || !manualLon.trim()}
                className="flex w-full items-center justify-center gap-1.5 rounded-[3px] border border-drone/60 bg-drone/15 px-2 py-2 text-[10px] font-bold tracking-[0.08em] text-drone hover:bg-drone/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Navigation size={11} />
                {manualGotoBusy ? "SENDING…" : "GO TO LOCATION"}
              </button>

              <div className="text-[8px] leading-relaxed text-muted-foreground">
                Manual navigation sends the Drone to the entered GPS position at its current reported altitude.
              </div>
            </div>
          ) : null}
        </section>

        {controlMessage ? (
          <div className="border-b border-border bg-background/30 px-2 py-2 text-[9px] leading-tight text-muted-foreground">
            {controlMessage}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
