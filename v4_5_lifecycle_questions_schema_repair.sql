-- ============================================================
-- v4_5 — LIFECYCLE ELIGIBILITY: THE QUESTIONS JOIN, REPAIRED
--
-- NOT APPLIED. Review, then run in the Supabase SQL Editor.
--
-- WHAT BROKE, AND WHY THE GRANT REPAIR DID NOT FIX IT.
--
-- v4_4 restored EXECUTE on the lifecycle RPCs, and the menu stopped saying
-- "permission denied". It then said
--
--     column q.surgery_id does not exist
--
-- and Archive and Delete were still dead. Same symptom, second cause.
--
-- v4_3_function_hardening.sql ends patient_lifecycle_eligibility with a
-- warnings clause:
--
--     'warnings', CASE WHEN v_act='archive' AND v_kind='journey'
--                        AND EXISTS (SELECT 1 FROM public.questions q
--                                     WHERE q.surgery_id = p_id ...)
--
-- public.questions has no surgery_id column on this database, and never has.
-- v2_patient_journeys_phase1.sql adds it CONDITIONALLY:
--
--     IF pg_temp.pj_has('public.questions', ARRAY['patient_id']) THEN
--       ALTER TABLE public.questions ADD COLUMN ... surgery_id ...
--     ELSE
--       RAISE NOTICE 'STAGE 1: SKIPPED - public.questions has no patient_id
--                     (legacy contact-form table).'
--
-- Production's questions table was the legacy contact-form one — id,
-- created_at, name, role, topic, question, email, is_answered, is_published,
-- deleted_at, deleted_by, delete_reason — with no patient_id. So the ELSE
-- branch ran, the column was never created, and v4_3 was later written against
-- a column that did not exist. v9_7_questions_portal.sql then added the
-- canonical patient_id/subject/message/status/updated_at, deliberately
-- WITHOUT surgery_id, because it was written against production truth.
--
-- WHY THIS KILLED THE ELIGIBLE PATH SPECIFICALLY. That clause lives in the
-- function's FINAL RETURN — the one reached only when nothing has refused the
-- action. PL/pgSQL prepares and plans that statement when it executes, and
-- planning it has to resolve q.surgery_id. It cannot, so the function raises
-- before any CASE condition is evaluated: the guard "WHEN v_act='archive'"
-- never gets the chance to skip the subquery. Every EARLY return — already
-- archived, not authorized, a blocking consultation — worked fine, because
-- those statements never mention questions.
--
-- So the exact records a doctor could act on were the only ones that failed,
-- for both kinds and for every action. And patient_lifecycle_action() opens by
-- calling patient_lifecycle_eligibility(), so the write was broken by the same
-- line as the read. One column reference disabled Archive, Delete, Restore and
-- Restore-from-bin across the whole product.
--
-- THE REPAIR. Replace the function body with the same logic, sourcing the
-- warning from the CANONICAL relationship instead:
--
--   journey         patient_surgeries.patient_id -> questions.patient_id
--   clinic_patient  resolved ONLY through the explicit, UNIQUE link
--                   patient_surgeries.clinic_patient_id, and only when exactly
--                   one live journey carries it. Never by name or email:
--                   matching a person by contact string is how one patient's
--                   questions end up attached to another's record.
--
-- When no patient account can be resolved, there is simply no warning. A
-- warning is advisory — it never blocks — so its absence is the correct
-- conservative answer and not a refusal.
--
-- WHAT IS DELIBERATELY UNCHANGED: authorization order (authorization before
-- existence, so a refusal cannot describe what it refuses), every clinical
-- blocker, every state check, the structured jsonb shape, the soft-delete
-- model, SECURITY DEFINER, the pinned search_path, and the signature — so
-- v4_4's grants carry over untouched. This file issues no GRANT and no REVOKE.
--
-- It also does not touch patient_lifecycle_action(): that function was always
-- correct. It writes archived_at / deleted_at and nothing else, never touches a
-- child row, and has no DELETE statement anywhere.
--
-- SAFETY: transaction-wrapped, idempotent, preflighted and verified. The
-- preflight refuses to run if the columns it now depends on are missing, so
-- this cannot repeat v4_3's mistake of assuming a column into existence.
-- ============================================================

BEGIN;

-- ============================================================
-- 0. PREFLIGHT — assume nothing about the schema
-- ============================================================
DO $preflight$
DECLARE
  v_missing text[] := '{}';
