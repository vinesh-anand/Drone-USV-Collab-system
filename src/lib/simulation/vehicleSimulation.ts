import {
  useSyncExternalStore,
} from "react";

import type {
  GeoCoordinate,
} from "@/lib/map/projection";

export interface SimulatedVehicleState {
  position: GeoCoordinate;
  heading: number;
  speedMps: number;
  active: boolean;
}

export interface VehicleSimulationState {
  origin: GeoCoordinate | null;
  drone: SimulatedVehicleState | null;
  fasty: SimulatedVehicleState | null;
}

const listeners = new Set<() => void>();

let state: VehicleSimulationState = {
  origin: null,
  drone: null,
  fasty: null,
};

let animationFrame: number | null = null;
let lastTimestamp = 0;

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function createPosition(
  origin: GeoCoordinate,
  vehicle: "DRONE" | "FASTY",
  timeSeconds: number,
): SimulatedVehicleState {
  /*
   * The simulator is geographically anchored to the GCS/simulation origin.
   * It does not use a fixed vehicle marker location.
   *
   * The movement below is deliberately smooth so the map behaves like it is
   * receiving a continuous GPS stream while no real vehicle GPS is available.
   */
  const latitudeScale =
    vehicle === "DRONE"
      ? 0.008
      : 0.005;

  const longitudeScale =
    vehicle === "DRONE"
      ? 0.012
      : 0.008;

  const angularSpeed =
    vehicle === "DRONE"
      ? 0.11
      : 0.075;

  const phase =
    vehicle === "DRONE"
      ? 0
      : Math.PI * 0.9;

  const angle =
    timeSeconds * angularSpeed +
    phase;

  const lat =
    origin.lat +
    Math.sin(angle) *
      latitudeScale;

  const lon =
    origin.lon +
    Math.cos(angle) *
      longitudeScale;

  const derivativeLat =
    Math.cos(angle) *
    latitudeScale *
    angularSpeed;

  const derivativeLon =
    -Math.sin(angle) *
    longitudeScale *
    angularSpeed;

  /*
   * Approximate heading from the direction of travel.
   */
  const heading =
    (
      Math.atan2(
        derivativeLon,
        derivativeLat,
      ) *
      180 /
      Math.PI +
      360
    ) % 360;

  const speedMps =
    vehicle === "DRONE"
      ? 6 + Math.sin(timeSeconds * 0.18) * 1.5
      : 2.5 +
        Math.sin(
          timeSeconds * 0.13,
        ) *
          0.5;

  return {
    position: {
      lat,
      lon,
    },
    heading,
    speedMps,
    active: true,
  };
}

function simulationStep(
  timestamp: number,
): void {
  if (!state.origin) {
    animationFrame = null;
    return;
  }

  if (lastTimestamp === 0) {
    lastTimestamp = timestamp;
  }

  const elapsedMs =
    timestamp - lastTimestamp;

  /*
   * Keep the simulation clock independent of render frequency.
   * The absolute elapsed time is derived from a monotonic RAF timestamp.
   */
  lastTimestamp = timestamp;

  const timeSeconds =
    timestamp / 1000;

  state = {
    origin: state.origin,
    drone: createPosition(
      state.origin,
      "DRONE",
      timeSeconds,
    ),
    fasty: createPosition(
      state.origin,
      "FASTY",
      timeSeconds,
    ),
  };

  void elapsedMs;
  emit();

  animationFrame =
    window.requestAnimationFrame(
      simulationStep,
    );
}

export function subscribeVehicleSimulation(
  listener: () => void,
): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getVehicleSimulationState(): VehicleSimulationState {
  return state;
}

export function useVehicleSimulation(): VehicleSimulationState {
  return useSyncExternalStore(
    subscribeVehicleSimulation,
    getVehicleSimulationState,
    getVehicleSimulationState,
  );
}

export function setVehicleSimulationOrigin(
  origin: GeoCoordinate | null,
): void {
  if (!origin) {
    state = {
      origin: null,
      drone: null,
      fasty: null,
    };

    lastTimestamp = 0;

    if (animationFrame !== null) {
      window.cancelAnimationFrame(
        animationFrame,
      );
      animationFrame = null;
    }

    emit();
    return;
  }

  const changed =
    state.origin === null ||
    Math.abs(
      state.origin.lat - origin.lat,
    ) > 0.000001 ||
    Math.abs(
      state.origin.lon - origin.lon,
    ) > 0.000001;

  if (!changed) {
    return;
  }

  state = {
    origin: {
      lat: origin.lat,
      lon: origin.lon,
    },
    drone: null,
    fasty: null,
  };

  lastTimestamp = 0;
  emit();

  if (animationFrame === null) {
    animationFrame =
      window.requestAnimationFrame(
        simulationStep,
      );
  }
}
