-- ============================================================
-- FUNCTION-LEVEL HARDENING: least privilege, and no oracles
--
-- The lifecycle work put the right rules in the right place, but it granted
-- EXECUTE generously and several SECURITY DEFINER helpers answered questions
-- for records the caller has no claim to. A DEFINER function bypasses RLS by
-- design; if it does not re-ask the authorization question itself, it hands out
-- exactly what RLS was protecting. Measured on a schema replica, calling each
-- function directly as a patient, a pending doctor and an unrelated doctor:
--
--   patient_purge_dependencies()   returned the REAL dependency counts of any
--                                  patient id to any signed-in user. No
--                                  authorization check of any kind. Worst of
--                                  the five, and the browser never calls it.
--   journey_visible()              true for a real id, false for a fake one —
--   clinic_patient_visible()       an existence-and-not-deleted oracle for
--   care_request_visible()         anyone holding a record id.
--   patient_lifecycle_eligibility() answered 'not_authorized' for a record that
--                                  exists and 'record_not_found' for one that
--                                  does not: existence AND ownership, from the
--                                  refusal code alone.
--   recycle_bin_item()             same distinction, via its restore reason.
--
--   patient_purge_eligibility()    clean: admin-gated on the first line.
--   patient_record_manageable()    clean: false either way.
--
-- Two independent corrections, because either alone is weaker than it looks:
--
--   1. GRANTS. Only the five RPCs the browser actually calls keep EXECUTE.
--      Confirmed against the client source, not assumed: journey_visible and
--      clinic_patient_visible (clinical-open.js), patient_lifecycle_eligibility,
--      patient_lifecycle_action, patient_set_starred, patient_purge_eligibility,
--      patient_purge and recycle_bin_list (patient-lifecycle.js, admin.html),
--      admin_record_action (admin.html). Everything else is an internal helper
--      and is revoked.
--
--   2. GATES. Revoking a grant is a deployment fact, not a property of the
--      function — a later migration that adds a convenience GRANT would silently
--      reopen every oracle. So the helpers also learn to refuse. The two
--      predicates the browser DOES need keep their grant and answer only for a
--      caller who could have read the record anyway.
--
-- The gates deliberately mirror the existing SELECT policies exactly:
--   patient_surgeries  patient_id = uid OR assigned_doctor_id = uid OR admin
--   clinic_patients    doctor_id = uid OR admin
--   care_requests      patient_id = uid OR doctor_id = uid OR admin
-- plus the RESTRICTIVE "not a pending doctor" rule that applies to all three.
-- Anything wider would leak; anything narrower would break the canonical opener,
-- which calls the predicate only AFTER an RLS-scoped read has already succeeded.
--
-- No behaviour changes for an authorized caller. Verified by re-running the
-- full lifecycle, opener, security and UI suites after this migration.
--
-- ORDER: THIS FILE IS ALWAYS LAST, and must be re-applied after any re-run of
-- an earlier migration. Verified, not assumed: v4_2 defines care_request_visible
-- and re-running it after this file restores the ungated version and its grant.
-- This file is idempotent, so re-applying it is always the correct repair.
-- v4_release_verify.sql reports whether the hardened state is currently in force.
--
-- SAFETY: additive, idempotent, transaction-wrapped. Only removes capability.
-- ============================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regproc('public.patient_purge_dependencies') IS NULL THEN
    RAISE EXCEPTION 'ABORT: apply v4_patient_lifecycle.sql, v4_1_purge_safety.sql and v4_2_delete_lockdown.sql first.';
  END IF;
  IF to_regproc('public.is_pending_doctor') IS NULL THEN
    RAISE EXCEPTION 'ABORT: is_pending_doctor() is missing; apply the security hardening migration first.';
  END IF;
  RAISE NOTICE 'Preflight OK.';
END
$preflight$;

