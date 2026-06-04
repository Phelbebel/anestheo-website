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

-- ── Clinic side ─────────────────────────────────────────────
-- The clinic's surgery record lives in clinic_patients (the token-based flow
-- never creates a patient_surgeries row). Tag it as clinic-created so the same
-- origin vocabulary describes both flows. Every row here is clinic-created, so
-- the default is 'clinic' and existing rows backfill to 'clinic'.
ALTER TABLE public.clinic_patients
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'clinic';

UPDATE public.clinic_patients SET origin = 'clinic' WHERE origin IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clinic_patients_origin_chk'
  ) THEN
    ALTER TABLE public.clinic_patients
      ADD CONSTRAINT clinic_patients_origin_chk CHECK (origin IN ('patient','clinic'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
-- ============================================================
-- Done. origin now describes both surgery records:
--   patient_surgeries.origin defaults 'patient' (self-service dashboard)
--   clinic_patients.origin   defaults 'clinic'  (clinic-created)
-- patient_surgeries.origin drives the Preparation Plan stage.
-- ============================================================
