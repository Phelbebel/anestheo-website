-- ============================================================
-- v4_4 — LIFECYCLE BROWSER GRANTS REPAIR
--
-- NOT APPLIED. Review, then run in the Supabase SQL Editor.
--
-- WHAT BROKE. The doctor's three-dot patient menu showed
--
--     permission denied for function patient_lifecycle_eligibility
--
-- verbatim, and Mark as Important, Archive and Delete were dead. A production
-- privilege audit found authenticated had lost EXECUTE on five browser RPCs:
--
--     patient_lifecycle_eligibility(text,uuid,text)
--     patient_lifecycle_action(text,uuid,text,text)
--     patient_set_starred(text,uuid,boolean)
--     patient_purge_eligibility(text,uuid)
--     patient_purge(text,uuid,text)
--
-- while recycle_bin_list() still had it — which is why the Recycle Bin kept
-- loading while every action on a card failed.
--
-- WHERE THE INTENT IS WRITTEN DOWN. v4_3_function_hardening.sql section 5 is
-- the single readable statement of what the client may invoke. Its keep list is
-- eight functions, checked against the client source rather than assumed:
--
--     journey_visible(uuid)                          clinical-open.js
--     clinic_patient_visible(uuid)                   clinical-open.js
--     patient_lifecycle_eligibility(text,uuid,text)  patient-lifecycle.js
--     patient_lifecycle_action(text,uuid,text,text)  patient-lifecycle.js
--     patient_set_starred(text,uuid,boolean)         patient-lifecycle.js
--     patient_purge_eligibility(text,uuid)           patient-lifecycle.js
--     patient_purge(text,uuid,text)                  patient-lifecycle.js
--     recycle_bin_list()                             patient-lifecycle.js, admin.html
--
-- Re-verified against the current client source before writing this file; all
-- eight are still called and nothing new was added to the list.
--
-- v4_release_verify.sql section 3 asserts the same eight, so the intended state
-- is documented twice and this migration restores exactly it. Nothing wider.
--
-- WHAT CAUSED THE DRIFT. Not a migration in this repository: no file here
-- revokes any of the five from authenticated, and every v4 file that mentions
-- them grants them. v4_3's own header names the one in-repo regression path —
-- re-running an earlier v4 file after v4_3 — but that path RESTORES grants, it
-- does not remove them. So the revoke came from outside these files (a manual
-- REVOKE, a role or database restore, or a drop-and-recreate, which resets
-- privileges where CREATE OR REPLACE preserves them). Recording that honestly
-- matters: this file repairs the state, it does not fix a cause it can see, and
-- the same drift can recur.
--
-- WHY A NEW FILE RATHER THAN RE-RUNNING v4_3. v4_3 says it is idempotent and is
-- "always the correct repair", and that is true. It is also broader than this
-- problem: it CREATE OR REPLACEs five function bodies. Production has already
-- run it. Re-running it to fix a GRANT would redeploy function definitions that
-- are not in question, and would silently overwrite any hotfix applied to those
-- bodies since. This file changes privileges only.
--
-- WHAT THIS FILE DOES NOT DO. It grants nothing to anon. It grants nothing to
-- the internal SECURITY DEFINER helpers, which stay revoked:
--
--     patient_record_manageable(text,uuid)
--     patient_record_readable(text,uuid)
--     patient_purge_dependencies(text,uuid)   dependency counts are admin-only
--     recycle_bin_item(text,uuid)
--     care_request_visible(uuid)              gated AND internal, by design
--     lifecycle_state(timestamptz,timestamptz)
--
-- It does not change a single function body, RLS policy, table grant or role.
-- Every one of the eight functions still enforces authorization internally —
-- EXECUTE is permission to ASK, never permission to receive. A patient calling
-- patient_lifecycle_eligibility on someone else's record gets 'not_authorized'
-- from the function, exactly as before.
--
-- SAFETY: transaction-wrapped, idempotent, and asserted afterwards. Section 3
-- is read-only and will ABORT the transaction if the end state is wrong, so a
-- partial or over-broad application cannot commit.
-- ============================================================

BEGIN;

-- ============================================================
-- 0. PREFLIGHT
-- ============================================================
-- Refuse to run against a database that never had the lifecycle release. A
-- GRANT on a missing function raises anyway; this says why.
DO $preflight$
DECLARE f text;
BEGIN
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
    IF to_regprocedure('public.'||f) IS NULL THEN
      RAISE EXCEPTION 'ABORT: public.% is missing. Apply v4_patient_lifecycle.sql, v4_1_purge_safety.sql, v4_2_delete_lockdown.sql and v4_3_function_hardening.sql first.', f;
    END IF;
  END LOOP;
  RAISE NOTICE 'Preflight OK: all eight browser RPCs exist.';
END
$preflight$;

-- ============================================================
-- 1. REPORT THE DRIFT BEFORE REPAIRING IT
-- ============================================================
-- So the operator running this can see what was actually wrong on THIS
-- database, rather than trusting the description at the top of the file.
DO $before$
DECLARE f text; n int := 0;
BEGIN
  RAISE NOTICE '--- EXECUTE for authenticated, BEFORE ---------------------';
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
    IF has_function_privilege('authenticated','public.'||f,'EXECUTE') THEN
      RAISE NOTICE '  ok       %', f;
    ELSE
      RAISE NOTICE '  MISSING  %', f;
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE '  % of 8 browser RPCs were not executable by authenticated.', n;
  RAISE NOTICE '----------------------------------------------------------';
