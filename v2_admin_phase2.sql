-- ============================================================
-- Anestheo /v2 — ADMIN CENTER, PHASE 2
-- Account lifecycle + audited moderation RPCs.
--
--   Active -> Suspended -> Banned -> Soft deleted -> Permanently deleted
--
-- Contents
--   0. Preflight (requires Phase 0 AND the security hardening)
--   1. Lifecycle columns on public.profiles
--   2. Soft-delete / archive columns on public.care_requests
--   3. account_is_active() + enforcement in is_platform_admin(),
--      doctor_treats_patient() and the clinician directory
--   4. Moderation RPCs (verify, role, profile fields, assignment)
--   5. Lifecycle RPCs (status, soft delete, restore, permanent purge)
--   6. Consultation-request RPCs
--
-- Every RPC: assert_admin() first, fixed search_path, explicit column
-- allowlists, validated state transitions, a reason where it matters, and an
-- admin_log() entry. No RPC accepts a table name or arbitrary SQL.
--
-- SAFETY: additive, transaction-wrapped, idempotent. Nothing is hard-deleted
-- except by admin_purge_account(), which requires a server-validated typed
-- confirmation. Rollback at the bottom.
--
-- DEPENDS ON (preflight aborts otherwise):
--   v2_admin_phase0.sql        is_platform_admin(), assert_admin(), admin_log()
--   v2_security_hardening.sql  trg_guard_profiles_self_update, doctor_treats_patient()
--
-- The dependency on the hardening migration is not cosmetic: the guard trigger
-- uses an ALLOWLIST of self-editable columns, so every lifecycle column added
-- below is protected from the API roles the moment it exists. Without it a
-- banned user could simply set their own account_status back to 'active'.
-- ============================================================

BEGIN;

-- ============================================================
-- 0. PREFLIGHT
-- ============================================================
CREATE OR REPLACE FUNCTION pg_temp.p2_has(p_rel text, p_cols text[] DEFAULT '{}')
RETURNS boolean LANGUAGE sql STABLE AS $p2$
  SELECT to_regclass(p_rel) IS NOT NULL
     AND NOT EXISTS (
           SELECT 1 FROM unnest(COALESCE(p_cols,'{}'::text[])) AS c(name)
            WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                               WHERE a.attrelid = to_regclass(p_rel)
                                 AND a.attname = c.name AND a.attnum > 0
                                 AND NOT a.attisdropped));
$p2$;

DO $pre$
DECLARE v_missing text[] := '{}';
BEGIN
  IF to_regproc('public.is_platform_admin') IS NULL THEN v_missing := v_missing || 'is_platform_admin()'::text; END IF;
  IF to_regproc('public.assert_admin')      IS NULL THEN v_missing := v_missing || 'assert_admin()'::text; END IF;
  IF to_regproc('public.admin_log')         IS NULL THEN v_missing := v_missing || 'admin_log()'::text; END IF;
  IF to_regproc('public.doctor_treats_patient') IS NULL THEN v_missing := v_missing || 'doctor_treats_patient()'::text; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_guard_profiles_self_update') THEN
    v_missing := v_missing || 'trg_guard_profiles_self_update'::text; END IF;
  IF NOT pg_temp.p2_has('public.profiles', ARRAY['id','role','is_admin','verification_status']) THEN
    v_missing := v_missing || 'public.profiles core columns'::text; END IF;

  RAISE NOTICE '--- Admin Phase 2 preflight -------------------------------';
  RAISE NOTICE 'care_requests present   : %', (to_regclass('public.care_requests') IS NOT NULL);
  RAISE NOTICE 'patient_surgeries present: %', (to_regclass('public.patient_surgeries') IS NOT NULL);
  RAISE NOTICE 'clinician directory RPC : %', (to_regproc('public.get_clinician_directory') IS NOT NULL);
  RAISE NOTICE 'MISSING DEPENDENCIES    : %', COALESCE(array_to_string(v_missing,', '),'(none)');
  RAISE NOTICE '----------------------------------------------------------';

  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: apply v2_admin_phase0.sql and v2_security_hardening.sql first. Missing: %',
      array_to_string(v_missing,', ');
  END IF;
END
$pre$;

-- ============================================================
-- 1. LIFECYCLE COLUMNS — public.profiles
-- ============================================================
-- account_status is the lifecycle. verification_status stays what it always
-- was (a doctor credential state) and is NOT merged into it.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS suspended_at   timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspend_reason text,
  ADD COLUMN IF NOT EXISTS banned_at      timestamptz,
  ADD COLUMN IF NOT EXISTS banned_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ban_reason     text,
  ADD COLUMN IF NOT EXISTS ban_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at     timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_reason  text;

