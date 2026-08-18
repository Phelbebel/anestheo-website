-- ============================================================
-- v9_2_treating_relationship_integrity.sql
-- PREPARED FOR REVIEW — NOT APPLIED.
-- APPLY BEFORE v9_doctor_access_model.sql. THIS IS A SECURITY FIX.
-- ============================================================
--
-- THE HOLE
-- --------
-- doctor_treats_patient(p_patient) is the predicate that decides whether a
-- clinician may reach a patient's Health Passport, their preop questionnaire
-- and checklist, and an anesthesia case about them authored by somebody else.
-- It returns true when ANY of three rows exists:
--
--   patient_surgeries  patient_id = p_patient  AND assigned_doctor_id = caller
--   care_requests      patient_id = p_patient  AND doctor_id = caller
--                        AND status IN ('accepted','closed')
--   clinic_patients    auth_user_id = p_patient AND doctor_id = caller
--
-- Every one of those rows names the PATIENT in a column, and until this file
-- nothing stopped a doctor from writing whatever they liked into that column
-- on a row they own. Measured on a replica, as an ordinary authenticated
-- doctor with no relationship to the victim:
--
--   A. INSERT clinic_patients (doctor_id = self, auth_user_id = <victim>)
--        cp_insert checks only `auth.uid() = doctor_id`.        SUCCEEDS
--   B. INSERT patient_surgeries (patient_id = <victim>, assigned_doctor_id = self)
--        ps_insert accepts `auth.uid() = assigned_doctor_id`.   SUCCEEDS
--   D. UPDATE an existing clinic_patients / patient_surgeries row, repointing
--        auth_user_id / patient_id at the victim.               SUCCEEDS
--   E. UPDATE a legitimately accepted care_request, repointing patient_id
--        at the victim.                                          SUCCEEDS
--
--   C. INSERT care_requests — cr_insert checks `auth.uid() = patient_id`,
--        so a doctor cannot forge one.                           REFUSED
--
-- One self-issued INSERT, with no patient, administrator or other clinician
-- involved, was enough. Measured blast radius for a VERIFIED doctor against an
-- arbitrary account: their Health Passport including allergy entries, their
-- preop questionnaire, another doctor's anesthesia case about them and its
-- charted medications — plus the ability to stamp a passport entry
-- clinician-verified. Read only; charting stayed refused.
--
-- THIS PREDATES v9. It is reachable today by any approved doctor. v9 does not
-- create it — but it widens who can reach parts of it from "doctors an
-- administrator approved" to "anyone who completes the registration form", so
-- this must land BEFORE the access model, not after.
--
-- THE FIX
-- -------
-- A doctor may not NAME an Anestheo account on a record they own. Linking a
-- clinical record to a real account is a statement about a person who is not
-- the doctor, so it belongs to that person, to an administrator, or to the
-- server-side conversion the schema was already designed around.
--
-- NOTHING LEGITIMATE WRITES THESE COLUMNS FROM A BROWSER. Verified against the
-- whole client before writing a line of this file:
--   * dashboard.html wsCollectAdd() builds a clinic_patients row from name,
--     phone, email, procedure, hospital, date and notes. No auth_user_id.
--   * dashboard.html wsSavePatient() creates the paired journey with
--     `patient_id: null` — a doctor-created patient has no account yet, by
--     design.
--   * patient-dashboard.html creates a journey with `patient_id: _uid`, the
--     patient's own id.
--   * grep for auth_user_id across every .js and .html returns nothing.
-- v2_clinic_bridge_convergence.sql says who does write it: the
-- convert_clinic_patient Edge Function, which runs as service_role and is
-- therefore untouched by guards scoped to the API roles.
--
-- So this file removes a capability nothing was using and an attacker was.
-- ============================================================

BEGIN;

DO $preflight$
DECLARE v_missing text[] := '{}';
BEGIN
  IF to_regclass('public.clinic_patients')   IS NULL THEN v_missing := v_missing || 'clinic_patients'::text; END IF;
  IF to_regclass('public.patient_surgeries') IS NULL THEN v_missing := v_missing || 'patient_surgeries'::text; END IF;
  IF to_regclass('public.care_requests')     IS NULL THEN v_missing := v_missing || 'care_requests'::text; END IF;
  IF to_regproc('public.doctor_treats_patient') IS NULL THEN
    v_missing := v_missing || 'doctor_treats_patient() [v2_security_hardening.sql]'::text; END IF;
  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: prerequisites missing: %', array_to_string(v_missing, ', ');
  END IF;
  RAISE NOTICE 'Preflight OK.';
