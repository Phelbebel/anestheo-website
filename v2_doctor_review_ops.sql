-- ============================================================
-- Anestheo /v2 - Doctor review operations (versioning + reopen)
-- Builds on v2_doctor_plan.sql. Adds clinical-safety controls:
--   * save_doctor_plan  -> now bumps version + stamps updated_at and
--                          RETURNS {version, updated_at} for save feedback
--   * reopen_review     -> approved case back to in_review (editable plan)
-- review_state stays system-managed (guard trigger); transitions go through
-- these SECURITY DEFINER functions. No new tables. Idempotent. Pure ASCII.
-- ============================================================

-- -- 1. save_doctor_plan: persist plan + bump version, return save metadata --
DROP FUNCTION IF EXISTS public.save_doctor_plan(uuid, jsonb);
CREATE FUNCTION public.save_doctor_plan(p_surgery_id uuid, p_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_pid uuid; v_qid uuid; v_id uuid; v_ver int; v_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT patient_id INTO v_pid FROM public.patient_surgeries
    WHERE id = p_surgery_id AND assigned_doctor_id = v_uid;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'Not your assigned patient'; END IF;

  SELECT id INTO v_qid FROM public.preop_questionnaires WHERE patient_id = v_pid;
  SELECT id INTO v_id FROM public.preparation_plans
    WHERE surgery_id = p_surgery_id AND status = 'draft'
    ORDER BY version DESC LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.preparation_plans
       SET plan_content = COALESCE(p_plan, '{}'::jsonb),
           questionnaire_id = COALESCE(questionnaire_id, v_qid),
           version = COALESCE(version, 1) + 1, updated_at = now()
     WHERE id = v_id
     RETURNING version, updated_at INTO v_ver, v_at;
  ELSE
    INSERT INTO public.preparation_plans(surgery_id, questionnaire_id, status, plan_content, created_by, version)
    VALUES (p_surgery_id, v_qid, 'draft', COALESCE(p_plan, '{}'::jsonb), v_uid, 1)
    RETURNING version, updated_at INTO v_ver, v_at;
  END IF;

  RETURN jsonb_build_object('version', v_ver, 'updated_at', v_at);
END; $$;

-- -- 2. reopen_review: approved -> in_review; approved plan -> draft --
-- For new tests, condition or surgery-date changes after approval.
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
END; $$;

GRANT EXECUTE ON FUNCTION public.save_doctor_plan(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_review(uuid)          TO authenticated;

NOTIFY pgrst, 'reload schema';
-- ============================================================
-- Done. Saves are versioned with a returned timestamp (save feedback), and
-- an approved case can be reopened back into review with its plan editable
-- again. The plan's modification history / audit trail lives in
-- preparation_plans.plan_content.history (maintained by the workspace).
-- ============================================================
