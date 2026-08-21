-- ============================================================
-- tools/v9_production_security_matrix.sql
-- READ ONLY IN EFFECT. Wrapped in a transaction that always ROLLBACKs.
-- Run BEFORE applying v9_5 and v9_6, and again after, and compare.
-- ============================================================
--
-- WHY THIS IS A SCRIPT AND NOT A RESULT
-- -------------------------------------
-- The session that wrote this cannot reach the database. The Supabase MCP
-- server disconnected mid-session and the network policy blocks
-- *.supabase.co, so producing this matrix from here would mean inventing it.
-- The script is the honest deliverable: you run it, and the database answers.
--
-- WHY IMPERSONATION, AND WHY IT MATTERS
-- -------------------------------------
-- Querying as the SQL editor's role proves nothing about RLS. The editor runs
-- as a privileged role that policies do not apply to, so every SELECT would
-- come back "allowed" and the matrix would be a lie in five identical rows.
--
-- Each probe below therefore does two things first:
--
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
--
-- The first makes RLS apply. The second makes auth.uid() return that person.
-- Together they are as close to "signed in as this user" as SQL gets.
--
-- SECURITY DEFINER FUNCTIONS ARE THE EXCEPTION, AND THAT IS THE POINT.
-- get_clinician_directory, request_clinician and respond_care_request all run
-- as their owner and never consult RLS, so impersonation does not constrain
-- them. What constrains them is the check inside their own body, which is
-- exactly what v9_6 adds and exactly what rows 5-7 of this matrix measure.
--
-- NOTHING PERSISTS
-- ----------------
-- The write probes (request_clinician, respond_care_request) really do call
-- the functions, because a predicate reimplemented in a test is a test of the
-- reimplementation. They are safe because the whole script is one transaction
-- ending in ROLLBACK.
--
--     >>> RUN THE WHOLE FILE, INCLUDING THE FINAL ROLLBACK. <<<
--     >>> If you run it in pieces and stop after the SELECT, you will have <<<
--     >>> left an open transaction holding real rows.                     <<<
--
-- A guard at the top refuses to proceed outside a transaction block.
-- ============================================================

BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_stat_activity
                  WHERE pid = pg_backend_pid() AND xact_start IS NOT NULL) THEN
    RAISE EXCEPTION 'ABORT: not inside a transaction. Run the whole file.';
  END IF;
END
$guard$;

CREATE TEMP TABLE _matrix (
  ord      int,
  identity text,
  surface  text,
  verdict  text,
  reason   text
) ON COMMIT DROP;

-- ============================================================
-- 1. FIND ONE REAL ACCOUNT OF EACH SHAPE
-- ============================================================
-- Discovered, not hardcoded. If a shape does not exist in this database the
-- matrix says so rather than silently testing nobody. To pin a specific
-- account instead, replace the SELECT with a literal uuid.
CREATE TEMP TABLE _who (identity text, uid uuid, note text) ON COMMIT DROP;

INSERT INTO _who
SELECT 'pending doctor', id, email FROM public.profiles
 WHERE role = 'pending' AND COALESCE(is_admin,false) = false LIMIT 1;

INSERT INTO _who
SELECT 'unverified doctor', id, email FROM public.profiles
 WHERE role = 'doctor' AND COALESCE(is_admin,false) = false
   AND COALESCE(verification_status,'') <> 'approved' LIMIT 1;

INSERT INTO _who
SELECT 'approved doctor', id, email FROM public.profiles
 WHERE role = 'doctor' AND COALESCE(is_admin,false) = false
   AND verification_status = 'approved' LIMIT 1;

INSERT INTO _who
SELECT 'patient', id, email FROM public.profiles
 WHERE role = 'patient' AND COALESCE(is_admin,false) = false LIMIT 1;

INSERT INTO _who
SELECT 'admin', id, email FROM public.profiles
 WHERE COALESCE(is_admin,false) = true LIMIT 1;

-- ============================================================
-- 2. THE PROBES
-- ============================================================
DO $probe$
DECLARE
  w            record;
  v_n          bigint;
  v_ord        int;
  v_surgery    uuid;
  v_target     uuid;
  v_req        uuid;
  v_err        text;
  IDENTITIES   text[] := ARRAY['pending doctor','unverified doctor',
                               'approved doctor','patient','admin'];
  v_id         text;