BEGIN
  IF to_regprocedure('public.patient_lifecycle_eligibility(text,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'ABORT: patient_lifecycle_eligibility(text,uuid,text) is missing. Apply v4_patient_lifecycle.sql through v4_3_function_hardening.sql first.';
  END IF;
  IF to_regprocedure('public.patient_record_manageable(text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ABORT: patient_record_manageable(text,uuid) is missing.';
  END IF;
  IF to_regproc('public.is_platform_admin') IS NULL THEN
    RAISE EXCEPTION 'ABORT: is_platform_admin() is missing.';
  END IF;

  -- The columns this version reads. Named individually so the error says which.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='questions' AND column_name='patient_id')
    THEN v_missing := v_missing || 'questions.patient_id (apply v9_7_questions_portal.sql)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='questions' AND column_name='status')
    THEN v_missing := v_missing || 'questions.status'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='questions' AND column_name='deleted_at')
    THEN v_missing := v_missing || 'questions.deleted_at'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='patient_surgeries' AND column_name='patient_id')
    THEN v_missing := v_missing || 'patient_surgeries.patient_id'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='patient_surgeries' AND column_name='clinic_patient_id')
    THEN v_missing := v_missing || 'patient_surgeries.clinic_patient_id (apply v2_clinic_bridge_convergence.sql)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='care_requests' AND column_name='surgery_id')
    THEN v_missing := v_missing || 'care_requests.surgery_id'; END IF;

  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: this repair depends on columns that are missing: %', array_to_string(v_missing, ', ');
  END IF;

  -- Informational: confirm the column that caused the outage really is absent,
  -- so the operator can see the diagnosis is about THIS database.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='questions' AND column_name='surgery_id') THEN
    RAISE NOTICE 'Note: questions.surgery_id DOES exist here. The repair is still correct — patient_id is the canonical link — but this database is not the one the outage was diagnosed on.';
  ELSE
    RAISE NOTICE 'Confirmed: questions.surgery_id does not exist. This is the outage described above.';
  END IF;

  RAISE NOTICE 'Preflight OK.';
END
$preflight$;

-- The subquery the new body will run, executed standalone so a planning
-- failure surfaces HERE, inside the transaction, rather than months later in a
-- doctor's menu. This is the check whose absence caused the outage.
DO $planproof$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM public.questions q
   WHERE q.patient_id = '00000000-0000-0000-0000-000000000000'::uuid
     AND q.status <> 'answered'
     AND q.deleted_at IS NULL;
  RAISE NOTICE 'Plan proof OK: the questions predicate resolves against the live schema.';
END
$planproof$;

-- ============================================================
-- 1. THE FUNCTION
-- ============================================================
-- Byte-for-byte v4_3's logic apart from the warning block, which is now
-- computed in PL/pgSQL before the RETURN. Two reasons for moving it out of the
-- returned expression: a variable is readable, and a statement that can fail
-- fails on its own line instead of taking the whole answer down with it.
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
  v_patient uuid;
  v_links   int;
  v_warn    jsonb := '[]'::jsonb;
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

  -- The one clinical blocker. Unchanged, and care_requests.surgery_id is a real
  -- column — verified in the preflight above, unlike the one this file repairs.
  IF v_act = 'archive' AND v_kind = 'journey'
     AND EXISTS (SELECT 1 FROM public.care_requests cr
                  WHERE cr.surgery_id = p_id AND cr.status = 'requested'
                    AND cr.deleted_at IS NULL) THEN
    RETURN jsonb_build_object('eligible',false,'code','clinical_blocker',
      'reason','A consultation request is still open for this patient. Resolve it first.');
  END IF;

  -- ── THE REPAIRED WARNING ────────────────────────────────────────────────
  -- Advisory only: it never blocks, and a record with no resolvable patient
  -- account simply carries no warning. Computed for archive alone, exactly as
  -- before — but now as its own statement, so the guard genuinely guards.
  IF v_act = 'archive' THEN
    IF v_kind = 'journey' THEN
      SELECT s.patient_id INTO v_patient
        FROM public.patient_surgeries s
       WHERE s.id = p_id;
    ELSE
      -- clinic_patient: the ONLY honest route to a patient account is the
      -- explicit back-link written at conversion time. It is UNIQUE, so more
      -- than one live journey should be impossible; the count is checked
      -- anyway, because "should be impossible" is not a guarantee and a
      -- warning attached to the wrong person is worse than no warning.
      SELECT count(*) INTO v_links
        FROM public.patient_surgeries s
       WHERE s.clinic_patient_id = p_id AND s.deleted_at IS NULL;

      IF v_links = 1 THEN
        SELECT s.patient_id INTO v_patient
          FROM public.patient_surgeries s
         WHERE s.clinic_patient_id = p_id AND s.deleted_at IS NULL;
      ELSE
        v_patient := NULL;                 -- none, or ambiguous: say nothing
      END IF;
    END IF;

    IF v_patient IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.questions q
                    WHERE q.patient_id = v_patient
                      AND q.status <> 'answered'
                      AND q.deleted_at IS NULL) THEN
      v_warn := jsonb_build_array('This patient has an unanswered question.');
    END IF;
  END IF;

  RETURN jsonb_build_object('eligible',true,'code','eligible',
    'reason', CASE v_act
                WHEN 'archive'         THEN 'Moves the patient to Archived. Nothing is deleted.'
                WHEN 'restore_archive' THEN 'Returns the patient to the active list.'
                WHEN 'delete'          THEN 'Moves the patient to the Recycle Bin. Recoverable.'
                ELSE 'Restores the patient from the Recycle Bin.' END,
    'warnings', v_warn);
