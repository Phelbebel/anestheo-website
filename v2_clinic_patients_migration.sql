-- ============================================================
-- Anestheo /v2 — clinic_patients (Patient Management)
-- COMPLETE migration. Paste into Supabase SQL Editor and Run.
-- Safe to run on a fresh database (creates everything).
-- ============================================================

-- ── TABLE ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clinic_patients (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_name          text NOT NULL,
  phone_number          text,
  procedure             text,
  hospital              text,
  surgery_date          date,
  notes                 text,
  questionnaire_status  text NOT NULL DEFAULT 'not_sent',              -- not_sent|sent|opened|in_progress|completed
  consultation_status   text NOT NULL DEFAULT 'not_arrived',           -- not_arrived|arrived|reviewed
  patient_status        text NOT NULL DEFAULT 'awaiting_questionnaire',-- awaiting_questionnaire|awaiting_consultation|ready_for_surgery|completed
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- workflow support
  token                 text UNIQUE,
  questionnaire_answers jsonb,
  doctor_notes          text,
  sent_at               timestamptz,
  opened_at             timestamptz,
  completed_at          timestamptz,
  arrived_at            timestamptz,
  reviewed_at           timestamptz,
  ready_at              timestamptz
);

-- ── INDEXES ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_clinic_patients_doctor  ON public.clinic_patients(doctor_id);
CREATE INDEX IF NOT EXISTS idx_clinic_patients_token   ON public.clinic_patients(token);
CREATE INDEX IF NOT EXISTS idx_clinic_patients_qstatus ON public.clinic_patients(questionnaire_status);

-- ── updated_at TRIGGER ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_clinic_patients_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_touch_clinic_patients ON public.clinic_patients;
CREATE TRIGGER trg_touch_clinic_patients
  BEFORE UPDATE ON public.clinic_patients
  FOR EACH ROW EXECUTE FUNCTION public.touch_clinic_patients_updated_at();

-- ── PERMISSIONS (table-level grants for the API roles) ──────
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinic_patients TO authenticated;
GRANT SELECT ON public.clinic_patients TO anon;

-- ── ROW LEVEL SECURITY ──────────────────────────────────────
ALTER TABLE public.clinic_patients ENABLE ROW LEVEL SECURITY;

-- SELECT: a doctor sees their own patients; admins see all
DROP POLICY IF EXISTS cp_select ON public.clinic_patients;
CREATE POLICY cp_select ON public.clinic_patients
  FOR SELECT TO authenticated
  USING (
    auth.uid() = doctor_id
    OR EXISTS (SELECT 1 FROM public.profiles p
               WHERE p.id = auth.uid() AND (p.is_admin = true OR p.role = 'admin'))
  );

-- INSERT: a doctor may insert rows owned by themselves
DROP POLICY IF EXISTS cp_insert ON public.clinic_patients;
CREATE POLICY cp_insert ON public.clinic_patients
  FOR INSERT TO authenticated
  WITH CHECK ( auth.uid() = doctor_id );

-- UPDATE: a doctor may update their own patients
DROP POLICY IF EXISTS cp_update ON public.clinic_patients;
CREATE POLICY cp_update ON public.clinic_patients
  FOR UPDATE TO authenticated
  USING ( auth.uid() = doctor_id )
  WITH CHECK ( auth.uid() = doctor_id );

-- DELETE: a doctor may delete their own patients
DROP POLICY IF EXISTS cp_delete ON public.clinic_patients;
CREATE POLICY cp_delete ON public.clinic_patients
  FOR DELETE TO authenticated
  USING ( auth.uid() = doctor_id );

-- ── TOKEN-BASED ANONYMOUS QUESTIONNAIRE ACCESS ──────────────
-- The token (in the patient's link) is the secret. SECURITY DEFINER
-- functions let an un-authenticated patient read their own record and
-- submit answers WITHOUT exposing the table to anon.

DROP FUNCTION IF EXISTS public.get_clinic_patient_by_token(text);
CREATE FUNCTION public.get_clinic_patient_by_token(p_token text)
RETURNS TABLE (
  id uuid, patient_name text, procedure text, hospital text, surgery_date date,
  questionnaire_status text, questionnaire_answers jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.clinic_patients AS cp
     SET questionnaire_status = CASE WHEN cp.questionnaire_status = 'sent' THEN 'opened' ELSE cp.questionnaire_status END,
         opened_at = COALESCE(cp.opened_at, now())
   WHERE cp.token = p_token;
  RETURN QUERY
    SELECT cp.id, cp.patient_name, cp.procedure, cp.hospital, cp.surgery_date,
           cp.questionnaire_status, cp.questionnaire_answers
      FROM public.clinic_patients cp
     WHERE cp.token = p_token;
END; $$;

CREATE OR REPLACE FUNCTION public.mark_clinic_questionnaire_progress(p_token text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.clinic_patients AS cp
     SET questionnaire_status = CASE WHEN cp.questionnaire_status IN ('sent','opened') THEN 'in_progress' ELSE cp.questionnaire_status END
   WHERE cp.token = p_token;
END; $$;

CREATE OR REPLACE FUNCTION public.submit_clinic_questionnaire(p_token text, p_answers jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.clinic_patients AS cp
     SET questionnaire_answers = p_answers,
         questionnaire_status  = 'completed',
         completed_at = now(),
         patient_status = CASE WHEN cp.patient_status = 'awaiting_questionnaire' THEN 'awaiting_consultation' ELSE cp.patient_status END
   WHERE cp.token = p_token;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_clinic_patient_by_token(text)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_clinic_questionnaire_progress(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_clinic_questionnaire(text, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Done. Table public.clinic_patients now exists with RLS + grants.
-- ============================================================
