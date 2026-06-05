-- ============================================================
-- Anestheo /v2 - Patient-Clinician Bridge: Directory + attachment RPCs
-- (Epic B / Milestone 2). Implements WORKFLOW_REFERENCE.md sec 5, sec 7 and
-- the attachment transitions, with assignment-scoped RLS so Invariant #1 holds
-- (Doctor A loses access the instant a patient switches).
-- Run in Supabase SQL Editor. Idempotent. Builds on v2_bridge_foundation.
-- NOTE: This file is intentionally pure ASCII (no smart quotes / placeholders)
-- so copy/paste cannot corrupt it. Run v2_bridge_foundation_migration.sql FIRST.
-- ============================================================

-- == 1. care_requests: decision snapshot (Inv1-safe; doctor decides without
--       gaining access to the live surgery/questionnaire until accept) ==
ALTER TABLE public.care_requests
  ADD COLUMN IF NOT EXISTS patient_name text,
  ADD COLUMN IF NOT EXISTS doctor_name  text,
  ADD COLUMN IF NOT EXISTS procedure    text,
  ADD COLUMN IF NOT EXISTS surgery_date date;

-- == 2. Protected-column triggers - two-sided consent + no self-approval ==
-- Patients own their surgery/questionnaire rows, but must NOT be able to set
-- the attachment/review/milestone columns directly. Those change only through
-- the SECURITY DEFINER RPCs below (which run as the table owner, not the
-- 'authenticated' PostgREST role).
CREATE OR REPLACE FUNCTION public.guard_patient_surgeries_protected()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    IF NEW.assigned_doctor_id IS DISTINCT FROM OLD.assigned_doctor_id
       OR NEW.assigned_at        IS DISTINCT FROM OLD.assigned_at
       OR NEW.ready_at           IS DISTINCT FROM OLD.ready_at
       OR NEW.completed_at       IS DISTINCT FROM OLD.completed_at
       OR NEW.completion_source  IS DISTINCT FROM OLD.completion_source
       OR NEW.recovery_started_at IS DISTINCT FROM OLD.recovery_started_at
       OR NEW.archived_at        IS DISTINCT FROM OLD.archived_at THEN
      RAISE EXCEPTION 'Workflow columns on patient_surgeries are system-managed';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_guard_patient_surgeries ON public.patient_surgeries;
CREATE TRIGGER trg_guard_patient_surgeries
  BEFORE UPDATE ON public.patient_surgeries
  FOR EACH ROW EXECUTE FUNCTION public.guard_patient_surgeries_protected();

CREATE OR REPLACE FUNCTION public.guard_preop_q_protected()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    IF NEW.review_state   IS DISTINCT FROM OLD.review_state
       OR NEW.reviewed_by   IS DISTINCT FROM OLD.reviewed_by
       OR NEW.reviewed_at   IS DISTINCT FROM OLD.reviewed_at
       OR NEW.reviewer_notes IS DISTINCT FROM OLD.reviewer_notes THEN
      RAISE EXCEPTION 'Review columns on preop_questionnaires are system-managed';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_guard_preop_q ON public.preop_questionnaires;
CREATE TRIGGER trg_guard_preop_q
  BEFORE UPDATE ON public.preop_questionnaires
  FOR EACH ROW EXECUTE FUNCTION public.guard_preop_q_protected();

-- == 3. Assignment-scoped RLS (Inv1) - replaces broad doctor reads ==
-- patient_surgeries: own OR assigned doctor OR admin.
DROP POLICY IF EXISTS ps_select ON public.patient_surgeries;
CREATE POLICY ps_select ON public.patient_surgeries
  FOR SELECT TO authenticated
  USING (
    auth.uid() = patient_id
    OR auth.uid() = assigned_doctor_id
    OR EXISTS (SELECT 1 FROM public.profiles p
               WHERE p.id = auth.uid() AND (p.is_admin = true OR p.role = 'admin'))
  );

-- preop_questionnaires: own OR doctor assigned to that patient's surgery OR admin.
DROP POLICY IF EXISTS pq_select ON public.preop_questionnaires;
CREATE POLICY pq_select ON public.preop_questionnaires
  FOR SELECT TO authenticated
  USING (
    auth.uid() = patient_id
    OR EXISTS (SELECT 1 FROM public.patient_surgeries s
               WHERE s.patient_id = preop_questionnaires.patient_id
                 AND s.assigned_doctor_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles p
               WHERE p.id = auth.uid() AND (p.is_admin = true OR p.role = 'admin'))
  );

-- Directory is exposed via a SECURITY DEFINER function (safe columns only),
-- so the broad profile-row read added in the foundation is removed.
DROP POLICY IF EXISTS profiles_directory_read ON public.profiles;

