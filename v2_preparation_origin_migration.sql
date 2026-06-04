-- ============================================================
-- Anestheo /v2 — Preparation Plan: surgery "origin" flag
-- Adds a single column to the EXISTING patient_surgeries link table
-- so the dashboard can tell a patient-initiated journey apart from a
-- clinic-initiated one. No new table / no new data silo.
-- Run in Supabase SQL Editor. Idempotent and non-destructive.
-- ============================================================

-- origin: who started this surgery journey.
--   'patient' → self-registered patient (gets the immediate Preparation Guide)
--   'clinic'  → created by a clinic/doctor (keeps the "plan is being prepared" message)
ALTER TABLE public.patient_surgeries
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'patient';

-- Backfill any pre-existing rows that predate this column. Rows created from
-- the patient dashboard are self-service, so the safe default is 'patient'.
UPDATE public.patient_surgeries SET origin = 'patient' WHERE origin IS NULL;

-- Constrain to the two known values (guarded so re-runs don't error).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patient_surgeries_origin_chk'
  ) THEN
    ALTER TABLE public.patient_surgeries
      ADD CONSTRAINT patient_surgeries_origin_chk CHECK (origin IN ('patient','clinic'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
-- ============================================================
-- Done. patient_surgeries.origin now drives the Preparation Plan stage.
-- ============================================================
