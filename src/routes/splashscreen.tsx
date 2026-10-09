import { createFileRoute } from "@tanstack/react-router";
import { LoaderCircle, Radio, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/splashscreen")({
  component: SplashscreenPage,
});

function SplashscreenPage() {
  return (
    <main className="flex h-screen w-screen items-center justify-center bg-[#0b0f14] text-slate-200">
      <section className="flex w-[520px] max-w-[90vw] flex-col items-center rounded-2xl border border-slate-700/70 bg-[#121821] px-10 py-9 shadow-2xl">
        {/* Brand */}
        <div className="mb-7 flex flex-col items-center">
          <div className="mb-3 flex items-center gap-2 text-2xl font-bold tracking-[0.16em]">
            <span className="text-slate-100">DRONE</span>
            <span className="text-orange-400">+</span>
            <span className="text-slate-100">SROTA</span>
          </div>

          <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500">
            Potential Robotic Solutions
          </div>
        </div>

        {/* Status icon */}
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/5">
          <LoaderCircle className="h-8 w-8 animate-spin text-cyan-400" />
        </div>

        {/* Main status */}
        <h1 className="text-center text-lg font-semibold tracking-wide text-slate-100">
          Starting Drone-OS
        </h1>

        <p className="mt-2 text-center text-sm text-slate-400">
          Initializing Ground Control Station
        </p>

        {/* Connection indicators */}
        <div className="mt-8 grid w-full grid-cols-3 gap-3">
          <StatusItem
            icon={<Radio className="h-4 w-4" />}
            label="ROS"
          />

          <StatusItem
            icon={<ShieldCheck className="h-4 w-4" />}
            label="DRONE"
          />

          <StatusItem
            icon={<Radio className="h-4 w-4" />}
            label="SROTA"
          />
        </div>

        {/* Loading indicator */}
        <div className="mt-7 h-1 w-full overflow-hidden rounded-full bg-slate-800">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-cyan-400" />
        </div>

        <p className="mt-5 text-[11px] uppercase tracking-[0.18em] text-slate-600">
          Please wait...
        </p>
      </section>
    </main>
  );
}

type StatusItemProps = {
  icon: React.ReactNode;
  label: string;
};

function StatusItem({ icon, label }: StatusItemProps) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-3">
      <span className="text-slate-500">{icon}</span>
      <span className="text-[10px] font-semibold tracking-[0.12em] text-slate-500">
        {label}
      </span>
    </div>
  );
}

