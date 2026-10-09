import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BatteryCharging,
  Bot,
  CheckCircle2,
  Compass,
  Cpu,
  Gamepad2,
  Gauge,
  Globe2,
  HardDrive,
  Info,
  Layers3,
  Radio,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  Wrench,
  XCircle,
} from "lucide-react";

type VehicleId = "DRONE" | "FASTY";

type SectionId =
  | "SUMMARY"
  | "AIRFRAME"
  | "RADIO"
  | "FLIGHT_MODES"
  | "SENSORS"
  | "AIRSPEED"
  | "POWER"
  | "ESC"
  | "MOTORS"
  | "SERVO_OUTPUTS"
  | "FLIGHT_SAFETY"
  | "FAILSAFES"
  | "NAVIGATION"
  | "TUNING"
  | "GIMBAL"
  | "LOGGING"
  | "RESCUE_SYSTEM"
  | "PARAMETERS";

type Tone = "ok" | "warn" | "fault" | "neutral";

interface SetupField {
  label: string;
  value: string;
  tone?: Tone;
}

interface SetupSection {
  id: SectionId;
  label: string;
  description: string;
  icon: typeof Settings2;
}

interface SummaryCard {
  id: Exclude<SectionId, "SUMMARY">;
  title: string;
  indicator?: Tone;
  fields: SetupField[];
  enabled?: boolean;
}

const sections: SetupSection[] = [
  {
    id: "SUMMARY",
    label: "Summary",
    description: "Vehicle configuration summary.",
    icon: Layers3,
  },
  {
    id: "AIRFRAME",
    label: "Frame",
    description: "Vehicle class, frame and airframe configuration.",
    icon: Bot,
  },
  {
    id: "RADIO",
    label: "Radio",
    description: "RC and telemetry radio configuration.",
    icon: Radio,
  },
  {
    id: "FLIGHT_MODES",
    label: "Flight Modes",
    description: "Control mode assignments and mode switching.",
    icon: Gamepad2,
  },
  {
    id: "SENSORS",
    label: "Sensors",
    description: "IMU, compass, barometer and sensor health.",
    icon: Gauge,
  },
  {
    id: "AIRSPEED",
    label: "Airspeed",
    description: "Airspeed sensor configuration.",
    icon: Gauge,
  },
  {
    id: "POWER",
    label: "Power",
    description: "Battery monitor and power configuration.",
    icon: BatteryCharging,
  },
  {
    id: "ESC",
    label: "ESC",
    description: "Electronic speed controller setup.",
    icon: Settings2,
  },
  {
    id: "MOTORS",
    label: "Motors",
    description: "Motor configuration and test controls.",
    icon: RotateCcw,
  },
  {
    id: "SERVO_OUTPUTS",
    label: "Servo Outputs",
    description: "Actuator channels and output mapping.",
    icon: SlidersHorizontal,
  },
  {
    id: "FLIGHT_SAFETY",
    label: "Flight Safety",
    description: "Safety checks and recovery configuration.",
    icon: ShieldCheck,
  },
  {
    id: "FAILSAFES",
    label: "Failsafes",
    description: "Ground station, RC, battery and navigation failsafes.",
    icon: ShieldAlert,
  },
  {
    id: "NAVIGATION",
    label: "Navigation",
    description: "Position source, home and navigation state.",
    icon: Globe2,
  },
  {
    id: "TUNING",
    label: "Tuning",
    description: "Controller tuning and response configuration.",
    icon: Wrench,
  },
  {
    id: "GIMBAL",
    label: "Gimbal",
    description: "Camera and gimbal control configuration.",
    icon: Target,
  },
  {
    id: "LOGGING",
    label: "Logging",
    description: "Onboard logging and analysis configuration.",
    icon: HardDrive,
  },
  {
    id: "RESCUE_SYSTEM",
    label: "Rescue System",
    description: "FASTY rescue workflow and payload configuration.",
    icon: Target,
  },
  {
    id: "PARAMETERS",
    label: "Parameters",
    description: "Advanced ArduPilot parameter access.",
    icon: SlidersHorizontal,
  },
];