END;
$$;

-- No GRANT and no REVOKE in this file. CREATE OR REPLACE preserves the existing
-- privileges, and v4_4 already set them correctly; re-issuing them here would
-- make two files the authority on one question.

-- ============================================================
-- 2. VERIFICATION — READ ONLY, AND IT ABORTS ON DISAGREEMENT
-- ============================================================
DO $verify$
DECLARE
  v_def text := pg_get_functiondef(to_regprocedure('public.patient_lifecycle_eligibility(text,uuid,text)'));
  v_res jsonb;
BEGIN
  -- 2a. the broken reference is gone.
  IF v_def LIKE '%q.surgery_id%' OR v_def LIKE '%questions q%surgery_id%' THEN
    RAISE EXCEPTION 'VERIFY FAILED: the function still references questions.surgery_id.';
  END IF;

  -- 2b. and the canonical one is present.
  IF v_def NOT LIKE '%q.patient_id = v_patient%' THEN
    RAISE EXCEPTION 'VERIFY FAILED: the function does not join questions on patient_id.';
  END IF;

  -- 2c. nothing security-relevant was lost in the rewrite.
  IF v_def NOT LIKE '%SECURITY DEFINER%'          THEN RAISE EXCEPTION 'VERIFY FAILED: SECURITY DEFINER lost.'; END IF;
  IF v_def NOT LIKE '%search_path%'               THEN RAISE EXCEPTION 'VERIFY FAILED: search_path no longer pinned.'; END IF;
  IF v_def NOT LIKE '%patient_record_manageable%' THEN RAISE EXCEPTION 'VERIFY FAILED: the authorization check is gone.'; END IF;
  IF v_def NOT LIKE '%clinical_blocker%'          THEN RAISE EXCEPTION 'VERIFY FAILED: the clinical blocker is gone.'; END IF;
  IF v_def NOT LIKE '%already_archived%' OR v_def NOT LIKE '%already_deleted%'
     OR v_def NOT LIKE '%not_archived%'  OR v_def NOT LIKE '%not_deleted%' THEN
    RAISE EXCEPTION 'VERIFY FAILED: a state check is missing.';
  END IF;

  -- 2d. it RUNS. auth.uid() is NULL in a SQL Editor session, so the expected
  -- answer is the not-signed-in refusal — structured jsonb, not an exception.
  -- Before this file, this same call raised 42703 for an eligible record.
  v_res := public.patient_lifecycle_eligibility('journey','00000000-0000-0000-0000-000000000000'::uuid,'archive');
  IF v_res IS NULL OR v_res->>'code' IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: the function did not return structured jsonb.';
  END IF;
  RAISE NOTICE 'Smoke test returned code=% (not_authorized is expected here: auth.uid() is NULL in the SQL Editor).', v_res->>'code';

  -- 2e. the write path is intact and is still soft-delete only.
  IF to_regprocedure('public.patient_lifecycle_action(text,uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: patient_lifecycle_action is missing.';
  END IF;
  IF pg_get_functiondef(to_regprocedure('public.patient_lifecycle_action(text,uuid,text,text)')) ~* 'DELETE\s+FROM' THEN
    RAISE EXCEPTION 'VERIFY FAILED: patient_lifecycle_action contains a physical DELETE.';
  END IF;

  RAISE NOTICE '--- VERIFIED ---------------------------------------------';
  RAISE NOTICE '  no questions.surgery_id reference remains';
  RAISE NOTICE '  the warning now joins questions on patient_id';
  RAISE NOTICE '  authorization, blockers and state checks intact';
  RAISE NOTICE '  the eligible path returns jsonb instead of raising';
  RAISE NOTICE '  patient_lifecycle_action is soft-delete only';
  RAISE NOTICE '----------------------------------------------------------';
END
$verify$;

-- Privileges are asserted, never set: this file must not become a second
-- authority on what v4_4 decided.
DO $grants$
DECLARE f text; bad text[] := '{}';
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'patient_lifecycle_eligibility(text,uuid,text)',
    'patient_lifecycle_action(text,uuid,text,text)',
    'patient_set_starred(text,uuid,boolean)',
    'patient_purge_eligibility(text,uuid)',
    'patient_purge(text,uuid,text)',
    'recycle_bin_list()',
    'journey_visible(uuid)',
    'clinic_patient_visible(uuid)'
  ] LOOP
    IF NOT has_function_privilege('authenticated','public.'||f,'EXECUTE') THEN bad := bad || ('authenticated cannot execute '||f); END IF;
    IF     has_function_privilege('anon','public.'||f,'EXECUTE')          THEN bad := bad || ('anon CAN execute '||f); END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'patient_record_manageable(text,uuid)','patient_record_readable(text,uuid)',
    'patient_purge_dependencies(text,uuid)','recycle_bin_item(text,uuid)',
    'care_request_visible(uuid)','lifecycle_state(timestamptz,timestamptz)'
  ] LOOP
    IF to_regprocedure('public.'||f) IS NOT NULL
       AND (has_function_privilege('authenticated','public.'||f,'EXECUTE')
            OR has_function_privilege('anon','public.'||f,'EXECUTE'))
      THEN bad := bad || ('internal helper is client-executable: '||f); END IF;
  END LOOP;
  IF array_length(bad,1) IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: v4_4 grant state has regressed: %', array_to_string(bad, '; ');
  END IF;
  RAISE NOTICE 'v4_4 grant state confirmed unchanged by this file.';
