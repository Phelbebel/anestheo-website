-- ============================================================
-- Anestheo /v2 — PATIENT SURGERY JOURNEYS, PHASE 1  ** PROPOSAL — NOT APPLIED **
--
-- Presented for approval BEFORE any production data is touched, as instructed.
-- The Manage-Journey UI is already built and calls the three RPCs below; until
-- this migration is applied the UI reports honestly that the action is not
-- enabled yet. Nothing else in the product depends on it.
--
-- ############################################################
-- ##  STOP — DO NOT APPLY. Review found 3 blocking defects.  ##
-- ############################################################
-- Verified on PostgreSQL 16 against the production table shapes:
--
-- B1. patient_surgeries has  UNIQUE (patient_id)  (v2_patient_surgery_migration
--     .sql line 19). A patient can therefore hold AT MOST ONE surgery row, so
--     patient_start_journey() below FAILS with
--       duplicate key value violates unique constraint
--       "patient_surgeries_patient_id_key"
--     the moment a patient already has any journey (archived or not).
--     Multi-journey is IMPOSSIBLE until that constraint is replaced, and doing
--     so also breaks patient-dashboard.html:1513, which upserts
--     patient_surgeries with onConflict:'patient_id'.
--     (An earlier note in this file claimed the table already supports many
--      rows per patient. That was WRONG; corrected here.)
--
-- B2. The ON DELETE CASCADE foreign keys in SECTION 1 silently change the
--     behaviour of TWO ALREADY-SHIPPED functions:
--       * admin_delete_patient (v2_patient_archiving.sql) explicitly documents
--         that the patient's questionnaire is "intentionally NOT destroyed".
--         With the cascade it IS destroyed. Proven: questionnaires 1 -> 0.
--       * claim_patient_record (v2_unified_patient_record.sql) deletes the
--         patient's self-created shell row after re-pointing children. It does
--         not re-point preop_questionnaires/preop_checklist (the column did not
--         exist), so identity-claiming would DELETE the patient's questionnaire.
--     Fix direction: use ON DELETE SET NULL, or re-point in claim_patient_record
--     and delete explicitly inside patient_delete_journey.
--
-- B3. SECTION 2 (per-journey uniqueness) is commented out, so even if B1 were
--     solved the questionnaire/checklist would remain UNIQUE(patient_id) and a
--     second journey would reuse the first journey's rows - the exact data
--     mixing this feature must prevent.
--
-- Also: this file is NOT transaction-wrapped (no BEGIN/COMMIT), so a failure
-- part-way through leaves the schema half-migrated.
--
-- The Manage-Journey UI is already built and degrades honestly while these
-- functions are absent, so nothing is broken by NOT applying this file.
-- ############################################################
--
-- WHY IT IS NEEDED
-- 1. One row of patient_surgeries = one journey and archived_at already exists,
--    so no new journey TABLE is required - but see B1: the UNIQUE(patient_id)
--    constraint must be replaced before more than one row per patient is legal.
-- 2. BUT archived_at is a system-managed column: guard_patient_surgeries_protected
--    rejects any direct write from the 'authenticated' role. A patient therefore
--    cannot archive their own journey without a SECURITY DEFINER RPC.
-- 3. AND the real blocker for multiple journeys:
--        preop_questionnaires  UNIQUE (patient_id)
--        preop_checklist       UNIQUE (patient_id)
--        questions             keyed by patient_id only
--    => questionnaires, preparation progress and messages are per-PATIENT, not
--       per-SURGERY. With two journeys they would MIX. Sections 1 and 2 below
--       fix that; they are additive but they DO change uniqueness, so they need
--       explicit approval.
--
-- SAFETY: additive + idempotent. Section 1 is non-destructive (adds a column and
-- backfills). Section 2 swaps a UNIQUE constraint — reversible, documented.
-- Section 4 (delete) is the only destructive code path and is heavily guarded.
-- ============================================================

-- ============================================================
-- SECTION 1 — scope per-patient records to a journey (ADDITIVE)
-- ============================================================
ALTER TABLE public.preop_questionnaires ADD COLUMN IF NOT EXISTS surgery_id uuid
  REFERENCES public.patient_surgeries(id) ON DELETE CASCADE;
