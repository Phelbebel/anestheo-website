-- ============================================================================
-- Anestheo — doctor verification: documents, requests, and the approval gate
--
-- PREPARED, NOT APPLIED. Run in the Supabase SQL editor; storage policies need
-- the editor's role. Idempotent. Pure ASCII.
--
-- NO DUPLICATE DOCUMENT SYSTEM. public.doctor_verification_documents already
-- exists (v2_admin_phase3.sql) with a storage_path column and RLS narrowed by
-- v2_auth_onboarding.sql. It remains the single evidence table and its
-- policies are NOT weakened here. What is added is the bucket those paths were
-- always meant to point at, a small workflow table recording what an admin
-- asked for, and the two rules that make the loop close.
--
-- WHY THE ONBOARDING ORDER IS role-FIRST. dvd_insert_own requires
-- is_doctor_account() AND is_pending_doctor(), so a document cannot be
-- inserted before set_own_role('doctor') has run. The application therefore
-- goes: professional form -> set_own_role('doctor') -> verification_status
-- 'pending' -> upload -> insert metadata -> submit. The RLS is not relaxed to
-- allow the reverse; the sequence is corrected to match it.
-- ============================================================================

DO $pre$
BEGIN
  IF to_regclass('public.doctor_verification_documents') IS NULL THEN
    RAISE EXCEPTION 'ABORT: doctor_verification_documents is missing. Apply v2_admin_phase3.sql first.';
  END IF;
  IF to_regproc('public.is_pending_doctor') IS NULL OR to_regproc('public.is_doctor_account') IS NULL THEN
    RAISE EXCEPTION 'ABORT: is_pending_doctor()/is_doctor_account() are missing. Apply v2_auth_onboarding.sql first.';
  END IF;
  IF to_regproc('public.is_platform_admin') IS NULL OR to_regproc('public.assert_admin') IS NULL THEN
    RAISE EXCEPTION 'ABORT: admin predicates are missing. Apply v2_admin_phase0.sql first.';
  END IF;
END $pre$;

-- ============================================================
-- 1. DOCUMENT TYPES — add specialist_certificate
-- ============================================================
-- The CHECK and admin_request_documents()'s validation list must agree or the
-- RPC refuses a type the table would accept. Both are changed, in this file.
ALTER TABLE public.doctor_verification_documents DROP CONSTRAINT IF EXISTS dvd_doc_type_chk;
ALTER TABLE public.doctor_verification_documents ADD CONSTRAINT dvd_doc_type_chk
  CHECK (doc_type IN ('passport_id','license','diploma','specialist_certificate','other'));

-- ============================================================
-- 2. PRIVATE BUCKET
-- ============================================================
-- Separate from patient-documents and from avatars. A passport scan and a
-- profile picture have nothing in common but the word "upload", and one bucket
-- for both means one policy mistake exposes both.
-- 10 MB. PDF and the image formats a phone camera actually produces.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('doctor-verification', 'doctor-verification', false, 10485760,
        ARRAY['application/pdf','image/jpeg','image/jpg','image/png','image/heic','image/heif'])
ON CONFLICT (id) DO UPDATE
  SET file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types,
      public             = false;

-- Path convention: <doctor_uid>/<doc_type>/<epoch>_<safe-name>
-- The first folder segment IS the authorization.
DROP POLICY IF EXISTS dv_obj_insert ON storage.objects;
CREATE POLICY dv_obj_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'doctor-verification'
              AND (storage.foldername(name))[1] = auth.uid()::text
              AND public.is_doctor_account());

-- The owner reads their own; a platform admin reads any, which is what makes
-- review possible. Nobody else sees anything: an unrelated doctor and every
-- patient match neither branch.
DROP POLICY IF EXISTS dv_obj_select ON storage.objects;
CREATE POLICY dv_obj_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'doctor-verification'
         AND ( (storage.foldername(name))[1] = auth.uid()::text
               OR public.is_platform_admin() ));

-- A doctor may withdraw a file they uploaded, but NOT one that has been
-- reviewed. Evidence behind an approval must survive, and the row-level rule
-- (dvd_delete_own requires reviewed_at IS NULL) would otherwise be bypassed by
-- deleting the object and leaving the row pointing at nothing.
DROP POLICY IF EXISTS dv_obj_delete ON storage.objects;
CREATE POLICY dv_obj_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'doctor-verification'
         AND (storage.foldername(name))[1] = auth.uid()::text
         AND NOT EXISTS (SELECT 1 FROM public.doctor_verification_documents d
                          WHERE d.storage_path = storage.objects.name
                            AND d.reviewed_at IS NOT NULL));

