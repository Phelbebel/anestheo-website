-- ============================================================
-- Anestheo /v2 - Doctor clinical plan + review actions
-- WORKFLOW_REFERENCE sec 8/9. Supersedes v2_doctor_workspace.sql:
-- this single file installs the full assigned-doctor review surface.
--   * pc_doctor_select        - doctor reads the patient checklist
--   * save_doctor_plan        - doctor saves notes + clinical requirements
--   * start_review            - pending -> in_review
--   * request_changes         - -> changes_requested (additional requirements)
--   * approve_plan            - -> approved (promotes draft plan)
--   * get_patient_plan        - patient reads ONLY requirements (no notes)
-- review_state is system-managed (guard trigger), so transitions go through
-- these SECURITY DEFINER functions. No new tables. Idempotent. Pure ASCII.
-- ============================================================

-- -- 1. Assigned doctor may read the patient's preparation checklist --
DROP POLICY IF EXISTS pc_doctor_select ON public.preop_checklist;
CREATE POLICY pc_doctor_select ON public.preop_checklist
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.patient_surgeries s
            WHERE s.patient_id = preop_checklist.patient_id
              AND s.assigned_doctor_id = auth.uid())
  );

-- -- 2. save_doctor_plan: upsert the working (draft) clinical plan --
-- plan_content = { notes: <internal>, requirements: [ {key,label,checked,note,custom} ] }
DROP FUNCTION IF EXISTS public.save_doctor_plan(uuid, jsonb);
CREATE FUNCTION public.save_doctor_plan(p_surgery_id uuid, p_plan jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_pid uuid; v_qid uuid; v_existing uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT patient_id INTO v_pid FROM public.patient_surgeries
    WHERE id = p_surgery_id AND assigned_doctor_id = v_uid;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'Not your assigned patient'; END IF;

  SELECT id INTO v_qid FROM public.preop_questionnaires WHERE patient_id = v_pid;
  SELECT id INTO v_existing FROM public.preparation_plans
    WHERE surgery_id = p_surgery_id AND status = 'draft'
    ORDER BY version DESC LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.preparation_plans
       SET plan_content = COALESCE(p_plan, '{}'::jsonb),
           questionnaire_id = COALESCE(questionnaire_id, v_qid),
           updated_at = now()
     WHERE id = v_existing;
  ELSE
    INSERT INTO public.preparation_plans(surgery_id, questionnaire_id, status, plan_content, created_by)
    VALUES (p_surgery_id, v_qid, 'draft', COALESCE(p_plan, '{}'::jsonb), v_uid);
  END IF;
END; $$;

-- -- 3. start_review: pending -> in_review (assigned doctor) --
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

-- -- 4. request_changes: -> changes_requested + reviewer_notes --
-- Tolerant of re-requests so the doctor can add requirements iteratively.
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
   WHERE patient_id = v_pid AND review_state IN ('pending','in_review','changes_requested');
  IF NOT FOUND THEN RAISE EXCEPTION 'Questionnaire is not currently under review'; END IF;
END; $$;

-- -- 5. approve_plan: -> approved (+ promote draft plan to approved) --
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
   WHERE patient_id = v_pid AND review_state IN ('pending','in_review','changes_requested');
  IF NOT FOUND THEN RAISE EXCEPTION 'Questionnaire is not currently under review'; END IF;
  -- supersede any previously approved plan, then promote the draft (sec 9)
  UPDATE public.preparation_plans
     SET status = 'superseded', updated_at = now()
   WHERE surgery_id = p_surgery_id AND status = 'approved';
  UPDATE public.preparation_plans
     SET status = 'approved', approved_by = v_uid, approved_at = now(), updated_at = now()
   WHERE surgery_id = p_surgery_id AND status = 'draft';
END; $$;

-- -- 6. get_patient_plan: patient reads ONLY shared requirements (no notes) --
-- Surfaced once the doctor has shared them (changes_requested) or approved.
DROP FUNCTION IF EXISTS public.get_patient_plan(uuid);
CREATE FUNCTION public.get_patient_plan(p_surgery_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_pid uuid; v_rstate text; v_rnotes text; v_reqs jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT patient_id INTO v_pid FROM public.patient_surgeries
    WHERE id = p_surgery_id AND patient_id = v_uid;
  IF v_pid IS NULL THEN RETURN '{}'::jsonb; END IF;   -- not the caller's surgery

  SELECT review_state, reviewer_notes INTO v_rstate, v_rnotes
    FROM public.preop_questionnaires WHERE patient_id = v_uid;

  IF v_rstate IN ('changes_requested','approved') THEN
    SELECT plan_content -> 'requirements' INTO v_reqs
      FROM public.preparation_plans
     WHERE surgery_id = p_surgery_id AND status IN ('draft','approved')
     ORDER BY (status = 'approved') DESC, version DESC LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'review_state',  COALESCE(v_rstate, 'not_submitted'),
    'reviewer_notes', v_rnotes,
    'requirements',  COALESCE(v_reqs, '[]'::jsonb)
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.save_doctor_plan(uuid, jsonb)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_review(uuid)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_changes(uuid, text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_plan(uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_patient_plan(uuid)        TO authenticated;

NOTIFY pgrst, 'reload schema';
-- ============================================================
-- Done. The assigned doctor saves a clinical plan (notes + requirements),
-- drives the review (start / request changes / approve), and the patient
-- sees ONLY the requested requirements (never the doctor's internal notes)
-- via get_patient_plan, gated on review_state. No new tables/columns.
-- ============================================================
