/**
 * The in-Canvas loading state, for fetching a garment's .glb bytes once the
 * viewer is already running (a *second*, later loading phase — the first is
 * fetching the viewer's own code, three/@react-three/fiber/drei, handled by
 * ProductDetailsPage's <Suspense> around the lazy import, before Canvas ever
 * mounts; that fallback deliberately lives in ProductDetailsPage.tsx itself
 * rather than here, since importing anything from this folder into that
 * eagerly-loaded page would defeat the lazy-load split).
 *
 * Rendered via drei's <Html> so it can sit inside the Canvas/R3F tree (a plain
 * DOM node can't be a direct child of <Canvas>) and read real progress via
 * useProgress.
 */
import { Html, useProgress } from "@react-three/drei";

export function ModelLoading() {
  const { progress } = useProgress();
  return (
    <Html center>
      <div className="flex flex-col items-center gap-3 pointer-events-none select-none">
        <div className="w-12 h-12 rounded-full border-4 border-white/20 border-t-white animate-spin" />
        <p className="text-white text-sm font-semibold tracking-wide whitespace-nowrap">
          Loading 3D Preview… {Math.round(progress)}%
        </p>
      </div>
    </Html>
  );
}
