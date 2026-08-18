-- ============================================================
-- v9_1_doctor_onboarding.sql
-- PREPARED FOR REVIEW — NOT APPLIED.
-- APPLY THIS **BEFORE** v9_doctor_access_model.sql. See DEPLOYMENT ORDER.
-- ============================================================
--
-- WHY THIS COMES FIRST
-- --------------------
-- Today `set_own_role('doctor')` validates the role string, refuses 'admin',
-- refuses admin callers, sets verification_status — and requires NO
-- professional field whatsoever. role-select.html checks eight of them, but
-- that is a browser check:
--
--     await sb.rpc('set_own_role', { p_role: 'doctor' })
--
-- typed into a console produces a doctor account with a completely empty
-- professional file. That was survivable while an administrator reviewed every
-- doctor before the account could do anything. v9 grants the workspace
-- immediately, which removes that backstop — so the enforcement has to move
-- somewhere it cannot be skipped, and it has to be in place BEFORE access is
-- widened, not after.
--
-- WHAT THIS IS NOT
-- ----------------
-- Not a verification step. It requires no uploaded document, no licence scan,
-- no identity proof and no human review. It asks for the eight facts the
-- registration form already asks for, and it asks the SERVER to insist on
-- them. "Become a Verified Clinician" remains a separate, optional flow.
--
-- ATOMICITY IS THE OTHER HALF OF THE POINT
-- ----------------------------------------
-- role-select.html currently calls setOwnRole('doctor') and THEN saveProfile().
-- The ordering is deliberate and right — the privileged call first — but if the
-- second call fails, the account is already a doctor with no details, the page
-- says so honestly, and nothing ever asks again. One function, one transaction:
-- either the account is a doctor with a complete file, or it is unchanged.
-- ============================================================

BEGIN;

DO $preflight$
DECLARE v_missing text[] := '{}';
BEGIN
  IF to_regproc('public.set_own_role') IS NULL THEN
    v_missing := v_missing || 'set_own_role() [v2_security_hardening.sql]'::text; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='profiles'
                    AND column_name='professional_level') THEN
    v_missing := v_missing || 'profiles.professional_level [v2_auth_onboarding.sql]'::text; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='profiles'
                    AND column_name='medical_university') THEN
    v_missing := v_missing || 'profiles.medical_university [v2_auth_onboarding.sql]'::text; END IF;
  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: prerequisites missing: %', array_to_string(v_missing, ', ');
  END IF;
  RAISE NOTICE 'Preflight OK.';
END
$preflight$;

