-- ============================================================
-- Anestheo /v2 - Unified patient record (Phase A.2)
-- ONE canonical record (patient_surgeries) for every patient, independent of
-- authentication. Consultation vs Surgical is a single canonical state
-- (care_state) on that record, not a source-table attribute. Doctor-created
-- and patient-requested patients behave identically. Documents, notes and
-- recommendations stay keyed to surgery_id, so Convert and identity-linking
-- never copy or duplicate anything.
--
-- Reuses the EXISTING assigned_doctor_id ownership column (bridge foundation)
-- and the EXISTING clinic_patient_id back-link (convergence). Additive +
-- idempotent. Pure ASCII. Run in the Supabase SQL editor.
-- ============================================================

-- ── 1. patient_surgeries becomes the canonical, auth-optional record ──
ALTER TABLE public.patient_surgeries ALTER COLUMN patient_id DROP NOT NULL;
ALTER TABLE public.patient_surgeries
  ADD COLUMN IF NOT EXISTS care_state    text NOT NULL DEFAULT 'surgical',
  ADD COLUMN IF NOT EXISTS patient_name  text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS claim_token   uuid DEFAULT gen_random_uuid();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patient_surgeries_care_state_chk') THEN
    ALTER TABLE public.patient_surgeries
      ADD CONSTRAINT patient_surgeries_care_state_chk CHECK (care_state IN ('surgical','consultation'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_patient_surgeries_care_state ON public.patient_surgeries(care_state);

-- ── 2. Child tables: allow rows on a record that has no account yet ──
ALTER TABLE public.requirement_documents   ALTER COLUMN patient_id DROP NOT NULL;
ALTER TABLE public.patient_recommendations ALTER COLUMN patient_id DROP NOT NULL;

-- ── 3. RLS: the assigned doctor can create / manage a record they own ──
-- (patient access by patient_id is unchanged; doc/plan/rec RLS already key off
--  assigned_doctor_id / doctor_id, so they keep working with a null patient_id.)
DROP POLICY IF EXISTS ps_insert ON public.patient_surgeries;
CREATE POLICY ps_insert ON public.patient_surgeries
  FOR INSERT TO authenticated
  WITH CHECK ( auth.uid() = patient_id OR auth.uid() = assigned_doctor_id );

DROP POLICY IF EXISTS ps_update ON public.patient_surgeries;
CREATE POLICY ps_update ON public.patient_surgeries
  FOR UPDATE TO authenticated
  USING ( auth.uid() = patient_id OR auth.uid() = assigned_doctor_id );

-- The owning doctor can also write/delete documents on a no-account record.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='requirement_documents' AND policyname='rd_doctor_write') THEN
    CREATE POLICY rd_doctor_write ON public.requirement_documents
      FOR ALL TO authenticated
      USING ( EXISTS (SELECT 1 FROM public.patient_surgeries s
                      WHERE s.id = requirement_documents.surgery_id AND s.assigned_doctor_id = auth.uid()) )
      WITH CHECK ( EXISTS (SELECT 1 FROM public.patient_surgeries s
                      WHERE s.id = requirement_documents.surgery_id AND s.assigned_doctor_id = auth.uid()) );
  END IF;
END $$;

-- ── 4. Map existing care_requests -> canonical care_state ──
-- Accepted relationships set the lane; pending ones stay in Consultation Requests.
UPDATE public.patient_surgeries ps
   SET care_state = CASE WHEN cr.is_consultation THEN 'consultation' ELSE 'surgical' END
  FROM public.care_requests cr
 WHERE cr.surgery_id = ps.id AND cr.status = 'accepted';

-- ── 5. Map existing doctor-created clinic_patients -> a canonical record ──
-- Unconverted clinic patients (no auth identity) get an auth-optional record,
-- back-linked by clinic_patient_id (UNIQUE => convert-once, fully idempotent).
INSERT INTO public.patient_surgeries
       (patient_id, assigned_doctor_id, clinic_patient_id, patient_name, procedure_type, surgery_date, hospital, care_state)
SELECT  NULL, cp.doctor_id, cp.id, cp.patient_name, cp.procedure, cp.surgery_date, cp.hospital, 'surgical'
  FROM  public.clinic_patients cp
 WHERE  cp.auth_user_id IS NULL
   AND  NOT EXISTS (SELECT 1 FROM public.patient_surgeries ps WHERE ps.clinic_patient_id = cp.id)
ON CONFLICT (clinic_patient_id) DO NOTHING;

-- ── 6. Deferred identity linking (no duplicate, no data migration) ──
-- A patient claims a doctor-created record later (via their claim_token). Files,
-- notes and recommendations stay keyed by surgery_id, so only patient_id is set.
DROP FUNCTION IF EXISTS public.claim_patient_record(uuid, uuid);
CREATE FUNCTION public.claim_patient_record(p_surgery uuid, p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_existing uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  -- entitlement: must present the record's claim_token, and it must be unclaimed
  PERFORM 1 FROM public.patient_surgeries
    WHERE id = p_surgery AND claim_token = p_token AND patient_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid or already-claimed record'; END IF;

  SELECT id INTO v_existing FROM public.patient_surgeries WHERE patient_id = v_uid LIMIT 1;
  IF v_existing IS NULL THEN
    -- common path: the patient had no record of their own -> single link, no migration
    UPDATE public.patient_surgeries SET patient_id = v_uid WHERE id = p_surgery;
    RETURN jsonb_build_object('linked', p_surgery, 'merged', false);
  ELSE
    -- rare path: patient already had a self-created record -> re-point children to
    -- the doctor-created canonical record, then drop the empty self-created shell.
    UPDATE public.requirement_documents   SET surgery_id = p_surgery WHERE surgery_id = v_existing;
    UPDATE public.patient_recommendations SET surgery_id = p_surgery WHERE surgery_id = v_existing;
    UPDATE public.preparation_plans       SET surgery_id = p_surgery WHERE surgery_id = v_existing;
    UPDATE public.care_requests           SET surgery_id = p_surgery WHERE surgery_id = v_existing;
    DELETE FROM public.patient_surgeries WHERE id = v_existing;
    UPDATE public.patient_surgeries SET patient_id = v_uid WHERE id = p_surgery;
    RETURN jsonb_build_object('linked', p_surgery, 'merged', true);
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.claim_patient_record(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
-- ============================================================
-- Done. patient_surgeries.care_state is the single source of truth for the lane;
-- Convert = UPDATE care_state. Doctor-created and patient-requested patients are
-- now the same record shape and behave identically.
-- ============================================================
