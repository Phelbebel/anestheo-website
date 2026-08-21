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
-- v9_5 gates patient-management tables with RESTRICTIVE policies. That is
-- correct and it is not enough, because much of this product's patient access
-- never reaches a table policy: it goes through SECURITY DEFINER functions,
-- which run as their owner and therefore never consult RLS at all. A
-- RESTRICTIVE policy is invisible to them.
--
-- MEASURED AGAINST PRODUCTION, NOT INFERRED
-- -----------------------------------------
-- v9_4_access_state_inventory.sql was run read-only against production. What
-- it found, and what each finding changed in this file:
--
--   anesthesia_case_access()   uses is_doctor_account()  -> v9 section 3 HAS run
--   anesthesia_case_editable() uses is_doctor_account()  -> same
--   restrictive gates present  1 (questions_require_verified only)
--   patient-management tables with NO gate: 9
--       care_requests, clinic_patients, patient_recommendations,
--       patient_surgeries, preop_checklist, preop_questionnaires,
--       preparation_plans, questionnaire_templates, requirement_documents
--   patient_archive_audit      absent
--   question_replies           absent
--   assigned to an unverified non-admin doctor: ZERO ROWS
--
-- So production is PARTIAL: significant parts of v9 are live, the table
-- boundary is largely gone, and v9_5 is closing a real hole rather than a
-- theoretical one. The zero-rows result also retires the caveat this file
-- previously carried about detaching already-assigned doctors: there are none.
--
-- AND THE PRODUCTION FUNCTION BODIES WERE READ. That is what changed most.
--
-- get_clinician_directory() IN PRODUCTION ALREADY FILTERS CORRECTLY:
--
--     WHERE p.accepting_patients = true
--       AND p.role = 'doctor'
--       AND p.verification_status = 'approved'
--       AND <active / not-deleted>
--
-- The previous draft of this file would have REPLACED that with
-- (role='doctor' OR is_admin) AND (is_admin OR approved). That is broader, not
-- narrower. It would have put a pure administrator into the patient-facing
-- clinician directory - an account whose is_admin flag is a platform privilege
-- and says nothing about whether they practise medicine. A migration written to
-- close a hole would have opened one.
--
-- The lesson is worth keeping: a hardening patch written against the migration
-- FILES rather than the deployed BODIES will reproduce whatever the files got
-- wrong. v2_bridge_directory_rpcs.sql:94 and v2_admin_phase2.sql:263 both build
-- a directory that admits administrators. Production does not. The files were
-- superseded and nothing recorded it.
--
-- So section 2 no longer touches the function. It verifies it.
--
-- WHAT THIS FILE CHANGES
-- ----------------------
--   request_clinician()     one condition -> four, matching the directory
--   respond_care_request()  one added check, in the accept branch only
--
-- and nothing else. Two function bodies.
--
-- NO ADMIN EXCEPTION ANYWHERE IN THIS FILE. The previous draft carried
-- (is_verified_doctor() OR is_platform_admin()) so that administrators were
-- "unchanged". That was the wrong reading of unchanged. A pure administrator
-- must not become a patient's treating doctor by virtue of administering the
-- platform; if an administrator genuinely practises, their account satisfies
-- role='doctor' and verification_status='approved' like anybody else's and
-- passes on those merits. Administrator intervention in assignment keeps its
-- own audited RPCs - v2_admin_phase2.sql:449 (assign) and :484 (transfer) -
-- which this file does not touch.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. PREFLIGHT
-- ============================================================
DO $preflight$
DECLARE v_missing text[] := '{}';
BEGIN
  IF to_regproc('public.is_verified_doctor')      IS NULL THEN v_missing := v_missing || 'is_verified_doctor() [v2_auth_onboarding.sql]'::text; END IF;
  IF to_regproc('public.get_clinician_directory') IS NULL THEN v_missing := v_missing || 'get_clinician_directory() [v2_bridge_directory_rpcs.sql]'::text; END IF;
  IF to_regproc('public.request_clinician')       IS NULL THEN v_missing := v_missing || 'request_clinician() [v2_bridge_directory_rpcs.sql]'::text; END IF;
  IF to_regproc('public.respond_care_request')    IS NULL THEN v_missing := v_missing || 'respond_care_request() [v2_bridge_directory_rpcs.sql]'::text; END IF;
  IF to_regclass('public.care_requests')          IS NULL THEN v_missing := v_missing || 'care_requests [v2_bridge_foundation_migration.sql]'::text; END IF;
  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: prerequisites missing: %', array_to_string(v_missing, ', ');
  END IF;
  RAISE NOTICE 'Preflight OK.';
END
$preflight$;