END
$preflight$;

-- ============================================================
-- 1. clinic_patients.auth_user_id — set by the server, never by the doctor
-- ============================================================
-- SECURITY INVOKER so it sees the REAL caller. Owner, service_role and every
-- SECURITY DEFINER admin RPC return at the first test, exactly as
-- guard_profiles_self_update() and guard_patient_surgeries_protected() do —
-- this is the established idiom in this schema, not a new mechanism.
CREATE OR REPLACE FUNCTION public.guard_clinic_patient_link()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('authenticated','anon') THEN
    RETURN NEW;                       -- Edge Function / admin RPC / owner
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.auth_user_id IS NOT NULL THEN
      RAISE EXCEPTION
        'clinic_patients.auth_user_id cannot be set here. Linking a clinic record to an Anestheo account is done by the patient claiming it, not by the clinician asserting it.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
    RAISE EXCEPTION
      'clinic_patients.auth_user_id cannot be changed here. Re-pointing an existing clinic record at a different account would transfer a treating relationship without either patient knowing.'
      USING ERRCODE = '42501';
  END IF;

  -- Ownership is a relationship, not a field to reassign. Handing a record to
  -- another clinician is admin_assign_doctor()'s job, and that is audited.
  IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id THEN
    RAISE EXCEPTION 'clinic_patients.doctor_id is changed through an audited admin action, not directly.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_clinic_patient_link ON public.clinic_patients;
CREATE TRIGGER trg_guard_clinic_patient_link
  BEFORE INSERT OR UPDATE ON public.clinic_patients
  FOR EACH ROW EXECUTE FUNCTION public.guard_clinic_patient_link();

