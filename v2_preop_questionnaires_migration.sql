-- ============================================================
-- Anestheo /v2 — preop_questionnaires (+ preop_checklist)
-- The registered-patient questionnaire (questionnaire.html) and the
-- patient dashboard read/write this table. Run in Supabase SQL Editor.
-- Idempotent. Includes both the requested columns AND the columns the
-- current frontend actually writes (so nothing breaks).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.preop_questionnaires (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id        uuid,                              -- reserved for templates
  questionnaire_data jsonb NOT NULL DEFAULT '{}'::jsonb,-- requested name
  answers            jsonb NOT NULL DEFAULT '{}'::jsonb,-- frontend writes this
  risk_flags         jsonb NOT NULL DEFAULT '[]'::jsonb,
  completion_percent int  NOT NULL DEFAULT 0,           -- requested name
  completion         int  NOT NULL DEFAULT 0,           -- frontend writes this
  current_step       int  NOT NULL DEFAULT 1,
  status             text NOT NULL DEFAULT 'in_progress', -- in_progress | submitted
  submitted_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (patient_id)                                   -- upsert target (onConflict: patient_id)
);

-- Add any missing columns if an older partial table exists
ALTER TABLE public.preop_questionnaires ADD COLUMN IF NOT EXISTS template_id        uuid;
ALTER TABLE public.preop_questionnaires ADD COLUMN IF NOT EXISTS questionnaire_data jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.preop_questionnaires ADD COLUMN IF NOT EXISTS answers            jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.preop_questionnaires ADD COLUMN IF NOT EXISTS risk_flags         jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.preop_questionnaires ADD COLUMN IF NOT EXISTS completion_percent int  DEFAULT 0;
ALTER TABLE public.preop_questionnaires ADD COLUMN IF NOT EXISTS completion         int  DEFAULT 0;
ALTER TABLE public.preop_questionnaires ADD COLUMN IF NOT EXISTS current_step       int  DEFAULT 1;
ALTER TABLE public.preop_questionnaires ADD COLUMN IF NOT EXISTS status             text DEFAULT 'in_progress';
ALTER TABLE public.preop_questionnaires ADD COLUMN IF NOT EXISTS submitted_at       timestamptz;

CREATE INDEX IF NOT EXISTS idx_preop_q_patient ON public.preop_questionnaires(patient_id);
CREATE INDEX IF NOT EXISTS idx_preop_q_status  ON public.preop_questionnaires(status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_preop_q_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_touch_preop_q ON public.preop_questionnaires;
CREATE TRIGGER trg_touch_preop_q BEFORE UPDATE ON public.preop_questionnaires
  FOR EACH ROW EXECUTE FUNCTION public.touch_preop_q_updated_at();

-- Grants
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.preop_questionnaires TO authenticated;

-- RLS: patient owns their row; doctors/admins may read all
ALTER TABLE public.preop_questionnaires ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pq_select ON public.preop_questionnaires;
CREATE POLICY pq_select ON public.preop_questionnaires
  FOR SELECT TO authenticated
  USING (
    auth.uid() = patient_id
    OR EXISTS (SELECT 1 FROM public.profiles p
               WHERE p.id = auth.uid()
                 AND (p.is_admin = true OR p.role IN ('admin','doctor','nurse')))
  );

DROP POLICY IF EXISTS pq_insert ON public.preop_questionnaires;
CREATE POLICY pq_insert ON public.preop_questionnaires
  FOR INSERT TO authenticated WITH CHECK ( auth.uid() = patient_id );

DROP POLICY IF EXISTS pq_update ON public.preop_questionnaires;
CREATE POLICY pq_update ON public.preop_questionnaires
  FOR UPDATE TO authenticated
  USING ( auth.uid() = patient_id ) WITH CHECK ( auth.uid() = patient_id );

DROP POLICY IF EXISTS pq_delete ON public.preop_questionnaires;
CREATE POLICY pq_delete ON public.preop_questionnaires
  FOR DELETE TO authenticated USING ( auth.uid() = patient_id );

-- ── preop_checklist (used by preop-instructions.html) ──
CREATE TABLE IF NOT EXISTS public.preop_checklist (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  items       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (patient_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.preop_checklist TO authenticated;
ALTER TABLE public.preop_checklist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pc_all ON public.preop_checklist;
CREATE POLICY pc_all ON public.preop_checklist
  FOR ALL TO authenticated
  USING ( auth.uid() = patient_id ) WITH CHECK ( auth.uid() = patient_id );

NOTIFY pgrst, 'reload schema';
-- ============================================================
-- Done. preop_questionnaires now exists with RLS + grants.
-- ============================================================