const droneSummary: SummaryCard[] = [
  {
    id: "AIRFRAME",
    title: "Frame",
    indicator: "warn",
    fields: [
      { label: "Frame Class", value: "AERIAL" },
      { label: "Frame Type", value: "NOT DETECTED" },
      { label: "Firmware", value: "N/A" },
    ],
  },
  {
    id: "FLIGHT_MODES",
    title: "Flight Modes",
    indicator: "neutral",
    fields: [
      { label: "Mode 1", value: "N/A" },
      { label: "Mode 2", value: "N/A" },
      { label: "Mode 3", value: "N/A" },
      { label: "Mode 4", value: "N/A" },
      { label: "Mode 5", value: "N/A" },
      { label: "Mode 6", value: "N/A" },
    ],
  },
  {
    id: "FLIGHT_SAFETY",
    title: "Flight Safety",
    indicator: "neutral",
    fields: [{ label: "Status", value: "NOT CONNECTED" }],
  },
  {
    id: "RADIO",
    title: "Radio",
    indicator: "neutral",
    fields: [
      { label: "Roll", value: "N/A" },
      { label: "Pitch", value: "N/A" },
      { label: "Yaw", value: "N/A" },
      { label: "Throttle", value: "N/A" },
    ],
  },
  {
    id: "SENSORS",
    title: "Sensors",
    indicator: "neutral",
    fields: [
      { label: "Compass", value: "N/A" },
      { label: "Accelerometer", value: "N/A" },
      { label: "Barometer", value: "N/A" },
    ],
  },
  {
    id: "POWER",
    title: "Power",
    indicator: "neutral",
    fields: [
      { label: "Battery", value: "N/A" },
      { label: "Voltage", value: "N/A" },
      { label: "Current", value: "N/A" },
    ],
  },
  {
    id: "ESC",
    title: "ESC",
    indicator: "neutral",
    fields: [{ label: "Output Type", value: "N/A" }],
  },
  {
    id: "MOTORS",
    title: "Motors",
    indicator: "neutral",
    fields: [
      { label: "Motor Count", value: "N/A" },
      { label: "Test", value: "LOCKED" },
    ],
  },
  {
    id: "FAILSAFES",
    title: "Failsafes",
    indicator: "neutral",
    fields: [
      { label: "Ground Station", value: "N/A" },
      { label: "RC", value: "N/A" },
      { label: "Battery", value: "N/A" },
    ],
  },
];

const fastySummary: SummaryCard[] = [
  {
    id: "ESC",
    title: "ESC",
    indicator: "warn",
    fields: [
      { label: "Output Type", value: "NORMAL" },
      { label: "Status", value: "CONFIGURATION PENDING" },
    ],
  },
  {
    id: "FLIGHT_MODES",
    title: "Flight Modes",
    indicator: "ok",
    fields: [
      { label: "Current", value: "HOLD" },
      { label: "Guided", value: "FALSE" },
      { label: "Manual Input", value: "FALSE" },
      { label: "Rescue Mode", value: "CONFIG PENDING" },
    ],
  },
  {
    id: "FLIGHT_SAFETY",
    title: "Flight Safety",
    indicator: "warn",
    fields: [
      { label: "Arming Checks", value: "ACTIVE", tone: "ok" },
      { label: "Status", value: "CONFIGURATION PENDING", tone: "warn" },
    ],
  },
  {
    id: "AIRFRAME",
    title: "Frame",
    indicator: "ok",
    fields: [
      { label: "Frame Class", value: "BOAT" },
      { label: "Frame Type", value: "FASTY / SROTA" },
      { label: "Firmware", value: "ARDUPILOT" },
    ],
  },
  {
    id: "RADIO",
    title: "Radio",
    indicator: "neutral",
    fields: [
      { label: "Roll", value: "N/A" },
      { label: "Pitch", value: "N/A" },
      { label: "Yaw", value: "N/A" },
      { label: "Throttle", value: "N/A" },
    ],
  },
  {
    id: "POWER",
    title: "Power",
    indicator: "neutral",
    fields: [
      { label: "Battery", value: "NOT DETECTED" },
      { label: "Voltage", value: "N/A" },
      { label: "Current", value: "N/A" },
    ],
  },
  {
    id: "SENSORS",
    title: "Sensors",
    indicator: "ok",
    fields: [
      { label: "Compass", value: "READY", tone: "ok" },
      { label: "Accelerometer", value: "READY", tone: "ok" },
      { label: "GPS", value: "NO FIX", tone: "warn" },
      { label: "Barometer", value: "AVAILABLE", tone: "neutral" },
    ],
  },
];

