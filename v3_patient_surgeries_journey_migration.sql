-- ============================================================
-- Anestheo /v2 — Surgery Journey (S1)
-- Evolve patient_surgeries: multiple surgeries per patient, status
-- lifecycle, soft-delete/archive, future clinic link.
-- Idempotent & non-destructive. Run in Supabase SQL Editor.
-- ============================================================

-- 1) Allow multiple surgeries per patient (drop the single-row UNIQUE)
ALTER TABLE public.patient_surgeries
  DROP CONSTRAINT IF EXISTS patient_surgeries_patient_id_key;

-- 2) Lifecycle + history + future clinical link columns
ALTER TABLE public.patient_surgeries
  ADD COLUMN IF NOT EXISTS status            text NOT NULL DEFAULT 'planning',
  ADD COLUMN IF NOT EXISTS completed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at      timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at       timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at        timestamptz,
  -- nullable now; lights up questionnaire/plan stages in a later milestone (S4)
  ADD COLUMN IF NOT EXISTS clinic_patient_id uuid REFERENCES public.clinic_patients(id) ON DELETE SET NULL;

-- status lifecycle (documented; enforced softly):
--   planning | questionnaire_pending | questionnaire_complete | ready | completed | cancelled
ALTER TABLE public.patient_surgeries
  DROP CONSTRAINT IF EXISTS patient_surgeries_status_chk;
ALTER TABLE public.patient_surgeries
  ADD CONSTRAINT patient_surgeries_status_chk
  CHECK (status IN ('planning','questionnaire_pending','questionnaire_complete','ready','completed','cancelled'));

CREATE INDEX IF NOT EXISTS idx_patient_surgeries_patient ON public.patient_surgeries(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_surgeries_status  ON public.patient_surgeries(status);

-- 3) RLS — patient-owned only for now.
--    Doctors no longer auto-see patient-created surgeries (per product decision);
--    visibility returns once clinic_patient_id links a surgery to a clinic record (S4).
DROP POLICY IF EXISTS ps_select ON public.patient_surgeries;
CREATE POLICY ps_select ON public.patient_surgeries
  FOR SELECT USING (
    auth.uid() = patient_id
    OR EXISTS (SELECT 1 FROM public.profiles p
               WHERE p.id = auth.uid() AND (p.is_admin = true OR p.role = 'admin'))
  );

-- insert/update policies unchanged (patient owns own rows). Soft-delete is an UPDATE
-- (sets deleted_at), so it is covered by ps_update — no DELETE policy needed.
DROP POLICY IF EXISTS ps_insert ON public.patient_surgeries;
CREATE POLICY ps_insert ON public.patient_surgeries
  FOR INSERT WITH CHECK ( auth.uid() = patient_id );

DROP POLICY IF EXISTS ps_update ON public.patient_surgeries;
CREATE POLICY ps_update ON public.patient_surgeries
  FOR UPDATE USING ( auth.uid() = patient_id ) WITH CHECK ( auth.uid() = patient_id );

NOTIFY pgrst, 'reload schema';
-- ============================================================
-- Done. patient_surgeries now supports multiple rows, lifecycle,
-- soft-delete/archive, and a future clinic_patient_id link.
-- Verify:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='patient_surgeries' ORDER BY column_name;
--   -- expect: status, completed_at, cancelled_at, archived_at, deleted_at, clinic_patient_id
-- ============================================================
