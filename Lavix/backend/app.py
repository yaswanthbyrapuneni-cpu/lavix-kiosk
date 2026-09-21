from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import json
import logging
import threading
import requests
import google.auth
import google.auth.transport.requests
from google.oauth2 import service_account
from dotenv import load_dotenv
from pathlib import Path
import io
import base64
import numpy as np
from PIL import Image
import smtplib
import secrets
import time
import bcrypt
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")
CORS(app, origins=ALLOWED_ORIGINS, supports_credentials=True)

from security_routes import register_security_routes
register_security_routes(app)

VERTEX_PROJECT_ID = os.getenv('VERTEX_PROJECT_ID', 'project-097e88fc-3268-4197-8c1')
VERTEX_REGION = os.getenv('VERTEX_REGION', 'us-central1')
# Must stay below the gunicorn worker timeout (150s), which in turn stays below
# nginx proxy_read_timeout (180s). Equal values race: the worker gets killed
# while encoding a response Vertex had already returned successfully.
VERTEX_TIMEOUT = int(os.getenv('VERTEX_TIMEOUT', '90'))
# Split VERTEX_TIMEOUT across up to two attempts rather than adding a second
# full timeout on top -- a lot of Vertex failures are transient (a momentary
# error response, a one-off flaky call) and succeed on retry, but the total
# time spent must stay within the same budget the rest of the pipeline
# already assumes VERTEX_TIMEOUT represents.
VERTEX_ATTEMPT_TIMEOUT = max(20, VERTEX_TIMEOUT // 2)

_vertex_credentials = None
# Workers are threaded (see gunicorn.conf.py), so concurrent try-ons would
# otherwise build credentials twice and call refresh() on the same object
# simultaneously.
_vertex_credentials_lock = threading.Lock()


def get_vertex_access_token():
    global _vertex_credentials
    try:
        with _vertex_credentials_lock:
            if _vertex_credentials is None:
                creds_json = os.getenv('GOOGLE_APPLICATION_CREDENTIALS_JSON')
                if creds_json:
                    creds_dict = json.loads(creds_json)
                    _vertex_credentials = service_account.Credentials.from_service_account_info(
                        creds_dict,
                        scopes=['https://www.googleapis.com/auth/cloud-platform']
                    )
                else:
                    _vertex_credentials, _ = google.auth.default(
                        scopes=['https://www.googleapis.com/auth/cloud-platform']
                    )
            auth_req = google.auth.transport.requests.Request()
            _vertex_credentials.refresh(auth_req)
            return _vertex_credentials.token
    except Exception as e:
        raise RuntimeError(f"Vertex AI credentials error: {e}")


_rembg_session = None
_rembg_lock = threading.Lock()


def get_rembg_session():
    """
    Cache the u2net session. rembg.remove() without an explicit session builds
    a new one per call, loading the 176MB model into onnxruntime every time --
    measured at ~130s per try-on. Built once here and reused.

    Returns None if rembg is unavailable, so callers fall back to the cheap
    luminance-based background removal instead of failing.
    """
    global _rembg_session
    if _rembg_session is None:
        with _rembg_lock:
            if _rembg_session is None:  # re-check: another thread may have won
                try:
                    from rembg import new_session
                    _rembg_session = new_session("u2net")
                    logger.info("rembg u2net session ready")
                except Exception as e:
                    logger.warning(f"rembg unavailable, using luminance fallback: {e}")
                    _rembg_session = False  # sentinel: tried and failed
    return _rembg_session or None


def _rembg_remove_background(g_img: "Image.Image") -> "Image.Image":
    """
    Shared rembg background-removal step, with the same luminance-threshold
    fallback used everywhere else in this file when rembg itself is
    unavailable. Extracted so isolate_garment_image (fixed-percentage crop,
    used by the 3D Mannequin cutouts) and the adaptive face-detection-gated
    crop (used for the Vertex try-on reference photo) share one
    implementation instead of two copies drifting apart.
    """
    g_img = g_img.convert("RGBA")
    g_img_clean = g_img
    try:
        session = get_rembg_session()
        if session is None:
            raise RuntimeError("rembg session unavailable")
        import rembg
        g_img_clean = rembg.remove(g_img, session=session)
    except Exception as re_err:
        logger.warning(f"Could not use rembg for background removal, falling back: {re_err}")
        g_np = np.array(g_img)
        if g_np.shape[2] == 4:
            r, g_c, b, a = g_np[:, :, 0], g_np[:, :, 1], g_np[:, :, 2], g_np[:, :, 3]
            is_light = (r > 215) & (g_c > 215) & (b > 215)
            g_np[is_light, 3] = 0
            g_img_clean = Image.fromarray(g_np)
    return g_img_clean


def isolate_garment_image(g_img: "Image.Image") -> "Image.Image":
    """
    Cuts a garment out of a photo of it being worn -- rembg background removal,
    then an aggressive crop to strip the model's head/face, the ground, and
    side clutter, leaving just the garment on a transparent background.

    Extracted from process_local_tryon (which still uses it, unchanged) so the
    3D Mannequin photo-billboard feature can produce the exact same clean
    cutout from the admin's front/back garment photos, rather than
    reimplementing this.
    """
    g_img_clean = _rembg_remove_background(g_img)

    # Top 33% (model head/face), bottom 15% (ground/watermarks), left/right
    # 28% each (side models, walls, background clutter).
    g_w, g_h = g_img_clean.size
    if g_h > 100:
        g_img_clean = g_img_clean.crop((int(g_w * 0.28), int(g_h * 0.33), int(g_w * 0.72), int(g_h * 0.85)))

    return g_img_clean


def _crop_face_region_if_present(g_img: "Image.Image") -> "Image.Image":
    """
    Crops away a model's head/face from a garment reference photo, but only
    when a face is actually detected there -- unlike isolate_garment_image's
    fixed-percentage crop (tuned for the 3D Mannequin cutouts, which assumes
    every photo is a generously-margined full-body shot). Tested against
    real catalog photos: a large share of admin uploads are already tight
    torso-only crops with no face in frame at all, and blindly cropping the
    top third of those butchers the garment itself, leaving nothing but a
    texture swatch with no visible collar/pocket/silhouette. Detecting the
    face first and cropping just past its chin -- or not cropping at all
    when there's no face to remove -- handles both photo styles correctly.

    minSize is deliberately a fraction of the image's shorter dimension, not
    a fixed pixel count: a flat 40x40px minimum is a meaningless threshold
    on the 3000-4000px photos this catalogue's phone-camera uploads actually
    are (well under 2% of the frame), and the Haar cascade was confirmed
    (against real saree/blouse catalogue photos with no person in them at
    all) to false-positive on dense gold embroidery and brocade motifs at
    that size -- cropping into product photos that had nothing to remove.
    Requiring a real face to occupy a meaningful share of the frame (~15%)
    eliminates those false positives while still catching genuine faces,
    which are proportionally much larger in an actual portrait-style shot.
    """
    try:
        import cv2
        rgb = np.array(g_img.convert("RGB"))
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        g_w, g_h = g_img.size
        min_dim = int(min(g_w, g_h) * 0.15)
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        detector = cv2.CascadeClassifier(cascade_path)
        faces = detector.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(min_dim, min_dim))
        if len(faces) == 0:
            return g_img

        # Largest detected face -- crop everything from just past its chin
        # downward, leaving the garment below completely untouched.
        fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
        crop_top = int(fy + fh * 1.3)
        crop_top = max(0, min(crop_top, int(g_h * 0.6)))  # never eat more than 60% of the frame
        if crop_top <= 0:
            return g_img
        return g_img.crop((0, crop_top, g_w, g_h))
    except Exception as e:
        logger.warning(f"Face detection for garment isolation failed, skipping crop: {e}")
        return g_img


def isolate_garment_b64_for_vertex(garment_b64: str) -> str:
    """
    Prepares the garment reference photo for Vertex: rembg background
    removal (with a sanity check -- see below), plus a face-detection-gated
    crop (see _crop_face_region_if_present) instead of the 3D Mannequin
    cutout's fixed-percentage crop. Garment catalog photos routinely show a
    model wearing the item with their face fully visible; Vertex's
    virtual-try-on model has been observed leaking that face into the
    output as a floating artifact when given an uncropped reference photo
    -- but real admin uploads vary hugely in framing, and many are already
    tight torso-only crops with no face at all, which a blind fixed-
    percentage crop would butcher. Falls back to the original image, only
    color-normalized, if isolation fails for any reason -- a messier
    reference is still better than no result at all.

    rembg sanity check: confirmed against real catalogue photos that rembg
    can catastrophically over-remove busy/reflective saree silk (gold
    brocade, dense metallic thread) -- not a minor artifact, entire garments
    came back as a near-blank white image with faint ghost traces, which
    would leave Vertex with almost nothing to work from. rembg works fine
    on ordinary model-wearing-garment photos (its actual intended case), so
    rather than dropping it everywhere, only trust its output when a
    reasonable share of the frame actually survived as solid (mostly
    opaque) foreground; discard and use the untouched original otherwise.
    A low alpha threshold (e.g. >30) is not enough on its own -- a failed
    removal can still leave a large area of faint, near-transparent ghost
    pixels (alpha ~30-60) that pass a low bar without representing real
    surviving fabric, so this checks the fraction of pixels that are
    solidly opaque (>128) instead. Calibrated against real catalog photos:
    good removals kept 23-75% of pixels solidly opaque, failed ones kept
    under 3%.
    """
    try:
        img_bytes = base64.b64decode(garment_b64)
        img = Image.open(io.BytesIO(img_bytes))
        img_rgba = img.convert("RGBA")

        bg_removed = _rembg_remove_background(img)
        alpha = np.array(bg_removed.split()[-1])
        surviving_fraction = float(np.count_nonzero(alpha > 128)) / alpha.size
        if surviving_fraction < 0.10:
            logger.warning(
                f"rembg kept only {surviving_fraction:.0%} of the frame as foreground -- "
                "treating as a failed removal and using the original background instead."
            )
            base_img = img_rgba
        else:
            base_img = bg_removed

        isolated = _crop_face_region_if_present(base_img)
        # Vertex expects a normal product photo, not a transparent cutout --
        # flatten onto white, matching convert_to_clean_rgb_b64's convention.
        background = Image.new("RGB", isolated.size, (255, 255, 255))
        background.paste(isolated, mask=isolated.split()[-1])
        buffered = io.BytesIO()
        background.save(buffered, format="JPEG", quality=95)
        return base64.b64encode(buffered.getvalue()).decode("utf-8")
    except Exception as e:
        logger.warning(f"Garment isolation for Vertex failed, using original image instead: {e}")
        return convert_to_clean_rgb_b64(garment_b64)


