-- ============================================================
-- Anestheo — QUESTION CONFIDENTIALITY + DOCTOR NOTES RPC
--
-- Three defects found by auditing the live policy set against a faithful
-- local replica of production, with two doctor accounts:
--
--   1. CROSS-DOCTOR QUESTION EXPOSURE.  public.questions is readable by any
--      profile whose role is 'doctor' or 'admin' — not by any treating
--      relationship. Measured: Doctor Two could read a question written by
--      Doctor One's patient. The same role-wide test governs UPDATE, and the
--      question_replies policies (where that table exists). Patient-authored
--      clinical messages are PHI.
--
--   2. DOCTOR NOTES SILENTLY DISCARDED.  patient_surgeries has no doctor
--      UPDATE policy — ps_update is USING (auth.uid() = patient_id). The
--      workspace wrote doctor_notes with a direct table UPDATE, which matched
--      zero rows and returned no error, so the UI reported "Notes saved" while
--      nothing was written.
--
--   3. UNNECESSARY ANON GRANT.  GRANT SELECT ON clinic_patients TO anon, with
--      no anon SELECT policy. Inert today, but an unneeded grant on a table of
--      patient data.
--
-- This migration follows the pattern v2_security_hardening.sql already
-- established for preop_questionnaires and preop_checklist: replace the
-- role-wide predicate with the treating relationship, keep patient self-access,
-- keep admin access through is_platform_admin().
--
-- NO TRIAGE POOL. An earlier draft let any clinician read questions from
-- patients who had no treating doctor, so that such questions could still be
-- answered. That was removed after checking whether the path it protected
-- actually works. It does not:
--
--   ask.html inserts {name, role, topic, question, email}. None of those are
--   columns on public.questions -> ERROR: column "name" does not exist.
--   It also never sets patient_id, so even with correct columns the insert
--   fails q_insert_own's WITH CHECK (auth.uid() = patient_id).
--
-- It is the only question-creating path in the application; no RPC creates one
-- either. So the pool would have widened PHI visibility across every doctor on
-- the platform in exchange for rescuing rows that cannot currently be created.
-- Unclaimed questions are therefore reachable by the patient and by an admin,
-- and by nobody else. A deliberate claim/assign workflow can be designed later;
-- it should not be implied by a policy.
--
-- SAFETY
--   * Idempotent. Every object is dropped-if-exists then recreated.
--   * Transaction-wrapped: a failed assertion rolls the whole thing back.
--   * Defensive about schema. question_replies is ABSENT in production (see the
--     relation contract in v2_admin_phase0.sql) and is handled only if present.
--     Nothing here assumes a column or table that the preflight has not proven.
--   * Weakens nothing. Every policy it writes is strictly narrower than the
--     one it replaces. There is no exception and no widening clause.
--
-- NOT APPLIED TO PRODUCTION BY THIS TASK.
-- ============================================================

BEGIN;

-- ── 0. PREFLIGHT ────────────────────────────────────────────
-- Mandatory: the tables and the admin gate this migration reasons about.
DO $pre$
DECLARE v_missing text[] := '{}';
BEGIN
  IF to_regclass('public.questions')          IS NULL THEN v_missing := v_missing || 'public.questions'::text; END IF;
  IF to_regclass('public.patient_surgeries')  IS NULL THEN v_missing := v_missing || 'public.patient_surgeries'::text; END IF;
  IF to_regclass('public.clinic_patients')    IS NULL THEN v_missing := v_missing || 'public.clinic_patients'::text; END IF;
  IF to_regprocedure('public.is_platform_admin()') IS NULL THEN v_missing := v_missing || 'public.is_platform_admin()'::text; END IF;
  IF to_regprocedure('public.doctor_treats_patient(uuid)') IS NULL THEN
    v_missing := v_missing || 'public.doctor_treats_patient(uuid) — apply v2_security_hardening.sql first'::text;
  END IF;
  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: missing prerequisite(s): %. No changes were made.', array_to_string(v_missing, ', ');
  END IF;
  RAISE NOTICE 'Preflight OK: questions, patient_surgeries, clinic_patients, is_platform_admin(), doctor_treats_patient() all present.';
  RAISE NOTICE 'question_replies: %', COALESCE(to_regclass('public.question_replies')::text, 'ABSENT — its policies will be skipped');
END
$pre$;


-- ── 1. No new helper functions ──────────────────────────────
-- doctor_treats_patient() from v2_security_hardening.sql already expresses the
-- whole authorisation rule, so this migration introduces NO new SECURITY
-- DEFINER surface. An earlier draft added is_staff_doctor() and
-- patient_has_treating_doctor() purely to support the triage pool; with the
-- pool gone they have no callers and are removed below rather than left behind
-- as unused privileged functions.


