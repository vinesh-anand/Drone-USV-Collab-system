/**
 * Shared live USB camera access for the cockpit video feeds.
 *
 * IMPORTANT:
 * - A physical camera device is opened at most once per deviceId.
 * - Multiple React consumers receive the SAME MediaStream instance.
 * - This allows VideoFeed and DronePanel to display the same camera without
 *   opening the USB camera twice.
 * - Camera access is browser-only: call from effects / event handlers,
 *   never during render.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type CameraState =
  | "IDLE"
  | "REQUESTING"
  | "LIVE"
  | "DENIED"
  | "NOT_FOUND"
  | "ERROR"
  | "UNSUPPORTED";

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export interface CameraStreamInfo {
  width: number;
  height: number;
  fps: number;
}

export interface CameraStream {
  state: CameraState;
  error: string | null;
  stream: MediaStream | null;
  /** Actual negotiated settings, once live. */
  info: CameraStreamInfo | null;
  start: (deviceId?: string) => Promise<void>;
  stop: () => void;
}

/* -------------------------------------------------------------------------- */
/* Camera device enumeration                                                  */
/* -------------------------------------------------------------------------- */

export function useCameraDevices() {
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [supported, setSupported] = useState(true);

  const refresh = useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.enumerateDevices
    ) {
      setSupported(false);
      return;
    }

    try {
      const list = await navigator.mediaDevices.enumerateDevices();

      setDevices(
        list
          .filter((device) => device.kind === "videoinput")
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `Camera ${index + 1}`,
          })),
      );

      setSupported(true);
    } catch {
      setSupported(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices
    ) {
      return;
    }

    const handler = () => {
      void refresh();
    };

    navigator.mediaDevices.addEventListener(
      "devicechange",
      handler,
    );

    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handler,
      );
    };
  }, [refresh]);

  return { devices, supported, refresh };
}

/* -------------------------------------------------------------------------- */
/* Shared stream registry                                                     */
/* -------------------------------------------------------------------------- */

interface SharedCameraEntry {
  deviceId: string;
  stream: MediaStream | null;
  info: CameraStreamInfo | null;
  state: CameraState;
  error: string | null;
  consumers: number;
  opening: Promise<MediaStream | null> | null;
  generation: number;
}

const sharedCameras = new Map<string, SharedCameraEntry>();

function getEntry(deviceId: string): SharedCameraEntry {
  const existing = sharedCameras.get(deviceId);

  if (existing) {
    return existing;
  }

  const entry: SharedCameraEntry = {
    deviceId,
    stream: null,
    info: null,
    state: "IDLE",
    error: null,
    consumers: 0,
    opening: null,
    generation: 0,
  };

  sharedCameras.set(deviceId, entry);

  return entry;
}

function getTrackInfo(
  stream: MediaStream,
): CameraStreamInfo {
  const settings =
    stream.getVideoTracks()[0]?.getSettings();

  return {
    width: settings?.width ?? 0,
    height: settings?.height ?? 0,
    fps: Math.round(settings?.frameRate ?? 0),
  };
}

function stopEntry(entry: SharedCameraEntry) {
  entry.generation += 1;

  entry.stream
    ?.getTracks()
    .forEach((track) => track.stop());

  entry.stream = null;
  entry.info = null;
  entry.opening = null;
  entry.state = "IDLE";
  entry.error = null;
}

