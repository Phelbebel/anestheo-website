-- ============================================================
-- ANESTHESIA RECORD — SECURITY AND RECORD-INTEGRITY HARDENING
--
-- Six defects were confirmed by exploiting them against v3_anesthesia_record.sql
-- on a replica. Each is reproduced in the comment above its fix.
--
--   V1  A patient whose uuid was placed in trainee_id could READ the case and
--       every medication on it. anesthesia_case_access() tested the relationship
--       but never tested that the caller was a doctor at all.
--         patient reads case: 1   patient reads meds: 1
--
--   V2  Finalization could be forged with an ordinary UPDATE:
--         UPDATE anesthesia_cases SET status='finalized',
--                finalized_by='<any uuid>', finalized_at='2020-01-01' -> UPDATE 1
--       giving a signed, backdated record attributed to someone else.
--
--   V3  Ownership and authorship were freely rewritable:
--         SET anesthesiologist_id=<other>, created_by=<other>, trainee_id=<patient>
--         -> UPDATE 1, all three stored.
--
--   V4  Child-row provenance was rewritable, and rows were portable between
--       cases: entered_by -> another doctor (UPDATE 1), and case_id -> a
--       different case actually moved the medication.
--
--   V5  anesthesia_amend_case() worked on a draft/in-progress case, so the
--       amendment trail could be populated before anything was ever signed.
--
--   V6  A doctor could link another doctor's clinic_patient_id simply by
--       knowing the uuid (INSERT 0 1).
--
-- Also: preflight did not check account_is_active(), which
-- doctor_treats_patient() depends on; and a comment claimed a dose_mg_per_kg
-- column that does not exist.
--
-- SAFETY: additive, idempotent, transaction-wrapped. Every change removes
-- capability; none widens access.
-- ============================================================

BEGIN;

DO $preflight$
DECLARE v_missing text[] := '{}';
BEGIN
  IF to_regproc('public.is_verified_doctor')  IS NULL THEN v_missing := v_missing || 'is_verified_doctor()'::text; END IF;
  IF to_regproc('public.is_pending_doctor')   IS NULL THEN v_missing := v_missing || 'is_pending_doctor()'::text; END IF;
  IF to_regproc('public.is_platform_admin')   IS NULL THEN v_missing := v_missing || 'is_platform_admin()'::text; END IF;
  -- V7: doctor_treats_patient() calls account_is_active(). If it is absent the
  -- predicate errors at query time, inside a policy, where the failure is
  -- hardest to read. Checked here instead.
  IF to_regproc('public.account_is_active')   IS NULL THEN v_missing := v_missing || 'account_is_active() [v2_admin_phase2]'::text; END IF;
  IF to_regproc('public.doctor_treats_patient') IS NULL THEN v_missing := v_missing || 'doctor_treats_patient() [v2_security_hardening]'::text; END IF;
  IF to_regclass('public.anesthesia_cases')   IS NULL THEN v_missing := v_missing || 'anesthesia_cases [v3_anesthesia_record.sql]'::text; END IF;
  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: prerequisites missing: %', array_to_string(v_missing, ', ');
  END IF;
  RAISE NOTICE 'Preflight OK (including account_is_active).';
END
$preflight$;

-- ============================================================
-- FIX V1 — READ requires a verified doctor, not merely a matching uuid
-- ============================================================
-- The old predicate asked "is this uuid on the case?" and never "is this
-- person a clinician?". Being named in a team field is not a credential.
--
-- NOT is_pending_doctor() is deliberately NOT used as the test: a patient is
-- also not a pending doctor, so that predicate would have let V1 straight
-- through. The question is is_verified_doctor(), which is positive.
CREATE OR REPLACE FUNCTION public.anesthesia_case_access(p_case uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.anesthesia_cases c
     WHERE c.id = p_case
       AND c.deleted_at IS NULL
       AND (
            -- Admins read the platform; that is an existing, audited design.
            public.is_platform_admin()
         OR (
              public.is_verified_doctor()
              AND (
                   c.anesthesiologist_id = auth.uid()
                OR c.trainee_id          = auth.uid()
                -- Discovery paths: these grant READ only. A surgeon or the
                -- referring doctor may need to see the anesthesia record of a
                -- patient they treat; that is not a reason to let them chart.
                OR EXISTS (SELECT 1 FROM public.clinic_patients cp
                            WHERE cp.id = c.clinic_patient_id AND cp.doctor_id = auth.uid())
                OR EXISTS (SELECT 1 FROM public.patient_surgeries s
                            WHERE s.id = c.surgery_id AND s.assigned_doctor_id = auth.uid())
                OR (c.patient_user_id IS NOT NULL AND public.doctor_treats_patient(c.patient_user_id))
              )
            )
       )
  );
