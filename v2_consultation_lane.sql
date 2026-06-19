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

-- Phase 1: private consultation notes (advice-only). One additive TEXT column.
-- Only the owning doctor reads/writes it (existing cr_update policy covers it).
-- No messages, attachments, storage, notifications or chat backend -- just a
-- per-consultation note that syncs across the doctor's devices via Supabase.
ALTER TABLE public.care_requests
  ADD COLUMN IF NOT EXISTS consult_notes text;

NOTIFY pgrst, 'reload schema';
-- ============================================================
-- Done. Accept-as-Consultation / Convert-to-Surgical / Close just flip the
-- is_consultation flag (or set status='closed'); Save note writes consult_notes
-- -- all via the doctor's existing update permission.
-- ============================================================