-- ============================================================
-- 2. get_clinician_directory() - VERIFIED, NOT REPLACED
-- ============================================================
-- Production's body is already correct. Replacing a correct function to make a
-- migration look complete is how the correction gets lost, so this section
-- reads the deployed body and reports on it instead.
--
-- It WARNS rather than aborts if the filter is missing. Aborting would block
-- the two real fixes below on a database whose directory happens to differ -
-- a dev branch, a restored snapshot - and an open directory without the other
-- two closed is strictly worse than an open directory with them closed. The
-- warning is loud and the verify block at the end repeats it.
DO $directory$
DECLARE v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_clinician_directory';

  IF v_src LIKE '%verification_status%' AND v_src LIKE '%approved%' THEN
    RAISE NOTICE 'get_clinician_directory(): already filters on verification. Left untouched.';
    IF v_src LIKE '%is_admin%' THEN
      RAISE WARNING 'get_clinician_directory() mentions is_admin. Confirm by hand that an '
                    'administrator cannot be listed as a clinician on the strength of that '
                    'flag alone. This file did not change the function.';
    END IF;
  ELSE
    RAISE WARNING 'get_clinician_directory() does NOT filter on verification_status. '
                  'Unverified doctors are visible to patients in the directory. This file '
                  'does not fix that - it deliberately does not replace this function - so '
                  'correct it separately, preserving role=doctor AND approved AND '
                  'accepting_patients AND active AND not-deleted.';
  END IF;
END
$directory$;


-- ============================================================
-- 3. request_clinician() - a patient may only request a real, approved doctor
-- ============================================================
-- Production validates only:
--     EXISTS (SELECT 1 FROM profiles WHERE id = p_doctor_id AND accepting_patients = true)
--
-- That admits an unverified doctor, a rejected doctor, a pure administrator and
-- a patient account, provided the row has accepting_patients set - and
-- accepting_patients is a self-editable column any account can set on itself in
-- settings. The directory does not show those accounts, but the directory is
-- not what this function checks.
--
-- The replacement mirrors the DIRECTORY'S conditions exactly, because the
-- directory is the definition of "a clinician a patient may choose", and two
-- definitions of that would eventually disagree. Same four conditions, plus the
-- account-lifecycle columns where this deployment has them.
--
-- Built through EXECUTE for one reason: deleted_at and account_status are added
-- by v2_admin_phase2.sql and a deployment may not have run it. A plpgsql body
-- naming a column that does not exist fails, so the predicate is assembled
-- against information_schema and only names what is there.
--
-- Everything else in the body is reproduced verbatim from
-- v2_bridge_directory_rpcs.sql:110. Read the diff, not the file.
DO $request$
DECLARE
  v_extra text := '';
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='profiles' AND column_name='deleted_at')
  THEN v_extra := v_extra || ' AND deleted_at IS NULL'; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='profiles' AND column_name='account_status')
  THEN v_extra := v_extra || ' AND COALESCE(account_status, ''active'') = ''active'''; END IF;

  EXECUTE
  'CREATE OR REPLACE FUNCTION public.request_clinician(p_surgery_id uuid, p_doctor_id uuid, p_message text)' ||
  ' RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$' ||
  ' DECLARE v_uid uuid := auth.uid(); v_id uuid; v_proc text; v_date date; v_pname text; v_dname text;' ||
  ' BEGIN' ||
  '   IF v_uid IS NULL THEN RAISE EXCEPTION ''Not authenticated''; END IF;' ||
  '   SELECT procedure_type, surgery_date INTO v_proc, v_date' ||
  '     FROM public.patient_surgeries WHERE id = p_surgery_id AND patient_id = v_uid;' ||
  '   IF NOT FOUND THEN RAISE EXCEPTION ''Surgery not found for this patient''; END IF;' ||
  /* ── THE CHANGED CLAUSE. No is_admin branch: an administrator who genuinely
        practises satisfies role=doctor and approved like anyone else. ── */
  '   IF NOT EXISTS (' ||
  '     SELECT 1 FROM public.profiles' ||
  '      WHERE id = p_doctor_id' ||
  '        AND accepting_patients = true' ||
  '        AND role = ''doctor''' ||
  '        AND verification_status = ''approved''' ||
        v_extra ||
  '   ) THEN' ||
  /* Neutral on purpose. "Not accepting patients", "not verified" and "not a
     doctor" are deliberately indistinguishable: a patient has no use for the
     difference, and distinguishing them would turn this RPC into a way to
     enumerate which accounts have been approved. */
  '     RAISE EXCEPTION ''Selected clinician is not available'' USING ERRCODE = ''42501'';' ||
  '   END IF;' ||
  '   IF EXISTS (SELECT 1 FROM public.care_requests' ||
  '              WHERE surgery_id = p_surgery_id AND status IN (''requested'',''accepted'')) THEN' ||
  '     RAISE EXCEPTION ''You already have an active clinician request for this surgery'';' ||
  '   END IF;' ||
  '   SELECT full_name INTO v_pname FROM public.profiles WHERE id = v_uid;' ||
  '   SELECT COALESCE(NULLIF(display_name,''''), full_name, ''Clinician'') INTO v_dname' ||
  '     FROM public.profiles WHERE id = p_doctor_id;' ||
  '   INSERT INTO public.care_requests' ||
  '     (patient_id, doctor_id, surgery_id, origin_method, status, message,' ||
  '      patient_name, doctor_name, procedure, surgery_date)' ||
  '   VALUES' ||
  '     (v_uid, p_doctor_id, p_surgery_id, ''directory'', ''requested'', NULLIF(p_message,''''),' ||
  '      COALESCE(v_pname,''Patient''), v_dname, v_proc, v_date)' ||
  '   RETURNING id INTO v_id;' ||
  '   RETURN v_id;' ||
  ' END; $fn$;';

  RAISE NOTICE 'request_clinician(): target must now be role=doctor AND approved AND '
               'accepting_patients%.', CASE WHEN v_extra = '' THEN '' ELSE ' AND active AND not-deleted' END;