async function openSharedCamera(
  entry: SharedCameraEntry,
): Promise<MediaStream | null> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    entry.state = "UNSUPPORTED";
    entry.error =
      "Camera API unavailable in this browser context";
    return null;
  }

  if (
    entry.stream &&
    entry.stream.active &&
    entry.stream.getVideoTracks().length > 0
  ) {
    entry.state = "LIVE";
    return entry.stream;
  }

  if (entry.opening) {
    return entry.opening;
  }

  const generation = ++entry.generation;
  entry.state = "REQUESTING";
  entry.error = null;

  entry.opening = navigator.mediaDevices
    .getUserMedia({
      video: {
        deviceId: {
          exact: entry.deviceId,
        },
        width: {
          ideal: 1920,
        },
        height: {
          ideal: 1080,
        },
        frameRate: {
          ideal: 30,
          max: 30,
        },
      },
      audio: false,
    })
    .then((media) => {
      /*
       * A newer request may have replaced this one. Stop the late stream
       * instead of allowing duplicate/stale camera ownership.
       */
      if (generation !== entry.generation) {
        media
          .getTracks()
          .forEach((track) => track.stop());

        return null;
      }

      /*
       * If another stream somehow appeared while this request was pending,
       * keep the first active shared stream and discard the duplicate.
       */
      if (
        entry.stream &&
        entry.stream !== media &&
        entry.stream.active
      ) {
        media
          .getTracks()
          .forEach((track) => track.stop());

        return entry.stream;
      }

      entry.stream = media;
      entry.info = getTrackInfo(media);
      entry.state = "LIVE";
      entry.error = null;

      const videoTrack = media.getVideoTracks()[0];

      if (videoTrack) {
        videoTrack.onended = () => {
          if (entry.stream !== media) {
            return;
          }

          entry.stream = null;
          entry.info = null;
          entry.state = "IDLE";
          entry.error = "Camera track ended";
          entry.opening = null;

          /*
           * The entry stays registered while consumers are present so an
           * existing hook can retry/open the same device.
           */
        };

        videoTrack.onmute = () => {
          /*
           * A muted track is not necessarily disconnected, so don't mark
           * the camera offline here.
           */
        };

        videoTrack.onunmute = () => {
          entry.state = "LIVE";
        };
      }

      return media;
    })
    .catch((error: unknown) => {
      if (generation !== entry.generation) {
        return null;
      }

      const name =
        error instanceof DOMException
          ? error.name
          : undefined;

      entry.stream = null;
      entry.info = null;
      entry.state =
        name === "NotAllowedError"
          ? "DENIED"
          : name === "NotFoundError" ||
              name === "OverconstrainedError"
            ? "NOT_FOUND"
            : "ERROR";

      entry.error =
        error instanceof Error
          ? error.message
          : "Camera error";

      return null;
    })
    .finally(() => {
      if (generation === entry.generation) {
        entry.opening = null;
      }
    });

  return entry.opening;
}

/* -------------------------------------------------------------------------- */
/* Preferred/shared camera hook                                               */
/* -------------------------------------------------------------------------- */

export interface SharedCameraStream extends CameraStream {
  /** Device currently owned by this shared camera consumer. */
  deviceId: string | null;
}

/**
 * Shared camera hook.
 *
 * Calling this hook from two components with the same deviceId gives both
 * components the exact same MediaStream object. Only the first consumer
 * triggers getUserMedia(); later consumers reuse it.
 */
