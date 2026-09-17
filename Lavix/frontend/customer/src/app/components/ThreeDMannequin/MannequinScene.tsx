/**
 * The Canvas: camera, lighting, the mannequin, and (when available) the
 * garment layered on top.
 *
 * Deliberately does NOT use drei's <Environment> for lighting. Environment
 * fetches an HDRI file from pmndrs' CDN at runtime — a live third-party
 * network dependency for a kiosk feature, which is exactly what this project
 * has been moving away from elsewhere this session (hero video hosting, DNS).
 * Plain directional + ambient lights are fully local, load instantly, and are
 * cheaper to render.
 *
 * Camera framing is a fixed, pre-tuned position rather than a runtime
 * bounding-box fit. That's not a shortcut: both the mannequin (fixed
 * geometry) and any loaded garment (normalized in GarmentModel to the same
 * MANNEQUIN_HEIGHT, feet at y=0) occupy a deterministic size by construction,
 * so a fixed camera reliably frames either one — no per-model fit math needed,
 * nothing to get wrong on an unusual asset.
 */
import { forwardRef, Suspense, useImperativeHandle, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { MANNEQUIN_HEIGHT, PlaceholderMannequin } from "./PlaceholderMannequin";
import { GarmentModel } from "./GarmentModel";
import { GarmentErrorBoundary } from "./GarmentErrorBoundary";
import { ModelLoading } from "./ModelLoading";
import { PhotoGarment } from "./PhotoGarment";

export interface MannequinSceneHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
}

interface MannequinSceneProps {
  /** Real .glb — best quality, takes priority over the photo cutouts below. */
  garmentUrl?: string | null;
  /** Server-generated (rembg) cutout of the garment's main photo. Used only
   * when garmentUrl is absent. */
  frontPhotoUrl?: string | null;
  /** Cutout of the admin's optional back-view photo. */
  backPhotoUrl?: string | null;
  autoRotate: boolean;
  /** Manual drag/scroll should pause auto-rotate — a spinning model fighting
   * the customer's own input reads as broken, not polished. */
  onManualInteract: () => void;
  onGarmentError: () => void;
}

const CAMERA_POSITION: [number, number, number] = [0, MANNEQUIN_HEIGHT * 0.62, 2.9];
const TARGET_HEIGHT = MANNEQUIN_HEIGHT * 0.52;

export const MannequinScene = forwardRef<MannequinSceneHandle, MannequinSceneProps>(
  function MannequinScene(
    { garmentUrl, frontPhotoUrl, backPhotoUrl, autoRotate, onManualInteract, onGarmentError },
    ref
  ) {
    const controlsRef = useRef<OrbitControlsImpl>(null);

    useImperativeHandle(ref, () => ({
      zoomIn: () => {
        controlsRef.current?.dollyIn(1.2);
        controlsRef.current?.update();
      },
      zoomOut: () => {
        controlsRef.current?.dollyOut(1.2);
        controlsRef.current?.update();
      },
      resetView: () => {
        controlsRef.current?.reset();
      },
    }));

    return (
      <Canvas
        camera={{ position: CAMERA_POSITION, fov: 38 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        shadows={false}
      >
        <ambientLight intensity={0.65} />
        <directionalLight position={[3, 5, 2]} intensity={1.15} />
        <directionalLight position={[-3, 2, -2]} intensity={0.45} />

        <group position={[0, 0, 0]}>
          <PlaceholderMannequin />

          {garmentUrl ? (
            // Best quality: a real .glb.
            <GarmentErrorBoundary resetKey={garmentUrl} onError={onGarmentError}>
              <Suspense fallback={<ModelLoading />}>
                <GarmentModel url={garmentUrl} />
              </Suspense>
            </GarmentErrorBoundary>
          ) : frontPhotoUrl ? (
            // Fallback: the admin's front/back photos, server-cut to just the
            // garment. Photo loads are far more likely to 404/fail than a
            // curated .glb, so this also gets an error boundary.
            <GarmentErrorBoundary resetKey={`${frontPhotoUrl}|${backPhotoUrl ?? ""}`} onError={onGarmentError}>
              <Suspense fallback={<ModelLoading />}>
                <PhotoGarment frontUrl={frontPhotoUrl} backUrl={backPhotoUrl} />
              </Suspense>
            </GarmentErrorBoundary>
          ) : null}
        </group>

        <ContactShadows position={[0, 0, 0]} opacity={0.35} scale={2.2} blur={2.2} far={1.5} />

        <OrbitControls
          ref={controlsRef}
          target={[0, TARGET_HEIGHT, 0]}
          enablePan={false}
          minDistance={1.8}
          maxDistance={4.5}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI / 2.05}
          autoRotate={autoRotate}
          autoRotateSpeed={1.1}
          onStart={onManualInteract}
        />
      </Canvas>
    );
  }
);