END
$grants$;

-- The soft-delete lockdown from v4_2 and its repair. Nothing above touches
-- table privileges or policies; this proves it, and fails loudly if some other
-- change has quietly reopened a direct DELETE.
DO $lockdown$
DECLARE missing text[] := '{}';
BEGIN
  IF has_table_privilege('authenticated','public.clinic_patients','DELETE')   THEN missing := missing || 'authenticated DELETE on clinic_patients'; END IF;
  IF has_table_privilege('authenticated','public.patient_surgeries','DELETE') THEN missing := missing || 'authenticated DELETE on patient_surgeries'; END IF;
  IF has_table_privilege('anon','public.clinic_patients','DELETE')            THEN missing := missing || 'anon DELETE on clinic_patients'; END IF;
  IF has_table_privilege('anon','public.patient_surgeries','DELETE')          THEN missing := missing || 'anon DELETE on patient_surgeries'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clinic_patients'
                   AND policyname='cp_no_direct_delete' AND permissive='RESTRICTIVE')
    THEN missing := missing || 'restrictive policy cp_no_direct_delete'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='patient_surgeries'
                   AND policyname='ps_no_direct_delete' AND permissive='RESTRICTIVE')
    THEN missing := missing || 'restrictive policy ps_no_direct_delete'; END IF;

  IF array_length(missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: the soft-delete lockdown has regressed: %', array_to_string(missing, ', ');
  END IF;
  RAISE NOTICE 'Soft-delete lockdown intact: no direct DELETE, both restrictive policies present.';
END
$lockdown$;

COMMIT;

-- ============================================================
-- AFTERWARDS
-- ============================================================
-- Run v4_release_verify.sql. Section 3 should read "ready" for all eight RPCs
-- and section 4 "ok" for all ten invariants.
--
-- Then, signed in as a verified doctor with one active patient, the menu should
-- offer Archive and Delete ENABLED. Read-only check of what the function now
-- answers, as that doctor:
--
--   SELECT public.patient_lifecycle_eligibility('clinic_patient', '<id>', 'archive');
--   -- expect {"eligible": true, "code": "eligible", "warnings": [...]}
--
-- ROLLBACK: re-apply v4_3_function_hardening.sql, which restores the previous
-- body. That reinstates the outage described at the top of this file and is
-- only ever correct if this migration was applied to the wrong database.
-- ============================================================
