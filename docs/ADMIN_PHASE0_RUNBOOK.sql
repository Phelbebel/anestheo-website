-- ============================================================
-- Admin Center Phase 0 — PRODUCTION RUNBOOK
-- Read-only preflight, then apply, then verification. Nothing here mutates
-- production except STEP 3 (the migration itself).
-- Run each STEP separately in the Supabase SQL editor and read the output.
-- ============================================================


-- ============================================================
-- STEP 1 — PREFLIGHT (READ-ONLY). Run all of these BEFORE the migration.
-- ============================================================

-- 1.1 Every table the migration references must exist (expect 13 rows, all 't')
SELECT t.tbl,
       to_regclass('public.'||t.tbl) IS NOT NULL AS exists
FROM (VALUES ('profiles'),('clinic_patients'),('patient_surgeries'),('care_requests'),
             ('preop_questionnaires'),('preop_checklist'),('questions'),('question_replies'),
             ('preparation_plans'),('requirement_documents'),('patient_recommendations'),
             ('video_progress'),('admin_audit_log')) AS t(tbl)
ORDER BY 1;

-- 1.2 Every column the migration reads must exist (expect all 't' EXCEPT
--     profiles.medical_license_number, which is optional by design)
SELECT c.tbl||'.'||c.col AS column_ref,
       EXISTS (SELECT 1 FROM information_schema.columns i
                WHERE i.table_schema='public' AND i.table_name=c.tbl AND i.column_name=c.col) AS exists
FROM (VALUES
  ('profiles','id'),('profiles','email'),('profiles','full_name'),('profiles','role'),
  ('profiles','is_admin'),('profiles','verification_status'),('profiles','hospital'),
  ('profiles','specialty'),('profiles','country'),('profiles','phone'),('profiles','created_at'),
  ('profiles','accepting_patients'),('profiles','medical_license_number'),
  ('patient_surgeries','id'),('patient_surgeries','patient_id'),('patient_surgeries','assigned_doctor_id'),
  ('patient_surgeries','patient_name'),('patient_surgeries','procedure_type'),('patient_surgeries','hospital'),
  ('patient_surgeries','surgery_date'),('patient_surgeries','archived_at'),('patient_surgeries','completed_at'),
  ('patient_surgeries','ready_at'),('patient_surgeries','care_state'),('patient_surgeries','contact_email'),
  ('patient_surgeries','created_at'),
  ('clinic_patients','id'),('clinic_patients','doctor_id'),('clinic_patients','patient_name'),
  ('clinic_patients','phone_number'),('clinic_patients','email'),('clinic_patients','procedure'),
  ('clinic_patients','hospital'),('clinic_patients','patient_status'),('clinic_patients','auth_user_id'),
  ('clinic_patients','created_at'),
  ('care_requests','id'),('care_requests','patient_id'),('care_requests','doctor_id'),
  ('care_requests','surgery_id'),('care_requests','status'),('care_requests','patient_name'),
  ('care_requests','doctor_name'),('care_requests','procedure'),('care_requests','origin_method'),
  ('care_requests','requested_at'),
  ('preop_questionnaires','id'),('preop_questionnaires','patient_id'),('preop_questionnaires','status'),
  ('preop_questionnaires','completion'),('preop_questionnaires','review_state'),
  ('preop_questionnaires','submitted_at'),('preop_questionnaires','created_at'),
  ('questions','id'),('questions','patient_id'),('questions','subject'),('questions','status'),
  ('questions','created_at')
) AS c(tbl,col)
ORDER BY 1;

-- 1.3 Current profiles policies — confirms the documented starting state
--     (expect: profiles_select_own, profiles_insert_own, profiles_update_own,
--      profiles_directory_read — and NO admin policy)
SELECT policyname, cmd, roles::text, qual
FROM pg_policies WHERE schemaname='public' AND tablename='profiles'
ORDER BY policyname;

-- 1.4 Name conflicts: do functions with these names already exist?
--     (expect 0 rows on a clean database)
SELECT n.nspname||'.'||p.proname AS existing_function,
       pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('is_platform_admin','assert_admin','admin_log','admin_search',
                    'admin_scrub_jsonb','guard_admin_audit_append_only')
ORDER BY 1;

-- 1.5 Does admin_audit_log already exist with a DIFFERENT shape?
--     (expect 0 rows; if rows appear, compare against the migration before running)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='admin_audit_log'
ORDER BY ordinal_position;

-- 1.6 Who will be treated as an admin? Confirm YOUR account is in this list.
--     This is the exact predicate the new functions use.
SELECT id, email, role, is_admin,
       (is_admin = true OR role = 'admin') AS will_be_platform_admin
FROM public.profiles
WHERE is_admin = true OR role = 'admin'
ORDER BY email;

-- 1.7 Sanity: nobody unintended qualifies (review this list carefully)
SELECT role, is_admin, count(*) AS accounts
FROM public.profiles GROUP BY role, is_admin ORDER BY 1,2;

-- 1.8 BASELINE SNAPSHOT — keep this output; it is your rollback reference.
SELECT tablename, policyname, cmd FROM pg_policies
WHERE schemaname='public' ORDER BY tablename, policyname;


-- ============================================================
-- STEP 2 — RECORD BASELINE (copy the output of 1.3 / 1.4 / 1.8 somewhere safe)
-- ============================================================


