-- ============================================================
-- Anestheo /v2 — SECURITY HARDENING
-- Closes two exploitable defects found in the release-candidate audit.
--
--   BLOCKER 1  Privilege escalation through public.profiles.
--              profiles_update_own is `USING (auth.uid() = id)` with no
--              WITH CHECK and no column restriction, and there is no trigger.
--              Any authenticated user can run, from the browser:
--                 update profiles set is_admin=true, role='admin' where id=<self>
--              and immediately become a platform administrator.
--
--   BLOCKER 2  Broad clinical read for anyone claiming role='doctor'.
--              preop_doctor_read (preop_questionnaires) and
--              checklist_doctor_read (preop_checklist) grant SELECT to every
--              profile whose role is doctor/admin, with no assignment check and
--              no verification check. RLS policies are OR-combined, so these
--              defeat the tighter pq_select added later. Combined with BLOCKER 1
--              (or simply the self-service role switch in settings.html) any
--              registered user can read every patient's questionnaire and
--              checklist.
--
-- SCOPE: these two defects only. No admin mutation RPCs, no new capability,
-- no Admin Center change. Additive/replacement-only, transaction-wrapped,
-- idempotent, rollback at the bottom.
--
-- Run in the Supabase SQL editor. All executable SQL is ASCII.
--
-- ------------------------------------------------------------
-- RELATION CONTRACT
-- ------------------------------------------------------------
-- MANDATORY (abort before any change if missing):
--   public.profiles              - the table being protected
--   public.preop_questionnaires  - carries the leaking policy
--   public.preop_checklist       - carries the leaking policy
--
-- OPTIONAL (each contributes one clause to doctor_treats_patient(); a missing
-- relation or column narrows the grant, it never widens it and never errors):
--   public.patient_surgeries (patient_id, assigned_doctor_id)
--   public.care_requests     (patient_id, doctor_id, status)
--   public.clinic_patients   (auth_user_id, doctor_id)
--
-- This migration creates no table and enables RLS on nothing. Every table it
-- touches already has RLS on; that is asserted in the preflight.
-- ============================================================

BEGIN;

-- ============================================================
-- 0. PREFLIGHT
-- ============================================================
CREATE OR REPLACE FUNCTION pg_temp.sh_has(p_rel text, p_cols text[] DEFAULT '{}')
RETURNS boolean LANGUAGE sql STABLE AS $sh$
  SELECT to_regclass(p_rel) IS NOT NULL
     AND NOT EXISTS (
           SELECT 1 FROM unnest(COALESCE(p_cols,'{}'::text[])) AS c(name)
            WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                               WHERE a.attrelid = to_regclass(p_rel)
                                 AND a.attname  = c.name
                                 AND a.attnum > 0 AND NOT a.attisdropped));
$sh$;

DO $preflight$
DECLARE
  v_missing text[] := '{}';
  v_norls   text[] := '{}';
  v_rel     text;
BEGIN
  FOREACH v_rel IN ARRAY ARRAY['public.profiles','public.preop_questionnaires','public.preop_checklist'] LOOP
    IF to_regclass(v_rel) IS NULL THEN v_missing := v_missing || v_rel;
    ELSIF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(v_rel)) THEN
      v_norls := v_norls || v_rel;
    END IF;
  END LOOP;

  IF NOT pg_temp.sh_has('public.profiles', ARRAY['id','role','is_admin','verification_status']) THEN
    v_missing := v_missing || 'public.profiles (id/role/is_admin/verification_status)';
  END IF;

  RAISE NOTICE '--- Security hardening preflight -------------------------';
  RAISE NOTICE 'patient_surgeries link usable : %',
    pg_temp.sh_has('public.patient_surgeries', ARRAY['patient_id','assigned_doctor_id']);
  RAISE NOTICE 'care_requests link usable     : %',
    pg_temp.sh_has('public.care_requests', ARRAY['patient_id','doctor_id','status']);
  RAISE NOTICE 'clinic_patients link usable   : %',
    pg_temp.sh_has('public.clinic_patients', ARRAY['auth_user_id','doctor_id']);
  RAISE NOTICE 'is_platform_admin() present   : %', (to_regproc('public.is_platform_admin') IS NOT NULL);
  RAISE NOTICE 'MISSING MANDATORY             : %',
    COALESCE(array_to_string(v_missing, ', '), '(none)');
  RAISE NOTICE '----------------------------------------------------------';

  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: mandatory relation/column missing: %. No changes were made.',
      array_to_string(v_missing, ', ');
  END IF;
  -- Never silently enable RLS. If a target table has RLS off, replacing its
  -- policies would be theatre - stop and let a human look.
  IF array_length(v_norls,1) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: RLS is disabled on %. Refusing to rewrite policies on an unprotected table.',
      array_to_string(v_norls, ', ');
  END IF;
  IF to_regproc('public.is_platform_admin') IS NULL THEN
    RAISE EXCEPTION 'ABORT: public.is_platform_admin() is missing. Apply v2_admin_phase0.sql first.';
  END IF;
