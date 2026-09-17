/**
 * Public entry point for this feature. Import from here (not the individual
 * files) so the whole subtree — including three.js, @react-three/fiber and
 * @react-three/drei — stays behind a single React.lazy() boundary and never
 * lands in the main bundle. See ProductDetailsPage.tsx.
 *
 * Re-exported as `default` specifically because React.lazy() requires the
 * dynamically-imported module to have one.
 */
export { default } from "./MannequinModal";
