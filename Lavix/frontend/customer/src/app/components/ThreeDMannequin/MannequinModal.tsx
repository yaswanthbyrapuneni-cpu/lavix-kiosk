/**
 * The "3D Mannequin" viewer. Structurally mirrors the existing Virtual Try-On
 * mirror modal on the same page (full-bleed black, fullscreen API on open,
 * idle-ad suspended for the duration) so the two feel like one product, not
 * two different apps bolted together — but it is a fully independent
 * component with its own state. Nothing here touches the try-on code path.
 */
import { useEffect, useRef, useState } from "react";
import { Box } from "lucide-react";
import { MannequinScene, MannequinSceneHandle } from "./MannequinScene";
import { MannequinBottomControls, MannequinHeaderControls } from "./MannequinControls";
import { ModelError } from "./ModelError";
import { releaseGarmentModel } from "./GarmentModel";
import { releasePhotoGarment } from "./PhotoGarment";
import { useTryOnActivity } from "../../context/TryOnActivityContext";

interface MannequinModalProps {
  garmentName: string;
  /** Absent/null when this garment has no real 3D asset — falls back to the
   * photo cutouts below, or the "not available" message if neither exists. */
  model3dUrl?: string | null;
  /** Server-generated cutout of the garment's main photo. */
  frontPhotoUrl?: string | null;
  /** Cutout of the admin's optional back-view photo. */
  backPhotoUrl?: string | null;
  onClose: () => void;
}

export default function MannequinModal({
  garmentName,
  model3dUrl,
  frontPhotoUrl,
  backPhotoUrl,
  onClose,
}: MannequinModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MannequinSceneHandle>(null);

  const [autoRotate, setAutoRotate] = useState(true);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [garmentLoadFailed, setGarmentLoadFailed] = useState(false);

  // Same mechanism the try-on mirror uses to keep the idle ad from
  // interrupting a session — reused rather than duplicated, since it's
  // already generic ("is a full-kiosk experience active"), not try-on-specific.
  const { setTryOnActive } = useTryOnActivity();
  useEffect(() => {
    setTryOnActive(true);
    return () => setTryOnActive(false);
  }, [setTryOnActive]);

  const enterFullScreen = () => {
    const el = containerRef.current as any;
    if (!el) return;
    const doc: any = document;
    if (doc.fullscreenElement) return;
    const request = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (request) {
      Promise.resolve(request.call(el)).then(() => setIsFullScreen(true)).catch(() => {});
    }
  };

  const exitFullScreen = () => {
    const doc: any = document;
    if (doc.fullscreenElement) {
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
      if (exit) Promise.resolve(exit.call(doc)).catch(() => {});
    }
    setIsFullScreen(false);
  };

  useEffect(() => {
    enterFullScreen();
    const onChange = () => {
      const doc: any = document;
      setIsFullScreen(Boolean(doc.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      exitFullScreen();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Free whichever cache this garment actually used when the viewer closes —
  // a kiosk can be viewed by many customers across many garments in one
  // running tab.
  useEffect(() => {
    return () => {
      releaseGarmentModel(model3dUrl);
      releasePhotoGarment(frontPhotoUrl, backPhotoUrl);
    };
  }, [model3dUrl, frontPhotoUrl, backPhotoUrl]);

  return (
    <div ref={containerRef} className="fixed inset-0 z-[100] bg-black w-full h-[100dvh] overflow-hidden flex flex-col p-0 m-0">
      <div className="absolute top-0 left-0 right-0 z-40 flex justify-between items-center px-6 py-5 bg-gradient-to-b from-black/90 via-black/40 to-transparent text-white pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <Box className="w-7 h-7 text-emerald-400" />
          <div>
            <h2 className="text-xl font-bold tracking-tight">3D Mannequin View</h2>
            <div className="flex items-center gap-2 text-xs text-emerald-400 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>{garmentName}</span>
            </div>
          </div>
        </div>
        <div className="pointer-events-auto">
          <MannequinHeaderControls
            isFullScreen={isFullScreen}
            onToggleFullScreen={() => (isFullScreen ? exitFullScreen() : enterFullScreen())}
            onClose={onClose}
          />
        </div>
      </div>

      <div className="relative w-full h-full">
        <MannequinScene
          ref={sceneRef}
          garmentUrl={model3dUrl ?? null}
          frontPhotoUrl={frontPhotoUrl ?? null}
          backPhotoUrl={backPhotoUrl ?? null}
          autoRotate={autoRotate}
          onManualInteract={() => setAutoRotate(false)}
          onGarmentError={() => setGarmentLoadFailed(true)}
        />

        {(!(model3dUrl || frontPhotoUrl) || garmentLoadFailed) && (
          <ModelError reason={garmentLoadFailed ? "load-failed" : "unavailable"} />
        )}
      </div>

      <MannequinBottomControls
        autoRotate={autoRotate}
        onToggleAutoRotate={() => setAutoRotate((v) => !v)}
        onZoomIn={() => sceneRef.current?.zoomIn()}
        onZoomOut={() => sceneRef.current?.zoomOut()}
        onResetView={() => sceneRef.current?.resetView()}
      />
    </div>
  );
}
