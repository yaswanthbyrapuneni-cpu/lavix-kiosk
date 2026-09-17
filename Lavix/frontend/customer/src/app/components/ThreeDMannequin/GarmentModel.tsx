/**
 * Loads and normalizes an arbitrary garment .glb by URL.
 *
 * Real-world GLBs arrive at wildly different native scales and origins. Rather
 * than requiring every uploaded asset to be pre-scaled/pre-centered correctly
 * (which nobody uploading through the admin panel will reliably get right),
 * this measures the loaded model's bounding box and normalizes it to
 * MANNEQUIN_HEIGHT with its feet at y=0 -- the same coordinate space
 * PlaceholderMannequin occupies. That's what lets the camera in
 * MannequinScene stay fixed instead of computing a fit at runtime: scale is
 * deterministic by construction, so a pre-tuned camera always frames it.
 *
 * Must be rendered inside a <Suspense> boundary -- useGLTF suspends while the
 * network fetch is in flight, and throws synchronously (caught by
 * ModelErrorBoundary, not by Suspense) on a 404 or a file that isn't valid
 * glTF/GLB.
 */
import { useEffect, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { MANNEQUIN_HEIGHT } from "./PlaceholderMannequin";

export function GarmentModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    // Reset any normalization from a previously loaded model before
    // re-measuring — otherwise switching garments compounds each pass.
    group.scale.setScalar(1);
    group.position.set(0, 0, 0);

    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    if (size.y <= 0) return; // degenerate/empty model — leave at identity

    const scale = MANNEQUIN_HEIGHT / size.y;
    const center = box.getCenter(new THREE.Vector3());

    group.scale.setScalar(scale);
    // Center horizontally, plant the lowest point of the model at the floor.
    group.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  }, [scene]);

  return (
    <group ref={groupRef}>
      <primitive object={scene} />
    </group>
  );
}

/**
 * Frees the cached GLTF (geometries, materials, textures) for a URL. Call on
 * modal close — a kiosk can run for days across many customers and many
 * different garments, and useGLTF's module-level cache would otherwise grow
 * for as long as the tab stays open.
 */
export function releaseGarmentModel(url: string | null | undefined) {
  if (url) useGLTF.clear(url);
}