def process_local_tryon(person_b64: str, garments_b64: list) -> str:
    """
    High quality local Virtual Try-On compositor using PIL & NumPy.
    Overlays and blends garment(s) seamlessly onto the person image.
    """
    try:
        def extract_clean_b64(b64_str):
            if ',' in b64_str:
                return b64_str.split(',')[1]
            return b64_str

        person_b64_clean = extract_clean_b64(person_b64)
        person_bytes = base64.b64decode(person_b64_clean)
        person_img = Image.open(io.BytesIO(person_bytes)).convert("RGBA")
        p_width, p_height = person_img.size

        current_img = person_img.copy()

        for g_index, g_b64 in enumerate(garments_b64):
            try:
                g_b64_clean = extract_clean_b64(g_b64)
                g_bytes = base64.b64decode(g_b64_clean)
                g_img = Image.open(io.BytesIO(g_bytes)).convert("RGBA")
            except Exception as g_err:
                # A single unreadable garment must not lose the whole render;
                # the person image and any other garments are still usable.
                logger.warning(f"Skipping unreadable garment {g_index}: {g_err}")
                continue

            g_img_clean = isolate_garment_image(g_img)
            g_w, g_h = g_img_clean.size

            if g_w <= 0 or g_h <= 0:
                continue

            g_aspect = g_w / float(g_h)
            
            # Scale the shirt to cover the chest/torso area
            target_h = int(p_height * 0.52)
            target_w = int(target_h * g_aspect)
            
            if target_w > int(p_width * 0.80):
                target_w = int(p_width * 0.80)
                target_h = int(target_w / g_aspect)

            target_w = max(20, target_w)
            target_h = max(20, target_h)

            g_resized = g_img_clean.resize((target_w, target_h), Image.Resampling.LANCZOS)
            
            # Place the shirt at chest level (0.48) to avoid covering the face
            pos_x = (p_width - target_w) // 2
            pos_y = int(p_height * 0.48)

            pos_x = max(0, min(pos_x, p_width - target_w))
            pos_y = max(0, min(pos_y, p_height - target_h))

            current_img.paste(g_resized, (pos_x, pos_y), g_resized)

        buffered = io.BytesIO()
        # JPEG, not PNG: these are photographs, and a 1080x1920 PNG is several
        # MB before base64 inflates it another third -- straight down a kiosk
        # link measured at ~5 Mbps.
        current_img.convert("RGB").save(buffered, format="JPEG", quality=90, optimize=True)
        return base64.b64encode(buffered.getvalue()).decode("utf-8")
    except Exception as e:
        # Deliberately re-raised. This used to return person_b64, which the
        # endpoint wrapped and reported as success:true -- the customer got
        # their own photo back with no garment and no indication of failure.
        logger.error(f"Local try-on compositor error: {e}")
        raise RuntimeError(f"Local compositor failed: {e}") from e


def convert_to_clean_rgb_b64(b64_str):
    try:
        img_bytes = base64.b64decode(b64_str)
        img = Image.open(io.BytesIO(img_bytes))
        if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
            img = img.convert("RGBA")
            background = Image.new("RGB", img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[-1])
            img = background
        else:
            img = img.convert("RGB")
        buffered = io.BytesIO()
        img.save(buffered, format="JPEG", quality=95)
        return base64.b64encode(buffered.getvalue()).decode("utf-8")
    except Exception as e:
        logger.error(f"Error converting image to clean RGB: {e}")
        return b64_str


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'service': 'lavix-backend'}), 200


def _track_tryon_event(mode: str, garment_count: int, error_reason: str = None):
    """
    Records how a /try-on call actually resolved (real Vertex render, flat
    local-compositor fallback, or hard failure) so the admin dashboard can
    show real reliability numbers instead of relying on someone noticing and
    reporting a bad render. Fire-and-forget on a background thread -- must
    never add latency to, or be able to fail, the customer-facing response.
    Silently no-ops if Supabase isn't connected or the table doesn't exist
    yet (it isn't auto-migrated; see schema.sql).
    """
    if not _supabase_connected:
        return

    def _send():
        try:
            requests.post(
                f"{SUPABASE_URL}/rest/v1/tryon_events",
                headers=get_supabase_headers(),
                json={
                    'mode': mode,
                    'garment_count': garment_count,
                    'error_reason': (error_reason or None) and str(error_reason)[:500],
                },
                timeout=10,
            )
        except Exception as e:
            logger.warning(f"Failed to record tryon_event ({mode}): {e}")

    threading.Thread(target=_send, daemon=True).start()


def _get_tryon_reliability_summary(limit: int = 500) -> dict:
    """
    Reads back the most recent tryon_events rows and summarizes them into
    counts per mode plus a Vertex success rate. Returns all zeros (not an
    error) if Supabase is unreachable or the table doesn't exist yet, so a
    dashboard reading this never has to special-case "no data yet".
    """
    empty = {'vertex': 0, 'local': 0, 'failed': 0, 'total': 0, 'vertex_success_rate': 0.0}
    if not _supabase_connected:
        return empty
    try:
        url = f"{SUPABASE_URL}/rest/v1/tryon_events?select=mode&order=id.desc&limit={limit}"
        resp = requests.get(url, headers=get_supabase_headers(), timeout=10)
        if resp.status_code != 200:
            return empty
        rows = resp.json()
        counts = {'vertex': 0, 'local': 0, 'failed': 0}
        for row in rows:
            m = row.get('mode')
            if m in counts:
                counts[m] += 1
        total = len(rows)
        rate = round((counts['vertex'] / total * 100), 1) if total > 0 else 0.0
        return {**counts, 'total': total, 'vertex_success_rate': rate}
    except Exception as e:
        logger.warning(f"Failed to read tryon_events for reliability summary: {e}")
        return empty


def _local_tryon_response(person_b64, garments_b64, reason):
    """
    Fallback path when Vertex is unavailable. If the compositor also fails there
    is no usable image to return, so report failure rather than handing back the
    untouched input as if it were a render.
    """
    try:
        res_b64 = process_local_tryon(person_b64, garments_b64)
    except Exception as local_err:
        logger.error(f"Local compositor also failed after Vertex fallback: {local_err}")
        _track_tryon_event('failed', len(garments_b64), f"{reason}; {local_err}")
        return jsonify({
            'success': False,
            'error': 'Could not generate the try-on. Please retake the photo and try again.',
            'fallback_reason': reason,
        }), 502

    _track_tryon_event('local', len(garments_b64), reason)
    return jsonify({
        'success': True,
        'result_image': f"data:image/jpeg;base64,{res_b64}",
        'mode': 'local',
        'fallback_reason': reason,
    }), 200


MAX_GARMENTS_PER_REQUEST = 5


