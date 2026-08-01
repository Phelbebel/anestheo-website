-- ============================================================
-- Anestheo /v2 - Safe patient archiving (additive, non-destructive)
--
-- Archiving is NOT deletion. A doctor may ARCHIVE a completed / inactive
-- patient they are assigned to, and RESTORE it. Only an admin may permanently
-- DELETE. Archiving is INDEPENDENT of every clinical status (consultation,
-- questionnaire, review, readiness, journey): it lives in its own columns on
-- the canonical patient record and never reuses a clinical status field.
--
-- Canonical patient record = public.patient_surgeries (see
-- v2_unified_patient_record.sql: "ONE canonical record for every patient").
-- Doctor-invited clinic_patients rows are mirrored 1:1 onto patient_surgeries
-- via clinic_patient_id, so archiving the canonical record covers both lanes.
-- patient_surgeries.archived_at ALREADY EXISTS (v2_bridge_foundation) and is
-- already understood by the patient-side surfaces (patients.html,
-- patient-dashboard.html, journey.js -> journey_status 'archived'). This
-- migration only adds the audit fields, the server-side eligibility gate, and
-- the archive / restore / admin-delete RPCs.
--
-- ADDITIVE ONLY. Idempotent. Pure ASCII. Does not rewrite older migrations.
-- Run in the Supabase SQL editor AFTER the bridge + unified-record migrations.
-- ============================================================

-- == 1. Additive archive/restore audit columns on the canonical record ==
-- (archived_at already exists; do not redefine it.)
ALTER TABLE public.patient_surgeries
  ADD COLUMN IF NOT EXISTS archived_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason text,
  ADD COLUMN IF NOT EXISTS restored_at    timestamptz,
  ADD COLUMN IF NOT EXISTS restored_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Partial index so "active list" and "archived filter" reads stay cheap.
CREATE INDEX IF NOT EXISTS idx_patient_surgeries_archived
  ON public.patient_surgeries(assigned_doctor_id) WHERE archived_at IS NOT NULL;

-- == 2. Keep ALL archive columns system-managed (RPC-only) ==
-- Re-create the existing guard so the new archive columns cannot be written by
-- a direct client update either. Only the SECURITY DEFINER RPCs below (which
-- run as the table owner, not the 'authenticated' PostgREST role) may change
-- them. This is the "no direct client-side update can bypass eligibility" rule.
CREATE OR REPLACE FUNCTION public.guard_patient_surgeries_protected()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    IF NEW.assigned_doctor_id  IS DISTINCT FROM OLD.assigned_doctor_id
       OR NEW.assigned_at         IS DISTINCT FROM OLD.assigned_at
       OR NEW.ready_at            IS DISTINCT FROM OLD.ready_at
       OR NEW.completed_at        IS DISTINCT FROM OLD.completed_at
       OR NEW.completion_source   IS DISTINCT FROM OLD.completion_source
       OR NEW.recovery_started_at IS DISTINCT FROM OLD.recovery_started_at
       OR NEW.archived_at         IS DISTINCT FROM OLD.archived_at
       OR NEW.archived_by         IS DISTINCT FROM OLD.archived_by
       OR NEW.archive_reason      IS DISTINCT FROM OLD.archive_reason
       OR NEW.restored_at         IS DISTINCT FROM OLD.restored_at
       OR NEW.restored_by         IS DISTINCT FROM OLD.restored_by THEN
      RAISE EXCEPTION 'Workflow columns on patient_surgeries are system-managed';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
-- (trg_guard_patient_surgeries already installed by v2_bridge_directory_rpcs.sql.)

-- == 3. Audit trail: one row per archive / restore / delete action ==
-- surgery_id / clinic_patient_id are plain uuids (NO foreign key) so the audit
-- row SURVIVES a permanent delete of the patient record.
CREATE TABLE IF NOT EXISTS public.patient_archive_audit (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surgery_id        uuid,
  clinic_patient_id uuid,
  patient_name      text,
  actor_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role        text,                         -- doctor | admin
  action            text NOT NULL,                -- archive | restore | delete
  reason            text,
  prev_archived_at  timestamptz,                  -- previous archived state
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_archive_audit_action_chk CHECK (action IN ('archive','restore','delete'))
);
CREATE INDEX IF NOT EXISTS idx_archive_audit_surgery ON public.patient_archive_audit(surgery_id);
CREATE INDEX IF NOT EXISTS idx_archive_audit_actor   ON public.patient_archive_audit(actor_id);