-- No UPDATE policy: an object is never overwritten in place. A replacement is
-- a new path, so the audit trail keeps both.

-- ============================================================
-- 2b. A DOCUMENT ARRIVES UNREVIEWED. ALWAYS.
-- ============================================================
-- dvd_insert_own constrains WHICH rows a doctor may insert, not what is IN
-- them, so nothing stopped a doctor inserting their own document already
-- carrying review_state='accepted' and a reviewed_at timestamp. That grants no
-- privilege — the approval gate counts documents, not verdicts — but it puts a
-- verdict nobody reached in front of the administrator who is about to decide,
-- and it is the review semantics this migration introduces that make it worth
-- anything. An evidence table whose verdict column the subject can write is not
-- evidence.
--
-- Same shape as guard_profiles_self_update(): the PostgREST roles are forced,
-- the owner and service_role are untouched, so admin_set_verification() (which
-- UPDATEs as the owner) is unaffected.
CREATE OR REPLACE FUNCTION public.dvd_force_unreviewed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER                       -- must see the REAL caller
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('authenticated','anon') THEN RETURN NEW; END IF;
  NEW.review_state := 'pending';
  NEW.reviewed_at  := NULL;
  NEW.reviewed_by  := NULL;
  NEW.deleted_at   := NULL;
  NEW.deleted_by   := NULL;
  NEW.uploaded_by  := auth.uid();      -- not the caller's to claim either
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.dvd_force_unreviewed() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_dvd_force_unreviewed ON public.doctor_verification_documents;
CREATE TRIGGER trg_dvd_force_unreviewed
  BEFORE INSERT ON public.doctor_verification_documents
  FOR EACH ROW EXECUTE FUNCTION public.dvd_force_unreviewed();

-- ============================================================
-- 2c. RE-ASSERT THE INTENDED TABLE GRANTS
-- ============================================================
-- v2_admin_phase3.sql already says exactly this, but the replica shows
-- anon=arwdDxt on this table: Supabase's default privileges for schema public
-- grant ALL to anon and authenticated, and a later migration re-applying them
-- silently undid the REVOKE. RLS has been holding the line alone (anon reads
-- zero rows, proven), but a table privilege nobody intends should not be left
-- standing on the strength of one policy.
--
-- Idempotent and narrowing only: authenticated keeps SELECT/INSERT/DELETE,
-- which is everything its policies allow it to use. It never had a usable
-- UPDATE — there is no UPDATE policy — so removing that grant changes nothing
-- it could actually do.
REVOKE ALL ON TABLE public.doctor_verification_documents FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON TABLE public.doctor_verification_documents TO authenticated;