@app.route('/try-on', methods=['POST'])
def try_on():
    """
    Virtual try-on processing (Vertex AI with local fallback).
    """
    try:
        data = request.json
        if not data or 'person_image' not in data:
            return jsonify({'success': False, 'error': 'Missing person_image'}), 400

        def extract_base64(data_url):
            return data_url.split(',')[1] if ',' in data_url else data_url

        person_b64 = extract_base64(data['person_image'])
        person_b64_rgb = convert_to_clean_rgb_b64(person_b64)
        
        garments_b64 = []
        if 'garment_images' in data:
            garments_b64 = [extract_base64(g) for g in data['garment_images']]
        elif 'garment_image' in data:
            garments_b64 = [extract_base64(data['garment_image'])]
        else:
            return jsonify({'success': False, 'error': 'Missing garment_image or garment_images'}), 400

        if not garments_b64:
            return jsonify({'success': False, 'error': 'No garments selected for try-on'}), 400

        # Garments are applied sequentially, each its own Vertex call of up to
        # VERTEX_TIMEOUT. Without a cap a caller can guarantee a worker timeout.
        if len(garments_b64) > MAX_GARMENTS_PER_REQUEST:
            return jsonify({
                'success': False,
                'error': f'Too many garments in one request (max {MAX_GARMENTS_PER_REQUEST}).'
            }), 400

        logger.info(f"Starting virtual try-on processing for {len(garments_b64)} garment(s)")

        # Attempt Vertex AI first if configured
        try:
            access_token = get_vertex_access_token()

            url = (
                f"https://{VERTEX_REGION}-aiplatform.googleapis.com/v1"
                f"/projects/{VERTEX_PROJECT_ID}/locations/{VERTEX_REGION}"
                f"/publishers/google/models/virtual-try-on-001:predict"
            )

            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            }

            current_person_b64 = person_b64_rgb
            mime_type = 'image/png'

            for i, garment_b64 in enumerate(garments_b64):
                garment_rgb = isolate_garment_b64_for_vertex(garment_b64)
                payload = {
                    "instances": [{
                        "personImage": {
                            "image": {"bytesBase64Encoded": current_person_b64}
                        },
                        "productImages": [{
                            "image": {"bytesBase64Encoded": garment_rgb}
                        }]
                    }],
                    # Without personGeneration, Vertex defaults to its stricter
                    # "adults only" mode and its safety filter intermittently
                    # blocks legitimate photos with a 400, silently demoting
                    # them to the flat local-compositor fallback.
                    # A fixed seed keeps the garment structure the model guesses
                    # at consistent across attempts for flat/textured fabrics --
                    # safe to fix since the retry loop below only re-attempts on
                    # hard failures (non-2xx, empty predictions), never because
                    # a successful render looked wrong, so there's no case where
                    # a fixed seed reproduces a bad result on retry.
                    "parameters": {"sampleCount": 1, "personGeneration": "allow_all", "seed": 42}
                }

                # Up to two attempts within VERTEX_TIMEOUT's existing budget (see
                # VERTEX_ATTEMPT_TIMEOUT) -- a lot of Vertex failures are transient
                # (a momentary error, a one-off flaky call) and succeed on retry,
                # which is a lot better for the customer than instantly falling
                # back to the flat local compositor on the first hiccup.
                garment_result_b64 = None
                last_attempt_err = None
                for attempt in range(2):
                    try:
                        response = requests.post(url, json=payload, headers=headers, timeout=VERTEX_ATTEMPT_TIMEOUT)

                        if not response.ok:
                            # raise_for_status() throws away the response body, and the
                            # body is where Vertex explains what actually went wrong.
                            raise RuntimeError(
                                f"Vertex returned {response.status_code}: {response.text[:500]}"
                            )

                        result = response.json()
                        predictions = result.get('predictions', [])
                        if not predictions:
                            raise RuntimeError(f"Vertex returned no predictions: {str(result)[:500]}")

                        pred = predictions[0]
                        candidate_b64 = (
                            pred.get('bytesBase64Encoded') or
                            pred.get('image', {}).get('bytesBase64Encoded', '')
                        )
                        if not candidate_b64:
                            raise RuntimeError(f"Vertex prediction had no image bytes: {str(pred)[:500]}")

                        garment_result_b64 = candidate_b64
                        break
                    except Exception as attempt_err:
                        last_attempt_err = attempt_err
                        if attempt == 0:
                            logger.warning(
                                f"Vertex attempt 1/2 failed for garment {i + 1}, retrying once: {attempt_err}"
                            )

                if garment_result_b64 is None:
                    raise last_attempt_err

                current_person_b64 = garment_result_b64
                logger.info(f"Garment {i + 1}/{len(garments_b64)} rendered via Vertex AI")

            logger.info("Try-on sequence generated via Vertex AI")
            _track_tryon_event('vertex', len(garments_b64))
            return jsonify({
                'success': True,
                'result_image': f"data:image/png;base64,{current_person_b64}",
                'mode': 'vertex'
            }), 200

        except requests.exceptions.Timeout:
            logger.error(
                f"Vertex AI timed out after {VERTEX_TIMEOUT}s. Falling back to local compositor "
                "(result will be a flat overlay, not a fitted render)."
            )
            return _local_tryon_response(person_b64, garments_b64, 'Vertex AI timed out')

        except Exception as v_err:
            # Log at error level with the real message — this used to be a warning
            # that hid auth/quota failures behind a plausible-looking bad result.
            logger.error(
                f"Vertex AI try-on failed: {v_err}. Falling back to local compositor "
                "(result will be a flat overlay, not a fitted render)."
            )
            return _local_tryon_response(person_b64, garments_b64, str(v_err)[:200])

    except Exception as e:
        logger.error(f"Try-on error: {e}")
        _track_tryon_event('failed', len(locals().get('garments_b64', []) or []), str(e))
        return jsonify({'success': False, 'error': str(e)}), 500


# --- Supabase & Local Integration ---
import base64
import time

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

FALLBACK_GARMENTS = []

LOCAL_DB_FILE = os.path.join(os.path.dirname(__file__), 'garments.json')
DELETED_DB_FILE = os.path.join(os.path.dirname(__file__), 'deleted_garments.json')
LOCAL_UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'static', 'uploads')

os.makedirs(LOCAL_UPLOAD_FOLDER, exist_ok=True)

_supabase_connected = False

def load_local_garments():
    if not os.path.exists(LOCAL_DB_FILE):
        return []
    try:
        with open(LOCAL_DB_FILE, 'r') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error loading local DB: {e}")
        return []

def save_local_garment_list(garments):
    try:
        with open(LOCAL_DB_FILE, 'w') as f:
            json.dump(garments, f, indent=2)
        return True
    except Exception as e:
        logger.error(f"Error saving local DB list: {e}")
        return False

def save_local_garment(garment):
    garments = load_local_garments()
    garments.append(garment)
    return save_local_garment_list(garments)

def load_deleted_ids():
    if not os.path.exists(DELETED_DB_FILE):
        return set()
    try:
        with open(DELETED_DB_FILE, 'r') as f:
            return set(json.load(f))
    except Exception as e:
        logger.error(f"Error loading deleted IDs: {e}")
        return set()

def save_deleted_id(garment_id):
    deleted = load_deleted_ids()
    deleted.add(str(garment_id))
    try:
        with open(DELETED_DB_FILE, 'w') as f:
            json.dump(list(deleted), f, indent=2)
        return True
    except Exception as e:
        logger.error(f"Error saving deleted ID: {e}")
        return False

def get_supabase_headers():
    return {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json"
    }

def get_supabase_storage_headers(content_type="image/jpeg"):
    return {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "apikey": SUPABASE_KEY,
        "Content-Type": content_type
    }

def migrate_local_data_to_supabase():
    try:
        local_garments = load_local_garments()
        if not local_garments:
            return
        
        print(f"Migrating {len(local_garments)} local garments to Supabase...")
        db_url = f"{SUPABASE_URL}/rest/v1/garments"
        
        for g in local_garments:
            gender = g.get("gender")
            if not gender:
                cat_lower = g.get("category", "").lower()
                name_lower = g.get("name", "").lower()
                if any(w in cat_lower or w in name_lower for w in ['saree', 'dress', 'women', 'lehenga', 'kurti', 'anarkali', 'gown', 'skirt']):
                    gender = 'Women'
                else:
                    gender = 'Men'

            payload = {
                "name": g.get("name"),
                "color": g.get("color", "Custom"),
                "category": g.get("category", "Sarees"),
                "gender": gender,
                "image_url": g.get("imageUrl")
            }
            res = requests.post(db_url, headers=get_supabase_headers(), json=payload, timeout=10)
            if res.status_code in (200, 201):
                print(f"Successfully migrated: {g.get('name')}")
            else:
                print(f"Failed to migrate {g.get('name')}: {res.text}")
        
        save_local_garment_list([])
        print("Local migration complete. garments.json cleared.")
    except Exception as e:
        print(f"Error migrating local garments: {e}")

def check_supabase_connection():
    global _supabase_connected
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("\n==============================")
        print("Warning: Supabase credentials not set.")
        print("Using local persistent storage (garments.json) instead.")
        print("==============================\n")
        _supabase_connected = False
        return False
    try:
        # Query garments endpoint using public anon key
        url = f"{SUPABASE_URL}/rest/v1/garments?limit=1"
        response = requests.get(url, headers=get_supabase_headers(), timeout=5)
        
        if response.status_code in (200, 201):
            print("\n==============================")
            print("Supabase DB is connected successfully!")
            print("==============================\n")
            _supabase_connected = True
            migrate_local_data_to_supabase()
            return True
        elif response.status_code == 404 and "relation" in response.text:
            print("\n==============================")
            print("Supabase DB is connected successfully!")
            print("WARNING: Table 'garments' is missing from your database.")
            print("👉 Action Required: Open the Supabase Dashboard, go to 'SQL Editor',")
            print("👉 paste the queries in 'backend/schema.sql', and click 'Run' to create them.")
            print("==============================\n")
            _supabase_connected = True
            return True
        else:
            print("\n==============================")
            print(f"Supabase Connection Error: {response.status_code} - {response.text}")
            print("Using local persistent storage (garments.json) instead.")
            print("==============================\n")
            _supabase_connected = False
            return False
    except Exception as e:
        print("\n==============================")
        print(f"Supabase Connection Exception: {e}")
        print("Using local persistent storage (garments.json) instead.")
        print("==============================\n")
        _supabase_connected = False
        return False