DO $c$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profiles_account_status_chk') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_account_status_chk
      CHECK (account_status IN ('active','suspended','banned','deleted'));
  END IF;
END $c$;

CREATE INDEX IF NOT EXISTS idx_profiles_account_status ON public.profiles(account_status);
CREATE INDEX IF NOT EXISTS idx_profiles_deleted_at     ON public.profiles(deleted_at);

-- ============================================================
-- 2. SOFT DELETE / ARCHIVE — public.care_requests
-- ============================================================
-- The existing status CHECK is ('requested','accepted','declined','revoked',
-- 'closed'). No status is invented: "mark completed" is 'closed', "reject" is
-- 'declined'. Archive and soft delete are separate timestamps.
DO $cr$ BEGIN
  IF to_regclass('public.care_requests') IS NOT NULL THEN
    EXECUTE $q$
      ALTER TABLE public.care_requests
        ADD COLUMN IF NOT EXISTS archived_at   timestamptz,
        ADD COLUMN IF NOT EXISTS archived_by   uuid,
        ADD COLUMN IF NOT EXISTS deleted_at    timestamptz,
        ADD COLUMN IF NOT EXISTS deleted_by    uuid,
        ADD COLUMN IF NOT EXISTS delete_reason text $q$;
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_care_requests_deleted ON public.care_requests(deleted_at)';
    RAISE NOTICE 'care_requests: soft-delete/archive columns present.';
  ELSE
    RAISE NOTICE 'care_requests absent - consultation-request moderation skipped.';
  END IF;
END $cr$;

-- ============================================================
-- 3. ENFORCEMENT
-- ============================================================
-- One predicate answers "may this account act at all?". An expired ban stops
-- blocking by itself, which is what an expiry date is for.
CREATE OR REPLACE FUNCTION public.account_is_active(p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_user
       AND p.deleted_at IS NULL
       AND ( p.account_status = 'active'
             OR (p.account_status = 'banned'
                 AND p.ban_expires_at IS NOT NULL
                 AND p.ban_expires_at <= now()) )
  );
$$;
REVOKE ALL ON FUNCTION public.account_is_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_is_active(uuid) TO authenticated;

-- A suspended, banned or deleted administrator is not an administrator.
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid()
       AND ( (to_jsonb(p) ->> 'is_admin') = 'true' OR (to_jsonb(p) ->> 'role') = 'admin' )
       AND (to_jsonb(p) ->> 'deleted_at') IS NULL
       AND ( COALESCE(to_jsonb(p) ->> 'account_status','active') = 'active'
             OR ( (to_jsonb(p) ->> 'account_status') = 'banned'
                  AND (to_jsonb(p) ->> 'ban_expires_at') IS NOT NULL
                  AND (to_jsonb(p) ->> 'ban_expires_at')::timestamptz <= now() ) )
  );
$$;

-- A suspended or banned clinician loses clinical read access immediately.
-- Rebuilt from whichever treating relationships exist, exactly as the
-- hardening migration did, plus the caller-active gate.
DO $dt$
DECLARE v_parts text[] := '{}'; v_sql text;
BEGIN
  IF pg_temp.p2_has('public.patient_surgeries', ARRAY['patient_id','assigned_doctor_id']) THEN
    v_parts := v_parts || $c1$
    EXISTS (SELECT 1 FROM public.patient_surgeries s
             WHERE s.patient_id = p_patient AND s.assigned_doctor_id = auth.uid())$c1$::text;
  END IF;
  IF pg_temp.p2_has('public.care_requests', ARRAY['patient_id','doctor_id','status']) THEN
    v_parts := v_parts || $c2$
    EXISTS (SELECT 1 FROM public.care_requests r
             WHERE r.patient_id = p_patient AND r.doctor_id = auth.uid()
               AND r.status IN ('accepted','closed')
               AND r.deleted_at IS NULL)$c2$::text;
  END IF;
  IF pg_temp.p2_has('public.clinic_patients', ARRAY['auth_user_id','doctor_id']) THEN
    v_parts := v_parts || $c3$
    EXISTS (SELECT 1 FROM public.clinic_patients c
             WHERE c.auth_user_id = p_patient AND c.doctor_id = auth.uid())$c3$::text;
  END IF;
  IF array_length(v_parts,1) IS NULL THEN
    RAISE EXCEPTION 'ABORT: no treating relationship available; refusing to rebuild doctor_treats_patient().';
  END IF;

  v_sql := $hd$
