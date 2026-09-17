const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

export interface Garment {
  id: string;
  name: string;
  color: string;
  category: string;
  imageUrl: string;
  price?: number;
  /** URL of a .glb/.gltf model for the 3D Mannequin viewer — the highest
   * quality option when one exists. Optional; most garments won't have one,
   * which is an expected, handled state, not an error (see
   * components/ThreeDMannequin/ModelError.tsx). */
  model3dUrl?: string;
  /** Optional second admin-uploaded photo (back view). Powers the photo-
   * billboard 3D preview fallback when there's no model3dUrl. */
  backImageUrl?: string;
  /** Background-removed cutout of imageUrl, auto-generated server-side
   * (rembg) at upload time — used to texture the front billboard in the 3D
   * Mannequin viewer's photo-preview mode. Not the same image as imageUrl,
   * which still shows the full catalogue photo (model, background, etc). */
  frontCutoutUrl?: string;
  /** Same, derived from backImageUrl. Only present when backImageUrl is. */
  backCutoutUrl?: string;
}

export function isWomensGarment(category: string = "", name: string = ""): boolean {
  const cat = (category || "").toLowerCase();
  const n = (name || "").toLowerCase();

  if (
    cat === "men" || cat === "mens" || cat.includes("men's") ||
    n.includes("men's shirt") || n.includes("men's wear") || n.includes("mens shirt") || n.includes("men shirt")
  ) {
    return false;
  }

  if (
    cat.includes("saree") || cat.includes("women") || cat.includes("dress") || cat.includes("lehenga") || cat.includes("skirt") || cat.includes("kurta") || cat.includes("kurti") ||
    n.includes("saree") || n.includes("women") || n.includes("lehenga") || n.includes("kurti") || n.includes("kurta") || n.includes("dress") || n.includes("anarkali") || n.includes("gown")
  ) {
    return true;
  }

  return false;
}

export function isMensGarment(category: string = "", name: string = ""): boolean {
  if (isWomensGarment(category, name)) return false;

  const cat = (category || "").toLowerCase();
  const n = (name || "").toLowerCase();

  if (
    cat.includes("men") || cat.includes("shirt") || cat.includes("jeans") || cat.includes("pant") || cat.includes("trouser") || cat.includes("suit") || cat.includes("jacket") ||
    n.includes("shirt") || n.includes("jeans") || n.includes("men") || n.includes("suit") || n.includes("pant") || n.includes("trouser") || n.includes("t-shirt") || n.includes("tshirt") || n.includes("jacket") || n.includes("coat")
  ) {
    return true;
  }

  return false;
}

export interface TryOnResponse {
  success: boolean;
  result_image?: string;
  error?: string;
  /** "vertex" = real AI fitting, "local" = flat overlay fallback */
  mode?: "vertex" | "local";
  fallback_reason?: string;
}

export interface GarmentUploadResponse {
  success: boolean;
  garment?: Garment;
  error?: string;
}

/**
 * Checks backend health status.
 */
export async function checkBackendHealth(): Promise<{ status: string; service?: string } | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/health`, { method: "GET" });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("Backend health check failed:", err);
    return null;
  }
}

/**
 * The catalogue only changes when an admin uploads or deletes, but every page
 * mount was re-fetching it -- and React Router remounts on every navigation. So
 * returning from a try-on showed a spinner while Flask round-tripped to
 * Supabase again. Cache it, and let the admin screens invalidate explicitly.
 */
const GARMENTS_TTL_MS = 60_000;
let garmentsCache: { data: Garment[]; at: number } | null = null;
let garmentsInFlight: Promise<Garment[]> | null = null;

export function invalidateGarmentsCache() {
  garmentsCache = null;
  garmentsInFlight = null;
}

/**
 * Fetches all garments from the backend.
 *
 * @param force skip the cache (admin screens, after a mutation)
 */
export async function getGarments(force = false): Promise<Garment[]> {
  if (!force && garmentsCache && Date.now() - garmentsCache.at < GARMENTS_TTL_MS) {
    return garmentsCache.data;
  }
  // Several components can mount at once; share one request between them
  // rather than firing a duplicate per subscriber.
  if (!force && garmentsInFlight) return garmentsInFlight;

  const request = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/garments`, { method: "GET" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Garment[] = await res.json();
      // The local-fallback upload path can return a relative /static/...
      // path for any of these; Supabase-hosted ones are already absolute.
      const absolutize = (url: string | undefined) =>
        url && url.startsWith("/") ? `${API_BASE_URL}${url}` : url;
      const mapped = data.map((item) => ({
        ...item,
        imageUrl: absolutize(item.imageUrl) as string,
        model3dUrl: absolutize(item.model3dUrl),
        backImageUrl: absolutize(item.backImageUrl),
        frontCutoutUrl: absolutize(item.frontCutoutUrl),
        backCutoutUrl: absolutize(item.backCutoutUrl)
      }));
      garmentsCache = { data: mapped, at: Date.now() };
      return mapped;
    } catch (err) {
      console.error("Failed to fetch garments from backend:", err);
      // Serve a stale catalogue rather than an empty kiosk if the network blips.
      return garmentsCache?.data ?? [];
    } finally {
      garmentsInFlight = null;
    }
  })();

  if (!force) garmentsInFlight = request;
  return request;
}

