-- ============================================================
-- PURGE SAFETY + RECYCLE BIN AUTHORIZATION
--
-- v4 blocked permanent deletion when a FINALIZED anesthesia record existed.
-- That was not enough. The real FK topology, read from pg_constraint rather
-- than from comments, is:
--
--   parent              child                    fk column          on delete
--   patient_surgeries   anesthesia_cases         surgery_id         SET NULL   <-- DETACHES A LIVE CHART
--   patient_surgeries   care_requests            surgery_id         CASCADE
--   patient_surgeries   patient_recommendations  surgery_id         CASCADE
--   patient_surgeries   preparation_plans        surgery_id         CASCADE
--   patient_surgeries   requirement_documents    surgery_id         CASCADE
--   patient_surgeries   preop_checklist          surgery_id         SET NULL
--   patient_surgeries   preop_questionnaires     surgery_id         SET NULL
--   patient_surgeries   questions                surgery_id         SET NULL
--   clinic_patients     anesthesia_cases         clinic_patient_id  SET NULL   <-- DETACHES A LIVE CHART
--   clinic_patients     patient_surgeries        clinic_patient_id  SET NULL
--
-- So a purge that passed v4's check would still have destroyed four kinds of
-- clinical record outright and quietly orphaned four more — including the
-- anesthesia case, whose surgery_id would simply become NULL. The finalized
-- record would survive as a row while losing the patient it documents, which
-- is arguably worse than deleting it: a signed chart attached to nobody.
--
-- The FKs are NOT changed here. Rewriting long-standing ON DELETE behaviour on
-- clinical tables is a far more dangerous act than refusing a purge, and the
-- brief asks for a structured refusal instead. The rule below therefore never
-- relies on cascade semantics being benign — it refuses before DELETE runs.
--
-- SAFETY: additive, idempotent, transaction-wrapped. Only removes capability.
-- ============================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regproc('public.patient_purge_eligibility') IS NULL THEN
    RAISE EXCEPTION 'ABORT: apply v4_patient_lifecycle.sql first.';
  END IF;
  RAISE NOTICE 'Preflight OK.';
END
$preflight$;

-- ============================================================
-- 1. DEPENDENCY INVENTORY, COMPUTED FROM LIVE METADATA
-- ============================================================
-- Reads pg_constraint at call time rather than hard-coding a table list, so a
-- FK added tomorrow is counted tomorrow instead of being silently ignored by a
-- stale array. That is the difference between a preview that is true and one
-- that was true when it was written.
CREATE OR REPLACE FUNCTION public.patient_purge_dependencies(p_kind text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_parent regclass;
  r record;
  v_n bigint;
  v_delete jsonb := '[]'::jsonb;
  v_detach jsonb := '[]'::jsonb;
  v_clinical jsonb := '[]'::jsonb;
  -- Tables whose rows are clinical history. Losing or orphaning one of these
  -- is not acceptable collateral for tidying a patient list.
  v_clinical_tables text[] := ARRAY[
    'anesthesia_cases','patient_recommendations','preparation_plans',
    'requirement_documents','preop_questionnaires','preop_checklist',
    'care_requests','questions'
  ];
BEGIN
  IF lower(COALESCE(p_kind,'')) = 'journey' THEN v_parent := 'public.patient_surgeries'::regclass;
  ELSIF lower(COALESCE(p_kind,'')) = 'clinic_patient' THEN v_parent := 'public.clinic_patients'::regclass;
  ELSE RETURN jsonb_build_object('error','invalid_kind');
  END IF;

  FOR r IN
    SELECT c.conrelid::regclass::text AS child,
           (SELECT a.attname FROM unnest(c.conkey) k
              JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k LIMIT 1) AS col,
           CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
                WHEN 'r' THEN 'RESTRICT' WHEN 'a' THEN 'NO ACTION' ELSE 'SET DEFAULT' END AS act
      FROM pg_constraint c
     WHERE c.contype='f' AND c.confrelid = v_parent
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', r.child, r.col)
      INTO v_n USING p_id;
    CONTINUE WHEN v_n = 0;

    IF r.act = 'CASCADE' THEN
      v_delete := v_delete || jsonb_build_object('table', r.child, 'column', r.col, 'rows', v_n);
    ELSE
      v_detach := v_detach || jsonb_build_object('table', r.child, 'column', r.col,
                                                 'rows', v_n, 'on_delete', r.act);
    END IF;

    IF replace(r.child,'public.','') = ANY (v_clinical_tables) THEN
      v_clinical := v_clinical || jsonb_build_object('table', r.child, 'rows', v_n,
                                                     'on_delete', r.act);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'records_to_delete', v_delete,   -- CASCADE: physically destroyed
    'records_to_detach', v_detach,   -- SET NULL: orphaned, link lost
    'clinical_dependencies', v_clinical);
