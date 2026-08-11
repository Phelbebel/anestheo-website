-- ============================================================
-- Anestheo — AUTH & ONBOARDING
-- Two-role onboarding (patient / doctor), doctor professional profile,
-- and the server-side gate that makes "pending" actually mean pending.
--
-- WHY THIS EXISTS
--   1. Doctor onboarding collects a professional level and a medical
--      university. Neither column exists, so the form cannot be saved.
--   2. verification_status was, until now, DECORATION. Nothing consulted it:
--      not one RLS policy, and not the client guard. A doctor whose status was
--      'pending' had byte-for-byte the same access as an approved one.
--      Measured before this migration, on a replica of this schema:
--          pending doctor -> SELECT count(*) FROM questions  => 2 rows
--      That is the whole finding. This migration closes it.
--
-- SAFETY: additive, idempotent, transaction-wrapped. It creates no policy that
-- widens access; the only policies added are RESTRICTIVE, which can solely
-- remove access. Rollback at the bottom.
--
-- DEPENDS ON: v2_admin_phase0.sql, v2_security_hardening.sql
-- ============================================================

BEGIN;

-- ============================================================
-- 0. PREFLIGHT
-- ============================================================
-- The protections this migration builds on live in v2_security_hardening.sql:
-- the guard trigger that stops a browser writing role/is_admin/verification_status,
-- and set_own_role(). Without them, gating pending doctors is theatre — anyone
-- could simply UPDATE their own verification_status to 'approved'. Measured on a
-- replica with the hardening dropped, that write succeeds and the row becomes
-- role=admin/is_admin=t/verif=approved. So: refuse to run.
DO $preflight$
DECLARE v_missing text[] := '{}';
BEGIN
  IF to_regproc('public.is_platform_admin') IS NULL THEN
    v_missing := v_missing || 'is_platform_admin() [v2_admin_phase0.sql]'::text; END IF;
  IF to_regproc('public.set_own_role') IS NULL THEN
    v_missing := v_missing || 'set_own_role() [v2_security_hardening.sql]'::text; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guard_profiles_self_update') THEN
    v_missing := v_missing || 'trg_guard_profiles_self_update [v2_security_hardening.sql]'::text; END IF;

  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION E'ABORT: prerequisites missing: %.\n'
      '  Gating pending doctors is meaningless while a browser can still write\n'
      '  verification_status directly. Apply v2_admin_phase0.sql and\n'
      '  v2_security_hardening.sql first, then re-run this file.',
      array_to_string(v_missing, ', ');
  END IF;
  RAISE NOTICE 'Preflight OK — hardening is in place.';
END
$preflight$;

-- ============================================================
-- 1. DOCTOR PROFESSIONAL PROFILE COLUMNS
-- ============================================================
-- Reused as-is, already present: full_name, country, phone, hospital,
-- specialty, medical_license_number. Only these two are genuinely new.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS professional_level text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS medical_university text;

COMMENT ON COLUMN public.profiles.professional_level IS
  'Self-declared seniority: consultant | resident. A CLAIM, not an authorization — verification_status is what grants access.';
COMMENT ON COLUMN public.profiles.medical_university IS
  'Self-declared awarding institution. Free text by design: a closed list would lock out doctors from institutions we have not enumerated.';

-- Constrained rather than free text: this one IS a closed set, and an
-- unconstrained column would quietly accumulate 'Consultant', 'consultant',
-- 'CONSULTANT' and make the admin list unfilterable.
DO $c$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_professional_level_chk') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_professional_level_chk
      CHECK (professional_level IS NULL OR professional_level IN ('consultant','resident'));
  END IF;
END $c$;

