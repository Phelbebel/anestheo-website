-- ============================================================
-- v9_4_access_state_inventory.sql
-- READ ONLY. Changes nothing. Safe to run on production at any time.
-- ============================================================
--
-- WHY THIS FILE EXISTS
-- --------------------
-- The frontend and the migrations disagree about what this database is.
--
--   auth.js:201                      "v9_doctor_access_model.sql, now deployed"
--   v9_doctor_access_model.sql:3     "PREPARED FOR REVIEW - NOT APPLIED"
--   the file itself                  present on one unmerged branch, absent from main
--   hotfix-doctor-onboarding.test.js "Production today: v9_1 is applied, v9 is not"
--
-- Those cannot all be true, and the difference is not academic. If v9 IS
-- applied, an unverified doctor can read and write patient-scoped rows right
-- now and that is a live hole. If it is NOT, 33 RESTRICTIVE policies still
-- deny them every clinical table and there is nothing urgent, only a gate to
-- keep. The correct next migration differs in DIRECTION between those two
-- worlds, so guessing is not available.
--
-- Run this, paste the output, and the question is answered from the catalog
-- rather than from a comment somebody wrote months ago.
--
-- IT HAS BEEN RUN. Production answered PARTIAL: both anesthesia predicates
-- already name is_doctor_account(), exactly 1 restrictive gate survives
-- (questions_require_verified), and 9 present patient-management tables have
-- none. Neither of the two clean verdicts below fired, which is the file
-- working: it said "PARTIAL or UNRECOGNISED - do not apply v9_5 until the rows
-- above are read by a human", the rows were read, and v9_5 and v9_6 were
-- written against what they said.
--
-- Keep running it before each apply. It is read-only and it is the only thing
-- in this repository that knows what the database actually is.
--
-- HOW TO READ THE OUTPUT
-- ----------------------
-- One result set. Every row is a finding, with a `state` column that is either
-- a fact or one of two verdicts:
--
--   OK           the thing is as the target model wants it
--   ATTENTION    the thing is not, and v9_5 addresses it
--   INFO         context, no judgement
--
-- The final rows carry the overall verdict: which of the two worlds this
-- database is actually in.
-- ============================================================

WITH
-- ── The tables the verification boundary is about ────────────────────────
-- PATIENT MANAGEMENT: an unverified doctor must never reach these. The gate
-- on them must EXIST.
patient_mgmt(t) AS (
  SELECT unnest(ARRAY[
    'care_requests','clinic_patients','patient_archive_audit',
    'patient_recommendations','patient_surgeries','preop_checklist',
    'preop_questionnaires','preparation_plans','questionnaire_templates',
    'requirement_documents','questions','question_replies'])
),
-- ANESTHESIA FAMILY: an unverified doctor may use these, but only for a case
-- with no patient attached. The blanket gate on them is the thing that stops
-- standalone Live Chart working before verification.
anes(t) AS (
  SELECT unnest(ARRAY[
    'anesthesia_cases','anesthesia_access','anesthesia_airway',
    'anesthesia_amendments','anesthesia_audit','anesthesia_blood_products',
    'anesthesia_case_times','anesthesia_device_sessions','anesthesia_events',
    'anesthesia_fluids','anesthesia_handoffs','anesthesia_history_review',
    'anesthesia_infusion_rates','anesthesia_infusions','anesthesia_labs',
    'anesthesia_medications','anesthesia_outputs','anesthesia_positioning',
    'anesthesia_preassessment','anesthesia_regional','anesthesia_ventilation',
    'anesthesia_vitals'])
),
-- Every RESTRICTIVE policy that keys on verification, however it is named.
-- Named AND shaped, because <table>_require_verified is a convention and a
-- convention is not a catalog.
gates AS (
  SELECT schemaname, tablename, policyname, permissive, qual
    FROM pg_policies
   WHERE schemaname = 'public'
     AND ( policyname LIKE '%\_require\_verified'
           OR ( permissive = 'RESTRICTIVE'
                AND coalesce(qual,'') LIKE '%is_pending_doctor%' ) )
),
-- The two functions the 21 anesthesia child tables route through. WHICH
-- predicate their body names is the single clearest signal of whether v9 ran.
anes_fns AS (
  SELECT p.proname,
         (p.prosrc LIKE '%is_verified_doctor%') AS names_verified,
         (p.prosrc LIKE '%is_doctor_account%')  AS names_account
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('anesthesia_case_access','anesthesia_case_editable')
)