-- Read-only to clients; rows are written exclusively by the definer RPCs below
-- (no INSERT/UPDATE/DELETE grant -> the audit trail cannot be forged or erased
-- from the client).
GRANT SELECT ON public.patient_archive_audit TO authenticated;
ALTER TABLE public.patient_archive_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS paa_select ON public.patient_archive_audit;
CREATE POLICY paa_select ON public.patient_archive_audit
  FOR SELECT TO authenticated
  USING (
    actor_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.patient_surgeries s
               WHERE s.id = patient_archive_audit.surgery_id
                 AND s.assigned_doctor_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles p
               WHERE p.id = auth.uid() AND (p.is_admin = true OR p.role = 'admin'))
  );

-- == 4. Canonical, server-side archive eligibility gate ==
-- ONE authoritative check. The frontend may call it to show/disable the button
-- and display the reason, but the archive RPC RE-CHECKS it before writing, so
-- the client never decides eligibility. Returns {eligible, code, reason}.
--
-- Blocked while ANY unresolved clinical/communication action remains:
--   * a pending consultation request (care_requests.status='requested')
--   * an unanswered patient question (questions.status not in answered/closed)
--   * a questionnaire submitted and awaiting review (review_state pending)
--   * a clinician decision still required (review_state in_review)
--   * a submitted document still unreviewed (requirement_documents.reviewed_at null)
--   * clinic-lane: consultation in progress, or questionnaire completed-not-reviewed
DROP FUNCTION IF EXISTS public.patient_archive_eligibility(uuid);
CREATE FUNCTION public.patient_archive_eligibility(p_surgery_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ps  public.patient_surgeries%ROWTYPE;
  v_cp  public.clinic_patients%ROWTYPE;
  v_is_admin boolean;
  v_rs  text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_ps FROM public.patient_surgeries WHERE id = p_surgery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patient record not found'; END IF;

  SELECT COALESCE(p.is_admin = true OR p.role = 'admin', false) INTO v_is_admin
    FROM public.profiles p WHERE p.id = v_uid;
  v_is_admin := COALESCE(v_is_admin, false);

  -- Ownership: only the assigned doctor (or an admin) may evaluate / act.
  IF NOT (v_ps.assigned_doctor_id = v_uid OR v_is_admin) THEN
    RETURN jsonb_build_object('eligible', false, 'code', 'not_owner',
      'reason', 'This patient is assigned to another doctor.');
  END IF;

  -- 1) Pending consultation request (attachment handshake still open).
  IF EXISTS (SELECT 1 FROM public.care_requests cr
             WHERE cr.surgery_id = p_surgery_id AND cr.status = 'requested') THEN
    RETURN jsonb_build_object('eligible', false, 'code', 'consultation_pending',
      'reason', 'This consultation request is still pending.');
  END IF;

  -- 2) Unanswered patient question (same rule the dashboard uses).
  IF v_ps.patient_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.questions q
        WHERE q.patient_id = v_ps.patient_id
          AND COALESCE(q.status,'new') NOT IN ('answered','closed')) THEN
    RETURN jsonb_build_object('eligible', false, 'code', 'question_unanswered',
      'reason', 'This patient has an unanswered question.');
  END IF;

  -- 3) Questionnaire submitted and awaiting the doctor's review / decision.
  IF v_ps.patient_id IS NOT NULL THEN
    SELECT review_state INTO v_rs FROM public.preop_questionnaires
      WHERE patient_id = v_ps.patient_id;
    IF v_rs = 'pending' THEN
      RETURN jsonb_build_object('eligible', false, 'code', 'questionnaire_unreviewed',
        'reason', 'The questionnaire has not yet been reviewed.');
    ELSIF v_rs = 'in_review' THEN
      RETURN jsonb_build_object('eligible', false, 'code', 'decision_required',
        'reason', 'A clinician decision is still required.');
    END IF;
  END IF;

  -- 4) A submitted document is still awaiting review.
  IF EXISTS (SELECT 1 FROM public.requirement_documents rd
             WHERE rd.surgery_id = p_surgery_id AND rd.reviewed_at IS NULL) THEN
    RETURN jsonb_build_object('eligible', false, 'code', 'document_unreviewed',
      'reason', 'A submitted document is still awaiting review.');
  END IF;

  -- 5) Clinic-lane (doctor-invited) unresolved states, read from the linked row.
  IF v_ps.clinic_patient_id IS NOT NULL THEN
    SELECT * INTO v_cp FROM public.clinic_patients WHERE id = v_ps.clinic_patient_id;
    IF FOUND THEN
      IF v_cp.consultation_status = 'arrived' THEN
        RETURN jsonb_build_object('eligible', false, 'code', 'consultation_in_progress',
          'reason', 'This patient''s consultation is still in progress.');
      END IF;
      IF v_cp.questionnaire_status = 'completed'
         AND v_cp.consultation_status IS DISTINCT FROM 'reviewed'
         AND v_cp.patient_status NOT IN ('ready_for_surgery','completed') THEN
        RETURN jsonb_build_object('eligible', false, 'code', 'questionnaire_unreviewed',
          'reason', 'The questionnaire has not yet been reviewed.');
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('eligible', true, 'code', 'ok', 'reason', 'Eligible for archiving.');
END; $$;
GRANT EXECUTE ON FUNCTION public.patient_archive_eligibility(uuid) TO authenticated;