-- ============================================================
-- 2. LET DOCTORS ACTUALLY SAVE THOSE TWO FIELDS
-- ============================================================
-- guard_profiles_self_update() is an ALLOWLIST: any column not named is
-- rejected for the API roles. Two new self-editable columns therefore have to
-- be added here, or onboarding fails with 42501 the first time a doctor
-- submits the form. They are self-editable because they are claims about
-- oneself; the privileged trio (role / is_admin / verification_status) stays
-- exactly as protected as before.
CREATE OR REPLACE FUNCTION public.guard_profiles_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_self_editable text[] := ARRAY[
    'full_name','phone','country','hospital','specialty','email',
    'accepting_patients','medical_license_number','avatar_url','bio',
    'city','languages','timezone','created_at','updated_at',
    'professional_level','medical_university'          -- added by v2_auth_onboarding.sql
  ];
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_blocked text[] := '{}';
BEGIN
  IF current_user NOT IN ('authenticated','anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.is_admin := false;
    IF NEW.role IS NULL OR btrim(NEW.role) = '' OR NEW.role = 'admin' THEN
      NEW.role := 'pending';
    END IF;
    NEW.verification_status :=
      CASE WHEN NEW.role = 'doctor' THEN 'pending' ELSE 'not_required' END;
    RETURN NEW;
  END IF;

  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
    IF (v_old ->> v_key) IS DISTINCT FROM (v_new ->> v_key)
       AND NOT (v_key = ANY (v_self_editable)) THEN
      v_blocked := v_blocked || v_key;
    END IF;
  END LOOP;

  IF array_length(v_blocked,1) IS NOT NULL THEN
    RAISE EXCEPTION
      'profiles: % cannot be changed directly. Role changes go through set_own_role(); verification and admin status are set only by an audited admin action.',
      array_to_string(v_blocked, ', ')
      USING ERRCODE = '42501';
  END IF;

  /* ── RE-VERIFICATION ON PROFESSIONAL IDENTITY CHANGE ──────────────────
     Approval is granted against a specific professional identity. Without
     this, a doctor could be verified as one clinician and then quietly become
     another: get approved on a real licence, then edit the licence number,
     name, institution or specialty from settings.html and keep the badge. The
     fields below are self-editable BY DESIGN — they are claims a person makes
     about themselves — but changing them after approval invalidates exactly
     what the administrator checked.

     Set here rather than in a second trigger so there is one guard on this
     table with one order of operations. It runs AFTER the blocked-field check
     above, so this assignment is never mistaken for the caller trying to write
     verification_status themselves — that is still rejected.

     'pending' specifically, not 'changes_requested': the Admin Center's
     verification queue selects on verification_status='pending', so this puts
     them back in the list an administrator already watches. Any other value and
     re-reviews would silently never be seen.

     The access lock is immediate and needs no extra machinery:
     is_pending_doctor() tests for a status that is not exactly 'approved', so
     the RESTRICTIVE policies start denying on the very next statement.

     Admin edits do NOT land here. admin_update_profile_fields() and
     admin_set_verification() are SECURITY DEFINER, so current_user is the owner
     and the guard has already returned at the top. An administrator changing a
     doctor's details is a deliberate, audited act, not a self-service claim. */
  IF TG_OP = 'UPDATE'
     AND OLD.role = 'doctor'
     AND COALESCE(OLD.verification_status,'') = 'approved'
     AND (   OLD.full_name              IS DISTINCT FROM NEW.full_name
          OR OLD.professional_level     IS DISTINCT FROM NEW.professional_level
          OR OLD.medical_license_number IS DISTINCT FROM NEW.medical_license_number
          OR OLD.country                IS DISTINCT FROM NEW.country
          OR OLD.hospital               IS DISTINCT FROM NEW.hospital
          OR OLD.medical_university     IS DISTINCT FROM NEW.medical_university
          OR OLD.specialty              IS DISTINCT FROM NEW.specialty)
  THEN
    /* phone is deliberately NOT in that list. It is how we reach a doctor
       about verification, not evidence of who they are; revoking clinical
       access mid-shift because someone changed a mobile number would be
       friction with no security gain. Nor are email (owned by the auth
       record), avatar_url, bio, city, languages, timezone or
       accepting_patients — none of them is anything an admin verified. */
    NEW.verification_status := 'pending';
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 3. THE VERIFICATION PREDICATES
-- ============================================================
-- SECURITY DEFINER so a policy calling them does not re-enter profiles' own
-- RLS. They disclose nothing: each returns a boolean about the CALLER only.
--
-- is_pending_doctor() is deliberately the negative form, because that is what
-- the restrictive policies need, and because it fails CLOSED: any doctor whose
-- status is not exactly 'approved' — pending, rejected, changes_requested,
-- verification_suspended, NULL, or a state invented later — is gated.
CREATE OR REPLACE FUNCTION public.is_pending_doctor()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid()
       AND COALESCE(p.is_admin, false) = false          -- an admin is never gated
       AND p.role = 'doctor'
       AND COALESCE(p.verification_status, '') <> 'approved'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_verified_doctor()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid()
       AND p.role = 'doctor'
       AND p.verification_status = 'approved'
  );
$$;

