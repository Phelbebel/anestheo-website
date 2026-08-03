-- ============================================================
-- Anestheo /v2 — ADMIN CENTER, PHASE 0
-- Minimum secure backend foundation for real admin visibility & control.
--
-- Contents:
--   0. Preflight               — relation inventory + mandatory-table gate
--   1. is_platform_admin() / assert_admin()      — canonical server-side gate
--   2. Admin READ-ONLY RLS policies              — fixes the profiles blocker
--   3. admin_audit_log (+ append-only guard)     — every privileged mutation
--   4. admin_log()                               — the only way to write audit
--   5. admin_search()                            — bounded, injection-safe
--
-- Deliberately NOT included (deferred by decision): email/ESP tracking,
-- impersonation, feature flags / maintenance mode, admin WRITE policies,
-- and any auth.users (GoTrue) operation — see docs/ADMIN_CENTER_ARCHITECTURE.md
-- and the admin-api interface spec in docs/ADMIN_API_INTERFACE.md.
--
-- SAFETY: additive, idempotent, transaction-wrapped. Drops nothing except the
-- policies/functions it owns (all created by this file). Existing policies,
-- tables, columns and functions are untouched. Rollback at the bottom.
-- Run in the Supabase SQL editor. All executable SQL is ASCII; the comment
-- rules/dashes use a few UTF-8 characters, exactly as the other v2 migrations do.
--
-- ------------------------------------------------------------
-- RELATION CONTRACT (v2 — production is NOT assumed to match the replica)
-- ------------------------------------------------------------
-- MANDATORY — absent => migration aborts before any change is made:
--   public.profiles   (column public.profiles.id is the only hard column
--                      requirement; every other profiles column is read
--                      defensively through to_jsonb)
--   auth.users        (FK target of admin_audit_log.actor_id)
--
-- OPTIONAL — absent => that piece is skipped, everything else still applies:
--   admin read policy only:
--     public.preop_checklist
--     public.question_replies          <- ABSENT in production today
--     public.preparation_plans
--     public.requirement_documents
--     public.patient_recommendations
--     public.video_progress
--   admin_search() source branch (branch omitted if table or any referenced
--   column is missing; the profile branch always remains):
--     public.patient_surgeries
--     public.clinic_patients
--     public.care_requests
--     public.preop_questionnaires
--     public.questions
--
-- CREATED BY THIS FILE (neither mandatory nor optional):
--   public.admin_audit_log
--
-- Nothing here CREATES an optional table. question_replies must arrive from
-- v2_ask_migration.sql, which is the migration that owns it.
--
-- ------------------------------------------------------------
-- STANDALONE PREFLIGHT (read-only — run this on its own first)
-- ------------------------------------------------------------
-- SELECT rel, kind,
--        CASE WHEN to_regclass(rel) IS NOT NULL THEN 'present' ELSE 'MISSING' END AS state
--   FROM (VALUES
--     ('public.profiles','mandatory'),
--     ('auth.users','mandatory'),
--     ('public.preop_checklist','optional/policy'),
--     ('public.question_replies','optional/policy'),
--     ('public.preparation_plans','optional/policy'),
--     ('public.requirement_documents','optional/policy'),
--     ('public.patient_recommendations','optional/policy'),
--     ('public.video_progress','optional/policy'),
--     ('public.patient_surgeries','optional/search'),
--     ('public.clinic_patients','optional/search'),
--     ('public.care_requests','optional/search'),
--     ('public.preop_questionnaires','optional/search'),
--     ('public.questions','optional/search')
--   ) AS t(rel, kind)
--  ORDER BY kind, rel;
-- ============================================================

BEGIN;

-- ============================================================
-- 0. PREFLIGHT
-- ============================================================
-- pg_temp helper: does the relation exist AND carry every named column?
-- Temp-schema only: it is created in this session, touches no production
-- object, and disappears when the connection closes.
CREATE OR REPLACE FUNCTION pg_temp.p0_has(p_rel text, p_cols text[] DEFAULT '{}')
RETURNS boolean
LANGUAGE sql
STABLE
AS $p0has$
  SELECT to_regclass(p_rel) IS NOT NULL
     AND NOT EXISTS (
           SELECT 1
             FROM unnest(COALESCE(p_cols, '{}'::text[])) AS c(name)
            WHERE NOT EXISTS (
                    SELECT 1 FROM pg_attribute a
                     WHERE a.attrelid = to_regclass(p_rel)
                       AND a.attname  = c.name
                       AND a.attnum   > 0
                       AND NOT a.attisdropped
                  )
         );
