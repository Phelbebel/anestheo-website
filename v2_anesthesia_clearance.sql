-- ============================================================
-- Anestheo /v2 - Anesthesia clearance closes the journey loop (P1)
-- WORKFLOW_REFERENCE sec 1 (set-once milestones) + sec 9 (approval).
--
-- Problem this fixes: patient_surgeries.ready_at / completed_at / etc. are
-- guard-protected (only RPCs may set them) but NO rpc ever set ready_at, so the
-- journey could never advance past 'plan_approved' (stages 7-10 were dead).
--
-- Design (product decision): the anesthesiologist's existing single sign-off
-- IS the anesthesia clearance. We therefore extend approve_plan to also stamp
-- ready_at (set-once), and reopen_review to clear it again. Surgery completion
-- and recovery are DERIVED on the client from (ready_at + surgery date passed)
-- - no extra doctor action, no write here - so a future hospital feed can set a
-- real completed_at that simply takes precedence.
--
-- Supersedes the approve_plan in v2_requirement_documents.sql and the
-- reopen_review in v2_doctor_review_ops.sql (same bodies + the clearance line).
-- Run AFTER both of those. Idempotent. Pure ASCII (no smart quotes).
-- ============================================================

-- -- approve_plan: review -> approved, promote draft plan, AND clear for
-- -- anesthesia (set-once ready_at). Still blocked while any document is
-- -- unreviewed. SECURITY DEFINER so it may write the guard-protected column.
DROP FUNCTION IF EXISTS public.approve_plan(uuid);
CREATE FUNCTION public.approve_plan(p_surgery_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_pid uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT patient_id INTO v_pid FROM public.patient_surgeries
    WHERE id = p_surgery_id AND assigned_doctor_id = v_uid;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'Not your assigned patient'; END IF;

  -- Workflow guard: every uploaded document must be reviewed before clearance.
  IF EXISTS (SELECT 1 FROM public.requirement_documents
             WHERE surgery_id = p_surgery_id AND reviewed_at IS NULL) THEN
    RAISE EXCEPTION 'Review all submitted documents before approving the plan';
  END IF;

  UPDATE public.preop_questionnaires
     SET review_state = 'approved', reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
   WHERE patient_id = v_pid AND review_state IN ('pending','in_review','changes_requested');
  IF NOT FOUND THEN RAISE EXCEPTION 'Questionnaire is not currently under review'; END IF;

  UPDATE public.preparation_plans
     SET status = 'superseded', updated_at = now()
   WHERE surgery_id = p_surgery_id AND status = 'approved';
  UPDATE public.preparation_plans
     SET status = 'approved', approved_by = v_uid, approved_at = now(), updated_at = now()
   WHERE surgery_id = p_surgery_id AND status = 'draft';

  -- Anesthesia clearance: the patient is cleared for anesthesia / ready for
  -- surgery. Set-once (COALESCE) so re-approval never moves the timestamp.
  UPDATE public.patient_surgeries
     SET ready_at = COALESCE(ready_at, now()), updated_at = now()
   WHERE id = p_surgery_id AND assigned_doctor_id = v_uid;
END; $$;
GRANT EXECUTE ON FUNCTION public.approve_plan(uuid) TO authenticated;

-- -- reopen_review: approved -> in_review; approved plan -> draft; and UNDO the
-- -- anesthesia clearance (ready_at back to NULL) so the journey steps back too.
DROP FUNCTION IF EXISTS public.reopen_review(uuid);
CREATE FUNCTION public.reopen_review(p_surgery_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_pid uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT patient_id INTO v_pid FROM public.patient_surgeries
    WHERE id = p_surgery_id AND assigned_doctor_id = v_uid;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'Not your assigned patient'; END IF;

  UPDATE public.preop_questionnaires
     SET review_state = 'in_review', reviewed_by = v_uid, updated_at = now()
   WHERE patient_id = v_pid AND review_state = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only an approved case can be reopened'; END IF;

  -- The approved plan becomes the editable working draft again.
  UPDATE public.preparation_plans
     SET status = 'draft', updated_at = now()
   WHERE surgery_id = p_surgery_id AND status = 'approved';

  -- Undo clearance: reopening means the patient is no longer cleared. Guarded
  -- so we never wipe a real completion that a hospital feed may have stamped.
  UPDATE public.patient_surgeries
     SET ready_at = NULL, updated_at = now()
   WHERE id = p_surgery_id AND assigned_doctor_id = v_uid
     AND completed_at IS NULL;
END; $$;
GRANT EXECUTE ON FUNCTION public.reopen_review(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
-- ============================================================
-- Done. The doctor's single approval now also clears the patient for
-- anesthesia (ready_at). Surgery completion + recovery are derived on the
-- client from (ready_at + surgery date passed); no further doctor action is
-- needed, and a future hospital completed_at feed takes precedence.
-- ============================================================
