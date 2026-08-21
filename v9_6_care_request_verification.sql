-- ============================================================
-- v9_6_care_request_verification.sql
-- PREPARED FOR REVIEW - NOT APPLIED.
-- Apply AFTER v9_5_verification_boundary.sql.
-- ============================================================
--
-- THE AUDIT NOTE THIS FILE EXISTS TO ACT ON
-- -----------------------------------------
--   SECURITY DEFINER functions require their own authorization checks
--   because they bypass table RLS.
--
-- v9_5 gates twelve patient-management tables with RESTRICTIVE policies. That
-- is correct and it is not enough, because roughly a third of this product's
-- patient access never reaches a table policy: it goes through SECURITY
-- DEFINER functions, which run as their owner and therefore never consult RLS
-- at all. A RESTRICTIVE policy is invisible to them.
--
-- THE CHAIN THAT WAS TRACED
-- -------------------------
-- Six DEFINER functions form an unbroken path from "registered thirty seconds
-- ago" to "approved this person's anesthesia plan", with no verification test
-- at any step:
--
--   1. the doctor sets profiles.accepting_patients = true
--      (a self-editable column, settings.html:996)
--   2. get_clinician_directory()   lists them to patients
--      filter: accepting_patients AND (role='doctor' OR is_admin)
--   3. request_clinician()         a patient sends them a care request
--      check:  EXISTS(profiles WHERE id=p_doctor_id AND accepting_patients)
--   4. respond_care_request()      they accept
--      then:   UPDATE patient_surgeries SET assigned_doctor_id = auth.uid()
--   5. get_patient_plan / start_review / request_changes / save_doctor_plan /
--      mark_document_reviewed / approve_plan
--      check:  assigned_doctor_id = auth.uid()
--
-- Step 5 is correctly RELATIONSHIP-scoped and was never VERIFICATION-scoped.
-- Ownership answers "whose patient is this". It was never asked "should this
-- person be handling patients at all".
--
-- WHY THIS FILE CHANGES THREE FUNCTIONS AND NOT NINE
-- --------------------------------------------------
-- Step 4 is the only self-service write to assigned_doctor_id in the whole
-- schema. Every write was checked:
--
--   v2_bridge_directory_rpcs.sql:157  respond_care_request   <- this one
--   v2_bridge_directory_rpcs.sql:191  revoke_care_request    (sets NULL)
--   v2_admin_phase2.sql:449           admin assign           (admin RPC)
--   v2_admin_phase2.sql:484           admin transfer         (admin RPC)
--   v2_admin_phase2.sql:673           admin unassign         (sets NULL)
--
-- So closing step 4 makes all six functions in step 5 unreachable for an
-- unverified doctor, without touching one of them. Steps 2 and 3 are closed
-- as well, because a directory that lists clinicians who can never accept is
-- a promise to patients that the product cannot keep.
--
-- WHAT IS DELIBERATELY NOT CHANGED
-- --------------------------------
--   * No RLS policy, in either direction.
--   * No patient ownership rule. revoke_care_request, patient_archive_journey
--     and patient_delete_journey are untouched.
--   * No administrator behaviour. See the note on each function below.
--   * Live Tools, references and standalone Live Chart. None of them touch
--     any function in this file.
--   * The six step-5 review functions. They keep exactly the relationship
--     checks they have; they simply stop being reachable.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. PREFLIGHT
-- ============================================================
DO $preflight$
DECLARE v_missing text[] := '{}';
BEGIN
  IF to_regproc('public.is_verified_doctor')       IS NULL THEN v_missing := v_missing || 'is_verified_doctor() [v2_auth_onboarding.sql]'::text; END IF;
  IF to_regproc('public.is_platform_admin')        IS NULL THEN v_missing := v_missing || 'is_platform_admin() [v2_admin_phase0.sql]'::text; END IF;
  IF to_regproc('public.get_clinician_directory')  IS NULL THEN v_missing := v_missing || 'get_clinician_directory() [v2_bridge_directory_rpcs.sql]'::text; END IF;
  IF to_regproc('public.respond_care_request')     IS NULL THEN v_missing := v_missing || 'respond_care_request() [v2_bridge_directory_rpcs.sql]'::text; END IF;
  IF to_regclass('public.care_requests')           IS NULL THEN v_missing := v_missing || 'care_requests [v2_bridge_foundation_migration.sql]'::text; END IF;
  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: prerequisites missing: %', array_to_string(v_missing, ', ');
  END IF;
  RAISE NOTICE 'Preflight OK.';
END
$preflight$;

/* ADMINISTRATORS ARE CARRIED THROUGH EVERY CHECK BELOW, EXPLICITLY.
   Unlike v9_5, this file cannot rely on is_pending_doctor()'s built-in admin
   exemption, because it is asking the positive question: "are you approved?"
   An administrator's verification_status is 'not_required', not 'approved',
   so a bare equality test would quietly remove administrators from the
   clinician directory and stop them accepting a care request. Each check
   therefore reads (is_admin OR approved) rather than (approved). */


