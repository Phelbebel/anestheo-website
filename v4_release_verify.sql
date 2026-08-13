-- ============================================================
-- RELEASE VERIFIER — READ ONLY
--
-- Run this after every migration stage. It writes nothing, changes nothing and
-- needs no arguments: every statement is a SELECT against the catalog.
--
-- It answers three questions the checklist depends on:
--   1. which migrations are actually in force on THIS database
--   2. whether the currently deployed frontend still has what it calls
--   3. whether the function hardening is in force (it regresses if an earlier
--      migration is re-run after v4_3 — re-apply v4_3 to repair)
--
-- Read the STAGE line first. Everything below it is the evidence.
-- ============================================================
\pset pager off
\timing off

\echo ''
\echo '════════ ANESTHEO RELEASE VERIFIER ════════'
\echo ''

-- ── 1. Which migrations are in force ──────────────────────────────────────
WITH m(ord, migration, present) AS (
  VALUES
    (1, 'v3_anesthesia_record     (Live Chart tables)',
        to_regclass('public.anesthesia_cases') IS NOT NULL),
    (2, 'v3_1_anesthesia_hardening (finalization guard)',
        to_regproc('public.anesthesia_guard_case_finalized') IS NOT NULL),
    (3, 'v4_patient_lifecycle      (lifecycle columns + RPCs)',
        to_regproc('public.patient_lifecycle_action') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='clinic_patients'
                       AND column_name='deleted_at')),
    (4, 'v4_1_purge_safety         (recycle_bin_list, purge rule)',
        to_regproc('public.recycle_bin_list') IS NOT NULL
        AND to_regclass('public.recycle_bin') IS NULL),
    (5, 'v4_2_delete_lockdown      (no direct DELETE)',
        NOT has_table_privilege('authenticated','public.clinic_patients','DELETE')
        AND to_regprocedure('public.admin_delete_patient(uuid,text)') IS NULL),
    (6, 'v4_3_function_hardening   (least privilege + gates)',
        to_regproc('public.patient_record_readable') IS NOT NULL
        AND NOT has_function_privilege('authenticated','public.patient_purge_dependencies(text,uuid)','EXECUTE'))
)
SELECT CASE WHEN present THEN '  [x] ' ELSE '  [ ] ' END || migration AS "migrations in force"
FROM m ORDER BY ord;

\echo ''
SELECT '  STAGE: ' || CASE
    WHEN to_regproc('public.patient_record_readable') IS NOT NULL
     AND NOT has_function_privilege('authenticated','public.patient_purge_dependencies(text,uuid)','EXECUTE')
      THEN 'F — fully migrated and hardened. Expected end state.'
    WHEN NOT has_table_privilege('authenticated','public.clinic_patients','DELETE')
      THEN 'E — delete lockdown applied, hardening NOT yet applied. Apply v4_3.'
    WHEN to_regproc('public.recycle_bin_list') IS NOT NULL
      THEN 'A4 — lifecycle backend ready. Deploy the frontend, then v4_2, then v4_3.'
    WHEN to_regproc('public.patient_lifecycle_action') IS NOT NULL
      THEN 'A3 — v4 applied, v4_1 still needed before the frontend goes live.'
    WHEN to_regclass('public.anesthesia_cases') IS NOT NULL
      THEN 'A1/A2 — Live Chart tables present, lifecycle not yet applied.'
    ELSE 'baseline — none of this release is applied.'
  END AS "current stage";

-- ── 2. Does the CURRENTLY DEPLOYED frontend still work? ───────────────────
-- Only meaningful before the new frontend is live. Once commit 783248c is
-- deployed these three SHOULD read "retired".
\echo ''
WITH o(ord, path, alive) AS (
  VALUES
    (1, 'old dashboard: archive eligibility',
        to_regprocedure('public.patient_archive_eligibility(uuid)') IS NOT NULL
        AND has_function_privilege('authenticated','public.patient_archive_eligibility(uuid)','EXECUTE')),
    (2, 'old dashboard: archive / restore',
        to_regprocedure('public.archive_patient(uuid,text)') IS NOT NULL
        AND has_function_privilege('authenticated','public.archive_patient(uuid,text)','EXECUTE')),
    (3, 'old dashboard: cancel invitation (direct DELETE)',
        has_table_privilege('authenticated','public.clinic_patients','DELETE'))
)
SELECT CASE WHEN alive THEN '  works   ' ELSE '  retired ' END || path
       AS "paths the OLD (main 1191f30) frontend uses"
FROM o ORDER BY ord;

