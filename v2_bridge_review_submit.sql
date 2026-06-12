-- ============================================================
-- Anestheo /v2 - Submit for Review RPC (WORKFLOW_REFERENCE sec 8)
-- Transition: review_state not_submitted -> pending, via a guarded
-- SECURITY DEFINER function (review_state is system-managed; the
-- guard trigger blocks direct patient writes).
-- Guards (Inv6): questionnaire submitted AND an accepted clinician
-- connection for the surgery. Run in Supabase SQL Editor. Idempotent.
-- Pure ASCII. No schema/RLS changes.
-- ============================================================

DROP FUNCTION IF EXISTS public.submit_for_review(uuid);
CREATE FUNCTION public.submit_for_review(p_surgery_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_found boolean; v_qstatus text; v_rstate text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Surgery must belong to the caller.
  SELECT true INTO v_found
    FROM public.patient_surgeries WHERE id = p_surgery_id AND patient_id = v_uid;
  IF NOT v_found THEN RAISE EXCEPTION 'Surgery not found for this patient'; END IF;

  -- Prerequisite (Inv6): an accepted clinician connection for this surgery.
  IF NOT EXISTS (SELECT 1 FROM public.care_requests
                 WHERE surgery_id = p_surgery_id AND status = 'accepted') THEN
    RAISE EXCEPTION 'Connect with a clinician and be accepted before submitting for review';
  END IF;

  -- Prerequisite (Inv6): questionnaire submitted.
  SELECT status, review_state INTO v_qstatus, v_rstate
    FROM public.preop_questionnaires WHERE patient_id = v_uid;
  IF v_qstatus IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'Complete and submit your questionnaire first';
  END IF;
  IF v_rstate NOT IN ('not_submitted','changes_requested') THEN
    RAISE EXCEPTION 'This questionnaire has already been submitted for review';
  END IF;

  -- Transition (runs as table owner, so the system-managed guard allows it).
  UPDATE public.preop_questionnaires
     SET review_state = 'pending', updated_at = now()
   WHERE patient_id = v_uid;
END; $$;

GRANT EXECUTE ON FUNCTION public.submit_for_review(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
-- ============================================================
-- Done. submit_for_review() flips review_state to 'pending' once the
-- questionnaire is submitted and a clinician has accepted. The patient
-- dashboard then derives 'Awaiting review'; the assigned doctor sees the
-- pending questionnaire (assignment-scoped RLS). No new tables/columns.
-- ============================================================