-- ── 2. questions — SELECT ───────────────────────────────────
--   DROPPED : q_select_own_or_staff  (role='doctor' -> EVERY patient's question)
--   CREATED : q_select_scoped        (patient self | admin | treating doctor)
-- Note the role change: the old policy was TO public, which includes anon.
-- anon has no auth.uid(), so it matched nothing, but the new policies are
-- explicitly TO authenticated so the intent is stated rather than implied.
DROP POLICY IF EXISTS q_select_own_or_staff ON public.questions;
DROP POLICY IF EXISTS q_select_scoped       ON public.questions;
CREATE POLICY q_select_scoped ON public.questions
  FOR SELECT TO authenticated
  USING (
    patient_id = auth.uid()
    OR public.is_platform_admin()
    OR public.doctor_treats_patient(patient_id)
  );

-- ── 3. questions — UPDATE ───────────────────────────────────
--   DROPPED : q_update_staff   (any doctor could change ANY question's status)
--   CREATED : q_update_scoped  (same reach as reading it)
-- A doctor who cannot read a question must not be able to mutate it. The
-- WITH CHECK repeats the USING expression so a row cannot be updated OUT of
-- the caller's visibility.
DROP POLICY IF EXISTS q_update_staff  ON public.questions;
DROP POLICY IF EXISTS q_update_scoped ON public.questions;
CREATE POLICY q_update_scoped ON public.questions
  FOR UPDATE TO authenticated
  USING (
    public.is_platform_admin()
    OR public.doctor_treats_patient(patient_id)
  )
  WITH CHECK (
    public.is_platform_admin()
    OR public.doctor_treats_patient(patient_id)
  );

-- q_insert_own is UNCHANGED: WITH CHECK (auth.uid() = patient_id) is already
-- correct — a patient may only file a question as themselves.


-- ── 4. question_replies — only if the table exists ──────────
-- Production does not currently have this table (see the relation contract in
-- v2_admin_phase0.sql). Where it does exist, its policies carry the same
-- role-wide flaw and are replaced with the same reach as the parent question.
DO $replies$
BEGIN
  IF to_regclass('public.question_replies') IS NULL THEN
    RAISE NOTICE 'question_replies absent — skipped (nothing to fix).';
    RETURN;
  END IF;

  EXECUTE $x$ DROP POLICY IF EXISTS r_select_own_or_staff ON public.question_replies $x$;
  EXECUTE $x$ DROP POLICY IF EXISTS r_select_scoped       ON public.question_replies $x$;
  EXECUTE $x$
    CREATE POLICY r_select_scoped ON public.question_replies
      FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.questions q
         WHERE q.id = question_replies.question_id
           AND ( q.patient_id = auth.uid()
                 OR public.is_platform_admin()
                 OR public.doctor_treats_patient(q.patient_id) )))
  $x$;

  EXECUTE $x$ DROP POLICY IF EXISTS r_insert_participant ON public.question_replies $x$;
  EXECUTE $x$ DROP POLICY IF EXISTS r_insert_scoped      ON public.question_replies $x$;
  EXECUTE $x$
    CREATE POLICY r_insert_scoped ON public.question_replies
      FOR INSERT TO authenticated
      WITH CHECK (author_id = auth.uid() AND EXISTS (
        SELECT 1 FROM public.questions q
         WHERE q.id = question_replies.question_id
           AND ( q.patient_id = auth.uid()
                 OR public.is_platform_admin()
                 OR public.doctor_treats_patient(q.patient_id) )))
  $x$;

  RAISE NOTICE 'question_replies policies replaced (select + insert).';
END
$replies$;


-- ── 5. save_doctor_notes() ──────────────────────────────────
-- Defect 2. Deliberately NOT solved by giving doctors an UPDATE policy on
-- patient_surgeries: that table holds assignment, archive state and the whole
-- clinical record, and a broad policy would expose every column to the client.
-- This RPC can write exactly one column and nothing else.
DROP FUNCTION IF EXISTS public.save_doctor_notes(uuid, text);