-- ── 3. Does the NEW frontend have what it calls? ──────────────────────────
\echo ''
WITH n(ord, rpc_name, ready) AS (
  VALUES
    (1,'journey_visible(uuid)',                        has_function_privilege('authenticated','public.journey_visible(uuid)','EXECUTE')),
    (2,'clinic_patient_visible(uuid)',                 has_function_privilege('authenticated','public.clinic_patient_visible(uuid)','EXECUTE')),
    (3,'patient_lifecycle_eligibility(text,uuid,text)',has_function_privilege('authenticated','public.patient_lifecycle_eligibility(text,uuid,text)','EXECUTE')),
    (4,'patient_lifecycle_action(text,uuid,text,text)',has_function_privilege('authenticated','public.patient_lifecycle_action(text,uuid,text,text)','EXECUTE')),
    (5,'patient_set_starred(text,uuid,boolean)',       has_function_privilege('authenticated','public.patient_set_starred(text,uuid,boolean)','EXECUTE')),
    (6,'patient_purge_eligibility(text,uuid)',         has_function_privilege('authenticated','public.patient_purge_eligibility(text,uuid)','EXECUTE')),
    (7,'patient_purge(text,uuid,text)',                has_function_privilege('authenticated','public.patient_purge(text,uuid,text)','EXECUTE')),
    (8,'recycle_bin_list()',                           has_function_privilege('authenticated','public.recycle_bin_list()','EXECUTE'))
)
SELECT CASE WHEN ready THEN '  ready   ' ELSE '  MISSING ' END || rpc_name
       AS "RPCs the NEW (783248c) frontend calls"
FROM n ORDER BY ord;

-- ── 4. Security invariants ────────────────────────────────────────────────
\echo ''
WITH s(ord, invariant, holds) AS (
  VALUES
    (1,'no direct DELETE on patient_surgeries or clinic_patients',
       NOT has_table_privilege('authenticated','public.patient_surgeries','DELETE')
       AND NOT has_table_privilege('authenticated','public.clinic_patients','DELETE')
       AND NOT has_table_privilege('anon','public.patient_surgeries','DELETE')
       AND NOT has_table_privilege('anon','public.clinic_patients','DELETE')),
    (2,'admin_delete_patient() no longer exists',
       to_regprocedure('public.admin_delete_patient(uuid,text)') IS NULL),
    (3,'dependency counts are administrator-only',
       to_regprocedure('public.patient_purge_dependencies(text,uuid)') IS NULL
       OR NOT has_function_privilege('authenticated','public.patient_purge_dependencies(text,uuid)','EXECUTE')),
    (4,'visibility predicates are gated on readability',
       to_regprocedure('public.journey_visible(uuid)') IS NULL
       OR pg_get_functiondef(to_regprocedure('public.journey_visible(uuid)')) LIKE '%patient_record_readable%'),
    (5,'care_request_visible is gated and internal',
       to_regprocedure('public.care_request_visible(uuid)') IS NULL
       OR (pg_get_functiondef(to_regprocedure('public.care_request_visible(uuid)')) LIKE '%patient_record_readable%'
           AND NOT has_function_privilege('authenticated','public.care_request_visible(uuid)','EXECUTE'))),
    (6,'internal helpers are not granted to authenticated',
       NOT has_function_privilege('authenticated','public.patient_record_manageable(text,uuid)','EXECUTE')
       AND NOT has_function_privilege('authenticated','public.recycle_bin_item(text,uuid)','EXECUTE')),
    (7,'nothing lifecycle-related is executable by anon',
       NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
                    WHERE ns.nspname='public'
                      AND p.proname IN ('journey_visible','clinic_patient_visible','care_request_visible',
                                        'lifecycle_state','patient_record_manageable','patient_record_readable',
                                        'patient_lifecycle_eligibility','patient_lifecycle_action','patient_set_starred',
                                        'patient_purge','patient_purge_eligibility','patient_purge_dependencies',
                                        'recycle_bin_list','recycle_bin_item')
                      AND has_function_privilege('anon', p.oid, 'EXECUTE'))),
    (8,'every SECURITY DEFINER lifecycle function pins search_path',
       NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
                    WHERE ns.nspname='public' AND p.prosecdef
                      AND p.proname LIKE ANY (ARRAY['patient_%','journey_visible','clinic_patient_visible',
                                                    'care_request_visible','recycle_bin%'])
                      AND COALESCE(array_to_string(p.proconfig,','),'') NOT LIKE '%search_path%')),
    (9,'the leaking recycle_bin VIEW is gone',
       to_regclass('public.recycle_bin') IS NULL),
    (10,'legacy archive trio is retired',
       (to_regprocedure('public.archive_patient(uuid,text)') IS NULL
        OR NOT has_function_privilege('authenticated','public.archive_patient(uuid,text)','EXECUTE')))
)
SELECT CASE WHEN holds THEN '  ok      ' ELSE '  FAILED  ' END || invariant
       AS "security invariants (all must be ok at stage F)"
FROM s ORDER BY ord;

\echo ''
\echo '  If any invariant reads FAILED at stage F, re-apply v4_3_function_hardening.sql.'
\echo '  It is idempotent and is always the correct repair.'
\echo ''
