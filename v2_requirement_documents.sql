-- ============================================================
-- Anestheo /v2 - Patient document uploads for requested requirements
-- Builds on the doctor-plan architecture. Patients upload supporting files
-- (ECG, imaging, labs, consults...) per requirement; the assigned doctor
-- views/downloads and marks them reviewed. Approval is blocked while any
-- submitted document is still unreviewed. review_state workflow untouched.
-- Run in Supabase SQL editor (storage policies need the editor's role).
-- Pure ASCII. Idempotent.
-- ============================================================

-- -- 1. Private storage bucket (20 MB; PDF / JPG / PNG / HEIC) --
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('patient-documents', 'patient-documents', false, 20971520,
        ARRAY['application/pdf','image/jpeg','image/jpg','image/png','image/heic','image/heif'])
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types,
      public = false;

-- Object path convention: <patient_id>/<surgery_id>/<requirement_key>/<file>
DROP POLICY IF EXISTS rd_obj_insert ON storage.objects;
CREATE POLICY rd_obj_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'patient-documents'
              AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS rd_obj_select ON storage.objects;
CREATE POLICY rd_obj_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'patient-documents' AND (
           (storage.foldername(name))[1] = auth.uid()::text
        OR EXISTS (SELECT 1 FROM public.patient_surgeries s
                   WHERE s.id::text = (storage.foldername(name))[2]
                     AND s.assigned_doctor_id = auth.uid())
        ));

DROP POLICY IF EXISTS rd_obj_delete ON storage.objects;
CREATE POLICY rd_obj_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'patient-documents'
         AND (storage.foldername(name))[1] = auth.uid()::text);

-- -- 2. Document records linked to surgery + requirement --
CREATE TABLE IF NOT EXISTS public.requirement_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  surgery_id       uuid NOT NULL REFERENCES public.patient_surgeries(id) ON DELETE CASCADE,
  requirement_key  text NOT NULL,
  requirement_name text NOT NULL,
  storage_path     text NOT NULL,
  file_name        text NOT NULL,
  file_size        int,
  mime_type        text,
  uploaded_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_at      timestamptz,
  reviewed_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_req_docs_surgery ON public.requirement_documents(surgery_id);
CREATE INDEX IF NOT EXISTS idx_req_docs_patient ON public.requirement_documents(patient_id);

GRANT SELECT, INSERT, DELETE ON public.requirement_documents TO authenticated;
ALTER TABLE public.requirement_documents ENABLE ROW LEVEL SECURITY;

-- Patient owns their own document rows.
DROP POLICY IF EXISTS rd_patient_select ON public.requirement_documents;
CREATE POLICY rd_patient_select ON public.requirement_documents
  FOR SELECT TO authenticated USING (patient_id = auth.uid());
DROP POLICY IF EXISTS rd_patient_insert ON public.requirement_documents;
CREATE POLICY rd_patient_insert ON public.requirement_documents
  FOR INSERT TO authenticated WITH CHECK (patient_id = auth.uid());
-- Patient may remove a file only while it is still unreviewed.
DROP POLICY IF EXISTS rd_patient_delete ON public.requirement_documents;
CREATE POLICY rd_patient_delete ON public.requirement_documents
  FOR DELETE TO authenticated USING (patient_id = auth.uid() AND reviewed_at IS NULL);

-- Assigned doctor can read the patient's documents (review is via RPC).
DROP POLICY IF EXISTS rd_doctor_select ON public.requirement_documents;
CREATE POLICY rd_doctor_select ON public.requirement_documents
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.patient_surgeries s
            WHERE s.id = requirement_documents.surgery_id
              AND s.assigned_doctor_id = auth.uid()));

-- -- 3. mark_document_reviewed: assigned doctor stamps reviewed_at/by --
DROP FUNCTION IF EXISTS public.mark_document_reviewed(uuid);
CREATE FUNCTION public.mark_document_reviewed(p_doc_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_sid uuid; v_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT surgery_id INTO v_sid FROM public.requirement_documents WHERE id = p_doc_id;
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Document not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patient_surgeries s
                 WHERE s.id = v_sid AND s.assigned_doctor_id = v_uid) THEN
    RAISE EXCEPTION 'Not your assigned patient';
  END IF;
  UPDATE public.requirement_documents
     SET reviewed_at = now(), reviewed_by = v_uid
   WHERE id = p_doc_id
   RETURNING reviewed_at INTO v_at;
  RETURN jsonb_build_object('reviewed_at', v_at, 'reviewed_by', v_uid);
END; $$;
GRANT EXECUTE ON FUNCTION public.mark_document_reviewed(uuid) TO authenticated;

-- -- 4. approve_plan: now blocked while any submitted document is unreviewed --
DROP FUNCTION IF EXISTS public.approve_plan(uuid);
CREATE FUNCTION public.approve_plan(p_surgery_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_pid uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT patient_id INTO v_pid FROM public.patient_surgeries
    WHERE id = p_surgery_id AND assigned_doctor_id = v_uid;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'Not your assigned patient'; END IF;

  -- Workflow guard: every uploaded document must be reviewed before approval.
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
END; $$;
GRANT EXECUTE ON FUNCTION public.approve_plan(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
-- ============================================================
-- Done. Patients upload per-requirement files to the private
-- patient-documents bucket; rows in requirement_documents track status
-- (uploaded vs reviewed). The assigned doctor reads them (signed URLs),
-- marks them reviewed, and can only approve once none remain unreviewed.
-- ============================================================