export function useCameraStream(
  deviceId: string | null,
  enabled: boolean,
): CameraStream {
  const [state, setState] =
    useState<CameraState>("IDLE");
  const [error, setError] =
    useState<string | null>(null);
  const [stream, setStream] =
    useState<MediaStream | null>(null);
  const [info, setInfo] =
    useState<CameraStreamInfo | null>(null);

  const entryRef =
    useRef<SharedCameraEntry | null>(null);

  const syncFromEntry = useCallback(
    (entry: SharedCameraEntry) => {
      setState(entry.state);
      setError(entry.error);
      setStream(entry.stream);
      setInfo(entry.info);
    },
    [],
  );

  const stop = useCallback(() => {
    const entry = entryRef.current;

    if (!entry) {
      setStream(null);
      setInfo(null);
      setError(null);
      setState("IDLE");
      return;
    }

    entry.consumers = Math.max(
      0,
      entry.consumers - 1,
    );

    /*
     * Do not kill a stream while another component is using it.
     * Once the final consumer releases it, stop the physical camera.
     */
    if (entry.consumers === 0) {
      stopEntry(entry);

      /*
       * Delete the empty registry entry so a later connection starts clean.
       */
      sharedCameras.delete(entry.deviceId);
    }

    entryRef.current = null;

    setStream(null);
    setInfo(null);
    setError(null);
    setState("IDLE");
  }, []);

  const start = useCallback(
    async (requestedDeviceId?: string) => {
      const targetId =
        requestedDeviceId ?? deviceId;

      if (!targetId) {
        setState("NOT_FOUND");
        setError("No camera device selected");
        return;
      }

      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        setState("UNSUPPORTED");
        setError(
          "Camera API unavailable in this browser context",
        );
        return;
      }

      /*
       * If this hook was previously attached to another device, release it
       * before switching.
       */
      if (
        entryRef.current &&
        entryRef.current.deviceId !== targetId
      ) {
        stop();
      }

      const entry = getEntry(targetId);

      if (
        entryRef.current !== entry
      ) {
        entry.consumers += 1;
        entryRef.current = entry;
      }

      syncFromEntry(entry);

      const media =
        await openSharedCamera(entry);

      syncFromEntry(entry);

      /*
       * The stream is shared. All consumers receive the exact same object.
       */
      if (media) {
        setStream(media);
        setInfo(entry.info);
        setState("LIVE");
      }
    },
    [deviceId, stop, syncFromEntry],
  );

  useEffect(() => {
    if (!enabled || !deviceId) {
      return;
    }

    void start(deviceId);

    return () => {
      /*
       * Releasing one consumer must not stop a stream that another consumer
       * is currently using.
       */
      const entry = entryRef.current;

      if (!entry) {
        return;
      }

      entry.consumers = Math.max(
        0,
        entry.consumers - 1,
      );

      if (entry.consumers === 0) {
        stopEntry(entry);
        sharedCameras.delete(entry.deviceId);
      }

      entryRef.current = null;
    };
  }, [deviceId, enabled, start]);

  /*
   * Shared registry does not use an event emitter. Polling at a modest rate
   * keeps hook state synchronized when another component starts/retries or a
   * shared track ends.
   */
  useEffect(() => {
    if (!enabled || !deviceId) {
      return;
    }

    const interval = window.setInterval(() => {
      const entry =
        sharedCameras.get(deviceId);

      if (!entry) {
        return;
      }

      syncFromEntry(entry);
    }, 250);

    return () => {
      window.clearInterval(interval);
    };
  }, [deviceId, enabled, syncFromEntry]);

  return {
    state,
    error,
    stream,
    info,
    start,
    stop,
  };
}

/**
 * Convenience hook for components that want to consume the currently active
 * shared camera without owning a separate device selection UI.
 *
 * The first camera currently used by a VideoFeed/other consumer can be made
 * discoverable through setActiveCameraDeviceId().
 */
let activeCameraDeviceId: string | null = null;
const activeCameraListeners = new Set<
  (deviceId: string | null) => void
>();

export function setActiveCameraDeviceId(
  deviceId: string | null,
) {
  activeCameraDeviceId = deviceId;

  activeCameraListeners.forEach(
    (listener) => listener(deviceId),
  );
}

export function getActiveCameraDeviceId() {
  return activeCameraDeviceId;
}

export function useActiveCameraDeviceId() {
  const [deviceId, setDeviceId] =
    useState<string | null>(
      activeCameraDeviceId,
    );

  useEffect(() => {
    const listener = (
      nextDeviceId: string | null,
    ) => {
      setDeviceId(nextDeviceId);
    };

    activeCameraListeners.add(listener);

    return () => {
      activeCameraListeners.delete(listener);
    };
  }, []);

  return deviceId;
}

/**
 * Shared active-camera consumer. This is the hook DronePanel can use later
 * so it attaches to the same stream selected by VideoFeed.
 */
export function useActiveCameraStream(
  enabled: boolean,
): SharedCameraStream {
  const deviceId =
    useActiveCameraDeviceId();

  const camera = useCameraStream(
    deviceId,
    enabled && !!deviceId,
  );

  return {
    ...camera,
    deviceId,
  };
}