END
$request$;

REVOKE ALL ON FUNCTION public.request_clinician(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_clinician(uuid, uuid, text) TO authenticated;


-- ============================================================
-- 4. respond_care_request() - THE WRITE BOUNDARY
-- ============================================================
-- The one that matters. It is the only self-service write to
-- assigned_doctor_id in the schema - all five writes were checked, and the
-- other four are admin RPCs or set NULL - and assigned_doctor_id is the key
-- every downstream review function turns:
--
--   get_patient_plan, start_review, request_changes, save_doctor_plan,
--   mark_document_reviewed, approve_plan
--
-- all read `assigned_doctor_id = auth.uid()` and all are SECURITY DEFINER, so
-- none of them consults RLS and none can be reached by an account that never
-- becomes assigned. Six functions closed by one check, none of their bodies
-- touched.
--
-- is_verified_doctor() ALONE. No is_platform_admin() disjunct. Administering
-- the platform is not practising medicine, and a treating relationship created
-- on the strength of an is_admin flag would be a clinical relationship nobody
-- clinically qualified for. An administrator who practises is an approved
-- doctor and passes on that. An administrator acting administratively uses the
-- audited admin assignment RPCs, which this file leaves alone.
--
-- The check sits INSIDE the accept branch on purpose. Declining is not a
-- privileged act, and gating it would leave a request stuck forever with the
-- patient waiting on a clinician who is not allowed to answer.
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
    -- ADDED. 42501 is insufficient_privilege: a permission refusal, not a bad
    -- argument, and PostgREST maps it to 403 rather than 400.
    IF NOT public.is_verified_doctor() THEN
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
   WHERE n.nspname='public' AND p.proname='request_clinician';
  IF v_src IS NULL OR v_src NOT LIKE '%verification_status%' THEN
    v_bad := v_bad || 'request_clinician() does not check verification_status'::text; END IF;
  IF v_src IS NOT NULL AND v_src LIKE '%is_admin%' THEN
    v_bad := v_bad || 'request_clinician() gained an is_admin branch - it must not have one'::text; END IF;

  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='respond_care_request';
  IF v_src IS NULL OR v_src NOT LIKE '%is_verified_doctor%' THEN
    v_bad := v_bad || 'respond_care_request() does not gate the assignment'::text; END IF;
  IF v_src IS NOT NULL AND v_src LIKE '%is_platform_admin%' THEN
    v_bad := v_bad || 'respond_care_request() has an admin bypass - it must not'::text; END IF;

  IF array_length(v_bad,1) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: %', array_to_string(v_bad, '; ');
  END IF;

  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='get_clinician_directory';
  RAISE NOTICE 'get_clinician_directory() unchanged by this file; filters on verification: %',
    (v_src LIKE '%verification_status%');
  RAISE NOTICE 'Verified: a patient may only request, and only an approved doctor may accept.';
END
$verify$;

COMMIT;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Re-run the original bodies from v2_bridge_directory_rpcs.sql:110
-- (request_clinician) and :141 (respond_care_request). get_clinician_directory
-- is not modified by this file, so there is nothing to restore for it.
-- Nothing here creates or drops a policy, table, column, trigger or grant to
-- anon, so there is no other state to unwind.
--
-- WHO IS AFFECTED
--   patients             no change to their own data, and no change to what
--                        they see: the directory already showed only approved
--                        doctors, so every clinician they can see is one they
--                        can still request.
--   administrators       a pure administrator can no longer be requested as a
--                        clinician, and can no longer accept a care request.
--                        This is a DELIBERATE NARROWING, not an oversight: the
--                        audited admin assignment and transfer RPCs remain the
--                        mechanism for administrator intervention. An
--                        administrator who also practises is role='doctor' and
--                        approved, and is unaffected.
--   approved doctors     no change whatsoever.
--   unverified doctors   cannot be requested and cannot accept. They keep the
--                        workspace, Live Tools, references, education and
--                        standalone Live Chart. They can still DECLINE a
--                        request they already hold.
--
-- NO CLEANUP IS REQUIRED. The production audit returned ZERO rows for
-- patient_surgeries assigned to a non-admin doctor whose verification_status is
-- not 'approved'. Nobody is detached by this file because nobody qualifies. Re-
-- run before applying if time has passed:
--
--   SELECT s.id AS surgery, s.assigned_doctor_id, p.email, p.verification_status
--     FROM public.patient_surgeries s
--     JOIN public.profiles p ON p.id = s.assigned_doctor_id
--    WHERE s.assigned_doctor_id IS NOT NULL
--      AND COALESCE(p.is_admin,false) = false
--      AND COALESCE(p.verification_status,'') <> 'approved';
