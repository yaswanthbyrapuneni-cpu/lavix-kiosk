-- ===========================================================================
-- Vastra Alankara AI - Relational Database Schema Definitions (Supabase / PostgreSQL)
-- ===========================================================================

-- 1. PRODUCT CATALOGUE TABLE (Garments)
-- Stores the clothes available for Virtual Try-On
CREATE TABLE IF NOT EXISTS garments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    color VARCHAR(100) NOT NULL,
    category VARCHAR(100) NOT NULL,           -- e.g. 'Sarees', 'Shirts', 'Dresses', 'Jeans', 'Jackets'
    gender VARCHAR(50) DEFAULT 'Women',             -- 'Men' or 'Women'
    image_url TEXT NOT NULL,                  -- Local or cloud link to the garment image
    price INTEGER DEFAULT 3999,               -- Price in Rs
    model_3d_url TEXT,                        -- Optional real .glb/.gltf for the 3D Mannequin viewer; best quality, nullable, most garments won't have one
    back_image_url TEXT,                      -- Optional second admin-uploaded photo (back view); nullable
    front_cutout_url TEXT,                    -- Auto-generated (rembg) background-removed cutout of image_url, for the 3D Mannequin photo-billboard fallback; nullable until a garment has been (re-)uploaded under this feature
    back_cutout_url TEXT,                     -- Same, derived from back_image_url; nullable, only exists when back_image_url does
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- This file is not auto-applied on deploy (see app.py's comment near
-- check_supabase_connection). For a garments table that already existed
-- before these columns were added above, run this once against the live
-- Supabase project (SQL Editor) — safe to re-run, and every existing row
-- keeps working with all four simply NULL:
--   ALTER TABLE garments ADD COLUMN IF NOT EXISTS model_3d_url TEXT;
--   ALTER TABLE garments ADD COLUMN IF NOT EXISTS back_image_url TEXT;
--   ALTER TABLE garments ADD COLUMN IF NOT EXISTS front_cutout_url TEXT;
--   ALTER TABLE garments ADD COLUMN IF NOT EXISTS back_cutout_url TEXT;

-- 2. CUSTOMER TRY-ON FEEDBACK TABLE
-- Tracks virtual try-on session outcomes, CSAT scores, and completion metrics
CREATE TABLE IF NOT EXISTS feedback (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) UNIQUE NOT NULL,  -- Prevents duplicate ratings for a single generation session
    gender VARCHAR(50) NOT NULL,             -- Contextual gender of the visitor
    selected_garment VARCHAR(255) NOT NULL,   -- Name of the garment tested
    feedback_emoji VARCHAR(10),               -- Emoji value (😍, 😄, 🙂, 😐, 😞 or NULL if skipped)
    feedback_score INTEGER,                   -- Score mapped to emoji (5, 4, 3, 2, 1 or NULL if skipped)
    feedback_status VARCHAR(50) NOT NULL,     -- 'submitted' or 'skipped'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. TECHNICAL SUPPORT TICKETS TABLE
-- Stores tickets filed from the Admin/Tech Support interface
CREATE TABLE IF NOT EXISTS support_tickets (
    id VARCHAR(50) PRIMARY KEY,                -- e.g. 'VAS-1234'
    subject VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,           -- e.g. 'Hardware', 'Catalogue'
    priority VARCHAR(50) NOT NULL,            -- 'Low', 'Medium', 'High'
    description TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'Open',        -- 'Open', 'Resolved'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index structures to optimize analytics queries
CREATE INDEX IF NOT EXISTS idx_feedback_garment ON feedback(selected_garment);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(feedback_status);
CREATE INDEX IF NOT EXISTS idx_garments_gender ON garments(gender);

-- 5. TRY-ON RELIABILITY EVENTS TABLE
-- One row per /try-on call, recording how it actually resolved -- lets the
-- admin dashboard show real Vertex success/fallback/failure rates instead of
-- relying on a shop owner noticing and reporting a bad render.
CREATE TABLE IF NOT EXISTS tryon_events (
    id SERIAL PRIMARY KEY,
    mode VARCHAR(20) NOT NULL,                -- 'vertex', 'local', or 'failed'
    garment_count INTEGER DEFAULT 1,
    error_reason TEXT,                        -- populated for 'local' (fallback reason) and 'failed'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tryon_events_mode ON tryon_events(mode);
CREATE INDEX IF NOT EXISTS idx_tryon_events_created_at ON tryon_events(created_at);

-- This table is not auto-applied either (same as the garments columns above)
-- -- run its CREATE TABLE/INDEX statements once against the live Supabase
-- project (SQL Editor) for reliability tracking to start recording. Nothing
-- else in the app depends on it existing: the write is best-effort and
-- silently no-ops if the table isn't there yet.

-- 4. ADMIN USERS TABLE
-- Stores credentials of administrators
CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
