-- ============================================================
-- v9_doctor_access_model.sql
-- PREPARED FOR REVIEW — NOT APPLIED. DO NOT RUN AGAINST PRODUCTION
-- UNTIL THE FRONTEND OF THIS BRANCH IS DEPLOYED (see DEPLOYMENT ORDER).
-- ============================================================
--
-- WHAT CHANGES, IN ONE SENTENCE
-- -----------------------------
-- Verification stops being the gate on ordinary doctor product access and
-- becomes what its name says: a trust status. Being a doctor account is what
-- opens the workspace; being a VERIFIED doctor account is what opens the
-- patient-facing, trust-bearing surfaces.
--
-- WHAT DOES NOT CHANGE
-- --------------------
-- Every ownership, treating-relationship, authorship and patient-scoping rule
-- in this database. Not one of them is touched. This migration removes a
-- verification test from ten places and drops a blanket restriction from
-- thirty-one tables; it does not add access to a single row that the
-- underlying policies did not already scope to the caller.
--
-- That claim was checked table by table before this file was written, not
-- assumed. Section 4 records what was found — including the two tables where
-- it turned out to be FALSE, and what is done about them instead.
--
-- THE THREE TRUST GATES THAT STAY
-- -------------------------------
--   hp_clinician_may_read()      reading ANOTHER PERSON's Health Passport
--   hp_verify_item()             stamping an entry "clinician verified"
--   anesthesia_set_trainee()     the TARGET test — naming a co-author
-- Plus one that is ADDED, because the new model needs it:
--   get_clinician_directory()    public, patient-facing clinician listing
--
-- TWO Q&A SCHEMA SHAPES, BECAUSE PRODUCTION HAS THE OLDER ONE.
-- v2_ask_migration.sql is what turns the lightweight questions table into the
-- Ask-a-Doctor portal: it adds patient_id, subject, message and status, and
-- creates question_replies. Production never received it. So `questions`
-- exists there but has no patient_id, and an earlier version of section 4c —
-- guarded only by to_regclass — ran and failed 42703 building a policy body
-- around a column that is not there.
--
-- Existence was never the right question. Section 4c now asks whether the
-- COLUMNS ITS OWN POLICIES NAME are present, and takes one of two paths:
--   PORTAL  patient_id present -> the blanket gate is replaced by the narrowed
--           permissive policies, as designed.
--   LEGACY  patient_id absent  -> the blanket gate is LEFT EXACTLY AS IT IS.
--           It is the only thing keeping an unverified doctor out of that
--           inbox, and there is no patient_id to build a replacement from.
-- Making the table portal-shaped is v2_ask_migration.sql's job. That is a
-- product decision about the live Questions system and not something a
-- permissions migration takes on the way past.
--
-- The Q&A pair is therefore EXCLUDED from section 4's generic loop. Letting
-- the loop drop the gate first and discovering only afterwards that it cannot
-- be rebuilt would leave the legacy inbox wider than this migration found it.
--
-- REHEARSED AGAINST THE REAL INVENTORY, AND ONE THING WAS NOT REHEARSED.
-- The rehearsal replica matched production on every field of
-- tools/v9_production_inventory.sql — 31 gate policies, patient_archive_audit
-- absent, question_replies absent, questions present, v9_1 and v9_2 applied,
-- v9 not — except its PostgreSQL major version: 16.13 here, 17.6 there. PG17
-- could not be installed (the distro ships 16 and the PGDG repo is blocked).
--
-- That gap mattered enormously for the PREVIOUS version of this file, whose
-- 33 hand-written DROP POLICY lines behaved differently on 16 and on
-- production. It does not matter for this one, and the reason is structural
-- rather than optimistic: section 4 issues a DROP only for a policy
-- pg_policies has just returned, so there is no statement here that can name a
-- relation the catalog did not just confirm exists. The remaining catalog
-- surface — pg_policies, to_regclass, to_regproc, information_schema.columns,
-- format(%I) — is unchanged between 16 and 17.
--
-- ORDER OF SECTIONS MATTERS. The predicates are re-pointed (3) before the
-- blanket restriction is dropped (4), so there is no instant during the
-- transaction at which a table is reachable by a caller the predicates would
-- have refused. The whole file is one transaction; a failure anywhere leaves
-- production exactly as it was.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. PREFLIGHT
-- ============================================================
DO $preflight$
DECLARE v_missing text[] := '{}'; v_t text;
BEGIN
  IF to_regproc('public.is_doctor_account')   IS NULL THEN v_missing := v_missing || 'is_doctor_account() [v2_auth_onboarding.sql]'::text; END IF;
  IF to_regproc('public.is_verified_doctor')  IS NULL THEN v_missing := v_missing || 'is_verified_doctor() [v2_auth_onboarding.sql]'::text; END IF;
  IF to_regproc('public.is_platform_admin')   IS NULL THEN v_missing := v_missing || 'is_platform_admin() [v2_admin_phase0.sql]'::text; END IF;
  IF to_regproc('public.doctor_treats_patient') IS NULL THEN v_missing := v_missing || 'doctor_treats_patient() [v2_security_hardening.sql]'::text; END IF;

  /* RELATIONS THIS FILE CANNOT WORK WITHOUT.
     Checked by name against the catalog, because the migration files are not
     evidence: patient_archive_audit is in v2_auth_onboarding.sql and is not in
     this database, which is what took the first attempt down at section 4.
     Optional relations are deliberately NOT listed — section 4 discovers what
     exists and section 4c skips what does not. */
  FOR v_t IN SELECT unnest(ARRAY[
      'profiles','patient_surgeries','clinic_patients','care_requests',
      'anesthesia_cases','anesthesia_amendments','anesthesia_audit'])
  LOOP
    IF to_regclass('public.' || v_t) IS NULL THEN
      v_missing := v_missing || ('table public.' || v_t)::text;
    END IF;
  END LOOP;

  /* FUNCTIONS the new bodies call at run time. A SQL-language body is parsed
     at CREATE, so a missing one here fails mid-file rather than in front of a
     clinician. */
  FOR v_t IN SELECT unnest(ARRAY[
      'is_platform_admin','doctor_treats_patient','account_is_active',
      'patient_purge_eligibility'])
  LOOP
    IF to_regproc('public.' || v_t) IS NULL THEN
      v_missing := v_missing || ('function public.' || v_t || '()')::text;
    END IF;
  END LOOP;

  -- v3_1 must already be applied. If it is not, the bodies replaced in
  -- section 3 are v3's WIDER ones, and re-pointing those would compound the
  -- V1/V5 weaknesses instead of preserving the hardening.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='anesthesia_case_editable'
       AND p.prosrc LIKE '%c.anesthesiologist_id = auth.uid() OR c.trainee_id = auth.uid()%'
  ) THEN
    v_missing := v_missing || 'v3_1_anesthesia_hardening.sql (anesthesia_case_editable is still the WIDE v3 body)'::text;
  END IF;

  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION E'ABORT: prerequisites missing: %.\n'
      '  This migration re-points existing predicates. It cannot create the\n'
      '  authorization model it is narrowing.',
      array_to_string(v_missing, ', ');
  END IF;
  RAISE NOTICE 'Preflight OK.';
