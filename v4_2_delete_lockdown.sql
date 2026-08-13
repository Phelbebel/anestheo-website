-- ============================================================
-- ONE DOOR TO PERMANENT DELETION
--
-- v4_1 made patient_purge() careful: it refuses when a Live Chart exists, when
-- clinical rows would be cascaded or orphaned, when the record was never soft
-- deleted, and unless the caller is an administrator who types a confirmation.
--
-- None of that mattered, because there were three other doors. Proved on a
-- schema replica, not inferred:
--
--   1. POLICY cp_delete ON clinic_patients — "auth.uid() = doctor_id" for
--      authenticated. A doctor could physically DELETE their own clinic
--      patient. Observed: a clinic patient with an IN-PROGRESS anesthesia
--      record was destroyed outright by its owning doctor, and the chart's
--      clinic_patient_id was SET NULL — a live chart documenting nobody. That
--      is precisely what patient_purge() refuses with active_clinical_record.
--      A row with a FINALIZED chart survived, but only because the anesthesia
--      finalization guard refuses the detach. Luck, not a rule.
--
--   2. admin_record_action('journey', id, 'purge', …) — checks only "is it
--      soft deleted" and a typed 'DELETE'. Observed: it destroyed a journey
--      that had an OPEN Live Chart. A second permanent-delete authority with
--      none of the clinical safety.
--
--   3. admin_delete_patient(surgery_id, 'DELETE') — a third authority. Not
--      called by any page, but granted to authenticated and therefore
--      reachable directly through PostgREST by any admin. It hard-deletes the
--      journey AND the clinic patient with no Live Chart check at all.
--
-- patient_surgeries was already safe by accident: it has no permissive DELETE
-- policy, so direct DELETE was denied for every actor including admins. This
-- migration makes that the deliberate rule for both tables.
--
-- Also retires the legacy archive trio. Two archive systems on one record is
-- how the states drift apart; the structured lifecycle API replaces them.
--
-- DEPLOY ORDER: ship the HTML first, then apply this file. The new pages call
-- patient_lifecycle_action(), which already exists from v4, so they work
-- before this runs. Applying this first would break archiving in the old
-- pages until they are replaced.
--
-- SAFETY: additive and idempotent. Only removes capability; touches no data.
-- ============================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regproc('public.patient_purge') IS NULL THEN
    RAISE EXCEPTION 'ABORT: apply v4_patient_lifecycle.sql and v4_1_purge_safety.sql first.';
  END IF;
  IF to_regproc('public.patient_lifecycle_action') IS NULL THEN
    RAISE EXCEPTION 'ABORT: patient_lifecycle_action() is missing.';
  END IF;
  RAISE NOTICE 'Preflight OK.';
END
$preflight$;

-- ============================================================
-- 1. NO DIRECT PHYSICAL DELETE, FOR ANYONE
-- ============================================================
-- Two independent locks, because one of them will eventually be edited by
-- somebody who does not know why it is there:
--   a) the table privilege is withdrawn, so the statement is refused before
--      RLS is even consulted;
--   b) a RESTRICTIVE policy denies DELETE regardless of any permissive policy
--      added later — restrictive policies are ANDed, so a future
--      "cp_delete_v2" cannot re-open the hole on its own.
--
-- patient_purge() is SECURITY DEFINER and owned by the table owner, so it is
-- unaffected by both: it deletes as the owner, which bypasses RLS. That is the
-- point — the only path that can destroy a patient row is the one that checks
-- first.
DROP POLICY IF EXISTS cp_delete ON public.clinic_patients;

DROP POLICY IF EXISTS cp_no_direct_delete ON public.clinic_patients;
CREATE POLICY cp_no_direct_delete ON public.clinic_patients
  AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS ps_no_direct_delete ON public.patient_surgeries;
CREATE POLICY ps_no_direct_delete ON public.patient_surgeries
  AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

REVOKE DELETE ON public.clinic_patients   FROM anon, authenticated;
REVOKE DELETE ON public.patient_surgeries FROM anon, authenticated;

-- Cancelling an invitation used to be a physical DELETE through cp_delete. It
-- is now a soft delete like every other removal, which is why losing the policy
-- costs the product nothing: the invitation goes to the Recycle Bin, where an
-- unengaged invite has no clinical dependencies and so is purgeable by an
-- administrator through the one authorized path.