$p0has$;

DO $preflight$
DECLARE
  v_mandatory text[] := ARRAY['public.profiles', 'auth.users'];
  v_optional  text[] := ARRAY[
    'public.preop_checklist', 'public.question_replies',
    'public.preparation_plans', 'public.requirement_documents',
    'public.patient_recommendations', 'public.video_progress',
    'public.patient_surgeries', 'public.clinic_patients',
    'public.care_requests', 'public.preop_questionnaires', 'public.questions'
  ];
  v_present   text[] := '{}';
  v_miss_opt  text[] := '{}';
  v_miss_man  text[] := '{}';
  v_rel       text;
BEGIN
  FOREACH v_rel IN ARRAY v_mandatory LOOP
    IF to_regclass(v_rel) IS NULL THEN v_miss_man := v_miss_man || v_rel;
    ELSE                               v_present  := v_present  || v_rel;
    END IF;
  END LOOP;

  FOREACH v_rel IN ARRAY v_optional LOOP
    IF to_regclass(v_rel) IS NULL THEN v_miss_opt := v_miss_opt || v_rel;
    ELSE                               v_present  := v_present  || v_rel;
    END IF;
  END LOOP;

  -- The one hard column requirement. Everything else is read defensively.
  IF to_regclass('public.profiles') IS NOT NULL
     AND NOT pg_temp.p0_has('public.profiles', ARRAY['id']) THEN
    v_miss_man := v_miss_man || 'public.profiles.id (column)'::text;
  END IF;

  RAISE NOTICE '--- Admin Phase 0 preflight ------------------------------';
  RAISE NOTICE 'EXISTING          (%): %', COALESCE(array_length(v_present, 1), 0),
               COALESCE(array_to_string(v_present, ', '), '(none)');
  RAISE NOTICE 'MISSING OPTIONAL  (%): %  -> skipped safely',
               COALESCE(array_length(v_miss_opt, 1), 0),
               COALESCE(array_to_string(v_miss_opt, ', '), '(none)');
  RAISE NOTICE 'MISSING MANDATORY (%): %', COALESCE(array_length(v_miss_man, 1), 0),
               COALESCE(array_to_string(v_miss_man, ', '), '(none)');
  RAISE NOTICE '----------------------------------------------------------';

  IF array_length(v_miss_man, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: mandatory relation(s) missing: %. No changes were made.',
                    array_to_string(v_miss_man, ', ');
  END IF;
END
$preflight$;

-- ============================================================
-- 1. CANONICAL ADMIN GATE
-- ============================================================
-- is_platform_admin(): boolean, used inside RLS policies.
-- SECURITY DEFINER is REQUIRED here: it lets the function read public.profiles
-- with the owner's rights, so a policy ON public.profiles that calls it does
-- NOT re-enter profiles' own RLS (which would be infinite recursion).
-- It discloses nothing: it only answers "is the CALLER an admin?".
--
-- is_admin / role are read through to_jsonb so this function is created and
-- runs correctly whether production carries one column, both, or neither.
-- The lookup is still a primary-key hit on a single row.
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid()
       AND ( (to_jsonb(p) ->> 'is_admin') = 'true'
             OR (to_jsonb(p) ->> 'role') = 'admin' )
  );
$$;

-- assert_admin(): raises for anyone who is not an authenticated admin.
-- Used as the first line of every privileged RPC (same shape as the shipped
-- admin_delete_patient guard).
CREATE OR REPLACE FUNCTION public.assert_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Admin privilege required' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Explicit, least-privilege execute rights.
REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assert_admin()      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_admin()      TO authenticated;

-- ============================================================
-- 2. ADMIN READ-ONLY RLS POLICIES
-- ============================================================
-- READ ONLY. No admin INSERT/UPDATE/DELETE policy is added anywhere: mutation
-- stays behind explicit, audited RPCs (Phase 2+). Policies are PERMISSIVE, so
-- each one only widens access for admins; existing patient/doctor policies are
-- untouched and keep working exactly as before.
--
-- 2a. profiles — THE Phase 0 blocker. Until now RLS allowed only own-row +
--     directory reads, so the admin pages could not see any other user.
--     profiles is MANDATORY, so this is unconditional by design.
DROP POLICY IF EXISTS profiles_admin_read ON public.profiles;
CREATE POLICY profiles_admin_read ON public.profiles
  FOR SELECT TO authenticated
  USING ( public.is_platform_admin() );