-- ============================================================
-- 3. WORKFLOW TABLE — what an admin asked for, and whether it arrived
-- ============================================================
-- NOT a second document system. It holds no file, no path and no evidence:
-- only the request. doctor_verification_documents remains the single place a
-- document exists.
--
-- It exists because the doctor could not previously discover what was wanted.
-- admin_request_documents() recorded the request in verification_notes, whose
-- only policy is admin-read, and in admin_audit_log, which is admin-only too —
-- so the app could not tell the doctor anything and the page fell back to
-- "check your email". Internal notes stay internal; this table is the part the
-- doctor is meant to see.
CREATE TABLE IF NOT EXISTS public.doctor_verification_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_types text[] NOT NULL,
  reason          text NOT NULL,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  fulfilled_at    timestamptz,
  status          text NOT NULL DEFAULT 'open'
);
DO $c$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='dvr_status_chk') THEN
    ALTER TABLE public.doctor_verification_requests ADD CONSTRAINT dvr_status_chk
      CHECK (status IN ('open','fulfilled','cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='dvr_types_chk') THEN
    ALTER TABLE public.doctor_verification_requests ADD CONSTRAINT dvr_types_chk
      CHECK (array_length(requested_types, 1) BETWEEN 1 AND 5);
  END IF;
END $c$;
CREATE INDEX IF NOT EXISTS idx_dvr_doctor ON public.doctor_verification_requests(doctor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dvr_open   ON public.doctor_verification_requests(doctor_id) WHERE status = 'open';

ALTER TABLE public.doctor_verification_requests ENABLE ROW LEVEL SECURITY;

-- The doctor reads their own; an admin reads any.
DROP POLICY IF EXISTS dvr_select ON public.doctor_verification_requests;
CREATE POLICY dvr_select ON public.doctor_verification_requests
  FOR SELECT TO authenticated
  USING ( (doctor_id = auth.uid() AND public.is_doctor_account())
          OR public.is_platform_admin() );

-- Deliberately NO insert, update or delete policy for anyone. A request is
-- created by admin_request_documents() and closed by
-- doctor_submit_verification(), both SECURITY DEFINER and both audited. A
-- doctor cannot invent a request, cancel one, or mark their own fulfilled.
REVOKE ALL ON TABLE public.doctor_verification_requests FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.doctor_verification_requests TO authenticated;

-- ============================================================
-- 4. WHAT COUNTS AS A COMPLETE APPLICATION
-- ============================================================
-- One definition, used by the approval gate, by the submit RPC and by the
-- pages. Required: government ID and medical licence, each present as at least
-- one live row. "Live" means not soft-deleted; a reviewed document stays live
-- forever because it can no longer be removed.
CREATE OR REPLACE FUNCTION public.doctor_missing_documents(p_doctor uuid)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
  SELECT COALESCE(array_agg(t ORDER BY t), '{}')
    FROM unnest(ARRAY['passport_id','license']) AS t
   WHERE NOT EXISTS (
     SELECT 1 FROM public.doctor_verification_documents d
      WHERE d.doctor_id = p_doctor AND d.doc_type = t AND d.deleted_at IS NULL);
$$;
REVOKE ALL ON FUNCTION public.doctor_missing_documents(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.doctor_missing_documents(uuid) TO authenticated;
-- Reading it about somebody else reveals only whether two document TYPES are
-- on file. The documents themselves stay behind dvd_select.

-- ============================================================
-- 5. THE DOCTOR SUBMITS / RESUBMITS
-- ============================================================
-- Needed because neither half can be done from the client: verification_status
-- is not in guard_profiles_self_update()'s allowlist, and the requests table
-- has no write policy at all. Both are deliberate, so the only way to close
-- the loop is one audited function that operates on auth.uid() and takes no
-- target parameter — it cannot be aimed at another account.
CREATE OR REPLACE FUNCTION public.doctor_submit_verification()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_uid uuid := auth.uid(); v_role text; v_status text; v_missing text[]; v_closed int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  SELECT role, verification_status INTO v_role, v_status FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'No profile row for this account' USING ERRCODE = 'P0002'; END IF;
  IF COALESCE(v_role,'') <> 'doctor' THEN
    RAISE EXCEPTION 'Only a doctor account submits verification' USING ERRCODE = '42501';
  END IF;
  -- An approved doctor has nothing to submit; re-entering the queue is an
  -- administrator's decision, not a self-service one.
  IF COALESCE(v_status,'') = 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_approved',
      'reason', 'Your account is already verified.');
  END IF;

  v_missing := public.doctor_missing_documents(v_uid);
  IF array_length(v_missing, 1) IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'documents_missing',
      'missing', to_jsonb(v_missing),
      'reason', 'Upload every required document before submitting.');
  END IF;

  UPDATE public.doctor_verification_requests
     SET status = 'fulfilled', fulfilled_at = now()
   WHERE doctor_id = v_uid AND status = 'open';
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  UPDATE public.profiles
     SET verification_status = 'pending', updated_at = now()
   WHERE id = v_uid;

  /* Written straight into the audit table rather than through admin_log(),
     which begins with assert_admin() because it exists for administrator
     actions. This is a doctor acting on their own account, so that assertion
     would refuse it — and the event still belongs in the trail: it is what an
     administrator sees when asking why an account re-entered the queue.
     actor_role records who it actually was, so a submission can never be
     mistaken for an admin decision. */
  INSERT INTO public.admin_audit_log(actor_id, actor_role, action, target_type, target_id,
                                     target_label, before_state, after_state)
  VALUES (v_uid, 'doctor', 'doctor.submit_verification', 'profile', v_uid,
          (SELECT COALESCE(full_name, email) FROM public.profiles WHERE id = v_uid),
          jsonb_build_object('verification_status', v_status),
          jsonb_build_object('verification_status', 'pending', 'requests_fulfilled', v_closed));

  RETURN jsonb_build_object('ok', true, 'verification_status', 'pending',
                            'requests_fulfilled', v_closed);
END $$;
REVOKE ALL ON FUNCTION public.doctor_submit_verification() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.doctor_submit_verification() TO authenticated;

-- ============================================================
-- 6. admin_request_documents() — now also tells the doctor
-- ============================================================
-- Same signature, same audit, same verification_notes entry. Two changes:
-- specialist_certificate is accepted, and the request is recorded where the
-- doctor can read it.
CREATE OR REPLACE FUNCTION public.admin_request_documents(p_doctor uuid, p_types text[], p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_t text; v_bad text[] := '{}'; v_id uuid;
BEGIN
  PERFORM public.admin_assert_target(p_doctor);
  IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A reason is required when requesting documents' USING ERRCODE = '22023';
  END IF;
  IF p_types IS NULL OR array_length(p_types,1) IS NULL THEN
    RAISE EXCEPTION 'Select at least one document type' USING ERRCODE = '22023';
  END IF;
  FOREACH v_t IN ARRAY p_types LOOP
    IF v_t NOT IN ('passport_id','license','diploma','specialist_certificate','other')
      THEN v_bad := v_bad || v_t; END IF;
  END LOOP;
  IF array_length(v_bad,1) IS NOT NULL THEN
    RAISE EXCEPTION 'Unknown document type(s): %', array_to_string(v_bad,', ') USING ERRCODE = '22023';
  END IF;

  -- Supersede any request still outstanding, so the doctor is never shown two
  -- competing lists of what is wanted.
  UPDATE public.doctor_verification_requests
     SET status = 'cancelled', fulfilled_at = now()
   WHERE doctor_id = p_doctor AND status = 'open';

  INSERT INTO public.doctor_verification_requests(doctor_id, requested_types, reason, created_by)
  VALUES (p_doctor, p_types, btrim(p_reason), auth.uid())
  RETURNING id INTO v_id;

  UPDATE public.profiles SET verification_status = 'changes_requested', updated_at = now()
   WHERE id = p_doctor;
  INSERT INTO public.verification_notes(doctor_id, author_id, note)
  VALUES (p_doctor, auth.uid(), 'Requested: ' || array_to_string(p_types, ', ') || ' — ' || p_reason);

  PERFORM public.admin_log('doctor.request_documents','profile', p_doctor,
    (SELECT COALESCE(full_name,email) FROM public.profiles WHERE id = p_doctor),
    NULL, jsonb_build_object('requested', to_jsonb(p_types), 'request_id', v_id), p_reason);
  RETURN jsonb_build_object('ok', true, 'requested', to_jsonb(p_types), 'request_id', v_id);
END;
$$;

-- ============================================================
-- 7. admin_set_verification() — the approval gate and the review rule
-- ============================================================
-- TWO CHANGES, both about approval only. Every other state behaves exactly as
-- before.
--
-- (a) APPROVAL REQUIRES THE REQUIRED DOCUMENTS. Enforced here rather than in
--     the Admin Center, because a page cannot be trusted with it. An admin who
--     tries gets a refusal naming what is missing.
--
-- (b) APPROVAL REVIEWS THE EVIDENCE. Approving a doctor IS accepting the
--     documents that justified it, so live unreviewed documents become
--     'accepted' with reviewed_at and reviewed_by set to the deciding
--     administrator. Without this every document stayed 'pending' forever and
--     review_state meant nothing.
--
--     This is also what protects the evidence: dvd_delete_own requires
--     reviewed_at IS NULL, so once approved the doctor can no longer withdraw
--     the documents behind their badge, and neither can the storage policy in
--     section 2 be used to remove the files.
--
--     There is still NO UPDATE policy on the evidence table. This function is
--     SECURITY DEFINER and runs as the owner, so the audited RPC is the only
--     thing in the system that can move a review_state at all.
--
-- Rejection deliberately does NOT mark documents rejected: no one judged them
-- individually, and V1 has no per-document review. Recording a verdict nobody
-- reached would be worse than leaving them pending.
CREATE OR REPLACE FUNCTION public.admin_set_verification(p_target uuid, p_state text, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_before text; v_role text; v_missing text[]; v_docs int := 0;
BEGIN
  PERFORM public.admin_assert_target(p_target);
  IF p_state NOT IN ('approved','pending','rejected','changes_requested','verification_suspended') THEN
    RAISE EXCEPTION 'Verification state "%" is not allowed', p_state USING ERRCODE = '22023';
  END IF;
  SELECT verification_status, role INTO v_before, v_role FROM public.profiles WHERE id = p_target;
  IF COALESCE(v_role,'') <> 'doctor' THEN
    RAISE EXCEPTION 'Verification applies to doctor accounts only' USING ERRCODE = '22023';
  END IF;
  IF p_state <> 'approved' AND NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for this verification decision' USING ERRCODE = '22023';
  END IF;

  IF p_state = 'approved' THEN
    v_missing := public.doctor_missing_documents(p_target);
    IF array_length(v_missing, 1) IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot approve: missing %', array_to_string(v_missing, ', ')
        USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.profiles SET verification_status = p_state, updated_at = now() WHERE id = p_target;

  IF p_state = 'approved' THEN
    UPDATE public.doctor_verification_documents
       SET review_state = 'accepted', reviewed_at = now(), reviewed_by = auth.uid()
     WHERE doctor_id = p_target AND deleted_at IS NULL AND reviewed_at IS NULL;
    GET DIAGNOSTICS v_docs = ROW_COUNT;
    -- An approval settles anything still outstanding.
    UPDATE public.doctor_verification_requests
       SET status = 'fulfilled', fulfilled_at = now()
     WHERE doctor_id = p_target AND status = 'open';
  END IF;

  PERFORM public.admin_log(
    CASE p_state WHEN 'approved' THEN 'doctor.verify'
                 WHEN 'pending'  THEN 'doctor.unverify'
                 WHEN 'rejected' THEN 'doctor.reject'
                 WHEN 'changes_requested' THEN 'doctor.request_changes'
                 ELSE 'doctor.suspend_verification' END,
    'profile', p_target,
    (SELECT COALESCE(full_name, email) FROM public.profiles WHERE id = p_target),
    jsonb_build_object('verification_status', v_before),
    jsonb_build_object('verification_status', p_state, 'documents_accepted', v_docs), p_reason);
  RETURN jsonb_build_object('ok', true, 'verification_status', p_state, 'documents_accepted', v_docs);
END;
$$;

-- ============================================================
-- 8. GRANTS — plain statements, one per function
-- ============================================================
-- Not a DO loop. A loop is one statement: if any iteration raises, the whole
-- block rolls back and none of the grants land, which is exactly how the
-- phase2/phase3 admin grants went missing in production.
GRANT EXECUTE ON FUNCTION public.admin_request_documents(uuid, text[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_verification(uuid, text, text)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.doctor_submit_verification()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.doctor_missing_documents(uuid)              TO authenticated;

-- ============================================================
-- 9. VERIFY
-- ============================================================
DO $v$
DECLARE v_bucket boolean; v_pol int; v_tbl boolean; v_types boolean; v_fn int;
BEGIN
  SELECT EXISTS (SELECT 1 FROM storage.buckets
                  WHERE id='doctor-verification' AND public=false
                    AND file_size_limit=10485760) INTO v_bucket;
  SELECT count(*) INTO v_pol FROM pg_policy
   WHERE polname IN ('dv_obj_insert','dv_obj_select','dv_obj_delete');
  SELECT to_regclass('public.doctor_verification_requests') IS NOT NULL INTO v_tbl;
  SELECT pg_get_constraintdef(oid) LIKE '%specialist_certificate%' INTO v_types
    FROM pg_constraint WHERE conname='dvd_doc_type_chk';
  SELECT count(*) INTO v_fn FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('doctor_submit_verification','doctor_missing_documents');

  RAISE NOTICE 'V1 private 10MB bucket            : %', v_bucket;
  RAISE NOTICE 'V2 object policies (expect 3)     : %', v_pol;
  RAISE NOTICE 'V3 doctor_verification_requests   : %', v_tbl;
  RAISE NOTICE 'V4 specialist_certificate allowed : %', v_types;
  RAISE NOTICE 'V5 new functions (expect 2)       : %', v_fn;
  RAISE NOTICE 'V6 insert guard trigger           : %',
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_dvd_force_unreviewed');
  RAISE NOTICE 'V7 anon has no table privilege    : %',
    NOT has_table_privilege('anon','public.doctor_verification_documents','SELECT');
  IF NOT (v_bucket AND v_pol = 3 AND v_tbl AND v_types AND v_fn = 2
          AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_dvd_force_unreviewed')
          AND NOT has_table_privilege('anon','public.doctor_verification_documents','SELECT')) THEN
    RAISE EXCEPTION 'doctor verification migration did not complete';
  END IF;
  RAISE NOTICE 'doctor verification: ready.';
END $v$;