-- ============================================================
-- 1. ONE PLACE THAT ANSWERS "MAY THIS CALLER SEE THIS RECORD?"
-- ============================================================
-- Written once so the three predicates below cannot drift apart from each
-- other or from the SELECT policies they mirror. SECURITY DEFINER because it
-- must read the row to answer; it returns only a boolean about the CALLER, so
-- it discloses nothing an authorized caller could not already read.
CREATE OR REPLACE FUNCTION public.patient_record_readable(p_kind text, p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
     AND NOT public.is_pending_doctor()
     AND CASE lower(COALESCE(p_kind,''))
           WHEN 'journey' THEN EXISTS (
             SELECT 1 FROM public.patient_surgeries s
              WHERE s.id = p_id
                AND (s.patient_id = auth.uid() OR s.assigned_doctor_id = auth.uid()
                     OR public.is_platform_admin()))
           WHEN 'clinic_patient' THEN EXISTS (
             SELECT 1 FROM public.clinic_patients cp
              WHERE cp.id = p_id
                AND (cp.doctor_id = auth.uid() OR public.is_platform_admin()))
           WHEN 'care_request' THEN EXISTS (
             SELECT 1 FROM public.care_requests cr
              WHERE cr.id = p_id
                AND (cr.patient_id = auth.uid() OR cr.doctor_id = auth.uid()
                     OR public.is_platform_admin()))
           ELSE false
         END;
$$;
REVOKE ALL ON FUNCTION public.patient_record_readable(text,uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 2. THE VISIBILITY PREDICATES STOP BEING ORACLES
-- ============================================================
-- The lifecycle rule is unchanged: a record is visible when it is not deleted
-- and no parent above it is deleted. What changes is who is told. A caller who
-- could not read the record gets false — the same answer they get for an id
-- that does not exist, which is the whole point.
--
-- The PARENT lookup stays privileged: a journey's clinic patient may belong to
-- a different doctor, and the parent rule must still be enforced for them.
CREATE OR REPLACE FUNCTION public.journey_visible(p_surgery_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_surgery_id IS NULL THEN true
              WHEN NOT public.patient_record_readable('journey', p_surgery_id) THEN false
              ELSE EXISTS (
    SELECT 1 FROM public.patient_surgeries s
     WHERE s.id = p_surgery_id
       AND s.deleted_at IS NULL
       AND (s.clinic_patient_id IS NULL OR EXISTS (
             SELECT 1 FROM public.clinic_patients cp
              WHERE cp.id = s.clinic_patient_id AND cp.deleted_at IS NULL))
  ) END;
$$;

CREATE OR REPLACE FUNCTION public.clinic_patient_visible(p_clinic_patient_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_clinic_patient_id IS NULL THEN true
              WHEN NOT public.patient_record_readable('clinic_patient', p_clinic_patient_id) THEN false
              ELSE EXISTS (
    SELECT 1 FROM public.clinic_patients cp
     WHERE cp.id = p_clinic_patient_id AND cp.deleted_at IS NULL
  ) END;
$$;

CREATE OR REPLACE FUNCTION public.care_request_visible(p_care_request_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_care_request_id IS NULL THEN true
              WHEN NOT public.patient_record_readable('care_request', p_care_request_id) THEN false
              ELSE EXISTS (
    SELECT 1 FROM public.care_requests cr
     WHERE cr.id = p_care_request_id
       AND cr.deleted_at IS NULL
       -- The parent test runs privileged on purpose: the journey may be
       -- readable to the caller or not, and the answer must not depend on that.
       AND (cr.surgery_id IS NULL OR EXISTS (
             SELECT 1 FROM public.patient_surgeries s
              WHERE s.id = cr.surgery_id
                AND s.deleted_at IS NULL
                AND (s.clinic_patient_id IS NULL OR EXISTS (
                      SELECT 1 FROM public.clinic_patients cp
                       WHERE cp.id = s.clinic_patient_id AND cp.deleted_at IS NULL))))
  ) END;
$$;

-- ============================================================
-- 3. DEPENDENCY COUNTS ARE ADMINISTRATOR INFORMATION
-- ============================================================
-- "How many care requests, questionnaires and anesthesia records does this
-- patient have" is a description of someone's clinical footprint. It belongs to
-- the person deciding whether a purge may proceed, and to nobody else. The
-- refusal is shaped like every other structured answer so callers do not have
-- to special-case it.
CREATE OR REPLACE FUNCTION public.patient_purge_dependencies(p_kind text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_parent regclass;
  r record;
  v_n bigint;
  v_delete jsonb := '[]'::jsonb;
  v_detach jsonb := '[]'::jsonb;
  v_clinical jsonb := '[]'::jsonb;
  v_clinical_tables text[] := ARRAY[
    'anesthesia_cases','patient_recommendations','preparation_plans',
    'requirement_documents','preop_questionnaires','preop_checklist',
    'care_requests','questions'
  ];
BEGIN
  IF NOT public.is_platform_admin() THEN
    RETURN jsonb_build_object('error','not_authorized',
      'reason','Dependency detail is available to administrators only.');
  END IF;

  IF lower(COALESCE(p_kind,'')) = 'journey' THEN v_parent := 'public.patient_surgeries'::regclass;
  ELSIF lower(COALESCE(p_kind,'')) = 'clinic_patient' THEN v_parent := 'public.clinic_patients'::regclass;
  ELSE RETURN jsonb_build_object('error','invalid_kind');
  END IF;

  FOR r IN
    SELECT c.conrelid::regclass::text AS child,
           (SELECT a.attname FROM unnest(c.conkey) k
              JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k LIMIT 1) AS col,
           CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
                WHEN 'r' THEN 'RESTRICT' WHEN 'a' THEN 'NO ACTION' ELSE 'SET DEFAULT' END AS act
      FROM pg_constraint c
     WHERE c.contype='f' AND c.confrelid = v_parent
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', r.child, r.col)
      INTO v_n USING p_id;
    CONTINUE WHEN v_n = 0;

    IF r.act = 'CASCADE' THEN
      v_delete := v_delete || jsonb_build_object('table', r.child, 'column', r.col, 'rows', v_n);
    ELSE
      v_detach := v_detach || jsonb_build_object('table', r.child, 'column', r.col,
                                                 'rows', v_n, 'on_delete', r.act);
    END IF;

    IF replace(r.child,'public.','') = ANY (v_clinical_tables) THEN
      v_clinical := v_clinical || jsonb_build_object('table', r.child, 'rows', v_n,
                                                     'on_delete', r.act);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'records_to_delete', v_delete,
    'records_to_detach', v_detach,
    'clinical_dependencies', v_clinical);
END;
$$;

-- ============================================================
-- 4. A REFUSAL MUST NOT DESCRIBE WHAT IT IS REFUSING
-- ============================================================
-- The only change is the ORDER of two checks. Authorization is answered before
-- existence, so a non-admin receives the same 'not_authorized' whether the
-- record belongs to a colleague or does not exist at all —
-- patient_record_manageable() is already false in both cases. 'record_not_found'
-- survives for administrators, who are entitled to know the difference.
--
-- The wording changes with it. Telling a clinician "this patient is managed by
-- another doctor" about a record that has just been purged would be a lie, and
-- a lie told confidently is worse than a vaguer truth.
CREATE OR REPLACE FUNCTION public.patient_lifecycle_eligibility(
  p_kind text, p_id uuid, p_action text DEFAULT 'archive')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind text := lower(COALESCE(p_kind,''));
  v_act  text := lower(COALESCE(p_action,'archive'));
  v_arch timestamptz; v_del timestamptz; v_found boolean := false;
  v_admin boolean := public.is_platform_admin();
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('eligible',false,'code','not_authorized','reason','You are not signed in.');
  END IF;
  IF p_id IS NULL OR v_kind NOT IN ('journey','clinic_patient') THEN
    RETURN jsonb_build_object('eligible',false,'code','invalid_input',
      'reason','A record type of journey or clinic_patient and an id are required.');
  END IF;
  IF v_act NOT IN ('archive','restore_archive','delete','restore_delete') THEN
    RETURN jsonb_build_object('eligible',false,'code','invalid_input','reason','Unknown action.');
  END IF;

  -- Authorization FIRST. For a non-admin this is the same answer for a record
  -- that is not theirs and one that does not exist.
  IF NOT (v_admin OR public.patient_record_manageable(v_kind, p_id)) THEN
    RETURN jsonb_build_object('eligible',false,'code','not_authorized',
      'reason','This record is not available to you. It may belong to another clinician, or it may no longer exist.');
  END IF;

  IF v_kind = 'journey' THEN
    SELECT true, archived_at, deleted_at INTO v_found, v_arch, v_del
      FROM public.patient_surgeries WHERE id = p_id;
  ELSE
    SELECT true, archived_at, deleted_at INTO v_found, v_arch, v_del
      FROM public.clinic_patients WHERE id = p_id;
  END IF;

  -- Only an administrator can reach this: patient_record_manageable() requires
  -- the row to exist, so a non-admin was already refused above.
  IF NOT COALESCE(v_found,false) THEN
    RETURN jsonb_build_object('eligible',false,'code','record_not_found',
      'reason','That record no longer exists.');
  END IF;

  IF v_act = 'archive' THEN
    IF v_del  IS NOT NULL THEN RETURN jsonb_build_object('eligible',false,'code','already_deleted','reason','This record is in the Recycle Bin.'); END IF;
    IF v_arch IS NOT NULL THEN RETURN jsonb_build_object('eligible',false,'code','already_archived','reason','This record is already archived.'); END IF;
  ELSIF v_act = 'restore_archive' THEN
    IF v_del  IS NOT NULL THEN RETURN jsonb_build_object('eligible',false,'code','already_deleted','reason','Restore it from the Recycle Bin first.'); END IF;
    IF v_arch IS NULL     THEN RETURN jsonb_build_object('eligible',false,'code','not_archived','reason','This record is not archived.'); END IF;
  ELSIF v_act = 'delete' THEN
    IF v_del  IS NOT NULL THEN RETURN jsonb_build_object('eligible',false,'code','already_deleted','reason','This record is already in the Recycle Bin.'); END IF;
  ELSIF v_act = 'restore_delete' THEN
    IF v_del  IS NULL     THEN RETURN jsonb_build_object('eligible',false,'code','not_deleted','reason','This record is not deleted.'); END IF;
  END IF;

  IF v_act = 'archive' AND v_kind = 'journey'
     AND EXISTS (SELECT 1 FROM public.care_requests cr
                  WHERE cr.surgery_id = p_id AND cr.status = 'requested'
                    AND cr.deleted_at IS NULL) THEN
    RETURN jsonb_build_object('eligible',false,'code','clinical_blocker',
      'reason','A consultation request is still open for this patient. Resolve it first.');
  END IF;

  RETURN jsonb_build_object('eligible',true,'code','eligible',
    'reason', CASE v_act
                WHEN 'archive'         THEN 'Moves the patient to Archived. Nothing is deleted.'
                WHEN 'restore_archive' THEN 'Returns the patient to the active list.'
                WHEN 'delete'          THEN 'Moves the patient to the Recycle Bin. Recoverable.'
                ELSE 'Restores the patient from the Recycle Bin.' END,
    'warnings', CASE WHEN v_act='archive' AND v_kind='journey'
                       AND EXISTS (SELECT 1 FROM public.questions q
                                    WHERE q.surgery_id = p_id AND q.status <> 'answered'
                                      AND q.deleted_at IS NULL)
                     THEN jsonb_build_array('This patient has an unanswered question.')
                     ELSE '[]'::jsonb END);
END;
$$;

-- ============================================================
-- 5. LEAST PRIVILEGE ON EXECUTE
-- ============================================================
-- Checked against the client source rather than guessed. Everything not on the
-- keep list is an internal helper: it is still callable by the SECURITY DEFINER
-- functions that need it, because those run as the owner.
DO $grants$
DECLARE f text;
BEGIN
  -- Internal only. patient_purge_dependencies is reached through
  -- patient_purge_eligibility(), which embeds the preview in its answer — the
  -- browser has never called it directly.
  FOREACH f IN ARRAY ARRAY[
    'patient_record_manageable(text,uuid)',
    'patient_record_readable(text,uuid)',
    'patient_purge_dependencies(text,uuid)',
    'recycle_bin_item(text,uuid)',
    'care_request_visible(uuid)',
    'lifecycle_state(timestamptz,timestamptz)'
  ] LOOP
    IF to_regprocedure('public.'||f) IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON FUNCTION public.'||f||' FROM PUBLIC, anon, authenticated';
      RAISE NOTICE 'internal only: %', f;
    END IF;
  END LOOP;

  -- The browser genuinely calls these. Re-granted explicitly so this file is
  -- the single readable statement of what the client may invoke.
  FOREACH f IN ARRAY ARRAY[
    'journey_visible(uuid)',
    'clinic_patient_visible(uuid)',
    'patient_lifecycle_eligibility(text,uuid,text)',
    'patient_lifecycle_action(text,uuid,text,text)',
    'patient_set_starred(text,uuid,boolean)',
    'patient_purge_eligibility(text,uuid)',
    'patient_purge(text,uuid,text)',
    'recycle_bin_list()'
  ] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.'||f||' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||f||' TO authenticated';
  END LOOP;
END
$grants$;

DO $done$
BEGIN
  RAISE NOTICE '--- Function hardening installed -------------------------';
  RAISE NOTICE '  visibility predicates answer only for readable records';
  RAISE NOTICE '  dependency counts are administrator-only';
  RAISE NOTICE '  eligibility answers authorization before existence';
  RAISE NOTICE '  internal helpers revoked from authenticated and anon';
  RAISE NOTICE '----------------------------------------------------------';
END
$done$;

COMMIT;

-- ROLLBACK: re-apply v4_patient_lifecycle.sql, v4_1_purge_safety.sql and
-- v4_2_delete_lockdown.sql in that order to restore the previous function
-- bodies and grants, then DROP FUNCTION public.patient_record_readable(text,uuid).
-- Doing so reopens the disclosure documented at the top of this file.