END;
$$;
REVOKE ALL ON FUNCTION public.patient_purge_dependencies(text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patient_purge_dependencies(text,uuid) TO authenticated;

-- ============================================================
-- 2. THE PURGE RULE
-- ============================================================
-- Order matters, and it is deliberate: authorization, then existence, then
-- "is it even in the bin", then Live Chart, then everything else clinical.
-- The most specific and most serious refusal is reported first, so the UI
-- never says "there are 3 dependent records" when the real answer is "there
-- is a signed anesthesia chart".
CREATE OR REPLACE FUNCTION public.patient_purge_eligibility(p_kind text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind text := lower(COALESCE(p_kind,''));
  v_del timestamptz; v_found boolean := false;
  v_final int := 0; v_active int := 0;
  v_deps jsonb; v_clin jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RETURN jsonb_build_object('eligible',false,'code','not_authorized',
      'reason','Permanent deletion is an administrator action.');
  END IF;
  IF p_id IS NULL OR v_kind NOT IN ('journey','clinic_patient') THEN
    RETURN jsonb_build_object('eligible',false,'code','invalid_input','reason','Unknown record.');
  END IF;

  IF v_kind = 'journey' THEN
    SELECT true, deleted_at INTO v_found, v_del FROM public.patient_surgeries WHERE id = p_id;
  ELSE
    SELECT true, deleted_at INTO v_found, v_del FROM public.clinic_patients WHERE id = p_id;
  END IF;
  IF NOT COALESCE(v_found,false) THEN
    RETURN jsonb_build_object('eligible',false,'code','record_not_found',
      'reason','That record no longer exists.');
  END IF;
  IF v_del IS NULL THEN
    RETURN jsonb_build_object('eligible',false,'code','not_deleted',
      'reason','Only records already in the Recycle Bin can be permanently deleted.');
  END IF;

  -- ── Live Chart. ANY case blocks, not only a finalized one. ──────────────
  -- A draft or in-progress chart is an unresolved clinical record; deleting
  -- the patient underneath it would SET NULL its surgery_id and leave a chart
  -- documenting nobody. Two distinct codes because the remedies differ: an
  -- open chart can be finished or withdrawn, a signed one never goes away.
  IF to_regclass('public.anesthesia_cases') IS NOT NULL THEN
    IF v_kind = 'journey' THEN
      SELECT count(*) FILTER (WHERE status='finalized'),
             count(*) FILTER (WHERE status <> 'finalized')
        INTO v_final, v_active FROM public.anesthesia_cases WHERE surgery_id = p_id;
    ELSE
      SELECT count(*) FILTER (WHERE status='finalized'),
             count(*) FILTER (WHERE status <> 'finalized')
        INTO v_final, v_active FROM public.anesthesia_cases WHERE clinic_patient_id = p_id;
    END IF;

    IF v_final > 0 THEN
      RETURN jsonb_build_object('eligible',false,'code','retained_clinical_record',
        'reason', v_final || ' signed anesthesia record(s) reference this patient. A finalized '
                  || 'record is retained clinical documentation and is never destroyed or detached '
                  || 'by patient cleanup.',
        'finalized_cases', v_final, 'open_cases', v_active,
        'blocking_records', jsonb_build_array(
          jsonb_build_object('table','anesthesia_cases','rows',v_final,'state','finalized')));
    END IF;
    IF v_active > 0 THEN
      RETURN jsonb_build_object('eligible',false,'code','active_clinical_record',
        'reason', v_active || ' anesthesia record(s) are still open for this patient. '
                  || 'Resolve or withdraw them before deleting the patient.',
        'finalized_cases', 0, 'open_cases', v_active,
        'blocking_records', jsonb_build_array(
          jsonb_build_object('table','anesthesia_cases','rows',v_active,'state','draft_or_in_progress')));
    END IF;
  END IF;

  -- ── Everything else clinical. ───────────────────────────────────────────
  -- The FK topology would cascade-destroy recommendations, preparation plans,
  -- requirement documents and care requests, and orphan questionnaires,
  -- checklists and questions. None of that is disposable, so its presence
  -- refuses the purge rather than being accepted as collateral.
  v_deps := public.patient_purge_dependencies(v_kind, p_id);
  v_clin := v_deps->'clinical_dependencies';
  IF jsonb_array_length(COALESCE(v_clin,'[]'::jsonb)) > 0 THEN
    RETURN jsonb_build_object('eligible',false,'code','clinical_dependencies',
      'reason','This patient still has clinical records attached. Permanent deletion would '
               || 'destroy or orphan them, so it is refused.',
      'dependencies', v_deps,
      'blocking_records', v_clin);
  END IF;

  RETURN jsonb_build_object('eligible',true,'code','eligible',
    'reason','No clinical records are attached. This record and any remaining non-clinical '
             || 'dependent rows will be permanently destroyed.',
    'dependencies', v_deps,
    'records_to_delete', v_deps->'records_to_delete',
    'records_to_detach', v_deps->'records_to_detach',
    'blocking_records', '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.patient_purge_eligibility(text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patient_purge_eligibility(text,uuid) TO authenticated;

-- ============================================================
-- 3. CONTRACT CLEANUP — codes that mean what they say
-- ============================================================
-- v4 returned 'already_archived' when asked to restore a record that was not
-- archived, and 'already_deleted' when asked to restore one that was not
-- deleted. Both are actively misleading to a UI that will branch on the code.
-- Replaced with not_archived / not_deleted.
CREATE OR REPLACE FUNCTION public.patient_lifecycle_eligibility(
  p_kind text, p_id uuid, p_action text DEFAULT 'archive')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind text := lower(COALESCE(p_kind,''));
  v_act  text := lower(COALESCE(p_action,'archive'));
  v_arch timestamptz; v_del timestamptz; v_found boolean := false;
  v_admin boolean := public.is_platform_admin();
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('eligible',false,'code','not_authorized','reason','You are not signed in.');
  END IF;
  IF p_id IS NULL OR v_kind NOT IN ('journey','clinic_patient') THEN
    RETURN jsonb_build_object('eligible',false,'code','invalid_input',
      'reason','A record type of journey or clinic_patient and an id are required.');
  END IF;
  IF v_act NOT IN ('archive','restore_archive','delete','restore_delete') THEN
    RETURN jsonb_build_object('eligible',false,'code','invalid_input','reason','Unknown action.');
  END IF;

  IF v_kind = 'journey' THEN
    SELECT true, archived_at, deleted_at INTO v_found, v_arch, v_del
      FROM public.patient_surgeries WHERE id = p_id;
  ELSE
    SELECT true, archived_at, deleted_at INTO v_found, v_arch, v_del
      FROM public.clinic_patients WHERE id = p_id;
  END IF;

  IF NOT COALESCE(v_found,false) THEN
    RETURN jsonb_build_object('eligible',false,'code','record_not_found',
      'reason','That record no longer exists.');
  END IF;
  IF NOT (v_admin OR public.patient_record_manageable(v_kind, p_id)) THEN
    RETURN jsonb_build_object('eligible',false,'code','not_authorized',
      'reason','This patient is managed by another doctor.');
  END IF;

  IF v_act = 'archive' THEN
    IF v_del  IS NOT NULL THEN RETURN jsonb_build_object('eligible',false,'code','already_deleted','reason','This record is in the Recycle Bin.'); END IF;
    IF v_arch IS NOT NULL THEN RETURN jsonb_build_object('eligible',false,'code','already_archived','reason','This record is already archived.'); END IF;
  ELSIF v_act = 'restore_archive' THEN
    IF v_del  IS NOT NULL THEN RETURN jsonb_build_object('eligible',false,'code','already_deleted','reason','Restore it from the Recycle Bin first.'); END IF;
    IF v_arch IS NULL     THEN RETURN jsonb_build_object('eligible',false,'code','not_archived','reason','This record is not archived.'); END IF;
  ELSIF v_act = 'delete' THEN
    IF v_del  IS NOT NULL THEN RETURN jsonb_build_object('eligible',false,'code','already_deleted','reason','This record is already in the Recycle Bin.'); END IF;
  ELSIF v_act = 'restore_delete' THEN
    IF v_del  IS NULL     THEN RETURN jsonb_build_object('eligible',false,'code','not_deleted','reason','This record is not deleted.'); END IF;
  END IF;

  IF v_act = 'archive' AND v_kind = 'journey'
     AND EXISTS (SELECT 1 FROM public.care_requests cr
                  WHERE cr.surgery_id = p_id AND cr.status = 'requested'
                    AND cr.deleted_at IS NULL) THEN
    RETURN jsonb_build_object('eligible',false,'code','clinical_blocker',
      'reason','A consultation request is still open for this patient. Resolve it first.');
  END IF;

  RETURN jsonb_build_object('eligible',true,'code','eligible',
    'reason', CASE v_act
                WHEN 'archive'         THEN 'Moves the patient to Archived. Nothing is deleted.'
                WHEN 'restore_archive' THEN 'Returns the patient to the active list.'
                WHEN 'delete'          THEN 'Moves the patient to the Recycle Bin. Recoverable.'
                ELSE 'Restores the patient from the Recycle Bin.' END,
    'warnings', CASE WHEN v_act='archive' AND v_kind='journey'
                       AND EXISTS (SELECT 1 FROM public.questions q
                                    WHERE q.surgery_id = p_id AND q.status <> 'answered'
                                      AND q.deleted_at IS NULL)
                     THEN jsonb_build_array('This patient has an unanswered question.')
                     ELSE '[]'::jsonb END);
END;
$$;

-- ============================================================
-- 4. RECYCLE BIN — authorized by RPC, not by hoping about base RLS
-- ============================================================
-- The v4 view is security_invoker, so its safety rested entirely on the base
-- policies of patient_surgeries and clinic_patients. That is an assumption,
-- not a guarantee: those policies were written for clinical lists, not for a
-- deleted-items workspace, and a permissive admin-read policy on either table
-- would expose every doctor's bin to every caller.
--
-- This function answers the question directly and positively: a verified
-- doctor sees the records they manage, an admin sees all, and nobody else
-- receives a row. The view is kept for compatibility but the UI should use
-- this.
CREATE OR REPLACE FUNCTION public.recycle_bin_list()
RETURNS TABLE (
  kind text, id uuid, label text, detail text,
  deleted_at timestamptz, deleted_by uuid, deleted_by_name text, delete_reason text,
  restorable boolean, purge_eligible boolean, purge_code text, purge_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_admin boolean := public.is_platform_admin();
BEGIN
  -- A patient, an anon caller or a pending doctor gets an empty set, never an
  -- error: the bin simply does not exist for them.
  IF NOT (v_admin OR public.is_verified_doctor()) THEN RETURN; END IF;

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
REVOKE ALL ON FUNCTION public.recycle_bin_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recycle_bin_list() TO authenticated;

-- ============================================================
-- 5. RETIRE THE LEAKING VIEW
-- ============================================================
-- Proven, not assumed. Through the v4 security_invoker view a PATIENT could
-- read a clinician's deleted journey:
--     SET request.jwt.claim.sub = '<a patient uuid>';
--     SELECT kind,label,delete_reason FROM recycle_bin;
--       -> journey | Lifecycle Test | for purge test
-- patient_surgeries.patient_id = that patient, so the base SELECT policy that
-- correctly lets a patient see their own surgical journey also handed them the
-- deleted-items workspace. The view was not wrong about RLS; it inherited a
-- policy written for a different question.
--
-- Dropped rather than patched: leaving a view that returns the right answer
-- only for some callers is how it gets used again. recycle_bin_list() asks
-- the authorization question positively instead.
DROP VIEW IF EXISTS public.recycle_bin;

DO $done$
BEGIN
  RAISE NOTICE '--- Purge safety installed -------------------------------';
  RAISE NOTICE '  ANY anesthesia case blocks purge (open vs signed distinguished)';
  RAISE NOTICE '  clinical dependencies block purge; preview computed from live FKs';
  RAISE NOTICE '  recycle_bin_list() is authorization-positive, not RLS-dependent';
  RAISE NOTICE '  codes: not_archived / not_deleted replace the misleading pair';
  RAISE NOTICE '----------------------------------------------------------';
END
$done$;

COMMIT;

-- ROLLBACK: re-apply v4_patient_lifecycle.sql to restore the previous
-- eligibility function, then DROP FUNCTION patient_purge_dependencies(text,uuid)
-- and recycle_bin_list(). No data is touched by this migration.