-- ── 1 · HELPERS ──────────────────────────────────────────────────────────
SELECT 1 AS ord, 'helper' AS area, f AS name, ''::text AS detail,
       CASE WHEN to_regproc('public.'||f) IS NOT NULL THEN 'OK' ELSE 'ATTENTION' END AS state,
       'v9_5 requires this function to exist'::text AS note
  FROM unnest(ARRAY['is_pending_doctor','is_verified_doctor','is_doctor_account',
                    'is_platform_admin','doctor_treats_patient',
                    'anesthesia_case_access','anesthesia_case_editable']) AS f

UNION ALL
-- ── 2 · WHICH PREDICATE THE ANESTHESIA FUNCTIONS NAME ────────────────────
SELECT 2, 'anesthesia predicate', proname,
       CASE WHEN names_account THEN 'names is_doctor_account()'
            WHEN names_verified THEN 'names is_verified_doctor()'
            ELSE 'names neither' END,
       CASE WHEN names_account THEN 'INFO' ELSE 'INFO' END,
       CASE WHEN names_account
            THEN 'v9 section 3 HAS run against this function'
            ELSE 'v9 section 3 has NOT run: still verification-gated' END
  FROM anes_fns

UNION ALL
-- ── 3 · PATIENT-MANAGEMENT TABLES: is the gate there? ────────────────────
-- A missing gate here is the finding that matters most. It means an
-- unverified doctor is held out of that table by nothing but the permissive
-- policies underneath, which are ownership-scoped but NOT verification-scoped.
SELECT 3, 'patient-management', pm.t,
       CASE WHEN to_regclass('public.'||pm.t) IS NULL THEN 'table absent'
            WHEN g.policyname IS NOT NULL THEN 'gated by ' || g.policyname
            ELSE 'NO VERIFICATION GATE' END,
       CASE WHEN to_regclass('public.'||pm.t) IS NULL THEN 'INFO'
            WHEN g.policyname IS NOT NULL THEN 'OK'
            ELSE 'ATTENTION' END,
       CASE WHEN to_regclass('public.'||pm.t) IS NULL
            THEN 'not in this deployment; v9_5 skips it'
            WHEN g.policyname IS NOT NULL
            THEN 'unverified doctors are denied this table'
            ELSE 'an unverified doctor may reach this table today; v9_5 adds the gate' END
  FROM patient_mgmt pm
  LEFT JOIN gates g ON g.tablename = pm.t

UNION ALL
-- ── 4 · ANESTHESIA FAMILY: is the blanket gate there? ────────────────────
-- Here a PRESENT gate is what blocks standalone Live Chart. It is not a
-- security problem; it is the thing v9_5 deliberately narrows.
SELECT 4, 'anesthesia', a.t,
       CASE WHEN to_regclass('public.'||a.t) IS NULL THEN 'table absent'
            WHEN g.policyname IS NOT NULL THEN 'blanket gate ' || g.policyname
            ELSE 'no blanket gate' END,
       'INFO',
       CASE WHEN to_regclass('public.'||a.t) IS NULL THEN 'not in this deployment'
            WHEN g.policyname IS NOT NULL
            THEN 'unverified doctor blocked entirely; v9_5 narrows to unlinked cases'
            ELSE 'unverified doctor reaches this by ownership; v9_5 adds the unlinked-only rule' END
  FROM anes a
  LEFT JOIN gates g ON g.tablename = a.t

UNION ALL
-- ── 5 · ANY OTHER VERIFICATION GATE WE DID NOT CLASSIFY ──────────────────
-- Nothing should appear here. If something does, it is a table neither list
-- knows about, and v9_5 must be reviewed before it runs.
SELECT 5, 'unclassified gate', g.tablename, g.policyname, 'ATTENTION',
       'a verification gate on a table v9_5 does not classify - review before applying'
  FROM gates g
 WHERE g.tablename NOT IN (SELECT t FROM patient_mgmt)
   AND g.tablename NOT IN (SELECT t FROM anes)