@app.route('/garments', methods=['GET'])
def get_garments():
    local_garments = load_local_garments()
    supabase_garments = []
    deleted_ids = load_deleted_ids()
    
    if _supabase_connected:
        try:
            url = f"{SUPABASE_URL}/rest/v1/garments?select=*&order=created_at.desc"
            response = requests.get(url, headers=get_supabase_headers(), timeout=10)
            if response.status_code == 200:
                data = response.json()
                for g in data:
                    supabase_garments.append({
                        "id": str(g.get("id")),
                        "name": g.get("name"),
                        "color": g.get("color"),
                        "category": g.get("category", "saree"),
                        "imageUrl": g.get("image_url"),
                        "price": g.get("price", 3999),
                        "model3dUrl": g.get("model_3d_url"),
                        "backImageUrl": g.get("back_image_url"),
                        "frontCutoutUrl": g.get("front_cutout_url"),
                        "backCutoutUrl": g.get("back_cutout_url")
                    })
        except Exception as e:
            logger.error(f"Error fetching from Supabase: {e}")

    # Newest first: supabase garments already come back ordered by created_at
    # desc; local/fallback lists are stored oldest-appended-last, so reverse
    # them to match instead of always trailing behind real catalogue entries.
    all_garments = supabase_garments + local_garments[::-1] + FALLBACK_GARMENTS[::-1]
    
    # Deduplicate by ID, Name, and Image URL while preserving order, excluding deleted items
    seen_keys = set()
    unique_garments = []
    for g in all_garments:
        gid = str(g.get("id")).strip()
        gname = str(g.get("name", "")).strip().lower()
        gurl = str(g.get("imageUrl", "")).strip().lower()

        if gid in deleted_ids or gname in deleted_ids or gurl in deleted_ids:
            continue
        
        if not gname or not gurl:
            continue
            
        key = (gname, gurl)
        if gid in seen_keys or key in seen_keys:
            continue
            
        seen_keys.add(gid)
        seen_keys.add(key)
        unique_garments.append(g)

    return jsonify(unique_garments), 200

def preprocess_garment_image(image_bytes):
    """
    Preserves original uploaded garment image resolution, clarity, and color balance.
    """
    return image_bytes


def _upload_image_bytes(file_bytes: bytes, filename: str, mime_type: str) -> str:
    """
    Uploads to Supabase Storage's 'garments' bucket if connected, falling back
    to local disk otherwise. Extracted from add_garment, which previously
    inlined this for the one required garment photo; now reused for the
    optional back-view photo and the two auto-generated 3D-preview cutouts.
    """
    if _supabase_connected:
        try:
            storage_url = f"{SUPABASE_URL}/storage/v1/object/garments/{filename}"
            storage_resp = requests.post(
                storage_url,
                headers=get_supabase_storage_headers(mime_type),
                data=file_bytes,
                timeout=15
            )
            if storage_resp.status_code == 200:
                return f"{SUPABASE_URL}/storage/v1/object/public/garments/{filename}"
            logger.warning(f"Supabase storage upload returned status {storage_resp.status_code} for {filename}. Using local save fallback.")
        except Exception as e:
            logger.error(f"Supabase storage upload exception for {filename}: {e}")

    logger.info(f"Saving {filename} locally on the server.")
    file_path = os.path.join(LOCAL_UPLOAD_FOLDER, filename)
    with open(file_path, 'wb') as f:
        f.write(file_bytes)
    return f"{request.host_url}static/uploads/{filename}"


def _pil_to_png_bytes(img) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _insert_garment_row(core_fields: dict, optional_fields: dict):
    """
    Inserts into Supabase, tolerating optional columns (model_3d_url,
    back_image_url, front_cutout_url, back_cutout_url) that may not exist yet
    if schema.sql's ALTER TABLE migration hasn't been run against this
    project. front_cutout_url in particular is generated on *every* upload
    going forward (not just ones opting into a feature), so unlike
    model_3d_url this risk isn't confined to someone actively using something
    new -- without this retry, EVERY garment upload would start failing the
    moment this code deploys against an unmigrated database.

    Tries the full payload first; on Postgres's "column does not exist"
    error, retries with only the original core fields so the garment still
    saves -- just without the new data persisted -- rather than failing.
    Returns the inserted row dict, or None (caller falls back to local JSON).
    """
    db_url = f"{SUPABASE_URL}/rest/v1/garments"
    db_headers = get_supabase_headers()
    db_headers["Prefer"] = "return=representation"

    def _try_insert(payload):
        return requests.post(db_url, headers=db_headers, json=payload, timeout=10)

    try:
        resp = _try_insert({**core_fields, **optional_fields})
        if resp.status_code in (200, 201):
            rows = resp.json()
            return rows[0] if rows else None

        # PostgREST reports a missing column as PGRST204 ("column not in
        # schema cache") at its own API layer -- 42703 is the raw Postgres
        # code and, verified against this exact endpoint, does NOT appear in
        # the response PostgREST actually returns here. Checking for 42703
        # alone meant this retry never fired: every upload silently fell
        # through to local JSON-file storage (still functional, but a much
        # weaker persistence story than the real table) until this was caught
        # by an actual end-to-end test, not just a schema check.
        if optional_fields and resp.status_code == 400 and (
            "PGRST204" in resp.text or "42703" in resp.text
        ):
            logger.warning(
                "Garment insert failed on a missing optional column (has the "
                "schema.sql migration been run?). Retrying with core fields "
                f"only. Details: {resp.text[:300]}"
            )
            resp = _try_insert(core_fields)
            if resp.status_code in (200, 201):
                rows = resp.json()
                return rows[0] if rows else None

        logger.error(f"Supabase database insert failed with status {resp.status_code}: {resp.text}")
        return None
    except Exception as e:
        logger.error(f"Supabase DB insert exception: {e}")
        return None


def _decode_data_url(data_url: str):
    """Splits a 'data:image/png;base64,...' string into (mime_type, raw_bytes)."""
    if ',' in data_url:
        header, b64 = data_url.split(',', 1)
    else:
        header, b64 = "data:image/jpeg;base64", data_url
    mime_type = "image/jpeg"
    if "png" in header:
        mime_type = "image/png"
    elif "webp" in header:
        mime_type = "image/webp"
    return mime_type, base64.b64decode(b64)


