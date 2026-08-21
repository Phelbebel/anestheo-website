-- ============================================================
-- v9_5_verification_boundary.sql
-- PREPARED FOR REVIEW - NOT APPLIED.
-- Run v9_4_access_state_inventory.sql FIRST and read its output.
-- ============================================================
--
-- WHAT THIS ESTABLISHES, IN ONE SENTENCE
-- --------------------------------------
-- Verification stops gating ordinary medical tools and starts gating patient
-- data, which is what it was always for.
--
-- THREE STATES, AND WHAT EACH ONE GETS
-- ------------------------------------
--   role='pending'                        no clinical access at all. Enforced
--                                         in the frontend by requireAuth();
--                                         this file does not change it.
--   role='doctor', not approved           the clinician product: Live Tools,
--                                         references, education, videos, their
--                                         own settings, their own verification
--                                         form, and Live Chart for cases with
--                                         NO PATIENT ATTACHED.
--   role='doctor', approved               all of the above, plus the
--                                         patient-management layer, still
--                                         subject to every ownership and
--                                         treating-relationship rule that
--                                         already exists.
--
-- WHY THIS FILE AND NOT v9_doctor_access_model.sql
-- ------------------------------------------------
-- v9 drops the verification gate from all 33 tables. That is too much. It
-- opens patient_surgeries, clinic_patients, care_requests, preop_*,
-- questionnaire_templates and requirement_documents to any doctor account,
-- and those hold patient data. v9's own reasoning is sound as far as it goes
-- - the permissive policies underneath ARE ownership-scoped - but ownership
-- scoping answers "whose patient is this", not "should this person be
-- handling patients at all". Verification is the second question.
--
-- So this file keeps the gate exactly where v9 would have removed it, and
-- removes it in exactly one place: the anesthesia family, replaced by a
-- narrower rule rather than by nothing.
--
-- IT IS CONVERGENT, AND IT NEVER GUESSES
-- --------------------------------------
-- Which of the two worlds production is in is discovered from pg_policies at
-- run time, not assumed. Section 3 ADDS gates that are missing; section 4
-- narrows gates that are present. Run against a database where v9 was applied,
-- it closes the hole. Run against one where v9 was not, it changes nothing on
-- the patient tables and only narrows the anesthesia ones. Run twice, it is a
-- no-op the second time.
--
-- MEASURED. v9_4 has since been run read-only against production, and the
-- answer is PARTIAL rather than either world:
--
--   anesthesia_case_access()   uses is_doctor_account()  -> v9 section 3 HAS run
--   anesthesia_case_editable() uses is_doctor_account()  -> same
--   restrictive verification gates present: 1  (questions_require_verified)
--   patient-management tables with NO gate: 9
--       care_requests, clinic_patients, patient_recommendations,
--       patient_surgeries, preop_checklist, preop_questionnaires,
--       preparation_plans, questionnaire_templates, requirement_documents
--   patient_archive_audit  absent      question_replies  absent
--
-- So on production this file is not a precaution. Section 3 will ADD nine
-- gates, closing a hole that is open right now: an unverified doctor can
-- currently reach those nine tables through ordinary PostgREST calls, scoped
-- only by ownership. Section 4 will ADD the standalone rule to the anesthesia
-- family, which today has no gate at all and whose access function was already
-- re-pointed to is_doctor_account() - meaning an unverified doctor can
-- currently open patient-LINKED charts they own. Both directions tighten.
--
-- The two absent tables are skipped by name-checks that were already there,
-- and the 1 present gate is left exactly as found.
--
-- IT FAILS SAFE
-- -------------
-- Section 3 (tighten) comes before section 4 (narrow), so there is no instant
-- inside the transaction at which a patient table is less protected than it
-- was when the file started. The whole file is one transaction: a failure
-- anywhere leaves production exactly as it was found.
--
-- Section 4 is additionally guarded by v9_5_ENABLE_STANDALONE_CHART. Set it to
-- 'off' to run the tightening alone and leave Live Chart exactly as it is
-- today. There is no setting that skips section 3.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. PREFLIGHT
-- ============================================================
DO $preflight$
DECLARE v_missing text[] := '{}';
BEGIN
  IF to_regproc('public.is_pending_doctor')  IS NULL THEN v_missing := v_missing || 'is_pending_doctor() [v2_auth_onboarding.sql]'::text; END IF;
  IF to_regproc('public.is_verified_doctor') IS NULL THEN v_missing := v_missing || 'is_verified_doctor() [v2_auth_onboarding.sql]'::text; END IF;
  IF to_regproc('public.is_doctor_account')  IS NULL THEN v_missing := v_missing || 'is_doctor_account() [v2_auth_onboarding.sql]'::text; END IF;
  IF to_regproc('public.is_platform_admin')  IS NULL THEN v_missing := v_missing || 'is_platform_admin() [v2_admin_phase0.sql]'::text; END IF;
  IF to_regclass('public.anesthesia_cases')  IS NULL THEN v_missing := v_missing || 'anesthesia_cases [v3_anesthesia_record.sql]'::text; END IF;
  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: prerequisites missing: %', array_to_string(v_missing, ', ');
  END IF;
  RAISE NOTICE 'Preflight OK.';