UNION ALL
-- ── 5b · POLICY BODIES, NOT JUST FUNCTION BODIES ─────────────────────────
-- THE GAP THIS CLOSES. The first version of this file read pg_proc and never
-- read pg_policies' expressions, so it could report that
-- anesthesia_case_access() had been re-pointed while saying nothing about
-- anes_case_insert - which calls is_verified_doctor() INLINE, in its own
-- WITH CHECK, and is not reached by re-pointing either function.
--
-- That matters more than it sounds. RLS requires a row to satisfy at least one
-- PERMISSIVE policy AND every RESTRICTIVE one. v9_5 section 4 works on the
-- restrictive side; if the permissive anes_case_insert still demands
-- is_verified_doctor(), an unverified doctor cannot create a standalone case
-- no matter what v9_5 does, because the two conditions are ANDed and v9_5
-- never touches the permissive one.
--
-- So: which predicate does each anesthesia_cases policy actually name?
SELECT 5, 'anesthesia_cases policy', policyname,
       cmd || ' / ' || permissive || ' :: '
         || left(coalesce(with_check, qual, '(no expression)'), 90),
       CASE
         WHEN coalesce(with_check,'') || coalesce(qual,'') LIKE '%is_verified_doctor%'
           THEN 'ATTENTION'
         ELSE 'OK' END,
       CASE
         WHEN coalesce(with_check,'') || coalesce(qual,'') LIKE '%is_verified_doctor%'
           THEN 'still verification-gated: an unverified doctor CANNOT use this. If this is '
                || 'anes_case_insert or anes_case_update, v9_5 alone will NOT deliver the '
                || 'standalone chart and this policy must be re-pointed to is_doctor_account()'
         WHEN coalesce(with_check,'') || coalesce(qual,'') LIKE '%is_doctor_account%'
           THEN 'v9 section 3 re-pointed this: a doctor account may use it'
         WHEN coalesce(with_check,'') || coalesce(qual,'') LIKE '%is_pending_doctor%'
           THEN 'a verification gate; v9_5 narrows or keeps it'
         ELSE 'names no verification predicate: scoped by ownership only' END
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'anesthesia_cases'

UNION ALL
-- ── 6 · THE VERDICT ──────────────────────────────────────────────────────
SELECT 9, 'VERDICT', 'v9_doctor_access_model.sql',
       (SELECT count(*)::text FROM gates) || ' verification gate policies present',
       'INFO',
       CASE
         WHEN (SELECT count(*) FROM gates) = 0
              AND EXISTS (SELECT 1 FROM anes_fns WHERE names_account)
           THEN 'APPLIED. Unverified doctors currently reach patient-scoped rows. This is a live hole; v9_5 closes it.'
         WHEN (SELECT count(*) FROM gates) >= 25
              AND NOT EXISTS (SELECT 1 FROM anes_fns WHERE names_account)
           THEN 'NOT APPLIED. Unverified doctors are denied every gated table. No live hole; v9_5 narrows the anesthesia gate only.'
         ELSE 'PARTIAL or UNRECOGNISED. Do not apply v9_5 until the rows above are read by a human.'
       END

UNION ALL
SELECT 9, 'VERDICT', 'patient-management exposure',
       (SELECT count(*)::text FROM patient_mgmt pm
         WHERE to_regclass('public.'||pm.t) IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM gates g WHERE g.tablename = pm.t))
       || ' patient tables reachable by an unverified doctor',
       CASE WHEN (SELECT count(*) FROM patient_mgmt pm
                   WHERE to_regclass('public.'||pm.t) IS NOT NULL
                     AND NOT EXISTS (SELECT 1 FROM gates g WHERE g.tablename = pm.t)) = 0
            THEN 'OK' ELSE 'ATTENTION' END,
       'this is the number v9_5 must drive to zero'

ORDER BY ord, area, name;