const detailData: Record<VehicleId, Partial<Record<SectionId, SetupField[]>>> = {
  DRONE: {
    AIRFRAME: [
      { label: "Vehicle Class", value: "AERIAL" },
      { label: "Frame", value: "N/A" },
      { label: "Autopilot", value: "NOT CONNECTED" },
    ],
    RADIO: [
      { label: "RC Link", value: "N/A" },
      { label: "Telemetry Link", value: "N/A" },
      { label: "Transport", value: "N/A" },
    ],
    FLIGHT_MODES: [
      { label: "Mode 1", value: "N/A" },
      { label: "Mode 2", value: "N/A" },
      { label: "Mode 3", value: "N/A" },
      { label: "Mode 4", value: "N/A" },
      { label: "Mode 5", value: "N/A" },
      { label: "Mode 6", value: "N/A" },
    ],
    SENSORS: [
      { label: "IMU", value: "N/A" },
      { label: "Compass", value: "N/A" },
      { label: "Barometer", value: "N/A" },
      { label: "GPS", value: "N/A" },
    ],
    AIRSPEED: [{ label: "Sensor", value: "N/A" }],
    POWER: [
      { label: "Battery", value: "N/A" },
      { label: "Voltage", value: "N/A" },
      { label: "Current", value: "N/A" },
    ],
    ESC: [
      { label: "ESC Type", value: "N/A" },
      { label: "Output Type", value: "N/A" },
    ],
    MOTORS: [
      { label: "Motor Count", value: "N/A" },
      { label: "Test", value: "LOCKED" },
    ],
    SERVO_OUTPUTS: [
      { label: "Channels", value: "N/A" },
      { label: "Mapping", value: "N/A" },
    ],
    FLIGHT_SAFETY: [
      { label: "Arming Checks", value: "N/A" },
      { label: "Safety State", value: "N/A" },
    ],
    FAILSAFES: [
      { label: "Ground Station", value: "N/A" },
      { label: "RC", value: "N/A" },
      { label: "Battery", value: "N/A" },
      { label: "GPS / Navigation", value: "N/A" },
    ],
    NAVIGATION: [
      { label: "EKF", value: "N/A" },
      { label: "Home", value: "N/A" },
      { label: "Position Source", value: "N/A" },
    ],
    TUNING: [
      { label: "Rate Controller", value: "N/A" },
      { label: "Attitude Controller", value: "N/A" },
    ],
    GIMBAL: [
      { label: "Gimbal", value: "N/A" },
      { label: "Camera", value: "N/A" },
    ],
    LOGGING: [
      { label: "Logging", value: "N/A" },
      { label: "Storage", value: "N/A" },
    ],
    RESCUE_SYSTEM: [
      { label: "Role", value: "SEARCH / TARGET PROVIDER" },
      { label: "Target Handoff", value: "PLANNED" },
      { label: "Human Verification", value: "REQUIRED" },
    ],
    PARAMETERS: [
      { label: "Parameter Service", value: "NOT CONNECTED" },
      { label: "Read / Write", value: "PLANNED" },
    ],
  },
  FASTY: {
    AIRFRAME: [
      { label: "Vehicle Class", value: "BOAT / SURFACE RESCUE", tone: "ok" },
      { label: "Frame", value: "FASTY / SROTA" },
      { label: "Autopilot", value: "ARDUPILOT", tone: "ok" },
    ],
    RADIO: [
      { label: "RC Link", value: "N/A" },
      { label: "Telemetry Link", value: "MAVLINK / USB", tone: "ok" },
      { label: "Transport", value: "SERIAL", tone: "ok" },
    ],
    FLIGHT_MODES: [
      { label: "Current Mode", value: "HOLD", tone: "ok" },
      { label: "Guided", value: "FALSE" },
      { label: "Manual Input", value: "FALSE" },
      { label: "Rescue Mode", value: "NOT CONFIGURED" },
    ],
    SENSORS: [
      { label: "IMU", value: "ONLINE", tone: "ok" },
      { label: "Compass", value: "ONLINE", tone: "ok" },
      { label: "GPS", value: "NO FIX", tone: "warn" },
      { label: "Barometer", value: "AVAILABLE", tone: "neutral" },
    ],
    AIRSPEED: [{ label: "Sensor", value: "NOT USED BY SURFACE VEHICLE" }],
    POWER: [
      { label: "Battery", value: "NOT DETECTED" },
      { label: "Voltage", value: "N/A" },
      { label: "Current", value: "N/A" },
    ],
    ESC: [
      { label: "ESC", value: "CONFIGURATION PENDING" },
      { label: "Output Type", value: "NORMAL" },
      { label: "Test", value: "LOCKED" },
    ],
    MOTORS: [
      { label: "Motor Count", value: "QUERY PENDING" },
      { label: "ESC Status", value: "NOT INTEGRATED" },
      { label: "Test", value: "LOCKED" },
    ],
    SERVO_OUTPUTS: [
      { label: "Channels", value: "QUERY PENDING" },
      { label: "Mapping", value: "NOT CONFIGURED" },
    ],
    FLIGHT_SAFETY: [
      { label: "Arming Checks", value: "ACTIVE", tone: "ok" },
      { label: "Safety State", value: "CONFIGURATION PENDING", tone: "warn" },
    ],
    FAILSAFES: [
      { label: "Ground Station", value: "CONFIGURATION PENDING" },
      { label: "RC", value: "CONFIGURATION PENDING" },
      { label: "Battery", value: "CONFIGURATION PENDING" },
      { label: "Navigation", value: "CONFIGURATION PENDING" },
    ],
    NAVIGATION: [
      { label: "EKF", value: "QUERY PENDING" },
      { label: "Home", value: "N/A" },
      { label: "Position Source", value: "NO GPS FIX", tone: "warn" },
    ],
    TUNING: [
      { label: "Rate Controller", value: "QUERY PENDING" },
      { label: "Surface Control", value: "QUERY PENDING" },
    ],
    GIMBAL: [
      { label: "Gimbal", value: "NOT INTEGRATED" },
      { label: "Camera", value: "NOT AVAILABLE" },
    ],
    LOGGING: [
      { label: "Logging", value: "QUERY PENDING" },
      { label: "Storage", value: "QUERY PENDING" },
    ],
    RESCUE_SYSTEM: [
      { label: "Role", value: "NAVIGATE / RESCUE", tone: "ok" },
      { label: "Target Handoff", value: "PLANNED" },
      { label: "Rescue Payload", value: "NOT INTEGRATED" },
      { label: "Human Verification", value: "REQUIRED" },
    ],
    PARAMETERS: [
      { label: "Parameter Service", value: "PLANNED" },
      { label: "Read / Write", value: "GATED" },
    ],
  },
};