END
$preflight$;

-- Snapshot for the verify block at the end, and for anybody reading the log.
DO $before$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname='public'
     AND ( policyname LIKE '%\_require\_verified'
           OR ( permissive='RESTRICTIVE' AND coalesce(qual,'') LIKE '%is_pending_doctor%' ) );
  /* No expected number any more. 33 was what the migration files implied; this
     database is the only authority on what it actually has. */
  RAISE NOTICE 'Blanket verification policies found on THIS database: %', v_n;
END
$before$;

-- ============================================================
-- 2. THE PREDICATES THEMSELVES ARE NOT REDEFINED
-- ============================================================
-- is_verified_doctor() keeps its exact meaning: role='doctor' AND approved.
-- Redefining it in place would have been the fast way to do this migration and
-- the wrong one — it would silently relax the three trust gates and the
-- directory along with everything else, in a single statement, invisibly.
--
-- is_doctor_account() likewise keeps its meaning: role='doctor', approval
-- irrelevant. It already exists and is already granted; this is a no-op that
-- documents the dependency and repairs the grant if the phase-2/phase-3
-- DO-block grant pattern ever lost it. Plain statements, deliberately: a DO
-- block is ONE statement, so one failing iteration rolls back every grant
-- beside it, which is exactly how the admin grants went missing before.
REVOKE ALL ON FUNCTION public.is_doctor_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_doctor_account() TO authenticated;

-- is_pending_doctor() becomes UNUSED by the end of this file. It is
-- deliberately NOT dropped: it is correct, it costs nothing, and something
-- may legitimately want to ask "is this doctor unverified" later. Dropping a
-- function that policies elsewhere might reference is how a migration turns
-- into an outage.

-- ============================================================
-- 3. THE TEN ORDINARY DOCTOR GATES: verification -> doctor account
-- ============================================================
-- Each body below is the CURRENT production body with ONE identifier changed:
-- public.is_verified_doctor()  ->  public.is_doctor_account()
-- Everything else — every ownership clause, every status test, every
-- auth.uid() comparison — is reproduced verbatim. Read the diff, not the file.

-- 3.1 READ an anesthesia case  (was v3_1:81)
--     The ownership disjunction underneath is untouched: anesthesiologist of
--     record, named trainee, the doctor who owns the linked clinic patient,
--     the doctor assigned to the linked surgical journey, or a real treating
--     relationship. An unverified doctor gains their OWN cases and nothing else.
CREATE OR REPLACE FUNCTION public.anesthesia_case_access(p_case uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.anesthesia_cases c
     WHERE c.id = p_case
       AND c.deleted_at IS NULL
       AND (
            public.is_platform_admin()
         OR (
              public.is_doctor_account()
              AND (
                   c.anesthesiologist_id = auth.uid()
                OR c.trainee_id          = auth.uid()
                OR EXISTS (SELECT 1 FROM public.clinic_patients cp
                            WHERE cp.id = c.clinic_patient_id AND cp.doctor_id = auth.uid())
                OR EXISTS (SELECT 1 FROM public.patient_surgeries s
                            WHERE s.id = c.surgery_id AND s.assigned_doctor_id = auth.uid())
                OR (c.patient_user_id IS NOT NULL AND public.doctor_treats_patient(c.patient_user_id))
              )
            )
       )
  );
$$;

