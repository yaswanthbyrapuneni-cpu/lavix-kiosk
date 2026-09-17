/**
 * Fallback for garments with no real .glb: two flat, background-removed photo
 * cutouts (produced server-side by rembg — see app.py's isolate_garment_image,
 * called from add_garment) positioned in front of and behind the mannequin's
 * torso, rotating together as one rigid group.
 *
 * Deliberately not a UV-wrapped/cylindrical texture. That was considered and
 * rejected: it would stretch/distort a flat photo around the mannequin's
 * generic capsule torso, which doesn't match any specific garment's actual
 * silhouette, and would look worse than two clean, correctly-oriented photos.
 *
 * Honest, unavoidable limitation of only having two photos: at roughly the 90°
 * side angle, both planes are edge-on and go thin for a moment mid-rotation.
 * That's inherent to a two-photo approach, not a bug — a real .glb (see
 * GarmentModel.tsx) is the only way to have coverage at every angle.
 */
import { useMemo } from "react";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import { MANNEQUIN_HEIGHT } from "./PlaceholderMannequin";

// Matches process_local_tryon's own "chest to upper-leg" sizing philosophy
// (target_h = person_height * 0.52) for the same rembg-cropped garment
// region, just applied to the mannequin's height instead of a photo's.
const PHOTO_HEIGHT = MANNEQUIN_HEIGHT * 0.52;
// Anchored at shoulder height so the cutout hangs down naturally, matching
// where a garment is actually worn from, rather than being centered arbitrarily.
const SHOULDER_Y = 1.5;
// Just outside the torso capsule's 0.17 radius, so the photo sits in front of
// (or behind) the body surface without clipping into it.
const TORSO_OFFSET = 0.2;

function Billboard({ url, facing }: { url: string; facing: "front" | "back" }) {
  const texture = useTexture(url);

  const { width, height } = useMemo(() => {
    const img = texture.image as { width?: number; height?: number } | undefined;
    const aspect = img?.width && img?.height ? img.width / img.height : 0.75;
    return { width: PHOTO_HEIGHT * aspect, height: PHOTO_HEIGHT };
  }, [texture]);

  const z = facing === "front" ? TORSO_OFFSET : -TORSO_OFFSET;
  const rotationY = facing === "front" ? 0 : Math.PI;

  return (
    <mesh position={[0, SHOULDER_Y - height / 2, z]} rotation={[0, rotationY, 0]}>
      <planeGeometry args={[width, height]} />
      {/* alphaTest discards near-transparent pixels outright (avoids soft
          sorting artifacts at the cutout edge); transparent still blends the
          remaining semi-transparent edge pixels smoothly. */}
      <meshStandardMaterial map={texture} transparent alphaTest={0.1} side={THREE.FrontSide} />
    </mesh>
  );
}

export function PhotoGarment({
  frontUrl,
  backUrl,
}: {
  frontUrl: string;
  /** Absent when the admin didn't upload a back-view photo — the front still
   * renders on its own; there's simply nothing to show on the back. */
  backUrl?: string | null;
}) {
  return (
    <>
      <Billboard url={frontUrl} facing="front" />
      {backUrl && <Billboard url={backUrl} facing="back" />}
    </>
  );
}

/** Mirrors GarmentModel's releaseGarmentModel — frees drei's texture cache on
 * modal close, same rationale (a kiosk views many garments per running tab). */
export function releasePhotoGarment(frontUrl?: string | null, backUrl?: string | null) {
  if (frontUrl) useTexture.clear(frontUrl);
  if (backUrl) useTexture.clear(backUrl);
}
