/**
 * Default mannequin: built entirely from primitive Three.js geometry, not a
 * loaded .glb file.
 *
 * No 3D mannequin/garment assets exist anywhere in this project or org, and a
 * generated-from-a-2D-photo garment was explicitly ruled out. The two real
 * options for a default figure were (a) this procedural stand-in, or (b) a
 * public sample .glb from a third-party host. (b) was rejected: this is a
 * kiosk feature, and pointing it at someone else's server as a load-bearing
 * dependency repeats a class of fragility this project has spent real effort
 * removing elsewhere (hero video hosting, DNS). This primitive figure can't
 * 404, needs no network fetch, and costs a handful of draw calls.
 *
 * To swap in a real mannequin once one exists, don't edit this file -- pass a
 * `mannequinUrl` through MannequinScene instead (see that file's comment);
 * this component only renders when no URL is configured.
 */
import { useMemo } from "react";

const SKIN = "#d9c9b8";

function Capsule({
  position,
  rotation,
  args,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  args: [radius: number, length: number, capSegments?: number, radialSegments?: number];
}) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <capsuleGeometry args={args} />
      <meshStandardMaterial color={SKIN} roughness={0.55} metalness={0.05} />
    </mesh>
  );
}

export function PlaceholderMannequin() {
  // Fixed, human-ish proportions in scene units where 1 unit ~= 1 metre, feet
  // at y=0. Kept as plain constants (not props) -- this is a stand-in, not a
  // configurable rig.
  const geo = useMemo(
    () => ({
      head: { y: 1.62, r: 0.11 },
      neck: { y: 1.5 },
      torso: { y: 1.28 },
      pelvis: { y: 0.98 },
      upperArmL: { y: 1.32, x: -0.24 },
      upperArmR: { y: 1.32, x: 0.24 },
      lowerArmL: { y: 0.98, x: -0.28 },
      lowerArmR: { y: 0.98, x: 0.28 },
      upperLegL: { y: 0.62, x: -0.1 },
      upperLegR: { y: 0.62, x: 0.1 },
      lowerLegL: { y: 0.16, x: -0.1 },
      lowerLegR: { y: 0.16, x: 0.1 },
    }),
    []
  );

  return (
    <group>
      {/* Head */}
      <mesh position={[0, geo.head.y, 0]} castShadow>
        <sphereGeometry args={[geo.head.r, 24, 24]} />
        <meshStandardMaterial color={SKIN} roughness={0.5} />
      </mesh>

      {/* Neck */}
      <Capsule position={[0, geo.neck.y, 0]} args={[0.05, 0.06, 4, 8]} />

      {/* Torso */}
      <Capsule position={[0, geo.torso.y, 0]} args={[0.17, 0.32, 4, 12]} />

      {/* Pelvis */}
      <Capsule position={[0, geo.pelvis.y, 0]} args={[0.14, 0.1, 4, 12]} />

      {/* Arms — upper, angled slightly out from the shoulder */}
      <Capsule
        position={[geo.upperArmL.x, geo.upperArmL.y, 0]}
        rotation={[0, 0, 0.22]}
        args={[0.055, 0.28, 4, 8]}
      />
      <Capsule
        position={[geo.upperArmR.x, geo.upperArmR.y, 0]}
        rotation={[0, 0, -0.22]}
        args={[0.055, 0.28, 4, 8]}
      />
      {/* Arms — lower */}
      <Capsule
        position={[geo.lowerArmL.x, geo.lowerArmL.y, 0]}
        rotation={[0, 0, 0.05]}
        args={[0.05, 0.28, 4, 8]}
      />
      <Capsule
        position={[geo.lowerArmR.x, geo.lowerArmR.y, 0]}
        rotation={[0, 0, -0.05]}
        args={[0.05, 0.28, 4, 8]}
      />

      {/* Legs — upper */}
      <Capsule position={[geo.upperLegL.x, geo.upperLegL.y, 0]} args={[0.09, 0.34, 4, 10]} />
      <Capsule position={[geo.upperLegR.x, geo.upperLegR.y, 0]} args={[0.09, 0.34, 4, 10]} />
      {/* Legs — lower */}
      <Capsule position={[geo.lowerLegL.x, geo.lowerLegL.y, 0]} args={[0.075, 0.3, 4, 10]} />
      <Capsule position={[geo.lowerLegR.x, geo.lowerLegR.y, 0]} args={[0.075, 0.3, 4, 10]} />

      {/* A plain disc base, standard for a display mannequin */}
      <mesh position={[0, 0.01, 0]} receiveShadow>
        <cylinderGeometry args={[0.22, 0.24, 0.02, 32]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.4} />
      </mesh>
    </group>
  );
}

/** Canonical standing height this mannequin occupies, feet at y=0 — used by
 * both the fixed camera framing and GarmentModel's auto-scale so any garment
 * normalizes to the same figure regardless of its native size. */
export const MANNEQUIN_HEIGHT = 1.75;
