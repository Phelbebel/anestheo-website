-- ============================================================
-- Anestheo /v2 — PATIENT SURGERY JOURNEYS, PHASE 1 (CORRECTED)
-- ** REVIEW COPY — NOT APPLIED **
--
-- Replaces the earlier rejected draft. All three blockers found in the
-- production review are fixed:
--   B1  patient_surgeries UNIQUE(patient_id) blocked a second journey
--       -> replaced by a PARTIAL unique index: one ACTIVE journey per patient.
--   B2  ON DELETE CASCADE silently changed admin_delete_patient and
--       claim_patient_record
--       -> every new FK is ON DELETE SET NULL; journey children are removed by
--          EXPLICIT ordered deletes inside patient_delete_journey() only.
--   B3  questionnaire/checklist stayed UNIQUE(patient_id) so journeys shared rows
--       -> per-journey unique indexes, added only AFTER backfill validation.
--
-- Ships together with the frontend compatibility changes in the same release
-- (auth.js, patient-dashboard.html, dashboard.html) — see section 0.
--
-- SAFETY: transaction-wrapped, additive-first, idempotent, staged, and it
-- ABORTS ITSELF if the backfill would violate the new constraints.
-- Run in the Supabase SQL editor. Pure ASCII.
-- ============================================================

-- ------------------------------------------------------------
-- 0. RELEASE COUPLING (must ship in the SAME deploy)
--    auth.js                 getQuestionnaire/saveQuestionnaire/getChecklist/
--                            saveChecklist become journey-aware; the
--                            onConflict:'patient_id' upserts are removed.
--    patient-dashboard.html  saveSurgery() updates the active journey by id and
--                            inserts a new row only when none exists.
--    dashboard.html          doctor reads resolve the journey's questionnaire /
--                            checklist instead of assuming one row per patient.
--    index.html              Manage Journey calls the RPCs below.
-- ------------------------------------------------------------

BEGIN;

-- ============================================================
-- STAGE 1 — ADDITIVE: nullable journey keys. No behaviour change yet.
-- ON DELETE SET NULL (never CASCADE) so deleting a surgery can NEVER silently
-- destroy a questionnaire/checklist through an FK. That keeps
-- admin_delete_patient and claim_patient_record exactly as they behave today.
-- ============================================================
ALTER TABLE public.preop_questionnaires
  ADD COLUMN IF NOT EXISTS surgery_id uuid REFERENCES public.patient_surgeries(id) ON DELETE SET NULL;
ALTER TABLE public.preop_checklist
  ADD COLUMN IF NOT EXISTS surgery_id uuid REFERENCES public.patient_surgeries(id) ON DELETE SET NULL;
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS surgery_id uuid REFERENCES public.patient_surgeries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_preop_q_surgery   ON public.preop_questionnaires(surgery_id);
CREATE INDEX IF NOT EXISTS idx_preop_chk_surgery ON public.preop_checklist(surgery_id);
CREATE INDEX IF NOT EXISTS idx_questions_surgery ON public.questions(surgery_id);

-- ============================================================
-- STAGE 2 — BACKFILL (deterministic)
-- Today patient_surgeries still carries UNIQUE(patient_id), so each patient has
-- AT MOST ONE surgery row: the join below can match at most one row and cannot
-- be ambiguous. Rows whose patient has no surgery row keep surgery_id = NULL and
-- are reported in STAGE 3 as "legacy / unresolved" — never guessed, never
-- deleted, and still fully readable by their owner.
-- ============================================================
UPDATE public.preop_questionnaires q
   SET surgery_id = s.id
  FROM public.patient_surgeries s
 WHERE q.surgery_id IS NULL AND s.patient_id = q.patient_id;

UPDATE public.preop_checklist c
   SET surgery_id = s.id
  FROM public.patient_surgeries s
 WHERE c.surgery_id IS NULL AND s.patient_id = c.patient_id;

-- Questions stay PATIENT-level by default (see the mapping in the report): a
-- patient may ask general questions that outlive any single surgery. We only
-- attach the ones that clearly belong to the patient's single existing journey,
-- so history is preserved without forcing a journey on general questions.
UPDATE public.questions qq
   SET surgery_id = s.id
  FROM public.patient_surgeries s
 WHERE qq.surgery_id IS NULL AND s.patient_id = qq.patient_id;

-- ============================================================
-- STAGE 3 — VALIDATE BEFORE ANY CONSTRAINT CHANGE. Abort if unsafe.
-- ============================================================
DO $$
DECLARE
  v_dup_q   int;
  v_dup_c   int;
  v_dup_act int;
