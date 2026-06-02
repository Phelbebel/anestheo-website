-- ============================================================
-- FIX: "column reference questionnaire_status is ambiguous"
-- Cause: get_clinic_patient_by_token RETURNS TABLE has a column
-- named questionnaire_status, which collided with the same table
-- column inside the function body. Fix = fully-qualify every column.
-- Run in Supabase SQL Editor.
-- ============================================================

-- Return-type changes require a DROP first.
DROP FUNCTION IF EXISTS public.get_clinic_patient_by_token(text);

CREATE FUNCTION public.get_clinic_patient_by_token(p_token text)
RETURNS TABLE (
  id uuid,
  patient_name text, procedure text, hospital text, surgery_date date,
  questionnaire_status text, questionnaire_answers jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- fully-qualified: cp.questionnaire_status, cp.opened_at, cp.token
  UPDATE public.clinic_patients AS cp
     SET questionnaire_status = CASE WHEN cp.questionnaire_status = 'sent'
                                     THEN 'opened' ELSE cp.questionnaire_status END,
         opened_at = COALESCE(cp.opened_at, now())
   WHERE cp.token = p_token;

  RETURN QUERY
    SELECT cp.id, cp.patient_name, cp.procedure, cp.hospital, cp.surgery_date,
           cp.questionnaire_status, cp.questionnaire_answers
      FROM public.clinic_patients cp
     WHERE cp.token = p_token;
END; $$;

-- progress (RETURNS void, but qualify anyway for safety)
CREATE OR REPLACE FUNCTION public.mark_clinic_questionnaire_progress(p_token text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.clinic_patients AS cp
     SET questionnaire_status = CASE WHEN cp.questionnaire_status IN ('sent','opened')
                                     THEN 'in_progress' ELSE cp.questionnaire_status END
   WHERE cp.token = p_token;
END; $$;

-- submit (qualify all references)
CREATE OR REPLACE FUNCTION public.submit_clinic_questionnaire(p_token text, p_answers jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.clinic_patients AS cp
     SET questionnaire_answers = p_answers,
         questionnaire_status  = 'completed',
         completed_at = now(),
         patient_status = CASE WHEN cp.patient_status = 'awaiting_questionnaire'
                               THEN 'awaiting_consultation' ELSE cp.patient_status END
   WHERE cp.token = p_token;
END; $$;

-- Re-grant (DROP removed the grant on the recreated function)
GRANT EXECUTE ON FUNCTION public.get_clinic_patient_by_token(text)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_clinic_questionnaire_progress(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_clinic_questionnaire(text, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY (optional): should return your patient row, no error
-- SELECT * FROM public.get_clinic_patient_by_token('PASTE_A_REAL_TOKEN');
-- ============================================================
