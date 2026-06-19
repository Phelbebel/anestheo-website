-- ============================================================
-- Anestheo /v2 - Consultation vs Surgical lane (HIGH #1)
-- The ONLY data change: one additive boolean on care_requests.
-- false (default) = surgical patient (full pre-op pipeline).
-- true            = consultation / advice-only (kept out of the pipeline).
--
-- Safe: default false => every EXISTING accepted patient stays surgical,
-- exactly as before. No backfill, no RLS change (the existing cr_update
-- policy already lets a doctor update their own care_requests), no triggers,
-- no Edge Functions. Idempotent. Pure ASCII.
-- Run in the Supabase SQL editor BEFORE uploading the new dashboard.html.
-- ============================================================

ALTER TABLE public.care_requests
  ADD COLUMN IF NOT EXISTS is_consultation boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
-- ============================================================
-- Done. Accept-as-Consultation / Convert-to-Surgical / Close just flip this
-- flag (or set status='closed') via the doctor's existing update permission.
-- ============================================================
