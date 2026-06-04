-- ============================================================
-- Anestheo /v2 — Patient↔Clinician Bridge: foundation (Epic A / Milestone 1)
-- Implements the authoritative state model in WORKFLOW_REFERENCE.md §1, §7, §8, §9.
--   Authoritative (mutable): care_request.status, review_state
--   Authoritative (set-once): lifecycle milestone timestamps
--   journey_status is DERIVED in app/RPC code — NOT stored here.
-- Run in Supabase SQL Editor. Idempotent and additive (non-destructive).
-- ============================================================

-- ── 1. patient_surgeries: attachment + set-once lifecycle milestones ──
ALTER TABLE public.patient_surgeries
  ADD COLUMN IF NOT EXISTS assigned_doctor_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at          timestamptz,
  ADD COLUMN IF NOT EXISTS ready_at             timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS completion_source    text,
  ADD COLUMN IF NOT EXISTS recovery_started_at  timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at          timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_surgeries_completion_source_chk') THEN
    ALTER TABLE public.patient_surgeries
      ADD CONSTRAINT patient_surgeries_completion_source_chk
      CHECK (completion_source IS NULL OR completion_source IN ('clinician_confirmed','patient_reported'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_patient_surgeries_doctor ON public.patient_surgeries(assigned_doctor_id);

-- ── 2. preop_questionnaires: review_state = single source of truth (§8) ──
ALTER TABLE public.preop_questionnaires
  ADD COLUMN IF NOT EXISTS review_state   text NOT NULL DEFAULT 'not_submitted',
  ADD COLUMN IF NOT EXISTS reviewed_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS reviewer_notes text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'preop_q_review_state_chk') THEN
    ALTER TABLE public.preop_questionnaires
      ADD CONSTRAINT preop_q_review_state_chk
      CHECK (review_state IN ('not_submitted','pending','in_review','changes_requested','approved'));
  END IF;
END $$;

-- ── 3. profiles: clinician directory fields (Epic B groundwork) ──
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS accepting_patients boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS display_name       text,
  ADD COLUMN IF NOT EXISTS clinic_name        text,
  ADD COLUMN IF NOT EXISTS specialty          text,
  ADD COLUMN IF NOT EXISTS bio                text;

-- Directory visibility: any authenticated user may read a doctor's profile row
-- ONLY when that doctor has opted in. (Additive policy; does not loosen own-row access.)
DROP POLICY IF EXISTS profiles_directory_read ON public.profiles;
CREATE POLICY profiles_directory_read ON public.profiles
  FOR SELECT TO authenticated
  USING ( accepting_patients = true );

-- ── 4. care_requests: the attachment handshake (§7) ──
CREATE TABLE IF NOT EXISTS public.care_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doctor_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  surgery_id    uuid REFERENCES public.patient_surgeries(id) ON DELETE CASCADE,
  origin_method text NOT NULL DEFAULT 'directory',     -- directory | share_code | clinic_created
  status        text NOT NULL DEFAULT 'requested',     -- requested | accepted | declined | revoked | closed
  message       text,
  decline_reason text,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  responded_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'care_requests_status_chk') THEN
    ALTER TABLE public.care_requests ADD CONSTRAINT care_requests_status_chk
      CHECK (status IN ('requested','accepted','declined','revoked','closed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'care_requests_origin_chk') THEN
    ALTER TABLE public.care_requests ADD CONSTRAINT care_requests_origin_chk
      CHECK (origin_method IN ('directory','share_code','clinic_created'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_care_requests_patient ON public.care_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_care_requests_doctor  ON public.care_requests(doctor_id);
CREATE INDEX IF NOT EXISTS idx_care_requests_surgery ON public.care_requests(surgery_id);
-- Invariant #2 (one active request per surgery): at most one requested/accepted row per surgery.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_care_requests_active
  ON public.care_requests(surgery_id)
  WHERE status IN ('requested','accepted');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.care_requests TO authenticated;
ALTER TABLE public.care_requests ENABLE ROW LEVEL SECURITY;

-- Patient owns their requests; doctor sees/acts on requests addressed to them.
DROP POLICY IF EXISTS cr_select ON public.care_requests;
CREATE POLICY cr_select ON public.care_requests
  FOR SELECT TO authenticated
  USING ( auth.uid() = patient_id OR auth.uid() = doctor_id
          OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.is_admin = true OR p.role = 'admin')) );

DROP POLICY IF EXISTS cr_insert ON public.care_requests;
CREATE POLICY cr_insert ON public.care_requests
  FOR INSERT TO authenticated WITH CHECK ( auth.uid() = patient_id );

-- Patient may update own (revoke); doctor may update addressed (accept/decline).
DROP POLICY IF EXISTS cr_update ON public.care_requests;
CREATE POLICY cr_update ON public.care_requests
  FOR UPDATE TO authenticated
  USING ( auth.uid() = patient_id OR auth.uid() = doctor_id )
  WITH CHECK ( auth.uid() = patient_id OR auth.uid() = doctor_id );

-- ── 5. preparation_plans: the reviewed artifact, versioned (§9) ──
CREATE TABLE IF NOT EXISTS public.preparation_plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surgery_id          uuid NOT NULL REFERENCES public.patient_surgeries(id) ON DELETE CASCADE,
  questionnaire_id    uuid REFERENCES public.preop_questionnaires(id) ON DELETE SET NULL,
  version             int  NOT NULL DEFAULT 1,
  status              text NOT NULL DEFAULT 'draft',   -- draft | approved | superseded
  plan_content        jsonb NOT NULL DEFAULT '{}'::jsonb,
  medication_decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'preparation_plans_status_chk') THEN
    ALTER TABLE public.preparation_plans ADD CONSTRAINT preparation_plans_status_chk
      CHECK (status IN ('draft','approved','superseded'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_prep_plans_surgery ON public.preparation_plans(surgery_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.preparation_plans TO authenticated;
ALTER TABLE public.preparation_plans ENABLE ROW LEVEL SECURITY;

-- Patient reads ONLY approved plans for their own surgery (Inv5).
DROP POLICY IF EXISTS pp_patient_select ON public.preparation_plans;
CREATE POLICY pp_patient_select ON public.preparation_plans
  FOR SELECT TO authenticated
  USING (
    status = 'approved'
    AND EXISTS (SELECT 1 FROM public.patient_surgeries s
                WHERE s.id = preparation_plans.surgery_id AND s.patient_id = auth.uid())
  );

-- Assigned doctor reads/writes plans for surgeries assigned to them (Inv1, Inv4).
DROP POLICY IF EXISTS pp_doctor_all ON public.preparation_plans;
CREATE POLICY pp_doctor_all ON public.preparation_plans
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.patient_surgeries s
            WHERE s.id = preparation_plans.surgery_id AND s.assigned_doctor_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.patient_surgeries s
            WHERE s.id = preparation_plans.surgery_id AND s.assigned_doctor_id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';
-- ============================================================
-- Done. Foundation in place. Transition RPCs and the assignment-scoped
-- tightening of the existing preop_questionnaires doctor-read policy arrive
-- with their epics (B/E). journey_status remains DERIVED (never written).
-- ============================================================
