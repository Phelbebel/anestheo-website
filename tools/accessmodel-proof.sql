-- ═══════════════════════════════════════════════════════════════════════════
-- accessmodel.sql — security proof for v9 + v9_1, run against the replica.
--
-- Six accounts, every claim measured rather than asserted. Everything runs
-- inside ONE transaction that is ROLLBACKed at the end, so the replica is
-- unchanged by running it.
--
-- The point of this suite is NOT to show that the new access works. It is to
-- show that widening access did not widen it anywhere it should not go: the
-- three trust gates, the directory, cross-doctor isolation, and the patient.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP off
\pset pager off
BEGIN;

-- NOTE: no `origin` column. v2_preparation_origin_migration.sql was never
-- applied to production, and a fixture that invents columns tests a database
-- that does not exist. This is what let the first v9_2 through review.

CREATE TABLE res(n serial, name text, pass boolean, detail text);
GRANT ALL ON res TO PUBLIC;
GRANT ALL ON SEQUENCE res_n_seq TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.be(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claim.sub', u::text, true); EXECUTE 'SET LOCAL ROLE authenticated'; END $$;
CREATE OR REPLACE FUNCTION pg_temp.god() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE OR REPLACE FUNCTION pg_temp.t(nm text, ok boolean, d text DEFAULT '') RETURNS void
LANGUAGE sql AS $$ INSERT INTO res(name,pass,detail) VALUES (nm, ok, d) $$;

-- ── the six accounts ──────────────────────────────────────────────────────
\set NEWDOC  '''a0000000-0000-4000-8000-00000000000d'''
\set VERDOC  '''b0000000-0000-4000-8000-00000000000d'''
\set DOCADM  '''c0000000-0000-4000-8000-00000000000d'''
\set PUREADM '''d0000000-0000-4000-8000-00000000000a'''
\set PATIENT '''e0000000-0000-4000-8000-00000000000e'''
\set OTHDOC  '''f0000000-0000-4000-8000-00000000000d'''
\set PAT2    '''e0000000-0000-4000-8000-00000000000f'''
-- A verified doctor with NO relationship of any kind to anybody in this
-- fixture. OTHDOC cannot serve as the isolation control, because OTHDOC is
-- deliberately given a treating relationship for test 8.5.
\set STRANGER '''0a000000-0000-4000-8000-00000000000d'''

INSERT INTO auth.users(id,email) VALUES
  (:NEWDOC ,'newdoc@t'), (:VERDOC ,'verdoc@t'), (:DOCADM ,'docadm@t'),
  (:PUREADM,'pureadm@t'), (:PATIENT,'patient@t'), (:OTHDOC ,'othdoc@t'),
  (:PAT2   ,'patient2@t'), (:STRANGER,'stranger@t')
ON CONFLICT (id) DO NOTHING;

UPDATE public.profiles SET role='doctor', is_admin=false, verification_status='pending',
  full_name='New Doctor', specialty='Anesthesiology', accepting_patients=true,
  account_status='active', deleted_at=NULL WHERE id=:NEWDOC;
UPDATE public.profiles SET role='doctor', is_admin=false, verification_status='approved',
  full_name='Verified Doctor', specialty='Anesthesiology', accepting_patients=true,
  account_status='active', deleted_at=NULL WHERE id=:VERDOC;
UPDATE public.profiles SET role='doctor', is_admin=true, verification_status='approved',
  full_name='Doctor Admin', specialty='Anesthesiology', accepting_patients=false,
  account_status='active', deleted_at=NULL WHERE id=:DOCADM;
UPDATE public.profiles SET role='admin', is_admin=true, verification_status='not_required',
  full_name='Pure Admin', accepting_patients=true, account_status='active', deleted_at=NULL WHERE id=:PUREADM;
UPDATE public.profiles SET role='patient', is_admin=false, verification_status='not_required',
  full_name='A Patient', accepting_patients=false, account_status='active', deleted_at=NULL WHERE id=:PATIENT;
UPDATE public.profiles SET role='doctor', is_admin=false, verification_status='approved',
  full_name='Unrelated Doctor', specialty='Anesthesiology', accepting_patients=false,
  account_status='active', deleted_at=NULL WHERE id=:OTHDOC;
UPDATE public.profiles SET role='patient', is_admin=false, verification_status='not_required',
  full_name='Second Patient', accepting_patients=false, account_status='active',
  deleted_at=NULL WHERE id=:PAT2;
UPDATE public.profiles SET role='doctor', is_admin=false, verification_status='approved',
  full_name='Stranger Doctor', specialty='Anesthesiology', accepting_patients=false,
  account_status='active', deleted_at=NULL WHERE id=:STRANGER;

/* Journeys: one per patient — uniq_active_journey_per_patient is a real
   constraint on this schema and a fixture that ignores it is testing a
   database that does not exist. Journey 1 is NEWDOC's, journey 2 is OTHDOC's,
   and they belong to different patients. */
INSERT INTO public.patient_surgeries(id, patient_id, assigned_doctor_id, patient_name, procedure_type, care_state)
VALUES ('a1000000-0000-4000-8000-000000000001', :PATIENT, :NEWDOC, 'A Patient','Knee','surgical'),
       ('a1000000-0000-4000-8000-000000000002', :PAT2,    :OTHDOC, 'Second Patient','Hip','surgical')
ON CONFLICT (id) DO NOTHING;

/* OTHDOC also treats PATIENT, through a clinic record rather than a journey.
   This is the CONTROL for test 2.1: it proves that what stops the unverified
   doctor reading the passport is verification, not the absence of a treating
   relationship — because here is a verified doctor with one, who can. */
INSERT INTO public.clinic_patients(id, doctor_id, auth_user_id, patient_name, procedure)
VALUES ('a7000000-0000-4000-8000-000000000001', :OTHDOC, :PATIENT, 'A Patient', 'Consult')
ON CONFLICT (id) DO NOTHING;

-- Health Passport owned by the patient. NEWDOC treats them (journey 1) but is
-- unverified; OTHDOC treats them (clinic record) and is verified.
INSERT INTO public.health_passports(id, patient_id, status, emergency_view_enabled)
VALUES ('a2000000-0000-4000-8000-000000000001', :PATIENT, 'active', true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.health_passport_items(id, passport_id, category, label, is_emergency_visible)
VALUES ('a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','allergy','Penicillin',true)
ON CONFLICT (id) DO NOTHING;

-- A public question, asked by the patient.
INSERT INTO public.questions(id, patient_id, subject, message, status)
VALUES ('a4000000-0000-4000-8000-000000000001', :PATIENT, 'Fasting', 'How long must I fast?', 'new')
ON CONFLICT (id) DO NOTHING;


-- ═══════════ 1. NEW UNVERIFIED DOCTOR — the ordinary product ══════════════
SELECT pg_temp.be(:NEWDOC);

SELECT pg_temp.t('1.1 unverified doctor is a doctor account, not a verified one',
  public.is_doctor_account() AND NOT public.is_verified_doctor());

SELECT pg_temp.t('1.2 sees their own assigned journey',
  (SELECT count(*) FROM public.patient_surgeries WHERE id='a1000000-0000-4000-8000-000000000001')=1);

SELECT pg_temp.t('1.3 does NOT see another doctor''s journey',
  (SELECT count(*) FROM public.patient_surgeries WHERE id='a1000000-0000-4000-8000-000000000002')=0);
SELECT pg_temp.t('1.3b ...and sees exactly one journey in total, their own',
  (SELECT count(*) FROM public.patient_surgeries)=1);

SELECT pg_temp.t('1.4 may manage their own patient record (archive/delete)',
  public.patient_record_manageable('journey','a1000000-0000-4000-8000-000000000001'));

SELECT pg_temp.t('1.5 may NOT manage another doctor''s record',
  NOT public.patient_record_manageable('journey','a1000000-0000-4000-8000-000000000002'));

SELECT pg_temp.t('1.6 the Recycle Bin answers instead of refusing',
  (SELECT count(*) FROM public.recycle_bin_list()) >= 0);

-- Live Chart: create, edit, finalize.
INSERT INTO public.anesthesia_cases(id, anesthesiologist_id, created_by, display_name, status, patient_user_id)
VALUES ('a5000000-0000-4000-8000-000000000001', :NEWDOC, :NEWDOC, 'Theatre Patient', 'draft', :PATIENT);
SELECT pg_temp.t('1.7 may OPEN an anesthesia case',
  (SELECT count(*) FROM public.anesthesia_cases WHERE id='a5000000-0000-4000-8000-000000000001')=1);
SELECT pg_temp.t('1.8 may CHART on it',
  public.anesthesia_case_editable('a5000000-0000-4000-8000-000000000001'));
INSERT INTO public.anesthesia_medications(id, case_id, entered_by, administered_at, medication, dose, unit, is_redose)
VALUES ('a6000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001', :NEWDOC,
        now(), 'Propofol', 150, 'mg', false);
SELECT pg_temp.t('1.9 a charted medication is written and readable',
  (SELECT count(*) FROM public.anesthesia_medications WHERE case_id='a5000000-0000-4000-8000-000000000001')=1);

-- ═══ 2. THE TRUST GATES — the unverified doctor must NOT pass these ═══════
SELECT pg_temp.t('2.1 cannot read the patient''s Health Passport',
  NOT public.hp_clinician_may_read('a2000000-0000-4000-8000-000000000001'));
SELECT pg_temp.t('2.2 ...and gets ZERO passport rows through RLS',
  (SELECT count(*) FROM public.health_passports WHERE id='a2000000-0000-4000-8000-000000000001')=0);
SELECT pg_temp.t('2.3 ...and zero passport ITEMS',
  (SELECT count(*) FROM public.health_passport_items WHERE passport_id='a2000000-0000-4000-8000-000000000001')=0);

DO $$ BEGIN
  PERFORM public.hp_verify_item('a3000000-0000-4000-8000-000000000001', true);
  PERFORM pg_temp.t('2.4 cannot mark a passport entry clinician-verified', false, 'the call SUCCEEDED');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.t('2.4 cannot mark a passport entry clinician-verified', SQLSTATE='42501', SQLSTATE||' '||SQLERRM);
END $$;

SELECT pg_temp.t('2.5 does NOT appear in the public clinician directory',
  NOT EXISTS (SELECT 1 FROM public.get_clinician_directory() d WHERE d.id=:NEWDOC));

SELECT pg_temp.t('2.6 cannot read the public Q&A inbox',
  (SELECT count(*) FROM public.questions WHERE id='a4000000-0000-4000-8000-000000000001')=0);

DO $$ BEGIN
  INSERT INTO public.question_replies(question_id, author_id, message)
  VALUES ('a4000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-00000000000d','Six hours.');
  PERFORM pg_temp.t('2.7 cannot answer a patient question as a clinician', false, 'the INSERT SUCCEEDED');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.t('2.7 cannot answer a patient question as a clinician', true, SQLSTATE);
END $$;

DO $$ BEGIN
  PERFORM public.anesthesia_set_trainee('a5000000-0000-4000-8000-000000000001',
                                        'a0000000-0000-4000-8000-00000000000d');
  PERFORM pg_temp.t('2.8 cannot name an UNVERIFIED account as a co-author', false, 'the call SUCCEEDED');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.t('2.8 cannot name an UNVERIFIED account as a co-author', SQLSTATE='42501', SQLSTATE);
END $$;

SELECT pg_temp.t('2.9 ...but MAY name a verified one',
  (public.anesthesia_set_trainee('a5000000-0000-4000-8000-000000000001',
                                 'b0000000-0000-4000-8000-00000000000d')->>'ok')='true');

-- ═══════════ 3. SIGNING-TIME PROVENANCE ══════════════════════════════════
SELECT pg_temp.t('3.1 an unverified doctor MAY finalize their own record',
  (public.anesthesia_finalize_case('a5000000-0000-4000-8000-000000000001')->>'ok')='true');

SELECT pg_temp.god();
SELECT pg_temp.t('3.2 the signature records the status at signing time',
  (SELECT finalized_by_verification_status FROM public.anesthesia_cases
    WHERE id='a5000000-0000-4000-8000-000000000001')='pending',
  (SELECT COALESCE(finalized_by_verification_status,'<null>') FROM public.anesthesia_cases
    WHERE id='a5000000-0000-4000-8000-000000000001'));

-- The author is later verified. The historical record must NOT move.
UPDATE public.profiles SET verification_status='approved' WHERE id=:NEWDOC;
SELECT pg_temp.t('3.3 later verification does NOT rewrite the historical record',
  (SELECT finalized_by_verification_status FROM public.anesthesia_cases
    WHERE id='a5000000-0000-4000-8000-000000000001')='pending',
  (SELECT COALESCE(finalized_by_verification_status,'<null>') FROM public.anesthesia_cases
    WHERE id='a5000000-0000-4000-8000-000000000001'));
UPDATE public.profiles SET verification_status='pending' WHERE id=:NEWDOC;

/* An UPDATE that matches ZERO rows under RLS is a SUCCESS, not an exception —
   Postgres reports UPDATE 0 and moves on. Asserting "it raised" would pass for
   the wrong reason on a policy that silently filters the row out, and fail on
   one that refuses loudly. The property that actually matters is that THE
   VALUE DID NOT CHANGE, so that is what is measured, read back as the owner. */
SELECT pg_temp.be(:NEWDOC);
UPDATE public.anesthesia_cases SET finalized_by_verification_status='approved'
 WHERE id='a5000000-0000-4000-8000-000000000001';
UPDATE public.anesthesia_cases SET display_name='Tampered'
 WHERE id='a5000000-0000-4000-8000-000000000001';
SELECT pg_temp.god();
SELECT pg_temp.t('3.4 the author cannot edit their own signing provenance',
  (SELECT finalized_by_verification_status FROM public.anesthesia_cases
    WHERE id='a5000000-0000-4000-8000-000000000001')='pending',
  (SELECT COALESCE(finalized_by_verification_status,'<null>') FROM public.anesthesia_cases
    WHERE id='a5000000-0000-4000-8000-000000000001'));
SELECT pg_temp.t('3.5 a finalized record is still immutable',
  (SELECT display_name FROM public.anesthesia_cases
    WHERE id='a5000000-0000-4000-8000-000000000001')='Theatre Patient',
  (SELECT display_name FROM public.anesthesia_cases
    WHERE id='a5000000-0000-4000-8000-000000000001'));
-- And the SECURITY DEFINER path can still write it — otherwise the column
-- would be immutable in the useless sense of never being writable at all.
SELECT pg_temp.t('3.6 ...while the finalize RPC itself did write it',
  (SELECT finalized_by_verification_status IS NOT NULL FROM public.anesthesia_cases
    WHERE id='a5000000-0000-4000-8000-000000000001'));

-- ═══════════ 4. VERIFIED DOCTOR — everything above, plus trust ═══════════
SELECT pg_temp.god(); SELECT pg_temp.be(:VERDOC);
SELECT pg_temp.t('4.1 verified doctor is both a doctor account and verified',
  public.is_doctor_account() AND public.is_verified_doctor());
SELECT pg_temp.t('4.2 appears in the public clinician directory',
  EXISTS (SELECT 1 FROM public.get_clinician_directory() d WHERE d.id=:VERDOC));
SELECT pg_temp.t('4.3 can read the public Q&A inbox',
  (SELECT count(*) FROM public.questions WHERE id='a4000000-0000-4000-8000-000000000001')=1);
SELECT pg_temp.t('4.4 but still cannot read a passport of a patient they do not treat',
  NOT public.hp_clinician_may_read('a2000000-0000-4000-8000-000000000001'));
SELECT pg_temp.t('4.5 and still sees no journey that is not theirs',
  (SELECT count(*) FROM public.patient_surgeries)=0);

-- ═══════════ 5. DOCTOR + PLATFORM ADMIN — both, not one ═════════════════
SELECT pg_temp.god(); SELECT pg_temp.be(:DOCADM);
SELECT pg_temp.t('5.1 is a doctor account AND a platform admin',
  public.is_doctor_account() AND public.is_platform_admin());
SELECT pg_temp.t('5.2 keeps full clinical authorship (may chart)',
  public.is_doctor_account());
SELECT pg_temp.t('5.3 keeps full admin reach over profiles',
  (SELECT count(*) FROM public.profiles) >= 6);
SELECT pg_temp.t('5.4 verification still governs their trust surface, not their role',
  public.is_verified_doctor());

-- ═══════════ 6. PURE PLATFORM ADMIN — no clinical authorship ════════════
SELECT pg_temp.god(); SELECT pg_temp.be(:PUREADM);
SELECT pg_temp.t('6.1 is a platform admin but NOT a doctor account',
  public.is_platform_admin() AND NOT public.is_doctor_account());
SELECT pg_temp.t('6.2 may READ any anesthesia case (audited admin reach)',
  public.anesthesia_case_access('a5000000-0000-4000-8000-000000000001'));
SELECT pg_temp.t('6.3 may NOT chart on it',
  NOT public.anesthesia_case_editable('a5000000-0000-4000-8000-000000000001'));
DO $$ BEGIN
  INSERT INTO public.anesthesia_cases(id, anesthesiologist_id, created_by, display_name, status)
  VALUES ('a5000000-0000-4000-8000-0000000000ff','d0000000-0000-4000-8000-00000000000a',
          'd0000000-0000-4000-8000-00000000000a','Admin Case','draft');
  PERFORM pg_temp.t('6.4 may NOT open a clinical record', false, 'the INSERT SUCCEEDED');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.t('6.4 may NOT open a clinical record', true, SQLSTATE);
END $$;
SELECT pg_temp.t('6.5 does NOT appear in the clinician directory despite accepting_patients',
  NOT EXISTS (SELECT 1 FROM public.get_clinician_directory() d WHERE d.id=:PUREADM));

-- ═══════════ 7. PATIENT — unchanged throughout ═══════════════════════════
SELECT pg_temp.god(); SELECT pg_temp.be(:PATIENT);
SELECT pg_temp.t('7.1 is neither doctor nor admin',
  NOT public.is_doctor_account() AND NOT public.is_platform_admin());
SELECT pg_temp.t('7.2 sees their own journey',
  (SELECT count(*) FROM public.patient_surgeries WHERE patient_id=:PATIENT)=1);
SELECT pg_temp.t('7.2b and no other patient''s',
  (SELECT count(*) FROM public.patient_surgeries WHERE patient_id<>:PATIENT)=0);
SELECT pg_temp.t('7.3 owns their Health Passport',
  (SELECT count(*) FROM public.health_passports WHERE patient_id=:PATIENT)=1);
SELECT pg_temp.t('7.4 sees their own question',
  (SELECT count(*) FROM public.questions WHERE id='a4000000-0000-4000-8000-000000000001')=1);
SELECT pg_temp.t('7.5 the Recycle Bin is empty for them, not an error',
  (SELECT count(*) FROM public.recycle_bin_list())=0);
SELECT pg_temp.t('7.6 cannot read an anesthesia case',
  NOT public.anesthesia_case_access('a5000000-0000-4000-8000-000000000001'));

-- ═══════════ 8. UNRELATED DOCTOR — isolation holds ══════════════════════
SELECT pg_temp.god(); SELECT pg_temp.be(:OTHDOC);
SELECT pg_temp.t('8.1 sees only their own journey',
  (SELECT count(*) FROM public.patient_surgeries)=1
  AND (SELECT count(*) FROM public.patient_surgeries WHERE assigned_doctor_id=:OTHDOC)=1);
SELECT pg_temp.t('8.1b sees no journey belonging to the other doctor''s patient',
  (SELECT count(*) FROM public.patient_surgeries WHERE id='a1000000-0000-4000-8000-000000000001')=0);
/* OTHDOC TREATS this patient (the clinic record above), so reading the
   anesthesia case is the DOCUMENTED DISCOVERY PATH in anesthesia_case_access:
   "a surgeon or the referring doctor may need to see the anesthesia record of a
   patient they treat". It grants READ only. This is pre-existing behaviour,
   unchanged by v9, and asserting isolation here would be asserting against the
   design. Real isolation is tested below, with a doctor who treats nobody. */
SELECT pg_temp.t('8.2 a treating doctor MAY read the case (documented discovery path)',
  public.anesthesia_case_access('a5000000-0000-4000-8000-000000000001'));
SELECT pg_temp.t('8.3 ...but may NOT chart on it — read and write are separate',
  NOT public.anesthesia_case_editable('a5000000-0000-4000-8000-000000000001'));
DO $$ BEGIN
  UPDATE public.anesthesia_medications SET medication='Tampered'
   WHERE case_id='a5000000-0000-4000-8000-000000000001';
  PERFORM pg_temp.t('8.4 ...and cannot alter another doctor''s charted drugs',
    (SELECT medication FROM public.anesthesia_medications
      WHERE id='a6000000-0000-4000-8000-000000000001')='Propofol');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.t('8.4 ...and cannot alter another doctor''s charted drugs', true, SQLSTATE);
END $$;

-- ═══════════ 8b. A DOCTOR WITH NO RELATIONSHIP AT ALL ═══════════════════
SELECT pg_temp.god(); SELECT pg_temp.be(:STRANGER);
SELECT pg_temp.t('8b.1 a verified doctor who treats nobody sees no journey',
  (SELECT count(*) FROM public.patient_surgeries)=0);
SELECT pg_temp.t('8b.2 ...cannot read the anesthesia case',
  NOT public.anesthesia_case_access('a5000000-0000-4000-8000-000000000001'));
SELECT pg_temp.t('8b.3 ...gets zero rows from its medications',
  (SELECT count(*) FROM public.anesthesia_medications WHERE case_id='a5000000-0000-4000-8000-000000000001')=0);
SELECT pg_temp.t('8b.4 ...cannot read the patient''s Health Passport despite being VERIFIED',
  NOT public.hp_clinician_may_read('a2000000-0000-4000-8000-000000000001'));
SELECT pg_temp.t('8b.5 ...and gets zero passport rows',
  (SELECT count(*) FROM public.health_passports)=0);
SELECT pg_temp.t('8b.6 ...cannot manage a record they do not own',
  NOT public.patient_record_manageable('journey','a1000000-0000-4000-8000-000000000001'));
/* Back to OTHDOC — the 8b block above switched the session to STRANGER, and
   this control is about the doctor who DOES treat the patient. OTHDOC is
   verified and holds a clinic record for them, so the passport is readable.
   This is the control for 2.1 and 8b.4: it isolates the variable. 2.1 has the
   relationship and lacks verification; 8b.4 has verification and lacks the
   relationship; both are refused. Here both are present, and it is allowed —
   which is what proves the two conditions are ANDed rather than one of them
   quietly carrying the other. */
SELECT pg_temp.god(); SELECT pg_temp.be(:OTHDOC);
SELECT pg_temp.t('8.5 CONTROL: verified AND treating -> the passport IS readable',
  public.hp_clinician_may_read('a2000000-0000-4000-8000-000000000001'));
SELECT pg_temp.t('8.6 ...and the passport row is actually returned by RLS',
  (SELECT count(*) FROM public.health_passports
    WHERE id='a2000000-0000-4000-8000-000000000001')=1);

-- ═══════════ 9. ONBOARDING — server-validated, atomic ═══════════════════
SELECT pg_temp.god();
INSERT INTO auth.users(id,email) VALUES ('09000000-0000-4000-8000-00000000000b','fresh@t')
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET role='pending', is_admin=false, verification_status='not_required',
  full_name=NULL WHERE id='09000000-0000-4000-8000-00000000000b';
SELECT pg_temp.be('09000000-0000-4000-8000-00000000000b');

-- set_own_role() now RAISES for 'doctor', so the assertion has to catch it
-- rather than evaluate it inline: a bare SELECT would abort the transaction
-- and every later test with it.
DO $$ BEGIN
  PERFORM public.set_own_role('doctor');
  PERFORM pg_temp.t('9.1 set_own_role(''doctor'') is refused (the old console hole)', false, 'IT SUCCEEDED');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.t('9.1 set_own_role(''doctor'') is refused (the old console hole)',
    SQLERRM LIKE '%submit_doctor_onboarding%', SQLERRM);
END $$;

SELECT pg_temp.t('9.2 incomplete onboarding is refused and names every missing field',
  (public.submit_doctor_onboarding('Dana','','Georgia','','','','','')->>'code')='missing_fields',
  (public.submit_doctor_onboarding('Dana','','Georgia','','','','','')->>'missing'));

SELECT pg_temp.t('9.3 ...and the account is still NOT a doctor',
  (SELECT role FROM public.profiles WHERE id='09000000-0000-4000-8000-00000000000b')='pending');

SELECT pg_temp.t('9.4 an invalid professional level is named, not swallowed',
  (public.submit_doctor_onboarding('Dana','professor','Georgia','+995','L1','H','U','Anesthesiology')->>'field')='professional_level');

SELECT pg_temp.t('9.5 complete onboarding succeeds',
  (public.submit_doctor_onboarding('Dana Levi','consultant','Georgia','+995555000111',
     'GE-4411','Central Hospital','Tbilisi State','Anesthesiology')->>'ok')='true');

SELECT pg_temp.t('9.6 ...and the account is a doctor with a COMPLETE file',
  (SELECT role='doctor' AND professional_level='consultant' AND medical_license_number='GE-4411'
          AND medical_university='Tbilisi State' AND specialty='Anesthesiology'
     FROM public.profiles WHERE id='09000000-0000-4000-8000-00000000000b'));

SELECT pg_temp.t('9.7 ...unverified, and therefore not in the directory',
  (SELECT verification_status FROM public.profiles WHERE id='09000000-0000-4000-8000-00000000000b')='pending'
  AND NOT EXISTS (SELECT 1 FROM public.get_clinician_directory() d
                   WHERE d.id='09000000-0000-4000-8000-00000000000b'));

SELECT pg_temp.t('9.8 ...but has ordinary doctor product access immediately',
  public.is_doctor_account());

DO $$ BEGIN
  PERFORM public.submit_doctor_onboarding('Hacker','consultant','X','1','L','H','U','Anesthesiology');
  PERFORM pg_temp.t('9.9 onboarding never grants admin',
    (SELECT COALESCE(is_admin,false)=false AND role='doctor'
       FROM public.profiles WHERE id='09000000-0000-4000-8000-00000000000b'));
END $$;

-- ═══════════ 10. THE APPROVAL-REVERTS BUG, AT THE DATABASE ═══════════════
-- The trigger is CORRECT and deliberately unchanged: a genuinely changed
-- professional identity must reset trust status. What must no longer happen is
-- the CLIENT sending nulls it never meant to send — proved in the browser
-- suite. Here we prove the rule itself still works, in both directions.
SELECT pg_temp.god();
UPDATE public.profiles SET verification_status='approved' WHERE id=:VERDOC;
SELECT pg_temp.be(:VERDOC);

UPDATE public.profiles SET phone='+995555999888', updated_at=now() WHERE id=:VERDOC;
SELECT pg_temp.t('10.1 editing a NON-identity field keeps verification',
  (SELECT verification_status FROM public.profiles WHERE id=:VERDOC)='approved',
  (SELECT verification_status FROM public.profiles WHERE id=:VERDOC));

UPDATE public.profiles SET medical_license_number='CHANGED-9', updated_at=now() WHERE id=:VERDOC;
SELECT pg_temp.t('10.2 changing the licence number DOES reset trust status',
  (SELECT verification_status FROM public.profiles WHERE id=:VERDOC)='pending',
  (SELECT verification_status FROM public.profiles WHERE id=:VERDOC));

SELECT pg_temp.t('10.3 ...and the now-unverified doctor KEEPS ordinary access',
  public.is_doctor_account() AND NOT public.is_verified_doctor());
SELECT pg_temp.t('10.4 ...but drops out of the public directory immediately',
  NOT EXISTS (SELECT 1 FROM public.get_clinician_directory() d WHERE d.id=:VERDOC));

-- ═══════════ RESULTS ═════════════════════════════════════════════════════
SELECT pg_temp.god();
\echo ''
\echo '───────────────────────────────────────────────────────────────'
SELECT lpad(n::text,3) || '  ' || CASE WHEN pass THEN 'ok   ' ELSE 'FAIL ' END
       || rpad(name, 66) || COALESCE(NULLIF(detail,''),'') AS "  result"
  FROM res ORDER BY n;
\echo '───────────────────────────────────────────────────────────────'
SELECT count(*) FILTER (WHERE pass) || ' passed, ' ||
       count(*) FILTER (WHERE NOT pass) || ' failed' AS "  total" FROM res;

ROLLBACK;