-- "Is the caller a doctor account at all?" — independent of approval, because
-- the credential table has to serve doctors who are not yet approved.
CREATE OR REPLACE FUNCTION public.is_doctor_account()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid() AND p.role = 'doctor'
  );
$$;

REVOKE ALL ON FUNCTION public.is_pending_doctor()  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_verified_doctor() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_doctor_account()  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_pending_doctor()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_verified_doctor() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_doctor_account()  TO authenticated;

-- ============================================================
-- 3b. DOCTOR VERIFICATION DOCUMENTS — DOCTORS ONLY
-- ============================================================
-- The phase-3 policies keyed on `doctor_id = auth.uid()` alone. Since that
-- column is only ever compared to the caller's own id, ANY authenticated user
-- satisfied it: a PATIENT could insert rows into the doctor-verification table
-- and read them back. Measured before this change, a patient INSERT returned
-- INSERT 0 1. Nothing downstream trusted those rows, so it was not an
-- escalation — but a patient has no business holding a credential record, and
-- an administrator reviewing the queue should never be shown one.
--
-- The correction is the smallest one that closes it: the same predicates, plus
-- "and you are a doctor". Ownership (doctor_id = auth.uid()) is untouched, so
-- Doctor B still cannot see Doctor A's file, and admins still read everything
-- through is_platform_admin().
--
-- INSERT and DELETE additionally require NOT-yet-approved. Uploading or
-- withdrawing evidence is part of GETTING verified; doing it afterwards would
-- let an approved doctor swap the evidence behind their badge with nobody
-- re-reviewing it. There is deliberately no UPDATE policy at all — an
-- unmodifiable record is the point of an evidence table — so approved doctors
-- keep read access to their own file and nothing more.
DO $dvd$
BEGIN
  IF to_regclass('public.doctor_verification_documents') IS NULL THEN
    RAISE NOTICE '  skip doctor_verification_documents (apply v2_admin_phase3.sql for it)';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS dvd_select ON public.doctor_verification_documents;
  CREATE POLICY dvd_select ON public.doctor_verification_documents
    FOR SELECT TO authenticated
    USING ( (doctor_id = auth.uid() AND public.is_doctor_account())
            OR public.is_platform_admin() );

  DROP POLICY IF EXISTS dvd_insert_own ON public.doctor_verification_documents;
  CREATE POLICY dvd_insert_own ON public.doctor_verification_documents
    FOR INSERT TO authenticated
    WITH CHECK ( doctor_id = auth.uid()
                 AND public.is_doctor_account()
                 AND public.is_pending_doctor() );

  DROP POLICY IF EXISTS dvd_delete_own ON public.doctor_verification_documents;
  CREATE POLICY dvd_delete_own ON public.doctor_verification_documents
    FOR DELETE TO authenticated
    USING ( doctor_id = auth.uid()
            AND public.is_doctor_account()
            AND public.is_pending_doctor()
            AND reviewed_at IS NULL );

  RAISE NOTICE 'doctor_verification_documents: policies narrowed to doctor accounts.';
END
$dvd$;

-- Rows a non-doctor should never have been able to create. Reported, not
-- silently deleted: they are somebody's uploaded file, and a migration that
-- destroys data without saying so is worse than the rows themselves.
DO $orphans$
DECLARE v_n int := 0;
BEGIN
  IF to_regclass('public.doctor_verification_documents') IS NULL THEN RETURN; END IF;
  SELECT count(*) INTO v_n
    FROM public.doctor_verification_documents d
    LEFT JOIN public.profiles p ON p.id = d.doctor_id
   WHERE COALESCE(p.role,'') <> 'doctor';
  IF v_n > 0 THEN
    RAISE NOTICE 'NOTE: % verification document(s) belong to non-doctor accounts.', v_n;
    RAISE NOTICE '      They are now unreachable by their owner. Review, then delete deliberately.';
  END IF;
END
$orphans$;

