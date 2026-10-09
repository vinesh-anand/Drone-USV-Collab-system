import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Maximize2,
  Minimize2,
  Plug,
  RefreshCw,
  VideoOff,
  ScanSearch,
  BrainCircuit,
} from "lucide-react";
import camDrone from "@/assets/cam-drone.jpg";
import camFasty from "@/assets/cam-fasty.jpg";
import { cn } from "@/lib/utils";
import { Panel } from "./primitives";
import {
  useCameraDevices,
  useCameraStream,
  setActiveCameraDeviceId,
  type CameraState,
  type CameraDevice,
} from "@/lib/cameras";

type Mode = "SPLIT VIEW" | "PIP" | "FULLSCREEN";

type FeedId = "drone" | "fasty";

interface Feed {
  id: FeedId;
  title: string;
  fallback: string;
  tone: "drone" | "fasty";
  detectionView?: boolean;
}

const feeds: Feed[] = [
  {
    id: "drone",
    title: "Camera 1 — Live Camera",
    fallback: camDrone,
    tone: "drone",
  },
  {
    id: "fasty",
    title: "Camera 2 — AI Object Detection",
    fallback: camFasty,
    tone: "fasty",
    detectionView: true,
  },
];

const stateBadge: Record<CameraState, { label: string; cls: string }> = {
  IDLE: {
    label: "STANDBY",
    cls: "border-border text-muted-foreground",
  },
  REQUESTING: {
    label: "LINKING",
    cls: "border-warn/40 bg-warn/10 text-warn",
  },
  LIVE: {
    label: "LIVE",
    cls: "border-ok/40 bg-ok/10 text-ok",
  },
  DENIED: {
    label: "DENIED",
    cls: "border-fault/40 bg-fault/10 text-fault",
  },
  NOT_FOUND: {
    label: "NO SIGNAL",
    cls: "border-fault/40 bg-fault/10 text-fault",
  },
  ERROR: {
    label: "ERROR",
    cls: "border-fault/40 bg-fault/10 text-fault",
  },
  UNSUPPORTED: {
    label: "N/A",
    cls: "border-border text-muted-foreground",
  },
};

