import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Download,
  Filter,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";

type VehicleId = "DRONE" | "FASTY";
type ParameterType = "INT" | "FLOAT" | "BOOL" | "TEXT";

type Parameter = {
  name: string;
  value: string;
  defaultValue: string;
  type: ParameterType;
  group: string;
  description: string;
  modified: boolean;
};

const initialParameters: Record<VehicleId, Parameter[]> = {
  DRONE: [
    {
      name: "ARMING_CHECK",
      value: "1",
      defaultValue: "1",
      type: "INT",
      group: "Safety",
      description: "Enable standard pre-arm safety checks.",
      modified: false,
    },
    {
      name: "RTL_ALT",
      value: "1500",
      defaultValue: "1500",
      type: "INT",
      group: "Safety",
      description: "Return-to-launch altitude in centimetres.",
      modified: false,
    },
    {
      name: "RTL_SPEED",
      value: "500",
      defaultValue: "500",
      type: "INT",
      group: "Navigation",
      description: "Return-to-launch horizontal speed.",
      modified: false,
    },
    {
      name: "WPNAV_SPEED",
      value: "500",
      defaultValue: "500",
      type: "INT",
      group: "Navigation",
      description: "Waypoint navigation speed.",
      modified: false,
    },
    {
      name: "EK3_ENABLE",
      value: "1",
      defaultValue: "1",
      type: "INT",
      group: "Navigation",
      description: "Enable the EKF3 estimator.",
      modified: false,
    },
    {
      name: "COMPASS_USE",
      value: "1",
      defaultValue: "1",
      type: "INT",
      group: "Sensors",
      description: "Enable compass use by the navigation stack.",
      modified: false,
    },
    {
      name: "BATT_MONITOR",
      value: "4",
      defaultValue: "4",
      type: "INT",
      group: "Power",
      description: "Battery monitor configuration.",
      modified: false,
    },
    {
      name: "SERIAL1_BAUD",
      value: "115",
      defaultValue: "115",
      type: "INT",
      group: "Communication",
      description: "Telemetry serial port baud selection.",
      modified: false,
    },
  ],
  FASTY: [
    {
      name: "ARMING_CHECK",
      value: "1",
      defaultValue: "1",
      type: "INT",
      group: "Safety",
      description: "Enable standard pre-arm safety checks.",
      modified: false,
    },
    {
      name: "FS_GCS_ENABLE",
      value: "0",
      defaultValue: "0",
      type: "INT",
      group: "Safety",
      description: "Ground-control-link failsafe behavior.",
      modified: false,
    },
    {
      name: "FS_BATT_ENABLE",
      value: "0",
      defaultValue: "0",
      type: "INT",
      group: "Safety",
      description: "Battery failsafe behavior. Battery monitor is currently not connected.",
      modified: false,
    },
    {
      name: "WP_SPEED",
      value: "2.0",
      defaultValue: "2.0",
      type: "FLOAT",
      group: "Navigation",
      description: "Surface navigation target speed in metres per second.",
      modified: false,
    },
    {
      name: "WP_RADIUS",
      value: "2.0",
      defaultValue: "2.0",
      type: "FLOAT",
      group: "Navigation",
      description: "Waypoint acceptance radius.",
      modified: false,
    },
    {
      name: "COMPASS_ENABLE",
      value: "1",
      defaultValue: "1",
      type: "INT",
      group: "Sensors",
      description: "Enable compass measurements for heading.",
      modified: false,
    },
    {
      name: "SERIAL_BAUD",
      value: "115",
      defaultValue: "115",
      type: "INT",
      group: "Communication",
      description: "Serial MAVLink transport speed used for the current setup.",
      modified: false,
    },
    {
      name: "RESCUE_AUTO",
      value: "0",
      defaultValue: "0",
      type: "BOOL",
      group: "Rescue",
      description: "Reserved for future verified-target autonomous rescue control.",
      modified: false,
    },
  ],
};