-- ============================================================
-- submit_doctor_onboarding
-- ============================================================
-- SECURITY DEFINER for two reasons, both necessary:
--   1. it writes `role`, which trg_guard_profiles_self_update rejects for the
--      API roles — the same reason set_own_role() is SECURITY DEFINER;
--   2. it must set role and the professional columns in one statement, so
--      there is no window in which one landed and the other did not.
--
-- It answers with a structured jsonb rather than raising on a missing field,
-- because the caller is a form and the useful response is "these four fields
-- are missing", not an exception carrying the first one. Authorization
-- failures DO raise — those are not form problems.
CREATE OR REPLACE FUNCTION public.submit_doctor_onboarding(
  p_full_name          text,
  p_professional_level text,
  p_country            text,
  p_phone              text,
  p_license            text,
  p_hospital           text,
  p_university         text,
  p_specialty          text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_cur     text;
  v_admin   boolean;
  v_verif   text;
  v_missing text[] := '{}';
  v_name    text; v_level text; v_country text; v_phone text;
  v_license text; v_hosp  text; v_uni     text; v_spec  text;
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

  -- Same refusal as set_own_role(): an administrator changing their own role
  -- has to be an audited admin action, not a self-service form.
  IF v_admin OR v_cur = 'admin' THEN
    RAISE EXCEPTION 'Administrator accounts cannot change role here' USING ERRCODE = '42501';
  END IF;

  -- Trim once, use everywhere. '' and '   ' are missing, not present.
  v_name    := NULLIF(btrim(COALESCE(p_full_name,'')),'');
  v_level   := NULLIF(btrim(lower(COALESCE(p_professional_level,''))),'');
  v_country := NULLIF(btrim(COALESCE(p_country,'')),'');
  v_phone   := NULLIF(btrim(COALESCE(p_phone,'')),'');
  v_license := NULLIF(btrim(COALESCE(p_license,'')),'');
  v_hosp    := NULLIF(btrim(COALESCE(p_hospital,'')),'');
  v_uni     := NULLIF(btrim(COALESCE(p_university,'')),'');
  v_spec    := NULLIF(btrim(COALESCE(p_specialty,'')),'');

  IF v_name    IS NULL OR length(v_name) < 2 THEN v_missing := v_missing || 'full_name'::text;              END IF;
  IF v_level   IS NULL                       THEN v_missing := v_missing || 'professional_level'::text;     END IF;
  IF v_country IS NULL                       THEN v_missing := v_missing || 'country'::text;                END IF;
  IF v_phone   IS NULL                       THEN v_missing := v_missing || 'phone'::text;                  END IF;
  IF v_license IS NULL                       THEN v_missing := v_missing || 'medical_license_number'::text; END IF;
  IF v_hosp    IS NULL                       THEN v_missing := v_missing || 'hospital'::text;               END IF;
  IF v_uni     IS NULL                       THEN v_missing := v_missing || 'medical_university'::text;     END IF;
  IF v_spec    IS NULL                       THEN v_missing := v_missing || 'specialty'::text;              END IF;

  IF array_length(v_missing,1) IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'missing_fields',
                              'missing', to_jsonb(v_missing));
  END IF;

  -- professional_level is a closed set and is also CHECK-constrained on the
  -- table. Rejecting it here names the field; leaving it to the constraint
  -- would answer with a constraint name.
  IF v_level NOT IN ('consultant','resident') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_field',
                              'field', 'professional_level',
                              'allowed', jsonb_build_array('consultant','resident'));
  END IF;

  -- The phone is stored as given after trimming. It is a contact detail, not a
  -- credential, and inventing a normaliser here would disagree with the one the
  -- client already applies.

  /* THE VERIFICATION STATUS IS NOT RESET FOR AN ALREADY-VERIFIED DOCTOR.
     Under the new model this RPC is how somebody BECOMES a doctor, and it is
     also reachable by a doctor completing a partial file. If they are already
     approved, sending them back to 'pending' here would be this migration
     re-creating, from a new direction, the exact bug where an approved doctor
     silently loses their status. Any genuine change to a professional-identity
     field is still caught by trg_guard_profiles_self_update, which is
     deliberately left in place and which this function does NOT bypass for
     that purpose — see the note below. */
  IF COALESCE(v_verif,'') = 'approved' AND v_cur = 'doctor' THEN
    v_verif := 'approved';
  ELSE
    v_verif := 'pending';           -- "not verified yet", no longer "blocked"
  END IF;

  UPDATE public.profiles
     SET role                   = 'doctor',
         verification_status    = v_verif,
         full_name              = v_name,
         professional_level     = v_level,
         country                = v_country,
         phone                  = v_phone,
         medical_license_number = v_license,
         hospital               = v_hosp,
         medical_university     = v_uni,
         specialty              = v_spec,
         updated_at             = now()
   WHERE id = v_uid;

  /* NOTE ON THE GUARD TRIGGER. This function is SECURITY DEFINER, so
     guard_profiles_self_update() returns at its current_user check and the
     re-verification rule does not fire here. That is correct for THIS path and
     only this one: onboarding is the moment the professional identity is first
     stated, so there is nothing yet to invalidate. Editing those fields later
     still goes through settings.html as an ordinary self-service UPDATE, where
     the guard fires exactly as before. Nothing about the trigger changes. */

  RETURN jsonb_build_object('ok', true, 'role', 'doctor',
                            'verification_status', v_verif);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_doctor_onboarding(text,text,text,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_doctor_onboarding(text,text,text,text,text,text,text,text) TO authenticated;

-- ============================================================
-- CLOSE THE OLD DOOR
-- ============================================================
-- set_own_role() keeps handling patient / nurse / student / other. It stops
-- accepting 'doctor', because a doctor account with no professional file is no
-- longer something an administrator will catch. The error names the
-- replacement rather than just refusing.
--
-- Everything else in this function is reproduced verbatim from
-- v2_security_hardening.sql:185.
CREATE OR REPLACE FUNCTION public.set_own_role(p_role text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_role  text;
  v_cur   text;
  v_admin boolean;
  v_verif text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  v_role := lower(btrim(COALESCE(p_role,'')));

  IF v_role = 'doctor' THEN
    RAISE EXCEPTION 'Becoming a doctor requires the professional details. Use submit_doctor_onboarding().'
      USING ERRCODE = '22023';
  END IF;

  IF v_role NOT IN ('patient','nurse','student','other') THEN
    RAISE EXCEPTION 'set_own_role: "%" is not a self-selectable role', v_role
      USING ERRCODE = '22023';
  END IF;

  SELECT role, COALESCE(is_admin,false) INTO v_cur, v_admin
    FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_own_role: no profile row for this account' USING ERRCODE = 'P0002';
  END IF;

  IF v_admin OR v_cur = 'admin' THEN
    RAISE EXCEPTION 'Administrator accounts cannot change role here' USING ERRCODE = '42501';
  END IF;

  v_verif := 'not_required';

  UPDATE public.profiles
     SET role = v_role, verification_status = v_verif, updated_at = now()
   WHERE id = v_uid;

  RETURN v_role;
END;
$$;

REVOKE ALL ON FUNCTION public.set_own_role(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_own_role(text) TO authenticated;

-- ============================================================
-- POST-VERIFY
-- ============================================================
DO $verify$
DECLARE v_bad text[] := '{}';
BEGIN
  IF to_regproc('public.submit_doctor_onboarding') IS NULL THEN
    v_bad := v_bad || 'V1 submit_doctor_onboarding missing'::text; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='set_own_role'
                    AND p.prosrc LIKE '%submit_doctor_onboarding%')
    THEN v_bad := v_bad || 'V2 set_own_role still accepts doctor'::text; END IF;
  IF NOT has_function_privilege('authenticated',
        'public.submit_doctor_onboarding(text,text,text,text,text,text,text,text)', 'EXECUTE')
    THEN v_bad := v_bad || 'V3 authenticated cannot execute submit_doctor_onboarding'::text; END IF;
  IF array_length(v_bad,1) IS NOT NULL THEN
    RAISE EXCEPTION E'POST-VERIFY FAILED — nothing committed:\n  %', array_to_string(v_bad, E'\n  ');
  END IF;
  RAISE NOTICE 'POST-VERIFY: all 3 checks passed.';
END
$verify$;

COMMIT;

-- ============================================================
-- ROLLBACK
-- ============================================================
--   DROP FUNCTION IF EXISTS public.submit_doctor_onboarding(text,text,text,text,text,text,text,text);
--   -- then re-run v2_security_hardening.sql section "set_own_role" to restore
--   -- the version that accepts 'doctor'.
-- Do NOT roll this back while v9_doctor_access_model.sql is applied: that
-- combination is a doctor account with no professional file AND immediate
-- workspace access, which is the one state this pair exists to prevent.
