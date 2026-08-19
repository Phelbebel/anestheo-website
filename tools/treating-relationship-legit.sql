\set ON_ERROR_STOP off
\pset pager off
BEGIN;

-- NOTE: no `origin` column. v2_preparation_origin_migration.sql was never
-- applied to production, and a fixture that invents columns tests a database
-- that does not exist. This is what let the first v9_2 through review.
CREATE TABLE res(n serial, name text, pass boolean, detail text);
GRANT ALL ON res TO PUBLIC; GRANT ALL ON SEQUENCE res_n_seq TO PUBLIC;
CREATE OR REPLACE FUNCTION pg_temp.be(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claim.sub', u::text, true); EXECUTE 'SET LOCAL ROLE authenticated'; END $$;
CREATE OR REPLACE FUNCTION pg_temp.god() RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE OR REPLACE FUNCTION pg_temp.t(nm text, ok boolean, d text DEFAULT '') RETURNS void
LANGUAGE sql AS $$ INSERT INTO res(name,pass,detail) VALUES (nm, ok, d) $$;

\set DOC '''1a000000-0000-4000-8000-00000000000d'''
\set PAT '''1b000000-0000-4000-8000-00000000000e'''
INSERT INTO auth.users(id,email) VALUES (:DOC,'legitdoc@t'),(:PAT,'legitpat@t') ON CONFLICT DO NOTHING;
UPDATE public.profiles SET role='doctor', verification_status='approved', account_status='active',
  deleted_at=NULL, full_name='Legit Doctor' WHERE id=:DOC;
UPDATE public.profiles SET role='patient', verification_status='not_required', account_status='active',
  deleted_at=NULL, full_name='Legit Patient' WHERE id=:PAT;

-- ── 1. The doctor's real "add a patient" flow (dashboard.html wsSavePatient) ──
SELECT pg_temp.be(:DOC);
DO $$ BEGIN
  INSERT INTO public.clinic_patients(id, doctor_id, patient_name, phone_number, email, procedure, hospital)
  VALUES ('2a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-00000000000d',
          'Walk-in Patient','+995555111222','walkin@t','Knee','Central');
  PERFORM pg_temp.t('L1 a doctor can still create a clinic patient', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.t('L1 a doctor can still create a clinic patient', false, SQLSTATE||' '||SQLERRM);
END $$;

DO $$ BEGIN
  INSERT INTO public.patient_surgeries(id, patient_id, assigned_doctor_id, clinic_patient_id,
                                       patient_name, procedure_type, care_state)
  VALUES ('2b000000-0000-4000-8000-000000000001', NULL,'1a000000-0000-4000-8000-00000000000d',
          '2a000000-0000-4000-8000-000000000001','Walk-in Patient','Knee','surgical');
  PERFORM pg_temp.t('L2 ...and the paired journey with patient_id NULL, as the product does', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.t('L2 ...and the paired journey with patient_id NULL, as the product does', false, SQLSTATE||' '||SQLERRM);
END $$;

DO $$ BEGIN
  UPDATE public.clinic_patients SET questionnaire_status='sent', sent_at=now()
   WHERE id='2a000000-0000-4000-8000-000000000001';
  PERFORM pg_temp.t('L3 ...and can still work the record (send the questionnaire)', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.t('L3 ...and can still work the record (send the questionnaire)', false, SQLSTATE||' '||SQLERRM);
END $$;

-- ── 2. The patient's own journey (patient-dashboard.html) ──
SELECT pg_temp.god(); SELECT pg_temp.be(:PAT);
DO $$ BEGIN
  INSERT INTO public.patient_surgeries(id, patient_id, patient_name, procedure_type, care_state)
  VALUES ('2b000000-0000-4000-8000-000000000002','1b000000-0000-4000-8000-00000000000e',
          'Legit Patient','Hip','surgical');
  PERFORM pg_temp.t('L4 a patient can still create their OWN journey', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.t('L4 a patient can still create their OWN journey', false, SQLSTATE||' '||SQLERRM);
END $$;
DO $$ BEGIN
  UPDATE public.patient_surgeries SET surgeon='Dr Smith', hospital='General'
   WHERE id='2b000000-0000-4000-8000-000000000002';
  PERFORM pg_temp.t('L5 ...and still edit it', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.t('L5 ...and still edit it', false, SQLSTATE||' '||SQLERRM);
END $$;

-- ── 3. The care-request handshake, end to end ──
DO $$ BEGIN
  INSERT INTO public.care_requests(id, patient_id, doctor_id, surgery_id, status)
  VALUES ('2c000000-0000-4000-8000-000000000001','1b000000-0000-4000-8000-00000000000e',
          '1a000000-0000-4000-8000-00000000000d','2b000000-0000-4000-8000-000000000002','requested');
  PERFORM pg_temp.t('L6 a patient can still request a clinician', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.t('L6 a patient can still request a clinician', false, SQLSTATE||' '||SQLERRM);
END $$;

SELECT pg_temp.god(); SELECT pg_temp.be(:DOC);
SELECT pg_temp.t('L7 the doctor does NOT treat them before accepting',
  NOT public.doctor_treats_patient(:PAT));
DO $$ BEGIN
  UPDATE public.care_requests SET status='accepted', responded_at=now()
   WHERE id='2c000000-0000-4000-8000-000000000001';
  PERFORM pg_temp.t('L8 the doctor can still ACCEPT it', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.t('L8 the doctor can still ACCEPT it', false, SQLSTATE||' '||SQLERRM);
END $$;
SELECT pg_temp.t('L9 ...and the treating relationship is now real',
  public.doctor_treats_patient(:PAT));

-- ── 4. The Edge Function link (service_role / owner) still works ──
SELECT pg_temp.god();
DO $$ BEGIN
  UPDATE public.clinic_patients SET auth_user_id='1b000000-0000-4000-8000-00000000000e',
         converted_at=now() WHERE id='2a000000-0000-4000-8000-000000000001';
  PERFORM pg_temp.t('L10 convert_clinic_patient (service_role) can still link an account', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.t('L10 convert_clinic_patient (service_role) can still link an account', false, SQLSTATE||' '||SQLERRM);
END $$;
SELECT pg_temp.be(:DOC);
SELECT pg_temp.t('L11 ...and that server-made link DOES establish the relationship',
  public.doctor_treats_patient(:PAT));

-- ── 5. Admin RPCs are SECURITY DEFINER and pass straight through ──
SELECT pg_temp.god();
INSERT INTO auth.users(id,email) VALUES ('1c000000-0000-4000-8000-00000000000a','legitadm@t') ON CONFLICT DO NOTHING;
UPDATE public.profiles SET role='admin', is_admin=true, account_status='active', deleted_at=NULL
 WHERE id='1c000000-0000-4000-8000-00000000000a';
SELECT pg_temp.be('1c000000-0000-4000-8000-00000000000a');
DO $$ BEGIN
  PERFORM public.admin_assign_doctor('2b000000-0000-4000-8000-000000000002',
                                     '1a000000-0000-4000-8000-00000000000d','reassignment test');
  PERFORM pg_temp.t('L12 admin_assign_doctor still works through the guards', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.t('L12 admin_assign_doctor still works through the guards', false, SQLSTATE||' '||SQLERRM);
END $$;

-- ── 6. Soft-deleting a link now ends the relationship ──
SELECT pg_temp.god();
UPDATE public.care_requests SET deleted_at=now() WHERE id='2c000000-0000-4000-8000-000000000001';
UPDATE public.clinic_patients SET deleted_at=now() WHERE id='2a000000-0000-4000-8000-000000000001';
UPDATE public.patient_surgeries SET deleted_at=now() WHERE id='2b000000-0000-4000-8000-000000000002';
SELECT pg_temp.be(:DOC);
SELECT pg_temp.t('L13 a relationship whose every link is soft-deleted no longer counts',
  NOT public.doctor_treats_patient(:PAT),
  CASE WHEN public.doctor_treats_patient(:PAT) THEN 'still true' ELSE 'correctly false' END);

SELECT pg_temp.god();
\echo ''
SELECT lpad(n::text,3)||'  '||CASE WHEN pass THEN 'ok   ' ELSE 'BROKE' END||rpad(name,64)||coalesce(detail,'') AS "  legitimate flows"
  FROM res ORDER BY n;
SELECT count(*) FILTER (WHERE pass)||' working, '||count(*) FILTER (WHERE NOT pass)||' BROKEN' AS "  total" FROM res;
ROLLBACK;
