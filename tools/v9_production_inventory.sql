-- ═══════════════════════════════════════════════════════════════════════════
--  READ-ONLY PRODUCTION INVENTORY for v9_doctor_access_model.sql
--
--  Run this in the Supabase SQL editor. It writes NOTHING: no DDL, no DML, no
--  transaction. It only reads the catalog.
--
--  Every row it returns is a fact about YOUR database. Nothing here is derived
--  from a migration file, because twice now a migration file has described a
--  database that does not exist: patient_surgeries.origin (42703) and
--  patient_archive_audit (42P01).
--
--  Read the SUMMARY rows first, then anything marked MISSING.
-- ═══════════════════════════════════════════════════════════════════════════
WITH
-- Relations v9 touches. `hard` = the file cannot work without it;
-- `soft` = it only ever appears in a DROP POLICY, so absence is survivable.
want_rel(need, relname) AS (VALUES
  ('hard','profiles'),('hard','patient_surgeries'),('hard','clinic_patients'),
  ('hard','care_requests'),('hard','anesthesia_cases'),('hard','anesthesia_amendments'),
  ('hard','questions'),('hard','question_replies'),('hard','anesthesia_audit'),
  ('soft','patient_archive_audit'),('soft','patient_recommendations'),
  ('soft','preop_checklist'),('soft','preop_questionnaires'),('soft','preparation_plans'),
  ('soft','questionnaire_templates'),('soft','requirement_documents'),
  ('soft','anesthesia_case_times'),('soft','anesthesia_preassessment'),
  ('soft','anesthesia_history_review'),('soft','anesthesia_access'),
  ('soft','anesthesia_device_sessions'),('soft','anesthesia_airway'),
  ('soft','anesthesia_ventilation'),('soft','anesthesia_positioning'),
  ('soft','anesthesia_medications'),('soft','anesthesia_infusions'),
  ('soft','anesthesia_infusion_rates'),('soft','anesthesia_fluids'),
  ('soft','anesthesia_blood_products'),('soft','anesthesia_outputs'),
  ('soft','anesthesia_vitals'),('soft','anesthesia_labs'),
  ('soft','anesthesia_regional'),('soft','anesthesia_events'),
  ('soft','anesthesia_handoffs')
),
-- Functions v9 replaces, calls, or must not disturb.
want_fn(need, fname) AS (VALUES
  ('hard','is_doctor_account'),('hard','is_verified_doctor'),('hard','is_platform_admin'),
  ('hard','doctor_treats_patient'),('hard','account_is_active'),
  ('hard','anesthesia_case_access'),('hard','anesthesia_case_editable'),
  ('hard','anesthesia_amend_case'),('hard','anesthesia_set_trainee'),
  ('hard','anesthesia_finalize_case'),('hard','recycle_bin_list'),
  ('hard','patient_record_manageable'),('hard','get_clinician_directory'),
  ('hard','anesthesia_guard_case_fields'),('hard','patient_purge_eligibility'),
  ('soft','is_pending_doctor'),('soft','hp_clinician_may_read'),('soft','hp_verify_item'),
  ('soft','submit_doctor_onboarding'),('soft','set_own_role')
),
-- Columns v9 reads or writes by name.
want_col(tbl, col) AS (VALUES
  ('anesthesia_cases','anesthesiologist_id'),('anesthesia_cases','trainee_id'),
  ('anesthesia_cases','clinic_patient_id'),('anesthesia_cases','surgery_id'),
  ('anesthesia_cases','patient_user_id'),('anesthesia_cases','deleted_at'),
  ('anesthesia_cases','status'),('anesthesia_cases','finalized_at'),
  ('anesthesia_cases','finalized_by'),('anesthesia_cases','created_by'),
  ('anesthesia_cases','finalized_by_verification_status'),
  ('profiles','accepting_patients'),('profiles','display_name'),('profiles','clinic_name'),
  ('profiles','hospital'),('profiles','specialty'),('profiles','role'),
  ('profiles','verification_status'),('profiles','account_status'),('profiles','deleted_at'),
  ('patient_surgeries','assigned_doctor_id'),('patient_surgeries','patient_id'),
  ('patient_surgeries','deleted_at'),
  ('clinic_patients','doctor_id'),('clinic_patients','auth_user_id'),('clinic_patients','deleted_at'),
  ('care_requests','patient_id'),('care_requests','doctor_id'),
  ('care_requests','status'),('care_requests','deleted_at'),
  ('anesthesia_amendments','case_id'),('anesthesia_amendments','amended_by')
),
-- Named policies v9 drops and recreates.
want_pol(tbl, pol) AS (VALUES
  ('anesthesia_cases','anes_case_insert'),('anesthesia_cases','anes_case_update'),
  ('anesthesia_amendments','anes_amend_insert'),
  ('questions','q_select_own_or_staff'),('questions','q_update_staff'),
  ('question_replies','r_select_own_or_staff'),('question_replies','r_insert_participant')
)

-- 1. RELATIONS ─────────────────────────────────────────────────────────────
SELECT '1 RELATION'::text AS section,
       w.relname          AS object,
       CASE WHEN c.oid IS NULL THEN (CASE WHEN w.need='hard' THEN 'MISSING (blocks v9)'
                                          ELSE 'missing (skippable)' END)
            ELSE 'present' END AS status,
       CASE WHEN c.oid IS NULL THEN w.need
            ELSE 'rls=' || CASE WHEN c.relrowsecurity THEN 'on' ELSE 'OFF' END END AS detail
  FROM want_rel w
  LEFT JOIN pg_class c ON c.relname = w.relname
       AND c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')