function toneText(tone: Tone = "neutral") {
  if (tone === "ok") return "text-ok";
  if (tone === "warn") return "text-warn";
  if (tone === "fault") return "text-fault";
  return "text-foreground";
}

function toneIndicator(tone: Tone = "neutral") {
  if (tone === "ok") return "bg-ok";
  if (tone === "warn") return "bg-warn";
  if (tone === "fault") return "bg-fault";
  return "bg-muted-foreground/45";
}

function StatusPill({ tone, children }: { tone: Tone; children: string }) {
  const classes =
    tone === "ok"
      ? "border-ok/30 bg-ok/10 text-ok"
      : tone === "warn"
        ? "border-warn/30 bg-warn/10 text-warn"
        : tone === "fault"
          ? "border-fault/30 bg-fault/10 text-fault"
          : "border-border bg-background/30 text-muted-foreground";

  return (
    <span
      className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[6px] font-bold uppercase tracking-[0.08em] ${classes}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${toneIndicator(tone)}`} />
      {children}
    </span>
  );
}

function SetupField({ item }: { item: SetupField }) {
  return (
    <div className="grid min-h-[30px] grid-cols-[minmax(80px,0.92fr)_minmax(0,1.35fr)] items-center border-b border-[#444444] px-2.5 py-1.5 last:border-b-0">
      <span className="truncate text-[6px] font-medium tracking-[0.01em] text-[#eeeeee]">
        {item.label}
      </span>
      <span
        className={`value-mono truncate text-right text-[7px] font-medium ${toneText(
          item.tone,
        )}`}
      >
        {item.value}
      </span>
    </div>
  );
}

function SummaryCardView({
  card,
  onOpen,
}: {
  card: SummaryCard;
  onOpen: (id: Exclude<SectionId, "SUMMARY">) => void;
}) {
  return (
    <article className="overflow-hidden border border-[#444444] bg-[#333333]">
      <button
        type="button"
        onClick={() => onOpen(card.id)}
        className="flex h-8 w-full items-center justify-between border-b border-black/10 bg-[#666674] px-2.5 text-left transition hover:bg-[#70707e]"
      >
        <span className="truncate text-[7px] font-medium tracking-[0.01em] text-white">
          {card.title}
        </span>

        {card.indicator && (
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${toneIndicator(
              card.indicator,
            )}`}
            aria-label={`${card.title} status`}
          />
        )}
      </button>

      <div>
        {card.fields.map((field) => (
          <SetupField
            key={`${card.title}-${field.label}`}
            item={field}
          />
        ))}
      </div>
    </article>
  );
}