BEGIN
  v_ord := 0;

  FOREACH v_id IN ARRAY IDENTITIES LOOP
    v_ord := v_ord + 10;
    SELECT * INTO w FROM _who WHERE identity = v_id;

    IF w.uid IS NULL THEN
      INSERT INTO _matrix VALUES (v_ord, v_id, '(all surfaces)', 'NOT TESTED',
        'no account of this shape exists in this database');
      CONTINUE;
    END IF;

    /* ── the four table reads, under real RLS ─────────────────────────── */
    BEGIN
      SET LOCAL ROLE authenticated;
      EXECUTE format('SET LOCAL request.jwt.claims = %L',
                     json_build_object('sub', w.uid, 'role','authenticated')::text);

      BEGIN EXECUTE 'SELECT count(*) FROM public.patient_surgeries' INTO v_n;
        INSERT INTO _matrix VALUES (v_ord+1, v_id, 'SELECT patient_surgeries',
          CASE WHEN v_n > 0 THEN 'ALLOWED' ELSE 'blocked (0 rows)' END,
          v_n || ' row(s) visible under RLS');
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO _matrix VALUES (v_ord+1, v_id, 'SELECT patient_surgeries', 'BLOCKED', SQLERRM);
      END;

      BEGIN EXECUTE 'SELECT count(*) FROM public.preop_questionnaires' INTO v_n;
        INSERT INTO _matrix VALUES (v_ord+2, v_id, 'SELECT preop_questionnaires',
          CASE WHEN v_n > 0 THEN 'ALLOWED' ELSE 'blocked (0 rows)' END,
          v_n || ' row(s) visible under RLS');
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO _matrix VALUES (v_ord+2, v_id, 'SELECT preop_questionnaires', 'BLOCKED', SQLERRM);
      END;

      BEGIN EXECUTE 'SELECT count(*) FROM public.care_requests' INTO v_n;
        INSERT INTO _matrix VALUES (v_ord+3, v_id, 'SELECT care_requests',
          CASE WHEN v_n > 0 THEN 'ALLOWED' ELSE 'blocked (0 rows)' END,
          v_n || ' row(s) visible under RLS');
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO _matrix VALUES (v_ord+3, v_id, 'SELECT care_requests', 'BLOCKED', SQLERRM);
      END;

      BEGIN EXECUTE 'SELECT count(*) FROM public.clinic_patients' INTO v_n;
        INSERT INTO _matrix VALUES (v_ord+4, v_id, 'SELECT clinic_patients',
          CASE WHEN v_n > 0 THEN 'ALLOWED' ELSE 'blocked (0 rows)' END,
          v_n || ' row(s) visible under RLS');
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO _matrix VALUES (v_ord+4, v_id, 'SELECT clinic_patients', 'BLOCKED', SQLERRM);
      END;

      /* ── get_clinician_directory(): SECURITY DEFINER, so RLS is not what
            decides. Recorded is whether THIS identity appears in it, which is
            the question that matters for the patient-facing listing. ─────── */
      BEGIN
        EXECUTE 'SELECT count(*) FROM public.get_clinician_directory() d WHERE d.id = $1'
          INTO v_n USING w.uid;
        INSERT INTO _matrix VALUES (v_ord+5, v_id, 'appears in get_clinician_directory()',
          CASE WHEN v_n > 0 THEN 'LISTED' ELSE 'not listed' END,
          CASE WHEN v_n > 0 THEN 'visible to patients as a selectable clinician'
               ELSE 'not offered to patients' END);
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO _matrix VALUES (v_ord+5, v_id, 'appears in get_clinician_directory()', 'ERROR', SQLERRM);
      END;

      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      INSERT INTO _matrix VALUES (v_ord+1, v_id, '(impersonation)', 'ERROR', SQLERRM);
    END;

    /* ── request_clinician(): can a PATIENT request THIS identity? ───────
          Run as a real patient, targeting this identity. Rolled back. */
    SELECT s.id INTO v_surgery
      FROM public.patient_surgeries s
      JOIN _who p ON p.identity = 'patient' AND p.uid = s.patient_id
     WHERE NOT EXISTS (SELECT 1 FROM public.care_requests c
                        WHERE c.surgery_id = s.id AND c.status IN ('requested','accepted'))
     LIMIT 1;

    IF v_surgery IS NULL THEN
      INSERT INTO _matrix VALUES (v_ord+6, v_id, 'request_clinician() -> this identity',
        'NOT TESTED', 'no unattached surgery belonging to the sampled patient');
    ELSE
      BEGIN
        SET LOCAL ROLE authenticated;
        EXECUTE format('SET LOCAL request.jwt.claims = %L',
                       json_build_object('sub', (SELECT uid FROM _who WHERE identity='patient'),
                                         'role','authenticated')::text);
        BEGIN
          EXECUTE 'SELECT public.request_clinician($1,$2,$3)'
            INTO v_req USING v_surgery, w.uid, 'security matrix probe';
          INSERT INTO _matrix VALUES (v_ord+6, v_id, 'request_clinician() -> this identity',
            'ALLOWED', 'a patient can send this account a care request');
        EXCEPTION WHEN OTHERS THEN
          v_err := SQLERRM;
          INSERT INTO _matrix VALUES (v_ord+6, v_id, 'request_clinician() -> this identity',
            'BLOCKED', SQLSTATE || ' ' || v_err);
        END;
        RESET ROLE;
      EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        INSERT INTO _matrix VALUES (v_ord+6, v_id, 'request_clinician() -> this identity', 'ERROR', SQLERRM);
      END;
    END IF;

    /* ── respond_care_request(): can THIS identity ACCEPT? ───────────────
          A request addressed to them is staged directly, so the probe tests
          the accept branch and not the ability to receive one. Rolled back. */
    IF v_surgery IS NULL THEN
      INSERT INTO _matrix VALUES (v_ord+7, v_id, 'respond_care_request(accept)',
        'NOT TESTED', 'no surgery available to stage a request against');
    ELSE
      BEGIN
        INSERT INTO public.care_requests
          (patient_id, doctor_id, surgery_id, origin_method, status, patient_name, doctor_name)
        VALUES ((SELECT uid FROM _who WHERE identity='patient'), w.uid, v_surgery,
                'directory', 'requested', 'probe', 'probe')
        RETURNING id INTO v_req;

        SET LOCAL ROLE authenticated;
        EXECUTE format('SET LOCAL request.jwt.claims = %L',
                       json_build_object('sub', w.uid, 'role','authenticated')::text);
        BEGIN
          EXECUTE 'SELECT public.respond_care_request($1,$2,$3)'
            USING v_req, 'accept', NULL;
          INSERT INTO _matrix VALUES (v_ord+7, v_id, 'respond_care_request(accept)',
            'ALLOWED', 'this account CAN become a treating doctor');
        EXCEPTION WHEN OTHERS THEN
          v_err := SQLERRM;
          INSERT INTO _matrix VALUES (v_ord+7, v_id, 'respond_care_request(accept)',
            'BLOCKED', SQLSTATE || ' ' || v_err);
        END;
        RESET ROLE;
      EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        INSERT INTO _matrix VALUES (v_ord+7, v_id, 'respond_care_request(accept)', 'ERROR', SQLERRM);
      END;
    END IF;

  END LOOP;