UNION ALL
-- 2. THE GATE POLICIES THAT ARE ACTUALLY INSTALLED ─────────────────────────
--    Discovered, not assumed. Whatever this returns IS the set v9 must drop.
SELECT '2 GATE POLICY',
       p.tablename || '  →  ' || p.policyname,
       'installed',
       p.permissive || ' / ' || p.cmd || ' / ' || left(coalesce(p.qual,'-'), 40)
  FROM pg_policies p
 WHERE p.schemaname = 'public'
   AND (p.policyname LIKE '%\_require\_verified'
        OR (p.permissive = 'RESTRICTIVE' AND coalesce(p.qual,'') LIKE '%is_pending_doctor%'))

UNION ALL
-- 3. FUNCTIONS ─────────────────────────────────────────────────────────────
SELECT '3 FUNCTION',
       w.fname,
       CASE WHEN pr.oid IS NULL THEN (CASE WHEN w.need='hard' THEN 'MISSING (blocks v9)'
                                           ELSE 'missing (ok)' END)
            ELSE 'present' END,
       coalesce(pg_get_function_identity_arguments(pr.oid), w.need)
  FROM want_fn w
  LEFT JOIN pg_proc pr ON pr.proname = w.fname
       AND pr.pronamespace = 'public'::regnamespace

UNION ALL
-- 4. COLUMNS ───────────────────────────────────────────────────────────────
SELECT '4 COLUMN',
       w.tbl || '.' || w.col,
       CASE WHEN a.attname IS NULL THEN 'MISSING' ELSE 'present' END,
       CASE WHEN a.attname IS NULL THEN
              CASE WHEN w.col = 'finalized_by_verification_status'
                   THEN 'expected missing — v9 ADDs it' ELSE 'blocks v9' END
            ELSE format_type(a.atttypid, a.atttypmod) END
  FROM want_col w
  LEFT JOIN pg_attribute a
         ON a.attrelid = to_regclass('public.' || w.tbl)
        AND a.attname = w.col AND a.attnum > 0 AND NOT a.attisdropped

UNION ALL
-- 5. NAMED POLICIES v9 RECREATES ───────────────────────────────────────────
SELECT '5 POLICY',
       w.tbl || '  →  ' || w.pol,
       CASE WHEN p.policyname IS NULL THEN 'absent' ELSE 'present' END,
       coalesce(left(coalesce(p.qual, p.with_check, '-'), 60),
                CASE WHEN to_regclass('public.' || w.tbl) IS NULL
                     THEN 'relation missing' ELSE 'v9 will create it' END)
  FROM want_pol w
  LEFT JOIN pg_policies p ON p.schemaname='public'
       AND p.tablename = w.tbl AND p.policyname = w.pol

UNION ALL
-- 6. SUMMARY ───────────────────────────────────────────────────────────────
SELECT '6 SUMMARY', 'hard relations missing',
       (SELECT count(*)::text FROM want_rel w
         WHERE w.need='hard' AND to_regclass('public.'||w.relname) IS NULL), 'must be 0'
UNION ALL
SELECT '6 SUMMARY', 'soft relations missing (v9 will now skip these)',
       (SELECT count(*)::text FROM want_rel w
         WHERE w.need='soft' AND to_regclass('public.'||w.relname) IS NULL), 'informational'
UNION ALL
SELECT '6 SUMMARY', 'gate policies actually installed',
       (SELECT count(*)::text FROM pg_policies p WHERE p.schemaname='public'
         AND (p.policyname LIKE '%\_require\_verified'
              OR (p.permissive='RESTRICTIVE' AND coalesce(p.qual,'') LIKE '%is_pending_doctor%'))),
       'this number replaces the assumed 33'
UNION ALL
SELECT '6 SUMMARY', 'hard functions missing',
       (SELECT count(*)::text FROM want_fn w
         WHERE w.need='hard' AND to_regproc('public.'||w.fname) IS NULL), 'must be 0'
UNION ALL
SELECT '6 SUMMARY', 'v9 already applied?',
       (SELECT CASE WHEN prosrc LIKE '%is_doctor_account%' THEN 'YES - do not re-run'
                    ELSE 'no - safe to run' END
          FROM pg_proc WHERE proname='anesthesia_case_editable'
           AND pronamespace='public'::regnamespace LIMIT 1), 'anesthesia_case_editable body'
UNION ALL
SELECT '6 SUMMARY', 'v9_1 applied?',
       CASE WHEN to_regproc('public.submit_doctor_onboarding') IS NULL
            THEN 'no' ELSE 'YES' END, 'submit_doctor_onboarding'
UNION ALL
/* The PostgreSQL version matters more than it looks. On 16, DROP POLICY IF
   EXISTS tolerates a missing relation; on the server that ran this deployment
   it raised 42P01. Any replica on a different major version can pass a
   rehearsal the real database would fail. */
SELECT '6 SUMMARY', 'PostgreSQL version',
       split_part(current_setting('server_version'), ' ', 1),
       'a rehearsal on a different major version proves less than it appears to'
UNION ALL
SELECT '6 SUMMARY', 'v9_2 applied?',
       (SELECT count(*)::text FROM pg_trigger
         WHERE tgname IN ('trg_guard_clinic_patient_link',
                          'trg_guard_patient_surgery_subject',
                          'trg_guard_care_request_parties')), 'expect 3'

ORDER BY 1, 3 DESC, 2;