-- ============================================================
-- 2. get_clinician_directory() - stop listing unverified doctors
-- ============================================================
-- Rebuilt rather than patched, and column-tolerantly, because
-- v2_admin_phase2.sql already rebuilds this function conditionally on
-- display_name and clinic_name existing. Reproducing that shape is what keeps
-- this file safe on a deployment that has one column and not the other.
-- That file's own closing NOTICE reads "Verification filtering deliberately
-- unchanged" - it knew, and left it. This is the change it deferred.
--
-- The 4-column contract is unchanged: (id, name, specialty, clinic). Callers
-- do not move.
DO $directory$
DECLARE
  v_name_expr   text;
  v_clinic_expr text;
  v_has_deleted boolean;
  v_has_status  boolean;
  v_extra       text := '';
BEGIN
  v_name_expr := CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                                    WHERE table_schema='public' AND table_name='profiles'
                                      AND column_name='display_name')
                      THEN $x$COALESCE(NULLIF(p.display_name,''), p.full_name, 'Clinician')$x$
                      ELSE $x$COALESCE(p.full_name, 'Clinician')$x$ END;

  v_clinic_expr := CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                                      WHERE table_schema='public' AND table_name='profiles'
                                        AND column_name='clinic_name')
                        THEN $x$COALESCE(NULLIF(p.clinic_name,''), p.hospital)$x$
                        ELSE $x$p.hospital$x$ END;

  /* The account-lifecycle filters v2_admin_phase2 added. Carried forward only
     where the columns exist, so this file can never narrow the contract by
     naming something that is not there. */
  v_has_deleted := EXISTS (SELECT 1 FROM information_schema.columns
                            WHERE table_schema='public' AND table_name='profiles'
                              AND column_name='deleted_at');
  v_has_status  := EXISTS (SELECT 1 FROM information_schema.columns
                            WHERE table_schema='public' AND table_name='profiles'
                              AND column_name='account_status');
  IF v_has_deleted THEN v_extra := v_extra || ' AND p.deleted_at IS NULL'; END IF;
  IF v_has_status  THEN v_extra := v_extra || ' AND COALESCE(p.account_status, ''active'') = ''active'''; END IF;

  EXECUTE
    'CREATE OR REPLACE FUNCTION public.get_clinician_directory()' ||
    ' RETURNS TABLE (id uuid, name text, specialty text, clinic text)' ||
    ' LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp' ||
    ' AS $fn$' ||
    '   SELECT p.id,' ||
    '          ' || v_name_expr || ' AS name,' ||
    '          p.specialty,' ||
    '          ' || v_clinic_expr || ' AS clinic' ||
    '     FROM public.profiles p' ||
    '    WHERE p.accepting_patients = true' ||
    '      AND (p.role = ''doctor'' OR p.is_admin = true)' ||
    /* THE ADDED LINE. An administrator stays listed on the is_admin branch;
       an ordinary doctor must be approved. */
    '      AND (COALESCE(p.is_admin, false) = true' ||
    '           OR p.verification_status = ''approved'')' ||
    v_extra ||
    ' $fn$;';

  REVOKE ALL ON FUNCTION public.get_clinician_directory() FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.get_clinician_directory() TO authenticated;
  RAISE NOTICE 'get_clinician_directory(): unverified doctors are no longer listed. '
               'Contract unchanged (id, name, specialty, clinic).';
END
$directory$;


-- ============================================================
-- 3. request_clinician() - a patient cannot request an unverified doctor
-- ============================================================
-- Everything except the target check is reproduced verbatim from
-- v2_bridge_directory_rpcs.sql:110. Read the diff, not the file: the only
-- change is the EXISTS clause, which grew three conditions.
--
-- The message stays neutral. "Not accepting patients" and "not verified" are
-- deliberately indistinguishable to the caller: a patient has no use for the
-- difference, and telling them would turn this RPC into a way to enumerate
-- which clinicians have and have not been approved.
CREATE OR REPLACE FUNCTION public.request_clinician(p_surgery_id uuid, p_doctor_id uuid, p_message text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_proc text; v_date date; v_pname text; v_dname text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT procedure_type, surgery_date INTO v_proc, v_date
    FROM public.patient_surgeries WHERE id = p_surgery_id AND patient_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Surgery not found for this patient'; END IF;

  -- CHANGED. Was: EXISTS(profiles WHERE id = p_doctor_id AND accepting_patients = true)
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = p_doctor_id
       AND accepting_patients = true
       AND (role = 'doctor' OR COALESCE(is_admin,false) = true)
       AND (COALESCE(is_admin,false) = true OR verification_status = 'approved')
  ) THEN
    RAISE EXCEPTION 'Selected clinician is not available' USING ERRCODE = '42501';
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

