import type { ReactNode } from "react";
import {
  Activity,
  Compass,
  Cpu,
  Gauge,
  Navigation,
  Radio,
  Satellite,
  ShieldCheck,
} from "lucide-react";

import {
  fmt,
  useTelemetry,
} from "@/lib/telemetry";

import { useFastyTelemetry } from "@/lib/useFastyTelemetry";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type Tone =
  | "drone"
  | "fasty"
  | "ok"
  | "warn"
  | "fault"
  | "neutral";

type TelemetryValue =
  | number
  | string
  | null
  | undefined;

interface MetricCellProps {
  label: string;
  value: TelemetryValue;
  unit?: string;
  tone?: Tone;
}

interface SectionProps {
  title: string;
  icon: ReactNode;
  tone?: Tone;
  children: ReactNode;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function toneClasses(tone: Tone): string {
  switch (tone) {
    case "drone":
      return "text-cyan-300";
    case "fasty":
      return "text-orange-300";
    case "ok":
      return "text-emerald-300";
    case "warn":
      return "text-yellow-300";
    case "fault":
      return "text-red-300";
    default:
      return "text-foreground";
  }
}

function borderClasses(tone: Tone): string {
  switch (tone) {
    case "drone":
      return "border-cyan-400/20";
    case "fasty":
      return "border-orange-400/20";
    case "ok":
      return "border-emerald-400/20";
    case "warn":
      return "border-yellow-400/20";
    case "fault":
      return "border-red-400/20";
    default:
      return "border-border";
  }
}

function metricString(
  value: TelemetryValue,
): string {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "N/A";
  }

  return String(value);
}

function displayMetric(
  value: unknown,
  precision = 2,
): string {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "N/A";
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value.toFixed(precision)
      : "N/A";
  }

  return String(value);
}

/* -------------------------------------------------------------------------- */
/* Main telemetry overlay                                                     */
/* -------------------------------------------------------------------------- */