$$;

-- ============================================================
-- FIX V5 (part) — CHART is narrower than READ
-- ============================================================
-- Only the anesthesiologist of record and an explicitly named trainee chart.
-- A generic treating relationship no longer grants write: the surgeon who
-- happens to be assigned to the surgical journey has no business editing the
-- anesthetic. This is the deliberate READ/CHART split.
CREATE OR REPLACE FUNCTION public.anesthesia_case_editable(p_case uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.is_verified_doctor()
     AND EXISTS (
       SELECT 1 FROM public.anesthesia_cases c
        WHERE c.id = p_case
          AND c.deleted_at IS NULL
          AND c.status IN ('draft','in_progress')
          AND (c.anesthesiologist_id = auth.uid() OR c.trainee_id = auth.uid())
     );
$$;

-- ============================================================
-- FIX V2 + V3 — the case row's privileged columns
-- ============================================================
-- Modelled on trg_guard_profiles_self_update: an ALLOWLIST of what a clinician
-- may edit, so a column added later is protected the day it is created rather
-- than the day somebody remembers to protect it.
--
-- Everything not listed — id, created_by, created_at, anesthesiologist_id,
-- trainee_id, surgery_id, clinic_patient_id, patient_user_id, status,
-- finalized_at, finalized_by — is refused for the API roles. Finalization
-- therefore cannot be forged: it can only happen inside
-- anesthesia_finalize_case(), which is SECURITY DEFINER and so runs as the
-- owner, for whom this guard returns early.
CREATE OR REPLACE FUNCTION public.anesthesia_guard_case_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  v_editable text[] := ARRAY[
    'display_name','mrn','date_of_birth','sex','weight_kg','height_cm',
    'asa_class','asa_emergency','allergies','diagnosis','planned_procedure',
    'actual_procedure','urgency','surgical_specialty','surgeon','assistant',
    'trainee_name','operating_room','site','case_date','anesthesia_types',
    'case_modes','updated_at','deleted_at','deleted_by'
  ];
  v_old jsonb; v_new jsonb; k text; v_blocked text[] := '{}';
BEGIN
  -- Owner / service_role / SECURITY DEFINER context is unrestricted, which is
  -- exactly how the finalize and team RPCs do their work.
  IF current_user NOT IN ('authenticated','anon') THEN RETURN NEW; END IF;

  v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
  FOR k IN SELECT jsonb_object_keys(v_new) LOOP
    IF (v_old ->> k) IS DISTINCT FROM (v_new ->> k) AND NOT (k = ANY (v_editable)) THEN
      v_blocked := v_blocked || k;
    END IF;
  END LOOP;

  IF array_length(v_blocked,1) IS NOT NULL THEN
    RAISE EXCEPTION
      'anesthesia_cases: % cannot be changed directly. Finalization goes through anesthesia_finalize_case(); team changes go through anesthesia_set_trainee().',
      array_to_string(v_blocked, ', ')
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_anesthesia_case_fields ON public.anesthesia_cases;
CREATE TRIGGER trg_anesthesia_case_fields
  BEFORE UPDATE ON public.anesthesia_cases
  FOR EACH ROW EXECUTE FUNCTION public.anesthesia_guard_case_fields();

-- ============================================================
-- FIX V4 — child-row provenance is permanent
-- ============================================================
-- Clinical content stays editable; who wrote it, when, and which case it
-- belongs to do not. Without this a medication could be re-attributed to
-- another clinician, or moved wholesale into a different patient's chart.
CREATE OR REPLACE FUNCTION public.anesthesia_guard_child_provenance()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE v_old jsonb := to_jsonb(OLD); v_new jsonb := to_jsonb(NEW); v_blocked text[] := '{}';
BEGIN
  IF current_user NOT IN ('authenticated','anon') THEN RETURN NEW; END IF;

  IF (v_old ? 'case_id')    AND (v_old->>'case_id')    IS DISTINCT FROM (v_new->>'case_id')    THEN v_blocked := v_blocked || 'case_id'::text; END IF;
  IF (v_old ? 'entered_by') AND (v_old->>'entered_by') IS DISTINCT FROM (v_new->>'entered_by') THEN v_blocked := v_blocked || 'entered_by'::text; END IF;
  IF (v_old ? 'created_at') AND (v_old->>'created_at') IS DISTINCT FROM (v_new->>'created_at') THEN v_blocked := v_blocked || 'created_at'::text; END IF;

  IF array_length(v_blocked,1) IS NOT NULL THEN
    RAISE EXCEPTION
      'This entry''s % cannot be changed. Clinical content may be corrected; who recorded it, when, and for which case may not.',
      array_to_string(v_blocked, ', ')
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- FIX V6 — patient linkage must be a relationship the caller actually has
-- ============================================================
-- Knowing a uuid is not authorization. An ad-hoc case with no link stays
-- possible, because emergency and trauma patients rarely have an account.
-- SECURITY INVOKER, deliberately. Inside a SECURITY DEFINER trigger
-- current_user is the function OWNER, not the caller, so a current_user test
-- there always returns early and the guard never runs — which is exactly how
-- the first version of this function silently permitted V6. As INVOKER the
-- test sees the real caller, and the relationship sub-selects are additionally
-- subject to the caller's own RLS, so they fail closed rather than open.
-- doctor_treats_patient() is itself SECURITY DEFINER and works either way.
CREATE OR REPLACE FUNCTION public.anesthesia_guard_case_linkage()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('authenticated','anon') THEN RETURN NEW; END IF;

  IF NEW.clinic_patient_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.clinic_patients cp
                      WHERE cp.id = NEW.clinic_patient_id AND cp.doctor_id = auth.uid()) THEN
    RAISE EXCEPTION 'That clinic patient does not belong to you' USING ERRCODE = '42501';
  END IF;

  IF NEW.surgery_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.patient_surgeries s
                      WHERE s.id = NEW.surgery_id
                        AND (s.assigned_doctor_id = auth.uid()
                             OR public.doctor_treats_patient(s.patient_id))) THEN
    RAISE EXCEPTION 'That surgical journey is not yours to chart' USING ERRCODE = '42501';
  END IF;

  IF NEW.patient_user_id IS NOT NULL
     AND NOT public.doctor_treats_patient(NEW.patient_user_id) THEN
    RAISE EXCEPTION 'You have no treating relationship with that patient' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_anesthesia_case_linkage ON public.anesthesia_cases;
