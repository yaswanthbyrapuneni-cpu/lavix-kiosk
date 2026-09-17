/**
 * Suspense only covers the loading phase. A bad model_3d_url (404, or a file
 * that isn't valid glTF/GLB) makes useGLTF throw during render, and only a
 * real error boundary catches that — React has no hook-based equivalent, so
 * this has to be a class component.
 *
 * Scoped tightly around <GarmentModel> only (see MannequinScene) so a broken
 * garment can never take the mannequin down with it.
 *
 * This boundary lives *inside* <Canvas>, where only Three.js scene objects can
 * render (a raw DOM node here would break the R3F reconciler — that's why
 * ModelLoading uses drei's <Html> portal instead of a plain <div>). So on
 * error this renders nothing extra into the 3D scene (the mannequin keeps
 * showing) and calls onError to notify the parent, which renders the actual
 * "3D preview not available" banner as ordinary DOM outside the Canvas.
 */
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  onError: () => void;
  /** Bump this (e.g. to the garment URL) when the garment changes, so a
   * previous failure doesn't stick around and block a different garment that
   * might load fine. */
  resetKey: string;
}

interface State {
  hasError: boolean;
  lastResetKey: string;
}

export class GarmentErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, lastResetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  // The React-recommended way to react to a prop change from inside a class
  // component without an extra render — clears a stale error the moment a
  // different garment is selected, before that garment even attempts to load.
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.lastResetKey) {
      return { hasError: false, lastResetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: unknown) {
    console.error("[3D Mannequin] Garment model failed to load:", error);
    this.props.onError();
  }

  render() {
    // Nothing rendered into the 3D scene on error — the mannequin (a sibling,
    // not a child, of this boundary) is unaffected either way.
    return this.state.hasError ? null : this.props.children;
  }
}