function SectionDetail({
  vehicle,
  section,
  onNotice,
}: {
  vehicle: VehicleId;
  section: Exclude<SectionId, "SUMMARY">;
  onNotice: (message: string) => void;
}) {
  const selected = sections.find((item) => item.id === section) ?? sections[0]!;
  const Icon = selected.icon;
  const fields =
    detailData[vehicle][section] ??
    [
      {
        label: "Status",
        value: "NOT IMPLEMENTED",
        tone: "neutral" as Tone,
      },
    ];

  return (
    <div className="min-h-full bg-[#2f2f2f] p-3">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(245px,0.75fr)]">
        <section className="overflow-hidden rounded-[2px] border border-border bg-[#343434]">
          <div className="flex items-center justify-between border-b border-border bg-[#3d3d3d] px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <div
                className={`flex size-6 items-center justify-center border ${
                  vehicle === "FASTY"
                    ? "border-orange-400/30 bg-orange-400/10 text-orange-300"
                    : "border-cyan-400/30 bg-cyan-400/10 text-cyan-300"
                }`}
              >
                <Icon size={12} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[9px] font-bold uppercase tracking-[0.12em]">
                  {selected.label}
                </div>
                <div className="mt-0.5 truncate text-[6px] uppercase tracking-[0.08em] text-muted-foreground">
                  {selected.description}
                </div>
              </div>
            </div>

            <StatusPill
              tone={vehicle === "FASTY" ? "ok" : "neutral"}
            >
              {vehicle === "FASTY" ? "MAVLINK" : "PENDING"}
            </StatusPill>
          </div>

          <div className="divide-y divide-border/70">
            {fields.map((field) => (
              <SetupField
                key={`${field.label}-${field.value}`}
                item={field}
              />
            ))}
          </div>
        </section>

        <aside className="space-y-3">
          <section className="overflow-hidden rounded-[2px] border border-border bg-[#343434]">
            <div className="border-b border-border bg-[#3d3d3d] px-3 py-2.5 text-[7px] font-bold uppercase tracking-[0.1em]">
              Configuration Actions
            </div>

            <div className="grid gap-1.5 p-3">
              <button
                type="button"
                onClick={() =>
                  onNotice("PARAMETER READ REQUEST QUEUED")
                }
                className="flex items-center justify-between border border-border px-2.5 py-2 text-left text-[7px] font-bold uppercase tracking-[0.08em] transition hover:border-cyan-400/30 hover:bg-cyan-400/5"
              >
                Read Parameters
                <SlidersHorizontal size={11} className="text-cyan-300" />
              </button>

              <button
                type="button"
                onClick={() =>
                  onNotice("CALIBRATION INTERFACE NOT YET CONNECTED")
                }
                className="flex items-center justify-between border border-border px-2.5 py-2 text-left text-[7px] font-bold uppercase tracking-[0.08em] transition hover:border-cyan-400/30 hover:bg-cyan-400/5"
              >
                Calibration
                <Wrench size={11} className="text-cyan-300" />
              </button>

              <button
                type="button"
                onClick={() =>
                  onNotice(
                    "HARDWARE WRITE IS GATED UNTIL VEHICLE SERVICES ARE CONNECTED",
                  )
                }
                className="flex items-center justify-between border border-border px-2.5 py-2 text-left text-[7px] font-bold uppercase tracking-[0.08em] transition hover:border-cyan-400/30 hover:bg-cyan-400/5"
              >
                Apply / Save
                <Save size={11} className="text-cyan-300" />
              </button>
            </div>
          </section>

          <section className="border border-yellow-400/20 bg-yellow-400/5 p-3">
            <div className="flex items-start gap-2">
              <Info
                size={13}
                className="mt-0.5 shrink-0 text-yellow-300"
              />
              <div>
                <div className="text-[7px] font-bold uppercase tracking-[0.1em] text-yellow-200">
                  QGC-STYLE SAFETY GATE
                </div>
                <p className="mt-1 text-[7px] leading-4 text-yellow-100/70">
                  The setup shell is now modeled around QGroundControl&apos;s
                  component-oriented configuration workflow. Hardware write
                  operations remain gated until the corresponding MAVLink
                  services are actually connected.
                </p>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-[2px] border border-border bg-[#343434]">
            <div className="border-b border-border bg-[#3d3d3d] px-3 py-2.5 text-[7px] font-bold uppercase tracking-[0.1em]">
              Vehicle Link
            </div>

            <div className="p-3">
              <div className="flex items-center justify-between">
                <span className="text-[6px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Transport
                </span>
                <span className="value-mono text-[7px] font-bold uppercase text-ok">
                  {vehicle === "FASTY" ? "SERIAL / MAVLINK" : "N/A"}
                </span>
              </div>

              <div className="mt-2 flex items-center justify-between">
                <span className="text-[6px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Configuration Access
                </span>
                <span className="value-mono text-[7px] font-bold uppercase text-warn">
                  QUERY PENDING
                </span>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

export default function VehicleSetup() {
  const [vehicle, setVehicle] = useState<VehicleId>("FASTY");
  const [section, setSection] = useState<SectionId>("SUMMARY");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const summaryCards = vehicle === "FASTY" ? fastySummary : droneSummary;

  const filteredSections = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return sections;

    return sections.filter(
      (item) =>
        item.label.toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term),
    );
  }, [query]);

  const selectSection = (id: SectionId) => {
    setSection(id);
    setNotice(null);
  };

  const trigger = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2600);
  };

  const activeSection =
    sections.find((item) => item.id === section) ?? sections[0]!;

  return (
    <div className="flex min-h-full flex-col bg-[#2f2f2f] text-foreground">
      {/* QGC-like vehicle/header strip */}
      <div className="flex shrink-0 items-center justify-between border-b border-black/20 bg-[#242424] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className={`flex size-8 items-center justify-center rounded border ${
              vehicle === "FASTY"
                ? "border-orange-400/40 bg-orange-400/10 text-orange-300"
                : "border-cyan-400/40 bg-cyan-400/10 text-cyan-300"
            }`}
          >
            {vehicle === "FASTY" ? (
              <Target size={15} />
            ) : (
              <Bot size={15} />
            )}
          </div>

          <div className="min-w-0">
            <div className="truncate text-[10px] font-bold uppercase tracking-[0.12em]">
              Vehicle Configuration
            </div>
            <div className="mt-0.5 truncate text-[6px] uppercase tracking-[0.08em] text-muted-foreground">
              {vehicle === "FASTY"
                ? "FASTY / SROTA — ARDUPILOT SURFACE RESCUE VEHICLE"
                : "DRONE — AERIAL SEARCH VEHICLE"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 border border-border bg-[#1d1d1d] p-1">
          <button
            type="button"
            onClick={() => {
              setVehicle("DRONE");
              setSection("SUMMARY");
              setQuery("");
            }}
            className={`px-3 py-1.5 text-[7px] font-bold uppercase tracking-[0.1em] transition ${
              vehicle === "DRONE"
                ? "bg-cyan-400/10 text-cyan-300"
                : "text-muted-foreground hover:bg-white/5"
            }`}
          >
            DRONE
          </button>

          <button
            type="button"
            onClick={() => {
              setVehicle("FASTY");
              setSection("SUMMARY");
              setQuery("");
            }}
            className={`px-3 py-1.5 text-[7px] font-bold uppercase tracking-[0.1em] transition ${
              vehicle === "FASTY"
                ? "bg-orange-400/10 text-orange-300"
                : "text-muted-foreground hover:bg-white/5"
            }`}
          >
            FASTY
          </button>
        </div>
      </div>

      <div className="grid min-h-[600px] flex-1 grid-cols-[205px_minmax(0,1fr)]">
        {/* QGC-inspired left navigation */}
        <aside className="min-h-0 overflow-y-auto border-r border-black/20 bg-[#272727]">
          <div className="border-b border-border/60 p-2.5">
            <div className="relative">
              <Search
                size={11}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search configuration..."
                className="h-7 w-full border border-border bg-[#1d1d1d] pl-7 pr-2 text-[7px] uppercase tracking-[0.06em] text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-cyan-400/30"
              />
            </div>
          </div>

          <div className="px-1.5 py-1">
            {filteredSections.map((item) => {
              const ItemIcon = item.icon;
              const active = item.id === section;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectSection(item.id)}
                  className={`flex w-full items-center gap-2 border-b border-border/50 px-2.5 py-2 text-left transition ${
                    active
                      ? vehicle === "FASTY"
                        ? "bg-orange-400/15 text-orange-200"
                        : "bg-cyan-400/15 text-cyan-200"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  }`}
                >
                  <ItemIcon size={11} />
                  <span className="min-w-0 flex-1 truncate text-[7px] font-semibold uppercase tracking-[0.06em]">
                    {item.label}
                  </span>

                  {item.id !== "SUMMARY" && (
                    <span className="text-[5px] text-muted-foreground/50">
                      ›
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-3 border-t border-border/60 px-2.5 py-2">
            <div className="text-[6px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              Vehicle State
            </div>

            <div className="mt-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[6px] uppercase text-muted-foreground">
                  LINK
                </span>
                <StatusPill tone={vehicle === "FASTY" ? "ok" : "neutral"}>
                  {vehicle === "FASTY" ? "ONLINE" : "OFFLINE"}
                </StatusPill>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[6px] uppercase text-muted-foreground">
                  MODE
                </span>
                <span className="value-mono text-[7px] font-bold uppercase text-foreground">
                  {vehicle === "FASTY" ? "HOLD" : "N/A"}
                </span>
              </div>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <section className="min-w-0 overflow-y-auto">
          {section === "SUMMARY" ? (
            <div className="min-h-full p-4">
              <div className="mx-auto max-w-[1280px]">
                <div className="px-2 text-center">
                  <div
                    className={`text-[8px] font-semibold leading-4 ${
                      vehicle === "FASTY"
                        ? "text-foreground"
                        : "text-warn"
                    }`}
                  >
                    {vehicle === "FASTY"
                      ? "Your vehicle configuration summary appears below. Select components on the left to review or fine-tune settings."
                      : "WARNING: Configuration tasks remain before this vehicle is ready. Select components on the left to review or fine-tune settings."}
                  </div>

                  <div className="mt-1 text-[6px] uppercase tracking-[0.08em] text-muted-foreground">
                    Select a component card to open its configuration panel.
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
                  {summaryCards.map((card) => (
                    <SummaryCardView
                      key={card.id}
                      card={card}
                      onOpen={(id) => selectSection(id)}
                    />
                  ))}
                </div>

                <div className="mt-3 grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <section className="border border-border bg-[#343434]">
                    <div className="border-b border-border bg-[#3d3d3d] px-3 py-2 text-[7px] font-bold uppercase tracking-[0.1em]">
                      Setup Status
                    </div>

                    <div className="grid grid-cols-2 divide-x divide-border md:grid-cols-4">
                      <div className="p-3">
                        <div className="text-[6px] uppercase tracking-[0.08em] text-muted-foreground">
                          VEHICLE
                        </div>
                        <div
                          className={`value-mono mt-1 text-[8px] font-bold uppercase ${
                            vehicle === "FASTY"
                              ? "text-fasty"
                              : "text-drone"
                          }`}
                        >
                          {vehicle === "FASTY"
                            ? "FASTY / SROTA"
                            : "DRONE"}
                        </div>
                      </div>

                      <div className="p-3">
                        <div className="text-[6px] uppercase tracking-[0.08em] text-muted-foreground">
                          AUTOPILOT
                        </div>
                        <div className="value-mono mt-1 text-[8px] font-bold uppercase text-foreground">
                          {vehicle === "FASTY" ? "ARDUPILOT" : "N/A"}
                        </div>
                      </div>

                      <div className="p-3">
                        <div className="text-[6px] uppercase tracking-[0.08em] text-muted-foreground">
                          CURRENT MODE
                        </div>
                        <div className="value-mono mt-1 text-[8px] font-bold uppercase text-foreground">
                          {vehicle === "FASTY" ? "HOLD" : "N/A"}
                        </div>
                      </div>

                      <div className="p-3">
                        <div className="text-[6px] uppercase tracking-[0.08em] text-muted-foreground">
                          GPS
                        </div>
                        <div className="value-mono mt-1 text-[8px] font-bold uppercase text-warn">
                          {vehicle === "FASTY" ? "NO FIX" : "N/A"}
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="border border-yellow-400/20 bg-yellow-400/5 p-3">
                    <div className="flex items-start gap-2">
                      {vehicle === "FASTY" ? (
                        <CheckCircle2
                          size={13}
                          className="mt-0.5 shrink-0 text-ok"
                        />
                      ) : (
                        <AlertTriangle
                          size={13}
                          className="mt-0.5 shrink-0 text-yellow-300"
                        />
                      )}

                      <div>
                        <div className="text-[7px] font-bold uppercase tracking-[0.1em] text-yellow-200">
                          Configuration Notice
                        </div>
                        <p className="mt-1 text-[7px] leading-4 text-yellow-100/70">
                          Live FASTY MAVLink connection is available. Battery
                          telemetry remains N/A because the battery monitor is
                          not connected. No configuration write is performed
                          from this summary screen.
                        </p>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          ) : (
            <SectionDetail
              vehicle={vehicle}
              section={section as Exclude<SectionId, "SUMMARY">}
              onNotice={trigger}
            />
          )}
        </section>
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between border-t border-black/20 bg-[#242424] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Settings2 size={10} className="text-muted-foreground" />
          <span className="truncate text-[6px] uppercase tracking-[0.08em] text-muted-foreground">
            {vehicle === "FASTY" ? "FASTY SETUP" : "DRONE SETUP"}
          </span>
          <span className="text-[6px] text-muted-foreground/50">/</span>
          <span className="truncate text-[6px] uppercase tracking-[0.08em] text-foreground">
            {activeSection.label}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {notice && (
            <div className="hidden items-center gap-1 text-[6px] font-bold uppercase tracking-[0.08em] text-cyan-300 sm:flex">
              <XCircle size={10} />
              {notice}
            </div>
          )}

          <button
            type="button"
            onClick={() => trigger("CONFIGURATION RESET REQUESTED")}
            className="flex items-center gap-1 border border-border px-2.5 py-1.5 text-[6px] font-bold uppercase tracking-[0.08em] text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
          >
            <RotateCcw size={9} />
            Reset
          </button>

          <button
            type="button"
            onClick={() =>
              trigger(
                "SAVE REQUEST QUEUED — HARDWARE WRITE NOT ENABLED",
              )
            }
            className={`flex items-center gap-1 border px-2.5 py-1.5 text-[6px] font-bold uppercase tracking-[0.08em] ${
              vehicle === "FASTY"
                ? "border-orange-400/30 bg-orange-400/10 text-orange-200 hover:bg-orange-400/15"
                : "border-cyan-400/30 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/15"
            }`}
          >
            <Save size={9} />
            Apply / Save
          </button>
        </div>
      </div>
    </div>
  );
}
