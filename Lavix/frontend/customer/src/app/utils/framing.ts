/**
 * Framing guidance for the Virtual Try-On mirror.
 *
 * Vertex AI's virtual-try-on model expects a full-body, front-facing photo. The
 * kiosk webcam typically captures a head-and-shoulders crop instead, and the
 * model then renders a full-length garment with no body to place it on -- which
 * is what produced sarees floating above the customer's head.
 *
 * Face size is a reliable proxy for distance: the closer someone stands, the
 * more of the frame their face occupies. These thresholds are expressed as a
 * fraction of frame height so they hold at any resolution.
 */

export type FramingStatus = "no-face" | "too-close" | "too-far" | "off-centre" | "ready";

export interface FramingHint {
  status: FramingStatus;
  /** Short instruction to show the customer. */
  message: string;
  /** True when the photo is likely to produce a usable render. */
  ready: boolean;
}

/**
 * Above this fraction of frame height, the body cannot be in shot. Two
 * thresholds because how much of the body actually needs to be visible
 * depends on what's being tried on: a full-length garment (saree, dress,
 * lehenga, jeans) needs the customer standing back so the whole thing is in
 * frame, but a shirt/t-shirt/jacket only needs waist-up -- requiring the
 * same distance as a saree just makes those customers back away for no
 * reason, when standing closer would already frame it correctly.
 */
const FACE_TOO_CLOSE_FULL_BODY = 0.30;
const FACE_TOO_CLOSE_UPPER_BODY = 0.48;
/** Below this, the person is far enough away that detection gets unreliable. */
const FACE_TOO_FAR = 0.045;
/** Horizontal band, as a fraction of width, that counts as centred. */
const CENTRE_MIN = 0.30;
const CENTRE_MAX = 0.70;

export interface Point { x: number; y: number }

export type BodyCoverage = "upper" | "full";

/**
 * @param landmarks normalised (0..1) face landmarks from MediaPipe, or null/empty
 *                  when no face is detected.
 * @param bodyCoverage "upper" for garments only worn above the waist (shirts,
 *                  t-shirts, jackets, tops), "full" (default) for anything
 *                  where the render needs more of the body visible.
 */
export function evaluateFraming(landmarks: Point[] | null | undefined, bodyCoverage: BodyCoverage = "full"): FramingHint {
  if (!landmarks || landmarks.length === 0) {
    return {
      status: "no-face",
      message: "Step in front of the camera",
      ready: false,
    };
  }

  let minY = 1, maxY = 0, minX = 1, maxX = 0;
  for (const p of landmarks) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }

  const faceHeight = maxY - minY;
  const centreX = (minX + maxX) / 2;
  const tooCloseThreshold = bodyCoverage === "upper" ? FACE_TOO_CLOSE_UPPER_BODY : FACE_TOO_CLOSE_FULL_BODY;

  // Distance dominates: being too close is what actually breaks the render, so
  // it is reported before any centring nitpick.
  if (faceHeight > tooCloseThreshold) {
    return {
      status: "too-close",
      message: bodyCoverage === "upper"
        ? "Step back a little so your upper body is in the frame"
        : "Step back so your full body is in the frame",
      ready: false,
    };
  }

  if (faceHeight < FACE_TOO_FAR) {
    return {
      status: "too-far",
      message: "Step a little closer",
      ready: false,
    };
  }

  // Deliberately not "move left/right": the preview is not mirrored, so a
  // direction would be back-to-front for half the people reading it.
  if (centreX < CENTRE_MIN || centreX > CENTRE_MAX) {
    return {
      status: "off-centre",
      message: "Move to the centre of the frame",
      ready: false,
    };
  }

  return {
    status: "ready",
    message: "Perfect — hold still, capturing...",
    ready: true,
  };
}