export default function Telemetry() {
  const { drone } = useTelemetry();

  const {
    rosConnection,
    telemetry: fasty,
  } = useFastyTelemetry();

  const fastyConnected =
    rosConnection === "CONNECTED" &&
    fasty.state.connected;

  const fastyImuAvailable =
    fasty.attitude.roll !== null ||
    fasty.attitude.pitch !== null ||
    fasty.attitude.yaw !== null ||
    fasty.acceleration.x !== null ||
    fasty.acceleration.y !== null ||
    fasty.acceleration.z !== null;

  const droneArmed = Boolean(drone.armed.value);

  return (
    <div className="min-h-full bg-[#071019] p-3 font-mono">
      {/* ================================================================== */}
      {/* CONNECTION SUMMARY                                                 */}
      {/* ================================================================== */}

      <div className="mb-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
        <SummaryCard
          label="DRONE LINK"
          value={drone.link}
          tone={
            drone.link === "ONLINE"
              ? "ok"
              : "drone"
          }
          icon={<Radio size={13} />}
        />

        <SummaryCard
          label="FASTY MAVLINK"
          value={
            fasty.state.connected
              ? "CONNECTED"
              : "DISCONNECTED"
          }
          tone={
            fasty.state.connected
              ? "ok"
              : "fasty"
          }
          icon={<Navigation size={13} />}
        />

        <SummaryCard
          label="FASTY ROS"
          value={rosConnection}
          tone={
            fastyConnected
              ? "ok"
              : rosConnection === "CONNECTING"
                ? "warn"
                : "neutral"
          }
          icon={<Cpu size={13} />}
        />

        <SummaryCard
          label="FASTY MODE"
          value={metricString(fasty.state.mode)}
          tone="fasty"
          icon={<Compass size={13} />}
        />
      </div>

      {/* ================================================================== */}
      {/* TWO VEHICLE COLUMNS                                                */}
      {/* ================================================================== */}

      <div className="grid min-h-0 gap-3 xl:grid-cols-2">
        {/* ---------------------------------------------------------------- */}
        {/* DRONE                                                             */}
        {/* ---------------------------------------------------------------- */}

        <div className="space-y-3">
          <Section
            title="DRONE — VEHICLE"
            icon={<Gauge size={13} />}
            tone="drone"
          >
            <div className="grid grid-cols-2 gap-px overflow-hidden border border-border bg-border md:grid-cols-3">
              <MetricCell
                label="Model"
                value={drone.model}
                tone="drone"
              />

              <MetricCell
                label="Link"
                value={drone.link}
                tone="drone"
              />

              <MetricCell
                label="Flight Mode"
                value={fmt(drone.flightMode)}
                tone="drone"
              />

              <MetricCell
                label="Armed"
                value={fmt(drone.armed)}
                tone={
                  droneArmed
                    ? "warn"
                    : "neutral"
                }
              />

              <MetricCell
                label="GPS Fix"
                value={fmt(drone.gpsFix)}
                tone="drone"
              />

              <MetricCell
                label="Satellites"
                value={fmt(drone.satellites)}
                tone="drone"
                unit="SAT"
              />
            </div>
          </Section>

          <Section
            title="DRONE — POSITION / FLIGHT"
            icon={<Navigation size={13} />}
            tone="drone"
          >
            <div className="grid grid-cols-2 gap-px overflow-hidden border border-border bg-border md:grid-cols-3">
              <MetricCell
                label="Latitude"
                value={displayMetric(drone.lat, 6)}
                tone="drone"
              />

              <MetricCell
                label="Longitude"
                value={displayMetric(drone.lon, 6)}
                tone="drone"
              />

              <MetricCell
                label="Altitude AMSL"
                value={displayMetric(drone.altAmsl, 1)}
                tone="drone"
                unit="M"
              />

              <MetricCell
                label="Relative Altitude"
                value={displayMetric(drone.altRel, 1)}
                tone="drone"
                unit="M"
              />

              <MetricCell
                label="Heading"
                value={displayMetric(drone.heading, 1)}
                tone="drone"
                unit="DEG"
              />

              <MetricCell
                label="Ground Speed"
                value={displayMetric(drone.groundSpeed, 1)}
                tone="drone"
                unit="M/S"
              />

              <MetricCell
                label="Vertical Speed"
                value={displayMetric(drone.verticalSpeed, 1)}
                tone="drone"
                unit="M/S"
              />

              <MetricCell
                label="Home Distance"
                value={displayMetric(drone.homeDistance, 1)}
                tone="drone"
                unit="M"
              />

              <MetricCell
                label="Est. Flight Time"
                value="N/A"
                tone="drone"
              />
            </div>
          </Section>

          <Section
            title="DRONE — POWER / COMMUNICATION"
            icon={<ShieldCheck size={13} />}
            tone="drone"
          >
            <div className="grid grid-cols-2 gap-px overflow-hidden border border-border bg-border md:grid-cols-3">
              <MetricCell
                label="Battery"
                value={drone.batteryPct?.value}
                tone="drone"
                unit="%"
              />

              <MetricCell
                label="Voltage"
                value={displayMetric(drone.voltage, 1)}
                tone="drone"
                unit="V"
              />

              <MetricCell
                label="Current"
                value={displayMetric(drone.current, 1)}
                tone="drone"
                unit="A"
              />

              <MetricCell
                label="RC Signal"
                value={fmt(drone.rcSignal)}
                tone="drone"
                unit="%"
              />

              <MetricCell
                label="Video Link"
                value={fmt(drone.videoLink)}
                tone="drone"
              />

              <MetricCell
                label="Safety"
                value="SEE VEHICLE STATUS"
                tone="neutral"
              />
            </div>
          </Section>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* FASTY                                                             */}
        {/* ---------------------------------------------------------------- */}

        <div className="space-y-3">
          <Section
            title="FASTY — VEHICLE"
            icon={<Gauge size={13} />}
            tone="fasty"
          >
            <div className="grid grid-cols-2 gap-px overflow-hidden border border-border bg-border md:grid-cols-3">
              <MetricCell
                label="Platform"
                value="SROTA ROBOTIC LIFEBUOY"
                tone="fasty"
              />

              <MetricCell
                label="MAVLink"
                value={
                  fasty.state.connected
                    ? "CONNECTED"
                    : "DISCONNECTED"
                }
                tone={
                  fasty.state.connected
                    ? "ok"
                    : "fault"
                }
              />

              <MetricCell
                label="ROS Bridge"
                value={rosConnection}
                tone={
                  fastyConnected
                    ? "ok"
                    : "neutral"
                }
              />

              <MetricCell
                label="Armed"
                value={
                  fasty.state.armed
                    ? "YES"
                    : "NO"
                }
                tone={
                  fasty.state.armed
                    ? "warn"
                    : "neutral"
                }
              />

              <MetricCell
                label="Guided"
                value={
                  fasty.state.guided
                    ? "YES"
                    : "NO"
                }
                tone="fasty"
              />

              <MetricCell
                label="Manual Input"
                value={
                  fasty.state.manualInput
                    ? "YES"
                    : "NO"
                }
                tone="fasty"
              />

              <MetricCell
                label="Mode"
                value={metricString(fasty.state.mode)}
                tone="fasty"
              />

              <MetricCell
                label="System Status"
                value={metricString(
                  fasty.state.systemStatus,
                )}
                tone="fasty"
                unit="ENUM"
              />
            </div>
          </Section>

          <Section
            title="FASTY — ATTITUDE / HEADING"
            icon={<Compass size={13} />}
            tone="fasty"
          >
            <div className="grid grid-cols-2 gap-px overflow-hidden border border-border bg-border md:grid-cols-4">
              <MetricCell
                label="Heading"
                value={fasty.heading}
                tone="fasty"
                unit="DEG"
              />

              <MetricCell
                label="Yaw"
                value={fasty.attitude.yaw}
                tone="fasty"
                unit="DEG"
              />

              <MetricCell
                label="Pitch"
                value={fasty.attitude.pitch}
                tone="fasty"
                unit="DEG"
              />

              <MetricCell
                label="Roll"
                value={fasty.attitude.roll}
                tone="fasty"
                unit="DEG"
              />
            </div>
          </Section>

          <Section
            title="FASTY — MOTION / IMU"
            icon={<Activity size={13} />}
            tone="fasty"
          >
            <div className="grid grid-cols-2 gap-px overflow-hidden border border-border bg-border md:grid-cols-3">
              <MetricCell
                label="Ground Speed"
                value={fasty.groundSpeed}
                tone="fasty"
                unit="M/S"
              />

              <MetricCell
                label="Climb"
                value={fasty.climbRate}
                tone="fasty"
                unit="M/S"
              />

              <MetricCell
                label="IMU"
                value={
                  fastyImuAvailable
                    ? "ONLINE"
                    : "N/A"
                }
                tone={
                  fastyImuAvailable
                    ? "ok"
                    : "neutral"
                }
              />

              <MetricCell
                label="Accel X"
                value={fasty.acceleration.x}
                tone="fasty"
                unit="M/S²"
              />

              <MetricCell
                label="Accel Y"
                value={fasty.acceleration.y}
                tone="fasty"
                unit="M/S²"
              />

              <MetricCell
                label="Accel Z"
                value={fasty.acceleration.z}
                tone="fasty"
                unit="M/S²"
              />

              <MetricCell
                label="Gyro X"
                value={fasty.angularVelocity.x}
                tone="fasty"
                unit="RAD/S"
              />

              <MetricCell
                label="Gyro Y"
                value={fasty.angularVelocity.y}
                tone="fasty"
                unit="RAD/S"
              />

              <MetricCell
                label="Gyro Z"
                value={fasty.angularVelocity.z}
                tone="fasty"
                unit="RAD/S"
              />
            </div>
          </Section>

          <Section
            title="FASTY — MAGNETOMETER / STATUS"
            icon={<Satellite size={13} />}
            tone="fasty"
          >
            <div className="grid grid-cols-2 gap-px overflow-hidden border border-border bg-border md:grid-cols-3">
              <MetricCell
                label="Mag X"
                value={fasty.magnetometer.x}
                tone="fasty"
                unit="MAG"
              />

              <MetricCell
                label="Mag Y"
                value={fasty.magnetometer.y}
                tone="fasty"
                unit="MAG"
              />

              <MetricCell
                label="Mag Z"
                value={fasty.magnetometer.z}
                tone="fasty"
                unit="MAG"
              />

              <MetricCell
                label="Latitude"
                value="N/A"
                tone="neutral"
              />

              <MetricCell
                label="Longitude"
                value="N/A"
                tone="neutral"
              />

              <MetricCell
                label="GPS Fix"
                value="NO FIX"
                tone="warn"
              />

              <MetricCell
                label="Satellites"
                value="N/A"
                tone="neutral"
              />

              <MetricCell
                label="Battery"
                value="N/A"
                tone="neutral"
              />

              <MetricCell
                label="Depth"
                value="N/A"
                tone="neutral"
              />
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border border-border bg-background/30 px-2 py-1.5">
              <div className="text-[7px] uppercase tracking-[0.12em] text-muted-foreground">
                Current hardware state
              </div>

              <div className="text-[7px] font-bold uppercase tracking-[0.12em] text-orange-300">
                MINI PIX + IMU / GPS NO FIX / BATTERY NOT CONNECTED
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* UI primitives                                                              */
/* -------------------------------------------------------------------------- */

function SummaryCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: Tone;
  icon: ReactNode;
}) {
  return (
    <div
      className={`border ${borderClasses(tone)} bg-background/30 px-2 py-2`}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span className={toneClasses(tone)}>
          {icon}
        </span>

        <span className="text-[6px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
      </div>

      <div
        className={`value-mono text-[10px] font-bold uppercase ${toneClasses(tone)}`}
      >
        {value}
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  tone = "neutral",
  children,
}: SectionProps) {
  return (
    <section
      className={`overflow-hidden border ${borderClasses(tone)} bg-panel-header/20`}
    >
      <div className="flex h-7 items-center justify-between border-b border-border bg-panel-header/30 px-2">
        <div className="flex items-center gap-1.5">
          <span className={toneClasses(tone)}>
            {icon}
          </span>

          <span className="text-[7px] font-bold uppercase tracking-[0.12em]">
            {title}
          </span>
        </div>

        <span className="text-[6px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          LIVE
        </span>
      </div>

      <div className="p-1.5">
        {children}
      </div>
    </section>
  );
}

function MetricCell({
  label,
  value,
  unit,
  tone = "neutral",
}: MetricCellProps) {
  return (
    <div className="min-w-0 bg-background px-2 py-2">
      <div className="truncate text-[6px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>

      <div
        className={`mt-0.5 flex min-w-0 items-baseline gap-1 ${toneClasses(tone)}`}
      >
        <span className="value-mono truncate text-[9px] font-bold">
          {typeof value === "number"
            ? Number.isFinite(value)
              ? value.toFixed(
                  unit === "DEG"
                    ? 2
                    : 3,
                )
              : "N/A"
            : metricString(value)}
        </span>

        {unit ? (
          <span className="shrink-0 text-[5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </div>
    </div>
  );
}