const typeClass: Record<ParameterType, string> = {
  INT: "text-cyan-300",
  FLOAT: "text-cyan-300",
  BOOL: "text-orange-300",
  TEXT: "text-muted-foreground",
};

export default function Parameters() {
  const [vehicle, setVehicle] = useState<VehicleId>("FASTY");
  const [parameters, setParameters] =
    useState<Record<VehicleId, Parameter[]>>(initialParameters);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("ALL");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const vehicleParameters = parameters[vehicle];

  const groups = useMemo(() => {
    return ["ALL", ...Array.from(new Set(vehicleParameters.map((item) => item.group)))];
  }, [vehicleParameters]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return vehicleParameters.filter((parameter) => {
      const matchesGroup = group === "ALL" || parameter.group === group;
      const matchesSearch =
        query.length === 0 ||
        parameter.name.toLowerCase().includes(query) ||
        parameter.description.toLowerCase().includes(query);

      return matchesGroup && matchesSearch;
    });
  }, [group, search, vehicleParameters]);

  const modifiedCount = vehicleParameters.filter((item) => item.modified).length;

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2200);
  };

  const beginEdit = (parameter: Parameter) => {
    setEditing(parameter.name);
    setDraft(parameter.value);
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft("");
  };

  const saveDraft = (name: string) => {
    setParameters((current) => ({
      ...current,
      [vehicle]: current[vehicle].map((parameter) =>
        parameter.name === name
          ? {
              ...parameter,
              value: draft,
              modified: draft !== parameter.defaultValue,
            }
          : parameter,
      ),
    }));

    setEditing(null);
    setDraft("");
    showNotice(`${name} staged locally — hardware write is not enabled`);
  };

  const resetParameter = (name: string) => {
    setParameters((current) => ({
      ...current,
      [vehicle]: current[vehicle].map((parameter) =>
        parameter.name === name
          ? {
              ...parameter,
              value: parameter.defaultValue,
              modified: false,
            }
          : parameter,
      ),
    }));
    showNotice(`${name} reset to default locally`);
  };

  const resetAll = () => {
    setParameters((current) => ({
      ...current,
      [vehicle]: current[vehicle].map((parameter) => ({
        ...parameter,
        value: parameter.defaultValue,
        modified: false,
      })),
    }));
    setEditing(null);
    showNotice("All staged changes reset locally");
  };

  const exportParameters = () => {
    const lines = ["vehicle,name,value,type,group"];
    vehicleParameters.forEach((parameter) => {
      lines.push(
        [
          vehicle,
          parameter.name,
          parameter.value,
          parameter.type,
          parameter.group,
        ]
          .map((value) => `"${value.replaceAll('"', '""')}"`)
          .join(","),
      );
    });

    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${vehicle.toLowerCase()}-parameters.csv`;
    anchor.click();
    URL.revokeObjectURL(url);

    showNotice("Parameter list exported");
  };

  return (
    <div className="flex min-h-full flex-col bg-[#071019] text-foreground">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-[#0a141e] px-3 py-2">
        <div className="mr-auto">
          <div className="text-[8px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
            ARDUPILOT PARAMETER MANAGER
          </div>
          <div className="mt-0.5 text-[11px] font-bold uppercase tracking-[0.06em]">
            {vehicle === "FASTY" ? "FASTY / SROTA" : "DRONE"}
          </div>
        </div>

        <div className="flex items-center gap-1 border border-border p-1">
          <button
            type="button"
            onClick={() => {
              setVehicle("DRONE");
              setGroup("ALL");
              setSearch("");
              cancelEdit();
            }}
            className={`px-3 py-1 text-[7px] font-bold uppercase tracking-[0.1em] ${
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
              setGroup("ALL");
              setSearch("");
              cancelEdit();
            }}
            className={`px-3 py-1 text-[7px] font-bold uppercase tracking-[0.1em] ${
              vehicle === "FASTY"
                ? "bg-orange-400/10 text-orange-300"
                : "text-muted-foreground hover:bg-white/5"
            }`}
          >
            FASTY
          </button>
        </div>

        <button
          type="button"
          onClick={() => showNotice("Parameter refresh requested")}
          className="flex items-center gap-1 border border-border px-2.5 py-1.5 text-[6px] font-bold uppercase tracking-[0.08em] text-muted-foreground hover:bg-white/5 hover:text-foreground"
        >
          <RefreshCw size={9} />
          Refresh
        </button>

        <button
          type="button"
          onClick={exportParameters}
          className="flex items-center gap-1 border border-border px-2.5 py-1.5 text-[6px] font-bold uppercase tracking-[0.08em] text-muted-foreground hover:bg-white/5 hover:text-foreground"
        >
          <Download size={9} />
          Export
        </button>
      </div>

      <div className="grid min-h-[560px] flex-1 xl:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-r border-border bg-[#09131c]">
          <div className="border-b border-border px-3 py-2 text-[6px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            PARAMETER GROUPS
          </div>

          {groups.map((item) => {
            const active = group === item;

            return (
              <button
                key={item}
                type="button"
                onClick={() => setGroup(item)}
                className={`flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-left ${
                  active
                    ? vehicle === "FASTY"
                      ? "border-l-2 border-l-orange-400 bg-orange-400/10 text-orange-200"
                      : "border-l-2 border-l-cyan-400 bg-cyan-400/10 text-cyan-200"
                    : "border-l-2 border-l-transparent text-muted-foreground hover:bg-white/5 hover:text-foreground"
                }`}
              >
                <SlidersHorizontal size={10} />
                <span className="text-[7px] font-bold uppercase tracking-[0.08em]">
                  {item}
                </span>
              </button>
            );
          })}

          <div className="border-t border-border px-3 py-3">
            <div className="text-[6px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              STAGED CHANGES
            </div>
            <div className="mt-1 value-mono text-[12px] font-bold text-yellow-300">
              {modifiedCount}
            </div>
          </div>
        </aside>

        <section className="min-w-0 p-3">
          <div className="mb-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_170px_auto]">
            <div className="flex items-center border border-border bg-[#09131c] px-2">
              <Search size={11} className="shrink-0 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="SEARCH PARAMETERS"
                className="w-full bg-transparent px-2 py-2 text-[8px] font-semibold uppercase tracking-[0.08em] text-foreground outline-none placeholder:text-muted-foreground"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X size={10} />
                </button>
              )}
            </div>

            <div className="flex items-center border border-border bg-[#09131c] px-2">
              <Filter size={10} className="text-muted-foreground" />
              <select
                value={group}
                onChange={(event) => setGroup(event.target.value)}
                className="w-full bg-transparent px-2 py-2 text-[8px] font-semibold uppercase tracking-[0.06em] text-foreground outline-none"
              >
                {groups.map((item) => (
                  <option key={item} value={item} className="bg-[#09131c]">
                    {item}
                  </option>
                ))}
              </select>
              <ChevronDown size={10} className="pointer-events-none text-muted-foreground" />
            </div>

            <button
              type="button"
              onClick={() => showNotice("Hardware parameter write is not enabled")}
              className="flex items-center justify-center gap-1 border border-yellow-400/30 bg-yellow-400/10 px-3 py-2 text-[7px] font-bold uppercase tracking-[0.08em] text-yellow-200 hover:bg-yellow-400/15"
            >
              <Check size={10} />
              Write {modifiedCount}
            </button>
          </div>

          <div className="overflow-hidden border border-border bg-[#09131c]">
            <div className="grid grid-cols-[minmax(160px,1.3fr)_110px_60px_95px_170px] border-b border-border bg-[#0b1722] px-3 py-2 text-[6px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
              <span>PARAMETER</span>
              <span>VALUE</span>
              <span>TYPE</span>
              <span>GROUP</span>
              <span>DESCRIPTION</span>
            </div>

            <div className="divide-y divide-border/70">
              {filtered.map((parameter) => {
                const isEditing = editing === parameter.name;

                return (
                  <div
                    key={parameter.name}
                    className={`grid grid-cols-[minmax(160px,1.3fr)_110px_60px_95px_170px] items-center px-3 py-2 ${
                      parameter.modified ? "bg-yellow-400/[0.035]" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[8px] font-bold uppercase tracking-[0.06em]">
                          {parameter.name}
                        </span>
                        {parameter.modified && (
                          <span className="shrink-0 border border-yellow-400/25 bg-yellow-400/10 px-1 py-0.5 text-[5px] font-bold uppercase text-yellow-300">
                            STAGED
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="pr-2">
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                saveDraft(parameter.name);
                              }
                              if (event.key === "Escape") {
                                cancelEdit();
                              }
                            }}
                            className="w-full border border-cyan-400/30 bg-black/20 px-2 py-1 text-[8px] font-bold text-cyan-200 outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => saveDraft(parameter.name)}
                            className="text-ok hover:text-foreground"
                            aria-label={`Save ${parameter.name}`}
                          >
                            <Check size={10} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => beginEdit(parameter)}
                          className={`value-mono w-full border border-transparent px-2 py-1 text-left text-[8px] font-bold hover:border-cyan-400/20 hover:bg-cyan-400/5 ${typeClass[parameter.type]}`}
                        >
                          {parameter.value}
                        </button>
                      )}
                    </div>

                    <span className={`text-[6px] font-bold ${typeClass[parameter.type]}`}>
                      {parameter.type}
                    </span>

                    <span className="truncate text-[6px] font-semibold uppercase text-muted-foreground">
                      {parameter.group}
                    </span>

                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[6px] leading-3 text-muted-foreground">
                        {parameter.description}
                      </span>

                      {parameter.modified && (
                        <button
                          type="button"
                          onClick={() => resetParameter(parameter.name)}
                          className="shrink-0 text-yellow-300/70 hover:text-yellow-200"
                          aria-label={`Reset ${parameter.name}`}
                        >
                          <RefreshCw size={9} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {filtered.length === 0 && (
              <div className="flex min-h-[180px] items-center justify-center text-[8px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                NO PARAMETERS MATCH CURRENT FILTER
              </div>
            )}
          </div>

          <div className="mt-3 border border-yellow-400/20 bg-yellow-400/5 p-3">
            <div className="flex items-start gap-2">
              <SlidersHorizontal size={12} className="mt-0.5 shrink-0 text-yellow-300" />
              <div className="min-w-0">
                <div className="text-[7px] font-bold uppercase tracking-[0.1em] text-yellow-200">
                  PARAMETER SERVICE STATUS
                </div>
                <p className="mt-1 text-[7px] leading-4 text-yellow-100/70">
                  Parameter values shown here are the dashboard&apos;s current local registry.
                  Editing only stages a local value. No MAVLink parameter write is issued yet.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-border bg-[#0a141e] px-3 py-2">
        <div className="flex items-center gap-2 text-[6px] uppercase tracking-[0.08em] text-muted-foreground">
          <span>VEHICLE</span>
          <span>/</span>
          <span>{vehicle}</span>
          <span>/</span>
          <span>{vehicleParameters.length} PARAMETERS</span>
          <span>/</span>
          <span>{modifiedCount} STAGED</span>
        </div>

        <div className="flex items-center gap-1.5">
          {notice && (
            <div className="mr-2 text-[6px] font-bold uppercase tracking-[0.08em] text-cyan-300">
              {notice}
            </div>
          )}

          <button
            type="button"
            onClick={resetAll}
            disabled={modifiedCount === 0}
            className="border border-border px-2.5 py-1.5 text-[6px] font-bold uppercase tracking-[0.08em] text-muted-foreground hover:bg-white/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reset Changes
          </button>

          <button
            type="button"
            onClick={() => showNotice("Write service not connected — no hardware changes made")}
            disabled={modifiedCount === 0}
            className="border border-orange-400/30 bg-orange-400/10 px-2.5 py-1.5 text-[6px] font-bold uppercase tracking-[0.08em] text-orange-200 hover:bg-orange-400/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Apply to Vehicle
          </button>
        </div>
      </div>
    </div>
  );
}