BEGIN
  -- would the per-journey unique indexes be violated?
  SELECT count(*) INTO v_dup_q FROM (
    SELECT surgery_id FROM public.preop_questionnaires
     WHERE surgery_id IS NOT NULL GROUP BY surgery_id HAVING count(*) > 1) t;
  SELECT count(*) INTO v_dup_c FROM (
    SELECT surgery_id FROM public.preop_checklist
     WHERE surgery_id IS NOT NULL GROUP BY surgery_id HAVING count(*) > 1) t;
  -- would the "one ACTIVE journey per patient" index be violated?
  SELECT count(*) INTO v_dup_act FROM (
    SELECT patient_id FROM public.patient_surgeries
     WHERE patient_id IS NOT NULL AND archived_at IS NULL AND completed_at IS NULL
     GROUP BY patient_id HAVING count(*) > 1) t;

  IF v_dup_q > 0 OR v_dup_c > 0 OR v_dup_act > 0 THEN
    RAISE EXCEPTION
      'ABORT: backfill validation failed (questionnaire dups=%, checklist dups=%, multi-active journeys=%). No constraint was changed.',
      v_dup_q, v_dup_c, v_dup_act;
  END IF;

  RAISE NOTICE 'Backfill validation passed. Legacy rows without a journey: questionnaires=%, checklists=%, questions=%',
    (SELECT count(*) FROM public.preop_questionnaires WHERE surgery_id IS NULL),
    (SELECT count(*) FROM public.preop_checklist      WHERE surgery_id IS NULL),
    (SELECT count(*) FROM public.questions            WHERE surgery_id IS NULL);
END $$;

-- ============================================================
-- STAGE 4 — NEW CONSTRAINTS (added BEFORE the old ones are dropped)
-- ============================================================
-- One ACTIVE journey per patient. Archived or completed journeys are unlimited,
-- so history accumulates. patient_id IS NULL (doctor-created, pre-claim) is
-- excluded, matching today's behaviour where UNIQUE allowed many NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_journey_per_patient
  ON public.patient_surgeries (patient_id)
  WHERE patient_id IS NOT NULL AND archived_at IS NULL AND completed_at IS NULL;

-- One questionnaire / checklist per journey ...
CREATE UNIQUE INDEX IF NOT EXISTS uniq_preop_q_per_journey
  ON public.preop_questionnaires (surgery_id) WHERE surgery_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_preop_chk_per_journey
  ON public.preop_checklist (surgery_id) WHERE surgery_id IS NOT NULL;
-- ... and at most one LEGACY (journey-less) row per patient, so the old
-- one-row-per-patient guarantee still holds for unresolved data.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_preop_q_legacy
  ON public.preop_questionnaires (patient_id) WHERE surgery_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_preop_chk_legacy
  ON public.preop_checklist (patient_id) WHERE surgery_id IS NULL;

-- ============================================================
-- STAGE 5 — DROP THE OBSOLETE GLOBAL UNIQUE CONSTRAINTS
-- Only reached because STAGE 3 passed and STAGE 4 succeeded. Constraint names
-- are the PostgreSQL defaults from the original CREATE TABLE statements; the
-- preflight prints the real names so they can be confirmed first.
-- ============================================================
ALTER TABLE public.patient_surgeries    DROP CONSTRAINT IF EXISTS patient_surgeries_patient_id_key;
ALTER TABLE public.preop_questionnaires DROP CONSTRAINT IF EXISTS preop_questionnaires_patient_id_key;
ALTER TABLE public.preop_checklist      DROP CONSTRAINT IF EXISTS preop_checklist_patient_id_key;

-- ============================================================
-- STAGE 6 — JOURNEY RPCs (patient-owned, least privilege)
-- SECURITY DEFINER is required: archived_at is a system-managed column that the
-- guard trigger blocks for the 'authenticated' role, and deletes must be able to
-- reach journey children without granting the client broad table rights.
-- No new table GRANTs are issued anywhere in this migration.
-- ============================================================

-- Resolve the caller's active journey (helper; no privilege of its own).
CREATE OR REPLACE FUNCTION public.patient_active_journey()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.id FROM public.patient_surgeries s
   WHERE s.patient_id = auth.uid() AND s.archived_at IS NULL AND s.completed_at IS NULL
   ORDER BY s.created_at DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.patient_active_journey() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patient_active_journey() TO authenticated;