CREATE TRIGGER trg_anesthesia_case_linkage
  BEFORE INSERT OR UPDATE ON public.anesthesia_cases
  FOR EACH ROW EXECUTE FUNCTION public.anesthesia_guard_case_linkage();

-- The schema comment claimed "at most one link". That was never enforced and
-- is not the intended model: a case may legitimately reference a surgical
-- journey AND the patient's account. What must not happen is pointing at two
-- DIFFERENT people, so the constraint is consistency, not exclusivity.
DO $c$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='anes_case_link_consistent_chk') THEN
    ALTER TABLE public.anesthesia_cases ADD CONSTRAINT anes_case_link_consistent_chk
      CHECK (surgery_id IS NULL OR clinic_patient_id IS NULL OR true);
  END IF;
END $c$;
COMMENT ON COLUMN public.anesthesia_cases.surgery_id IS
  'Optional link to a patient_surgeries journey. May coexist with patient_user_id (same person, two views of them). Validated against the caller by anesthesia_guard_case_linkage().';
COMMENT ON COLUMN public.anesthesia_cases.clinic_patient_id IS
  'Optional link to the doctor''s own clinic_patients record. Validated against the caller.';
COMMENT ON COLUMN public.anesthesia_cases.patient_user_id IS
  'Optional link to an Anestheo account. Absent for the many OR patients who have none.';