REVOKE ALL ON FUNCTION public.request_clinician(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_clinician(uuid, uuid, text) TO authenticated;


-- ============================================================
-- 4. respond_care_request() - THE WRITE BOUNDARY
-- ============================================================
-- This is the one that matters. It is the only self-service write to
-- assigned_doctor_id in the schema, and assigned_doctor_id is the key every
-- downstream review function turns:
--
--   get_patient_plan, start_review, request_changes, save_doctor_plan,
--   mark_document_reviewed, approve_plan
--
-- all read `assigned_doctor_id = auth.uid()` and all are SECURITY DEFINER, so
-- none of them consults RLS and none of them can be reached by an account that
-- never becomes assigned. Six functions closed by one check, and not one of
-- their bodies touched.
--
-- The check sits BEFORE the decision branch on purpose. Declining is not a
-- privileged act - an unverified doctor who somehow holds a pending request
-- must still be able to decline it, or the request is stuck forever and the
-- patient is the one who waits. Only 'accept' is gated.
--
-- Everything else is reproduced verbatim from v2_bridge_directory_rpcs.sql:141.
CREATE OR REPLACE FUNCTION public.respond_care_request(p_request_id uuid, p_decision text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_surgery uuid; v_status text; v_doctor uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT surgery_id, status, doctor_id INTO v_surgery, v_status, v_doctor
    FROM public.care_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF v_doctor <> v_uid THEN RAISE EXCEPTION 'Not authorised for this request'; END IF;
  IF v_status <> 'requested' THEN RAISE EXCEPTION 'Request is no longer pending'; END IF;

  IF p_decision = 'accept' THEN
    -- ADDED. 42501 is insufficient_privilege: this is a permission refusal,
    -- not a bad argument, and PostgREST maps it to 403 rather than 400.
    IF NOT (public.is_verified_doctor() OR public.is_platform_admin()) THEN
      RAISE EXCEPTION 'Verification is required before accepting patients'
        USING ERRCODE = '42501';
    END IF;

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

REVOKE ALL ON FUNCTION public.respond_care_request(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_care_request(uuid, text, text) TO authenticated;


-- ============================================================
-- 5. VERIFY
-- ============================================================
DO $verify$
DECLARE v_src text; v_bad text[] := '{}';
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='get_clinician_directory';
  IF v_src IS NULL OR v_src NOT LIKE '%verification_status%' THEN
    v_bad := v_bad || 'get_clinician_directory() does not filter on verification_status'::text; END IF;

  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='request_clinician';
  IF v_src IS NULL OR v_src NOT LIKE '%verification_status%' THEN
    v_bad := v_bad || 'request_clinician() does not check verification_status'::text; END IF;

  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='respond_care_request';
  IF v_src IS NULL OR v_src NOT LIKE '%is_verified_doctor%' THEN
    v_bad := v_bad || 'respond_care_request() does not gate the assignment'::text; END IF;

  IF array_length(v_bad,1) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: %', array_to_string(v_bad, '; ');
  END IF;
  RAISE NOTICE 'Verified: the care-request chain requires verification at all three points.';
END
$verify$;

COMMIT;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Re-run the original definitions from v2_bridge_directory_rpcs.sql (lines 94,
-- 110 and 141) and the get_clinician_directory rebuild from
-- v2_admin_phase2.sql:263. Nothing here drops or creates a policy, a table, a
-- column or a grant, so there is no state to unwind beyond the three bodies.
--
-- WHO IS AFFECTED
--   patients             no change to their own data. They will see fewer
--                        clinicians in the directory: only approved ones.
--   administrators       no change. Carried explicitly through all three
--                        checks on the is_admin branch.
--   approved doctors     no change whatsoever.
--   unverified doctors   lose three things they should not have had: a listing
--                        in the patient directory, the ability to be requested,
--                        and the ability to accept. They keep the workspace,
--                        Live Tools, references, education and standalone Live
--                        Chart. Declining a request they already hold still
--                        works.
--
-- ALREADY-ASSIGNED UNVERIFIED DOCTORS ARE NOT DETACHED BY THIS FILE.
-- If an account accepted a patient before this ran, or was verified and later
-- un-approved, assigned_doctor_id still points at them and the six review
-- functions still test only that. Detaching them is a data decision with
-- clinical consequences - a patient mid-review would silently lose their
-- clinician - so it is deliberately not taken here. To find them:
--
--   SELECT s.id AS surgery, s.assigned_doctor_id, p.email, p.verification_status
--     FROM public.patient_surgeries s
--     JOIN public.profiles p ON p.id = s.assigned_doctor_id
--    WHERE s.assigned_doctor_id IS NOT NULL
--      AND COALESCE(p.is_admin,false) = false
--      AND COALESCE(p.verification_status,'') <> 'approved';
--
-- Run that before applying. If it returns rows, decide what should happen to
-- those patients before this file changes who can become one.