-- 2b. OPTIONAL tables with no admin-aware policy today.
--     Each is guarded by to_regclass: absent => skipped with a NOTICE, never
--     an unconditional statement against a relation that may not exist.
--
--     RLS enablement rule: ENABLE ROW LEVEL SECURITY runs only when the table
--     is ALREADY governed by RLS, i.e. it already carries at least one policy
--     that is not ours. Turning RLS on for a table that has no policies would
--     deny every patient and doctor read on it, which is a far worse outcome
--     than a missing admin policy. The check deliberately ignores our own
--     policy so a second run cannot flip the decision.
DO $opt_policies$
DECLARE
  v_rel  text;
  v_pol  text;
  v_tbl  text;
  v_rels text[] := ARRAY[
    'preop_checklist', 'question_replies', 'preparation_plans',
    'requirement_documents', 'patient_recommendations', 'video_progress'
  ];
BEGIN
  FOREACH v_tbl IN ARRAY v_rels LOOP
    v_rel := 'public.' || v_tbl;
    v_pol := v_tbl || '_admin_read';

    IF to_regclass(v_rel) IS NULL THEN
      RAISE NOTICE 'Phase 0: optional table % is absent - policy % skipped', v_rel, v_pol;
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = v_tbl
                  AND policyname <> v_pol) THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', v_rel);
    ELSE
      RAISE NOTICE 'Phase 0: % has no pre-existing RLS policy - RLS left as-is '
                   '(enabling it would deny all non-admin access)', v_rel;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', v_pol, v_rel);
    EXECUTE format(
      'CREATE POLICY %I ON %s FOR SELECT TO authenticated '
      'USING (public.is_platform_admin())', v_pol, v_rel);
    RAISE NOTICE 'Phase 0: policy % created on %', v_pol, v_rel;
  END LOOP;
END
$opt_policies$;

-- 2c. Tables that ALREADY carry an admin clause keep their existing policy and
--     are intentionally NOT modified:
--       clinic_patients        (cp_select)
--       patient_surgeries      (ps_select)
--       care_requests          (cr_select)
--       preop_questionnaires   (pq_select)
--       questions              (q_select_own_or_staff  - staff = doctor|admin)
--       questionnaire_templates(qt_select)
--       patient_archive_audit  (paa_select)
--       evidence_*             (evidence admin policies)

-- ============================================================
-- 3. ADMIN AUDIT LOG
-- ============================================================
-- Naming follows the shipped patient_archive_audit (actor_id / actor_role /
-- action / reason / created_at) and generalises it to any object.
-- target_id is a plain uuid with NO foreign key, so the audit row survives the
-- deletion of the object it describes.
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  actor_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role     text,                       -- role at the time of the action
  action         text NOT NULL,              -- e.g. 'doctor.verify', 'patient.reassign'
  target_type    text,                       -- 'profile' | 'patient_surgery' | ...
  target_id      uuid,                       -- no FK on purpose (survives delete)
  target_label   text,                       -- human-readable at time of action
  before_state   jsonb,                      -- minimal, non-clinical
  after_state    jsonb,                      -- minimal, non-clinical
  reason         text,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text                        -- request/batch correlation
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON public.admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor   ON public.admin_audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target  ON public.admin_audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action  ON public.admin_audit_log(action);

-- Client rights: SELECT only, and only for admins (policy below).
-- No INSERT/UPDATE/DELETE grant => clients can never forge or erase audit rows.
REVOKE ALL ON TABLE public.admin_audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.admin_audit_log TO authenticated;

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_audit_log_admin_read ON public.admin_audit_log;
CREATE POLICY admin_audit_log_admin_read ON public.admin_audit_log
  FOR SELECT TO authenticated
  USING ( public.is_platform_admin() );
-- (no INSERT/UPDATE/DELETE policy at all: writes happen only through the
--  SECURITY DEFINER writer below, which runs as the table owner.)

