import { useEffect, useState } from "react";
import { Settings, X } from "lucide-react";
import type { SystemTelemetry } from "@/lib/telemetry";
import { StatusDot } from "./primitives";

function Clock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());

    const id = setInterval(() => setNow(new Date()), 1000);

    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-w-[92px] text-right">
      <div className="value-mono text-[15px] leading-tight font-semibold">
        {now ? now.toLocaleTimeString("en-GB", { hour12: false }) : "--:--:--"}
      </div>

      <div className="value-mono text-[10px] text-muted-foreground">
        {now
          ? now.toLocaleDateString("en-GB", {
              weekday: "short",
              day: "2-digit",
              month: "short",
              year: "numeric",
            })
          : "—"}
      </div>
    </div>
  );
}

export function TopBar({ system }: { system: SystemTelemetry }) {
  const [showSettings, setShowSettings] = useState(false);

  const indicators: [string, keyof SystemTelemetry][] = [
    ["GPS", "gps"],
    ["LINK", "link"],
    ["TELEMETRY", "telemetry"],
    ["SYSTEM", "system"],
  ];

  return (
    <header className="relative flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-panel px-3">
      <div className="flex h-10 w-[180px] items-center overflow-hidden">
        <img
          src="/potential-logo.png"
          alt="Potential Engineering Robotic Solutions"
          className="h-10 w-auto max-w-none object-contain mix-blend-screen"
        />
      </div>

      <div title="DRONE + SROTA rescue ground-control dashboard." className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-center">
        <h1 className="text-[19px] leading-none font-bold tracking-[0.1em]">
          DRONE <span className="text-drone">+</span>
          <span className="text-fasty"> SROTA</span>
        </h1>

        <div className="label-xs mt-1">
          Dual Vehicle Control &amp; Monitoring
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden items-center gap-3.5 xl:flex">
          {indicators.map(([label, key]) => (
            <div
              key={label}
              title={`${label} system indicator. Shows the current ${label.toLowerCase()} status.`}
              className="flex items-center gap-1.5"
            >
              <StatusDot state={system[key]} />
              <span className="label-xs text-foreground/80">{label}</span>
            </div>
          ))}
        </div>

        <div className="h-8 w-px bg-border" />

        <Clock />

        <button
          type="button"
          title="Open dashboard settings and console configuration."
          onClick={() => setShowSettings(true)}
          aria-label="Console configuration"
          className="flex size-8 items-center justify-center rounded-[3px] border border-border text-muted-foreground transition-colors hover:border-drone/50 hover:text-drone"
        >
          <Settings size={16} />
        </button>
      </div>

      {showSettings ? (
        <div className="absolute top-full right-3 z-30 mt-1 w-72 rounded-[3px] border border-border bg-popover p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="label-xs">Console Configuration</span>

            <button
              type="button"
              title="Close the console configuration panel."
              onClick={() => setShowSettings(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close configuration"
            >
              <X size={14} />
            </button>
          </div>

          <p title="Settings panel description: configuration options for telemetry, units, and link endpoints." className="text-[11px] leading-relaxed text-muted-foreground">
            Telemetry transport, units and link endpoints will be configurable
            here once real vehicle links are connected. No settings are active
            in this prototype.
          </p>
        </div>
      ) : null}
    </header>
  );
}