END
$preflight$;

/* is_pending_doctor() is the predicate this whole file turns on, and it
   already says the right thing:

       role = 'doctor'  AND  verification_status <> 'approved'
       AND COALESCE(is_admin,false) = false

   The admin exemption is already inside it. That is why nothing below has to
   mention administrators: an administrator is never a pending doctor, so every
   RESTRICTIVE policy here passes them through untouched. Administrator
   behaviour is unchanged by this file, by construction rather than by care. */


-- ============================================================
-- 2. WHAT COUNTS AS A PATIENT-ATTACHED CASE
-- ============================================================
-- anesthesia_cases carries three nullable links to a real person:
--   surgery_id        -> patient_surgeries
--   clinic_patient_id -> clinic_patients
--   patient_user_id   -> auth.users
-- A row with all three NULL is a chart about nobody in this database. That is
-- not a mode anyone invented for this migration; it is the shape
-- anesthesia-cases.html has always produced, because its New Case form passes
-- none of the three. The standalone chart already exists and is already the
-- default. This function just gives it a name.
CREATE OR REPLACE FUNCTION public.anesthesia_case_unlinked(p_case uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.anesthesia_cases c
     WHERE c.id = p_case
       AND c.surgery_id        IS NULL
       AND c.clinic_patient_id IS NULL
       AND c.patient_user_id   IS NULL
  );
$$;
REVOKE ALL ON FUNCTION public.anesthesia_case_unlinked(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anesthesia_case_unlinked(uuid) TO authenticated;


-- ============================================================
-- 3. TIGHTEN: every patient-management table gets a verification gate
-- ============================================================
-- RESTRICTIVE policies are ANDed with the permissive ones, so one can only
-- ever REMOVE access. Adding these cannot open anything, on any database, in
-- any order. That is the property that makes this section safe to run without
-- knowing which world we are in.
--
-- Where the gate already exists this is a no-op and says so. Where it does not
-- - which is what v9 having been applied looks like - this puts it back.
--
-- The permissive policies underneath are NOT touched. A verified doctor's
-- access to these tables is exactly what it was: their own patients, their own
-- clinic, their own care requests, subject to doctor_treats_patient() and
-- every assignment rule already in place. Verification is not permission to
-- read every patient in the database and this file does not make it one.
DO $tighten$
DECLARE
  v_t text;
  v_added int := 0; v_kept int := 0; v_absent int := 0;
  v_tables text[] := ARRAY[
    'care_requests','clinic_patients','patient_archive_audit',
    'patient_recommendations','patient_surgeries','preop_checklist',
    'preop_questionnaires','preparation_plans','questionnaire_templates',
    'requirement_documents','questions','question_replies'];
BEGIN
  FOREACH v_t IN ARRAY v_tables LOOP
    /* Discovered, never assumed. patient_archive_audit and question_replies
       are in the migration files and are NOT in production, and naming a
       missing relation in a DDL statement is what took an earlier attempt at
       this down with 42P01 after it had already committed other work. */
    IF to_regclass('public.'||v_t) IS NULL THEN
      v_absent := v_absent + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = v_t
         AND permissive = 'RESTRICTIVE'
         AND coalesce(qual,'') LIKE '%is_pending_doctor%'
    ) THEN
      v_kept := v_kept + 1;
      CONTINUE;
    END IF;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING (NOT public.is_pending_doctor()) '
      || 'WITH CHECK (NOT public.is_pending_doctor())',
      v_t || '_require_verified', v_t);
    v_added := v_added + 1;
    RAISE NOTICE '  + gate added: %', v_t;
  END LOOP;

  RAISE NOTICE 'Section 3: % gate(s) added, % already present, % table(s) not in this deployment.',
               v_added, v_kept, v_absent;
END
$tighten$;