-- == 4. Directory listing (safe columns only) ==
DROP FUNCTION IF EXISTS public.get_clinician_directory();
CREATE FUNCTION public.get_clinician_directory()
RETURNS TABLE (id uuid, name text, specialty text, clinic text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id,
         COALESCE(NULLIF(p.display_name,''), p.full_name, 'Clinician') AS name,
         p.specialty,
         COALESCE(NULLIF(p.clinic_name,''), p.hospital) AS clinic
  FROM public.profiles p
  WHERE p.accepting_patients = true
    AND (p.role = 'doctor' OR p.is_admin = true);
$$;

-- == 5. Attachment transition RPCs (guarded) ==

-- request_clinician: patient creates care_request(requested) (sec 7, Inv2)
DROP FUNCTION IF EXISTS public.request_clinician(uuid, uuid, text);
CREATE FUNCTION public.request_clinician(p_surgery_id uuid, p_doctor_id uuid, p_message text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_proc text; v_date date; v_pname text; v_dname text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT procedure_type, surgery_date INTO v_proc, v_date
    FROM public.patient_surgeries WHERE id = p_surgery_id AND patient_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Surgery not found for this patient'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_doctor_id AND accepting_patients = true) THEN
    RAISE EXCEPTION 'Selected clinician is not accepting patients';
  END IF;
  -- Invariant #2: one active request per surgery.
  IF EXISTS (SELECT 1 FROM public.care_requests
             WHERE surgery_id = p_surgery_id AND status IN ('requested','accepted')) THEN
    RAISE EXCEPTION 'You already have an active clinician request for this surgery';
  END IF;
  SELECT full_name INTO v_pname FROM public.profiles WHERE id = v_uid;
  SELECT COALESCE(NULLIF(display_name,''), full_name, 'Clinician') INTO v_dname
    FROM public.profiles WHERE id = p_doctor_id;
  INSERT INTO public.care_requests
    (patient_id, doctor_id, surgery_id, origin_method, status, message,
     patient_name, doctor_name, procedure, surgery_date)
  VALUES
    (v_uid, p_doctor_id, p_surgery_id, 'directory', 'requested', NULLIF(p_message,''),
     COALESCE(v_pname,'Patient'), v_dname, v_proc, v_date)
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

-- respond_care_request: doctor accept or decline (sets assignment on accept)
DROP FUNCTION IF EXISTS public.respond_care_request(uuid, text, text);
CREATE FUNCTION public.respond_care_request(p_request_id uuid, p_decision text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_surgery uuid; v_status text; v_doctor uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT surgery_id, status, doctor_id INTO v_surgery, v_status, v_doctor
    FROM public.care_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF v_doctor <> v_uid THEN RAISE EXCEPTION 'Not authorised for this request'; END IF;
  IF v_status <> 'requested' THEN RAISE EXCEPTION 'Request is no longer pending'; END IF;

  IF p_decision = 'accept' THEN
    UPDATE public.care_requests
       SET status = 'accepted', responded_at = now(), updated_at = now()
     WHERE id = p_request_id;
    UPDATE public.patient_surgeries
       SET assigned_doctor_id = v_uid, assigned_at = now()
     WHERE id = v_surgery;
  ELSIF p_decision = 'decline' THEN
    UPDATE public.care_requests
       SET status = 'declined', decline_reason = NULLIF(p_reason,''),
           responded_at = now(), updated_at = now()
     WHERE id = p_request_id;
  ELSE
    RAISE EXCEPTION 'Invalid decision';
  END IF;
END; $$;

-- revoke_care_request: patient cancels / switches - resets review + supersedes
-- plans + clears assignment (Doctor A loses access immediately - sec 5, Inv1).
DROP FUNCTION IF EXISTS public.revoke_care_request(uuid);
CREATE FUNCTION public.revoke_care_request(p_surgery_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_ready timestamptz; v_found boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT ready_at, true INTO v_ready, v_found
    FROM public.patient_surgeries WHERE id = p_surgery_id AND patient_id = v_uid;
  IF NOT v_found THEN RAISE EXCEPTION 'Surgery not found for this patient'; END IF;
  -- sec 5 guard: switching is not allowed once cleared for surgery.
  IF v_ready IS NOT NULL THEN
    RAISE EXCEPTION 'You cannot change clinician after being marked ready for surgery';
  END IF;

  UPDATE public.care_requests
     SET status = 'revoked', responded_at = now(), updated_at = now()
   WHERE surgery_id = p_surgery_id AND patient_id = v_uid
     AND status IN ('requested','accepted');

  UPDATE public.patient_surgeries
     SET assigned_doctor_id = NULL, assigned_at = NULL
   WHERE id = p_surgery_id;

  -- sec 8: any active review resets to not_submitted on revoke/switch.
  UPDATE public.preop_questionnaires
     SET review_state = 'not_submitted', reviewed_by = NULL, reviewed_at = NULL, reviewer_notes = NULL
   WHERE patient_id = v_uid AND review_state <> 'not_submitted';

  -- sec 9: prior plans are superseded (never visible to the next clinician).
  UPDATE public.preparation_plans
     SET status = 'superseded', updated_at = now()
   WHERE surgery_id = p_surgery_id AND status IN ('draft','approved');
END; $$;

GRANT EXECUTE ON FUNCTION public.get_clinician_directory()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_clinician(uuid, uuid, text)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_care_request(uuid, text, text)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_care_request(uuid)                 TO authenticated;

NOTIFY pgrst, 'reload schema';
-- ============================================================
-- Done. Directory + attachment handshake live. Doctor access is now
-- assignment-scoped: revoke_care_request clears assigned_doctor_id, which
-- immediately fails the ps_select / pq_select / preparation_plans policies
-- for the prior doctor (Invariant #1 verified at the RLS layer).
-- ============================================================