ALTER TABLE public.preop_checklist      ADD COLUMN IF NOT EXISTS surgery_id uuid
  REFERENCES public.patient_surgeries(id) ON DELETE CASCADE;
ALTER TABLE public.questions            ADD COLUMN IF NOT EXISTS surgery_id uuid
  REFERENCES public.patient_surgeries(id) ON DELETE SET NULL;

-- Backfill: attach every existing row to the patient's current active journey.
-- Existing single-journey patients are unaffected in behaviour.
UPDATE public.preop_questionnaires q SET surgery_id = s.id
  FROM public.patient_surgeries s
 WHERE q.surgery_id IS NULL AND s.patient_id = q.patient_id AND s.archived_at IS NULL;
UPDATE public.preop_checklist c SET surgery_id = s.id
  FROM public.patient_surgeries s
 WHERE c.surgery_id IS NULL AND s.patient_id = c.patient_id AND s.archived_at IS NULL;
UPDATE public.questions qq SET surgery_id = s.id
  FROM public.patient_surgeries s
 WHERE qq.surgery_id IS NULL AND s.patient_id = qq.patient_id AND s.archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_preop_q_surgery   ON public.preop_questionnaires(surgery_id);
CREATE INDEX IF NOT EXISTS idx_preop_chk_surgery ON public.preop_checklist(surgery_id);
CREATE INDEX IF NOT EXISTS idx_questions_surgery ON public.questions(surgery_id);

-- ============================================================
-- SECTION 2 — uniqueness must become per-journey  ** REVIEW CAREFULLY **
-- Without this, a second journey cannot have its own questionnaire/checklist.
-- The old constraint name may differ per environment; verify with the preflight
-- query at the bottom before running.
-- ============================================================
-- ALTER TABLE public.preop_questionnaires DROP CONSTRAINT IF EXISTS preop_questionnaires_patient_id_key;
-- ALTER TABLE public.preop_checklist      DROP CONSTRAINT IF EXISTS preop_checklist_patient_id_key;
-- CREATE UNIQUE INDEX IF NOT EXISTS uniq_preop_q_per_journey
--   ON public.preop_questionnaires(patient_id, surgery_id);
-- CREATE UNIQUE INDEX IF NOT EXISTS uniq_preop_chk_per_journey
--   ON public.preop_checklist(patient_id, surgery_id);
-- NOTE: every client that upserts with onConflict:'patient_id' (questionnaire.html,
-- patient-dashboard.html) must be updated to onConflict:'patient_id,surgery_id'
-- IN THE SAME RELEASE. Left commented until that frontend change is approved.

