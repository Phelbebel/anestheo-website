-- ============================================================
-- v9_3_doctor_account_separation.sql
-- PREPARED FOR REVIEW — NOT APPLIED.
-- Apply AFTER v9_1_doctor_onboarding.sql.
-- ============================================================
--
-- WHAT THIS CHANGES
-- -----------------
-- Today, becoming a doctor and stating your professional file are the same
-- act. submit_doctor_onboarding() writes role='doctor' only when all eight
-- professional fields are present, and set_own_role() refuses 'doctor'
-- outright. So there is no way to hold a doctor account that has not yet
-- produced a licence number, a hospital, a university and a specialty.
--
-- This adds ONE function, create_doctor_account(full_name), which writes
-- role='doctor' + verification_status='pending' from a name alone. The
-- professional file then arrives later, through the function that already
-- exists, at the point where somebody asks to be verified.
--
-- IT CHANGES NOTHING ELSE.
--   · submit_doctor_onboarding() is untouched. It still requires all eight
--     fields and it is still the only way any of them are written. It is now
--     the verification step rather than the registration step.
--   · set_own_role() is untouched. It still refuses 'doctor'.
--   · No policy, no RLS predicate, no trigger, no grant to anon.
--   · is_verified_doctor() and everything keyed on it are untouched, so every
--     patient-facing surface stays exactly as gated as it is today.
--
-- ── DEPLOYMENT ORDER. THIS MATTERS. ────────────────────────────────────────
--
--   1. v9_4_access_state_inventory.sql   read only. Run it, read the output.
--   2. v9_5_verification_boundary.sql    establishes what a doctor account is
--                                        allowed to be.
--   3. THIS FILE                         makes doctor accounts easy to create.
--
-- An earlier version of this header warned that after this file "anyone who
-- can register can hold a doctor account, and a doctor account opens patients,
-- charts, archive and delete with no professional claim on file". That warning
-- was accurate about a world in which v9_doctor_access_model.sql had removed
-- the verification gate from all 33 tables, and it was the right thing to say
-- while that was the only other migration in play.
--
-- v9_5 removes the condition the warning depended on. After v9_5 a doctor
-- account opens the clinician product - Live Tools, references, education, and
-- Live Chart for a case with no patient attached - and nothing patient-facing.
-- The patient-management layer stays behind verification_status='approved',
-- which only an administrator sets and which this function never sets.
--
-- So the trade is no longer "easy registration in exchange for open patient
-- data". It is easy registration into a product that has a boundary. Applying
-- THIS file before v9_5 would recreate the old warning for real, which is why
-- the order above is not a suggestion.
--
-- If v9_5 has not been applied, do not apply this file; the frontend degrades
-- to the current eight-field registration on its own when the function below
-- is absent, and that eight-field form is the only thing currently standing
-- between a stranger and a doctor account.
-- ============================================================

BEGIN;

DO $preflight$
DECLARE v_missing text[] := '{}';
BEGIN
  IF to_regproc('public.submit_doctor_onboarding') IS NULL THEN
    v_missing := v_missing || 'submit_doctor_onboarding() [v9_1_doctor_onboarding.sql]'::text; END IF;
  /* The boundary has to exist before the door is widened. Checked by catalog
     rather than trusted to a runbook: this function is the one thing that
     makes an unverified doctor account cheap to create, and it must not be
     cheap to create until being one means something bounded. */
  IF to_regproc('public.anesthesia_case_unlinked') IS NULL THEN
    v_missing := v_missing || 'anesthesia_case_unlinked() [v9_5_verification_boundary.sql - APPLY IT FIRST]'::text; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='profiles'
                    AND column_name='verification_status') THEN
    v_missing := v_missing || 'profiles.verification_status [v2_auth_onboarding.sql]'::text; END IF;
  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: prerequisites missing: %', array_to_string(v_missing, ', ');
  END IF;
  RAISE NOTICE 'Preflight OK.';
END
$preflight$;

-- ============================================================
-- create_doctor_account
-- ============================================================
-- SECURITY DEFINER for the same single reason set_own_role() is: it writes
-- `role`, which trg_guard_profiles_self_update rejects for the API roles.
--
-- It returns jsonb rather than raising on a short name, because the caller is
-- a form and "your name is missing" is a form answer. Authorization failures
-- still raise — those are not form problems.
CREATE OR REPLACE FUNCTION public.create_doctor_account(p_full_name text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_cur   text;
  v_admin boolean;
  v_verif text;
  v_name  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT role, COALESCE(is_admin,false), verification_status
    INTO v_cur, v_admin, v_verif
    FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No profile row for this account' USING ERRCODE = 'P0002';
  END IF;

  -- The same refusal as set_own_role() and submit_doctor_onboarding(). An
  -- administrator changing their own role is an audited admin action, never a
  -- self-service form.
  IF v_admin OR v_cur = 'admin' THEN
    RAISE EXCEPTION 'Administrator accounts cannot change role here' USING ERRCODE = '42501';
  END IF;

  v_name := NULLIF(btrim(COALESCE(p_full_name,'')),'');
  IF v_name IS NULL OR length(v_name) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'missing_fields',
                              'missing', to_jsonb(ARRAY['full_name']::text[]));
  END IF;

  /* AN APPROVED DOCTOR IS NEVER SENT BACK TO PENDING. Reachable by a doctor
     who already has a file — re-running registration must not cost somebody
     their verification. This is the same rule, for the same reason, as the one
     in submit_doctor_onboarding(). */
  IF COALESCE(v_verif,'') = 'approved' AND v_cur = 'doctor' THEN
    v_verif := 'approved';
  ELSE
    v_verif := 'pending';
  END IF;

  /* ONLY role, verification_status AND full_name ARE WRITTEN.
     The professional columns are deliberately absent from this UPDATE rather
     than set to NULL. A patient who already gave us a country and a phone, or
     a doctor returning to a partly-completed file, keeps what is on record;
     the verification step then fills the rest. Blanking them here would make
     this function destructive in a way nothing about it announces. */
  UPDATE public.profiles
     SET role                = 'doctor',
         verification_status = v_verif,
         full_name           = v_name,
         updated_at          = now()
   WHERE id = v_uid;

  RETURN jsonb_build_object('ok', true, 'role', 'doctor',
                            'verification_status', v_verif);
END;
$$;

REVOKE ALL ON FUNCTION public.create_doctor_account(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_doctor_account(text) TO authenticated;

DO $verify$
BEGIN
  RAISE NOTICE 'create_doctor_account() present : %',
    (to_regproc('public.create_doctor_account') IS NOT NULL);
  RAISE NOTICE 'submit_doctor_onboarding() intact: %',
    (to_regproc('public.submit_doctor_onboarding') IS NOT NULL);
END
$verify$;

COMMIT;

-- ROLLBACK, should the trade above turn out to be the wrong one:
--   DROP FUNCTION IF EXISTS public.create_doctor_account(text);
-- The frontend detects its absence and falls back to eight-field registration,
-- so dropping it restores today's behaviour without a deploy.