-- == 5. archive_patient: assigned doctor (or admin), eligible only ==
DROP FUNCTION IF EXISTS public.archive_patient(uuid, text);
CREATE FUNCTION public.archive_patient(p_surgery_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ps  public.patient_surgeries%ROWTYPE;
  v_is_admin boolean; v_role text; v_elig jsonb; v_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_ps FROM public.patient_surgeries WHERE id = p_surgery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patient record not found'; END IF;

  SELECT COALESCE(is_admin = true OR role = 'admin', false), role
    INTO v_is_admin, v_role FROM public.profiles WHERE id = v_uid;
  v_is_admin := COALESCE(v_is_admin, false);

  IF NOT (v_ps.assigned_doctor_id = v_uid OR v_is_admin) THEN
    RAISE EXCEPTION 'You can only archive your own assigned patients.';
  END IF;

  IF v_ps.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('archived_at', v_ps.archived_at, 'already', true);
  END IF;

  -- Authoritative server-side re-check (never trust the client).
  v_elig := public.patient_archive_eligibility(p_surgery_id);
  IF NOT (v_elig->>'eligible')::boolean THEN
    RAISE EXCEPTION '%', v_elig->>'reason';
  END IF;

  v_name := COALESCE(v_ps.patient_name,
              (SELECT patient_name FROM public.clinic_patients WHERE id = v_ps.clinic_patient_id));

  UPDATE public.patient_surgeries
     SET archived_at = now(), archived_by = v_uid, archive_reason = p_reason,
         restored_at = NULL, restored_by = NULL, updated_at = now()
   WHERE id = p_surgery_id;

  INSERT INTO public.patient_archive_audit
         (surgery_id, clinic_patient_id, patient_name, actor_id, actor_role, action, reason, prev_archived_at)
  VALUES (p_surgery_id, v_ps.clinic_patient_id, v_name, v_uid,
          CASE WHEN v_is_admin THEN 'admin' ELSE COALESCE(v_role,'doctor') END,
          'archive', p_reason, NULL);

  RETURN jsonb_build_object('archived_at', now(), 'archived_by', v_uid, 'reason', p_reason);
END; $$;
GRANT EXECUTE ON FUNCTION public.archive_patient(uuid, text) TO authenticated;

-- == 6. restore_patient: assigned doctor (or admin) may un-archive ==
-- Clears archived_at so the record returns to its correct active state, which
-- is DERIVED from the untouched clinical/journey columns. No clinical status is
-- invented. archived_by/reason are preserved through the audit log; restored_by
-- / restored_at record who reactivated it.
DROP FUNCTION IF EXISTS public.restore_patient(uuid);
CREATE FUNCTION public.restore_patient(p_surgery_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ps  public.patient_surgeries%ROWTYPE;
  v_is_admin boolean; v_role text; v_prev timestamptz; v_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_ps FROM public.patient_surgeries WHERE id = p_surgery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patient record not found'; END IF;

  SELECT COALESCE(is_admin = true OR role = 'admin', false), role
    INTO v_is_admin, v_role FROM public.profiles WHERE id = v_uid;
  v_is_admin := COALESCE(v_is_admin, false);

  IF NOT (v_ps.assigned_doctor_id = v_uid OR v_is_admin) THEN
    RAISE EXCEPTION 'You can only restore your own archived patients.';
  END IF;

  IF v_ps.archived_at IS NULL THEN
    RETURN jsonb_build_object('restored', false, 'already_active', true);
  END IF;
  v_prev := v_ps.archived_at;

  v_name := COALESCE(v_ps.patient_name,
              (SELECT patient_name FROM public.clinic_patients WHERE id = v_ps.clinic_patient_id));

  UPDATE public.patient_surgeries
     SET archived_at = NULL, archived_by = NULL, archive_reason = NULL,
         restored_at = now(), restored_by = v_uid, updated_at = now()
   WHERE id = p_surgery_id;

  INSERT INTO public.patient_archive_audit
         (surgery_id, clinic_patient_id, patient_name, actor_id, actor_role, action, reason, prev_archived_at)
  VALUES (p_surgery_id, v_ps.clinic_patient_id, v_name, v_uid,
          CASE WHEN v_is_admin THEN 'admin' ELSE COALESCE(v_role,'doctor') END,
          'restore', NULL, v_prev);

  RETURN jsonb_build_object('restored', true, 'restored_by', v_uid);
END; $$;
GRANT EXECUTE ON FUNCTION public.restore_patient(uuid) TO authenticated;

-- == 7. admin_delete_patient: ADMIN-ONLY permanent deletion ==
-- Separate from archiving. Requires an explicit confirmation token so it can
-- never fire by accident. Deletes the canonical patient_surgeries record and
-- its surgery-keyed children (care_requests, preparation_plans,
-- requirement_documents, patient_recommendations cascade via their FKs) plus
-- the doctor-created clinic_patients shell. Account-level data owned by the
-- patient user (their questions and preop_questionnaire, keyed by patient_id)
-- is intentionally NOT destroyed by an admin acting on one surgical record.
-- Doctors have NO path to this function.
DROP FUNCTION IF EXISTS public.admin_delete_patient(uuid, text);
CREATE FUNCTION public.admin_delete_patient(p_surgery_id uuid, p_confirm text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ps  public.patient_surgeries%ROWTYPE;
  v_is_admin boolean; v_name text; v_clinic uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT COALESCE(is_admin = true OR role = 'admin', false) INTO v_is_admin
    FROM public.profiles WHERE id = v_uid;
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Only an administrator may permanently delete a patient.';
  END IF;

  IF p_confirm IS DISTINCT FROM 'DELETE' THEN
    RAISE EXCEPTION 'Permanent deletion requires explicit confirmation.';
  END IF;

  SELECT * INTO v_ps FROM public.patient_surgeries WHERE id = p_surgery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patient record not found'; END IF;

  v_clinic := v_ps.clinic_patient_id;
  v_name := COALESCE(v_ps.patient_name,
              (SELECT patient_name FROM public.clinic_patients WHERE id = v_clinic));

  -- Audit BEFORE the delete (surgery_id has no FK, so the row survives).
  INSERT INTO public.patient_archive_audit
         (surgery_id, clinic_patient_id, patient_name, actor_id, actor_role, action, reason, prev_archived_at)
  VALUES (p_surgery_id, v_clinic, v_name, v_uid, 'admin', 'delete', NULL, v_ps.archived_at);

  -- Surgery-keyed children cascade via their ON DELETE CASCADE foreign keys.
  DELETE FROM public.patient_surgeries WHERE id = p_surgery_id;

  -- Remove the doctor-created shell too (its own children cascade).
  IF v_clinic IS NOT NULL THEN
    DELETE FROM public.clinic_patients WHERE id = v_clinic;
  END IF;

  RETURN jsonb_build_object('deleted', true, 'surgery_id', p_surgery_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_delete_patient(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
-- ============================================================
-- Done.
--   Columns : patient_surgeries.archived_by / archive_reason / restored_at /
--             restored_by  (archived_at pre-existed).
--   Table   : patient_archive_audit (immutable from the client).
--   Gate    : patient_archive_eligibility(surgery) -> {eligible,code,reason}.
--   RPCs    : archive_patient(surgery,reason), restore_patient(surgery),
--             admin_delete_patient(surgery,'DELETE').
--   Guard   : direct client writes to any archive column are rejected; only the
--             SECURITY DEFINER RPCs above may change archive state.
-- Archiving preserves WhatsApp invitation history (clinic_patients token link),
-- consultations, questions, questionnaires, journey stages, notes, readiness
-- decisions, and timestamps -- nothing is deleted on archive or restore.
-- ============================================================
