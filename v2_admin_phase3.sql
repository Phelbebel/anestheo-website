-- ============================================================
-- Anestheo /v2 — ADMIN CENTER, PHASE 3
-- Backend for the Verification Center, the Moderation Center and the
-- Recycle Bin. Analytics, System Health, the Activity Center and Search need
-- no new schema — they are computed from data that already exists.
--
--   1. profiles.medical_license_number   (referenced today, never created)
--   2. doctor_verification_documents     diploma / licence / ID uploads
--   3. verification_notes                admin notes on a doctor
--   4. moderation_reports                reported doctors / patients / content
--   5. Soft-delete columns on the clinical tables (Recycle Bin)
--   6. RPCs for all of the above
--
-- SAFETY: additive, transaction-wrapped, idempotent. Nothing is hard-deleted
-- except by admin_purge_record(), which requires a server-validated typed
-- confirmation. Rollback at the bottom.
--
-- DEPENDS ON: v2_admin_phase0.sql, v2_security_hardening.sql, v2_admin_phase2.sql
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p3_has(p_rel text, p_cols text[] DEFAULT '{}')
RETURNS boolean LANGUAGE sql STABLE AS $p3$
  SELECT to_regclass(p_rel) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p_cols,'{}'::text[])) AS c(name)
            WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                               WHERE a.attrelid = to_regclass(p_rel) AND a.attname = c.name
                                 AND a.attnum > 0 AND NOT a.attisdropped));
$p3$;

DO $pre$
DECLARE v_missing text[] := '{}';
BEGIN
  IF to_regproc('public.assert_admin') IS NULL      THEN v_missing := v_missing || 'assert_admin()'::text; END IF;
  IF to_regproc('public.admin_log') IS NULL         THEN v_missing := v_missing || 'admin_log()'::text; END IF;
  IF to_regproc('public.admin_assert_target') IS NULL THEN v_missing := v_missing || 'admin_assert_target() [phase 2]'::text; END IF;
  IF NOT pg_temp.p3_has('public.profiles', ARRAY['account_status','deleted_at']) THEN
    v_missing := v_missing || 'profiles lifecycle columns [phase 2]'::text; END IF;
  RAISE NOTICE '--- Admin Phase 3 preflight -------------------------------';
  RAISE NOTICE 'MISSING DEPENDENCIES : %', COALESCE(array_to_string(v_missing,', '),'(none)');
  RAISE NOTICE '----------------------------------------------------------';
  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: apply phase 0, the security hardening and phase 2 first. Missing: %',
      array_to_string(v_missing,', ');
  END IF;
END
$pre$;

-- ============================================================
-- 1. medical_license_number
-- ============================================================
-- role-select.html writes it and admin_search reads it defensively, but no
-- migration ever created it: a doctor completing onboarding hits 42703 today.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS medical_license_number text;