-- ============================================================
-- 4. THE GATE
-- ============================================================
-- 28 existing policies across 13 tables grant access on the basis of
-- role='doctor' alone. Rewriting all 28 would mean transcribing 28 predicates
-- correctly, and any slip would silently WIDEN access.
--
-- A RESTRICTIVE policy is ANDed with whatever permissive policies exist, so one
-- per table expresses "…and you must not be an unverified doctor" without
-- touching a single existing predicate. It can only ever remove access, never
-- grant it. For every other caller — patient, admin, approved doctor — the
-- predicate is false and the policy is a no-op.
--
-- NOT gated, deliberately:
--   profiles                       a pending doctor must read and edit their own row
--   doctor_verification_documents  they must be able to UPLOAD their credentials;
--                                  gating that is the circular lockout where you
--                                  cannot get verified without being verified
DO $gate$
DECLARE
  v_tables text[] := ARRAY[
    'care_requests','clinic_patients','patient_archive_audit',
    'patient_recommendations','patient_surgeries','preop_checklist',
    'preop_questionnaires','preparation_plans','question_replies',
    'questions','questionnaire_templates','requirement_documents'
  ];
  t text;
  v_applied int := 0;
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE NOTICE '  skip % (table not present in this database)', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_require_verified', t);
    EXECUTE format($p$
      CREATE POLICY %I ON public.%I
        AS RESTRICTIVE FOR ALL TO authenticated
        USING ( NOT public.is_pending_doctor() )
        WITH CHECK ( NOT public.is_pending_doctor() )
    $p$, t || '_require_verified', t);
    v_applied := v_applied + 1;
  END LOOP;
  RAISE NOTICE 'Verification gate applied to % table(s).', v_applied;
END
$gate$;

-- ============================================================
-- 5. WHO THIS AFFECTS — READ THIS BEFORE COMMITTING
-- ============================================================
-- Secure by default: this migration does NOT approve anybody. Any existing
-- doctor sitting on a non-approved status loses workspace access the moment it
-- commits, and that is the correct default — until now the status was never
-- enforced, so 'pending' may well describe real, working clinicians.
--
-- The count below tells you whether that is nobody or your entire doctor base.
-- If those accounts are legitimate, approve them deliberately (they are then
-- audited like any other verification decision):
--
--     SELECT public.admin_set_verification(id, 'approved')
--       FROM public.profiles
--      WHERE role = 'doctor' AND COALESCE(verification_status,'') <> 'approved';
--
-- Run that as an admin session. Do not shortcut it with a bare UPDATE: the
-- guard trigger will reject it, and you would lose the audit-log entry.
DO $impact$
DECLARE r record; v_total int := 0;
BEGIN
  RAISE NOTICE '--- Doctors by verification status -----------------------';
  FOR r IN
    SELECT COALESCE(verification_status,'(null)') AS st, count(*) AS n
      FROM public.profiles WHERE role = 'doctor' GROUP BY 1 ORDER BY 2 DESC
  LOOP
    RAISE NOTICE '  % %', rpad(r.st, 24), r.n;
    IF r.st <> 'approved' THEN v_total := v_total + r.n; END IF;
  END LOOP;
  RAISE NOTICE '----------------------------------------------------------';
  IF v_total > 0 THEN
    RAISE NOTICE 'WARNING: % doctor account(s) will LOSE workspace access on commit.', v_total;
    RAISE NOTICE 'If they are legitimate, run the admin_set_verification statement above.';
  ELSE
    RAISE NOTICE 'No doctor loses access: every doctor account is already approved.';
  END IF;
END
$impact$;

COMMIT;

-- ============================================================
-- VERIFY (run separately, after commit)
-- ============================================================
--   SELECT to_regproc('public.is_pending_doctor')  IS NOT NULL AS gate_fn,
--          count(*) FILTER (WHERE policyname LIKE '%_require_verified') AS gate_policies
--     FROM pg_policies WHERE schemaname='public';
--   -- expect gate_fn = true, gate_policies = 12
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='profiles'
--      AND column_name IN ('professional_level','medical_university');
--   -- expect 2 rows

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Removes the gate and returns to the previous (ungated) behaviour. The two
-- columns are left in place: dropping them would destroy submitted doctor
-- applications, and an unused column harms nothing.
--
-- DO $r$ DECLARE t text; BEGIN
--   FOREACH t IN ARRAY ARRAY['care_requests','clinic_patients','patient_archive_audit',
--     'patient_recommendations','patient_surgeries','preop_checklist','preop_questionnaires',
--     'preparation_plans','question_replies','questions','questionnaire_templates',
--     'requirement_documents'] LOOP
--     IF to_regclass('public.'||quote_ident(t)) IS NOT NULL THEN
--       EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_require_verified', t);
--     END IF;
--   END LOOP;
-- END $r$;
-- DROP FUNCTION IF EXISTS public.is_pending_doctor();
-- DROP FUNCTION IF EXISTS public.is_verified_doctor();
-- -- and re-apply v2_security_hardening.sql to restore the previous allowlist.