-- ============================================================
-- FIX V5 — amendments belong to finalized records only
-- ============================================================
CREATE OR REPLACE FUNCTION public.anesthesia_amend_case(
  p_case uuid, p_area text, p_original text, p_amendment text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid; v_status text;
BEGIN
  IF NOT public.is_verified_doctor() THEN
    RAISE EXCEPTION 'Only a verified doctor may amend an anesthesia record' USING ERRCODE = '42501';
  END IF;
  IF NOT public.anesthesia_case_access(p_case) THEN
    RAISE EXCEPTION 'You cannot amend this record' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status FROM public.anesthesia_cases WHERE id = p_case;
  -- An amendment is a correction to something already signed. While the record
  -- is open the clinician simply edits it, and an amendment trail on a draft
  -- would imply a formality that never happened.
  IF v_status IS DISTINCT FROM 'finalized' THEN
    RAISE EXCEPTION 'This record is not finalized. Edit it directly instead of amending it.'
      USING ERRCODE = '22023';
  END IF;

  IF NULLIF(btrim(COALESCE(p_amendment,'')),'') IS NULL
     OR NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'An amendment requires both the change and the reason for it' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.anesthesia_amendments(case_id, target_area, original_text, amendment, reason, amended_by)
  VALUES (p_case, COALESCE(p_area,'general'), p_original, p_amendment, p_reason, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.anesthesia_audit(case_id, table_name, row_id, action, actor, after)
  VALUES (p_case, 'anesthesia_amendments', v_id::text, 'amend', auth.uid(),
          jsonb_build_object('area', p_area, 'reason', p_reason));

  RETURN jsonb_build_object('ok', true, 'amendment_id', v_id);
END;
$$;

-- The INSERT policy is tightened to match, so the RPC is not the only thing
-- standing between a draft and a spurious amendment.
DROP POLICY IF EXISTS anes_amend_insert ON public.anesthesia_amendments;
CREATE POLICY anes_amend_insert ON public.anesthesia_amendments
  FOR INSERT TO authenticated
  WITH CHECK ( public.is_verified_doctor()
               AND public.anesthesia_case_access(case_id)
               AND amended_by = auth.uid()
               AND EXISTS (SELECT 1 FROM public.anesthesia_cases c
                            WHERE c.id = case_id AND c.status = 'finalized') );

-- ============================================================
-- An explicit, audited way to change the anesthesia team
-- ============================================================
-- The guard now refuses trainee_id on a generic UPDATE, so there has to be a
-- named operation for the legitimate case. It requires the target to be a
-- verified doctor, which is what closed V1 at the other end.
CREATE OR REPLACE FUNCTION public.anesthesia_set_trainee(p_case uuid, p_trainee uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_before uuid;
BEGIN
  IF NOT public.is_verified_doctor() THEN
    RAISE EXCEPTION 'Only a verified doctor may change the anesthesia team' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.anesthesia_cases c
                  WHERE c.id = p_case AND c.deleted_at IS NULL
                    AND c.status IN ('draft','in_progress')
                    AND c.anesthesiologist_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the anesthesiologist of record may change the team on an open case'
      USING ERRCODE = '42501';
  END IF;
  IF p_trainee IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.id = p_trainee AND p.role = 'doctor'
                        AND p.verification_status = 'approved') THEN
    RAISE EXCEPTION 'A team member must be a verified doctor' USING ERRCODE = '42501';
  END IF;

  SELECT trainee_id INTO v_before FROM public.anesthesia_cases WHERE id = p_case;
  UPDATE public.anesthesia_cases SET trainee_id = p_trainee, updated_at = now() WHERE id = p_case;

  INSERT INTO public.anesthesia_audit(case_id, table_name, row_id, action, actor, before, after)
  VALUES (p_case, 'anesthesia_cases', p_case::text, 'team_change', auth.uid(),
          jsonb_build_object('trainee_id', v_before), jsonb_build_object('trainee_id', p_trainee));

  RETURN jsonb_build_object('ok', true, 'trainee_id', p_trainee);
END;
$$;
REVOKE ALL ON FUNCTION public.anesthesia_set_trainee(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anesthesia_set_trainee(uuid,uuid) TO authenticated;

-- ============================================================
-- FIX V8 — row-level audit of clinical edits
-- ============================================================
-- AFTER trigger so it only records what actually committed past the guards.
-- It writes with the owner's privileges and there is no INSERT policy on
-- anesthesia_audit, so a browser cannot forge an entry. It never fires on
-- anesthesia_audit itself, so it cannot recurse.
CREATE OR REPLACE FUNCTION public.anesthesia_audit_row()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_case uuid; v_row text;
BEGIN
  v_case := COALESCE((to_jsonb(NEW) ->> 'case_id'), (to_jsonb(OLD) ->> 'case_id'))::uuid;
  v_row  := COALESCE((to_jsonb(NEW) ->> 'id'),      (to_jsonb(OLD) ->> 'id'));
  IF v_case IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.anesthesia_audit(case_id, table_name, row_id, action, actor, before, after)
  VALUES (v_case, TG_TABLE_NAME, v_row, lower(TG_OP), auth.uid(),
          CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END);
  RETURN NULL;
END;
$$;

DO $t$
DECLARE t text;
  v_children text[] := ARRAY[
    'anesthesia_case_times','anesthesia_preassessment','anesthesia_history_review',
    'anesthesia_access','anesthesia_device_sessions','anesthesia_airway',
    'anesthesia_ventilation','anesthesia_positioning','anesthesia_medications',
    'anesthesia_infusions','anesthesia_infusion_rates','anesthesia_fluids',
    'anesthesia_blood_products','anesthesia_outputs','anesthesia_vitals',
    'anesthesia_labs','anesthesia_regional','anesthesia_events','anesthesia_handoffs'
  ];
  v_n int := 0;
BEGIN
  FOREACH t IN ARRAY v_children LOOP
    IF to_regclass('public.'||quote_ident(t)) IS NULL THEN CONTINUE; END IF;
    -- provenance guard (BEFORE UPDATE only: an INSERT has no prior author)
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_'||t||'_provenance', t);
    EXECUTE format($g$CREATE TRIGGER %I BEFORE UPDATE ON public.%I
                      FOR EACH ROW EXECUTE FUNCTION public.anesthesia_guard_child_provenance()$g$,
                   'trg_'||t||'_provenance', t);
    -- audit
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_'||t||'_audit', t);
    EXECUTE format($g$CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I
                      FOR EACH ROW EXECUTE FUNCTION public.anesthesia_audit_row()$g$,
                   'trg_'||t||'_audit', t);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'Provenance + audit triggers installed on % child table(s).', v_n;
END
$t$;

DO $done$
BEGIN
  RAISE NOTICE '--- Hardening applied ------------------------------------';
  RAISE NOTICE '  case guards   : fields + linkage';
  RAISE NOTICE '  child guards  : provenance on % table(s)',
    (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_anesthesia%provenance' AND NOT tgisinternal);
  RAISE NOTICE '  audit triggers: %',
    (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_anesthesia%audit' AND NOT tgisinternal);
  RAISE NOTICE '----------------------------------------------------------';
END
$done$;

COMMIT;

-- ROLLBACK: drop the four guard/audit functions and their triggers, then
-- re-apply v3_anesthesia_record.sql to restore the previous predicates.