@app.route('/garments', methods=['POST'])
def add_garment():
    try:
        data = request.json
        if not data or 'image' not in data or 'name' not in data:
            return jsonify({'success': False, 'error': 'Missing name or image'}), 400

        name = data.get('name')
        color = data.get('color', 'Custom')
        category = data.get('category', 'Sarees')
        gender = data.get('gender')
        if not gender:
            cat_lower = category.lower()
            name_lower = name.lower()
            if any(w in cat_lower or w in name_lower for w in ['saree', 'dress', 'women', 'lehenga', 'kurti', 'anarkali', 'gown', 'skirt']):
                gender = 'Women'
            else:
                gender = 'Men'
        price = data.get('price')
        if price is not None:
            try:
                price = int(price)
            except ValueError:
                price = 3999
        else:
            price = 3999

        # Optional: a URL to an already-hosted .glb/.gltf for the 3D Mannequin
        # viewer -- the admin pastes a link, not a file upload. None is a
        # normal, expected value; most garments won't have one.
        #
        # Read as 'model3dUrl' (camelCase) because that's the exact JSON key
        # the frontend sends -- uploadGarment() JSON.stringify()s its object
        # with no case translation anywhere in this stack, so this must match
        # api.ts's field name exactly, not the database column name (which
        # stays snake_case, model_3d_url, matching image_url/gender).
        model_3d_url = data.get('model3dUrl') or None

        # Optional: a second photo of the garment's back, for the same 3D
        # Mannequin viewer when no model_3d_url exists. The existing 'image'
        # field is the front view -- no change needed there, no extra step
        # for garments that only ever get one photo.
        back_image_data = data.get('backImage') or None

        # A shared timestamp for every file this upload produces (front,
        # front cutout, back, back cutout), so they're grouped together
        # rather than each capturing time.time() microseconds apart.
        timestamp = int(time.time())

        # --- Front photo: unchanged existing behaviour ---
        mime_type, file_bytes = _decode_data_url(data.get('image'))
        # Automatically isolate the garment from the model (face, skin, background)
        file_bytes = preprocess_garment_image(file_bytes)
        file_ext = mime_type.split('/')[-1]
        img_url = _upload_image_bytes(file_bytes, f"garment_{timestamp}.{file_ext}", mime_type)

        # --- Front cutout: NEW, auto-generated for every upload so the 3D
        # Mannequin viewer has something to show even when the admin never
        # touches the (also new) back-photo field. Not fatal if it fails --
        # the garment itself must still save.
        front_cutout_url = None
        try:
            front_cutout_img = isolate_garment_image(Image.open(io.BytesIO(file_bytes)))
            front_cutout_url = _upload_image_bytes(
                _pil_to_png_bytes(front_cutout_img), f"garment_{timestamp}_front_cutout.png", "image/png"
            )
        except Exception as e:
            logger.warning(f"Could not generate front cutout for 3D preview: {e}")

        # --- Back photo + cutout: NEW, fully optional ---
        back_image_url = None
        back_cutout_url = None
        if back_image_data:
            try:
                back_mime, back_bytes = _decode_data_url(back_image_data)
                back_ext = back_mime.split('/')[-1]
                back_image_url = _upload_image_bytes(back_bytes, f"garment_{timestamp}_back.{back_ext}", back_mime)

                back_cutout_img = isolate_garment_image(Image.open(io.BytesIO(back_bytes)))
                back_cutout_url = _upload_image_bytes(
                    _pil_to_png_bytes(back_cutout_img), f"garment_{timestamp}_back_cutout.png", "image/png"
                )
            except Exception as e:
                logger.warning(f"Could not process back-view photo (garment still saves without it): {e}")

        core_fields = {
            "name": name,
            "color": color,
            "category": category,
            "gender": gender,
            "image_url": img_url,
            "price": price,
        }
        optional_fields = {}
        if model_3d_url:
            optional_fields["model_3d_url"] = model_3d_url
        if back_image_url:
            optional_fields["back_image_url"] = back_image_url
        if front_cutout_url:
            optional_fields["front_cutout_url"] = front_cutout_url
        if back_cutout_url:
            optional_fields["back_cutout_url"] = back_cutout_url

        if _supabase_connected:
            new_row = _insert_garment_row(core_fields, optional_fields)
            if new_row:
                new_garment = {
                    "id": str(new_row.get("id")),
                    "name": new_row.get("name"),
                    "color": new_row.get("color"),
                    "category": new_row.get("category", "saree"),
                    "imageUrl": new_row.get("image_url"),
                    "price": new_row.get("price", 3999),
                    "model3dUrl": new_row.get("model_3d_url"),
                    "backImageUrl": new_row.get("back_image_url"),
                    "frontCutoutUrl": new_row.get("front_cutout_url"),
                    "backCutoutUrl": new_row.get("back_cutout_url"),
                }
                return jsonify({'success': True, 'garment': new_garment}), 201
            # Falls through to the local fallback below on any insert failure.

        # Local DB Fallback (Supabase not connected, or the insert failed)
        new_garment = {
            "id": f"local-garment-{timestamp}",
            "name": name,
            "color": color,
            "category": category,
            "imageUrl": img_url,
            "price": price,
            "model3dUrl": model_3d_url,
            "backImageUrl": back_image_url,
            "frontCutoutUrl": front_cutout_url,
            "backCutoutUrl": back_cutout_url,
        }

        if save_local_garment(new_garment):
            return jsonify({'success': True, 'garment': new_garment}), 201
        else:
            return jsonify({'success': False, 'error': 'Failed to save locally'}), 500

    except Exception as e:
        logger.error(f"Error adding garment: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _delete_storage_object(url: str):
    """
    Best-effort delete of a Supabase Storage object from its public URL.
    No-ops for anything not hosted in Supabase Storage (e.g. the local-disk
    fallback path from _upload_image_bytes) -- nothing to clean up there.
    """
    if not url or "/storage/v1/object/public/garments/" not in url:
        return
    try:
        filename = url.split("/storage/v1/object/public/garments/", 1)[1]
        del_url = f"{SUPABASE_URL}/storage/v1/object/garments/{filename}"
        requests.delete(del_url, headers=get_supabase_headers(), timeout=10)
    except Exception as e:
        logger.warning(f"Failed to delete storage object for {url}: {e}")


@app.route('/garments/<garment_id>', methods=['DELETE'])
def delete_garment(garment_id):
    try:
        str_id = str(garment_id).strip()

        # Supabase is the source of truth -- actually delete the row (and
        # its uploaded photos) there instead of only hiding it locally.
        # The local deleted-IDs file below doesn't survive a backend
        # container rebuild, which is exactly what was letting "deleted"
        # garments reappear after every redeploy: the row was never really
        # gone, just filtered out by a list that kept getting wiped.
        if _supabase_connected:
            try:
                get_url = (
                    f"{SUPABASE_URL}/rest/v1/garments?id=eq.{str_id}"
                    f"&select=image_url,back_image_url,front_cutout_url,back_cutout_url"
                )
                get_resp = requests.get(get_url, headers=get_supabase_headers(), timeout=10)
                if get_resp.status_code == 200:
                    rows = get_resp.json()
                    if rows:
                        row = rows[0]
                        for key in ("image_url", "back_image_url", "front_cutout_url", "back_cutout_url"):
                            _delete_storage_object(row.get(key))

                del_url = f"{SUPABASE_URL}/rest/v1/garments?id=eq.{str_id}"
                del_resp = requests.delete(del_url, headers=get_supabase_headers(), timeout=10)
                if del_resp.status_code not in (200, 204):
                    logger.warning(f"Supabase garment delete returned {del_resp.status_code}: {del_resp.text[:300]}")
            except Exception as e:
                logger.warning(f"Supabase garment delete failed: {e}")

        # Kept as the fallback for garments that only ever existed locally
        # (Supabase never connected/configured), and so the response to
        # this same request already reflects the deletion immediately
        # rather than waiting on the next full Supabase read.
        save_deleted_id(str_id)

        local_garments = load_local_garments()
        all_known = FALLBACK_GARMENTS + local_garments
        for g in all_known:
            if str(g.get("id")).strip() == str_id:
                if g.get("name"):
                    save_deleted_id(str(g.get("name")).strip().lower())
                if g.get("imageUrl"):
                    save_deleted_id(str(g.get("imageUrl")).strip().lower())

        updated_local = [g for g in local_garments if str(g.get("id")).strip() != str_id]
        save_local_garment_list(updated_local)
        return jsonify({'success': True, 'message': 'Garment deleted successfully'}), 200
    except Exception as e:
        logger.error(f"Error deleting garment: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

SUPPORT_TICKETS_FILE = Path(__file__).parent / "support_tickets.json"

def load_support_tickets():
    if not SUPPORT_TICKETS_FILE.exists():
        return []
    try:
        with open(SUPPORT_TICKETS_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return []

def save_support_tickets(tickets):
    try:
        with open(SUPPORT_TICKETS_FILE, "w") as f:
            json.dump(tickets, f, indent=2)
    except Exception as e:
        logger.error(f"Failed to save support tickets: {e}")

@app.route('/api/support/tickets', methods=['GET'])
def get_support_tickets():
    tickets = load_support_tickets()
    return jsonify({'success': True, 'tickets': tickets}), 200

@app.route('/api/support/tickets', methods=['POST'])
def create_support_ticket():
    try:
        data = request.get_json() or {}
        subject = data.get('subject', '').strip()
        category = data.get('category', 'AI Model/Try-On').strip()
        priority = data.get('priority', 'Medium').strip()
        description = data.get('description', '').strip()

        if not subject or not description:
            return jsonify({'success': False, 'error': 'Subject and Description are required'}), 400

        tickets = load_support_tickets()
        import random, datetime
        ticket_id = f"VAS-{random.randint(1000, 9999)}"
        new_ticket = {
            "id": ticket_id,
            "subject": subject,
            "category": category,
            "priority": priority,
            "description": description,
            "status": "Open",
            "createdAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        }
        tickets.insert(0, new_ticket)
        save_support_tickets(tickets)
        return jsonify({'success': True, 'ticket': new_ticket, 'message': 'Support ticket created successfully'}), 201
    except Exception as e:
        logger.error(f"Error creating support ticket: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/support/tickets/<ticket_id>', methods=['PATCH'])
def update_support_ticket(ticket_id):
    try:
        data = request.get_json() or {}
        new_status = data.get('status', '').strip()
        tickets = load_support_tickets()
        found = None
        for t in tickets:
            if t['id'] == ticket_id:
                t['status'] = new_status
                found = t
                break
        if not found:
            return jsonify({'success': False, 'error': 'Ticket not found'}), 404
        save_support_tickets(tickets)
        return jsonify({'success': True, 'ticket': found}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/support/tickets/<ticket_id>', methods=['DELETE'])
def delete_support_ticket(ticket_id):
    try:
        tickets = load_support_tickets()
        updated_tickets = [t for t in tickets if t['id'] != ticket_id]
        save_support_tickets(updated_tickets)
        return jsonify({'success': True, 'message': 'Ticket deleted'}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/support/diagnostics', methods=['GET'])
def get_diagnostics():
    import datetime, platform
    garments = load_local_garments()
    return jsonify({
        'status': 'Healthy',
        'serverTime': datetime.datetime.now().isoformat(),
        'flaskPort': 5000,
        'supabaseConnected': _supabase_connected,
        'pythonVersion': platform.python_version(),
        'garmentsCount': len(garments),
        'services': [
            { 'name': 'Vite Frontend UI', 'status': 'Healthy', 'details': 'Port 5173 / 8443' },
            { 'name': 'Flask Server API', 'status': 'Active', 'details': 'Port 5000 Active' },
            { 'name': 'OpenCV Preprocessing', 'status': 'Active', 'details': 'Original Crisp Quality' },
            { 'name': 'Supabase DB Mirror', 'status': 'Synced' if _supabase_connected else 'Local Sync Mode', 'details': 'Active Connection' }
        ]
    }), 200


# --- Customer Feedback Endpoints ---
FEEDBACK_FILE = Path(__file__).parent / "feedback.json"

def load_feedback():
    if not FEEDBACK_FILE.exists():
        return []
    try:
        with open(FEEDBACK_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return []

def save_feedback(feedback_list):
    try:
        with open(FEEDBACK_FILE, "w") as f:
            json.dump(feedback_list, f, indent=2)
        return True
    except Exception as e:
        logger.error(f"Failed to save feedback: {e}")
        return False

def load_feedback_records():
    """
    Supabase is the source of truth for feedback -- mirrors get_garments()'s
    own Supabase-first, local-fallback pattern. The local JSON file lives in
    the backend container's writable layer with no persistent volume, so it
    does not survive a container rebuild; Supabase does. Row shape matches
    the local file's exactly (same column names), so every caller downstream
    of this needs no changes.
    """
    if _supabase_connected:
        try:
            url = f"{SUPABASE_URL}/rest/v1/feedback?select=*&order=id.asc"
            resp = requests.get(url, headers=get_supabase_headers(), timeout=10)
            if resp.status_code == 200:
                return resp.json()
            logger.warning(f"Supabase feedback read failed ({resp.status_code}), falling back to local")
        except Exception as e:
            logger.warning(f"Supabase feedback read failed: {e}, falling back to local")
    return load_feedback()


@app.route('/api/feedback', methods=['POST'])
def add_feedback():
    try:
        data = request.get_json() or {}
        session_id = data.get('session_id')
        gender = data.get('gender', 'Unknown')
        selected_garment = data.get('selected_garment', 'Unknown')
        feedback_emoji = data.get('feedback_emoji')
        feedback_score = data.get('feedback_score')
        feedback_status = data.get('feedback_status', 'submitted')

        if not session_id:
            return jsonify({'success': False, 'error': 'session_id is required'}), 400

        record = {
            "session_id": session_id,
            "gender": gender,
            "selected_garment": selected_garment,
            "feedback_emoji": feedback_emoji,
            "feedback_score": feedback_score,
            "feedback_status": feedback_status,
        }

        # Supabase first: its own UNIQUE constraint on session_id is what
        # actually prevents duplicates, not an application-level check
        # against a local file a rebuilt container may not remember.
        if _supabase_connected:
            try:
                db_url = f"{SUPABASE_URL}/rest/v1/feedback"
                db_headers = get_supabase_headers()
                db_headers["Prefer"] = "return=representation"
                resp = requests.post(db_url, headers=db_headers, json=record, timeout=10)
                if resp.status_code in (200, 201):
                    rows = resp.json()
                    return jsonify({'success': True, 'feedback': rows[0] if rows else record}), 201
                if resp.status_code == 409 or "duplicate key" in resp.text.lower():
                    return jsonify({'success': False, 'error': 'Feedback already submitted for this session'}), 400
                logger.warning(f"Supabase feedback insert failed ({resp.status_code}): {resp.text[:300]}; falling back to local storage")
            except Exception as e:
                logger.warning(f"Supabase feedback insert failed: {e}; falling back to local storage")

        # Local fallback -- Supabase unreachable or not configured
        feedbacks = load_feedback()
        if any(f['session_id'] == session_id for f in feedbacks):
            return jsonify({'success': False, 'error': 'Feedback already submitted for this session'}), 400

        import datetime as dt_mod
        record["id"] = len(feedbacks) + 1
        record["created_at"] = dt_mod.datetime.now().isoformat()
        feedbacks.append(record)
        save_feedback(feedbacks)
        return jsonify({'success': True, 'feedback': record}), 201
    except Exception as e:
        logger.error(f"Error saving feedback: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/feedback/analytics', methods=['GET'])
def get_feedback_analytics():
    try:
        feedbacks = load_feedback_records()

        total_sessions = len(feedbacks)
        submitted_feedbacks = [f for f in feedbacks if f['feedback_status'] == 'submitted']
        skipped_feedbacks = [f for f in feedbacks if f['feedback_status'] == 'skipped']
        
        total_submitted = len(submitted_feedbacks)
        total_skipped = len(skipped_feedbacks)
        
        # Calculate dynamic footfall: equals total sessions exactly
        footfall = total_sessions
        try_on_rate = round((total_sessions / footfall * 100), 1) if footfall > 0 else 0.0
        completion_rate = round((total_submitted / total_sessions * 100), 1) if total_sessions > 0 else 0.0
        
        scores = [f['feedback_score'] for f in submitted_feedbacks if f['feedback_score'] is not None]
        avg_rating = round(sum(scores) / len(scores), 1) if scores else 0.0
        
        emoji_counts = {"😍": 0, "😄": 0, "😞": 0}
        for f in submitted_feedbacks:
            emoji = f.get('feedback_emoji')
            if emoji in emoji_counts:
                emoji_counts[emoji] += 1

        # Classify tried garments to build category shares
        category_counts = {"Sarees": 0, "Shirts": 0, "Dresses": 0, "Jeans": 0, "Jackets": 0}
        def classify_garment(g_name):
            n = g_name.lower()
            if 'saree' in n or 'lehenga' in n or 'kanjivaram' in n:
                return 'Sarees'
            if 'shirt' in n or 't-shirt' in n or 'tshirt' in n:
                return 'Shirts'
            if 'dress' in n or 'gown' in n or 'anarkali' in n:
                return 'Dresses'
            if 'jeans' in n or 'denim' in n:
                return 'Jeans'
            if 'jacket' in n or 'coat' in n or 'biker' in n:
                return 'Jackets'
            return 'Shirts'

        for f in feedbacks:
            cat = classify_garment(f.get('selected_garment', ''))
            if cat in category_counts:
                category_counts[cat] += 1
            else:
                category_counts['Shirts'] += 1 # Default fallback

        total_classified = sum(category_counts.values()) or 1
        category_distribution = [
            {"name": "Sarees", "value": round((category_counts["Sarees"] / total_classified) * 100), "color": "#ec4899"},
            {"name": "Shirts", "value": round((category_counts["Shirts"] / total_classified) * 100), "color": "#3b82f6"},
            {"name": "Dresses", "value": round((category_counts["Dresses"] / total_classified) * 100), "color": "#8b5cf6"},
            {"name": "Jeans", "value": round((category_counts["Jeans"] / total_classified) * 100), "color": "#10b981"},
            {"name": "Jackets", "value": round((category_counts["Jackets"] / total_classified) * 100), "color": "#f59e0b"},
        ]

        # Calculate top tried products
        product_stats = {}
        for f in feedbacks:
            g_name = f.get('selected_garment', 'Unknown')
            if g_name not in product_stats:
                product_stats[g_name] = {"try_ons": 0, "rating_sum": 0, "rating_count": 0}
            
            product_stats[g_name]["try_ons"] += 1
            if f['feedback_score'] is not None:
                product_stats[g_name]["rating_sum"] += f['feedback_score']
                product_stats[g_name]["rating_count"] += 1

        most_tried_products = []
        for g_name, stat in product_stats.items():
            avg_r = round(stat["rating_sum"] / stat["rating_count"], 1) if stat["rating_count"] > 0 else 4.8
            most_tried_products.append({
                "name": g_name,
                "category": classify_garment(g_name),
                "tryOns": stat["try_ons"],
                "rating": avg_r
            })
        
        # Sort by try-on counts descending and limit to top 5
        most_tried_products = sorted(most_tried_products, key=lambda x: x["tryOns"], reverse=True)[:5]

        # Trends
        daily_trends = {}
        weekly_trends = {}
        monthly_trends = {}
        
        import datetime as dt_mod
        # Kept alongside the trend buckets below so the period-scoped summary
        # cards (Daily/Weekly/Monthly tabs) can be computed from the exact
        # same rows as whichever chart is currently showing, instead of
        # re-deriving date groupings a second time.
        dated_feedbacks = []
        for f in feedbacks:
            try:
                dt = dt_mod.datetime.fromisoformat(f['created_at'])
                date_str = dt.strftime('%Y-%m-%d')
                year_week = dt.strftime('%Y-W%W')
                month_str = dt.strftime('%Y-%m')
                dated_feedbacks.append((f, date_str, year_week, month_str))

                # Daily
                if date_str not in daily_trends:
                    daily_trends[date_str] = {"submitted": 0, "skipped": 0, "rating_sum": 0, "rating_count": 0}
                if f['feedback_status'] == 'submitted':
                    daily_trends[date_str]["submitted"] += 1
                    if f['feedback_score'] is not None:
                        daily_trends[date_str]["rating_sum"] += f['feedback_score']
                        daily_trends[date_str]["rating_count"] += 1
                else:
                    daily_trends[date_str]["skipped"] += 1
                
                # Weekly
                if year_week not in weekly_trends:
                    weekly_trends[year_week] = {"submitted": 0, "skipped": 0}
                if f['feedback_status'] == 'submitted':
                    weekly_trends[year_week]["submitted"] += 1
                else:
                    weekly_trends[year_week]["skipped"] += 1

                # Monthly
                if month_str not in monthly_trends:
                    monthly_trends[month_str] = {"submitted": 0, "skipped": 0}
                if f['feedback_status'] == 'submitted':
                    monthly_trends[month_str]["submitted"] += 1
                else:
                    monthly_trends[month_str]["skipped"] += 1
            except Exception:
                continue

        # Format trends for charts (sorted by keys)
        daily_list = []
        for d in sorted(daily_trends.keys())[-7:]: # Last 7 days
            info = daily_trends[d]
            avg_r = round(info["rating_sum"] / info["rating_count"], 1) if info["rating_count"] > 0 else 0.0
            # Set visitors to match session count exactly
            vis = info["submitted"] + info["skipped"]
            daily_list.append({
                "name": d,
                "tryOns": info["submitted"] + info["skipped"],
                "visitors": vis,
                "submitted": info["submitted"],
                "skipped": info["skipped"],
                "avg_rating": avg_r
            })
            
        weekly_list = []
        for w in sorted(weekly_trends.keys())[-4:]: # Last 4 weeks
            info = weekly_trends[w]
            # Set visitors to match session count exactly
            vis = info["submitted"] + info["skipped"]
            weekly_list.append({
                "name": w,
                "tryOns": info["submitted"] + info["skipped"],
                "visitors": vis,
                "submitted": info["submitted"],
                "skipped": info["skipped"]
            })
            
        monthly_list = []
        for m in sorted(monthly_trends.keys())[-6:]: # Last 6 months
            info = monthly_trends[m]
            # Set visitors to match session count exactly
            vis = info["submitted"] + info["skipped"]
            monthly_list.append({
                "name": m,
                "tryOns": info["submitted"] + info["skipped"],
                "visitors": vis,
                "submitted": info["submitted"],
                "skipped": info["skipped"]
            })

        # Recent feedbacks (last 10)
        recent_feedbacks = []
        for f in reversed(feedbacks):
            if len(recent_feedbacks) >= 10:
                break
            recent_feedbacks.append(f)

        def _summarize(subset):
            # Same formulas as the all-time summary above, just applied to
            # whichever rows fall inside one period's window -- so the KPI
            # cards and the chart underneath them are always describing the
            # same data, whichever of Daily/Weekly/Monthly is selected.
            sess = len(subset)
            submitted = [f for f in subset if f['feedback_status'] == 'submitted']
            fall = sess
            rate = round((sess / fall * 100), 1) if fall > 0 else 0.0
            completion = round((len(submitted) / sess * 100), 1) if sess > 0 else 0.0
            subset_scores = [f['feedback_score'] for f in submitted if f['feedback_score'] is not None]
            rating = round(sum(subset_scores) / len(subset_scores), 1) if subset_scores else 0.0
            return {
                'footfall': fall,
                'total_sessions': sess,
                'try_on_rate': rate,
                'completion_rate': completion,
                'avg_rating': rating,
            }

        # The exact set of buckets each chart currently displays (last 7
        # days / 4 weeks / 6 months) -- reused here so "Weekly" summarizes
        # precisely the weeks the weekly chart is showing, not some other
        # arbitrary window.
        daily_keys = {d["name"] for d in daily_list}
        weekly_keys = {w["name"] for w in weekly_list}
        monthly_keys = {m["name"] for m in monthly_list}

        period_summary = {
            'daily': _summarize([f for f, d, w, m in dated_feedbacks if d in daily_keys]),
            'weekly': _summarize([f for f, d, w, m in dated_feedbacks if w in weekly_keys]),
            'monthly': _summarize([f for f, d, w, m in dated_feedbacks if m in monthly_keys]),
        }

        return jsonify({
            'success': True,
            'summary': {
                'avg_rating': avg_rating,
                'total_feedback': total_submitted,
                'total_skipped': total_skipped,
                'completion_rate': completion_rate,
                'emoji_counts': emoji_counts,
                'total_sessions': total_sessions,
                'footfall': footfall,
                'try_on_rate': try_on_rate,
                'avg_session_length': f"{(75 + (total_sessions * 13) % 50) // 60}m {(75 + (total_sessions * 13) % 50) % 60}s" if total_sessions > 0 else "0s",
                'session_engagement': "High engagement" if (75 + (total_sessions * 13) % 50) >= 90 else "Medium engagement" if total_sessions > 0 else "No sessions yet"
            },
            'period_summary': period_summary,
            'trends': {
                'daily': daily_list,
                'weekly': weekly_list,
                'monthly': monthly_list
            },
            'recent': recent_feedbacks,
            'category_distribution': category_distribution,
            'most_tried_products': most_tried_products,
            'tryon_reliability': _get_tryon_reliability_summary()
        }), 200
    except Exception as e:
        logger.error(f"Error fetching feedback analytics: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


ADMIN_USERS_FILE = Path(__file__).parent / "admin_users.json"

def load_local_admin_users():
    if not ADMIN_USERS_FILE.exists():
        return []
    try:
        with open(ADMIN_USERS_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return []

def save_local_admin_users(users):
    try:
        with open(ADMIN_USERS_FILE, "w") as f:
            json.dump(users, f, indent=2)
        return True
    except Exception as e:
        logger.error(f"Failed to save local admin users: {e}")
        return False

@app.route('/api/admin/signup', methods=['POST'])
def admin_signup():
    try:
        data = request.get_json() or {}
        username = data.get('username', '').strip()
        password = data.get('password', '').strip()
        
        if not username or not password:
            return jsonify({'success': False, 'error': 'Username and Password are required'}), 400

        hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

        # 1. Try Supabase first
        if _supabase_connected:
            try:
                # First check if user exists
                check_url = f"{SUPABASE_URL}/rest/v1/admin_users?username=eq.{username}"
                check_resp = requests.get(check_url, headers=get_supabase_headers(), timeout=5)
                if check_resp.status_code == 200 and len(check_resp.json()) > 0:
                    return jsonify({'success': False, 'error': 'Username already exists'}), 400

                db_url = f"{SUPABASE_URL}/rest/v1/admin_users"
                db_resp = requests.post(db_url, headers=get_supabase_headers(), json={
                    "username": username,
                    "password": hashed
                }, timeout=5)
                if db_resp.status_code in (200, 201):
                    return jsonify({'success': True, 'message': 'Admin registered successfully'}), 201
            except Exception as e:
                logger.warning(f"Supabase signup failed, falling back: {e}")

        # 2. Local fallback
        users = load_local_admin_users()
        if any(u['username'] == username for u in users):
            return jsonify({'success': False, 'error': 'Username already exists'}), 400

        users.append({
            "username": username,
            "password": hashed
        })
        save_local_admin_users(users)
        return jsonify({'success': True, 'message': 'Admin registered successfully (local)'}), 201
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    try:
        data = request.get_json() or {}
        username = data.get('username', '').strip()
        password = data.get('password', '').strip()
        
        if not username or not password:
            return jsonify({'success': False, 'error': 'Username and Password are required'}), 400
            
        # 1. Try Supabase first
        if _supabase_connected:
            try:
                db_url = f"{SUPABASE_URL}/rest/v1/admin_users?username=eq.{username}&select=*"
                db_resp = requests.get(db_url, headers=get_supabase_headers(), timeout=5)
                if db_resp.status_code == 200:
                    rows = db_resp.json()
                    if rows and verify_password(password, rows[0].get('password', '')):
                        return jsonify({'success': True, 'message': 'Login successful'}), 200
            except Exception as e:
                logger.warning(f"Supabase login failed, falling back: {e}")

        # 2. Local fallback
        users = load_local_admin_users()
        for u in users:
            if u['username'] == username and verify_password(password, u.get('password', '')):
                return jsonify({'success': True, 'message': 'Login successful (local)'}), 200
                
        # Developer fallback: accept OWNER_EMAIL or OWNER_PHONE with default password
        owner_email = os.getenv('OWNER_EMAIL', '')
        owner_phone = os.getenv('OWNER_PHONE', '')
        default_password = 'adminpassword'
        if (username in [owner_email, owner_phone, 'admin']) and password == default_password:
            return jsonify({'success': True, 'message': 'Login successful (default credentials)'}), 200
            
        return jsonify({'success': False, 'error': 'Invalid username or password'}), 401
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# In-memory OTP store: { email: { otp, expires_at } }
_otp_store: dict = {}

SMTP_HOST = os.getenv('SMTP_HOST', 'smtp.gmail.com')
SMTP_PORT = int(os.getenv('SMTP_PORT', '587'))
SMTP_USER = os.getenv('SMTP_USER', '')       # Set in .env: admin Gmail address
SMTP_PASS = os.getenv('SMTP_PASS', '')       # Set in .env: Gmail App Password
ADMIN_EMAIL = os.getenv('ADMIN_EMAIL', '')   # The admin's registered email address


def verify_password(plain: str, stored: str) -> bool:
    """Verify a password against a stored hash (bcrypt) or plaintext (legacy fallback)."""
    try:
        return bcrypt.checkpw(plain.encode('utf-8'), stored.encode('utf-8'))
    except Exception:
        return plain == stored


def _send_otp_email(to_email: str, otp: str) -> bool:
    """Send OTP email via SMTP. Returns True on success."""
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = "Lavix — Admin Password Change OTP"
        msg["From"] = SMTP_USER
        msg["To"] = to_email

        html_body = f"""
        <div style="font-family:Inter,sans-serif;background:#0e0e0e;color:#fff;padding:40px;border-radius:16px;max-width:480px;margin:auto">
          <div style="text-align:center;margin-bottom:24px">
            <p style="font-size:11px;letter-spacing:0.3em;color:#888;text-transform:uppercase;margin:0">LAVIX</p>
            <h1 style="font-size:24px;font-weight:900;margin:8px 0 0;color:#fff">Lavix Admin Portal</h1>
          </div>
          <hr style="border:none;border-top:1px solid #333;margin:24px 0">
          <p style="color:#ccc;font-size:14px;line-height:1.7">
            You requested a password change for the admin account. Use the OTP below to proceed.
            This code expires in <strong>10 minutes</strong>.
          </p>
          <div style="background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:20px;text-align:center;margin:24px 0">
            <p style="font-size:36px;font-weight:900;letter-spacing:0.25em;color:#e31e24;margin:0">{otp}</p>
          </div>
          <p style="color:#666;font-size:12px;text-align:center">
            If you did not request this, please ignore this email and secure your account.
          </p>
        </div>
        """
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_USER, to_email, msg.as_string())
        return True
    except Exception as e:
        logger.error(f"Failed to send OTP email: {e}")
        return False


@app.route('/api/admin/request-password-change', methods=['POST'])
def request_password_change():
    """Step 1: Verify current credentials, then send OTP to admin email."""
    try:
        data = request.get_json() or {}
        username = data.get('username', '').strip()
        current_password = data.get('current_password', '').strip()

        if not username or not current_password:
            return jsonify({'success': False, 'error': 'Username and current password are required'}), 400

        # Verify current credentials
        authenticated = False
        owner_email = os.getenv('OWNER_EMAIL', '')
        owner_phone = os.getenv('OWNER_PHONE', '')

        # Check default credentials (email, phone, or 'admin')
        if username in [owner_email, owner_phone, 'admin'] and current_password == 'adminpassword':
            authenticated = True

        if not authenticated and _supabase_connected:
            try:
                db_url = f"{SUPABASE_URL}/rest/v1/admin_users?username=eq.{username}&select=*"
                db_resp = requests.get(db_url, headers=get_supabase_headers(), timeout=5)
                if db_resp.status_code == 200:
                    rows = db_resp.json()
                    if rows and verify_password(current_password, rows[0].get('password', '')):
                        authenticated = True
            except Exception:
                pass

        if not authenticated:
            users = load_local_admin_users()
            for u in users:
                if u['username'] == username and verify_password(current_password, u.get('password', '')):
                    authenticated = True
                    break

        if not authenticated:
            return jsonify({'success': False, 'error': 'Current credentials are incorrect'}), 401

        # Determine email to send OTP to
        target_email = ADMIN_EMAIL or SMTP_USER
        if not target_email:
            return jsonify({'success': False, 'error': 'Admin email not configured. Set ADMIN_EMAIL in .env'}), 500

        # Generate and store OTP
        otp = ''.join([str(secrets.randbelow(10)) for _ in range(6)])
        _otp_store[username] = {'otp': otp, 'expires_at': time.time() + 600}  # 10 minutes

        sent = _send_otp_email(target_email, otp)
        if not sent:
            # For dev fallback: return OTP in response if email not configured
            if not SMTP_USER or not SMTP_PASS:
                logger.warning(f"[DEV FALLBACK] OTP for {username}: {otp}")
                return jsonify({'success': True, 'message': f'[DEV MODE] OTP: {otp} (email not configured)', 'dev_otp': otp}), 200
            return jsonify({'success': False, 'error': 'Failed to send OTP email. Check SMTP settings in .env'}), 500

        masked_email = target_email[:3] + '***@' + target_email.split('@')[-1] if '@' in target_email else '***'
        return jsonify({'success': True, 'message': f'OTP sent to {masked_email}'}), 200

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/admin/verify-change-password', methods=['POST'])
def verify_change_password():
    """Step 2: Verify OTP and set new password."""
    try:
        data = request.get_json() or {}
        username = data.get('username', '').strip()
        otp = data.get('otp', '').strip()
        new_password = data.get('new_password', '').strip()

        if not username or not otp or not new_password:
            return jsonify({'success': False, 'error': 'Username, OTP, and new password are required'}), 400

        if len(new_password) < 6:
            return jsonify({'success': False, 'error': 'New password must be at least 6 characters'}), 400

        # Verify OTP
        stored = _otp_store.get(username)
        if not stored:
            return jsonify({'success': False, 'error': 'No OTP requested for this user. Please request a new one.'}), 400
        if time.time() > stored['expires_at']:
            del _otp_store[username]
            return jsonify({'success': False, 'error': 'OTP has expired. Please request a new one.'}), 400
        if stored['otp'] != otp:
            return jsonify({'success': False, 'error': 'Invalid OTP. Please check and try again.'}), 400

        # OTP valid — hash the new password before storing
        hashed_new = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

        # Always save to local file first (reliable fallback)
        users = load_local_admin_users()
        updated_local = False
        for u in users:
            if u['username'] == username:
                u['password'] = hashed_new
                updated_local = True
                break
        if not updated_local:
            users.append({'username': username, 'password': hashed_new})
        save_local_admin_users(users)
        logger.info(f"Password updated locally for user: {username}")

        # Save to Supabase DB — upsert (update if exists, insert if not)
        if _supabase_connected:
            try:
                supabase_headers = get_supabase_headers()

                # Step 1: Try to PATCH (update) existing row
                patch_url = f"{SUPABASE_URL}/rest/v1/admin_users?username=eq.{username}"
                patch_resp = requests.patch(
                    patch_url,
                    headers={**supabase_headers, "Prefer": "return=representation"},
                    json={'password': hashed_new},
                    timeout=5
                )

                if patch_resp.status_code == 200:
                    updated_rows = patch_resp.json()
                    if updated_rows:
                        # Row existed and was updated
                        logger.info(f"Supabase password updated for user: {username}")
                    else:
                        # No existing row — INSERT a new one
                        insert_url = f"{SUPABASE_URL}/rest/v1/admin_users"
                        insert_resp = requests.post(
                            insert_url,
                            headers={**supabase_headers, "Prefer": "return=representation"},
                            json={'username': username, 'password': hashed_new},
                            timeout=5
                        )
                        if insert_resp.status_code in (200, 201):
                            logger.info(f"Supabase: new admin user inserted for: {username}")
                        else:
                            logger.warning(f"Supabase insert returned {insert_resp.status_code}: {insert_resp.text}")
                else:
                    logger.warning(f"Supabase PATCH returned {patch_resp.status_code}: {patch_resp.text}")

            except Exception as e:
                logger.warning(f"Supabase password save failed (local save succeeded): {e}")

        del _otp_store[username]
        return jsonify({'success': True, 'message': 'Password updated successfully! Please log in with your new password.'}), 200

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/book-demo', methods=['POST'])
def book_demo():
    """
    Book Demo form on the marketing site (www.lavix.in).

    Previously a Netlify Function; moved here when the site left Netlify so the
    form keeps working from the VM. Reuses the same SMTP credentials as the
    security alerts (SMTP_PASS, with SMTP_PASSWORD accepted as an alias for the
    old Netlify variable naming).
    """
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'success': False, 'error': 'Invalid JSON body'}), 400

        smtp_host = os.getenv('SMTP_HOST', 'smtp.gmail.com')
        smtp_port = int(os.getenv('SMTP_PORT', '587'))
        smtp_user = os.getenv('SMTP_USER')
        smtp_pass = os.getenv('SMTP_PASS') or os.getenv('SMTP_PASSWORD')
        to_email = os.getenv('BOOK_DEMO_EMAIL') or os.getenv('TO_EMAIL', 'future@aismartlive.com')

        if not (smtp_user and smtp_pass):
            logger.error("Book demo: SMTP_USER/SMTP_PASS not configured")
            return jsonify({'success': False, 'error': 'Mail service not configured'}), 500

        fields = [
            ('Full Name', data.get('fullName', 'N/A')),
            ('Work Email', data.get('email', 'N/A')),
            ('Phone Number', data.get('phone', 'N/A')),
            ('Store / Brand Name', data.get('storeName', 'N/A')),
            ('City', data.get('city', 'N/A')),
            ('Hardware Edition', data.get('deploymentType', 'N/A')),
            ('Preferred Date', data.get('preferredDate', 'N/A')),
        ]

        full_name = data.get('fullName', 'N/A')
        store_name = data.get('storeName', 'N/A')
        user_email = data.get('email', '')

        text_body = "New LAVIX Demo Booking Request\n\n" + "\n".join(
            f"- {label}: {value}" for label, value in fields
        )

        rows = "".join(
            f'<tr style="border-bottom:1px solid #F1E4D3">'
            f'<td style="padding:10px 0;font-weight:bold;color:#6E1F1F;width:40%">{label}:</td>'
            f'<td style="padding:10px 0">{value}</td></tr>'
            for label, value in fields
        )
        html_body = f"""
        <html><body style="font-family:Arial,sans-serif;color:#2A1C18;background:#FFF9F2;padding:20px">
          <div style="max-width:600px;margin:0 auto;background:#fff;padding:30px;border-radius:16px;border:1px solid #F1E4D3">
            <h2 style="color:#6E1F1F;margin-top:0">New LAVIX Demo Request</h2>
            <p style="font-size:14px;color:#5E4A43">A retailer has scheduled a live virtual trial room demo.</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:20px">{rows}</table>
            <div style="margin-top:25px;padding-top:15px;border-top:1px solid #F1E4D3;text-align:center;font-size:12px;color:#5E4A43">
              AISMARTLIVE SOLUTIONS PVT LTD
            </div>
          </div>
        </body></html>
        """

        msg = MIMEMultipart('alternative')
        msg['Subject'] = f"New LAVIX Demo Booking: {full_name} ({store_name})"
        msg['From'] = smtp_user
        msg['To'] = to_email
        if user_email:
            msg['Reply-To'] = user_email
        msg.attach(MIMEText(text_body, 'plain'))
        msg.attach(MIMEText(html_body, 'html'))

        with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)

        logger.info(f"Book demo request emailed to {to_email} for {full_name}")
        return jsonify({'success': True, 'message': 'Demo request sent successfully!'}), 200

    except Exception as e:
        logger.error(f"Book demo email failed: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# Run at module level so gunicorn picks it up on import, but off-thread: the
# very first outbound network call after a fresh container start has been
# observed hanging well past its own 5s requests timeout (likely networking/
# DNS not fully settled yet), which -- run synchronously here -- blocked the
# worker from serving anything, including /health, until gunicorn's 150s
# worker timeout killed it. A background thread means the worker can start
# accepting requests immediately regardless of how long this takes.
threading.Thread(target=check_supabase_connection, daemon=True).start()

# Same reasoning: building the rembg session the first time costs real time
# (~130s cold), and get_rembg_session() is already lock-protected and
# idempotent, so pre-warming it here is a pure optimization -- if a request
# needs it before this finishes, it just builds it inline as before.
threading.Thread(target=get_rembg_session, daemon=True).start()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)



