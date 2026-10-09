import {
  useEffect,
} from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Crosshair,
} from "lucide-react";

import {
  na,
  ok,
  useTelemetry,
  type FastyTelemetry,
  type LinkState,
} from "@/lib/telemetry";

import { useFastyTelemetry } from "@/lib/useFastyTelemetry";
import { useFastyControl } from "@/lib/useFastyControl";
import { useDroneControl } from "@/lib/useDroneControl";

import { TopBar } from "@/components/cockpit/TopBar";
import {
  DroneCameraPanel,
  DronePanel,
} from "@/components/cockpit/DronePanel";
import { FastyPanel } from "@/components/cockpit/FastyPanel";
import { MissionMap } from "@/components/cockpit/MissionMap";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title:
          "DRONE + SROTA Rescue Control Cockpit — Potential Engineering",
      },
      {
        name: "description",
        content:
          "Single-page QGC-style rescue ground control cockpit for Drone and SROTA.",
      },
      {
        property: "og:title",
        content:
          "DRONE + SROTA Rescue Control Cockpit",
      },
      {
        property: "og:description",
        content:
          "Single-page ground control cockpit for aerial search, target verification and SROTA rescue operations.",
      },
      {
        property: "og:type",
        content: "website",
      },
      {
        property: "og:url",
        content: "/",
      },
      {
        name: "twitter:card",
        content: "summary_large_image",
      },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),

  component: Cockpit,
});

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* FASTY telemetry                                                            */
/* -------------------------------------------------------------------------- */

function getFastyLinkState(
  connection: ReturnType<
    typeof useFastyTelemetry
  >["rosConnection"],
  connected: boolean,
): LinkState {
  if (
    connection === "CONNECTED" &&
    connected
  ) {
    return "ONLINE";
  }

  if (
    connection === "CONNECTING"
  ) {
    return "CONNECTING";
  }

  if (
    connection === "ERROR"
  ) {
    return "ERROR";
  }

  return "OFFLINE";
}

function buildLiveFastyTelemetry(
  rosConnection: ReturnType<
    typeof useFastyTelemetry
  >["rosConnection"],
  live: ReturnType<
    typeof useFastyTelemetry
  >["telemetry"],
): FastyTelemetry {
  const link = getFastyLinkState(
    rosConnection,
    live.state.connected,
  );

  const connected =
    live.state.connected;

  const headingAvailable =
    connected &&
    live.heading !== null;

  const speedAvailable =
    connected &&
    live.groundSpeed !== null;

  const speedKmh =
    live.groundSpeed !== null
      ? live.groundSpeed * 3.6
      : null;

  const gpsFixType =
    live.gps.fixType;

  const gpsAvailable =
    connected &&
    live.gps.latitude !== null &&
    live.gps.longitude !== null;

  const gpsStatus =
    !connected
      ? null
      : gpsFixType === null
        ? null
        : gpsFixType <= 0
          ? "NO FIX"
          : gpsFixType === 1
            ? "GPS FIX"
            : gpsFixType === 2
              ? "DGPS FIX"
              : `FIX TYPE ${gpsFixType}`;

  const imuAvailable =
    connected &&
    (live.attitude.roll !== null ||
      live.attitude.pitch !== null ||
      live.attitude.yaw !== null ||
      live.acceleration.x !== null ||
      live.angularVelocity.x !== null);

  const systems: FastyTelemetry["systems"] = [
    {
      label: "MAVLink",
      value: connected
        ? "Connected"
        : "Disconnected",
      state: link,
    },
    {
      label: "IMU",
      value: imuAvailable
        ? "ONLINE"
        : "N/A",
      state: imuAvailable
        ? "ONLINE"
        : "UNAVAILABLE",
    },
    {
      label: "GPS",
      value:
        gpsStatus ?? "N/A",
      state:
        gpsAvailable &&
        gpsStatus !== "NO FIX"
          ? "ONLINE"
          : gpsStatus === "NO FIX"
            ? "DEGRADED"
            : "UNAVAILABLE",
    },
    {
      label: "RC Link",
      value: "N/A",
      state: "UNAVAILABLE",
    },
    {
      label: "Battery",
      value: "N/A",
      state: "UNAVAILABLE",
    },
    {
      label: "System",
      value: connected
        ? "Nominal"
        : "Unavailable",
      state: link,
    },
  ];

  return {
    link,

    platform:
      "SROTA ROBOTIC LIFEBUOY",

    lat:
      gpsAvailable
        ? ok(live.gps.latitude!)
        : na<number>(),

    lon:
      gpsAvailable
        ? ok(live.gps.longitude!)
        : na<number>(),

    heading:
      headingAvailable
        ? ok(live.heading!)
        : na<number>(),

    speed:
      speedAvailable &&
      speedKmh !== null
        ? ok(speedKmh)
        : na<number>(),

    mode:
      connected &&
      live.state.mode
        ? ok(live.state.mode)
        : na<string>(),

    rthStatus:
      na<string>(),

    homeDistance:
      na<number>(),

    droneDistance:
      na<number>(),

    depth:
      na<number>(),

    gpsStatus:
      gpsStatus !== null
        ? ok(gpsStatus)
        : na<string>(),

    satellites:
      connected &&
      live.gps.satellites !== null
        ? ok(live.gps.satellites)
        : na<number>(),

    linkQuality:
      na<number>(),

    motorStatus:
      na<string>(),

    missionStatus:
      connected
        ? ok("Standby")
        : na<string>(),

    batteryPct:
      na<number>(),

    voltage:
      na<number>(),

    current:
      na<number>(),

    estMinutes:
      na<number>(),

    systems,

    rescueStatus:
      na<string>(),

    payloadStatus:
      na<string>(),

    safetyStatus:
      connected
        ? ok("Nominal")
        : na<string>(),

    payloadCapacity:
      na<string>(),

    maxSpeed:
      na<string>(),

    endurance:
      na<string>(),
  };
}