-- ============================================================
-- 4. NARROW: the anesthesia family, from "no" to "not a real patient's"
-- ============================================================
-- This is the only place in the file where anyone gains anything, and what
-- they gain is a chart about nobody.
--
-- The blanket gate is replaced rather than removed. The replacement is still
-- RESTRICTIVE and still keyed on is_pending_doctor(); it simply adds the one
-- disjunct that lets an unverified doctor work on a case with no patient
-- attached. Everything underneath is untouched: anesthesia_case_access() and
-- anesthesia_case_editable() still decide whose case it is, and an unverified
-- doctor still sees only their own.
--
-- WITH CHECK IS THE HALF THAT MATTERS. It is what stops an unverified doctor
-- setting surgery_id, clinic_patient_id or patient_user_id on insert OR on
-- update. Without it they could create an unlinked case, pass the USING test,
-- and then attach a real patient to it in a second statement. USING guards
-- what you can see; WITH CHECK guards what you can leave behind.
--
-- Set v9_5_ENABLE_STANDALONE_CHART to 'off' to skip this section entirely and
-- ship only the tightening above.
DO $narrow$
DECLARE
  v_t text;
  v_child text;
  v_enabled text := coalesce(current_setting('v9_5_ENABLE_STANDALONE_CHART', true), 'on');
  v_dropped int := 0; v_created int := 0; v_absent int := 0;
  v_children text[] := ARRAY[
    'anesthesia_access','anesthesia_airway','anesthesia_amendments',
    'anesthesia_audit','anesthesia_blood_products','anesthesia_case_times',
    'anesthesia_device_sessions','anesthesia_events','anesthesia_fluids',
    'anesthesia_handoffs','anesthesia_history_review','anesthesia_infusion_rates',
    'anesthesia_infusions','anesthesia_labs','anesthesia_medications',
    'anesthesia_outputs','anesthesia_positioning','anesthesia_preassessment',
    'anesthesia_regional','anesthesia_ventilation','anesthesia_vitals'];
  v_pol record;
BEGIN
  IF lower(v_enabled) <> 'on' THEN
    RAISE NOTICE 'Section 4 SKIPPED (v9_5_ENABLE_STANDALONE_CHART=%). Live Chart is unchanged.', v_enabled;
    RETURN;
  END IF;

  -- 4a. The parent. The link columns are on this row, so the test is inline
  --     and needs no function call.
  FOR v_pol IN
    SELECT policyname FROM pg_policies
     WHERE schemaname='public' AND tablename='anesthesia_cases'
       AND permissive='RESTRICTIVE'
       AND coalesce(qual,'') LIKE '%is_pending_doctor%'
       AND coalesce(qual,'') NOT LIKE '%surgery_id%'   -- not one of ours
  LOOP
    EXECUTE format('DROP POLICY %I ON public.anesthesia_cases', v_pol.policyname);
    v_dropped := v_dropped + 1;
  END LOOP;

  /* USING AND WITH CHECK ARE DELIBERATELY NOT THE SAME EXPRESSION.
     USING decides what an unverified doctor may SEE and reach; WITH CHECK
     decides what they may LEAVE BEHIND. Identifiers are constrained only on
     the write side, for one practical reason: a standalone case created before
     this rule may already carry an mrn, and putting the identifier test in
     USING would make that row invisible to the person who owns it, with no
     way to correct it. On the write side the same row is self-healing -
     UPDATE ... SET mrn = NULL produces a NEW row that satisfies WITH CHECK,
     so clearing the identifier is the one edit that always succeeds. */
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='anesthesia_cases'
       AND policyname='anesthesia_cases_unverified_standalone_only'
  ) THEN
    EXECUTE
      'CREATE POLICY anesthesia_cases_unverified_standalone_only '
      || 'ON public.anesthesia_cases AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING (NOT public.is_pending_doctor() OR ('
      ||   'surgery_id IS NULL AND clinic_patient_id IS NULL AND patient_user_id IS NULL)) '
      || 'WITH CHECK (NOT public.is_pending_doctor() OR ('
      ||   'surgery_id IS NULL AND clinic_patient_id IS NULL AND patient_user_id IS NULL '
      /* ── ADDED: a Standalone Clinical Case is a clinical record, not a
            place to keep a real person's identifiers. display_name is NOT
            constrained - it
            becomes the case title. sex, weight, height, ASA, allergies,
            diagnosis and the procedure fields are clinical, not identifying,
            and stay exactly as they are. ── */
      ||   'AND mrn IS NULL AND date_of_birth IS NULL))';
    v_created := v_created + 1;
  END IF;

  -- 4b. The 21 children. Each carries case_id, so each asks the parent.
  FOREACH v_child IN ARRAY v_children LOOP
    IF to_regclass('public.'||v_child) IS NULL THEN
      v_absent := v_absent + 1;
      CONTINUE;
    END IF;

    FOR v_pol IN
      SELECT policyname FROM pg_policies
       WHERE schemaname='public' AND tablename=v_child
         AND permissive='RESTRICTIVE'
         AND coalesce(qual,'') LIKE '%is_pending_doctor%'
         AND coalesce(qual,'') NOT LIKE '%anesthesia_case_unlinked%'
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', v_pol.policyname, v_child);
      v_dropped := v_dropped + 1;
    END LOOP;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname='public' AND tablename=v_child
         AND policyname = v_child || '_unverified_standalone_only'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        || 'USING (NOT public.is_pending_doctor() OR public.anesthesia_case_unlinked(case_id)) '
        || 'WITH CHECK (NOT public.is_pending_doctor() OR public.anesthesia_case_unlinked(case_id))',
        v_child || '_unverified_standalone_only', v_child);
      v_created := v_created + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Section 4: % blanket gate(s) replaced by % standalone rule(s), % table(s) not in this deployment.',
               v_dropped, v_created, v_absent;