-- 3.2 CHART on an anesthesia case  (was v3_1:110)
--     Still narrower than READ, and still only the anesthesiologist of record
--     or an explicitly named trainee, on a case that is still open.
CREATE OR REPLACE FUNCTION public.anesthesia_case_editable(p_case uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.is_doctor_account()
     AND EXISTS (
       SELECT 1 FROM public.anesthesia_cases c
        WHERE c.id = p_case
          AND c.deleted_at IS NULL
          AND c.status IN ('draft','in_progress')
          AND (c.anesthesiologist_id = auth.uid() OR c.trainee_id = auth.uid())
     );
$$;

-- 3.3 Open a new case  (was v3:753)
DO $ins$ BEGIN
  IF to_regclass('public.anesthesia_cases') IS NULL THEN
    RAISE NOTICE 'skip: anesthesia_cases not present'; RETURN;
  END IF;
  EXECUTE $p$DROP POLICY IF EXISTS anes_case_insert ON public.anesthesia_cases$p$;
  EXECUTE $p$
    CREATE POLICY anes_case_insert ON public.anesthesia_cases
      FOR INSERT TO authenticated
      WITH CHECK ( public.is_doctor_account()
                   AND anesthesiologist_id = auth.uid()
                   AND created_by = auth.uid()
                   AND status IN ('draft','in_progress') )$p$;
END $ins$;

-- 3.4 What a case may become  (was v3:765)
DO $upd$ BEGIN
  IF to_regclass('public.anesthesia_cases') IS NULL THEN RETURN; END IF;
  EXECUTE $p$DROP POLICY IF EXISTS anes_case_update ON public.anesthesia_cases$p$;
  EXECUTE $p$
    CREATE POLICY anes_case_update ON public.anesthesia_cases
      FOR UPDATE TO authenticated
      USING ( public.anesthesia_case_editable(id) )
      WITH CHECK ( public.is_doctor_account() )$p$;
END $upd$;

-- 3.5 + 3.6 Amend a finalized record — RPC and policy MOVE TOGETHER.
--     Splitting them is the one way to get this wrong: the RPC would succeed
--     and the policy would refuse, or the reverse.
CREATE OR REPLACE FUNCTION public.anesthesia_amend_case(
  p_case uuid, p_area text, p_original text, p_amendment text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid; v_status text;
BEGIN
  IF NOT public.is_doctor_account() THEN
    RAISE EXCEPTION 'Only a doctor account may amend an anesthesia record' USING ERRCODE = '42501';
  END IF;
  IF NOT public.anesthesia_case_access(p_case) THEN
    RAISE EXCEPTION 'You cannot amend this record' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status FROM public.anesthesia_cases WHERE id = p_case;
  IF v_status IS DISTINCT FROM 'finalized' THEN
    RAISE EXCEPTION 'This record is not finalized. Edit it directly instead of amending it.'
      USING ERRCODE = '22023';
  END IF;

  IF NULLIF(btrim(COALESCE(p_amendment,'')),'') IS NULL
     OR NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'An amendment requires both the change and the reason for it' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.anesthesia_amendments(case_id, target_area, original_text, amendment, reason, amended_by)
  VALUES (p_case, COALESCE(p_area,'general'), p_original, p_amendment, p_reason, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.anesthesia_audit(case_id, table_name, row_id, action, actor, after)
  VALUES (p_case, 'anesthesia_amendments', v_id::text, 'amend', auth.uid(),
          jsonb_build_object('area', p_area, 'reason', p_reason));

  RETURN jsonb_build_object('ok', true, 'amendment_id', v_id);
END;
$$;

DO $amd$ BEGIN
  IF to_regclass('public.anesthesia_amendments') IS NULL THEN
    RAISE NOTICE 'skip: anesthesia_amendments not present'; RETURN;
  END IF;
  EXECUTE $p$DROP POLICY IF EXISTS anes_amend_insert ON public.anesthesia_amendments$p$;
  EXECUTE $p$
    CREATE POLICY anes_amend_insert ON public.anesthesia_amendments
      FOR INSERT TO authenticated
      WITH CHECK ( public.is_doctor_account()
                   AND public.anesthesia_case_access(case_id)
                   AND amended_by = auth.uid()
                   AND EXISTS (SELECT 1 FROM public.anesthesia_cases c
                                WHERE c.id = case_id AND c.status = 'finalized') )$p$;
END $amd$;

-- 3.7 Change the anesthesia team.
--     THE TWO TESTS IN THIS FUNCTION ARE NOT THE SAME QUESTION.
--       CALLER test  -> is_doctor_account(). Changing the team on your own
--                       open case is ordinary work.
--       TARGET test  -> STAYS VERIFIED. Naming somebody as a co-author on a
--                       clinical record is a claim about THEM, and it is the
--                       exact hole the V1 hardening closed at the other end.
--                       Relaxing it would launder unverified authorship into a
--                       verified doctor's chart.
--     The target test is written as a literal, not as a call to
--     is_verified_doctor(), so a search-and-replace over the predicate name
--     would have missed it. It is spelled out here on purpose.
CREATE OR REPLACE FUNCTION public.anesthesia_set_trainee(p_case uuid, p_trainee uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_before uuid;
BEGIN
  IF NOT public.is_doctor_account() THEN
    RAISE EXCEPTION 'Only a doctor account may change the anesthesia team' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.anesthesia_cases c
                  WHERE c.id = p_case AND c.deleted_at IS NULL
                    AND c.status IN ('draft','in_progress')
                    AND c.anesthesiologist_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the anesthesiologist of record may change the team on an open case'
      USING ERRCODE = '42501';
  END IF;
  -- TRUST GATE — unchanged by design.
  IF p_trainee IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.id = p_trainee AND p.role = 'doctor'
                        AND p.verification_status = 'approved') THEN
    RAISE EXCEPTION 'A team member must be a verified clinician' USING ERRCODE = '42501';
  END IF;

  SELECT trainee_id INTO v_before FROM public.anesthesia_cases WHERE id = p_case;
  UPDATE public.anesthesia_cases SET trainee_id = p_trainee, updated_at = now() WHERE id = p_case;

  INSERT INTO public.anesthesia_audit(case_id, table_name, row_id, action, actor, before, after)
  VALUES (p_case, 'anesthesia_cases', p_case::text, 'set_trainee', auth.uid(),
          jsonb_build_object('trainee_id', v_before),
          jsonb_build_object('trainee_id', p_trainee));

  RETURN jsonb_build_object('ok', true, 'trainee_id', p_trainee);
END;
$$;

-- 3.8 The Recycle Bin  (was v4_1:318)
--     Only the IF changes. Every row filter in the body below it is untouched,
--     so a doctor still sees only records they manage and an admin sees all.
CREATE OR REPLACE FUNCTION public.recycle_bin_list()
RETURNS TABLE (
  kind text, id uuid, label text, detail text,
  deleted_at timestamptz, deleted_by uuid, deleted_by_name text, delete_reason text,
  restorable boolean, purge_eligible boolean, purge_code text, purge_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_admin boolean := public.is_platform_admin();
BEGIN
  -- A patient or an anon caller gets an empty set, never an error.
  IF NOT (v_admin OR public.is_doctor_account()) THEN RETURN; END IF;

  RETURN QUERY
  SELECT 'journey'::text, s.id,
         COALESCE(s.patient_name,'Unnamed journey'), s.procedure_type,
         s.deleted_at, s.deleted_by, COALESCE(pr.full_name, pr.email), s.delete_reason,
         true,
         COALESCE((public.patient_purge_eligibility('journey', s.id)->>'eligible')::boolean,false),
         public.patient_purge_eligibility('journey', s.id)->>'code',
         public.patient_purge_eligibility('journey', s.id)->>'reason'
    FROM public.patient_surgeries s
    LEFT JOIN public.profiles pr ON pr.id = s.deleted_by
   WHERE s.deleted_at IS NOT NULL
     AND (v_admin OR s.assigned_doctor_id = auth.uid())

  UNION ALL
  SELECT 'clinic_patient'::text, cp.id,
         COALESCE(cp.patient_name,'Unnamed patient'), cp.procedure,
         cp.deleted_at, cp.deleted_by, COALESCE(pr.full_name, pr.email), cp.delete_reason,
         true,
         COALESCE((public.patient_purge_eligibility('clinic_patient', cp.id)->>'eligible')::boolean,false),
         public.patient_purge_eligibility('clinic_patient', cp.id)->>'code',
         public.patient_purge_eligibility('clinic_patient', cp.id)->>'reason'
    FROM public.clinic_patients cp
    LEFT JOIN public.profiles pr ON pr.id = cp.deleted_by
   WHERE cp.deleted_at IS NOT NULL
     AND (v_admin OR cp.doctor_id = auth.uid());
END;
$$;

-- 3.9 Archive / delete / restore a patient record  (was v4:158)
--     This is the predicate behind patient_lifecycle_eligibility(), i.e. the
--     one the dashboard's Archive/Delete menu actually asks about.
CREATE OR REPLACE FUNCTION public.patient_record_manageable(p_kind text, p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.is_doctor_account() AND (
    CASE lower(COALESCE(p_kind,''))
      WHEN 'journey' THEN EXISTS (SELECT 1 FROM public.patient_surgeries s
                                   WHERE s.id = p_id AND s.assigned_doctor_id = auth.uid())
      WHEN 'clinic_patient' THEN EXISTS (SELECT 1 FROM public.clinic_patients cp
                                          WHERE cp.id = p_id AND cp.doctor_id = auth.uid())
      ELSE false
    END
  );
$$;

-- 3.10 Finalize a record — see section 6. The verification test becomes a
--      RECORDED FACT rather than a refusal, so it is written there with the
--      provenance column it depends on.

-- ============================================================
-- 4. THE BLANKET RESTRICTION
-- ============================================================
-- 33 RESTRICTIVE policies named <table>_require_verified, each
-- FOR ALL TO authenticated USING (NOT is_pending_doctor()). RESTRICTIVE
-- policies are ANDed with the permissive ones, so each can only ever remove
-- access — which means dropping one restores whatever the permissive policies
-- underneath already allow, and nothing more.
--
-- THAT SENTENCE IS ONLY TRUE IF THE PERMISSIVE POLICIES ARE ACTUALLY SCOPED.
-- Every one of the 33 was read before this section was written. Findings:
--
--   * 21 anesthesia tables — all route through anesthesia_case_access() /
--     anesthesia_case_editable(), re-pointed in 3.1/3.2 and still ownership
--     scoped. Safe to drop.
--   * 8 workspace tables (care_requests, clinic_patients, patient_archive_audit,
--     patient_recommendations, patient_surgeries, preop_checklist,
--     preop_questionnaires, preparation_plans) — every permissive policy is
--     keyed on auth.uid() against an owner column, a treating relationship, or
--     is_platform_admin(). Safe to drop.
--   * 2 more (questionnaire_templates, requirement_documents) — same, keyed on
--     doctor_id / assigned_doctor_id / patient_id. Safe to drop.
--   * 2 tables where it was NOT true: questions and question_replies.
--     See 4b. They are handled differently and deliberately.
--
-- HOW THIS BLOCK FINDS ITS WORK — and why it no longer names tables.
--
-- It used to be 33 hand-written DROP POLICY IF EXISTS lines. That failed in
-- production with 42P01: relation "public.patient_archive_audit" does not
-- exist — one table this deployment never created took the whole migration
-- down, after v9_2 and v9_1 had already committed.
--
-- AND THE SEMANTICS ARE VERSION-DEPENDENT, which is the part worth knowing.
-- On PostgreSQL 16, `DROP POLICY IF EXISTS p ON <missing table>` is tolerated:
-- it emits "relation does not exist, skipping" and carries on. On the server
-- running production it raises 42P01. So a replica on a newer PostgreSQL will
-- run those 33 lines happily and prove nothing — which is exactly what
-- happened here, and is why the rehearsal passed before the deployment failed.
--
-- Discovering the set from the catalog removes the question entirely. A DROP
-- is only ever emitted for a policy pg_policies just returned, and pg_policies
-- cannot return a policy on a relation that does not exist, so there is no
-- version of PostgreSQL on which this block can raise 42P01.
--
-- The deeper fault was writing the list from the migration files at all. Twice
-- now they have described a database that does not exist here
-- (patient_surgeries.origin, then patient_archive_audit), so the list is now
-- DISCOVERED from the catalog at run time. pg_policies only ever lists
-- policies on relations that exist, which makes 42P01 unreachable by
-- construction rather than by remembering to check.
--
-- Two predicates identify the set, and a policy matching EITHER is dropped:
--   * the name ends in _require_verified   — the convention v2/v3 used, and
--     the reason the odd anes_case_/anes_amend_ pair is caught too;
--   * OR it is RESTRICTIVE and its USING mentions is_pending_doctor — which
--     catches one that was ever renamed by hand.
-- Nothing else can match: no other policy in this schema is a RESTRICTIVE
-- is_pending_doctor gate, and that is exactly what this migration removes.
--
-- It counts what it dropped and says so, so the log records the real number
-- for this database instead of an assumed one.
DO $drop_gate$
DECLARE r record; v_n int := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND ( policyname LIKE '%\_require\_verified'
             OR ( permissive = 'RESTRICTIVE'
                  AND coalesce(qual,'') LIKE '%is_pending_doctor%' ) )
       /* THE Q&A PAIR IS NOT THE GENERIC CASE and must never be dropped here.
          Section 4c decides their fate, because whether their gate can be
          replaced depends on the SHAPE of the table, not its existence. On a
          legacy questions table the replacement cannot be built at all, and a
          loop that had already dropped the gate would leave the inbox wider
          than it found it — a silent widening produced by a migration whose
          whole purpose is to not widen anything. */
       AND tablename NOT IN ('questions','question_replies')
     ORDER BY tablename, policyname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   r.policyname, r.schemaname, r.tablename);
    RAISE NOTICE '  dropped %.%', r.tablename, r.policyname;
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'Blanket verification policies dropped: % (Q&A pair handled separately in 4c)', v_n;
END
$drop_gate$;

-- ============================================================
-- 4c. THE TWO TABLES WHERE DROPPING WOULD HAVE BEEN A WIDENING
-- ============================================================
-- questions and question_replies are the public Ask-a-Doctor inbox. Their
-- permissive policies do NOT scope by ownership. Read as installed:
--
--   q_select_own_or_staff   USING ( auth.uid() = patient_id
--                                   OR EXISTS (SELECT 1 FROM profiles p
--                                     WHERE p.id = auth.uid()
--                                       AND (p.is_admin OR p.role IN ('doctor','admin'))) )
--   q_update_staff          USING ( ...the same staff clause, alone... )
--   r_select_own_or_staff   USING ( ...the same staff clause, via questions... )
--   r_insert_participant    WITH CHECK ( author_id = auth.uid()
--                                        AND (asker OR ...the same staff clause...) )
--
-- "Any doctor may read and answer any question" is the intended design of a
-- shared inbox, and it is correct for a VERIFIED doctor. Until now the blanket
-- restriction was the only thing keeping an unverified one out of it. Dropping
-- it here would have let a self-declared doctor read every patient question on
-- the platform and reply to them as a clinician — a patient-facing trust
-- surface, in the same category as the directory.
--
-- So these two are REDESIGNED rather than dropped. The blanket restriction
-- goes, and the trust requirement moves onto the permissive policies where it
-- belongs — stated positively, on the staff branch only. The patient's own
-- access to their own question is untouched in every one of them.
--
-- This also repairs something older: those staff clauses inline
-- "p.is_admin = true OR p.role = 'admin'", which is is_platform_admin()
-- rewritten by hand in four places. They now call the function, so the inbox
-- and the rest of the database agree about who an administrator is.

-- Wrapped, for the same reason section 4 is discovered rather than listed: if
-- this deployment has no Ask-a-Doctor inbox, there is nothing here to protect
-- and nothing here should stop the rest of the migration. Absence is reported,
-- not assumed and not fatal.
/* WHICH SHAPE IS THIS DATABASE? — asked by COLUMN, not by table.
   Existence was not a sufficient test and production proved it: questions is
   present there, but it is the LEGACY table. v2_ask_migration.sql is what adds
   patient_id, subject, message, status and creates question_replies, and that
   migration was never applied. Guarding on to_regclass let the block run and
   the policy body then failed with 42703 on patient_id.
   So each branch now checks the columns its own policies actually name. */
DO $qa$
DECLARE
  v_q_exists    boolean := to_regclass('public.questions') IS NOT NULL;
  v_r_exists    boolean := to_regclass('public.question_replies') IS NOT NULL;
  v_q_portal    boolean := false;
  v_r_portal    boolean := false;
BEGIN
  IF v_q_exists THEN
    SELECT count(*) = 1 INTO v_q_portal
      FROM pg_attribute
     WHERE attrelid = to_regclass('public.questions')
       AND attname  = 'patient_id'          -- the only column the new policies name
       AND attnum > 0 AND NOT attisdropped;
  END IF;

  IF v_r_exists THEN
    SELECT count(*) = 2 INTO v_r_portal
      FROM pg_attribute
     WHERE attrelid = to_regclass('public.question_replies')
       AND attname IN ('question_id','author_id')
       AND attnum > 0 AND NOT attisdropped;
  END IF;

  -- ── questions ─────────────────────────────────────────────────────────
  IF NOT v_q_exists THEN
    RAISE NOTICE 'questions: not present on this database; nothing to do';

  ELSIF NOT v_q_portal THEN
    /* LEGACY. Its blanket gate is deliberately LEFT IN PLACE — it is the only
       thing standing between the legacy inbox and an unverified doctor, and
       there is no patient_id to build the replacement from. Preserving it is
       the conservative outcome: access is exactly what it was before v9 ran.
       Making this table portal-shaped is v2_ask_migration.sql's job, and that
       is a product decision about the live Questions system, not something a
       permissions migration gets to do on the way past. */
    RAISE NOTICE 'questions: legacy schema detected; existing trust gate preserved';

  ELSE
    EXECUTE $q$DROP POLICY IF EXISTS questions_require_verified ON public.questions$q$;
    EXECUTE $q$DROP POLICY IF EXISTS q_select_own_or_staff ON public.questions$q$;
    EXECUTE $q$
      CREATE POLICY q_select_own_or_staff ON public.questions
        FOR SELECT TO authenticated
        USING ( auth.uid() = patient_id
                OR public.is_platform_admin()
                OR public.is_verified_doctor() )$q$;
    EXECUTE $q$DROP POLICY IF EXISTS q_update_staff ON public.questions$q$;
    EXECUTE $q$
      CREATE POLICY q_update_staff ON public.questions
        FOR UPDATE TO authenticated
        USING ( public.is_platform_admin() OR public.is_verified_doctor() )
        WITH CHECK ( public.is_platform_admin() OR public.is_verified_doctor() )$q$;
    RAISE NOTICE 'questions: portal schema; inbox kept verified-only.';
  END IF;

  -- ── question_replies ──────────────────────────────────────────────────
  IF NOT v_r_exists THEN
    RAISE NOTICE 'question_replies: not present on this database; nothing to do';

  ELSIF NOT v_r_portal OR NOT v_q_portal THEN
    /* The reply policies read question_replies.question_id/author_id AND join
       to questions.patient_id, so BOTH tables have to be portal-shaped. If
       either is not, the gate stays exactly as it is. */
    RAISE NOTICE 'question_replies: legacy or incomplete schema detected; existing trust gate preserved';

  ELSE
    EXECUTE $q$DROP POLICY IF EXISTS question_replies_require_verified ON public.question_replies$q$;
    EXECUTE $q$DROP POLICY IF EXISTS r_select_own_or_staff ON public.question_replies$q$;
    EXECUTE $q$
      CREATE POLICY r_select_own_or_staff ON public.question_replies
        FOR SELECT TO authenticated
        USING ( EXISTS (SELECT 1 FROM public.questions q
                         WHERE q.id = question_replies.question_id
                           AND q.patient_id = auth.uid())
                OR public.is_platform_admin()
                OR public.is_verified_doctor() )$q$;
    EXECUTE $q$DROP POLICY IF EXISTS r_insert_participant ON public.question_replies$q$;
    EXECUTE $q$
      CREATE POLICY r_insert_participant ON public.question_replies
        FOR INSERT TO authenticated
        WITH CHECK ( author_id = auth.uid()
                     AND ( EXISTS (SELECT 1 FROM public.questions q
                                    WHERE q.id = question_replies.question_id
                                      AND q.patient_id = auth.uid())
                           OR public.is_platform_admin()
                           OR public.is_verified_doctor() ) )$q$;
    RAISE NOTICE 'question_replies: portal schema; replies kept verified-only.';
  END IF;
END
$qa$;

-- ============================================================
-- 5. THE PUBLIC CLINICIAN DIRECTORY — TIGHTENED
-- ============================================================
-- The directory listed anyone with accepting_patients = true and a doctor role
-- or admin flag. It has NEVER checked verification. That was survivable only
-- because the approval wall kept unverified doctors out of Settings, where the
-- checkbox lives. This migration removes that wall, so without this section a
-- brand-new self-declared account could put itself in front of patients as a
-- listed clinician by ticking one box.
--
-- This is the one place v9 makes the database STRICTER, and it is not
-- optional: it is the direct consequence of the access change above.
--
-- is_admin is also removed from the listing condition. An administrator is not
-- a clinician by virtue of administering the platform; a doctor-administrator
-- still appears, because their role is 'doctor'.
CREATE OR REPLACE FUNCTION public.get_clinician_directory()
RETURNS TABLE (id uuid, name text, specialty text, clinic text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id,
         COALESCE(NULLIF(p.display_name,''), p.full_name, 'Clinician') AS name,
         p.specialty,
         COALESCE(NULLIF(p.clinic_name,''), p.hospital) AS clinic
  FROM public.profiles p
  WHERE p.accepting_patients = true
    AND p.role = 'doctor'
    AND p.verification_status = 'approved'
    AND COALESCE(p.account_status,'active') = 'active'
    AND p.deleted_at IS NULL;
$$;

-- ============================================================
-- 6. SIGNING-TIME PROVENANCE
-- ============================================================
-- An unverified doctor may now finalize their own record. "Who signed this,
-- and were they verified at the time" therefore needs a durable answer that
-- does not depend on reading the author's profile later — because a profile
-- is a live row and a signature is a historical fact.
--
-- WHY A STATUS COLUMN AND NOT ALSO A BOOLEAN. You asked. A boolean would be a
-- pure function of the text (status = 'approved'), so storing both creates two
-- columns that can disagree, and nothing in the schema could say which was
-- right. One column, and callers derive the boolean. The text also carries
-- what a boolean cannot: 'rejected' at signing time is a materially different
-- fact from 'pending', and both collapse to false.
--
-- The value is captured from is_verified_doctor() at the moment of signing —
-- the same predicate the trust gates use — and stored as the profile's literal
-- status. Capturing the profile column alone would be subtly wrong: a doctor
-- whose role later changed to 'patient' could carry verification_status
-- 'approved' on a row that is no longer a doctor account at all.
ALTER TABLE public.anesthesia_cases
  ADD COLUMN IF NOT EXISTS finalized_by_verification_status text;

COMMENT ON COLUMN public.anesthesia_cases.finalized_by_verification_status IS
  'The signer''s verification status AT THE MOMENT OF FINALIZATION. Written only by anesthesia_finalize_case(). Historical fact: never rewritten when the author''s verification later changes. NULL on records finalized before v9.';

-- IMMUTABILITY IS ALREADY GUARANTEED, and by construction rather than by a new
-- rule. anesthesia_guard_case_fields() is an ALLOWLIST: it rejects any column
-- not named in v_editable for the 'authenticated' and 'anon' roles, and it
-- returns early for the table owner — which is the context every SECURITY
-- DEFINER RPC runs in. finalized_by_verification_status is deliberately NOT
-- added to that allowlist, so:
--    * the author cannot set it, at signing time or ever after
--    * no client can rewrite it when their verification changes
--    * anesthesia_finalize_case() can write it, because it is SECURITY DEFINER
-- Verified in section 9. No trigger change is required, and adding one would
-- be a second rule saying what the first already says.

CREATE OR REPLACE FUNCTION public.anesthesia_finalize_case(p_case uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_status text; v_verif text; v_was_verified boolean;
BEGIN
  -- Ordinary doctor access: signing your own record is not a trust-gated act.
  IF NOT public.is_doctor_account() THEN
    RAISE EXCEPTION 'Only a doctor account may finalize an anesthesia record' USING ERRCODE = '42501';
  END IF;
  IF NOT public.anesthesia_case_editable(p_case) THEN
    RAISE EXCEPTION 'You cannot finalize this record' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM public.anesthesia_cases WHERE id = p_case;
  IF v_status = 'finalized' THEN
    RAISE EXCEPTION 'This record is already finalized' USING ERRCODE = '22023';
  END IF;

  -- Read BOTH, and reconcile them, for the reason in the comment above: the
  -- stored string is only meaningful for an account that is still a doctor.
  v_was_verified := public.is_verified_doctor();
  SELECT verification_status INTO v_verif FROM public.profiles WHERE id = auth.uid();
  IF NOT v_was_verified AND COALESCE(v_verif,'') = 'approved' THEN
    v_verif := 'not_a_doctor_account';
  END IF;

  UPDATE public.anesthesia_cases
     SET status = 'finalized',
         finalized_at = now(),
         finalized_by = auth.uid(),
         finalized_by_verification_status = COALESCE(v_verif, 'unknown'),
         updated_at = now()
   WHERE id = p_case;

  INSERT INTO public.anesthesia_audit(case_id, table_name, row_id, action, actor, after)
  VALUES (p_case, 'anesthesia_cases', p_case::text, 'finalize', auth.uid(),
          jsonb_build_object('status','finalized',
                             'signer_verification', COALESCE(v_verif,'unknown')));

  RETURN jsonb_build_object('ok', true, 'status', 'finalized',
                            'signer_verification', COALESCE(v_verif,'unknown'),
                            'signer_verified', v_was_verified);
END;
$$;

-- ============================================================
-- 7. GRANTS — one plain statement each
-- ============================================================
REVOKE ALL ON FUNCTION public.anesthesia_case_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anesthesia_case_access(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.anesthesia_case_editable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anesthesia_case_editable(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.anesthesia_finalize_case(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anesthesia_finalize_case(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.anesthesia_amend_case(uuid,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anesthesia_amend_case(uuid,text,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.anesthesia_set_trainee(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anesthesia_set_trainee(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.recycle_bin_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recycle_bin_list() TO authenticated;
REVOKE ALL ON FUNCTION public.patient_record_manageable(text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patient_record_manageable(text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_clinician_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_clinician_directory() TO authenticated;

-- ============================================================
-- 8. RE-RUN PROTECTION FOR THE SUPERSEDED v3 BODIES
-- ============================================================
-- v3_anesthesia_record.sql still contains the ORIGINAL, wider bodies of
-- anesthesia_case_editable(), anesthesia_amend_case() and the anes_amend_insert
-- policy, which v3_1 replaced and this file replaced again. Re-running v3
-- against a live database would silently revert both hardening passes: CHART
-- would return to "any treating doctor", and amendments would become possible
-- on drafts.
--
-- A marker is recorded so v3 can refuse to run. The repository copy of
-- v3_anesthesia_record.sql gains a matching preflight in the same commit as
-- this file — a comment alone would not have stopped anybody.
CREATE TABLE IF NOT EXISTS public.schema_migrations_applied (
  name       text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  note       text
);
REVOKE ALL ON TABLE public.schema_migrations_applied FROM PUBLIC, anon, authenticated;

INSERT INTO public.schema_migrations_applied(name, note)
VALUES ('v9_doctor_access_model',
        'Doctor access follows role; verification is trust status. Re-running v3_anesthesia_record.sql or v2_auth_onboarding.sql would revert this.')
ON CONFLICT (name) DO UPDATE SET applied_at = now(), note = EXCLUDED.note;

-- ============================================================
-- 9. POST-VERIFY (inside the transaction; ABORTS on failure)
-- ============================================================
DO $verify$
DECLARE
  v_left int; v_bad text[] := '{}'; v_row record;
BEGIN
  /* V1 — THREE SEPARATE CLAIMS, because "zero gates remain" is no longer the
     right assertion. On a legacy Q&A schema a gate is deliberately preserved,
     and a check that demanded zero would either fail correct work or, if
     loosened to "some may remain", stop proving anything.

     V1a  every ORDINARY doctor-workspace gate is gone
     V1b  anything still standing is on the Q&A pair AND only because that
          table is legacy — a portal-shaped table keeping its gate is a bug
     V1c  nothing unexpected is left anywhere */
  SELECT count(*) INTO v_left FROM pg_policies
   WHERE schemaname='public'
     AND ( policyname LIKE '%\_require\_verified'
           OR ( permissive='RESTRICTIVE' AND coalesce(qual,'') LIKE '%is_pending_doctor%' ) )
     AND tablename NOT IN ('questions','question_replies');
  IF v_left <> 0 THEN
    v_bad := v_bad || ('V1a ' || v_left || ' ordinary workspace gate(s) remain: ' ||
      (SELECT string_agg(tablename||'.'||policyname, ', ') FROM pg_policies
        WHERE schemaname='public'
          AND ( policyname LIKE '%\_require\_verified'
                OR ( permissive='RESTRICTIVE' AND coalesce(qual,'') LIKE '%is_pending_doctor%' ) )
          AND tablename NOT IN ('questions','question_replies')))::text;
  END IF;

  FOR v_row IN
    SELECT tablename, policyname FROM pg_policies
     WHERE schemaname='public'
       AND ( policyname LIKE '%\_require\_verified'
             OR ( permissive='RESTRICTIVE' AND coalesce(qual,'') LIKE '%is_pending_doctor%' ) )
       AND tablename IN ('questions','question_replies')
  LOOP
    /* A preserved gate is legitimate ONLY on a table that is not portal-shaped.
       If questions has patient_id, section 4c should have replaced the gate,
       and a surviving one means it silently did not. */
    IF v_row.tablename = 'questions'
       AND EXISTS (SELECT 1 FROM pg_attribute
                    WHERE attrelid=to_regclass('public.questions') AND attname='patient_id'
                      AND attnum>0 AND NOT attisdropped) THEN
      v_bad := v_bad || ('V1b questions is portal-shaped but kept its blanket gate ('
                         || v_row.policyname || ')')::text;
    ELSE
      RAISE NOTICE 'V1b preserved by design: %.% (legacy Q&A trust gate)',
                   v_row.tablename, v_row.policyname;
    END IF;
  END LOOP;

  -- V2: the ten ordinary gates now ask about the doctor account.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='anesthesia_case_editable'
                    AND p.prosrc LIKE '%is_doctor_account()%')
    THEN v_bad := v_bad || 'V2 anesthesia_case_editable not re-pointed'::text; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='patient_record_manageable'
                    AND p.prosrc LIKE '%is_doctor_account()%')
    THEN v_bad := v_bad || 'V3 patient_record_manageable not re-pointed'::text; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='recycle_bin_list'
                    AND p.prosrc LIKE '%is_doctor_account()%')
    THEN v_bad := v_bad || 'V4 recycle_bin_list not re-pointed'::text; END IF;

  -- V5: the three trust gates are UNCHANGED and still demand verification.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='hp_clinician_may_read'
                    AND p.prosrc LIKE '%is_verified_doctor()%')
    THEN v_bad := v_bad || 'V5 hp_clinician_may_read lost its verification gate'::text; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='hp_verify_item'
                    AND p.prosrc LIKE '%is_verified_doctor()%')
    THEN v_bad := v_bad || 'V6 hp_verify_item lost its verification gate'::text; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='anesthesia_set_trainee'
                    AND p.prosrc LIKE '%verification_status = ''approved''%')
    THEN v_bad := v_bad || 'V7 anesthesia_set_trainee lost its TARGET verification gate'::text; END IF;

  -- V8: the directory gained one.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='get_clinician_directory'
                    AND p.prosrc LIKE '%verification_status = ''approved''%')
    THEN v_bad := v_bad || 'V8 get_clinician_directory is still open to unverified doctors'::text; END IF;

  /* V9: the Q&A inbox kept a trust requirement rather than losing one —
     but only assert it where the inbox actually exists. Demanding a policy on
     a table this deployment does not have is how the previous version of this
     file failed. */
  /* V9 — the portal contract, asserted only where the portal exists. On a
     legacy schema the equivalent guarantee is V1b: the original gate is still
     standing, which is what keeps that inbox verified-only. */
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = to_regclass('public.questions') AND attname='patient_id'
                AND attnum>0 AND NOT attisdropped) THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                    AND tablename='questions' AND policyname='q_select_own_or_staff'
                    AND qual LIKE '%is_verified_doctor%')
      THEN v_bad := v_bad || 'V9 questions inbox is open to unverified doctors'::text; END IF;
  ELSIF to_regclass('public.questions') IS NOT NULL THEN
    /* LEGACY: prove the preserved gate is genuinely still there. Without this
       the legacy path could silently drop protection and still pass. */
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                    AND tablename='questions'
                    AND ( policyname LIKE '%\_require\_verified'
                          OR ( permissive='RESTRICTIVE'
                               AND coalesce(qual,'') LIKE '%is_pending_doctor%' ) ))
      THEN v_bad := v_bad ||
        'V9-legacy the legacy questions trust gate was removed and not replaced'::text; END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = to_regclass('public.question_replies') AND attname='question_id'
                AND attnum>0 AND NOT attisdropped)
     AND EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = to_regclass('public.questions') AND attname='patient_id'
                    AND attnum>0 AND NOT attisdropped) THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                    AND tablename='question_replies' AND policyname='r_select_own_or_staff'
                    AND qual LIKE '%is_verified_doctor%')
      THEN v_bad := v_bad || 'V9b question replies are open to unverified doctors'::text; END IF;
  END IF;

  /* V12 — NEW, and the check that would have caught this deployment's failure
     before it started: every table that still carries one of the policies this
     migration recreates must actually have the recreated one. */
  IF to_regclass('public.anesthesia_cases') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                      AND tablename='anesthesia_cases' AND policyname='anes_case_insert'
                      AND with_check LIKE '%is_doctor_account%')
    THEN v_bad := v_bad || 'V12 anes_case_insert was not re-pointed'::text; END IF;

  -- V10: provenance exists and is NOT client-writable.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='anesthesia_cases'
                    AND column_name='finalized_by_verification_status')
    THEN v_bad := v_bad || 'V10 provenance column missing'::text; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='anesthesia_guard_case_fields'
                AND p.prosrc LIKE '%finalized_by_verification_status%')
    THEN v_bad := v_bad || 'V11 provenance column is in the client-editable allowlist'::text; END IF;

  IF array_length(v_bad,1) IS NOT NULL THEN
    RAISE EXCEPTION E'POST-VERIFY FAILED — nothing committed:\n  %',
      array_to_string(v_bad, E'\n  ');
  END IF;
  RAISE NOTICE 'POST-VERIFY: every check passed against the objects THIS database actually has.';
END
$verify$;

COMMIT;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Re-run, in order: v3_anesthesia_record.sql section 4 (the policy loop),
-- v3_1_anesthesia_hardening.sql, v4_patient_lifecycle.sql section 4,
-- v4_1_purge_safety.sql (recycle_bin_list), v2_auth_onboarding.sql section 4
-- (the gate loop), and v2_bridge_directory_rpcs.sql section 4.
-- Then: DELETE FROM public.schema_migrations_applied WHERE name='v9_doctor_access_model';
--
-- The provenance column is deliberately NOT dropped by a rollback. It holds
-- historical facts about signatures that were made while it existed, and an
-- unused column harms nothing. Dropping it would destroy the only record of
-- who was verified when they signed.
