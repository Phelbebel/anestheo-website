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

\set ATT '''aa000000-0000-4000-8000-00000000000d'''
\set VIC '''bb000000-0000-4000-8000-00000000000e'''
INSERT INTO auth.users(id,email) VALUES (:ATT,'attacker@t'),(:VIC,'victim@t') ON CONFLICT DO NOTHING;
UPDATE public.profiles SET role='doctor', is_admin=false, verification_status='pending',
  full_name='Attacker', account_status='active', deleted_at=NULL WHERE id=:ATT;
UPDATE public.profiles SET role='patient', is_admin=false, verification_status='not_required',
  full_name='Victim', account_status='active', deleted_at=NULL WHERE id=:VIC;
-- The victim's own private data.
INSERT INTO public.health_passports(id, patient_id, status, emergency_view_enabled)
VALUES ('cc000000-0000-4000-8000-000000000001', :VIC, 'active', true) ON CONFLICT DO NOTHING;
INSERT INTO public.health_passport_items(id, passport_id, category, label, is_emergency_visible)
VALUES ('cc000000-0000-4000-8000-000000000002','cc000000-0000-4000-8000-000000000001',
        'allergy','Penicillin — anaphylaxis', true) ON CONFLICT DO NOTHING;

SELECT pg_temp.be(:ATT);
SELECT pg_temp.t('BASELINE: attacker does not treat the victim',
  NOT public.doctor_treats_patient(:VIC));

-- ATTACK A — clinic_patients: self-issued, arbitrary auth_user_id
DO $$ BEGIN
  INSERT INTO public.clinic_patients(id, doctor_id, auth_user_id, patient_name, procedure)
  VALUES ('dd000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-00000000000d',
          'bb000000-0000-4000-8000-00000000000e','Victim','Consult');
  PERFORM pg_temp.t('ATTACK A clinic_patients INSERT with an arbitrary auth_user_id is REFUSED',
    false, 'THE INSERT SUCCEEDED');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.t('ATTACK A clinic_patients INSERT with an arbitrary auth_user_id is REFUSED',
    true, SQLSTATE);
END $$;
SELECT pg_temp.t('ATTACK A  -> did it manufacture a treating relationship?',
  NOT public.doctor_treats_patient(:VIC),
  CASE WHEN public.doctor_treats_patient(:VIC) THEN 'YES — RELATIONSHIP MANUFACTURED' ELSE 'no' END);
SELECT pg_temp.t('ATTACK A  -> can the attacker now read the victim Health Passport?',
  NOT public.hp_clinician_may_read('cc000000-0000-4000-8000-000000000001'),
  CASE WHEN public.hp_clinician_may_read('cc000000-0000-4000-8000-000000000001')
       THEN 'YES' ELSE 'no (also blocked by the verification trust gate)' END);
SELECT pg_temp.god(); DELETE FROM public.clinic_patients WHERE id='dd000000-0000-4000-8000-000000000001';
SELECT pg_temp.be(:ATT);

-- ATTACK B — patient_surgeries: self-assign to an arbitrary patient_id
DO $$ BEGIN
  INSERT INTO public.patient_surgeries(id, patient_id, assigned_doctor_id, patient_name, procedure_type, care_state)
  VALUES ('dd000000-0000-4000-8000-000000000002','bb000000-0000-4000-8000-00000000000e',
          'aa000000-0000-4000-8000-00000000000d','Victim','Knee','surgical');
  PERFORM pg_temp.t('ATTACK B patient_surgeries INSERT self-assigning an arbitrary patient is REFUSED',
    false, 'THE INSERT SUCCEEDED');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.t('ATTACK B patient_surgeries INSERT self-assigning an arbitrary patient is REFUSED',
    true, SQLSTATE);
END $$;
SELECT pg_temp.t('ATTACK B  -> did it manufacture a treating relationship?',
  NOT public.doctor_treats_patient(:VIC),
  CASE WHEN public.doctor_treats_patient(:VIC) THEN 'YES — RELATIONSHIP MANUFACTURED' ELSE 'no' END);
SELECT pg_temp.god(); DELETE FROM public.patient_surgeries WHERE id='dd000000-0000-4000-8000-000000000002';
SELECT pg_temp.be(:ATT);