END
$before$;

-- ============================================================
-- 2. RESTORE EXECUTE — THE EIGHT, AND ONLY THE EIGHT
-- ============================================================
-- The REVOKE ... FROM PUBLIC, anon before each GRANT is deliberate and is
-- copied from v4_3: PUBLIC carries EXECUTE on functions by default, so a
-- function that was dropped and recreated is executable by anon through PUBLIC
-- until that is taken away. Granting without revoking would repair the doctor
-- and open the door to anon in the same statement.
DO $grants$
DECLARE f text;
BEGIN
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
    RAISE NOTICE 'browser RPC restored: %', f;
  END LOOP;
END
$grants$;

-- The internal helpers are RE-REVOKED rather than merely left alone. If the
-- drift that removed the grants above was a drop-and-recreate, these came back
-- executable by PUBLIC at the same moment, and leaving them would turn a
-- repair into a regression. Revoking something already revoked is a no-op.
DO $internal$
DECLARE f text;
BEGIN
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
      RAISE NOTICE 'internal only (unchanged intent): %', f;
    END IF;
  END LOOP;
END
$internal$;

-- ============================================================
-- 3. VERIFICATION — READ ONLY, AND IT ABORTS ON DISAGREEMENT
-- ============================================================
-- Three independent claims. Each RAISEs rather than printing a warning,
-- because a migration that reports its own failure and commits anyway is worse
-- than one that never ran.
DO $verify$
DECLARE
  f text;
  v_missing text[] := '{}';
  v_anon    text[] := '{}';
  v_leaked  text[] := '{}';
BEGIN
  -- 3a. authenticated CAN execute every intended browser RPC.
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
    IF NOT has_function_privilege('authenticated','public.'||f,'EXECUTE') THEN
      v_missing := v_missing || f;
    END IF;
    -- 3b. anon CANNOT execute any of them.
    IF has_function_privilege('anon','public.'||f,'EXECUTE') THEN
      v_anon := v_anon || f;
    END IF;
  END LOOP;

  -- 3c. the internal helpers remain revoked from BOTH roles.
  FOREACH f IN ARRAY ARRAY[
    'patient_record_manageable(text,uuid)',
    'patient_record_readable(text,uuid)',
    'patient_purge_dependencies(text,uuid)',
    'recycle_bin_item(text,uuid)',
    'care_request_visible(uuid)',
    'lifecycle_state(timestamptz,timestamptz)'
  ] LOOP
    IF to_regprocedure('public.'||f) IS NOT NULL
       AND (has_function_privilege('authenticated','public.'||f,'EXECUTE')
            OR has_function_privilege('anon','public.'||f,'EXECUTE')) THEN
      v_leaked := v_leaked || f;
    END IF;
  END LOOP;

  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: authenticated still cannot execute: %', array_to_string(v_missing,', ');
  END IF;
  IF array_length(v_anon,1) IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: anon can execute: %', array_to_string(v_anon,', ');
  END IF;
  IF array_length(v_leaked,1) IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: internal helper is executable by a client role: %', array_to_string(v_leaked,', ');
  END IF;

  RAISE NOTICE '--- VERIFIED ---------------------------------------------';
  RAISE NOTICE '  8/8 browser RPCs executable by authenticated';
  RAISE NOTICE '  0/8 executable by anon';
  RAISE NOTICE '  6 internal helpers revoked from anon AND authenticated';
  RAISE NOTICE '----------------------------------------------------------';
END
$verify$;

-- One more claim this file must not weaken: v4_2 removed direct DELETE on the
-- two patient tables so that "Delete" can only ever mean the soft delete that
-- moves a record to the Recycle Bin. Nothing above touches table privileges,
-- and this proves it.
DO $nodelete$
BEGIN
  IF has_table_privilege('authenticated','public.clinic_patients','DELETE')
     OR has_table_privilege('authenticated','public.patient_surgeries','DELETE')
     OR has_table_privilege('anon','public.clinic_patients','DELETE')
     OR has_table_privilege('anon','public.patient_surgeries','DELETE') THEN
    RAISE EXCEPTION 'VERIFY FAILED: direct DELETE is available on a patient table; v4_2_delete_lockdown.sql has regressed.';
  END IF;
  RAISE NOTICE 'Soft-delete lockdown intact: no direct DELETE for anon or authenticated.';
END
$nodelete$;

COMMIT;

-- ============================================================
-- AFTERWARDS
-- ============================================================
-- Run v4_release_verify.sql. Section 3 should read "ready" for all eight RPCs
-- and section 4 should read "ok" for all ten invariants.
--
-- Standalone re-check, read only, safe to run at any time:
--
--   SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS fn,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('journey_visible','clinic_patient_visible','care_request_visible',
--                        'lifecycle_state','patient_record_manageable','patient_record_readable',
--                        'patient_lifecycle_eligibility','patient_lifecycle_action',
--                        'patient_set_starred','patient_purge','patient_purge_eligibility',
--                        'patient_purge_dependencies','recycle_bin_list','recycle_bin_item')
--    ORDER BY 1;
--
-- Expected: authenticated true for exactly the eight named in section 2,
-- false for the six internal helpers, and anon false for all fourteen.
--
-- ROLLBACK: REVOKE EXECUTE ON FUNCTION public.<fn> FROM authenticated for each
-- of the eight. That restores the broken production state and is only ever
-- correct if this file was applied to the wrong database.
-- ============================================================