END
$probe$;

-- ============================================================
-- 3. THE MATRIX
-- ============================================================
SELECT identity, surface, verdict, reason
  FROM _matrix
 ORDER BY ord;

-- ============================================================
-- 4. NOTHING PERSISTS
-- ============================================================
ROLLBACK;

-- ============================================================
-- HOW TO READ IT
-- ============================================================
-- BEFORE v9_5 and v9_6, on the production state v9_4 measured, expect:
--
--   unverified doctor | SELECT patient_surgeries          | ALLOWED  <- the hole
--   unverified doctor | SELECT preop_questionnaires       | ALLOWED  <- the hole
--   unverified doctor | SELECT care_requests              | ALLOWED  <- the hole
--   unverified doctor | SELECT clinic_patients            | ALLOWED  <- the hole
--   unverified doctor | request_clinician() -> them       | ALLOWED  <- the hole
--   unverified doctor | respond_care_request(accept)      | ALLOWED  <- the hole
--   unverified doctor | appears in directory              | not listed  (already correct)
--
-- "ALLOWED" on a table read means rows came back, which for a doctor with no
-- patients of their own may still be 0. A 0 is reported as "blocked (0 rows)"
-- and is NOT proof of a policy: it may mean the account simply owns nothing.
-- The distinction that matters is 'BLOCKED' with an error, which is a policy
-- refusing, versus 'ALLOWED' with rows, which is data crossing the boundary.
-- To make that unambiguous, sample an unverified doctor who owns something,
-- or read the gate inventory in v9_4 alongside this.
--
-- AFTER v9_5 and v9_6, every one of those seven rows should read BLOCKED or
-- "blocked (0 rows)" for the unverified doctor, and the approved doctor's rows
-- should be unchanged from before.
