import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  ChevronUp,
  Circle,
  Crosshair,
  Flag,
  GripVertical,
  Home,
  Layers3,
  MapPin,
  Minus,
  Navigation,
  Plus,
  RotateCcw,
  Route,
  Search,
  Settings2,
  Trash2,
  Upload,
  Waypoints,
} from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MissionMap } from "@/components/cockpit/MissionMap";
import {
  useTelemetry,
} from "@/lib/telemetry";
import {
  addMissionItem as addMissionItemToStore,
  clearMission as clearMissionStore,
  missionTypeLabel,
  moveSelectedMissionItem,
  removeSelectedMissionItem,
  replaceMission,
  setMissionStatus,
  setSelectedId,
  setVehicle,
  updateSelectedMissionField,
  useMissionState,
  type MissionItem,
  type MissionItemType,
} from "@/lib/mission/missionStore";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function formatCoordinate(
  value: number | null,
): string {
  return value === null
    ? "N/A"
    : value.toFixed(6);
}

function isFiniteNumberOrNull(
  value: unknown,
): value is number | null {
  return (
    value === null ||
    (
      typeof value === "number" &&
      Number.isFinite(value)
    )
  );
}

/**
 * Type guard for imported mission items.
 *
 * Important:
 * `noPropertyAccessFromIndexSignature` is enabled in this project, so
 * dynamic objects are intentionally accessed with bracket notation.
 */
function isValidMissionItem(
  value: unknown,
): value is MissionItem {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const item =
    value as Record<string, unknown>;

  const type =
    item["type"];

  const id =
    item["id"];

  const label =
    item["label"];

  const latitude =
    item["latitude"];

  const longitude =
    item["longitude"];

  const altitude =
    item["altitude"];

  const speed =
    item["speed"];

  const hold =
    item["hold"];

  const validType =
    type === "TAKEOFF" ||
    type === "WAYPOINT" ||
    type === "LOITER" ||
    type === "LAND" ||
    type === "RTL" ||
    type === "FASTY_TARGET";

  return (
    Number.isInteger(id) &&
    (id as number) > 0 &&
    typeof label === "string" &&
    validType &&
    isFiniteNumberOrNull(latitude) &&
    isFiniteNumberOrNull(longitude) &&
    isFiniteNumberOrNull(altitude) &&
    isFiniteNumberOrNull(speed) &&
    isFiniteNumberOrNull(hold)
  );
}

function parseMissionPayload(
  payload: unknown,
): MissionItem[] | null {
  let candidate: unknown[] | null =
    null;

  if (Array.isArray(payload)) {
    candidate = payload;
  } else if (
    typeof payload === "object" &&
    payload !== null
  ) {
    const record =
      payload as Record<
        string,
        unknown
      >;

    const missionValue =
      record["mission"];

    if (
      Array.isArray(
        missionValue,
      )
    ) {
      candidate =
        missionValue;
    }
  }

  if (
    candidate === null ||
    candidate.length === 0
  ) {
    return null;
  }

  const ids =
    new Set<number>();

  for (
    const item of candidate
  ) {
    if (
      !isValidMissionItem(
        item,
      )
    ) {
      return null;
    }

    if (
      ids.has(item.id)
    ) {
      return null;
    }

    ids.add(item.id);
  }

  return candidate as MissionItem[];
}

function missionCoordinateValid(
  item: MissionItem,
): boolean {
  return (
    typeof item.latitude ===
      "number" &&
    Number.isFinite(
      item.latitude,
    ) &&
    item.latitude >= -90 &&
    item.latitude <= 90 &&
    typeof item.longitude ===
      "number" &&
    Number.isFinite(
      item.longitude,
    ) &&
    item.longitude >= -180 &&
    item.longitude <= 180
  );
}