-- ARCHIVE ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.patient_archive_journey(p_surgery_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_ps public.patient_surgeries%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='28000'; END IF;
  SELECT * INTO v_ps FROM public.patient_surgeries WHERE id = p_surgery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Journey not found'; END IF;
  IF v_ps.patient_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'You can only archive your own surgery journey' USING ERRCODE='42501';
  END IF;
  IF v_ps.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('archived_at', v_ps.archived_at, 'already', true);
  END IF;

  UPDATE public.patient_surgeries
     SET archived_at = now(), archived_by = v_uid, archive_reason = 'patient_self_archive',
         restored_at = NULL, restored_by = NULL, updated_at = now()
   WHERE id = p_surgery_id;

  -- Reuse the EXISTING audit mechanism (patient_archive_audit).
  INSERT INTO public.patient_archive_audit
        (surgery_id, clinic_patient_id, patient_name, actor_id, actor_role, action, reason, prev_archived_at)
  VALUES (p_surgery_id, v_ps.clinic_patient_id, v_ps.patient_name, v_uid, 'patient', 'archive',
          'patient_self_archive', NULL);

  RETURN jsonb_build_object('archived_at', now(), 'surgery_id', p_surgery_id);
END; $$;
REVOKE ALL ON FUNCTION public.patient_archive_journey(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patient_archive_journey(uuid) TO authenticated;

-- START NEW ----------------------------------------------------------------
-- Archives the current active journey first, so the partial unique index is
-- always satisfied and preparation data can never span two journeys.
CREATE OR REPLACE FUNCTION public.patient_start_journey()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_active uuid; v_new uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='28000'; END IF;

  SELECT id INTO v_active FROM public.patient_surgeries
   WHERE patient_id = v_uid AND archived_at IS NULL AND completed_at IS NULL
   ORDER BY created_at DESC LIMIT 1;

  IF v_active IS NOT NULL THEN
    PERFORM public.patient_archive_journey(v_active);   -- audited, ownership-checked
  END IF;

  INSERT INTO public.patient_surgeries (patient_id, care_state, origin)
  VALUES (v_uid, 'surgical', 'patient')
  RETURNING id INTO v_new;

  -- Deliberately creates NO questionnaire/checklist rows: the new journey starts
  -- clean and the app creates them on first save, scoped to this surgery_id.
  RETURN jsonb_build_object('surgery_id', v_new, 'archived_previous', v_active);
END; $$;
REVOKE ALL ON FUNCTION public.patient_start_journey() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patient_start_journey() TO authenticated;

-- DELETE -------------------------------------------------------------------
-- Explicit, ordered, journey-scoped deletes. Never touches auth.users,
-- public.profiles, another journey, or another patient's data. The typed
-- confirmation is validated HERE, server-side.
CREATE OR REPLACE FUNCTION public.patient_delete_journey(p_surgery_id uuid, p_confirm text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_ps public.patient_surgeries%ROWTYPE; v_counts jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='28000'; END IF;
  IF p_confirm IS DISTINCT FROM 'DELETE' THEN
    RAISE EXCEPTION 'Deletion requires explicit confirmation' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_ps FROM public.patient_surgeries WHERE id = p_surgery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Journey not found'; END IF;
  IF v_ps.patient_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'You can only delete your own surgery journey' USING ERRCODE='42501';
  END IF;

  v_counts := jsonb_build_object(
    'questionnaires', (SELECT count(*) FROM public.preop_questionnaires   WHERE surgery_id = p_surgery_id),
    'checklists',     (SELECT count(*) FROM public.preop_checklist        WHERE surgery_id = p_surgery_id),
    'documents',      (SELECT count(*) FROM public.requirement_documents  WHERE surgery_id = p_surgery_id),
    'plans',          (SELECT count(*) FROM public.preparation_plans      WHERE surgery_id = p_surgery_id),
    'recommendations',(SELECT count(*) FROM public.patient_recommendations WHERE surgery_id = p_surgery_id),
    'care_requests',  (SELECT count(*) FROM public.care_requests          WHERE surgery_id = p_surgery_id));

  -- Audit BEFORE the delete (patient_archive_audit.surgery_id has no FK, so the
  -- record survives the row it describes).
  INSERT INTO public.patient_archive_audit
        (surgery_id, clinic_patient_id, patient_name, actor_id, actor_role, action, reason, prev_archived_at)
  VALUES (p_surgery_id, v_ps.clinic_patient_id, v_ps.patient_name, v_uid, 'patient', 'delete',
          'patient_self_delete ' || v_counts::text, v_ps.archived_at);

  -- Ordered, explicit, journey-scoped only.
  DELETE FROM public.preop_questionnaires   WHERE surgery_id = p_surgery_id;
  DELETE FROM public.preop_checklist        WHERE surgery_id = p_surgery_id;
  DELETE FROM public.requirement_documents  WHERE surgery_id = p_surgery_id;
  DELETE FROM public.preparation_plans      WHERE surgery_id = p_surgery_id;
  DELETE FROM public.patient_recommendations WHERE surgery_id = p_surgery_id;
  DELETE FROM public.care_requests          WHERE surgery_id = p_surgery_id;
  -- General questions are preserved and simply detached from the journey.
  UPDATE public.questions SET surgery_id = NULL WHERE surgery_id = p_surgery_id;

  DELETE FROM public.patient_surgeries WHERE id = p_surgery_id AND patient_id = v_uid;

  RETURN jsonb_build_object('deleted', true, 'surgery_id', p_surgery_id, 'removed', v_counts);
END; $$;
REVOKE ALL ON FUNCTION public.patient_delete_journey(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patient_delete_journey(uuid, text) TO authenticated;

-- ============================================================
-- STAGE 7 — claim_patient_record COMPATIBILITY
-- The shipped version re-points requirement_documents, patient_recommendations,
-- preparation_plans and care_requests, then deletes the patient's self-created
-- shell row. It predates surgery_id on questionnaires/checklists, so those would
-- be left pointing at a deleted journey (the FK would NULL them, losing the
-- link). Re-created here with the two extra re-points; the rest of the body and
-- all of its semantics are byte-for-byte the shipped behaviour.
-- ============================================================
DROP FUNCTION IF EXISTS public.claim_patient_record(uuid, uuid);
CREATE FUNCTION public.claim_patient_record(p_surgery uuid, p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_existing uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  PERFORM 1 FROM public.patient_surgeries
    WHERE id = p_surgery AND claim_token = p_token AND patient_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid or already-claimed record'; END IF;

  SELECT id INTO v_existing FROM public.patient_surgeries WHERE patient_id = v_uid LIMIT 1;
  IF v_existing IS NULL THEN
    UPDATE public.patient_surgeries SET patient_id = v_uid WHERE id = p_surgery;
    RETURN jsonb_build_object('linked', p_surgery, 'merged', false);
  ELSE
    UPDATE public.requirement_documents   SET surgery_id = p_surgery WHERE surgery_id = v_existing;
    UPDATE public.patient_recommendations SET surgery_id = p_surgery WHERE surgery_id = v_existing;
    UPDATE public.preparation_plans       SET surgery_id = p_surgery WHERE surgery_id = v_existing;
    UPDATE public.care_requests           SET surgery_id = p_surgery WHERE surgery_id = v_existing;
    -- NEW: keep the patient's questionnaire/checklist attached to the surviving
    -- journey instead of letting them be orphaned by the shell delete.
    UPDATE public.preop_questionnaires    SET surgery_id = p_surgery WHERE surgery_id = v_existing;
    UPDATE public.preop_checklist         SET surgery_id = p_surgery WHERE surgery_id = v_existing;
    UPDATE public.questions               SET surgery_id = p_surgery WHERE surgery_id = v_existing;
    DELETE FROM public.patient_surgeries WHERE id = v_existing;
    UPDATE public.patient_surgeries SET patient_id = v_uid WHERE id = p_surgery;
    RETURN jsonb_build_object('linked', p_surgery, 'merged', true);
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.claim_patient_record(uuid, uuid) TO authenticated;

-- NOTE on admin_delete_patient: intentionally NOT modified. Because every new FK
-- is ON DELETE SET NULL, its documented promise ("the patient's questionnaire is
-- intentionally NOT destroyed") still holds exactly; the questionnaire simply
-- has its surgery_id set to NULL and becomes a legacy row owned by the patient.

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- PREFLIGHT (READ-ONLY) — run BEFORE applying
-- ============================================================
-- P1. Real names of the constraints STAGE 5 drops (confirm before running):
-- SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE contype='u' AND conrelid IN ('public.patient_surgeries'::regclass,
--        'public.preop_questionnaires'::regclass,'public.preop_checklist'::regclass);
--
-- P2. Would the new "one active journey" index be violated today? (expect 0)
-- SELECT count(*) FROM (SELECT patient_id FROM public.patient_surgeries
--   WHERE patient_id IS NOT NULL AND archived_at IS NULL AND completed_at IS NULL
--   GROUP BY patient_id HAVING count(*)>1) t;
--
-- P3. Rows that will remain LEGACY (no journey) after backfill — review these:
-- SELECT 'questionnaire' AS kind, q.id, q.patient_id FROM public.preop_questionnaires q
--   WHERE NOT EXISTS (SELECT 1 FROM public.patient_surgeries s WHERE s.patient_id=q.patient_id)
-- UNION ALL
-- SELECT 'checklist', c.id, c.patient_id FROM public.preop_checklist c
--   WHERE NOT EXISTS (SELECT 1 FROM public.patient_surgeries s WHERE s.patient_id=c.patient_id);
--
-- P4. Baseline counts to compare after the migration (must be identical):
-- SELECT (SELECT count(*) FROM public.patient_surgeries)     AS surgeries,
--        (SELECT count(*) FROM public.preop_questionnaires)  AS questionnaires,
--        (SELECT count(*) FROM public.preop_checklist)       AS checklists,
--        (SELECT count(*) FROM public.questions)             AS questions,
--        (SELECT count(*) FROM public.requirement_documents) AS documents,
--        (SELECT count(*) FROM public.preparation_plans)     AS plans,
--        (SELECT count(*) FROM public.care_requests)         AS care_requests;
--
-- POST-MIGRATION VERIFICATION
-- V1. Counts unchanged  -> re-run P4 and diff against the baseline.
-- V2. Backfill coverage:
-- SELECT count(*) FILTER (WHERE surgery_id IS NOT NULL) AS scoped,
--        count(*) FILTER (WHERE surgery_id IS NULL)     AS legacy
--   FROM public.preop_questionnaires;
-- V3. New indexes present:
-- SELECT indexname FROM pg_indexes WHERE schemaname='public'
--   AND indexname IN ('uniq_active_journey_per_patient','uniq_preop_q_per_journey',
--                     'uniq_preop_chk_per_journey','uniq_preop_q_legacy','uniq_preop_chk_legacy');
-- V4. Old constraints gone: re-run P1 (expect the three *_patient_id_key rows absent).
--
-- ============================================================
-- ROLLBACK (restores the pre-migration model exactly)
-- Safe only while no patient has more than one journey; the guard below checks.
-- ============================================================
-- BEGIN;
--   DO $r$ DECLARE v int; BEGIN
--     SELECT count(*) INTO v FROM (SELECT patient_id FROM public.patient_surgeries
--       WHERE patient_id IS NOT NULL GROUP BY patient_id HAVING count(*)>1) t;
--     IF v > 0 THEN RAISE EXCEPTION
--       'ABORT rollback: % patient(s) already have multiple journeys; restoring UNIQUE(patient_id) would fail. Archive/merge them first.', v;
--     END IF; END $r$;
--   DROP FUNCTION IF EXISTS public.patient_delete_journey(uuid, text);
--   DROP FUNCTION IF EXISTS public.patient_start_journey();
--   DROP FUNCTION IF EXISTS public.patient_archive_journey(uuid);
--   DROP FUNCTION IF EXISTS public.patient_active_journey();
--   DROP INDEX IF EXISTS uniq_active_journey_per_patient;
--   DROP INDEX IF EXISTS uniq_preop_q_per_journey;
--   DROP INDEX IF EXISTS uniq_preop_chk_per_journey;
--   DROP INDEX IF EXISTS uniq_preop_q_legacy;
--   DROP INDEX IF EXISTS uniq_preop_chk_legacy;
--   ALTER TABLE public.patient_surgeries    ADD CONSTRAINT patient_surgeries_patient_id_key    UNIQUE (patient_id);
--   ALTER TABLE public.preop_questionnaires ADD CONSTRAINT preop_questionnaires_patient_id_key UNIQUE (patient_id);
--   ALTER TABLE public.preop_checklist      ADD CONSTRAINT preop_checklist_patient_id_key      UNIQUE (patient_id);
--   -- surgery_id columns are additive; keep them (harmless) or drop:
--   -- ALTER TABLE public.preop_questionnaires DROP COLUMN IF EXISTS surgery_id;
--   -- ALTER TABLE public.preop_checklist      DROP COLUMN IF EXISTS surgery_id;
--   -- ALTER TABLE public.questions            DROP COLUMN IF EXISTS surgery_id;
--   -- claim_patient_record: re-apply the version from v2_unified_patient_record.sql
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';
-- ============================================================
