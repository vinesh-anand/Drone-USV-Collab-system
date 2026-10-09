import {
  Suspense,
  Component,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { Canvas } from "@react-three/fiber";
import {
  Bounds,
  Center,
  Environment,
  Html,
  OrbitControls,
  useGLTF,
} from "@react-three/drei";
import * as THREE from "three";

interface VehicleOrientation {
  heading?: number;
  pitch?: number;
  roll?: number;
}

interface VehicleModelProps {
  modelUrl?: string;
  orientation?: VehicleOrientation;
  autoRotate?: boolean;
  autoRotateSpeed?: number;
}

interface VehicleModel3DProps extends VehicleModelProps {
  className?: string;
  label?: string;
}

type ModelAvailability =
  | "CHECKING"
  | "AVAILABLE"
  | "UNAVAILABLE";

/* -------------------------------------------------------------------------- */
/* Error boundary                                                             */
/* -------------------------------------------------------------------------- */

interface ModelErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}

interface ModelErrorBoundaryState {
  hasError: boolean;
}

class ModelErrorBoundary extends Component<
  ModelErrorBoundaryProps,
  ModelErrorBoundaryState
> {
  override state: ModelErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): ModelErrorBoundaryState {
    return {
      hasError: true,
    };
  }

  override componentDidCatch(
    _error: Error,
    _errorInfo: ErrorInfo,
  ) {
    // A missing/invalid optional vehicle mesh is an
    // expected UI fallback. Keep the cockpit console clean.
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

/* -------------------------------------------------------------------------- */
/* Model availability check                                                   */
/* -------------------------------------------------------------------------- */

function useModelAvailability(
  modelUrl: string | undefined,
): ModelAvailability {
  const [status, setStatus] =
    useState<ModelAvailability>("CHECKING");

  useEffect(() => {
    let active = true;

    if (!modelUrl) {
      setStatus("UNAVAILABLE");

      return () => {
        active = false;
      };
    }

    setStatus("CHECKING");

    const checkModel = async () => {
      try {
        const response = await fetch(modelUrl, {
          method: "HEAD",
          cache: "no-store",
        });

        if (!active) {
          return;
        }

        setStatus(
          response.ok
            ? "AVAILABLE"
            : "UNAVAILABLE",
        );
      } catch {
        if (!active) {
          return;
        }

        setStatus("UNAVAILABLE");
      }
    };

    void checkModel();

    return () => {
      active = false;
    };
  }, [modelUrl]);

  return status;
}

/* -------------------------------------------------------------------------- */
/* Loading state                                                              */
/* -------------------------------------------------------------------------- */

function ModelChecking() {
  return (
    <div className="flex h-full min-h-[48px] items-center justify-center">
      <div className="flex items-center gap-2 border border-cyan-400/20 bg-slate-950/90 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300">
        <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
        Checking 3D Mesh
      </div>
    </div>
  );
}

function ModelLoading() {
  return (
    <Html center>
      <div className="flex items-center gap-2 whitespace-nowrap border border-cyan-400/20 bg-slate-950/90 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300">
        <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
        Loading 3D Model
      </div>
    </Html>
  );
}

/* -------------------------------------------------------------------------- */
/* Fallback state                                                             */
/* -------------------------------------------------------------------------- */

function ModelFallback({
  label = "3D MODEL",
}: {
  label?: string;
}) {
  return (
    <div className="flex h-full min-h-[48px] items-center justify-center">
      <div className="flex min-w-[180px] flex-col items-center gap-2 border border-dashed border-slate-700 bg-slate-950/80 px-5 py-4 text-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
          {label}
        </div>

        <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-600">
          Mesh unavailable
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 3D vehicle                                                                 */
/* -------------------------------------------------------------------------- */

function VehicleMesh({
  modelUrl,
  orientation,
}: {
  modelUrl: string;
  orientation: VehicleOrientation;
}) {
  const { scene } = useGLTF(modelUrl);

  const heading = THREE.MathUtils.degToRad(
    orientation.heading ?? 0,
  );

  const pitch = THREE.MathUtils.degToRad(
    orientation.pitch ?? 0,
  );

  const roll = THREE.MathUtils.degToRad(
    orientation.roll ?? 0,
  );

  return (
    <group rotation={[pitch, heading, roll]}>
      <Center>
        <primitive object={scene} />
      </Center>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/* Main 3D scene                                                              */
/* -------------------------------------------------------------------------- */

function VehicleScene({
  modelUrl,
  orientation = {},
  autoRotate = false,
  autoRotateSpeed = 1,
}: {
  modelUrl: string;
  orientation?: VehicleOrientation;
  autoRotate?: boolean;
  autoRotateSpeed?: number;
}) {
  return (
    <>
      <ambientLight intensity={0.8} />

      <directionalLight
        position={[5, 7, 5]}
        intensity={2}
      />

      <directionalLight
        position={[-5, 3, -4]}
        intensity={1.1}
      />

      <pointLight
        position={[0, -2, 2]}
        intensity={0.5}
        distance={10}
      />

      <Environment preset="city" />

      <Bounds
        fit
        clip
        observe
        margin={1.2}
      >
        <Suspense fallback={<ModelLoading />}>
          <VehicleMesh
            modelUrl={modelUrl}
            orientation={orientation}
          />
        </Suspense>
      </Bounds>

      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={1.5}
        maxDistance={8}
        autoRotate={autoRotate}
        autoRotateSpeed={autoRotateSpeed}
      />

      <gridHelper
        args={[
          10,
          20,
          "#163040",
          "#0c1820",
        ]}
        position={[0, -1.4, 0]}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Public component                                                           */
/* -------------------------------------------------------------------------- */

export default function VehicleModel3D({
  modelUrl,
  orientation = {},
  autoRotate = false,
  autoRotateSpeed = 1,
  className = "",
  label = "VEHICLE 3D",
}: VehicleModel3DProps) {
  const modelStatus =
    useModelAvailability(modelUrl);

  return (
    <div
      className={`relative w-full overflow-hidden bg-[#05090d] ${className}`}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Technical corner markers                                            */}
      {/* ------------------------------------------------------------------ */}

      <div className="pointer-events-none absolute inset-0 z-10">
        <span className="absolute left-1 top-1 h-3 w-3 border-l border-t border-cyan-400/40" />
        <span className="absolute right-1 top-1 h-3 w-3 border-r border-t border-cyan-400/40" />
        <span className="absolute bottom-1 left-1 h-3 w-3 border-b border-l border-cyan-400/40" />
        <span className="absolute bottom-1 right-1 h-3 w-3 border-b border-r border-cyan-400/40" />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Viewer title                                                        */}
      {/* ------------------------------------------------------------------ */}

      <div className="pointer-events-none absolute left-3 top-3 z-10">
        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-cyan-400/70">
          {label}
        </div>

        <div className="mt-1 font-mono text-[8px] uppercase tracking-[0.14em] text-slate-600">
          Interactive 3D View
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Viewer                                                              */}
      {/* ------------------------------------------------------------------ */}

      <div className="absolute inset-0">
        {modelStatus === "CHECKING" ? (
          <ModelChecking />
        ) : modelStatus === "UNAVAILABLE" ? (
          <ModelFallback label={label} />
        ) : (
          <Canvas
            camera={{
              position: [3.5, 2.4, 4.5],
              fov: 38,
              near: 0.1,
              far: 100,
            }}
            dpr={[1, 1.5]}
            gl={{
              antialias: true,
              alpha: true,
              powerPreference:
                "high-performance",
            }}
          >
            <ModelErrorBoundary
              fallback={
                <ModelFallback
                  label={label}
                />
              }
            >
              <VehicleScene
                modelUrl={modelUrl ?? ""}
                orientation={
                  orientation
                }
                autoRotate={autoRotate}
                autoRotateSpeed={
                  autoRotateSpeed
                }
              />
            </ModelErrorBoundary>
          </Canvas>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Invisible sizing layer                                              */}
      {/* ------------------------------------------------------------------ */}

      <div className="pointer-events-none invisible w-full">
        <div className="h-px w-full" />
      </div>
    </div>
  );
}