/* -------------------------------------------------------------------------- */
/* Main cockpit                                                               */
/* -------------------------------------------------------------------------- */

function Cockpit() {
  const telemetry = useTelemetry();
  const droneControl = useDroneControl();
  const fastyControl = useFastyControl();
  const {
    rosConnection:
      fastyRosConnection,
    telemetry:
      fastyLive,
  } = useFastyTelemetry();

  const fasty =
    buildLiveFastyTelemetry(
      fastyRosConnection,
      fastyLive,
    );

  const droneOnline =
    telemetry.drone.link ===
    "ONLINE";

  const fastyOnline =
    fasty.link === "ONLINE";

  const rosOnline =
    fastyRosConnection ===
    "CONNECTED";

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
      {/* ================================================================== */}
      {/* GLOBAL HEADER                                                      */}
      {/* ================================================================== */}

      <div className="shrink-0">
        <TopBar
          system={telemetry.system}
        />
      </div>

      {/* ================================================================== */}
      {/* MAIN CONTROL AREA                                                  */}
      {/* ================================================================== */}

      <main className="min-h-0 flex-1 overflow-hidden p-1.5">
        <div className="grid h-full min-h-0 grid-cols-[230px_minmax(0,1fr)_240px] gap-1.5">
          {/* ================================================================ */}
          {/* DRONE                                                           */}
          {/* ================================================================ */}

          <aside
            title="Drone operator controls and essential Drone status."
            className="min-h-0 overflow-hidden">
            <DronePanel
              drone={telemetry.drone}
            />
          </aside>

          {/* ================================================================ */}
          {/* CENTER — PRIMARY CAMERA (70%) + SATELLITE MAP (30%)             */}
          {/* ================================================================ */}

          <section
            title="Primary mission workspace: live Drone camera with a 30% Satellite Mission Map."
            className="grid min-h-0 min-w-0 grid-cols-[minmax(0,7fr)_minmax(280px,3fr)] overflow-hidden border border-border bg-background">
            <div className="relative min-h-0 min-w-0 overflow-hidden">
              <DroneCameraPanel className="h-full w-full" />
            </div>

            <div className="relative min-h-0 min-w-0 overflow-hidden border-l border-border bg-black/20">
              <div className="pointer-events-none absolute left-2 top-2 z-[60] border border-cyan-400/40 bg-black/80 px-1.5 py-0.5 text-[8px] font-bold tracking-[0.1em] text-cyan-300">
                SATELLITE MAP
              </div>

              <MissionMap
                drone={telemetry.drone}
                fasty={fasty}
                className="h-full w-full"
              />
            </div>
          </section>

          {/* ================================================================ */}
          {/* SROTA                                                            */}
          {/* ================================================================ */}

          <aside
            title="SROTA operator controls and essential SROTA status."
            className="min-h-0 overflow-hidden">
            <FastyPanel
              fasty={fasty}
              attitude={
                fastyLive.attitude
              }
            />
          </aside>
        </div>
      </main>

      {/* ================================================================== */}
      {/* CONNECTION STATUS                                                  */}
      {/* ================================================================== */}

      <section className="shrink-0 border-t border-border bg-panel-header/60 px-1.5 py-1">
        <div className="flex min-w-0 items-center justify-end gap-3 px-2">
          <BottomStatus
            label="DRONE"
            value={droneOnline ? "ONLINE" : "OFFLINE"}
            ok={droneOnline}
          />

          <BottomStatus
            label="SROTA"
            value={fasty.link}
            ok={fastyOnline}
          />

          <BottomStatus
            label="ROS"
            value={rosOnline ? "ONLINE" : "OFFLINE"}
            ok={rosOnline}
          />
        </div>
      </section>

    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Mission helpers                                                            */
/* -------------------------------------------------------------------------- */

function MissionStep({
  label,
  active = false,
}: {
  label: string;
  active?: boolean;
}) {
  return (
    <div
      title={`${label} mission workflow step.`}
      className={`flex min-w-0 shrink-0 items-center gap-1 border px-1.5 py-0.5 ${
        active
          ? "border-yellow-400/40 bg-yellow-400/10 text-yellow-300"
          : "border-border bg-background/20 text-muted-foreground"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          active
            ? "bg-yellow-300"
            : "bg-muted-foreground/40"
        }`}
      />

      <span className="truncate text-[5.5px] font-bold uppercase tracking-[0.08em]">
        {label}
      </span>
    </div>
  );
}

function MissionLine() {
  return (
    <div className="h-px min-w-[8px] flex-1 bg-border" />
  );
}

/* -------------------------------------------------------------------------- */
/* Center mission panels                                                      */
/* -------------------------------------------------------------------------- */

function MissionInfoPanel() {
  return (
    <section title="Target information: current rescue target status and location details." className="min-h-0 overflow-hidden border border-border bg-panel-header/30">
      <div className="flex h-6 items-center justify-between border-b border-border px-2">
        <div className="flex items-center gap-1.5">
          <TargetIcon />

          <span className="text-[7px] font-bold uppercase tracking-[0.12em]">
            Target Information
          </span>
        </div>

        <span className="text-[6px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          NO ACTIVE TARGET
        </span>
      </div>

      <div className="grid h-[calc(100%-24px)] grid-cols-4 divide-x divide-border">
        <InfoCell
          label="STATUS"
          value="NONE"
          tone="neutral"
        />

        <InfoCell
          label="LATITUDE"
          value="N/A"
        />

        <InfoCell
          label="LONGITUDE"
          value="N/A"
        />

        <InfoCell
          label="CONFIDENCE"
          value="N/A"
        />
      </div>
    </section>
  );
}

function RescueNavigationPanel({
  fastyOnline,
}: {
  fastyOnline: boolean;
}) {
  return (
    <section title="Rescue navigation: distance, bearing, and estimated time information for SROTA." className="min-h-0 overflow-hidden border border-border bg-panel-header/30">
      <div className="flex h-6 items-center justify-between border-b border-border px-2">
        <div className="flex items-center gap-1.5">
          <Crosshair
            size={9}
            className="text-fasty"
          />

          <span className="text-[7px] font-bold uppercase tracking-[0.12em]">
            Rescue Navigation
          </span>
        </div>

        <span
          className={`text-[6px] font-bold uppercase tracking-[0.08em] ${
            fastyOnline
              ? "text-ok"
              : "text-muted-foreground"
          }`}
        >
          {fastyOnline
            ? "SROTA READY"
            : "SROTA OFFLINE"}
        </span>
      </div>

      <div className="grid h-[calc(100%-24px)] grid-cols-3 divide-x divide-border">
        <InfoCell
          label="DISTANCE"
          value="N/A"
          tone="fasty"
        />

        <InfoCell
          label="BEARING"
          value="N/A"
          tone="fasty"
        />

        <InfoCell
          label="ETA"
          value="N/A"
          tone="fasty"
        />
      </div>
    </section>
  );
}

function TargetIcon() {
  return (
    <Crosshair
      size={9}
      className="text-fault"
    />
  );
}

function InfoCell({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "fasty";
}) {
  return (
    <div title={`${label}: ${value}. This is a live mission status value.`} className="flex min-w-0 flex-col justify-center px-2">
      <span className="truncate text-[6px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>

      <span
        className={`value-mono mt-0.5 truncate text-[9px] font-bold uppercase ${
          tone === "fasty"
            ? "text-fasty"
            : "text-foreground"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function BottomStatus({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div
      title={`${label} status: ${value}.`}
      className="flex items-center gap-1">
      <span className="text-[6px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>

      <span
        className={`value-mono text-[7px] font-bold ${
          ok
            ? "text-ok"
            : "text-fault"
        }`}
      >
        {value}
      </span>
    </div>
  );
}


export default Cockpit;