function validateMission(
  mission: MissionItem[],
): string | null {
  if (
    mission.length < 2
  ) {
    return "Add at least one mission item after TAKEOFF.";
  }

  if (
    mission[0]?.type !==
    "TAKEOFF"
  ) {
    return "TAKEOFF must remain the first mission item.";
  }

  for (
    const item of mission
  ) {
    if (
      (
        item.type ===
          "WAYPOINT" ||
        item.type ===
          "LOITER" ||
        item.type ===
          "FASTY_TARGET"
      ) &&
      !missionCoordinateValid(
        item,
      )
    ) {
      return `${item.label} needs valid latitude and longitude.`;
    }

    if (
      item.type ===
        "WAYPOINT" &&
      (
        item.altitude ===
          null ||
        item.speed ===
          null
      )
    ) {
      return `${item.label} needs altitude and speed.`;
    }

    if (
      item.type ===
        "LOITER" &&
      item.hold === null
    ) {
      return `${item.label} needs a hold time.`;
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Mission item icons                                                         */
/* -------------------------------------------------------------------------- */

function missionTypeIcon(
  type: MissionItemType,
): ReactNode {
  switch (type) {
    case "TAKEOFF":
      return (
        <Navigation
          size={11}
        />
      );

    case "WAYPOINT":
      return (
        <MapPin size={11} />
      );

    case "LOITER":
      return (
        <Circle size={11} />
      );

    case "LAND":
      return (
        <ArrowDownToLine
          size={11}
        />
      );

    case "RTL":
      return (
        <Home size={11} />
      );

    case "FASTY_TARGET":
      return (
        <Crosshair
          size={11}
        />
      );

    default:
      return (
        <Waypoints
          size={11}
        />
      );
  }
}

/* -------------------------------------------------------------------------- */
/* Main component                                                             */
/* -------------------------------------------------------------------------- */

export default function MissionPlanner() {
  const {
    mission,
    selectedId,
    vehicle,
    status,
  } = useMissionState();

  const telemetry =
    useTelemetry();

  const [
    mapZoom,
    setMapZoom,
  ] = useState(14);

  const [
    mapMode,
    setMapMode,
  ] = useState<
    "SATELLITE" |
    "STREET" |
    "TERRAIN"
  >("STREET");

  const [
    showGrid,
    setShowGrid,
  ] = useState(true);

  const [
    showPath,
    setShowPath,
  ] = useState(true);

  const [
    showGeofence,
    setShowGeofence,
  ] = useState(true);

  const [
    mapPickMode,
    setMapPickMode,
  ] = useState(false);

  const [
    operationMessage,
    setOperationMessage,
  ] = useState("READY");

  const fileInputRef =
    useRef<HTMLInputElement | null>(
      null,
    );

  const selectedItem =
    useMemo(
      () =>
        mission.find(
          (item) =>
            item.id ===
            selectedId,
        ) ?? null,
      [
        mission,
        selectedId,
      ],
    );

  const missionError =
    useMemo(
      () =>
        validateMission(
          mission,
        ),
      [mission],
    );

  /* ---------------------------------------------------------------------- */
  /* Mission actions                                                        */
  /* ---------------------------------------------------------------------- */

  function addMissionItem(
    type: MissionItemType,
  ) {
    const id =
      addMissionItemToStore(
        type,
      );

    setOperationMessage(
      `${missionTypeLabel[type]} ${id} added.`,
    );
  }

  function removeSelectedItem() {
    if (!selectedItem) {
      return;
    }

    removeSelectedMissionItem();

    setOperationMessage(
      `${selectedItem.label} removed.`,
    );
  }

  function moveSelected(
    direction:
      | "UP"
      | "DOWN",
  ) {
    if (!selectedItem) {
      return;
    }

    moveSelectedMissionItem(
      direction,
    );

    setOperationMessage(
      `${selectedItem.label} moved ${direction.toLowerCase()}.`,
    );
  }

  function updateSelectedField<
    K extends keyof MissionItem,
  >(
    field: K,
    value: MissionItem[K],
  ) {
    updateSelectedMissionField(
      field,
      value,
    );
  }

  function clearMission() {
    clearMissionStore();

    setMapPickMode(
      false,
    );

    setOperationMessage(
      "Mission reset.",
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Map interaction                                                        */
  /* ---------------------------------------------------------------------- */

  function handleMapClick(
    coordinate: {
      lat: number;
      lon: number;
    },
  ) {
    if (!mapPickMode) {
      return;
    }

    if (!selectedItem) {
      setOperationMessage(
        "Select a mission item first.",
      );

      setMapPickMode(
        false,
      );

      return;
    }

    if (
      selectedItem.type ===
      "TAKEOFF"
    ) {
      setOperationMessage(
        "TAKEOFF position follows the vehicle launch position.",
      );

      setMapPickMode(
        false,
      );

      return;
    }

    updateSelectedField(
      "latitude",
      coordinate.lat,
    );

    updateSelectedField(
      "longitude",
      coordinate.lon,
    );

    setMapPickMode(
      false,
    );

    setOperationMessage(
      `${selectedItem.label} position updated from map.`,
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Vehicle position                                                        */
  /* ---------------------------------------------------------------------- */

  function readVehiclePosition() {
    if (!selectedItem) {
      setOperationMessage(
        "Select a mission item first.",
      );

      return;
    }

    const source =
      vehicle === "DRONE"
        ? telemetry.drone
        : telemetry.fasty;

    const latitude =
      source.lat.value;

    const longitude =
      source.lon.value;

    if (
      typeof latitude !==
        "number" ||
      !Number.isFinite(
        latitude,
      ) ||
      typeof longitude !==
        "number" ||
      !Number.isFinite(
        longitude,
      )
    ) {
      setOperationMessage(
        `${vehicle} has no valid GPS position.`,
      );

      return;
    }

    updateSelectedField(
      "latitude",
      latitude,
    );

    updateSelectedField(
      "longitude",
      longitude,
    );

    if (
      vehicle === "DRONE" &&
      selectedItem.type !==
        "LAND" &&
      selectedItem.type !==
        "RTL"
    ) {
      const altitude =
        telemetry.drone.altRel.value;

      if (
        typeof altitude ===
          "number" &&
        Number.isFinite(
          altitude,
        )
      ) {
        updateSelectedField(
          "altitude",
          altitude,
        );
      }
    }

    setOperationMessage(
      `${vehicle} position copied to ${selectedItem.label}.`,
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Mission file export                                                     */
  /* ---------------------------------------------------------------------- */

  function exportMission() {
    const payload = {
      version: 1,
      vehicle,
      mission,
      exportedAt:
        Date.now(),
    };

    const blob =
      new Blob(
        [
          JSON.stringify(
            payload,
            null,
            2,
          ),
        ],
        {
          type:
            "application/json",
        },
      );

    const url =
      URL.createObjectURL(
        blob,
      );

    const anchor =
      document.createElement(
        "a",
      );

    anchor.href = url;

    anchor.download =
      `mission-${vehicle.toLowerCase()}.json`;

    document.body.appendChild(
      anchor,
    );

    anchor.click();

    anchor.remove();

    URL.revokeObjectURL(
      url,
    );

    setOperationMessage(
      "Mission exported as JSON.",
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Mission file import                                                     */
  /* ---------------------------------------------------------------------- */

  async function importMissionFile(
    file: File,
  ) {
    try {
      const parsed =
        JSON.parse(
          await file.text(),
        ) as unknown;

      const importedMission =
        parseMissionPayload(
          parsed,
        );

      if (
        !importedMission
      ) {
        setOperationMessage(
          "Invalid mission JSON.",
        );

        return;
      }

      replaceMission(
        importedMission,
      );

      setOperationMessage(
        `Loaded ${importedMission.length} mission items.`,
      );
    } catch {
      setOperationMessage(
        "Failed to read mission file.",
      );
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Save mission                                                            */
  /* ---------------------------------------------------------------------- */

  function saveMission() {
    if (
      typeof window ===
      "undefined"
    ) {
      return;
    }

    try {
      window.localStorage.setItem(
        "drone-fasty-mission",
        JSON.stringify({
          version: 1,
          vehicle,
          mission,
          savedAt:
            Date.now(),
        }),
      );

      setMissionStatus(
        missionError ===
          null
          ? "READY"
          : "EDITING",
      );

      setOperationMessage(
        missionError ===
          null
          ? "Mission saved."
          : `Draft saved: ${missionError}`,
      );
    } catch {
      setOperationMessage(
        "Mission save failed.",
      );
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Vehicle upload handoff                                                  */
  /* ---------------------------------------------------------------------- */

  function requestVehicleUpload() {
    if (
      missionError !==
      null
    ) {
      setOperationMessage(
        missionError,
      );

      setMissionStatus(
        "EDITING",
      );

      return;
    }

    setMissionStatus(
      "READY",
    );

    window.dispatchEvent(
      new CustomEvent(
        "gcs:mission-upload-request",
        {
          detail: {
            vehicle,
            mission,
          },
        },
      ),
    );

    setOperationMessage(
      `${vehicle} mission prepared for MAVLink/SITL upload.`,
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#071019]">
      {/* ================================================================ */}
      {/* TOOLBAR                                                         */}
      {/* ================================================================ */}

      <div className="flex shrink-0 items-center justify-between border-b border-border bg-[#0b151f] px-3 py-2">
        <div className="flex items-center gap-1">
          <PlannerButton
            icon={
              <Plus size={11} />
            }
            label="Waypoint"
            onClick={() =>
              addMissionItem(
                "WAYPOINT",
              )
            }
          />

          <PlannerButton
            icon={
              <Circle size={11} />
            }
            label="Loiter"
            onClick={() =>
              addMissionItem(
                "LOITER",
              )
            }
          />

          <PlannerButton
            icon={
              <ArrowDownToLine
                size={11}
              />
            }
            label="Land"
            onClick={() =>
              addMissionItem(
                "LAND",
              )
            }
          />

          <PlannerButton
            icon={
              <Home size={11} />
            }
            label="RTL"
            onClick={() =>
              addMissionItem(
                "RTL",
              )
            }
          />

          <PlannerButton
            icon={
              <Crosshair
                size={11}
              />
            }
            label="FASTY Target"
            onClick={() =>
              addMissionItem(
                "FASTY_TARGET",
              )
            }
            accent="fasty"
          />
        </div>

        <div className="flex items-center gap-1">
          <PlannerButton
            icon={
              <RotateCcw
                size={11}
              />
            }
            label="Reset"
            onClick={
              clearMission
            }
          />

          <PlannerButton
            icon={
              <ArrowUpFromLine
                size={11}
              />
            }
            label="Upload"
            onClick={() =>
              fileInputRef.current?.click()
            }
          />

          <PlannerButton
            icon={
              <ArrowDownToLine
                size={11}
              />
            }
            label="Download"
            onClick={
              exportMission
            }
          />

          <input
            ref={
              fileInputRef
            }
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={async (
              event,
            ) => {
              const file =
                event.target
                  .files?.[0];

              event.target.value =
                "";

              if (!file) {
                return;
              }

              await importMissionFile(
                file,
              );
            }}
          />
        </div>
      </div>

      {/* ================================================================ */}
      {/* MAIN PLANNER                                                     */}
      {/* ================================================================ */}

      <div className="grid min-h-0 flex-1 grid-cols-[250px_minmax(0,1fr)_250px]">
        {/* ---------------------------------------------------------------- */}
        {/* LEFT — MISSION ITEM LIST                                        */}
        {/* ---------------------------------------------------------------- */}

        <aside className="flex min-h-0 flex-col border-r border-border">
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-[#0a141e] px-2">
            <div className="flex items-center gap-1.5">
              <Route
                size={11}
                className="text-cyan-300"
              />

              <span className="text-[8px] font-bold uppercase tracking-[0.12em]">
                Mission Items
              </span>
            </div>

            <span className="value-mono text-[8px] text-muted-foreground">
              {
                mission.length
              }
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {mission.map(
              (
                item,
                index,
              ) => {
                const selected =
                  item.id ===
                  selectedId;

                return (
                  <button
                    type="button"
                    key={
                      item.id
                    }
                    onClick={() =>
                      setSelectedId(
                        item.id,
                      )
                    }
                    className={`flex w-full items-center gap-2 border-b border-border px-2 py-2 text-left transition ${
                      selected
                        ? "bg-cyan-400/10 text-cyan-300"
                        : "bg-transparent text-foreground hover:bg-white/5"
                    }`}
                  >
                    <div
                      className={`flex size-6 shrink-0 items-center justify-center border ${
                        selected
                          ? "border-cyan-400/30 bg-cyan-400/10"
                          : "border-border bg-background/30"
                      }`}
                    >
                      {
                        missionTypeIcon(
                          item.type,
                        )
                      }
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="value-mono text-[7px] text-muted-foreground">
                          {index +
                            1}
                        </span>

                        <span className="truncate text-[8px] font-bold uppercase">
                          {
                            item.label
                          }
                        </span>
                      </div>

                      <div className="mt-0.5 truncate text-[6px] uppercase tracking-[0.08em] text-muted-foreground">
                        {
                          missionTypeLabel[
                            item.type
                          ]
                        }
                      </div>
                    </div>

                    {selected && (
                      <GripVertical
                        size={10}
                        className="shrink-0 text-cyan-400/50"
                      />
                    )}
                  </button>
                );
              },
            )}
          </div>

          {/* Item controls */}
          <div className="grid shrink-0 grid-cols-4 gap-1 border-t border-border bg-[#0a141e] p-1">
            <SmallButton
              icon={
                <ChevronUp
                  size={10}
                />
              }
              label="Up"
              onClick={() =>
                moveSelected(
                  "UP",
                )
              }
            />

            <SmallButton
              icon={
                <ChevronDown
                  size={10}
                />
              }
              label="Down"
              onClick={() =>
                moveSelected(
                  "DOWN",
                )
              }
            />

            <SmallButton
              icon={
                <Trash2 size={10} />
              }
              label="Delete"
              onClick={
                removeSelectedItem
              }
              danger
            />

            <SmallButton
              icon={
                <Settings2
                  size={10}
                />
              }
              label="Edit"
              onClick={() => {
                if (
                  selectedItem
                ) {
                  setOperationMessage(
                    `${selectedItem.label} selected for editing.`,
                  );
                }
              }}
            />
          </div>
        </aside>

        {/* ---------------------------------------------------------------- */}
        {/* CENTER — LIVE MISSION MAP                                       */}
        {/* ---------------------------------------------------------------- */}

        <section className="relative min-h-0 overflow-hidden bg-[#09131b]">
          <MissionMap
            drone={
              telemetry.drone
            }
            fasty={
              telemetry.fasty
            }
            onMapClick={
              handleMapClick
            }
            className="absolute inset-0 h-full w-full"
          />

          {mapPickMode && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-50 -translate-x-1/2 border border-cyan-400/40 bg-[#071019]/95 px-3 py-1.5 text-[7px] font-bold uppercase tracking-[0.1em] text-cyan-300">
              MAP PICK ACTIVE · CLICK LOCATION
            </div>
          )}
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* RIGHT — ITEM PROPERTIES                                         */}
        {/* ---------------------------------------------------------------- */}

        <aside className="flex min-h-0 flex-col border-l border-border">
          <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border bg-[#0a141e] px-2">
            <Settings2
              size={11}
              className="text-cyan-300"
            />

            <span className="text-[8px] font-bold uppercase tracking-[0.12em]">
              Item Properties
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-2">
            {selectedItem ? (
              <div className="space-y-2">
                <PropertyHeader
                  type={
                    selectedItem.type
                  }
                  index={
                    mission.findIndex(
                      (item) =>
                        item.id ===
                        selectedItem.id,
                    ) + 1
                  }
                />

                <PropertyField
                  label="Label"
                  value={
                    selectedItem.label
                  }
                  onChange={(
                    value,
                  ) =>
                    updateSelectedField(
                      "label",
                      value,
                    )
                  }
                />

                <PropertyField
                  label="Latitude"
                  value={formatCoordinate(
                    selectedItem.latitude,
                  )}
                  placeholder="Enter latitude"
                  disabled={
                    selectedItem.type ===
                    "TAKEOFF"
                  }
                  onChange={(
                    value,
                  ) => {
                    const parsed =
                      Number(
                        value,
                      );

                    updateSelectedField(
                      "latitude",
                      Number.isFinite(
                        parsed,
                      )
                        ? parsed
                        : null,
                    );
                  }}
                />

                <PropertyField
                  label="Longitude"
                  value={formatCoordinate(
                    selectedItem.longitude,
                  )}
                  placeholder="Enter longitude"
                  disabled={
                    selectedItem.type ===
                    "TAKEOFF"
                  }
                  onChange={(
                    value,
                  ) => {
                    const parsed =
                      Number(
                        value,
                      );

                    updateSelectedField(
                      "longitude",
                      Number.isFinite(
                        parsed,
                      )
                        ? parsed
                        : null,
                    );
                  }}
                />

                <PropertyField
                  label="Altitude"
                  value={
                    selectedItem.altitude ===
                    null
                      ? ""
                      : String(
                          selectedItem.altitude,
                        )
                  }
                  placeholder="Meters"
                  disabled={
                    selectedItem.type ===
                      "LAND" ||
                    selectedItem.type ===
                      "RTL"
                  }
                  onChange={(
                    value,
                  ) => {
                    const parsed =
                      Number(
                        value,
                      );

                    updateSelectedField(
                      "altitude",
                      Number.isFinite(
                        parsed,
                      )
                        ? parsed
                        : null,
                    );
                  }}
                />

                <PropertyField
                  label="Speed"
                  value={
                    selectedItem.speed ===
                    null
                      ? ""
                      : String(
                          selectedItem.speed,
                        )
                  }
                  placeholder="m/s"
                  disabled={
                    selectedItem.type !==
                    "WAYPOINT"
                  }
                  onChange={(
                    value,
                  ) => {
                    const parsed =
                      Number(
                        value,
                      );

                    updateSelectedField(
                      "speed",
                      Number.isFinite(
                        parsed,
                      )
                        ? parsed
                        : null,
                    );
                  }}
                />

                <PropertyField
                  label="Hold"
                  value={
                    selectedItem.hold ===
                    null
                      ? ""
                      : String(
                          selectedItem.hold,
                        )
                  }
                  placeholder="Seconds"
                  disabled={
                    selectedItem.type !==
                    "LOITER"
                  }
                  onChange={(
                    value,
                  ) => {
                    const parsed =
                      Number(
                        value,
                      );

                    updateSelectedField(
                      "hold",
                      Number.isFinite(
                        parsed,
                      )
                        ? parsed
                        : null,
                    );
                  }}
                />

                {selectedItem.type ===
                  "FASTY_TARGET" && (
                  <div className="border border-fault/25 bg-fault/5 p-2">
                    <div className="flex items-center gap-1.5 text-[7px] font-bold uppercase tracking-[0.1em] text-fault">
                      <Crosshair
                        size={10}
                      />

                      Rescue Target
                    </div>

                    <div className="mt-1 text-[6px] uppercase leading-relaxed tracking-[0.06em] text-muted-foreground">
                      Target coordinates can be entered manually, picked from the map, or populated from a live vehicle position.
                    </div>
                  </div>
                )}

                <div className="border border-border bg-background/30 p-2">
                  <div className="text-[6px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                    Mission Command
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          selectedItem.type ===
                          "TAKEOFF"
                        ) {
                          setOperationMessage(
                            "TAKEOFF position cannot be set manually.",
                          );

                          return;
                        }

                        setMapPickMode(
                          true,
                        );

                        setOperationMessage(
                          "MAP PICK ACTIVE — click a location on the map.",
                        );
                      }}
                      className={`border px-2 py-1.5 text-[6px] font-bold uppercase tracking-[0.08em] transition ${
                        mapPickMode
                          ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-300"
                          : "border-border text-muted-foreground hover:border-cyan-400/30 hover:bg-cyan-400/5 hover:text-foreground"
                      }`}
                    >
                      {mapPickMode
                        ? "Pick on map"
                        : "Set from map"}
                    </button>

                    <button
                      type="button"
                      onClick={
                        readVehiclePosition
                      }
                      className="border border-border px-2 py-1.5 text-[6px] font-bold uppercase tracking-[0.08em] text-muted-foreground transition hover:border-cyan-400/30 hover:bg-cyan-400/5 hover:text-foreground"
                    >
                      Read vehicle
                    </button>
                  </div>

                  <div className="mt-2 border-t border-border pt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[6px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        Planner Vehicle
                      </span>

                      <span className="value-mono text-[6px] font-bold uppercase text-cyan-300">
                        {
                          vehicle
                        }
                      </span>
                    </div>

                    <div className="mt-1 grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setVehicle(
                            "DRONE",
                          );

                          setOperationMessage(
                            "Mission vehicle set to DRONE.",
                          );
                        }}
                        className={`border px-2 py-1 text-[6px] font-bold uppercase tracking-[0.08em] transition ${
                          vehicle ===
                          "DRONE"
                            ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-300"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        DRONE
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setVehicle(
                            "FASTY",
                          );

                          setOperationMessage(
                            "Mission vehicle set to FASTY.",
                          );
                        }}
                        className={`border px-2 py-1 text-[6px] font-bold uppercase tracking-[0.08em] transition ${
                          vehicle ===
                          "FASTY"
                            ? "border-fasty/30 bg-fasty/10 text-fasty"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        FASTY
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 border-t border-border pt-2">
                    <div className="text-[6px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      Validation
                    </div>

                    <div
                      className={`mt-1 text-[6px] uppercase leading-relaxed ${
                        missionError ===
                        null
                          ? "text-cyan-300"
                          : "text-fault"
                      }`}
                    >
                      {missionError ??
                        "Mission is valid and ready."}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[200px] items-center justify-center text-center">
                <div>
                  <Waypoints
                    size={20}
                    className="mx-auto text-muted-foreground/50"
                  />

                  <div className="mt-3 text-[8px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    No mission item selected
                  </div>

                  <div className="mt-1 text-[6px] uppercase tracking-[0.08em] text-muted-foreground/70">
                    Select an item from the list
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ================================================================ */}
      {/* FOOTER                                                           */}
      {/* ================================================================ */}

      <div className="flex shrink-0 items-center justify-between border-t border-border bg-[#0b151f] px-3 py-2">
        <div className="flex items-center gap-4">
          <StatusReadout
            label="MISSION"
            value={
              status
            }
          />

          <StatusReadout
            label="VEHICLE"
            value={
              vehicle ===
              "DRONE"
                ? `DRONE · ${telemetry.drone.link}`
                : `FASTY · ${telemetry.fasty.link}`
            }
          />

          <StatusReadout
            label="UPLOAD"
            value={
              missionError ===
              null
                ? "READY"
                : "BLOCKED"
            }
          />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={
              saveMission
            }
            className="flex items-center gap-1.5 border border-border bg-background/40 px-3 py-1.5 text-[7px] font-bold uppercase tracking-[0.1em] text-muted-foreground transition hover:border-cyan-400/30 hover:bg-cyan-400/5 hover:text-foreground"
          >
            <Upload size={10} />

            Save Mission
          </button>

          <button
            type="button"
            onClick={
              requestVehicleUpload
            }
            className="flex items-center gap-1.5 border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[7px] font-bold uppercase tracking-[0.1em] text-cyan-300 transition hover:bg-cyan-400/15"
          >
            <ArrowUpFromLine
              size={10}
            />

            Upload to Vehicle
          </button>
        </div>
      </div>

      <div className="shrink-0 border-t border-border px-3 py-1 text-[6px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {operationMessage}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Reusable controls                                                          */
/* -------------------------------------------------------------------------- */

function PlannerButton({
  icon,
  label,
  onClick,
  accent = "default",
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  accent?: "default" | "fasty";
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className={`flex items-center gap-1.5 border px-2 py-1.5 text-[6px] font-bold uppercase tracking-[0.08em] transition ${
        accent ===
        "fasty"
          ? "border-fasty/30 bg-fasty/5 text-fasty hover:bg-fasty/10"
          : "border-border bg-background/30 text-muted-foreground hover:border-cyan-400/30 hover:bg-cyan-400/5 hover:text-foreground"
      }`}
    >
      {icon}

      <span>
        {label}
      </span>
    </button>
  );
}

function SmallButton({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className={`flex flex-col items-center justify-center gap-0.5 border px-1 py-1.5 transition ${
        danger
          ? "border-fault/20 text-fault/70 hover:bg-fault/5"
          : "border-border text-muted-foreground hover:border-cyan-400/30 hover:bg-cyan-400/5 hover:text-foreground"
      }`}
    >
      {icon}

      <span className="text-[5px] font-bold uppercase tracking-[0.06em]">
        {label}
      </span>
    </button>
  );
}

function MapLayerButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className={`px-1.5 py-1 text-[5px] font-bold uppercase tracking-[0.08em] ${
        active
          ? "bg-cyan-400/10 text-cyan-300"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function MapControlButton({
  icon,
  onClick,
}: {
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className="flex size-7 items-center justify-center border border-border bg-[#071019]/90 text-muted-foreground transition hover:border-cyan-400/30 hover:bg-cyan-400/5 hover:text-cyan-300"
    >
      {icon}
    </button>
  );
}

function MapToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className={`border px-2 py-1 text-[5px] font-bold uppercase tracking-[0.08em] transition ${
        active
          ? "border-cyan-400/25 bg-cyan-400/10 text-cyan-300"
          : "border-border text-muted-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function StatusReadout({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
        {label}
      </span>

      <span className="value-mono text-[7px] font-bold uppercase text-foreground">
        {value}
      </span>
    </div>
  );
}

function PropertyHeader({
  type,
  index,
}: {
  type: MissionItemType;
  index: number;
}) {
  return (
    <div className="flex items-center gap-2 border border-border bg-background/30 p-2">
      <div className="flex size-7 items-center justify-center border border-cyan-400/20 bg-cyan-400/5 text-cyan-300">
        {missionTypeIcon(
          type,
        )}
      </div>

      <div className="min-w-0">
        <div className="text-[7px] font-bold uppercase tracking-[0.1em] text-cyan-300">
          ITEM {index}
        </div>

        <div className="mt-0.5 truncate text-[8px] font-bold uppercase">
          {
            missionTypeLabel[
              type
            ]
          }
        </div>
      </div>
    </div>
  );
}

function PropertyField({
  label,
  value,
  placeholder,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (
    value: string,
  ) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[6px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>

      <input
        value={
          value
        }
        placeholder={
          placeholder
        }
        disabled={
          disabled
        }
        onChange={(
          event,
        ) =>
          onChange(
            event.target
              .value,
          )
        }
        className="value-mono w-full border border-border bg-background/40 px-2 py-1.5 text-[8px] font-semibold text-foreground outline-none transition placeholder:text-muted-foreground/50 focus:border-cyan-400/30 disabled:cursor-not-allowed disabled:opacity-40"
      />
    </label>
  );
}