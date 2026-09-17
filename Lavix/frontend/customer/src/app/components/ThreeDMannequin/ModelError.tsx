/**
 * Two distinct reasons the garment layer might not be showing, worth
 * distinguishing rather than one generic message:
 *  - "unavailable": this garment simply has no model_3d_url yet (the common
 *    case today — expected, not an error).
 *  - "load-failed": a URL was set but the fetch/parse failed (bad URL, file
 *    isn't valid glTF, network drop).
 * Either way the mannequin itself keeps rendering behind this — see
 * MannequinScene, which never gates the mannequin on garment state — and
 * Virtual Try-On is a fully independent code path, untouched by this failing.
 */
export function ModelError({ reason }: { reason: "unavailable" | "load-failed" }) {
  const message =
    reason === "unavailable"
      ? "3D preview is not available for this garment."
      : "This garment's 3D preview couldn't be loaded. Showing the mannequin instead.";

  return (
    <div className="absolute top-24 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
      <div className="flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-black/70 backdrop-blur-md border border-white/20 shadow-2xl">
        <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
        <span className="text-sm font-semibold text-white whitespace-nowrap">{message}</span>
      </div>
    </div>
  );
}
