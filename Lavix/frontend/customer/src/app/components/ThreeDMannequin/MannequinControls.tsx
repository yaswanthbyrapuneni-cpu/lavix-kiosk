/**
 * Presentational only — all state (autoRotate, fullscreen) is owned by
 * MannequinModal and passed in, matching the "single source of truth" pattern
 * already used for the try-on mirror on the same page.
 *
 * Styled to match the existing mirror modal's chrome exactly: circular icon
 * buttons in the header, a floating pill bar for the primary interaction
 * controls at the bottom (see ProductDetailsPage.tsx's try-on modal).
 */
import { Maximize, Minimize, RotateCcw, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";

const headerButton =
  "p-2.5 bg-black/60 hover:bg-black/90 rounded-full transition-colors text-white border border-white/20 shadow-xl cursor-pointer";
const pillButton =
  "p-3 rounded-full transition-all active:scale-95 cursor-pointer border";

interface MannequinControlsProps {
  autoRotate: boolean;
  onToggleAutoRotate: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  isFullScreen: boolean;
  onToggleFullScreen: () => void;
  onClose: () => void;
}

export function MannequinHeaderControls({
  isFullScreen,
  onToggleFullScreen,
  onClose,
}: Pick<MannequinControlsProps, "isFullScreen" | "onToggleFullScreen" | "onClose">) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onToggleFullScreen}
        className={headerButton}
        aria-label={isFullScreen ? "Exit full screen" : "Enter full screen"}
        title={isFullScreen ? "Exit Full Screen" : "Enter Full Screen"}
      >
        {isFullScreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
      </button>
      <button
        onClick={onClose}
        className={headerButton}
        aria-label="Close 3D Mannequin viewer"
        title="Close"
      >
        <X size={24} />
      </button>
    </div>
  );
}

export function MannequinBottomControls({
  autoRotate,
  onToggleAutoRotate,
  onZoomIn,
  onZoomOut,
  onResetView,
}: Pick<
  MannequinControlsProps,
  "autoRotate" | "onToggleAutoRotate" | "onZoomIn" | "onZoomOut" | "onResetView"
>) {
  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-black/60 backdrop-blur-xl p-3 px-5 rounded-full border border-white/20 shadow-2xl">
      <button
        onClick={onToggleAutoRotate}
        aria-label="Toggle auto rotate"
        aria-pressed={autoRotate}
        title="Auto Rotate"
        className={`${pillButton} ${
          autoRotate
            ? "bg-emerald-500 border-emerald-300/40 text-black"
            : "bg-white/10 hover:bg-white/20 border-white/20 text-white"
        }`}
      >
        <RotateCw className={`w-5 h-5 ${autoRotate ? "animate-spin" : ""}`} style={autoRotate ? { animationDuration: "3s" } : undefined} />
      </button>

      <div className="w-px h-6 bg-white/20" />

      <button
        onClick={onZoomOut}
        aria-label="Zoom out"
        title="Zoom Out"
        className={`${pillButton} bg-white/10 hover:bg-white/20 border-white/20 text-white`}
      >
        <ZoomOut className="w-5 h-5" />
      </button>
      <button
        onClick={onZoomIn}
        aria-label="Zoom in"
        title="Zoom In"
        className={`${pillButton} bg-white/10 hover:bg-white/20 border-white/20 text-white`}
      >
        <ZoomIn className="w-5 h-5" />
      </button>

      <div className="w-px h-6 bg-white/20" />

      <button
        onClick={onResetView}
        aria-label="Reset view"
        title="Reset View"
        className={`${pillButton} bg-white/10 hover:bg-white/20 border-white/20 text-white`}
      >
        <RotateCcw className="w-5 h-5" />
      </button>
    </div>
  );
}
