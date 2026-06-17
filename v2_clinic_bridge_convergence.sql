-- ============================================================
-- Anestheo /v2 - Clinic-invited -> bridge convergence (Stage 1: schema)
-- Account-linked convergence. ADDITIVE ONLY. No data migration, no backfill,
-- no RLS changes, no destructive changes. Safe to run repeatedly (idempotent).
-- Run in Supabase SQL Editor.  Pure ASCII.
--
-- After this, the Edge Function convert_clinic_patient links a completed
-- clinic_patients row to a real auth.users patient + the canonical bridge
-- tables (patient_surgeries / care_requests / preop_questionnaires). Legacy
-- clinic flow keeps working for unconverted / no-email rows.
-- ============================================================

-- -- clinic_patients: contact email + link to the created identity --
ALTER TABLE public.clinic_patients
  ADD COLUMN IF NOT EXISTS email        text,
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS converted_at timestamptz;

-- "Is this clinic patient already converted?" lookups + dedupe.
CREATE INDEX IF NOT EXISTS idx_clinic_patients_authuser
  ON public.clinic_patients(auth_user_id);

-- -- patient_surgeries: provenance back-link to the clinic_patients row --
-- UNIQUE so a clinic patient can be converted at most once (idempotency guard).
ALTER TABLE public.patient_surgeries
  ADD COLUMN IF NOT EXISTS clinic_patient_id uuid REFERENCES public.clinic_patients(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_surgeries_clinic_patient_uniq') THEN
    ALTER TABLE public.patient_surgeries
      ADD CONSTRAINT patient_surgeries_clinic_patient_uniq UNIQUE (clinic_patient_id);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
-- ============================================================
-- Done. Columns are inert until the Edge Function (Stage 3) and the
-- dashboard/q.html hooks (Stage 4) are deployed. patient_surgeries.origin
-- ('patient' | 'clinic') remains the source signal for the Action Center.
-- ============================================================
