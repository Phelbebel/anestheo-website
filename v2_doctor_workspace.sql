-- ============================================================
-- Anestheo /v2 - Doctor Active Patient Workspace (review actions)
-- WORKFLOW_REFERENCE sec 8/9. Adds assignment-scoped doctor read on
-- preop_checklist + guarded review-transition RPCs. review_state is
-- system-managed (guard trigger), so transitions go through these
-- SECURITY DEFINER functions. No new tables. Idempotent. Pure ASCII.
-- ============================================================

-- -- 1. Let the ASSIGNED doctor read a patient's preparation checklist --
DROP POLICY IF EXISTS pc_doctor_select ON public.preop_checklist;
CREATE POLICY pc_doctor_select ON public.preop_checklist
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.patient_surgeries s
            WHERE s.patient_id = preop_checklist.patient_id
              AND s.assigned_doctor_id = auth.uid())
  );

-- helper: resolve patient_id for a surgery the caller is assigned to
-- (inlined in each RPC below).

-- -- 2. start_review: pending -> in_review (assigned doctor) --
DROP FUNCTION IF EXISTS public.start_review(uuid);
CREATE FUNCTION public.start_review(p_surgery_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_pid uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT patient_id INTO v_pid FROM public.patient_surgeries
    WHERE id = p_surgery_id AND assigned_doctor_id = v_uid;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'Not your assigned patient'; END IF;
  UPDATE public.preop_questionnaires
     SET review_state = 'in_review', reviewed_by = v_uid, updated_at = now()
   WHERE patient_id = v_pid AND review_state = 'pending';
END; $$;

-- -- 3. request_changes: -> changes_requested + reviewer_notes --
DROP FUNCTION IF EXISTS public.request_changes(uuid, text);
CREATE FUNCTION public.request_changes(p_surgery_id uuid, p_notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_pid uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT patient_id INTO v_pid FROM public.patient_surgeries
    WHERE id = p_surgery_id AND assigned_doctor_id = v_uid;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'Not your assigned patient'; END IF;
  UPDATE public.preop_questionnaires
     SET review_state = 'changes_requested', reviewer_notes = NULLIF(p_notes,''),
         reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
   WHERE patient_id = v_pid AND review_state IN ('pending','in_review');
  IF NOT FOUND THEN RAISE EXCEPTION 'Questionnaire is not currently under review'; END IF;
END; $$;

-- -- 4. approve_plan: -> approved (+ mark any draft plan approved) --
DROP FUNCTION IF EXISTS public.approve_plan(uuid);
CREATE FUNCTION public.approve_plan(p_surgery_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_pid uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT patient_id INTO v_pid FROM public.patient_surgeries
    WHERE id = p_surgery_id AND assigned_doctor_id = v_uid;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'Not your assigned patient'; END IF;
  UPDATE public.preop_questionnaires
     SET review_state = 'approved', reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
   WHERE patient_id = v_pid AND review_state IN ('pending','in_review');
  IF NOT FOUND THEN RAISE EXCEPTION 'Questionnaire is not currently under review'; END IF;
  -- promote any draft plan (doctor notes) to approved (sec 9)
  UPDATE public.preparation_plans
     SET status = 'approved', approved_by = v_uid, approved_at = now(), updated_at = now()
   WHERE surgery_id = p_surgery_id AND status = 'draft';
END; $$;

GRANT EXECUTE ON FUNCTION public.start_review(uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_changes(uuid, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_plan(uuid)           TO authenticated;

NOTIFY pgrst, 'reload schema';
-- ============================================================
-- Done. Assigned doctor can read the patient checklist and drive the
-- review (start / request changes / approve). Doctor internal notes use
-- preparation_plans (draft) via the existing pp_doctor_all policy.
-- ============================================================