/**
 * Uploads a new garment to the backend.
 */
export async function uploadGarment(data: {
  name: string;
  color: string;
  category: string;
  gender: string;
  image: string; // base64 string
  price?: number;
  /** Optional URL to a hosted .glb/.gltf — not a file upload; the admin
   * pastes a link to an already-hosted model. See AdminPage's upload form. */
  model3dUrl?: string;
  /** Optional second photo (back view), base64 — same shape as `image`. The
   * backend auto-generates a background-removed cutout of both this and
   * `image` for the 3D Mannequin viewer's photo-preview mode. */
  backImage?: string;
}): Promise<GarmentUploadResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/garments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    invalidateGarmentsCache();  // catalogue changed; kiosk must not serve stale
    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      error: `Network error: ${err.message}. Please ensure backend is running at ${API_BASE_URL}`,
    };
  }
}

/**
 * Requests Virtual Try-On processing from backend.
 */
export async function requestVirtualTryOn(
  personImageBase64: string,
  garmentImageBase64: string
): Promise<TryOnResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/try-on`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        person_image: personImageBase64,
        garment_image: garmentImageBase64,
      }),
    });

    // A gateway timeout or crashed worker returns an HTML error page, not JSON.
    // Parsing that blindly surfaced 'Unexpected token "<"' to customers standing
    // at the kiosk. Detect it and show something they can act on instead.
    const body = await res.text();
    let data: TryOnResponse;
    try {
      data = JSON.parse(body);
    } catch {
      console.error(`[Try-On] Non-JSON response (HTTP ${res.status}):`, body.slice(0, 300));
      return {
        success: false,
        error:
          res.status === 504 || res.status === 502
            ? "The try-on is taking longer than expected. Please try again."
            : "Something went wrong generating your try-on. Please try again.",
      };
    }

    if (!res.ok && data.success !== false) {
      return { success: false, error: `Try-on failed (HTTP ${res.status}).` };
    }
    return data;
  } catch (err: any) {
    console.error("[Try-On] Request failed:", err);
    return {
      success: false,
      error: "Could not reach the try-on service. Please check the connection and try again.",
    };
  }
}

/**
 * Helper utility to convert image URL or import asset path to base64 string.
 */
export async function convertUrlToBase64(url: string): Promise<string> {
  if (!url) return "";
  if (url.startsWith("data:image")) {
    return url;
  }
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn("Fetch base64 conversion failed, falling back to Canvas drawImage:", err);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width || 400;
        canvas.height = img.naturalHeight || img.height || 400;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL("image/png"));
        } else {
          reject(new Error("Canvas context unavailable"));
        }
      };
      img.onerror = () => reject(new Error("Image load error"));
      img.src = url;
    });
  }
}

// Women's garment categories
export const WOMEN_CATEGORIES = [
  "Sarees",
  "Lehengas",
  "Kurtas",
  "Anarkali Suits",
  "Dresses",
  "Tops",
  "Blouses",
] as const;

// Men's garment categories
export const MEN_CATEGORIES = [
  "Shirts",
  "T-Shirts",
  "Jeans",
  "Trousers",
  "Jackets",
  "Kurtas",
  "Suits",
  "Ethnic Wear",
] as const;

export const PRODUCT_CATEGORIES = Array.from(
  new Set([...WOMEN_CATEGORIES, ...MEN_CATEGORIES])
) as readonly string[];

export function detectGarmentGender(name: string): "Women" | "Men" {
  const n = (name || "").toLowerCase();
  if (
    n.includes("saree") || n.includes("sari") ||
    n.includes("lehenga") || n.includes("kurti") ||
    n.includes("anarkali") || n.includes("blouse") ||
    n.includes("gown") || n.includes("frock") ||
    n.includes("dupatta") || n.includes("salwar") ||
    n.includes("churidar") || n.includes("women")
  ) return "Women";
  return "Men";
}

export function detectGarmentCategory(name: string): string {
  const n = (name || "").toLowerCase();
  if (n.includes("t-shirt") || n.includes("tshirt") || n.includes("tee")) return "T-Shirts";
  if (n.includes("saree") || n.includes("sari")) return "Sarees";
  if (n.includes("lehenga")) return "Lehengas";
  if (n.includes("anarkali")) return "Anarkali Suits";
  if (n.includes("kurti")) return "Kurtas";
  if (n.includes("kurta")) return n.includes("men") ? "Kurtas" : "Kurtas";
  if (n.includes("blouse")) return "Blouses";
  if (n.includes("jean") || n.includes("denim")) return "Jeans";
  if (n.includes("trouser") || n.includes("pant")) return "Trousers";
  if (n.includes("dress") || n.includes("gown") || n.includes("frock")) return "Dresses";
  if (n.includes("top")) return "Tops";
  if (n.includes("jacket") || n.includes("coat") || n.includes("blazer")) return "Jackets";
  if (n.includes("suit")) return "Suits";
  if (n.includes("ethnic")) return "Ethnic Wear";
  if (n.includes("shirt")) return "Shirts";
  return "Shirts";
}

/**
 * Deletes a garment from the backend.
 */
export async function deleteGarment(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/garments/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    invalidateGarmentsCache();  // catalogue changed; kiosk must not serve stale
    return await res.json();
  } catch (err: any) {
    console.error("Failed to delete garment:", err);
    return { success: false, error: err.message };
  }
}

export interface SupportTicket {
  id: string;
  subject: string;
  category: string;
  priority: string;
  description: string;
  status: string;
  createdAt: string;
}

export interface SystemDiagnostics {
  status: string;
  serverTime: string;
  flaskPort: number;
  supabaseConnected: boolean;
  pythonVersion: string;
  garmentsCount: number;
  services: { name: string; status: string; details: string }[];
}

export async function getSupportTickets(): Promise<SupportTicket[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/support/tickets`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.tickets || [];
  } catch (err) {
    console.error("Failed to fetch support tickets:", err);
    return [];
  }
}

