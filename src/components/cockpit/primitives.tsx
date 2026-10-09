import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { type LinkState, stateDot, stateColor } from "@/lib/telemetry";

export function StatusDot({
  state,
  className,
}: {
  state: LinkState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block size-[7px] rounded-full ring-2 ring-current/15",
        stateDot[state],
        stateColor[state],
        className,
      )}
    />
  );
}

export function SectionTitle({
  children,
  tone = "neutral",
  icon,
}: {
  children: ReactNode;
  tone?: "drone" | "fasty" | "neutral";
  icon?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 border-b px-2 py-1 label-xs",
        tone === "drone" && "border-drone/25 text-drone",
        tone === "fasty" && "border-fasty/25 text-fasty",
        tone === "neutral" && "border-border",
      )}
    >
      {icon}
      {children}
    </div>
  );
}

export function Row({
  label,
  value,
  valueClass,
  unit,
}: {
  label: string;
  value: ReactNode;
  valueClass?: string;
  unit?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-2 py-[3px] transition-colors hover:bg-accent/40">
      <span className="text-[11px] tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={cn("value-mono text-[12px] font-medium", valueClass)}>
        {value}
        {unit ? (
          <span className="ml-0.5 text-[10px] text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function Metric({
  label,
  value,
  unit,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  icon?: ReactNode;
  tone?: "drone" | "fasty" | "neutral";
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 transition-colors hover:bg-accent/40">
      {icon ? (
        <span
          className={cn(
            "shrink-0",
            tone === "drone" && "text-drone",
            tone === "fasty" && "text-fasty",
            tone === "neutral" && "text-muted-foreground",
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0">
        <div className="label-xs truncate">{label}</div>
        <div className="value-mono text-[15px] leading-tight font-semibold">
          {value}
          {unit ? (
            <span className="ml-1 text-[11px] text-muted-foreground">
              {unit}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function Bar({ pct, tone }: { pct: number; tone: "drone" | "fasty" }) {
  const color =
    pct < 20
      ? "bg-fault"
      : pct < 40
        ? "bg-warn"
        : tone === "drone"
          ? "bg-ok"
          : "bg-fasty";
  return (
    <div className="h-2 w-full rounded-[2px] bg-secondary ring-1 ring-border/60">
      <div
        className={cn(
          "h-full rounded-[2px] transition-[width] duration-700",
          color,
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Panel({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "drone" | "fasty" | "neutral";
  className?: string;
}) {
  return (
    <section
      className={cn(
        "panel-frame flex min-h-0 flex-col overflow-hidden",
        tone === "drone" && "border-drone/40",
        tone === "fasty" && "border-fasty/40",
        className,
      )}
    >
      {children}
    </section>
  );
}