function DetectionOverlay({
  active,
}: {
  active: boolean;
}) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {active ? (
        <>
          <div className="absolute inset-2 border border-fasty/25" />

          <div className="absolute top-2 left-2 flex items-center gap-1 rounded-[2px] border border-fasty/50 bg-background/75 px-1.5 py-1">
            <BrainCircuit size={10} className="text-fasty" />
            <span className="text-[9px] font-bold tracking-[0.12em] text-fasty">
              AI DETECTION
            </span>
          </div>

          <div className="absolute top-2 right-2 flex items-center gap-1 rounded-[2px] border border-ok/40 bg-background/75 px-1.5 py-1">
            <span className="size-1.5 rounded-full bg-ok" />
            <span className="text-[9px] font-bold tracking-[0.1em] text-ok">
              PIPELINE READY
            </span>
          </div>

          <div className="absolute right-2 bottom-2 rounded-[2px] border border-border bg-background/75 px-1.5 py-1">
            <span className="value-mono text-[9px] text-muted-foreground">
              DETECTION ENGINE: READY
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}

function FeedTile({
  feed,
  active,
  onSelect,
  onExpand,
  expanded,
  className,
  stream,
  state,
  error,
  info,
  devices,
  deviceId,
  onDeviceChange,
  onRetry,
}: {
  feed: Feed;
  active: boolean;
  onSelect: () => void;
  onExpand: () => void;
  expanded: boolean;
  className?: string;
  stream: MediaStream | null;
  state: CameraState;
  error: string | null;
  info: { width: number; height: number; fps: number } | null;
  devices: CameraDevice[];
  deviceId: string | null;
  onDeviceChange: ((id: string) => void) | null;
  onRetry: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;

    if (!video) return;

    setVideoReady(false);
    setVideoError(null);

    video.pause();
    video.srcObject = null;

    if (!stream) {
      return;
    }

    video.srcObject = stream;
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;

    const playVideo = async () => {
      try {
        await video.play();
        setVideoReady(true);
      } catch (error) {
        console.error(`Failed to play ${feed.title}:`, error);

        setVideoError(
          error instanceof Error ? error.message : "Video playback failed",
        );
      }
    };

    const handleLoadedMetadata = () => {
      void playVideo();
    };

    const handleCanPlay = () => {
      void playVideo();
    };

    const handlePlaying = () => {
      setVideoReady(true);
      setVideoError(null);
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("playing", handlePlaying);

    void playVideo();

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("playing", handlePlaying);

      video.pause();
      video.srcObject = null;
    };
  }, [stream, feed.title]);

  const badge = stateBadge[state];
  const live = state === "LIVE" && !!stream && videoReady;

  const overlay = live
    ? `${info?.height ? `${info.height}p` : "—"} | ${
        info?.fps || "—"
      } FPS | USB UVC`
    : "NO STREAM";

  return (
    <div
      onClick={onSelect}
      className={cn(
        "group relative flex min-h-0 flex-col overflow-hidden rounded-[3px] border bg-background",
        active
          ? feed.tone === "drone"
            ? "border-drone/70"
            : "border-fasty/70"
          : "border-border",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border bg-panel-header px-2 py-1">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold tracking-wide">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              feed.tone === "drone" ? "bg-drone" : "bg-fasty",
            )}
          />

          <span className="truncate">{feed.title}</span>
        </span>

        <span
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-[2px] border px-1.5 py-px",
            badge.cls,
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              live ? "bg-ok" : "bg-current",
            )}
          />

          <span className="text-[9px] font-bold tracking-[0.1em]">
            {live ? "LIVE" : badge.label}
          </span>
        </span>
      </div>

      <div className="flex items-center gap-1 border-b border-border bg-panel-header/60 px-2 py-1">
        {feed.detectionView ? (
          <>
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <ScanSearch size={11} className="shrink-0 text-fasty" />

              <span className="truncate text-[10px] font-semibold tracking-[0.08em] text-muted-foreground">
                SHARED CAMERA STREAM
              </span>
            </div>

            <span className="shrink-0 rounded-[2px] border border-fasty/40 bg-fasty/10 px-1.5 py-[2px] text-[9px] font-bold tracking-[0.08em] text-fasty">
              AI VIEW
            </span>
          </>
        ) : (
          <>
            <select
              value={deviceId ?? ""}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => onDeviceChange?.(event.target.value)}
              className="min-w-0 flex-1 truncate rounded-[2px] border border-border bg-background px-1.5 py-[2px] text-[10px] text-muted-foreground outline-none focus:text-foreground"
            >
              <option value="">Select USB camera…</option>

              {devices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `USB Camera ${index + 1}`}
                </option>
              ))}
            </select>

            <button
              type="button"
              aria-label={`Reconnect ${feed.title}`}
              onClick={(event) => {
                event.stopPropagation();
                onRetry();
              }}
              className="flex size-5 shrink-0 items-center justify-center rounded-[2px] border border-border text-muted-foreground transition-colors hover:text-foreground"
            >
              <RefreshCw size={10} />
            </button>
          </>
        )}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className={cn(
            "size-full object-cover",
            live ? "block" : "hidden",
          )}
        />

        {!live ? (
          <>
            <img
              src={feed.fallback}
              alt={feed.title}
              width={960}
              height={540}
              className="size-full object-cover opacity-25 grayscale"
            />

            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
              <VideoOff size={18} className="text-muted-foreground" />

              <span className="label-xs text-muted-foreground">
                {state === "DENIED"
                  ? "Camera access blocked"
                  : state === "NOT_FOUND"
                    ? "Camera not detected"
                    : state === "REQUESTING"
                      ? "Connecting…"
                      : videoError
                        ? "Video playback failed"
                        : feed.detectionView
                          ? "Waiting for shared camera stream"
                          : "No camera assigned"}
              </span>

              {(error || videoError) && (
                <span className="max-w-[80%] truncate text-[9px] text-muted-foreground/70">
                  {error ?? videoError}
                </span>
              )}
            </div>
          </>
        ) : null}

        {feed.detectionView ? <DetectionOverlay active={live} /> : null}

        <span className="value-mono absolute bottom-1.5 left-1.5 rounded-[2px] bg-background/80 px-1.5 py-0.5 text-[10px] tracking-wide">
          {overlay}
        </span>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onExpand();
          }}
          aria-label={`Toggle fullscreen ${feed.title}`}
          className="absolute right-1.5 bottom-1.5 flex size-6 items-center justify-center rounded-[2px] border border-border bg-background/80 text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>
      </div>
    </div>
  );
}