-- ============================================================
-- SECTION 3 — patient-owned journey RPCs (archive / start new)
-- ============================================================
CREATE OR REPLACE FUNCTION public.patient_archive_journey(p_surgery_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_ps public.patient_surgeries%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_ps FROM public.patient_surgeries WHERE id = p_surgery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Journey not found'; END IF;
  IF v_ps.patient_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'You can only archive your own surgery journey';
  END IF;
  IF v_ps.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('archived_at', v_ps.archived_at, 'already', true);
  END IF;
  UPDATE public.patient_surgeries
     SET archived_at = now(), archived_by = v_uid, archive_reason = 'patient_self_archive',
         restored_at = NULL, restored_by = NULL, updated_at = now()
   WHERE id = p_surgery_id;
  RETURN jsonb_build_object('archived_at', now());
END; $$;
GRANT EXECUTE ON FUNCTION public.patient_archive_journey(uuid) TO authenticated;

-- Start a new journey. Archives the current active one first, so preparation
-- data can never span two journeys.
CREATE OR REPLACE FUNCTION public.patient_start_journey()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_active uuid; v_new uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO v_active FROM public.patient_surgeries
   WHERE patient_id = v_uid AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1;
  IF v_active IS NOT NULL THEN
    UPDATE public.patient_surgeries
       SET archived_at = now(), archived_by = v_uid, archive_reason = 'superseded_by_new_journey',
           updated_at = now()
     WHERE id = v_active;
  END IF;
  INSERT INTO public.patient_surgeries(patient_id, care_state)
  VALUES (v_uid, 'surgical') RETURNING id INTO v_new;
  RETURN jsonb_build_object('surgery_id', v_new, 'archived_previous', v_active);
END; $$;
GRANT EXECUTE ON FUNCTION public.patient_start_journey() TO authenticated;

-- ============================================================
-- SECTION 4 — DESTRUCTIVE: delete one journey  ** APPROVAL REQUIRED **
-- Deletes ONLY that surgery journey and its journey-scoped children.
-- NEVER touches auth.users or public.profiles: the account always survives.
-- Requires the literal confirmation string 'DELETE'.
-- ============================================================
CREATE OR REPLACE FUNCTION public.patient_delete_journey(p_surgery_id uuid, p_confirm text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_ps public.patient_surgeries%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_confirm IS DISTINCT FROM 'DELETE' THEN
    RAISE EXCEPTION 'Deletion requires explicit confirmation';
  END IF;
  SELECT * INTO v_ps FROM public.patient_surgeries WHERE id = p_surgery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Journey not found'; END IF;
  IF v_ps.patient_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'You can only delete your own surgery journey';
  END IF;

  -- Journey-scoped children. requirement_documents / preparation_plans /
  -- patient_recommendations / care_requests already cascade from surgery_id;
  -- after SECTION 1 the questionnaire and checklist do too. Deleted explicitly
  -- here so the intent is auditable and independent of FK settings.
  DELETE FROM public.preop_questionnaires WHERE surgery_id = p_surgery_id;
  DELETE FROM public.preop_checklist      WHERE surgery_id = p_surgery_id;
  UPDATE public.questions SET surgery_id = NULL WHERE surgery_id = p_surgery_id; -- keep the conversation
  DELETE FROM public.patient_surgeries WHERE id = p_surgery_id;                  -- cascades the rest

  RETURN jsonb_build_object('deleted', true, 'surgery_id', p_surgery_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.patient_delete_journey(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- PREFLIGHT (read-only) — run BEFORE applying
-- ============================================================
-- -- exact names of the UNIQUE constraints SECTION 2 would replace:
-- SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conrelid IN ('public.preop_questionnaires'::regclass,'public.preop_checklist'::regclass)
--    AND contype='u';
-- -- how many patients already have more than one surgery row:
-- SELECT count(*) FROM (SELECT patient_id FROM public.patient_surgeries
--   WHERE patient_id IS NOT NULL GROUP BY patient_id HAVING count(*)>1) t;
-- -- rows that would fail to backfill (no active journey):
-- SELECT 'questionnaires' AS what, count(*) FROM public.preop_questionnaires q
--   WHERE NOT EXISTS (SELECT 1 FROM public.patient_surgeries s
--                      WHERE s.patient_id=q.patient_id AND s.archived_at IS NULL);
--
-- ROLLBACK
-- ============================================================
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.patient_delete_journey(uuid, text);
--   DROP FUNCTION IF EXISTS public.patient_start_journey();
--   DROP FUNCTION IF EXISTS public.patient_archive_journey(uuid);
--   -- SECTION 2 reversal (only if it was applied):
--   -- DROP INDEX IF EXISTS uniq_preop_q_per_journey;
--   -- DROP INDEX IF EXISTS uniq_preop_chk_per_journey;
--   -- ALTER TABLE public.preop_questionnaires ADD CONSTRAINT preop_questionnaires_patient_id_key UNIQUE (patient_id);
--   -- ALTER TABLE public.preop_checklist      ADD CONSTRAINT preop_checklist_patient_id_key      UNIQUE (patient_id);
--   -- SECTION 1 columns are additive and safe to keep; to remove:
--   -- ALTER TABLE public.preop_questionnaires DROP COLUMN IF EXISTS surgery_id;
--   -- ALTER TABLE public.preop_checklist      DROP COLUMN IF EXISTS surgery_id;
--   -- ALTER TABLE public.questions            DROP COLUMN IF EXISTS surgery_id;
-- COMMIT;
-- ============================================================