END
$narrow$;


-- ============================================================
-- 5. THE TRUST GATES THAT ARE ALREADY CORRECT AND ARE NOT TOUCHED
-- ============================================================
-- Listed so that "unchanged" is a statement somebody checked rather than an
-- omission somebody made:
--
--   hp_clinician_may_read()   reading ANOTHER person's Health Passport.
--                             Already keyed on is_verified_doctor().
--   hp_verify_item()          stamping an entry clinician-verified.
--                             Already keyed on is_verified_doctor().
--   anesthesia_set_trainee()  naming a co-author on someone's chart.
--                             Already tests the TARGET's verification.
--   doctor_treats_patient()   the treating-relationship rule underneath
--                             everything in section 3. Untouched.
--   get_clinician_directory() the patient-facing listing, if present.
--
-- No permissive policy is created, altered or dropped anywhere in this file.
-- Patients, administrators and approved doctors see exactly what they saw.


-- ============================================================
-- 6. VERIFY
-- ============================================================
DO $verify$
DECLARE
  v_ungated text[] := '{}';
  v_t text;
  v_pm text[] := ARRAY[
    'care_requests','clinic_patients','patient_archive_audit',
    'patient_recommendations','patient_surgeries','preop_checklist',
    'preop_questionnaires','preparation_plans','questionnaire_templates',
    'requirement_documents','questions','question_replies'];
BEGIN
  FOREACH v_t IN ARRAY v_pm LOOP
    IF to_regclass('public.'||v_t) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_policies
                        WHERE schemaname='public' AND tablename=v_t
                          AND permissive='RESTRICTIVE'
                          AND coalesce(qual,'') LIKE '%is_pending_doctor%')
    THEN v_ungated := v_ungated || v_t; END IF;
  END LOOP;

  IF array_length(v_ungated,1) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: patient tables still reachable by an unverified doctor: %',
      array_to_string(v_ungated, ', ');
  END IF;

  RAISE NOTICE 'Verified: every present patient-management table is verification-gated.';
  RAISE NOTICE 'anesthesia_case_unlinked() present: %',
    (to_regproc('public.anesthesia_case_unlinked') IS NOT NULL);
END
$verify$;

COMMIT;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- To undo section 4 only (Live Chart returns to verified-doctors-only), and
-- leave the patient tightening in place:
--
--   BEGIN;
--   DO $$ DECLARE r record; BEGIN
--     FOR r IN SELECT tablename, policyname FROM pg_policies
--              WHERE schemaname='public' AND policyname LIKE '%\_unverified\_standalone\_only'
--     LOOP
--       EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
--       EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
--                      || 'USING (NOT public.is_pending_doctor()) '
--                      || 'WITH CHECK (NOT public.is_pending_doctor())',
--                      r.tablename || '_require_verified', r.tablename);
--     END LOOP;
--   END $$;
--   DROP FUNCTION IF EXISTS public.anesthesia_case_unlinked(uuid);
--   COMMIT;
--
-- To undo section 3, drop the gates it added. Do this only deliberately: it
-- returns those tables to being reachable by unverified doctors.
--
-- WHO IS AFFECTED
--   patients                 nothing changes.
--   administrators           nothing changes; is_pending_doctor() excludes them.
--   approved doctors         nothing changes.
--   unverified doctors       GAIN standalone Live Chart. LOSE any patient-table
--                            access they had, which on a database where v9 was
--                            applied is real and is the point. Their existing
--                            unlinked charts are unaffected. Any chart they own
--                            that IS linked to a patient becomes invisible to
--                            them until they are approved; it is not deleted,
--                            and approval restores it.