CREATE FUNCTION public.save_doctor_notes(p_surgery_id uuid, p_notes text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_row   public.patient_surgeries%ROWTYPE;
  v_admin boolean := false;
  v_found boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_row FROM public.patient_surgeries WHERE id = p_surgery_id;
  v_found := FOUND;

  BEGIN v_admin := public.is_platform_admin(); EXCEPTION WHEN others THEN v_admin := false; END;

  -- ONE message for both "no such record" and "not yours".
  --
  -- Distinguishing them would answer a question the caller is not entitled to
  -- ask: given an arbitrary id, does this surgery exist? Two different errors
  -- turn the function into an existence oracle over other doctors' records.
  -- Surgery ids are UUIDs and therefore hard to guess, but the leak is free to
  -- close and there is no legitimate caller that needs to tell the cases apart.
  --
  -- Rejecting is itself the point: the bug this replaces was an UPDATE that
  -- matched zero rows and reported success, so the doctor believed a note had
  -- been saved when it had not.
  IF NOT (v_found AND (v_row.assigned_doctor_id = v_uid OR v_admin)) THEN
    RAISE EXCEPTION 'You can only edit notes on your own assigned patients'
      USING ERRCODE = '42501';
  END IF;

  -- One column. assigned_doctor_id, patient_id, care_state, the archive fields
  -- and every clinical column are untouchable through this entry point.
  UPDATE public.patient_surgeries
     SET doctor_notes = p_notes,
         updated_at   = now()
   WHERE id = p_surgery_id;

  RETURN now();
END;
$fn$;

REVOKE ALL   ON FUNCTION public.save_doctor_notes(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_doctor_notes(uuid, text) TO authenticated;


-- ── 6. Remove the unnecessary anon grant ────────────────────
-- Every anonymous questionnaire path goes through a SECURITY DEFINER function
-- (get_clinic_patient_by_token, mark_clinic_questionnaire_progress,
-- submit_clinic_questionnaire), which executes as the owner and therefore does
-- not consult the caller's table privileges. Verified: no anon-reachable page
-- reads clinic_patients directly. The grant is dead weight on a table of
-- patient data.
REVOKE SELECT ON public.clinic_patients FROM anon;


-- ── 6b. Remove helpers this migration no longer needs ───────
-- Only relevant to a database where an earlier draft of THIS migration ran and
-- created them. They are dropped after the policies above stopped referencing
-- them, so the dependency is already gone. An unused SECURITY DEFINER function
-- is standing privilege with no purpose, so it does not stay.
DROP FUNCTION IF EXISTS public.patient_has_treating_doctor(uuid);
DROP FUNCTION IF EXISTS public.is_staff_doctor();


-- ── 7. VERIFY BEFORE COMMITTING ─────────────────────────────
DO $verify$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='questions'
     AND policyname IN ('q_select_own_or_staff','q_update_staff');
  IF n > 0 THEN RAISE EXCEPTION 'Verification failed: % role-wide question policy(ies) still present.', n; END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='questions'
     AND policyname IN ('q_select_scoped','q_update_scoped');
  IF n <> 2 THEN RAISE EXCEPTION 'Verification failed: expected 2 scoped question policies, found %.', n; END IF;

  IF to_regprocedure('public.save_doctor_notes(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Verification failed: save_doctor_notes() was not created.';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE table_schema='public' AND table_name='clinic_patients'
                AND grantee='anon' AND privilege_type='SELECT') THEN
    RAISE EXCEPTION 'Verification failed: anon still holds SELECT on clinic_patients.';
  END IF;

  -- The scoped policies must NOT mention a staff-wide or unclaimed clause.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='public' AND tablename IN ('questions','question_replies')
                AND (coalesce(qual,'')||coalesce(with_check,'')) ILIKE '%is_staff_doctor%') THEN
    RAISE EXCEPTION 'Verification failed: a question policy still references the removed triage clause.';
  END IF;
  IF to_regprocedure('public.is_staff_doctor()') IS NOT NULL
     OR to_regprocedure('public.patient_has_treating_doctor(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Verification failed: an unused helper function survived.';
  END IF;

  RAISE NOTICE 'Verified: questions scoped to patient/admin/treating-doctor only; no triage pool; no new SECURITY DEFINER helpers; save_doctor_notes() installed; anon grant removed.';
END
$verify$;

COMMIT;

-- ── ROLLBACK ────────────────────────────────────────────────
-- Restores the previous (leaking) policies exactly as they were. Only for an
-- emergency in which the scoping breaks a workflow that cannot wait for a fix.
-- Re-opens cross-doctor question visibility — do not leave the system here.
--
-- BEGIN;
-- DROP POLICY IF EXISTS q_select_scoped ON public.questions;
-- DROP POLICY IF EXISTS q_update_scoped ON public.questions;
-- CREATE POLICY q_select_own_or_staff ON public.questions FOR SELECT
--   USING (auth.uid() = patient_id OR EXISTS (SELECT 1 FROM public.profiles p
--          WHERE p.id = auth.uid() AND (p.is_admin = true OR p.role = ANY (ARRAY['doctor','admin']))));
-- CREATE POLICY q_update_staff ON public.questions FOR UPDATE
--   USING (EXISTS (SELECT 1 FROM public.profiles p
--          WHERE p.id = auth.uid() AND (p.is_admin = true OR p.role = ANY (ARRAY['doctor','admin']))));
-- GRANT SELECT ON public.clinic_patients TO anon;
-- DROP FUNCTION IF EXISTS public.save_doctor_notes(uuid, text);
-- DROP FUNCTION IF EXISTS public.patient_has_treating_doctor(uuid);
-- COMMIT;