-- Append-only guard. Same shape as the existing
-- guard_patient_surgeries_protected trigger: blocks UPDATE/DELETE for the API
-- roles even if a policy or grant were ever added by mistake.
CREATE OR REPLACE FUNCTION public.guard_admin_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'admin_audit_log is append-only';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_audit_append_only ON public.admin_audit_log;
CREATE TRIGGER trg_admin_audit_append_only
  BEFORE UPDATE OR DELETE ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.guard_admin_audit_append_only();

-- ============================================================
-- 4. admin_log() — the only supported way to write an audit row
-- ============================================================
-- Defence in depth for before_state / after_state: the audit log must never
-- become a secret store or a copy of the clinical record. Values whose KEY
-- matches the denylist are replaced with '[redacted]' (top level and nested).
-- Callers are still expected to pass minimal diffs; this is the backstop.
CREATE OR REPLACE FUNCTION public.admin_scrub_jsonb(p_in jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
  v_key text;
  v_val jsonb;
  -- secrets + bulk clinical payloads that have no place in an audit row
  v_deny text[] := ARRAY[
    'password','pass','pwd','token','access_token','refresh_token','jwt',
    'secret','api_key','apikey','key','authorization','auth','service_role',
    'anon_key','claim_token','session','cookie',
    'answers','questionnaire_data','risk_flags','plan_content','message',
    'notes','doctor_notes','consult_notes','reviewer_notes','items'
  ];
BEGIN
  IF p_in IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_in) = 'array' THEN
    SELECT COALESCE(jsonb_agg(public.admin_scrub_jsonb(e)), '[]'::jsonb)
      INTO v_out FROM jsonb_array_elements(p_in) AS e;
    RETURN v_out;
  END IF;
  IF jsonb_typeof(p_in) <> 'object' THEN RETURN p_in; END IF;

  v_out := '{}'::jsonb;
  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_in) LOOP
    IF lower(v_key) = ANY (v_deny) THEN
      v_out := v_out || jsonb_build_object(v_key, to_jsonb('[redacted]'::text));
    ELSIF jsonb_typeof(v_val) IN ('object','array') THEN
      v_out := v_out || jsonb_build_object(v_key, public.admin_scrub_jsonb(v_val));
    ELSE
      v_out := v_out || jsonb_build_object(v_key, v_val);
    END IF;
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_scrub_jsonb(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_scrub_jsonb(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_log(
  p_action         text,
  p_target_type    text    DEFAULT NULL,
  p_target_id      uuid    DEFAULT NULL,
  p_target_label   text    DEFAULT NULL,
  p_before         jsonb   DEFAULT NULL,
  p_after          jsonb   DEFAULT NULL,
  p_reason         text    DEFAULT NULL,
  p_metadata       jsonb   DEFAULT '{}'::jsonb,
  p_correlation_id text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid; v_role text;
BEGIN
  PERFORM public.assert_admin();                       -- admins only
  IF p_action IS NULL OR btrim(p_action) = '' THEN
    RAISE EXCEPTION 'admin_log: action is required';
  END IF;

  -- Defensive column reads: works with or without is_admin / role.
  SELECT CASE WHEN (to_jsonb(p) ->> 'is_admin') = 'true' THEN 'admin'
              ELSE COALESCE(to_jsonb(p) ->> 'role', 'admin') END
    INTO v_role FROM public.profiles p WHERE p.id = auth.uid();

  INSERT INTO public.admin_audit_log
    (actor_id, actor_role, action, target_type, target_id, target_label,
     before_state, after_state, reason, metadata, correlation_id)
  VALUES
    -- actor_id is ALWAYS auth.uid(): the caller can never supply an identity.
    (auth.uid(), COALESCE(v_role,'admin'), btrim(p_action), p_target_type, p_target_id, p_target_label,
     public.admin_scrub_jsonb(p_before), public.admin_scrub_jsonb(p_after),
     NULLIF(btrim(COALESCE(p_reason,'')),''),
     public.admin_scrub_jsonb(COALESCE(p_metadata,'{}'::jsonb)), p_correlation_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_log(text,text,uuid,text,jsonb,jsonb,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_log(text,text,uuid,text,jsonb,jsonb,text,jsonb,text) TO authenticated;

-- ============================================================
-- 5. admin_search() — global search over EXISTING data only
-- ============================================================
-- Safety properties:
--   * assert_admin() first; non-admins get an exception, never rows.
--   * The BODY contains no dynamic SQL and the term is always a bound
--     parameter. The only thing composed at migration time is WHICH source
--     branches are compiled in, decided from the live catalog.
--   * LIKE metacharacters in the term are escaped, so input cannot widen the
--     match; ESCAPE '\' is declared explicitly.
--   * Result count is bounded (default 20, hard max 100).
--   * The profile branch is always present and reads every column except id
--     through to_jsonb, so it cannot fail on a schema difference.
--   * Every other branch is compiled in only when its table AND all columns it
--     references exist. A missing table or column omits that entity type and
--     raises a NOTICE - it never produces a runtime 42P01/42703 for the admin.
--   * 'destination' is an EXISTING page that can display the entity today, or
--     NULL. No routes are invented.
DROP FUNCTION IF EXISTS public.admin_search(text, integer);

DO $build_search$
DECLARE
  v_parts   text[] := '{}';
  v_omitted text[] := '{}';
  v_sql     text;
BEGIN
  -- ── profiles (doctors, patients, admins, staff) — always compiled in ──
  v_parts := v_parts || ($b_prof$
    SELECT 'profile'::text AS entity_type,
           p.id            AS entity_id,
           COALESCE(NULLIF(btrim(COALESCE(to_jsonb(p) ->> 'full_name','')),''),
                    to_jsonb(p) ->> 'email', 'User')::text AS label,
           NULLIF(concat_ws(' - ', to_jsonb(p) ->> 'email', to_jsonb(p) ->> 'hospital',
                            to_jsonb(p) ->> 'specialty', to_jsonb(p) ->> 'country'), '')::text AS sublabel,
           (COALESCE(to_jsonb(p) ->> 'role','pending') || CASE
              WHEN COALESCE(to_jsonb(p) ->> 'verification_status','') NOT IN ('', 'not_required')
              THEN ' / ' || (to_jsonb(p) ->> 'verification_status') ELSE '' END)::text AS status,
           '/v2/admin.html'::text AS destination,
           1 AS rank_order,
           (to_jsonb(p) ->> 'created_at')::timestamptz AS sort_at
      FROM public.profiles p
     WHERE (v_uuid IS NOT NULL AND p.id = v_uuid)
        OR (to_jsonb(p) ->> 'full_name') ILIKE v_pat ESCAPE '\'
        OR (to_jsonb(p) ->> 'email')     ILIKE v_pat ESCAPE '\'
        OR (to_jsonb(p) ->> 'phone')     ILIKE v_pat ESCAPE '\'
        OR (to_jsonb(p) ->> 'hospital')  ILIKE v_pat ESCAPE '\'
        OR (to_jsonb(p) ->> 'specialty') ILIKE v_pat ESCAPE '\'
        OR (to_jsonb(p) ->> 'country')   ILIKE v_pat ESCAPE '\'
        OR (to_jsonb(p) ->> 'medical_license_number') ILIKE v_pat ESCAPE '\'
$b_prof$)::text;

  -- ── patient_surgeries (the canonical patient record) ──
  IF pg_temp.p0_has('public.patient_surgeries', ARRAY[
       'id','patient_id','assigned_doctor_id','patient_name','procedure_type',
       'hospital','surgery_date','archived_at','completed_at','ready_at',
       'care_state','contact_email','created_at']) THEN
    v_parts := v_parts || ($b_ps$
    SELECT 'patient_surgery'::text,
           s.id,
           COALESCE(NULLIF(btrim(COALESCE(s.patient_name,'')),''), 'Patient')::text,
           NULLIF(concat_ws(' - ', s.procedure_type, s.hospital,
                            to_char(s.surgery_date,'YYYY-MM-DD')), '')::text,
           (CASE WHEN s.archived_at  IS NOT NULL THEN 'archived'
                 WHEN s.completed_at IS NOT NULL THEN 'completed'
                 WHEN s.ready_at     IS NOT NULL THEN 'ready'
                 ELSE COALESCE(s.care_state,'surgical') END)::text,
           '/v2/admin.html'::text,
           2,
           s.created_at
      FROM public.patient_surgeries s
     WHERE (v_uuid IS NOT NULL AND (s.id = v_uuid OR s.patient_id = v_uuid
                                    OR s.assigned_doctor_id = v_uuid))
        OR s.patient_name   ILIKE v_pat ESCAPE '\'
        OR s.procedure_type ILIKE v_pat ESCAPE '\'
        OR s.hospital       ILIKE v_pat ESCAPE '\'
        OR s.contact_email  ILIKE v_pat ESCAPE '\'
$b_ps$)::text;
  ELSE
    v_omitted := v_omitted || 'patient_surgery'::text;
  END IF;

  -- ── clinic_patients (doctor-invited, may have no account) ──
  IF pg_temp.p0_has('public.clinic_patients', ARRAY[
       'id','doctor_id','auth_user_id','patient_name','phone_number','email',
       'procedure','hospital','patient_status','created_at']) THEN
    v_parts := v_parts || ($b_cp$
    SELECT 'clinic_patient'::text,
           c.id,
           COALESCE(NULLIF(btrim(COALESCE(c.patient_name,'')),''), 'Patient')::text,
           NULLIF(concat_ws(' - ', c.procedure, c.hospital, c.phone_number, c.email), '')::text,
           COALESCE(c.patient_status,'awaiting_questionnaire')::text,
           '/v2/dashboard.html'::text,
           3,
           c.created_at
      FROM public.clinic_patients c
     WHERE (v_uuid IS NOT NULL AND (c.id = v_uuid OR c.doctor_id = v_uuid OR c.auth_user_id = v_uuid))
        OR c.patient_name ILIKE v_pat ESCAPE '\'
        OR c.phone_number ILIKE v_pat ESCAPE '\'
        OR c.email        ILIKE v_pat ESCAPE '\'
        OR c.procedure    ILIKE v_pat ESCAPE '\'
        OR c.hospital     ILIKE v_pat ESCAPE '\'
$b_cp$)::text;
  ELSE
    v_omitted := v_omitted || 'clinic_patient'::text;
  END IF;

  -- ── care_requests (consultations / attachment requests) ──
  IF pg_temp.p0_has('public.care_requests', ARRAY[
       'id','patient_id','doctor_id','surgery_id','patient_name','doctor_name',
       'procedure','origin_method','status','requested_at']) THEN
    v_parts := v_parts || ($b_cr$
    SELECT 'care_request'::text,
           r2.id,
           COALESCE(NULLIF(btrim(COALESCE(r2.patient_name,'')),''), 'Care request')::text,
           NULLIF(concat_ws(' - ', r2.doctor_name, r2.procedure, r2.origin_method), '')::text,
           r2.status::text,
           '/v2/dashboard.html'::text,
           4,
           r2.requested_at
      FROM public.care_requests r2
     WHERE (v_uuid IS NOT NULL AND (r2.id = v_uuid OR r2.patient_id = v_uuid
                                    OR r2.doctor_id = v_uuid OR r2.surgery_id = v_uuid))
        OR r2.patient_name ILIKE v_pat ESCAPE '\'
        OR r2.doctor_name  ILIKE v_pat ESCAPE '\'
        OR r2.procedure    ILIKE v_pat ESCAPE '\'
$b_cr$)::text;
  ELSE
    v_omitted := v_omitted || 'care_request'::text;
  END IF;

  -- ── preop_questionnaires (UUID lookup only: clinical answers are never searched) ──
  IF pg_temp.p0_has('public.preop_questionnaires', ARRAY[
       'id','patient_id','completion','submitted_at','review_state','status','created_at']) THEN
    v_parts := v_parts || ($b_pq$
    SELECT 'questionnaire'::text,
           q.id,
           'Questionnaire'::text,
           NULLIF(concat_ws(' - ', 'completion ' || COALESCE(q.completion,0)::text || '%',
                            to_char(q.submitted_at,'YYYY-MM-DD')), '')::text,
           COALESCE(q.review_state, COALESCE(q.status,'in_progress'))::text,
           '/v2/dashboard.html'::text,
           5,
           q.created_at
      FROM public.preop_questionnaires q
     WHERE v_uuid IS NOT NULL AND (q.id = v_uuid OR q.patient_id = v_uuid)
$b_pq$)::text;
  ELSE
    v_omitted := v_omitted || 'questionnaire'::text;
  END IF;

  -- ── questions (subject only; the message body is never searched) ──
  -- NOTE: production may still carry the ORIGINAL contact-form questions table,
  -- which has no subject/patient_id/status. The column check below is what
  -- keeps that difference from becoming a runtime error for the admin.
  IF pg_temp.p0_has('public.questions', ARRAY[
       'id','patient_id','subject','status','created_at']) THEN
    v_parts := v_parts || ($b_q$
    SELECT 'question'::text,
           qq.id,
           COALESCE(NULLIF(btrim(COALESCE(qq.subject,'')),''), 'Patient question')::text,
           to_char(qq.created_at,'YYYY-MM-DD')::text,
           COALESCE(qq.status,'new')::text,
           '/v2/dashboard.html'::text,
           6,
           qq.created_at
      FROM public.questions qq
     WHERE (v_uuid IS NOT NULL AND (qq.id = v_uuid OR qq.patient_id = v_uuid))
        OR qq.subject ILIKE v_pat ESCAPE '\'
$b_q$)::text;
  ELSE
    v_omitted := v_omitted || 'question'::text;
  END IF;

  -- Assemble. String concatenation, not format(): the branches contain literal
  -- '%' characters that format() would misread as specifiers.
  v_sql :=
    $hd$
CREATE FUNCTION public.admin_search(p_q text, p_limit integer DEFAULT 20)
RETURNS TABLE (
  entity_type text,
  entity_id   uuid,
  label       text,
  sublabel    text,
  status      text,
  destination text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_term text;
  v_pat  text;
  v_uuid uuid;
  v_lim  integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
BEGIN
  PERFORM public.assert_admin();

  v_term := btrim(COALESCE(p_q, ''));
  -- Bounded input: too short is meaningless, too long is a pointless scan.
  IF length(v_term) < 2 OR length(v_term) > 128 THEN
    RETURN;                                   -- no rows, no error
  END IF;

  -- Escape LIKE metacharacters so the term cannot broaden the search.
  v_pat := '%' || replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- Exact UUID lookup when the term is a well-formed uuid.
  BEGIN
    v_uuid := v_term::uuid;
  EXCEPTION WHEN others THEN
    v_uuid := NULL;
  END;

  RETURN QUERY
  SELECT r.entity_type, r.entity_id, r.label, r.sublabel, r.status, r.destination
  FROM (
$hd$
    || array_to_string(v_parts, E'\n    UNION ALL\n')
    || $ft$
  ) AS r
  ORDER BY r.rank_order, r.sort_at DESC NULLS LAST
  LIMIT v_lim;
END;
$fn$;
$ft$;

  EXECUTE v_sql;

  RAISE NOTICE 'Phase 0: admin_search compiled with % branch(es); omitted: %',
               COALESCE(array_length(v_parts, 1), 0),
               COALESCE(array_to_string(v_omitted, ', '), '(none)');
END
$build_search$;

REVOKE ALL ON FUNCTION public.admin_search(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search(text, integer) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- ROLLBACK (run as a block to undo Phase 0 completely)
-- ============================================================
-- Optional-table policies are dropped conditionally: DROP POLICY IF EXISTS
-- still raises 42P01 when the TABLE itself is missing, so it cannot be used
-- unguarded here either.
-- ------------------------------------------------------------
-- BEGIN;
--   DROP POLICY IF EXISTS profiles_admin_read        ON public.profiles;
--   DROP POLICY IF EXISTS admin_audit_log_admin_read ON public.admin_audit_log;
--   DROP TRIGGER IF EXISTS trg_admin_audit_append_only ON public.admin_audit_log;
--
--   DO $rb$
--   DECLARE
--     v_tbl text;
--     v_rels text[] := ARRAY[
--       'preop_checklist', 'question_replies', 'preparation_plans',
--       'requirement_documents', 'patient_recommendations', 'video_progress'
--     ];
--   BEGIN
--     FOREACH v_tbl IN ARRAY v_rels LOOP
--       IF to_regclass('public.' || v_tbl) IS NOT NULL THEN
--         EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
--                        v_tbl || '_admin_read', v_tbl);
--       END IF;
--     END LOOP;
--   END
--   $rb$;
--
--   DROP FUNCTION IF EXISTS public.guard_admin_audit_append_only();
--   DROP FUNCTION IF EXISTS public.admin_search(text, integer);
--   DROP FUNCTION IF EXISTS public.admin_log(text,text,uuid,text,jsonb,jsonb,text,jsonb,text);
--   DROP FUNCTION IF EXISTS public.admin_scrub_jsonb(jsonb);
--   -- Audit history is intentionally NOT dropped by default. To remove it too:
--   -- DROP TABLE IF EXISTS public.admin_audit_log;
--   DROP FUNCTION IF EXISTS public.assert_admin();
--   DROP FUNCTION IF EXISTS public.is_platform_admin();
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';
-- ============================================================