END
$preflight$;

-- ============================================================
-- BLOCKER 1 - PROFILES: PROTECTED FIELDS
-- ============================================================
-- Design note: the guard is an ALLOWLIST of self-editable columns, not a
-- denylist of privileged ones. Any column that is not explicitly self-editable
-- is protected, so a privileged column added in the future is protected the day
-- it is created rather than the day someone remembers to add it here.
--
-- The check only applies to the PostgREST API roles. The table owner and
-- service_role are untouched, so SECURITY DEFINER functions (handle_new_user,
-- set_own_role below, and any future audited admin RPC) keep working.
CREATE OR REPLACE FUNCTION public.guard_profiles_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER                       -- must see the REAL caller
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Columns a signed-in user may edit about themselves.
  v_self_editable text[] := ARRAY[
    'full_name','phone','country','hospital','specialty','email',
    'accepting_patients','medical_license_number','avatar_url','bio',
    'city','languages','timezone','created_at','updated_at'
  ];
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_blocked text[] := '{}';
BEGIN
  -- Owner / service_role / SECURITY DEFINER context: unrestricted.
  IF current_user NOT IN ('authenticated','anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- profiles_insert_own lets a user create their own row. Force the
    -- privileged fields to safe values instead of trusting the payload.
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profiles_self_update ON public.profiles;
CREATE TRIGGER trg_guard_profiles_self_update
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profiles_self_update();

-- ------------------------------------------------------------
-- The one legitimate self-service role write, done safely.
-- Replaces the direct browser writes in role-select.html, settings.html,
-- navbar.js (post-signup) and dashboard.html (signup-metadata fallback).
-- 'admin' is never self-selectable, is_admin is never touched, and
-- verification_status is decided by the server, not by the caller.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_own_role(p_role text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  IF v_role NOT IN ('patient','doctor','nurse','student','other') THEN
    RAISE EXCEPTION 'set_own_role: "%" is not a self-selectable role', v_role
      USING ERRCODE = '22023';
  END IF;

  SELECT role, COALESCE(is_admin,false) INTO v_cur, v_admin
    FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_own_role: no profile row for this account' USING ERRCODE = 'P0002';
  END IF;

  -- An administrator must not be able to change their own role through the
  -- self-service path; that has to be an audited admin action.
  IF v_admin OR v_cur = 'admin' THEN
    RAISE EXCEPTION 'Administrator accounts cannot change role here' USING ERRCODE = '42501';
  END IF;

  -- Choosing 'doctor' always re-enters verification. Choosing anything else
  -- clears it. The caller never supplies this value.
  v_verif := CASE WHEN v_role = 'doctor' THEN 'pending' ELSE 'not_required' END;

  UPDATE public.profiles
     SET role = v_role, verification_status = v_verif, updated_at = now()
   WHERE id = v_uid;

  RETURN v_role;
END;
$$;

REVOKE ALL ON FUNCTION public.set_own_role(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_own_role(text) TO authenticated;

-- ============================================================
-- BLOCKER 2 - CLINICAL READ SCOPED TO A REAL TREATING RELATIONSHIP
-- ============================================================
-- doctor_treats_patient() answers one question: is the CALLER connected to
-- this patient through a relationship that already exists in the schema?
-- SECURITY DEFINER so a policy that calls it does not re-enter the RLS of the
-- tables it inspects. It discloses nothing: it returns a boolean about the
-- caller only. Clauses are compiled in only for relationships that exist.
DO $build$
DECLARE
  v_parts text[] := '{}';
  v_sql   text;
  v_skip  text[] := '{}';
BEGIN
  IF pg_temp.sh_has('public.patient_surgeries', ARRAY['patient_id','assigned_doctor_id']) THEN
    v_parts := v_parts || $c1$
    EXISTS (SELECT 1 FROM public.patient_surgeries s
             WHERE s.patient_id = p_patient AND s.assigned_doctor_id = auth.uid())$c1$::text;
  ELSE v_skip := v_skip || 'patient_surgeries.assigned_doctor_id'::text; END IF;

  IF pg_temp.sh_has('public.care_requests', ARRAY['patient_id','doctor_id','status']) THEN
    v_parts := v_parts || $c2$
    EXISTS (SELECT 1 FROM public.care_requests r
             WHERE r.patient_id = p_patient AND r.doctor_id = auth.uid()
               AND r.status IN ('accepted','closed'))$c2$::text;
  ELSE v_skip := v_skip || 'care_requests.status'::text; END IF;

  IF pg_temp.sh_has('public.clinic_patients', ARRAY['auth_user_id','doctor_id']) THEN
    v_parts := v_parts || $c3$
    EXISTS (SELECT 1 FROM public.clinic_patients c
             WHERE c.auth_user_id = p_patient AND c.doctor_id = auth.uid())$c3$::text;
  ELSE v_skip := v_skip || 'clinic_patients.auth_user_id'::text; END IF;

  IF array_length(v_parts,1) IS NULL THEN
    RAISE EXCEPTION 'ABORT: none of the treating relationships exist. Scoping clinical reads would deny every doctor.';
  END IF;

  v_sql :=
    $hd$
CREATE OR REPLACE FUNCTION public.doctor_treats_patient(p_patient uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT p_patient IS NOT NULL AND auth.uid() IS NOT NULL AND (
$hd$
    || array_to_string(v_parts, E'\n    OR')
    || $ft$
  );
$fn$;
$ft$;
  EXECUTE v_sql;

  RAISE NOTICE 'Security: doctor_treats_patient() compiled with % relationship(s); skipped: %',
    array_length(v_parts,1), COALESCE(array_to_string(v_skip, ', '), '(none)');
END
$build$;

REVOKE ALL ON FUNCTION public.doctor_treats_patient(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.doctor_treats_patient(uuid) TO authenticated;

-- ------------------------------------------------------------
-- Replace the two leaking policies. Both are dropped explicitly.
-- Patient self-access is preserved in every replacement.
-- ------------------------------------------------------------

-- preop_questionnaires
--   DROPPED : preop_doctor_read  (any doctor/admin role -> every row)
--   REPLACED: pq_select          (rebuilt on the treating relationship)
DROP POLICY IF EXISTS preop_doctor_read ON public.preop_questionnaires;
DROP POLICY IF EXISTS pq_select         ON public.preop_questionnaires;
CREATE POLICY pq_select ON public.preop_questionnaires
  FOR SELECT TO authenticated
  USING (
    patient_id = auth.uid()
    OR public.is_platform_admin()
    OR public.doctor_treats_patient(patient_id)
  );

-- preop_checklist
--   DROPPED : checklist_doctor_read (any doctor/admin role -> every row)
--   CREATED : preop_checklist_doctor_read (treating relationship only)
--   (own access stays on checklist_select_own; admin access stays on
--    preop_checklist_admin_read from Admin Phase 0)
DROP POLICY IF EXISTS checklist_doctor_read       ON public.preop_checklist;
DROP POLICY IF EXISTS preop_checklist_doctor_read ON public.preop_checklist;
CREATE POLICY preop_checklist_doctor_read ON public.preop_checklist
  FOR SELECT TO authenticated
  USING ( public.doctor_treats_patient(patient_id) );

-- Safety net: if the historical own-row policies were ever removed, patients
-- must still reach their own rows. Create only when absent - never replace a
-- working policy.
DO $own$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='preop_checklist'
                    AND cmd='SELECT' AND qual LIKE '%patient_id%' AND policyname <> 'preop_checklist_doctor_read') THEN
    EXECUTE 'CREATE POLICY preop_checklist_select_own ON public.preop_checklist
               FOR SELECT TO authenticated USING (patient_id = auth.uid())';
    RAISE NOTICE 'Security: added preop_checklist_select_own (no own-row SELECT policy existed)';
  END IF;
END
$own$;

-- ============================================================
-- POST-VERIFY
-- ============================================================
DO $verify$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM pg_policies
   WHERE schemaname='public'
     AND tablename IN ('preop_questionnaires','preop_checklist')
     AND policyname IN ('preop_doctor_read','checklist_doctor_read');
  IF v_bad > 0 THEN RAISE EXCEPTION 'ABORT: a broad policy survived the drop'; END IF;

  RAISE NOTICE 'V1 broad clinical policies removed      : yes';
  RAISE NOTICE 'V2 profiles guard trigger installed     : %',
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_guard_profiles_self_update');
  RAISE NOTICE 'V3 set_own_role() present               : %', (to_regproc('public.set_own_role') IS NOT NULL);
  RAISE NOTICE 'V4 doctor_treats_patient() present      : %', (to_regproc('public.doctor_treats_patient') IS NOT NULL);
  RAISE NOTICE 'V5 preop_questionnaires SELECT policies : %',
    (SELECT string_agg(policyname, ', ' ORDER BY policyname) FROM pg_policies
      WHERE schemaname='public' AND tablename='preop_questionnaires' AND cmd='SELECT');
  RAISE NOTICE 'V6 preop_checklist SELECT policies      : %',
    (SELECT string_agg(policyname, ', ' ORDER BY policyname) FROM pg_policies
      WHERE schemaname='public' AND tablename='preop_checklist' AND cmd='SELECT');
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- ROLLBACK (restores the pre-hardening behaviour exactly)
-- WARNING: this puts both vulnerabilities back. Only for an emergency.
-- ============================================================
-- BEGIN;
--   DROP TRIGGER IF EXISTS trg_guard_profiles_self_update ON public.profiles;
--   DROP FUNCTION IF EXISTS public.guard_profiles_self_update();
--   DROP FUNCTION IF EXISTS public.set_own_role(text);
--
--   DROP POLICY IF EXISTS preop_checklist_doctor_read ON public.preop_checklist;
--   DROP POLICY IF EXISTS preop_checklist_select_own  ON public.preop_checklist;
--   DROP POLICY IF EXISTS pq_select                   ON public.preop_questionnaires;
--
--   -- the tighter pq_select as it stood before this migration
--   CREATE POLICY pq_select ON public.preop_questionnaires
--     FOR SELECT TO authenticated
--     USING (
--       auth.uid() = patient_id
--       OR EXISTS (SELECT 1 FROM public.patient_surgeries s
--                   WHERE s.patient_id = preop_questionnaires.patient_id
--                     AND s.assigned_doctor_id = auth.uid())
--       OR EXISTS (SELECT 1 FROM public.profiles p
--                   WHERE p.id = auth.uid() AND (p.is_admin = true OR p.role = 'admin'))
--     );
--   -- the two broad policies this migration removed
--   CREATE POLICY preop_doctor_read ON public.preop_questionnaires FOR SELECT USING (
--     EXISTS (SELECT 1 FROM public.profiles
--              WHERE profiles.id = auth.uid()
--                AND (profiles.role IN ('doctor','admin') OR profiles.is_admin = true)));
--   CREATE POLICY checklist_doctor_read ON public.preop_checklist FOR SELECT USING (
--     EXISTS (SELECT 1 FROM public.profiles
--              WHERE profiles.id = auth.uid()
--                AND (profiles.role IN ('doctor','admin') OR profiles.is_admin = true)));
--
--   DROP FUNCTION IF EXISTS public.doctor_treats_patient(uuid);
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';
-- ============================================================