-- ============================================================
-- 2. DOCTOR VERIFICATION DOCUMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.doctor_verification_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_type      text NOT NULL,
  file_name     text NOT NULL,
  storage_path  text NOT NULL,
  mime_type     text,
  file_size     int,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  uploaded_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at   timestamptz,
  reviewed_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_state  text NOT NULL DEFAULT 'pending',
  deleted_at    timestamptz,
  deleted_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  delete_reason text
);
DO $c$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='dvd_doc_type_chk') THEN
    ALTER TABLE public.doctor_verification_documents ADD CONSTRAINT dvd_doc_type_chk
      CHECK (doc_type IN ('diploma','license','passport_id','other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='dvd_review_state_chk') THEN
    ALTER TABLE public.doctor_verification_documents ADD CONSTRAINT dvd_review_state_chk
      CHECK (review_state IN ('pending','accepted','rejected'));
  END IF;
END $c$;
CREATE INDEX IF NOT EXISTS idx_dvd_doctor ON public.doctor_verification_documents(doctor_id);

ALTER TABLE public.doctor_verification_documents ENABLE ROW LEVEL SECURITY;
-- The clinician manages their own credentials; admins read everything.
DROP POLICY IF EXISTS dvd_select ON public.doctor_verification_documents;
CREATE POLICY dvd_select ON public.doctor_verification_documents
  FOR SELECT TO authenticated
  USING ( doctor_id = auth.uid() OR public.is_platform_admin() );
DROP POLICY IF EXISTS dvd_insert_own ON public.doctor_verification_documents;
CREATE POLICY dvd_insert_own ON public.doctor_verification_documents
  FOR INSERT TO authenticated WITH CHECK ( doctor_id = auth.uid() );
DROP POLICY IF EXISTS dvd_delete_own ON public.doctor_verification_documents;
CREATE POLICY dvd_delete_own ON public.doctor_verification_documents
  FOR DELETE TO authenticated USING ( doctor_id = auth.uid() AND reviewed_at IS NULL );
REVOKE ALL ON TABLE public.doctor_verification_documents FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON TABLE public.doctor_verification_documents TO authenticated;

-- ============================================================
-- 3. VERIFICATION NOTES (admin-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.verification_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vnotes_doctor ON public.verification_notes(doctor_id, created_at DESC);
ALTER TABLE public.verification_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vnotes_admin_read ON public.verification_notes;
CREATE POLICY vnotes_admin_read ON public.verification_notes
  FOR SELECT TO authenticated USING ( public.is_platform_admin() );
-- Written only through the RPC below (SECURITY DEFINER), never directly.
REVOKE ALL ON TABLE public.verification_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.verification_notes TO authenticated;

-- ============================================================
-- 4. MODERATION REPORTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.moderation_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_type     text NOT NULL,
  target_id       uuid,
  target_label    text,
  category        text NOT NULL,
  reason          text NOT NULL,
  evidence        text,
  status          text NOT NULL DEFAULT 'open',
  assigned_to     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at     timestamptz,
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_note text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  deleted_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  delete_reason   text
);
DO $c$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mr_target_type_chk') THEN
    ALTER TABLE public.moderation_reports ADD CONSTRAINT mr_target_type_chk
      CHECK (target_type IN ('doctor','patient','content','question','care_request'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mr_category_chk') THEN
    ALTER TABLE public.moderation_reports ADD CONSTRAINT mr_category_chk
      CHECK (category IN ('spam','abuse','fake_account','duplicate_account','suspicious_behaviour','other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mr_status_chk') THEN
    ALTER TABLE public.moderation_reports ADD CONSTRAINT mr_status_chk
      CHECK (status IN ('open','assigned','resolved','dismissed'));
  END IF;
END $c$;
CREATE INDEX IF NOT EXISTS idx_mr_status  ON public.moderation_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mr_target  ON public.moderation_reports(target_type, target_id);

ALTER TABLE public.moderation_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mr_select ON public.moderation_reports;
CREATE POLICY mr_select ON public.moderation_reports
  FOR SELECT TO authenticated
  USING ( reporter_id = auth.uid() OR public.is_platform_admin() );
DROP POLICY IF EXISTS mr_insert_own ON public.moderation_reports;
CREATE POLICY mr_insert_own ON public.moderation_reports
  FOR INSERT TO authenticated WITH CHECK ( reporter_id = auth.uid() AND status = 'open' );
REVOKE ALL ON TABLE public.moderation_reports FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.moderation_reports TO authenticated;

-- ============================================================
-- 5. SOFT DELETE ON THE CLINICAL TABLES (Recycle Bin)
-- ============================================================
DO $sd$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['patient_surgeries','preop_questionnaires','preop_checklist','questions'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I
        ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
        ADD COLUMN IF NOT EXISTS deleted_by uuid,
        ADD COLUMN IF NOT EXISTS delete_reason text', t);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_deleted ON public.%I(deleted_at)', t, t);
      RAISE NOTICE 'soft-delete columns present on public.%', t;
    ELSE
      RAISE NOTICE 'SKIPPED public.% (absent)', t;
    END IF;
  END LOOP;
END
$sd$;

-- ============================================================
-- 6. RPCs
-- ============================================================
-- 6a. Verification states widened: changes_requested and verification_suspended
--     join the existing approved / pending / rejected.
CREATE OR REPLACE FUNCTION public.admin_set_verification(p_target uuid, p_state text, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_before text; v_role text;
BEGIN
  PERFORM public.admin_assert_target(p_target);
  IF p_state NOT IN ('approved','pending','rejected','changes_requested','verification_suspended') THEN
    RAISE EXCEPTION 'Verification state "%" is not allowed', p_state USING ERRCODE = '22023';
  END IF;
  SELECT verification_status, role INTO v_before, v_role FROM public.profiles WHERE id = p_target;
  IF COALESCE(v_role,'') <> 'doctor' THEN
    RAISE EXCEPTION 'Verification applies to doctor accounts only' USING ERRCODE = '22023';
  END IF;
  IF p_state <> 'approved' AND NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for this verification decision' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles SET verification_status = p_state, updated_at = now() WHERE id = p_target;

  PERFORM public.admin_log(
    CASE p_state WHEN 'approved' THEN 'doctor.verify'
                 WHEN 'pending'  THEN 'doctor.unverify'
                 WHEN 'rejected' THEN 'doctor.reject'
                 WHEN 'changes_requested' THEN 'doctor.request_changes'
                 ELSE 'doctor.suspend_verification' END,
    'profile', p_target,
    (SELECT COALESCE(full_name, email) FROM public.profiles WHERE id = p_target),
    jsonb_build_object('verification_status', v_before),
    jsonb_build_object('verification_status', p_state), p_reason);
  RETURN jsonb_build_object('ok', true, 'verification_status', p_state);
END;
$$;

-- 6b. Admin note on a doctor
CREATE OR REPLACE FUNCTION public.admin_add_verification_note(p_doctor uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.assert_admin();
  IF NULLIF(btrim(COALESCE(p_note,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A note cannot be empty' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_doctor AND role = 'doctor') THEN
    RAISE EXCEPTION 'Target must be a doctor account' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.verification_notes(doctor_id, author_id, note)
  VALUES (p_doctor, auth.uid(), btrim(p_note)) RETURNING id INTO v_id;
  PERFORM public.admin_log('verification.note','profile', p_doctor,
    (SELECT COALESCE(full_name,email) FROM public.profiles WHERE id = p_doctor),
    NULL, NULL, left(btrim(p_note), 200));
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

-- 6c. Request additional documents
CREATE OR REPLACE FUNCTION public.admin_request_documents(p_doctor uuid, p_types text[], p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_t text; v_bad text[] := '{}';
BEGIN
  PERFORM public.admin_assert_target(p_doctor);
  IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A reason is required when requesting documents' USING ERRCODE = '22023';
  END IF;
  IF p_types IS NULL OR array_length(p_types,1) IS NULL THEN
    RAISE EXCEPTION 'Select at least one document type' USING ERRCODE = '22023';
  END IF;
  FOREACH v_t IN ARRAY p_types LOOP
    IF v_t NOT IN ('diploma','license','passport_id','other') THEN v_bad := v_bad || v_t; END IF;
  END LOOP;
  IF array_length(v_bad,1) IS NOT NULL THEN
    RAISE EXCEPTION 'Unknown document type(s): %', array_to_string(v_bad,', ') USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles SET verification_status = 'changes_requested', updated_at = now()
   WHERE id = p_doctor;
  INSERT INTO public.verification_notes(doctor_id, author_id, note)
  VALUES (p_doctor, auth.uid(), 'Requested: ' || array_to_string(p_types, ', ') || ' — ' || p_reason);

  PERFORM public.admin_log('doctor.request_documents','profile', p_doctor,
    (SELECT COALESCE(full_name,email) FROM public.profiles WHERE id = p_doctor),
    NULL, jsonb_build_object('requested', to_jsonb(p_types)), p_reason);
  RETURN jsonb_build_object('ok', true, 'requested', to_jsonb(p_types));
END;
$$;

-- 6d. Moderation report workflow
CREATE OR REPLACE FUNCTION public.admin_report_action(
  p_report uuid, p_action text, p_reason text DEFAULT NULL, p_assignee uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_before jsonb;
BEGIN
  PERFORM public.assert_admin();
  IF p_action NOT IN ('assign','resolve','dismiss','soft_delete') THEN
    RAISE EXCEPTION 'Action "%" is not supported', p_action USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_build_object('status',status,'assigned_to',assigned_to) INTO v_before
    FROM public.moderation_reports WHERE id = p_report;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'No report with id %', p_report USING ERRCODE = 'P0002';
  END IF;
  IF p_action IN ('resolve','dismiss','soft_delete')
     AND NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for this action' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'assign' THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_assignee
                    AND (is_admin = true OR role = 'admin') AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'A report can only be assigned to an administrator' USING ERRCODE = '22023';
    END IF;
    UPDATE public.moderation_reports
       SET assigned_to = p_assignee, assigned_at = now(), status = 'assigned' WHERE id = p_report;
  ELSIF p_action = 'resolve' THEN
    UPDATE public.moderation_reports
       SET status='resolved', resolved_at=now(), resolved_by=auth.uid(), resolution_note=p_reason
     WHERE id = p_report;
  ELSIF p_action = 'dismiss' THEN
    UPDATE public.moderation_reports
       SET status='dismissed', resolved_at=now(), resolved_by=auth.uid(), resolution_note=p_reason
     WHERE id = p_report;
  ELSE
    UPDATE public.moderation_reports
       SET deleted_at=now(), deleted_by=auth.uid(), delete_reason=p_reason WHERE id = p_report;
  END IF;

  PERFORM public.admin_log('report.'||p_action, 'moderation_report', p_report,
    (SELECT target_label FROM public.moderation_reports WHERE id = p_report),
    v_before,
    (SELECT jsonb_build_object('status',status,'assigned_to',assigned_to)
       FROM public.moderation_reports WHERE id = p_report), p_reason);
  RETURN jsonb_build_object('ok', true, 'action', p_action);
END;
$$;

-- 6e. Recycle Bin — soft delete / restore / purge for clinical records.
-- The caller passes a KEYWORD from a fixed set, never a table name. The
-- mapping to a real table happens here and nowhere else.
CREATE OR REPLACE FUNCTION public.admin_record_action(
  p_entity text, p_id uuid, p_action text, p_reason text DEFAULT NULL, p_confirm text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_tbl text; v_label text; v_n int;
BEGIN
  PERFORM public.assert_admin();
  v_tbl := CASE p_entity
             WHEN 'journey'       THEN 'patient_surgeries'
             WHEN 'questionnaire' THEN 'preop_questionnaires'
             WHEN 'checklist'     THEN 'preop_checklist'
             WHEN 'question'      THEN 'questions'
             WHEN 'care_request'  THEN 'care_requests'
             WHEN 'report'        THEN 'moderation_reports'
             ELSE NULL END;
  IF v_tbl IS NULL THEN
    RAISE EXCEPTION 'Unknown entity "%"', p_entity USING ERRCODE = '22023';
  END IF;
  IF to_regclass('public.'||v_tbl) IS NULL THEN
    RAISE EXCEPTION 'public.% is not available on this database', v_tbl USING ERRCODE = '42P01';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.'||v_tbl)
                  AND attname='deleted_at' AND attnum>0 AND NOT attisdropped) THEN
    RAISE EXCEPTION 'public.% has no soft-delete column. Apply the migration that adds it.', v_tbl
      USING ERRCODE = '42703';
  END IF;
  IF p_action NOT IN ('soft_delete','restore','purge') THEN
    RAISE EXCEPTION 'Action "%" is not supported', p_action USING ERRCODE = '22023';
  END IF;
  IF p_action <> 'restore' AND NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for this action' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'soft_delete' THEN
    EXECUTE format('UPDATE public.%I SET deleted_at=now(), deleted_by=$1, delete_reason=$2
                     WHERE id=$3 AND deleted_at IS NULL', v_tbl) USING auth.uid(), p_reason, p_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN RAISE EXCEPTION 'Record not found or already deleted' USING ERRCODE='P0002'; END IF;
  ELSIF p_action = 'restore' THEN
    EXECUTE format('UPDATE public.%I SET deleted_at=NULL, deleted_by=NULL, delete_reason=NULL
                     WHERE id=$1 AND deleted_at IS NOT NULL', v_tbl) USING p_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN RAISE EXCEPTION 'Record not found or not deleted' USING ERRCODE='P0002'; END IF;
  ELSE
    IF p_confirm IS DISTINCT FROM 'DELETE' THEN
      RAISE EXCEPTION 'Type DELETE to confirm permanent deletion' USING ERRCODE = '22023';
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE id=$1 AND deleted_at IS NOT NULL', v_tbl)
      INTO v_n USING p_id;
    IF v_n = 0 THEN
      RAISE EXCEPTION 'Soft delete the record first. Permanent deletion is never the first step.'
        USING ERRCODE = '22023';
    END IF;
    -- Audit before destroying.
    PERFORM public.admin_log('record.permanent_delete', p_entity, p_id, NULL, NULL, NULL, p_reason);
    EXECUTE format('DELETE FROM public.%I WHERE id=$1', v_tbl) USING p_id;
    RETURN jsonb_build_object('ok', true, 'action', 'purge', 'entity', p_entity);
  END IF;

  PERFORM public.admin_log('record.'||p_action, p_entity, p_id, NULL, NULL, NULL, p_reason);
  RETURN jsonb_build_object('ok', true, 'action', p_action, 'entity', p_entity);
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
    'admin_add_verification_note(uuid,text)',
    'admin_request_documents(uuid,text[],text)',
    'admin_report_action(uuid,text,text,uuid)',
    'admin_record_action(text,uuid,text,text,text)'
  ] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.'||f||' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||f||' TO authenticated';
  END LOOP;
END
$g$;

-- ============================================================
-- POST-VERIFY
-- ============================================================
DO $v$
BEGIN
  RAISE NOTICE 'V1 profiles.medical_license_number : %', pg_temp.p3_has('public.profiles', ARRAY['medical_license_number']);
  RAISE NOTICE 'V2 doctor_verification_documents   : %', (to_regclass('public.doctor_verification_documents') IS NOT NULL);
  RAISE NOTICE 'V3 verification_notes              : %', (to_regclass('public.verification_notes') IS NOT NULL);
  RAISE NOTICE 'V4 moderation_reports              : %', (to_regclass('public.moderation_reports') IS NOT NULL);
  RAISE NOTICE 'V5 soft delete on journeys         : %', pg_temp.p3_has('public.patient_surgeries', ARRAY['deleted_at']);
  RAISE NOTICE 'V6 phase 3 RPCs                    : %',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN
      ('admin_add_verification_note','admin_request_documents','admin_report_action','admin_record_action'));
END
$v$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- ROLLBACK
-- ============================================================
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.admin_record_action(text,uuid,text,text,text);
--   DROP FUNCTION IF EXISTS public.admin_report_action(uuid,text,text,uuid);
--   DROP FUNCTION IF EXISTS public.admin_request_documents(uuid,text[],text);
--   DROP FUNCTION IF EXISTS public.admin_add_verification_note(uuid,text);
--   -- restore the phase 2 admin_set_verification (narrower state list)
--   -- re-run section 4a of v2_admin_phase2.sql
--   DROP TABLE IF EXISTS public.moderation_reports;
--   DROP TABLE IF EXISTS public.verification_notes;
--   DROP TABLE IF EXISTS public.doctor_verification_documents;
--   -- soft-delete columns hold real deletion history; drop only if you accept losing it:
--   -- ALTER TABLE public.patient_surgeries    DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS delete_reason;
--   -- ALTER TABLE public.preop_questionnaires DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS delete_reason;
--   -- ALTER TABLE public.preop_checklist      DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS delete_reason;
--   -- ALTER TABLE public.profiles             DROP COLUMN IF EXISTS medical_license_number;
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';
-- ============================================================
