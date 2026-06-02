-- ============================================================
-- Anestheo /v2 — questionnaire_templates (Questionnaire Builder)
-- Groundwork for the upcoming Builder UI pass. Safe to run now.
-- Run in Supabase SQL Editor. Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.questionnaire_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text NOT NULL,                 -- e.g. "Orthopedic", "Cesarean Section"
  surgery_type  text,                          -- optional category key
  questions     jsonb NOT NULL DEFAULT '[]',   -- ordered array of question definitions
  is_default    boolean NOT NULL DEFAULT false,-- a starter/shared template
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qtemplates_doctor ON public.questionnaire_templates(doctor_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_qtemplates_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_touch_qtemplates ON public.questionnaire_templates;
CREATE TRIGGER trg_touch_qtemplates
  BEFORE UPDATE ON public.questionnaire_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_qtemplates_updated_at();

-- Grants
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.questionnaire_templates TO authenticated;

-- RLS: a doctor manages their own templates; everyone authenticated may
-- read shared default templates; admins read all.
ALTER TABLE public.questionnaire_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qt_select ON public.questionnaire_templates;
CREATE POLICY qt_select ON public.questionnaire_templates
  FOR SELECT TO authenticated
  USING (
    auth.uid() = doctor_id
    OR is_default = true
    OR EXISTS (SELECT 1 FROM public.profiles p
               WHERE p.id = auth.uid() AND (p.is_admin = true OR p.role = 'admin'))
  );

DROP POLICY IF EXISTS qt_insert ON public.questionnaire_templates;
CREATE POLICY qt_insert ON public.questionnaire_templates
  FOR INSERT TO authenticated
  WITH CHECK ( auth.uid() = doctor_id );

DROP POLICY IF EXISTS qt_update ON public.questionnaire_templates;
CREATE POLICY qt_update ON public.questionnaire_templates
  FOR UPDATE TO authenticated
  USING ( auth.uid() = doctor_id ) WITH CHECK ( auth.uid() = doctor_id );

DROP POLICY IF EXISTS qt_delete ON public.questionnaire_templates;
CREATE POLICY qt_delete ON public.questionnaire_templates
  FOR DELETE TO authenticated
  USING ( auth.uid() = doctor_id );

-- Let the clinic patient page receive an assigned template per patient
ALTER TABLE public.clinic_patients
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.questionnaire_templates(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
-- ============================================================
-- Done. (UI for this table arrives in the Builder pass.)
-- ============================================================