-- ============================================================
-- 2. patient_surgeries.patient_id — your own id, or nobody's
-- ============================================================
-- A doctor creating a journey for someone who has no account yet writes NULL,
-- which is what the product already does. A patient creating their own writes
-- their own id. There is no third legitimate case, and the third case is the
-- attack.
--
-- Deliberately a SEPARATE trigger from guard_patient_surgeries_protected(),
-- which is BEFORE UPDATE only and guards the workflow columns. Folding this
-- into it would mean making that function handle INSERT, where OLD is NULL and
-- every `IS DISTINCT FROM OLD.x` comparison is true — a rewrite of working
-- security code to save one trigger.
CREATE OR REPLACE FUNCTION public.guard_patient_surgery_subject()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('authenticated','anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.patient_id IS NOT NULL AND NEW.patient_id <> auth.uid() THEN
      RAISE EXCEPTION
        'patient_surgeries.patient_id must be your own account or empty. A clinician-created journey is linked to an account when the patient claims it.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.patient_id IS DISTINCT FROM OLD.patient_id THEN
    RAISE EXCEPTION
      'patient_surgeries.patient_id cannot be changed here. A journey belongs to the person it was created for.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_patient_surgery_subject ON public.patient_surgeries;
CREATE TRIGGER trg_guard_patient_surgery_subject
  BEFORE INSERT OR UPDATE ON public.patient_surgeries
  FOR EACH ROW EXECUTE FUNCTION public.guard_patient_surgery_subject();

-- ============================================================
-- 3. care_requests — the parties are fixed when the patient asks
-- ============================================================
-- cr_insert already requires auth.uid() = patient_id, so a doctor cannot forge
-- a request; that path was the one of the four that held. What did not hold is
-- UPDATE: cr_update admits the named doctor, and nothing stopped them
-- repointing patient_id at somebody else while remaining the doctor — turning
-- one patient's genuine, accepted request into a relationship with a stranger.
--
-- Accepting, declining, revoking and closing all change `status` and nothing
-- else, so pinning both parties costs the workflow nothing.
CREATE OR REPLACE FUNCTION public.guard_care_request_parties()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('authenticated','anon') THEN
    RETURN NEW;
  END IF;
  IF NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id THEN
    RAISE EXCEPTION
      'care_requests: the patient and the clinician are fixed when the request is made. Only its status changes.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_care_request_parties ON public.care_requests;
CREATE TRIGGER trg_guard_care_request_parties
  BEFORE UPDATE ON public.care_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_care_request_parties();

-- ============================================================
-- 4. DEFENCE IN DEPTH — the predicate ignores a link to a deleted record
-- ============================================================
-- Not part of the hole, and not a substitute for sections 1-3: a soft-deleted
-- clinic record or journey should not keep a treating relationship alive, and
-- the care_requests clause already excludes deleted rows while the other two
-- did not. Making the three clauses agree removes a discrepancy rather than
-- adding a rule.
CREATE OR REPLACE FUNCTION public.doctor_treats_patient(p_patient uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p_patient IS NOT NULL AND auth.uid() IS NOT NULL
     AND public.account_is_active(auth.uid())
     AND (
    EXISTS (SELECT 1 FROM public.patient_surgeries s
             WHERE s.patient_id = p_patient AND s.assigned_doctor_id = auth.uid()
               AND s.deleted_at IS NULL)
    OR
    EXISTS (SELECT 1 FROM public.care_requests r
             WHERE r.patient_id = p_patient AND r.doctor_id = auth.uid()
               AND r.status IN ('accepted','closed')
               AND r.deleted_at IS NULL)
    OR
    EXISTS (SELECT 1 FROM public.clinic_patients c
             WHERE c.auth_user_id = p_patient AND c.doctor_id = auth.uid()
               AND c.deleted_at IS NULL)
  );
$$;
REVOKE ALL ON FUNCTION public.doctor_treats_patient(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.doctor_treats_patient(uuid) TO authenticated;

-- ============================================================
-- 5. REPORT ANY RELATIONSHIP THAT COULD ALREADY HAVE BEEN FORGED
-- ============================================================
-- Reported, never deleted. These rows may be entirely legitimate — the Edge
-- Function writes auth_user_id for real conversions — and a migration that
-- silently removes clinical links is worse than the hole it is closing. This
-- prints what to look at; a human decides.
DO $audit$
DECLARE v_cp int; v_ps int;
BEGIN
  SELECT count(*) INTO v_cp FROM public.clinic_patients WHERE auth_user_id IS NOT NULL;
  SELECT count(*) INTO v_ps FROM public.patient_surgeries s
   WHERE s.patient_id IS NOT NULL AND s.assigned_doctor_id IS NOT NULL
     AND s.clinic_patient_id IS NULL AND s.origin = 'clinic';
  RAISE NOTICE '--- Existing account links, for review ------------------';
  RAISE NOTICE '  clinic_patients with auth_user_id set : %', v_cp;
  RAISE NOTICE '  clinic-origin journeys naming an account with no clinic back-link : %', v_ps;
  RAISE NOTICE '  Both are normal in small numbers. Investigate only if either is';
  RAISE NOTICE '  larger than your real conversion volume.';
  RAISE NOTICE '  Review: SELECT id, doctor_id, auth_user_id, converted_at';
  RAISE NOTICE '            FROM public.clinic_patients WHERE auth_user_id IS NOT NULL;';
END
$audit$;

-- ============================================================
-- 6. POST-VERIFY (inside the transaction; ABORTS on failure)
-- ============================================================
DO $verify$
DECLARE v_bad text[] := '{}';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_guard_clinic_patient_link')
    THEN v_bad := v_bad || 'V1 clinic_patients link guard missing'::text; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_guard_patient_surgery_subject')
    THEN v_bad := v_bad || 'V2 patient_surgeries subject guard missing'::text; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_guard_care_request_parties')
    THEN v_bad := v_bad || 'V3 care_requests parties guard missing'::text; END IF;
  -- The pre-existing workflow guard must still be there; this file adds to it.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_guard_patient_surgeries')
    THEN v_bad := v_bad || 'V4 the existing patient_surgeries workflow guard was lost'::text; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='doctor_treats_patient'
                    AND p.prosrc LIKE '%s.deleted_at IS NULL%')
    THEN v_bad := v_bad || 'V5 doctor_treats_patient still counts deleted records'::text; END IF;
  IF array_length(v_bad,1) IS NOT NULL THEN
    RAISE EXCEPTION E'POST-VERIFY FAILED — nothing committed:\n  %', array_to_string(v_bad, E'\n  ');
  END IF;
  RAISE NOTICE 'POST-VERIFY: all 5 checks passed.';
END
$verify$;

COMMIT;

-- ============================================================
-- ROLLBACK
-- ============================================================
--   DROP TRIGGER IF EXISTS trg_guard_clinic_patient_link      ON public.clinic_patients;
--   DROP TRIGGER IF EXISTS trg_guard_patient_surgery_subject  ON public.patient_surgeries;
--   DROP TRIGGER IF EXISTS trg_guard_care_request_parties     ON public.care_requests;
--   -- then re-run v2_security_hardening.sql to restore doctor_treats_patient().
--
-- DO NOT roll this back while v9_doctor_access_model.sql is applied. That
-- combination is the forgeable treating relationship, reachable by anyone who
-- completes the registration form.