-- ATTACK C — care_requests: forge an accepted request
DO $$ BEGIN
  INSERT INTO public.care_requests(id, patient_id, doctor_id, status)
  VALUES ('dd000000-0000-4000-8000-000000000003','bb000000-0000-4000-8000-00000000000e',
          'aa000000-0000-4000-8000-00000000000d','accepted');
  PERFORM pg_temp.t('ATTACK C care_requests INSERT of a self-accepted request is REFUSED',
    false, 'THE INSERT SUCCEEDED');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.t('ATTACK C care_requests INSERT of a self-accepted request is REFUSED',
    true, SQLSTATE);
END $$;
SELECT pg_temp.t('ATTACK C  -> did it manufacture a treating relationship?',
  NOT public.doctor_treats_patient(:VIC),
  CASE WHEN public.doctor_treats_patient(:VIC) THEN 'YES — RELATIONSHIP MANUFACTURED' ELSE 'no' END);

-- ATTACK D — hijack a LEGITIMATE relationship and repoint it at the victim.
SELECT pg_temp.god();
INSERT INTO auth.users(id,email) VALUES ('bb000000-0000-4000-8000-00000000000f','realpt@t') ON CONFLICT DO NOTHING;
UPDATE public.profiles SET role='patient', account_status='active', deleted_at=NULL
 WHERE id='bb000000-0000-4000-8000-00000000000f';
INSERT INTO public.clinic_patients(id, doctor_id, auth_user_id, patient_name, procedure)
VALUES ('dd000000-0000-4000-8000-000000000004', :ATT, 'bb000000-0000-4000-8000-00000000000f','Real Patient','Consult')
ON CONFLICT DO NOTHING;
INSERT INTO public.patient_surgeries(id, patient_id, assigned_doctor_id, patient_name, procedure_type, care_state)
VALUES ('dd000000-0000-4000-8000-000000000005','bb000000-0000-4000-8000-00000000000f', :ATT,'Real Patient','Hip','surgical')
ON CONFLICT DO NOTHING;
SELECT pg_temp.be(:ATT);
DO $$ BEGIN
  UPDATE public.clinic_patients SET auth_user_id='bb000000-0000-4000-8000-00000000000e'
   WHERE id='dd000000-0000-4000-8000-000000000004';
  PERFORM pg_temp.t('ATTACK D repointing an EXISTING clinic_patients link at the victim is REFUSED',
    (SELECT auth_user_id FROM public.clinic_patients WHERE id='dd000000-0000-4000-8000-000000000004')
      <> 'bb000000-0000-4000-8000-00000000000e', 'update ran');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.t('ATTACK D repointing an EXISTING clinic_patients link at the victim is REFUSED', true, SQLSTATE);
END $$;
DO $$ BEGIN
  UPDATE public.patient_surgeries SET patient_id='bb000000-0000-4000-8000-00000000000e'
   WHERE id='dd000000-0000-4000-8000-000000000005';
  PERFORM pg_temp.t('ATTACK D2 repointing an EXISTING journey at the victim is REFUSED',
    (SELECT patient_id FROM public.patient_surgeries WHERE id='dd000000-0000-4000-8000-000000000005')
      <> 'bb000000-0000-4000-8000-00000000000e', 'update ran');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.t('ATTACK D2 repointing an EXISTING journey at the victim is REFUSED', true, SQLSTATE);
END $$;
SELECT pg_temp.t('ATTACK D  -> did any of it manufacture a treating relationship?',
  NOT public.doctor_treats_patient(:VIC),
  CASE WHEN public.doctor_treats_patient(:VIC) THEN 'YES — RELATIONSHIP MANUFACTURED' ELSE 'no' END);

SELECT pg_temp.god();
\echo ''
SELECT lpad(n::text,3)||'  '||CASE WHEN pass THEN 'ok   ' ELSE 'HOLE ' END||rpad(name,72)||coalesce(detail,'') AS "  result"
  FROM res ORDER BY n;
SELECT count(*) FILTER (WHERE pass)||' safe, '||count(*) FILTER (WHERE NOT pass)||' HOLES' AS "  total" FROM res;
ROLLBACK;