-- ============================================================
-- STEP 3 — APPLY  →  run the whole of v2_admin_phase0.sql
-- ============================================================


-- ============================================================
-- STEP 4 — POST-MIGRATION VERIFICATION, RUN AS THE REAL ADMIN
--          (Supabase SQL editor runs as postgres and BYPASSES RLS, so RLS
--           behaviour must be confirmed from the APP while signed in as each
--           role — see STEP 5-7. These queries confirm objects + ownership.)
-- ============================================================

-- 4.1 Objects created (expect 6 functions, 1 table, 8 admin_read policies, 1 trigger)
SELECT 'function: '||proname AS object FROM pg_proc
 WHERE proname IN ('is_platform_admin','assert_admin','admin_log','admin_search',
                   'admin_scrub_jsonb','guard_admin_audit_append_only')
UNION ALL SELECT 'table: '||tablename FROM pg_tables WHERE tablename='admin_audit_log'
UNION ALL SELECT 'policy: '||tablename||'.'||policyname FROM pg_policies WHERE policyname LIKE '%admin_read%'
UNION ALL SELECT 'trigger: '||tgname FROM pg_trigger WHERE tgname='trg_admin_audit_append_only'
ORDER BY 1;

-- 4.2 SECURITY DEFINER hygiene + OWNERSHIP
--     Expect: prosecdef = t for the 4 definer fns, proconfig contains
--     search_path=public, pg_temp, and owner = the role that owns public.profiles.
SELECT p.proname,
       p.prosecdef                              AS security_definer,
       array_to_string(p.proconfig,',')         AS config,
       pg_get_userbyid(p.proowner)              AS function_owner,
       (SELECT pg_get_userbyid(c.relowner) FROM pg_class c
         WHERE c.relname='profiles' AND c.relnamespace='public'::regnamespace) AS profiles_owner
FROM pg_proc p
WHERE p.proname IN ('is_platform_admin','assert_admin','admin_log','admin_search','admin_scrub_jsonb')
ORDER BY 1;

-- 4.3 EXECUTE grants: anon/PUBLIC must NOT be able to execute; authenticated may.
SELECT p.proname, r.rolname AS grantee,
       has_function_privilege(r.rolname, p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p
CROSS JOIN (SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')) r
WHERE p.proname IN ('is_platform_admin','assert_admin','admin_log','admin_search','admin_scrub_jsonb')
ORDER BY 1,2;   -- expect anon=false, authenticated=true

-- 4.4 admin_audit_log table privileges (expect authenticated: SELECT only; anon: none)
SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='admin_audit_log'
  AND grantee IN ('anon','authenticated','PUBLIC')
GROUP BY grantee ORDER BY 1;

-- 4.5 New policies are SELECT-only (expect every row cmd='SELECT')
SELECT tablename, policyname, cmd FROM pg_policies
WHERE policyname LIKE '%admin_read%' ORDER BY 1;

-- 4.6 Pre-existing policies still present (compare to the STEP 2 snapshot)
SELECT tablename, policyname, cmd FROM pg_policies
WHERE schemaname='public' ORDER BY tablename, policyname;

-- 4.7 Directory policy unchanged (expect accepting_patients = true)
SELECT policyname, qual FROM pg_policies
WHERE tablename='profiles' AND policyname='profiles_directory_read';


-- ============================================================
-- STEP 5-7 — ROLE TESTS FROM THE APPLICATION (RLS only applies there)
-- Sign in to the app as each role and run these in the browser console.
-- ============================================================
--
-- STEP 5 — as the ADMIN (expect: many profiles, search works, audit readable)
--   await sb.from('profiles').select('id',{count:'exact',head:true})       // > 1
--   await sb.rpc('admin_search',{ p_q:'a' })                               // rows
--   await sb.from('admin_audit_log').select('id',{count:'exact',head:true})// ok
--
-- STEP 6 — as a DOCTOR (expect: own profile only, both admin calls rejected)
--   await sb.from('profiles').select('id',{count:'exact',head:true})       // 1
--   await sb.rpc('admin_search',{ p_q:'a' })   // error: Admin privilege required
--   await sb.from('admin_audit_log').select('id')                          // 0 rows
--   // and confirm the doctor workflow still works:
--   await sb.from('clinic_patients').select('id')                          // own patients
--   await sb.from('patient_surgeries').select('id')                        // own patients
--
-- STEP 7 — as a PATIENT (expect: own rows only, admin calls rejected)
--   await sb.from('profiles').select('id',{count:'exact',head:true})       // 1
--   await sb.rpc('admin_search',{ p_q:'a' })   // error: Admin privilege required
--   await sb.from('preop_questionnaires').select('id')                     // own only
--   await sb.from('preop_checklist').select('id')                          // own only
--
-- STEP 7b — ANONYMOUS (signed out, anon key only)
--   await sb.rpc('admin_search',{ p_q:'a' })   // permission denied
--   await sb.from('admin_audit_log').select('id')                          // permission denied
--
-- STEP 8 — CONFIRM PRODUCT WORKFLOWS (click through, no code)
--   Doctor Home loads with real counts; Patient Home loads; questionnaire
--   opens; My Space opens; admin.html lists now show full data.
--
-- STEP 9 — IF ANY TEST FAILS: run the rollback block at the end of
--   v2_admin_phase0.sql immediately, then re-run 1.3 to confirm the original
--   profiles policies are back.
-- ============================================================
