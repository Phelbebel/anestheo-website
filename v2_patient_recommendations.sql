-- ============================================================
-- Anestheo /v2 - Patient Recommendations (Phase A)
-- ONE recommendation system that belongs to the PATIENT RECORD and is used
-- everywhere: consultation, surgical, and converted patients. It is keyed to
-- the surgery (the clinical episode), so it survives Consultation -> Convert ->
-- Surgical with no copying or moving. Each item has a per-item visibility
-- toggle: visible_to_patient=false (internal draft) / true (published to the
-- patient portal).
--
-- Additive only. No new buckets, no duplicate document/patient systems.
-- Reuses the existing patient_surgeries record and auth.users identities.
-- Idempotent. Run in the Supabase SQL editor before uploading dashboard.html.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.patient_recommendations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surgery_id         uuid NOT NULL REFERENCES public.patient_surgeries(id) ON DELETE CASCADE,
  patient_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doctor_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body               text NOT NULL,
  visible_to_patient boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_recs_surgery ON public.patient_recommendations(surgery_id);
CREATE INDEX IF NOT EXISTS idx_patient_recs_doctor  ON public.patient_recommendations(doctor_id);
CREATE INDEX IF NOT EXISTS idx_patient_recs_patient ON public.patient_recommendations(patient_id);

ALTER TABLE public.patient_recommendations ENABLE ROW LEVEL SECURITY;

-- The owning doctor can create / read / edit / delete their recommendations.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='patient_recommendations' AND policyname='pr_doctor_all') THEN
    CREATE POLICY pr_doctor_all ON public.patient_recommendations
      FOR ALL TO authenticated
      USING ( auth.uid() = doctor_id )
      WITH CHECK ( auth.uid() = doctor_id );
  END IF;
END $$;

-- The patient can read ONLY the recommendations that have been published to them.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='patient_recommendations' AND policyname='pr_patient_read') THEN
    CREATE POLICY pr_patient_read ON public.patient_recommendations
      FOR SELECT TO authenticated
      USING ( auth.uid() = patient_id AND visible_to_patient = true );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
-- ============================================================
-- Done. The doctor writes recommendations from the consultation OR surgical
-- workspace; flipping visible_to_patient publishes/unpublishes a single item to
-- the patient portal. Same table for every state of the patient's journey.
-- ============================================================