export async function createSupportTicket(ticket: {
  subject: string;
  category: string;
  priority: string;
  description: string;
}): Promise<{ success: boolean; ticket?: SupportTicket; error?: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/support/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ticket),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function updateSupportTicketStatus(
  id: string,
  status: string
): Promise<{ success: boolean; ticket?: SupportTicket; error?: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/support/tickets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function deleteSupportTicket(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/support/tickets/${id}`, { method: "DELETE" });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function getSystemDiagnostics(): Promise<SystemDiagnostics | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/support/diagnostics`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

export interface FeedbackData {
  id?: number;
  session_id: string;
  gender: string;
  selected_garment: string;
  feedback_emoji?: string | null;
  feedback_score?: number | null;
  feedback_status: "submitted" | "skipped";
  created_at?: string;
}

export interface FeedbackAnalyticsResponse {
  success: boolean;
  summary: {
    avg_rating: number;
    total_feedback: number;
    total_skipped: number;
    completion_rate: number;
    emoji_counts: Record<string, number>;
  };
  trends: {
    daily: Array<{ name: string; submitted: number; skipped: number; avg_rating: number }>;
    weekly: Array<{ name: string; submitted: number; skipped: number }>;
    monthly: Array<{ name: string; submitted: number; skipped: number }>;
  };
  recent: FeedbackData[];
  error?: string;
}

export async function submitFeedback(data: FeedbackData): Promise<{ success: boolean; feedback?: FeedbackData; error?: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function getFeedbackAnalytics(): Promise<FeedbackAnalyticsResponse | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/feedback/analytics`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Failed to fetch feedback analytics:", err);
    return null;
  }
}

export async function adminLogin(credentials: { username: string; password: string }): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials)
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || "Login request failed" };
    }
    return data;
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function adminSignup(credentials: { username: string; password: string }): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/admin/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials)
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || "Signup request failed" };
    }
    return data;
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}