-- ============================================================
-- 2. ONE PERMANENT-DELETE AUTHORITY
-- ============================================================
-- admin_record_action still owns questionnaires, checklists, questions, care
-- requests and reports. For a JOURNEY it now delegates: the patient lifecycle
-- has exactly one implementation and the admin console cannot drift from it.
--
-- The delegation deliberately passes p_confirm through untranslated. An old
-- client sending 'DELETE' gets patient_purge()'s confirmation_required and
-- nothing is destroyed — the change fails closed rather than quietly accepting
-- a weaker confirmation than the rule demands.
CREATE OR REPLACE FUNCTION public.admin_record_action(
  p_entity text, p_id uuid, p_action text, p_reason text DEFAULT NULL, p_confirm text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_tbl text; v_n int; v_res jsonb;
BEGIN
  PERFORM public.assert_admin();

  IF p_action NOT IN ('soft_delete','restore','purge') THEN
    RAISE EXCEPTION 'Action "%" is not supported', p_action USING ERRCODE = '22023';
  END IF;

  -- ── Patient records: delegate to the lifecycle API, always. ─────────────
  IF p_entity = 'journey' THEN
    IF p_action = 'purge' THEN
      v_res := public.patient_purge('journey', p_id, p_confirm);
    ELSE
      IF p_action = 'soft_delete' AND NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
        RAISE EXCEPTION 'A reason is required for this action' USING ERRCODE = '22023';
      END IF;
      v_res := public.patient_lifecycle_action('journey', p_id,
                 CASE p_action WHEN 'soft_delete' THEN 'delete' ELSE 'restore_delete' END,
                 p_reason);
    END IF;
    -- Callers of this function treat an exception as failure. Keep that
    -- contract rather than returning ok:false, which an existing page would
    -- read as success.
    IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
      RAISE EXCEPTION '%', COALESCE(v_res->>'reason','That action was refused.')
        USING ERRCODE = '22023';
    END IF;
    PERFORM public.admin_log('record.'||p_action, p_entity, p_id, NULL, NULL, NULL, p_reason);
    RETURN v_res;
  END IF;

  v_tbl := CASE p_entity
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
    PERFORM public.admin_log('record.permanent_delete', p_entity, p_id, NULL, NULL, NULL, p_reason);
    EXECUTE format('DELETE FROM public.%I WHERE id=$1', v_tbl) USING p_id;
    RETURN jsonb_build_object('ok', true, 'action', 'purge', 'entity', p_entity);
  END IF;

  PERFORM public.admin_log('record.'||p_action, p_entity, p_id, NULL, NULL, NULL, p_reason);
  RETURN jsonb_build_object('ok', true, 'action', p_action, 'entity', p_entity);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_record_action(text,uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_record_action(text,uuid,text,text,text) TO authenticated;

-- ── The third door: removed outright. ──────────────────────────────────────
-- Nothing calls it, it predates every clinical safety rule we now have, and a
-- function that hard-deletes two tables is not something to leave lying in the
-- schema with EXECUTE granted to every signed-in user.
DROP FUNCTION IF EXISTS public.admin_delete_patient(uuid, text);

-- ============================================================
-- 3. RETIRE THE LEGACY ARCHIVE SYSTEM
-- ============================================================
-- patient_archive_eligibility(uuid) answers only for patient_surgeries and
-- RAISES for a clinic_patients id — the source of "Could not check eligibility
-- right now" in production, because the client had to swallow the exception.
-- patient_lifecycle_eligibility(kind, id, action) replaces it and always
-- returns structured jsonb.
--
-- EXECUTE is revoked rather than the functions dropped: revoking is instantly
-- reversible if a page is found still calling one, and it makes the intent
-- ("this is retired") legible in the catalog.
DO $legacy$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'patient_archive_eligibility(uuid)',
    'archive_patient(uuid,text)',
    'restore_patient(uuid)'
  ] LOOP
    IF to_regprocedure('public.'||f) IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON FUNCTION public.'||f||' FROM PUBLIC, anon, authenticated';
      RAISE NOTICE 'retired: %', f;
    END IF;
  END LOOP;
END
$legacy$;

-- ============================================================
-- 4. CARE REQUEST VISIBILITY
-- ============================================================
-- Same parent-aware shape as journey_visible(). A care request disappears from
-- ordinary views when it is itself deleted OR when the journey it belongs to
-- is deleted, and reappears when that journey is restored — unless it was
-- deleted in its own right, in which case its own deleted_at keeps it hidden.
CREATE OR REPLACE FUNCTION public.care_request_visible(p_care_request_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_care_request_id IS NULL THEN true ELSE EXISTS (
    SELECT 1 FROM public.care_requests cr
     WHERE cr.id = p_care_request_id
       AND cr.deleted_at IS NULL
       AND (cr.surgery_id IS NULL OR public.journey_visible(cr.surgery_id))
  ) END;
$$;
REVOKE ALL ON FUNCTION public.care_request_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.care_request_visible(uuid) TO authenticated;

DO $done$
BEGIN
  RAISE NOTICE '--- Delete lockdown installed ----------------------------';
  RAISE NOTICE '  cp_delete dropped; DELETE revoked and RESTRICTIVE-denied';
  RAISE NOTICE '  on patient_surgeries AND clinic_patients';
  RAISE NOTICE '  admin_record_action(journey) delegates to the lifecycle API';
  RAISE NOTICE '  admin_delete_patient() dropped (third delete authority)';
  RAISE NOTICE '  legacy archive/restore/eligibility retired';
  RAISE NOTICE '  care_request_visible() added';
  RAISE NOTICE '----------------------------------------------------------';
END
$done$;

COMMIT;

-- ROLLBACK (only if a page is found still needing a retired path):
--   GRANT EXECUTE ON FUNCTION public.archive_patient(uuid,text) TO authenticated;
--   GRANT EXECUTE ON FUNCTION public.restore_patient(uuid) TO authenticated;
--   GRANT EXECUTE ON FUNCTION public.patient_archive_eligibility(uuid) TO authenticated;
-- Re-opening direct DELETE is deliberately NOT scripted here. If it is ever
-- needed, it should be a considered change with its own review, not a paste.