CREATE OR REPLACE FUNCTION public.doctor_treats_patient(p_patient uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT p_patient IS NOT NULL AND auth.uid() IS NOT NULL
     AND public.account_is_active(auth.uid())
     AND (
$hd$ || array_to_string(v_parts, E'\n    OR') || $ft$
  );
$fn$;
$ft$;
  EXECUTE v_sql;
  RAISE NOTICE 'doctor_treats_patient() rebuilt with % relationship(s) + active-account gate.', array_length(v_parts,1);
END
$dt$;

-- Suspended, banned and soft-deleted clinicians disappear from the
-- patient-facing directory.
--
-- CONTRACT: the existing function returns TABLE (id uuid, name text,
-- specialty text, clinic text) and patient-dashboard.html reads exactly
-- d.id / d.name / d.specialty / d.clinic. CREATE OR REPLACE cannot change a
-- return type, so the signature and the output column NAMES are reproduced
-- byte-for-byte from v2_bridge_directory_rpcs.sql. Only the WHERE clause
-- gains the lifecycle predicate.
--
-- DELIBERATELY NOT CHANGED: the canonical function does not filter on
-- verification_status, so unverified doctors who opted into the directory are
-- listed today. Adding that filter here would be a silent patient-facing
-- product change riding inside an account-lifecycle migration. It is left
-- exactly as it is and raised separately as a product decision.
--
-- Also preserved: admins who opted in (role='doctor' OR is_admin=true), the
-- display_name/clinic_name COALESCE fallbacks, and the absence of ORDER BY.
DO $dir$
DECLARE
  v_ret text;
  v_expected constant text := 'TABLE(id uuid, name text, specialty text, clinic text)';
  v_name_expr text;
  v_clinic_expr text;
BEGIN
  IF to_regproc('public.get_clinician_directory') IS NULL THEN
    RAISE NOTICE 'get_clinician_directory() absent - nothing to rebuild.';
    RETURN;
  END IF;
  IF NOT pg_temp.p2_has('public.profiles', ARRAY['accepting_patients']) THEN
    RAISE NOTICE 'get_clinician_directory() not rebuilt (profiles.accepting_patients missing).';
    RETURN;
  END IF;

  -- Refuse to touch a function whose contract is not the one we know. Skipping
  -- is always safer than aborting the whole migration on a signature surprise.
  SELECT pg_get_function_result(p.oid) INTO v_ret
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_clinician_directory';
  IF v_ret IS DISTINCT FROM v_expected THEN
    RAISE NOTICE 'get_clinician_directory() NOT rebuilt - unexpected return type %. '
                 'Lifecycle filtering for the directory was skipped; review manually.', v_ret;
    RETURN;
  END IF;

  -- Reproduce the canonical projection, degrading only if a column is absent.
  v_name_expr := CASE WHEN pg_temp.p2_has('public.profiles', ARRAY['display_name'])
                      THEN $x$COALESCE(NULLIF(p.display_name,''), p.full_name, 'Clinician')$x$
                      ELSE $x$COALESCE(p.full_name, 'Clinician')$x$ END;
  v_clinic_expr := CASE WHEN pg_temp.p2_has('public.profiles', ARRAY['clinic_name'])
                        THEN $x$COALESCE(NULLIF(p.clinic_name,''), p.hospital)$x$
                        ELSE $x$p.hospital$x$ END;

  EXECUTE
    'CREATE OR REPLACE FUNCTION public.get_clinician_directory()' ||
    ' RETURNS TABLE (id uuid, name text, specialty text, clinic text)' ||
    ' LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp' ||
    ' AS $fn$' ||
    '   SELECT p.id,' ||
    '          ' || v_name_expr || ' AS name,' ||
    '          p.specialty,' ||
    '          ' || v_clinic_expr || ' AS clinic' ||
    '     FROM public.profiles p' ||
    '    WHERE p.accepting_patients = true' ||
    '      AND (p.role = ''doctor'' OR p.is_admin = true)' ||
    '      AND p.deleted_at IS NULL' ||
    '      AND COALESCE(p.account_status, ''active'') = ''active''' ||
    ' $fn$;';

  REVOKE ALL ON FUNCTION public.get_clinician_directory() FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.get_clinician_directory() TO authenticated;
  RAISE NOTICE 'get_clinician_directory() rebuilt: same 4-column contract, now excludes '
               'suspended/banned/deleted clinicians. Verification filtering deliberately unchanged.';
END
$dir$;

-- ============================================================
-- 4. MODERATION RPCs
-- ============================================================
-- Shared guard: admin only, target must exist, never act on yourself, and
-- never act on another administrator from the Admin Center.
CREATE OR REPLACE FUNCTION public.admin_assert_target(p_target uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_admin boolean; v_role text;
BEGIN
  PERFORM public.assert_admin();
  IF p_target IS NULL THEN
    RAISE EXCEPTION 'Target account is required' USING ERRCODE = '22023';
  END IF;
  IF p_target = auth.uid() THEN
    RAISE EXCEPTION 'You cannot perform this action on your own account' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(is_admin,false), role INTO v_admin, v_role
    FROM public.profiles WHERE id = p_target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No profile with id %', p_target USING ERRCODE = 'P0002';
  END IF;
  IF v_admin OR v_role = 'admin' THEN
    RAISE EXCEPTION 'Administrator accounts cannot be modified from the Admin Center' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_assert_target(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assert_target(uuid) TO authenticated;

-- 4a. Doctor verification -----------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_verification(p_target uuid, p_state text, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_before text; v_role text;
BEGIN
  PERFORM public.admin_assert_target(p_target);
  IF p_state NOT IN ('approved','pending','rejected') THEN
    RAISE EXCEPTION 'Verification state "%" is not allowed', p_state USING ERRCODE = '22023';
  END IF;
  SELECT verification_status, role INTO v_before, v_role FROM public.profiles WHERE id = p_target;
  IF COALESCE(v_role,'') <> 'doctor' THEN
    RAISE EXCEPTION 'Verification applies to doctor accounts only' USING ERRCODE = '22023';
  END IF;
  IF p_state IN ('rejected') AND NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to reject verification' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles SET verification_status = p_state, updated_at = now() WHERE id = p_target;

  PERFORM public.admin_log(
    CASE p_state WHEN 'approved' THEN 'doctor.verify'
                 WHEN 'pending'  THEN 'doctor.unverify'
                 ELSE 'doctor.reject' END,
    'profile', p_target,
    (SELECT COALESCE(full_name, email) FROM public.profiles WHERE id = p_target),
    jsonb_build_object('verification_status', v_before),
    jsonb_build_object('verification_status', p_state),
    p_reason);
  RETURN jsonb_build_object('ok', true, 'verification_status', p_state);
END;
$$;

-- 4b. Safe profile fields ------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_profile_fields(p_target uuid, p_fields jsonb, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  -- Explicit allowlist. email is deliberately NOT editable here: it would
  -- desync from auth.users, which only the admin-api function can change.
  v_allowed text[] := ARRAY['full_name','phone','country','hospital','specialty',
                            'medical_license_number','bio','city'];
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

-- 4c. Role change ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_change_role(p_target uuid, p_role text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_before text;
BEGIN
  PERFORM public.admin_assert_target(p_target);
  IF p_role NOT IN ('patient','doctor','nurse','student','other') THEN
    RAISE EXCEPTION 'Role "%" cannot be assigned here. Granting administrator is a deliberate database action.', p_role
      USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to change a role' USING ERRCODE = '22023';
  END IF;
  SELECT role INTO v_before FROM public.profiles WHERE id = p_target;

  UPDATE public.profiles
     SET role = p_role,
         verification_status = CASE WHEN p_role='doctor' THEN 'pending' ELSE 'not_required' END,
         updated_at = now()
   WHERE id = p_target;

  PERFORM public.admin_log('profile.role_change','profile', p_target,
    (SELECT COALESCE(full_name, email) FROM public.profiles WHERE id = p_target),
    jsonb_build_object('role', v_before), jsonb_build_object('role', p_role), p_reason);
  RETURN jsonb_build_object('ok', true, 'role', p_role);
END;
$$;

-- 4d. Assignment ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_assign_doctor(p_surgery uuid, p_doctor uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_before uuid; v_name text;
BEGIN
  PERFORM public.assert_admin();
  IF to_regclass('public.patient_surgeries') IS NULL THEN
    RAISE EXCEPTION 'patient_surgeries is not available' USING ERRCODE = '42P01';
  END IF;
  SELECT assigned_doctor_id, patient_name INTO v_before, v_name
    FROM public.patient_surgeries WHERE id = p_surgery;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No journey with id %', p_surgery USING ERRCODE = 'P0002';
  END IF;
  IF p_doctor IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_doctor
                    AND role = 'doctor' AND deleted_at IS NULL
                    AND COALESCE(account_status,'active') = 'active') THEN
      RAISE EXCEPTION 'Target must be an active doctor account' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.patient_surgeries
     SET assigned_doctor_id = p_doctor,
         assigned_at = CASE WHEN p_doctor IS NULL THEN NULL ELSE now() END,
         updated_at = now()
   WHERE id = p_surgery;

  PERFORM public.admin_log(
    CASE WHEN v_before IS NULL THEN 'journey.assign_doctor' ELSE 'journey.reassign_doctor' END,
    'patient_surgery', p_surgery, v_name,
    jsonb_build_object('assigned_doctor_id', v_before),
    jsonb_build_object('assigned_doctor_id', p_doctor), p_reason);
  RETURN jsonb_build_object('ok', true, 'assigned_doctor_id', p_doctor);
END;
$$;

-- Move every active journey from one doctor to another (used before removing
-- a doctor). Returns the number of journeys moved.
CREATE OR REPLACE FUNCTION public.admin_reassign_doctor_patients(p_from uuid, p_to uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_n int;
BEGIN
  PERFORM public.assert_admin();
  IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to reassign patients' USING ERRCODE = '22023';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN
    RAISE EXCEPTION 'Two different doctor accounts are required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_to AND role='doctor'
                  AND deleted_at IS NULL AND COALESCE(account_status,'active')='active') THEN
    RAISE EXCEPTION 'The receiving account must be an active doctor' USING ERRCODE = '22023';
  END IF;

  UPDATE public.patient_surgeries
     SET assigned_doctor_id = p_to, assigned_at = now(), updated_at = now()
   WHERE assigned_doctor_id = p_from AND archived_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  PERFORM public.admin_log('doctor.reassign_patients','profile', p_from,
    (SELECT COALESCE(full_name,email) FROM public.profiles WHERE id = p_from),
    jsonb_build_object('assigned_doctor_id', p_from),
    jsonb_build_object('assigned_doctor_id', p_to, 'journeys_moved', v_n), p_reason);
  RETURN jsonb_build_object('ok', true, 'journeys_moved', v_n);
END;
$$;

-- ============================================================
-- 5. LIFECYCLE RPCs
-- ============================================================
-- One entry point for active / suspended / banned. Transitions are validated,
-- a reason is mandatory for anything restrictive, and the previous state is
-- recorded so a restore is faithful.
CREATE OR REPLACE FUNCTION public.admin_set_account_status(
  p_target uuid, p_status text, p_reason text DEFAULT NULL, p_expires timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_before text; v_deleted timestamptz; v_uid uuid := auth.uid();
BEGIN
  PERFORM public.admin_assert_target(p_target);
  IF p_status NOT IN ('active','suspended','banned') THEN
    RAISE EXCEPTION 'Status "%" is not settable here (use soft delete / restore)', p_status USING ERRCODE = '22023';
  END IF;
  SELECT account_status, deleted_at INTO v_before, v_deleted FROM public.profiles WHERE id = p_target;
  IF v_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'Account is soft deleted. Restore it first.' USING ERRCODE = '22023';
  END IF;
  IF p_status <> 'active' AND NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to suspend or ban an account' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'banned' AND p_expires IS NOT NULL AND p_expires <= now() THEN
    RAISE EXCEPTION 'Ban expiry must be in the future' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles SET
    account_status = p_status,
    suspended_at   = CASE WHEN p_status='suspended' THEN now() ELSE NULL END,
    suspended_by   = CASE WHEN p_status='suspended' THEN v_uid ELSE NULL END,
    suspend_reason = CASE WHEN p_status='suspended' THEN p_reason ELSE NULL END,
    banned_at      = CASE WHEN p_status='banned' THEN now() ELSE NULL END,
    banned_by      = CASE WHEN p_status='banned' THEN v_uid ELSE NULL END,
    ban_reason     = CASE WHEN p_status='banned' THEN p_reason ELSE NULL END,
    ban_expires_at = CASE WHEN p_status='banned' THEN p_expires ELSE NULL END,
    updated_at     = now()
  WHERE id = p_target;

  PERFORM public.admin_log('account.' || p_status, 'profile', p_target,
    (SELECT COALESCE(full_name,email) FROM public.profiles WHERE id = p_target),
    jsonb_build_object('account_status', v_before),
    jsonb_build_object('account_status', p_status, 'ban_expires_at', p_expires),
    p_reason);
  RETURN jsonb_build_object('ok', true, 'account_status', p_status);
END;
$$;

-- Soft delete: nothing is removed. The row leaves normal views and every
-- relationship stays intact so a restore is complete.
CREATE OR REPLACE FUNCTION public.admin_soft_delete_account(p_target uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_before text;
BEGIN
  PERFORM public.admin_assert_target(p_target);
  IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to delete an account' USING ERRCODE = '22023';
  END IF;
  SELECT account_status INTO v_before FROM public.profiles WHERE id = p_target;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_target AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Account is already deleted' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
     SET account_status = 'deleted', deleted_at = now(), deleted_by = auth.uid(),
         delete_reason = p_reason, updated_at = now()
   WHERE id = p_target;

  PERFORM public.admin_log('account.soft_delete','profile', p_target,
    (SELECT COALESCE(full_name,email) FROM public.profiles WHERE id = p_target),
    jsonb_build_object('account_status', v_before, 'deleted_at', NULL),
    jsonb_build_object('account_status','deleted'), p_reason);
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Restore: back to active with every marker cleared. Because soft delete never
-- touched patients, assignments, journeys, questionnaires, checklists or
-- messages, they are all still attached and come back with the account.
CREATE OR REPLACE FUNCTION public.admin_restore_account(p_target uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_j int := 0; v_q int := 0; v_c int := 0;
BEGIN
  PERFORM public.admin_assert_target(p_target);
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_target AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Account is not deleted' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles SET
    account_status='active', deleted_at=NULL, deleted_by=NULL, delete_reason=NULL,
    suspended_at=NULL, suspended_by=NULL, suspend_reason=NULL,
    banned_at=NULL, banned_by=NULL, ban_reason=NULL, ban_expires_at=NULL,
    updated_at=now()
  WHERE id = p_target;

  -- Report what is coming back with it, so the admin sees the real blast radius.
  IF to_regclass('public.patient_surgeries') IS NOT NULL THEN
    SELECT count(*) INTO v_j FROM public.patient_surgeries
     WHERE patient_id = p_target OR assigned_doctor_id = p_target;
  END IF;
  IF to_regclass('public.preop_questionnaires') IS NOT NULL THEN
    SELECT count(*) INTO v_q FROM public.preop_questionnaires WHERE patient_id = p_target;
  END IF;
  IF to_regclass('public.preop_checklist') IS NOT NULL THEN
    SELECT count(*) INTO v_c FROM public.preop_checklist WHERE patient_id = p_target;
  END IF;

  PERFORM public.admin_log('account.restore','profile', p_target,
    (SELECT COALESCE(full_name,email) FROM public.profiles WHERE id = p_target),
    jsonb_build_object('account_status','deleted'),
    jsonb_build_object('account_status','active','journeys',v_j,'questionnaires',v_q,'checklists',v_c),
    p_reason);
  RETURN jsonb_build_object('ok', true, 'journeys', v_j, 'questionnaires', v_q, 'checklists', v_c);
END;
$$;

-- Permanent delete. Danger Zone only. The typed confirmation is validated HERE,
-- on the server, not in the browser. Deletes are explicit and ordered; nothing
-- relies on an FK cascade to decide what disappears.
CREATE OR REPLACE FUNCTION public.admin_purge_account(p_target uuid, p_confirm text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_label text; v_counts jsonb; v_auth boolean := false; v_sids uuid[];
BEGIN
  PERFORM public.admin_assert_target(p_target);
  IF p_confirm IS DISTINCT FROM 'DELETE' THEN
    RAISE EXCEPTION 'Type DELETE to confirm permanent deletion' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for permanent deletion' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_target AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Soft delete the account first. Permanent deletion is never the first step.'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(full_name, email) INTO v_label FROM public.profiles WHERE id = p_target;
  SELECT COALESCE(array_agg(id), '{}') INTO v_sids
    FROM public.patient_surgeries WHERE patient_id = p_target;

  v_counts := jsonb_build_object(
    'journeys',       (SELECT count(*) FROM public.patient_surgeries WHERE patient_id = p_target),
    'questionnaires', (SELECT count(*) FROM public.preop_questionnaires WHERE patient_id = p_target),
    'checklists',     (SELECT count(*) FROM public.preop_checklist WHERE patient_id = p_target));

  -- Audit BEFORE destroying, so the record survives the deletion.
  PERFORM public.admin_log('account.permanent_delete','profile', p_target, v_label,
    jsonb_build_object('account_status','deleted'),
    jsonb_build_object('purged', v_counts), p_reason);

  -- Explicit, ordered, owner-scoped.
  IF to_regclass('public.requirement_documents') IS NOT NULL THEN
    DELETE FROM public.requirement_documents WHERE patient_id = p_target;
  END IF;
  IF to_regclass('public.preop_questionnaires') IS NOT NULL THEN
    DELETE FROM public.preop_questionnaires WHERE patient_id = p_target;
  END IF;
  IF to_regclass('public.preop_checklist') IS NOT NULL THEN
    DELETE FROM public.preop_checklist WHERE patient_id = p_target;
  END IF;
  IF to_regclass('public.care_requests') IS NOT NULL THEN
    DELETE FROM public.care_requests WHERE patient_id = p_target OR doctor_id = p_target;
  END IF;
  IF to_regclass('public.preparation_plans') IS NOT NULL AND array_length(v_sids,1) IS NOT NULL THEN
    DELETE FROM public.preparation_plans WHERE surgery_id = ANY(v_sids);
  END IF;
  IF to_regclass('public.patient_recommendations') IS NOT NULL AND array_length(v_sids,1) IS NOT NULL THEN
    DELETE FROM public.patient_recommendations WHERE surgery_id = ANY(v_sids);
  END IF;
  -- A doctor's assignment is cleared, never their patients' records.
  UPDATE public.patient_surgeries SET assigned_doctor_id = NULL, assigned_at = NULL
   WHERE assigned_doctor_id = p_target;
  DELETE FROM public.patient_surgeries WHERE patient_id = p_target;

  -- Finally the identity. If the auth row goes, profiles cascades with it.
  BEGIN
    DELETE FROM auth.users WHERE id = p_target;
    v_auth := true;
  EXCEPTION WHEN others THEN
    v_auth := false;                      -- reported honestly to the caller
  END;
  IF NOT v_auth THEN
    DELETE FROM public.profiles WHERE id = p_target;
  END IF;

  RETURN jsonb_build_object('ok', true, 'purged', v_counts, 'auth_user_deleted', v_auth);
END;
$$;

-- ============================================================
-- 6. CONSULTATION REQUESTS
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_care_request_action(
  p_request uuid, p_action text, p_reason text DEFAULT NULL, p_doctor uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_before jsonb;
BEGIN
  PERFORM public.assert_admin();
  IF to_regclass('public.care_requests') IS NULL THEN
    RAISE EXCEPTION 'care_requests is not available' USING ERRCODE = '42P01';
  END IF;
  IF p_action NOT IN ('assign','complete','reject','archive','soft_delete') THEN
    RAISE EXCEPTION 'Action "%" is not supported', p_action USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_build_object('status', status, 'doctor_id', doctor_id,
                            'archived_at', archived_at, 'deleted_at', deleted_at)
    INTO v_before FROM public.care_requests WHERE id = p_request;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'No care request with id %', p_request USING ERRCODE = 'P0002';
  END IF;
  IF p_action IN ('reject','soft_delete') AND NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for this action' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'assign' THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_doctor AND role='doctor'
                    AND deleted_at IS NULL AND COALESCE(account_status,'active')='active') THEN
      RAISE EXCEPTION 'Target must be an active doctor account' USING ERRCODE = '22023';
    END IF;
    UPDATE public.care_requests SET doctor_id = p_doctor, updated_at = now() WHERE id = p_request;
  ELSIF p_action = 'complete' THEN            -- existing status value, not a new one
    UPDATE public.care_requests SET status='closed', responded_at=COALESCE(responded_at, now()),
           updated_at=now() WHERE id = p_request;
  ELSIF p_action = 'reject' THEN              -- existing status value
    UPDATE public.care_requests SET status='declined', decline_reason=p_reason,
           responded_at=COALESCE(responded_at, now()), updated_at=now() WHERE id = p_request;
  ELSIF p_action = 'archive' THEN
    UPDATE public.care_requests SET archived_at=now(), archived_by=auth.uid(), updated_at=now()
     WHERE id = p_request;
  ELSE
    UPDATE public.care_requests SET deleted_at=now(), deleted_by=auth.uid(),
           delete_reason=p_reason, updated_at=now() WHERE id = p_request;
  END IF;

  PERFORM public.admin_log('care_request.' || p_action, 'care_request', p_request, NULL,
    v_before,
    (SELECT jsonb_build_object('status', status, 'doctor_id', doctor_id,
                               'archived_at', archived_at, 'deleted_at', deleted_at)
       FROM public.care_requests WHERE id = p_request),
    p_reason);
  RETURN jsonb_build_object('ok', true, 'action', p_action);
END;
$$;

-- ============================================================
-- GRANTS
-- ============================================================
DO $g$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'admin_set_verification(uuid,text,text)',
    'admin_update_profile_fields(uuid,jsonb,text)',
    'admin_change_role(uuid,text,text)',
    'admin_assign_doctor(uuid,uuid,text)',
    'admin_reassign_doctor_patients(uuid,uuid,text)',
    'admin_set_account_status(uuid,text,text,timestamptz)',
    'admin_soft_delete_account(uuid,text)',
    'admin_restore_account(uuid,text)',
    'admin_purge_account(uuid,text,text)',
    'admin_care_request_action(uuid,text,text,uuid)'
  ] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.' || f || ' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.' || f || ' TO authenticated';
  END LOOP;
END
$g$;

-- ============================================================
-- POST-VERIFY
-- ============================================================
DO $v$
BEGIN
  RAISE NOTICE 'V1 profiles.account_status        : %', pg_temp.p2_has('public.profiles', ARRAY['account_status','deleted_at','banned_at','suspended_at']);
  RAISE NOTICE 'V2 care_requests soft delete      : %', pg_temp.p2_has('public.care_requests', ARRAY['deleted_at','archived_at']);
  RAISE NOTICE 'V3 account_is_active()            : %', (to_regproc('public.account_is_active') IS NOT NULL);
  RAISE NOTICE 'V4 moderation RPCs present        : %',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN
      ('admin_set_verification','admin_update_profile_fields','admin_change_role',
       'admin_assign_doctor','admin_reassign_doctor_patients','admin_set_account_status',
       'admin_soft_delete_account','admin_restore_account','admin_purge_account',
       'admin_care_request_action','admin_assert_target'));
  RAISE NOTICE 'V5 all accounts default to active : %',
    (SELECT count(*) FROM public.profiles WHERE account_status <> 'active');
END
$v$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- ROLLBACK
-- ============================================================
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.admin_care_request_action(uuid,text,text,uuid);
--   DROP FUNCTION IF EXISTS public.admin_purge_account(uuid,text,text);
--   DROP FUNCTION IF EXISTS public.admin_restore_account(uuid,text);
--   DROP FUNCTION IF EXISTS public.admin_soft_delete_account(uuid,text);
--   DROP FUNCTION IF EXISTS public.admin_set_account_status(uuid,text,text,timestamptz);
--   DROP FUNCTION IF EXISTS public.admin_reassign_doctor_patients(uuid,uuid,text);
--   DROP FUNCTION IF EXISTS public.admin_assign_doctor(uuid,uuid,text);
--   DROP FUNCTION IF EXISTS public.admin_change_role(uuid,text,text);
--   DROP FUNCTION IF EXISTS public.admin_update_profile_fields(uuid,jsonb,text);
--   DROP FUNCTION IF EXISTS public.admin_set_verification(uuid,text,text);
--   DROP FUNCTION IF EXISTS public.admin_assert_target(uuid);
--   -- restore the hardening versions (no active-account gate)
--   CREATE OR REPLACE FUNCTION public.is_platform_admin()
--   RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
--   AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
--          AND ((to_jsonb(p)->>'is_admin')='true' OR (to_jsonb(p)->>'role')='admin')); $$;
--   -- re-run the doctor_treats_patient block from v2_security_hardening.sql
--   DROP FUNCTION IF EXISTS public.account_is_active(uuid);
--   -- Lifecycle columns are additive and hold real moderation history.
--   -- Drop them ONLY if you accept losing that history:
--   -- ALTER TABLE public.profiles
--   --   DROP COLUMN IF EXISTS account_status, DROP COLUMN IF EXISTS suspended_at,
--   --   DROP COLUMN IF EXISTS suspended_by,   DROP COLUMN IF EXISTS suspend_reason,
--   --   DROP COLUMN IF EXISTS banned_at,      DROP COLUMN IF EXISTS banned_by,
--   --   DROP COLUMN IF EXISTS ban_reason,     DROP COLUMN IF EXISTS ban_expires_at,
--   --   DROP COLUMN IF EXISTS deleted_at,     DROP COLUMN IF EXISTS deleted_by,
--   --   DROP COLUMN IF EXISTS delete_reason;
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';
-- ============================================================
