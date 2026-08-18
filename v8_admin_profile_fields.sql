-- ============================================================
-- v8_admin_profile_fields.sql
-- PREPARED FOR REVIEW — NOT APPLIED.
-- ============================================================
--
-- WHAT IS BROKEN
-- --------------
-- v2_auth_onboarding.sql added two columns to public.profiles:
--
--     professional_level    consultant | resident   (CHECK-constrained)
--     medical_university    free text
--
-- and it correctly added both to guard_profiles_self_update()'s self-editable
-- allowlist, so a doctor can set them on role-select.html and change them in
-- settings.html.
--
-- It did NOT add them to admin_update_profile_fields(), whose own allowlist
-- was written earlier, in v2_admin_phase2.sql:358, and still reads:
--
--     full_name, phone, country, hospital, specialty,
--     medical_license_number, bio, city
--
-- The consequence is exact and one-directional: an administrator reviewing a
-- verification request can read a doctor's professional level and awarding
-- university, can see they are wrong, and has no way to correct them. Passing
-- either key raises
--
--     42501  Field(s) professional_level cannot be edited here
--
-- The doctor can fix it themselves — but doing so trips the re-verification
-- rule in guard_profiles_self_update() and sends their approved account back
-- to 'pending', which is the correct rule for a self-service claim and the
-- wrong outcome when an administrator has simply spotted a typo mid-review.
--
-- WHAT THIS CHANGES
-- -----------------
-- Two entries in one allowlist. Nothing else: no policy, no trigger, no grant,
-- no new function, no change to who may call it (admin_assert_target() still
-- runs first and still refuses a non-administrator), and no change to the
-- audit log, which already records before/after for whatever keys are passed.
--
-- WHAT THIS DELIBERATELY DOES NOT CHANGE
-- --------------------------------------
--   email                 belongs to auth.users; editing it here would desync
--                         the sign-in record from the profile.
--   role                  admin_change_role() owns it, and requires a reason.
--   verification_status   admin_set_verification() owns it, and audits it.
--   is_admin              granting platform administration stays a deliberate
--                         database action, not a form field.
--   avatar_url            an admin removing a picture is a moderation action;
--                         it needs its own audited verb and a decision about
--                         whether the storage object is deleted with it. Out
--                         of scope here rather than smuggled in.
--
-- SAFETY
-- ------
-- professional_level is protected by profiles_professional_level_chk, so a bad
-- value is rejected by the constraint rather than stored. The UPDATE below is
-- the same format()-with-%I-from-a-server-side-allowlist pattern already in
-- the function; the column name still never comes from the caller.
--
-- PREREQUISITE: v2_auth_onboarding.sql must be applied (it creates the two
-- columns). The preflight below refuses to run otherwise.
-- ============================================================

BEGIN;

DO $preflight$
DECLARE v_missing text[] := '{}';
BEGIN
  IF to_regproc('public.admin_update_profile_fields') IS NULL THEN
    v_missing := v_missing || 'admin_update_profile_fields() [v2_admin_phase2.sql]'::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='profiles'
                    AND column_name='professional_level') THEN
    v_missing := v_missing || 'profiles.professional_level [v2_auth_onboarding.sql]'::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='profiles'
                    AND column_name='medical_university') THEN
    v_missing := v_missing || 'profiles.medical_university [v2_auth_onboarding.sql]'::text;
  END IF;
  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: prerequisites missing: %', array_to_string(v_missing, ', ');
  END IF;
  RAISE NOTICE 'Preflight OK.';
END
$preflight$;

CREATE OR REPLACE FUNCTION public.admin_update_profile_fields(p_target uuid, p_fields jsonb, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  -- Explicit allowlist. email is deliberately NOT editable here: it would
  -- desync from auth.users, which only the admin-api function can change.
  -- professional_level and medical_university added by v8: they are part of
  -- the file an administrator verifies, so an administrator must be able to
  -- correct them without pushing an approved doctor back into the queue.
  v_allowed text[] := ARRAY['full_name','phone','country','hospital','specialty',
                            'medical_license_number','bio','city',
                            'professional_level','medical_university'];
  v_key text; v_bad text[] := '{}'; v_before jsonb; v_after jsonb := '{}'::jsonb;
BEGIN
  PERFORM public.admin_assert_target(p_target);
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN
    RAISE EXCEPTION 'Fields must be a JSON object' USING ERRCODE = '22023';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_fields) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN v_bad := v_bad || v_key; END IF;
  END LOOP;
  IF array_length(v_bad,1) IS NOT NULL THEN
    RAISE EXCEPTION 'Field(s) % cannot be edited here', array_to_string(v_bad,', ') USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(p) - 'id' INTO v_before FROM public.profiles p WHERE id = p_target;

  FOR v_key IN SELECT jsonb_object_keys(p_fields) LOOP
    -- Column name comes from the allowlist above, never from the caller.
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.profiles'::regclass
                AND a.attname = v_key AND a.attnum > 0 AND NOT a.attisdropped) THEN
      EXECUTE format('UPDATE public.profiles SET %I = $1, updated_at = now() WHERE id = $2', v_key)
        USING NULLIF(btrim(COALESCE(p_fields ->> v_key,'')),''), p_target;
      v_after := v_after || jsonb_build_object(v_key, p_fields ->> v_key);
    END IF;
  END LOOP;

  PERFORM public.admin_log('profile.edit','profile', p_target,
    (SELECT COALESCE(full_name, email) FROM public.profiles WHERE id = p_target),
    (SELECT jsonb_object_agg(k, v_before -> k) FROM jsonb_object_keys(v_after) k),
    v_after, p_reason);
  RETURN jsonb_build_object('ok', true, 'updated', v_after);
END;
$$;

-- CREATE OR REPLACE does not reset privileges, but re-asserting them costs
-- nothing and makes this file safe to run on a database where the phase-2
-- grant DO-block failed partway (which is how the earlier grants went
-- missing — a DO block is one statement, so one bad iteration rolls back the
-- whole group). Stated as two plain statements for exactly that reason.
REVOKE ALL ON FUNCTION public.admin_update_profile_fields(uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_profile_fields(uuid,jsonb,text) TO authenticated;

COMMIT;

-- ============================================================
-- VERIFY (run separately, after commit)
-- ============================================================
--   SELECT prosrc LIKE '%professional_level%' AS has_level,
--          prosrc LIKE '%medical_university%' AS has_university
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.proname='admin_update_profile_fields';
--   -- expect t | t
--
-- Then, in an ADMIN session, against a doctor account you own:
--   SELECT public.admin_update_profile_fields(
--            '<doctor-uuid>'::uuid,
--            '{"professional_level":"consultant"}'::jsonb,
--            'correcting a typo during verification review');
--   -- expect {"ok": true, "updated": {"professional_level": "consultant"}}
--   -- and one new row in admin_audit_log with action='profile.edit'.
--
-- And confirm the doctor's verification_status is UNCHANGED by that edit:
-- admin_update_profile_fields() is SECURITY DEFINER, so
-- guard_profiles_self_update() returns at its current_user check and the
-- re-verification rule never fires.

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Re-run v2_admin_phase2.sql's definition of admin_update_profile_fields()
-- (section 4b). Nothing else in this file needs undoing.