export function VideoFeed() {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<Mode>("SPLIT VIEW");
  const [browserFullscreen, setBrowserFullscreen] = useState(false);
  const [active, setActive] = useState<FeedId>("drone");
  const [granted, setGranted] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const { devices, supported, refresh } = useCameraDevices();

  const camera = useCameraStream(cameraId, granted);

  const enterBrowserFullscreen = async () => {
    const panel = panelRef.current;

    if (!panel) return;

    try {
      if (document.fullscreenElement !== panel) {
        await panel.requestFullscreen();
      }

      setBrowserFullscreen(true);
      setMode("FULLSCREEN");
    } catch (error) {
      console.error("Failed to enter camera fullscreen:", error);
    }
  };

  const exitBrowserFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error("Failed to exit camera fullscreen:", error);
    }

    setBrowserFullscreen(false);
    setMode("SPLIT VIEW");
  };

  const toggleBrowserFullscreen = async () => {
    if (document.fullscreenElement) {
      await exitBrowserFullscreen();
    } else {
      await enterBrowserFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = document.fullscreenElement === panelRef.current;
      setBrowserFullscreen(active);

      if (!active) {
        setMode("SPLIT VIEW");
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener(
        "fullscreenchange",
        handleFullscreenChange,
      );
    };
  }, []);

  /*
   * Publish the selected physical camera so DronePanel can consume the same
   * shared MediaStream instead of opening the webcam a second time.
   */
  useEffect(() => {
    setActiveCameraDeviceId(cameraId);

    return () => {
      setActiveCameraDeviceId(null);
    };
  }, [cameraId]);

  const connect = async () => {
    setPermError(null);

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setPermError("Camera API unavailable in this browser context");
      return;
    }

    try {
      const probe = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });

      probe.getTracks().forEach((track) => track.stop());

      await refresh();

      setGranted(true);
    } catch (error) {
      setPermError(
        error instanceof Error
          ? error.message
          : "Camera permission denied",
      );
    }
  };

  useEffect(() => {
    if (!granted || devices.length === 0) return;

    setCameraId((previous) => {
      if (
        previous &&
        devices.some((device) => device.deviceId === previous)
      ) {
        return previous;
      }

      return devices[0]?.deviceId ?? null;
    });
  }, [granted, devices]);

  const tileProps = (feed: Feed) => ({
    feed,
    stream: camera.stream,
    state: (
      granted
        ? camera.state
        : supported
          ? "IDLE"
          : "UNSUPPORTED"
    ) as CameraState,
    error: camera.error,
    info: camera.info,
    devices,
    deviceId: cameraId,
    onDeviceChange: feed.detectionView
      ? null
      : (id: string) => {
          setCameraId(id || null);
        },
    onRetry: () => {
      if (!cameraId) return;

      void camera.start(cameraId);

      setNonce((previous) => previous + 1);
    },
  });

  const activeFeed: Feed =
    feeds.find((feed) => feed.id === active) ?? feeds[0]!;

  const otherFeed: Feed =
    feeds.find((feed) => feed.id !== active) ?? feeds[1]!;

  const live = camera.state === "LIVE" && !!camera.stream;

  return (
    <div
      ref={panelRef}
      className="min-h-0 flex-1 bg-background"
    >
      <Panel className="h-full min-h-0 w-full bg-background">

      <div className="flex items-center justify-between gap-2 border-b border-border bg-panel-header px-2 py-1.5">
        <span className="flex items-center gap-2 text-[13px] font-bold tracking-[0.08em]">
          <Camera size={15} className="text-drone" />

          LIVE VIDEO FEED

          <span className="value-mono text-[10px] font-medium text-muted-foreground">
            {live ? "1 USB CAMERA / 2 VIEWS" : "1 USB CAMERA"}
          </span>
        </span>

        <div className="flex items-center gap-1">
          {!granted ? (
            <button
              type="button"
              onClick={() => void connect()}
              className="flex items-center gap-1 rounded-[2px] border border-drone bg-drone/20 px-2.5 py-1 text-[10px] font-bold tracking-[0.08em] text-drone"
            >
              <Plug size={11} />
              CONNECT CAMERA
            </button>
          ) : null}

          {(["SPLIT VIEW", "PIP"] as Mode[]).map((viewMode) => (
            <button
              key={viewMode}
              type="button"
              onClick={() => {
                if (browserFullscreen) {
                  void exitBrowserFullscreen();
                  return;
                }

                setMode(viewMode);
              }}
              className={cn(
                "rounded-[2px] border px-2.5 py-1 text-[10px] font-bold tracking-[0.08em] transition-colors",
                mode === viewMode
                  ? "border-drone bg-drone/20 text-drone"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {viewMode}
            </button>
          ))}

          <button
            type="button"
            onClick={() => void toggleBrowserFullscreen()}
            className={cn(
              "flex size-7 items-center justify-center rounded-[2px] border transition-colors",
              browserFullscreen
                ? "border-drone bg-drone/20 text-drone"
                : "border-border text-muted-foreground hover:border-drone/50 hover:text-drone",
            )}
            aria-label={
              browserFullscreen
                ? "Exit camera fullscreen"
                : "Open camera fullscreen"
            }
            title={
              browserFullscreen
                ? "Exit fullscreen (Esc)"
                : "Fullscreen camera window"
            }
          >
            {browserFullscreen ? (
              <Minimize2 size={13} />
            ) : (
              <Maximize2 size={13} />
            )}
          </button>
        </div>
      </div>

      {permError ? (
        <div className="border-b border-fault/40 bg-fault/10 px-2 py-1 text-[10px] text-fault">
          {permError}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 p-1.5">
        {mode === "SPLIT VIEW" ? (
          <div className="grid h-full min-h-0 grid-cols-2 gap-1.5">
            {feeds.map((feed) => (
              <FeedTile
                key={`${feed.id}-${nonce}`}
                {...tileProps(feed)}
                active={active === feed.id}
                expanded={false}
                onSelect={() => setActive(feed.id)}
                onExpand={() => {
                  setActive(feed.id);
                  void enterBrowserFullscreen();
                }}
              />
            ))}
          </div>
        ) : mode === "PIP" ? (
          <div className="relative h-full min-h-0">
            <FeedTile
              {...tileProps(activeFeed)}
              key={`active-${activeFeed.id}-${nonce}`}
              active
              expanded={false}
              onSelect={() => {}}
              onExpand={() => void enterBrowserFullscreen()}
              className="h-full"
            />

            <FeedTile
              {...tileProps(otherFeed)}
              key={`other-${otherFeed.id}-${nonce}`}
              active={false}
              expanded={false}
              onSelect={() => setActive(otherFeed.id)}
              onExpand={() => {
                setActive(otherFeed.id);
                void enterBrowserFullscreen();
              }}
              className="absolute right-3 bottom-3 h-[42%] w-[32%] shadow-lg"
            />
          </div>
        ) : (
          <FeedTile
            {...tileProps(activeFeed)}
            key={`fullscreen-${activeFeed.id}-${nonce}`}
            active
            expanded
            onSelect={() => {}}
            onExpand={() =>
              browserFullscreen
                ? void exitBrowserFullscreen()
                : void enterBrowserFullscreen()
            }
            className="h-full"
          />
        )}
      </div>
      </Panel>
    </div>
  );
}
