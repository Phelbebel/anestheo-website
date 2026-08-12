-- ============================================================
-- ANESTHEO — PATIENT / JOURNEY LIFECYCLE FOUNDATION (Task 1)
--
-- Backend only. No UI depends on this yet; the three-dot menus, the canonical
-- open mechanism and the Recycle Bin screen consume it later.
--
-- ── WHAT ALREADY EXISTS (inventoried, not guessed) ──────────────────────────
--   patient_surgeries   archived_at/by/reason, deleted_at/by/reason,
--                       restored_at/by      <- the full lifecycle vocabulary
--   care_requests       archived_at/by, deleted_at/by/reason
--   preop_questionnaires, preop_checklist, questions, profiles,
--   doctor_verification_documents, moderation_reports
--                       deleted_at/by/reason
--   clinic_patients     NOTHING              <- the hole
--
-- ── ROOT CAUSE OF "Could not check eligibility right now" ───────────────────
-- Anestheo has TWO representations of a doctor-managed patient:
--   patient_surgeries  a journey belonging to an Anestheo account
--   clinic_patients    a patient the doctor typed in, often with no account
-- Only the first has lifecycle columns, and patient_archive_eligibility()
-- takes p_surgery_id and RAISES 'Patient record not found' for anything else:
--     SELECT patient_archive_eligibility('<a clinic_patients id>')
--       -> ERROR: Patient record not found
-- dashboard.html wraps the call in a catch-all that turns EVERY exception into
-- one sentence, so a clinic-patient card, a null id and a genuine
-- authorization failure all produce the same misleading message.
--
-- Fixed on both sides here: the API takes (kind, id) and always returns a
-- structured result. Exceptions are reserved for programming errors.
--
-- ── THREE DIMENSIONS, NEVER ONE COLUMN ──────────────────────────────────────
--   WORKFLOW      care_state / patient_status / questionnaire_status … UNTOUCHED
--   ORGANIZATION  is_starred                                          NEW
--   LIFECYCLE     active | archived | soft_deleted                    derived
--                 from archived_at / deleted_at, which already exist
--
-- Lifecycle is DERIVED from timestamps rather than stored as a state string:
-- a stored state and the timestamps that justify it are two sources of truth
-- that will eventually disagree.
--
-- SAFETY: additive, idempotent, transaction-wrapped. No column is dropped, no
-- row is deleted, no existing RPC is removed. DO NOT RUN AGAINST PRODUCTION.
-- ============================================================

BEGIN;

DO $preflight$
DECLARE v_missing text[] := '{}';
BEGIN
  IF to_regproc('public.is_platform_admin')     IS NULL THEN v_missing := v_missing || 'is_platform_admin() [v2_admin_phase0]'::text; END IF;
  IF to_regproc('public.is_verified_doctor')    IS NULL THEN v_missing := v_missing || 'is_verified_doctor() [v2_auth_onboarding]'::text; END IF;
  IF to_regproc('public.is_pending_doctor')     IS NULL THEN v_missing := v_missing || 'is_pending_doctor() [v2_auth_onboarding]'::text; END IF;
  IF to_regproc('public.account_is_active')     IS NULL THEN v_missing := v_missing || 'account_is_active() [v2_admin_phase2]'::text; END IF;
  IF to_regclass('public.patient_surgeries')    IS NULL THEN v_missing := v_missing || 'patient_surgeries'::text; END IF;
  IF to_regclass('public.clinic_patients')      IS NULL THEN v_missing := v_missing || 'clinic_patients'::text; END IF;
  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: prerequisites missing: %', array_to_string(v_missing, ', ');
  END IF;
  RAISE NOTICE 'Preflight OK.';
END
$preflight$;

-- ============================================================
-- 1. ORGANIZATION — is_starred
-- ============================================================
-- Separate from workflow and lifecycle by construction: a patient can be
-- awaiting_review AND starred AND archived, and none of those three facts
-- constrains the others.
ALTER TABLE public.patient_surgeries ADD COLUMN IF NOT EXISTS is_starred boolean NOT NULL DEFAULT false;
ALTER TABLE public.clinic_patients   ADD COLUMN IF NOT EXISTS is_starred boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.patient_surgeries.is_starred IS
  'Organizational flag only. Never affects workflow (care_state) or lifecycle (archived_at/deleted_at).';
COMMENT ON COLUMN public.clinic_patients.is_starred IS
  'Organizational flag only. Never affects workflow or lifecycle.';

-- ============================================================
-- 2. CLOSE THE HOLE — clinic_patients gains the same lifecycle vocabulary
-- ============================================================
-- Not a second deletion system: the SAME column names, so one predicate and
-- one API serve both representations. Without this, "archive a patient" means
-- two different things depending on which list the card came from, which is
-- precisely the bug.
ALTER TABLE public.clinic_patients ADD COLUMN IF NOT EXISTS archived_at    timestamptz;
ALTER TABLE public.clinic_patients ADD COLUMN IF NOT EXISTS archived_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.clinic_patients ADD COLUMN IF NOT EXISTS archive_reason text;
ALTER TABLE public.clinic_patients ADD COLUMN IF NOT EXISTS deleted_at     timestamptz;
ALTER TABLE public.clinic_patients ADD COLUMN IF NOT EXISTS deleted_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.clinic_patients ADD COLUMN IF NOT EXISTS delete_reason  text;
ALTER TABLE public.clinic_patients ADD COLUMN IF NOT EXISTS restored_at    timestamptz;
ALTER TABLE public.clinic_patients ADD COLUMN IF NOT EXISTS restored_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cp_lifecycle ON public.clinic_patients(doctor_id, deleted_at, archived_at);
CREATE INDEX IF NOT EXISTS idx_ps_lifecycle ON public.patient_surgeries(assigned_doctor_id, deleted_at, archived_at);

-- ============================================================
-- 3. THE ONE LIFECYCLE PREDICATE
-- ============================================================
-- Every page asks the same question through the same function, so "what counts
-- as active" cannot drift between ten screens.
CREATE OR REPLACE FUNCTION public.lifecycle_state(p_archived_at timestamptz, p_deleted_at timestamptz)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
           WHEN p_deleted_at  IS NOT NULL THEN 'soft_deleted'
           WHEN p_archived_at IS NOT NULL THEN 'archived'
           ELSE 'active'
         END;
$$;

-- ── Parent-aware visibility ────────────────────────────────────────────────
-- The rule the brief asks for, in one place. A child is visible in ordinary
-- clinical views when it is not itself deleted AND no parent above it is
-- deleted. Children are never cascade-updated, so restoring a parent restores
-- the view of every child that was not independently deleted, and a child that
-- WAS independently deleted stays hidden — its own deleted_at is untouched.
CREATE OR REPLACE FUNCTION public.journey_visible(p_surgery_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_surgery_id IS NULL THEN true ELSE EXISTS (
    SELECT 1 FROM public.patient_surgeries s
     WHERE s.id = p_surgery_id
       AND s.deleted_at IS NULL
       -- The journey's own parent, when it came from a clinic record.
       AND (s.clinic_patient_id IS NULL OR EXISTS (
             SELECT 1 FROM public.clinic_patients cp
              WHERE cp.id = s.clinic_patient_id AND cp.deleted_at IS NULL))
  ) END;
$$;

CREATE OR REPLACE FUNCTION public.clinic_patient_visible(p_clinic_patient_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_clinic_patient_id IS NULL THEN true ELSE EXISTS (
    SELECT 1 FROM public.clinic_patients cp
     WHERE cp.id = p_clinic_patient_id AND cp.deleted_at IS NULL
  ) END;
$$;

REVOKE ALL ON FUNCTION public.journey_visible(uuid)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clinic_patient_visible(uuid)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.journey_visible(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.clinic_patient_visible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lifecycle_state(timestamptz,timestamptz) TO authenticated;

-- ============================================================
-- 4. WHO MAY ACT ON A PATIENT RECORD
-- ============================================================
-- One ownership predicate for both kinds. A pending doctor is excluded by
-- is_verified_doctor(); a patient is excluded because they are not a doctor at
-- all — the same positive test the anesthesia hardening settled on.
CREATE OR REPLACE FUNCTION public.patient_record_manageable(p_kind text, p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.is_verified_doctor() AND (
    CASE lower(COALESCE(p_kind,''))
      WHEN 'journey' THEN EXISTS (SELECT 1 FROM public.patient_surgeries s
                                   WHERE s.id = p_id AND s.assigned_doctor_id = auth.uid())
      WHEN 'clinic_patient' THEN EXISTS (SELECT 1 FROM public.clinic_patients cp
                                          WHERE cp.id = p_id AND cp.doctor_id = auth.uid())
      ELSE false
    END
  );
$$;
REVOKE ALL ON FUNCTION public.patient_record_manageable(text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patient_record_manageable(text,uuid) TO authenticated;

-- ============================================================
-- 5. STRUCTURED ELIGIBILITY — the replacement contract
-- ============================================================
-- Always returns jsonb. An exception here means a bug in this function, not a
-- business outcome, which is what lets the client stop swallowing everything.
--
-- codes: eligible | clinical_blocker | already_archived | already_deleted
--        record_not_found | unsupported_record | not_authorized | invalid_input
CREATE OR REPLACE FUNCTION public.patient_lifecycle_eligibility(
  p_kind text, p_id uuid, p_action text DEFAULT 'archive')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind text := lower(COALESCE(p_kind,''));
  v_act  text := lower(COALESCE(p_action,'archive'));
  v_arch timestamptz; v_del timestamptz; v_owner uuid; v_found boolean := false;
  v_admin boolean := public.is_platform_admin();
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('eligible',false,'code','not_authorized','reason','You are not signed in.');
  END IF;
  IF p_id IS NULL OR v_kind NOT IN ('journey','clinic_patient') THEN
    RETURN jsonb_build_object('eligible',false,'code','invalid_input',
      'reason','A record type of journey or clinic_patient and an id are required.');
  END IF;
  IF v_act NOT IN ('archive','restore_archive','delete','restore_delete') THEN
    RETURN jsonb_build_object('eligible',false,'code','invalid_input','reason','Unknown action.');
  END IF;

  IF v_kind = 'journey' THEN
    SELECT true, archived_at, deleted_at, assigned_doctor_id
      INTO v_found, v_arch, v_del, v_owner
      FROM public.patient_surgeries WHERE id = p_id;
  ELSE
    SELECT true, archived_at, deleted_at, doctor_id
      INTO v_found, v_arch, v_del, v_owner
      FROM public.clinic_patients WHERE id = p_id;
  END IF;

  IF NOT COALESCE(v_found,false) THEN
    RETURN jsonb_build_object('eligible',false,'code','record_not_found',
      'reason','That record no longer exists.');
  END IF;

  -- Authorization is answered as authorization, never disguised as a
  -- business rule. The old function returned "assigned to another doctor" as
  -- an eligibility outcome, which reads to the UI as something the clinician
  -- could resolve by waiting.
  IF NOT (v_admin OR public.patient_record_manageable(v_kind, p_id)) THEN
    RETURN jsonb_build_object('eligible',false,'code','not_authorized',
      'reason','This patient is managed by another doctor.');
  END IF;

  -- State transitions that are simply already true.
  IF v_act = 'archive' THEN
    IF v_del  IS NOT NULL THEN RETURN jsonb_build_object('eligible',false,'code','already_deleted','reason','This record is in the Recycle Bin.'); END IF;
    IF v_arch IS NOT NULL THEN RETURN jsonb_build_object('eligible',false,'code','already_archived','reason','This record is already archived.'); END IF;
  ELSIF v_act = 'restore_archive' THEN
    IF v_del  IS NOT NULL THEN RETURN jsonb_build_object('eligible',false,'code','already_deleted','reason','Restore it from the Recycle Bin first.'); END IF;
    IF v_arch IS NULL     THEN RETURN jsonb_build_object('eligible',false,'code','already_archived','reason','This record is not archived.'); END IF;
  ELSIF v_act = 'delete' THEN
    IF v_del  IS NOT NULL THEN RETURN jsonb_build_object('eligible',false,'code','already_deleted','reason','This record is already in the Recycle Bin.'); END IF;
  ELSIF v_act = 'restore_delete' THEN
    IF v_del  IS NULL     THEN RETURN jsonb_build_object('eligible',false,'code','already_deleted','reason','This record is not deleted.'); END IF;
  END IF;

  /* Clinical blockers apply to ARCHIVE only, and only for a journey.
     Deleting is recoverable and deliberately has no clinical precondition —
     blocking an accidental entry from being tidied away because a question is
     unanswered would trap the doctor with no way out.

     LEGITIMATE (kept): an open consultation handshake, because archiving one
     side of a request the patient is still waiting on hides a conversation
     that is genuinely live.
     ACCIDENTAL (dropped from archive): "unanswered question". That was the
     blocker firing in production. An unanswered question is a workflow state,
     not a reason the record must stay on the active list — conflating the two
     is exactly the overloading this task exists to undo. It is still surfaced
     as a warning so the doctor is told, but it no longer refuses. */
  IF v_act = 'archive' AND v_kind = 'journey'
     AND EXISTS (SELECT 1 FROM public.care_requests cr
                  WHERE cr.surgery_id = p_id AND cr.status = 'requested'
                    AND cr.deleted_at IS NULL) THEN
    RETURN jsonb_build_object('eligible',false,'code','clinical_blocker',
      'reason','A consultation request is still open for this patient. Resolve it first.');
  END IF;

  RETURN jsonb_build_object('eligible',true,'code','eligible',
    'reason', CASE v_act
                WHEN 'archive'        THEN 'Moves the patient to Archived. Nothing is deleted.'
                WHEN 'restore_archive'THEN 'Returns the patient to the active list.'
                WHEN 'delete'         THEN 'Moves the patient to the Recycle Bin. Recoverable.'
                ELSE 'Restores the patient from the Recycle Bin.' END,
    'warnings', CASE WHEN v_act='archive' AND v_kind='journey'
                       AND EXISTS (SELECT 1 FROM public.questions q
                                    WHERE q.surgery_id = p_id AND q.status <> 'answered'
                                      AND q.deleted_at IS NULL)
                     THEN jsonb_build_array('This patient has an unanswered question.')
                     ELSE '[]'::jsonb END);
END;
$$;
REVOKE ALL ON FUNCTION public.patient_lifecycle_eligibility(text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patient_lifecycle_eligibility(text,uuid,text) TO authenticated;

-- ============================================================
-- 6. THE MUTATIONS — one shape, always structured
-- ============================================================
CREATE OR REPLACE FUNCTION public.patient_set_starred(p_kind text, p_id uuid, p_starred boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_kind text := lower(COALESCE(p_kind,''));
BEGIN
  IF NOT public.patient_record_manageable(v_kind, p_id) THEN
    RETURN jsonb_build_object('ok',false,'code','not_authorized',
      'reason','You cannot change this patient.');
  END IF;
  IF v_kind = 'journey' THEN
    UPDATE public.patient_surgeries SET is_starred = COALESCE(p_starred,false), updated_at = now() WHERE id = p_id;
  ELSE
    UPDATE public.clinic_patients   SET is_starred = COALESCE(p_starred,false), updated_at = now() WHERE id = p_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'is_starred',COALESCE(p_starred,false));
END;
$$;

CREATE OR REPLACE FUNCTION public.patient_lifecycle_action(
  p_kind text, p_id uuid, p_action text, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind text := lower(COALESCE(p_kind,''));
  v_act  text := lower(COALESCE(p_action,''));
  v_elig jsonb;
BEGIN
  -- Every mutation re-checks eligibility server-side. The client having been
  -- told "eligible" a moment ago is not evidence: the record may have changed.
  v_elig := public.patient_lifecycle_eligibility(v_kind, p_id, v_act);
  IF NOT COALESCE((v_elig->>'eligible')::boolean, false) THEN
    RETURN jsonb_build_object('ok',false,'code',v_elig->>'code','reason',v_elig->>'reason');
  END IF;

  IF v_kind = 'journey' THEN
    IF v_act = 'archive' THEN
      UPDATE public.patient_surgeries
         SET archived_at=now(), archived_by=auth.uid(), archive_reason=p_reason, updated_at=now()
       WHERE id=p_id;
    ELSIF v_act = 'restore_archive' THEN
      -- Only the archive columns are cleared. care_state is never touched, so
      -- the patient returns to whatever workflow state they were always in.
      UPDATE public.patient_surgeries
         SET archived_at=NULL, archived_by=NULL, archive_reason=NULL,
             restored_at=now(), restored_by=auth.uid(), updated_at=now()
       WHERE id=p_id;
    ELSIF v_act = 'delete' THEN
      UPDATE public.patient_surgeries
         SET deleted_at=now(), deleted_by=auth.uid(), delete_reason=p_reason, updated_at=now()
       WHERE id=p_id;
    ELSE
      UPDATE public.patient_surgeries
         SET deleted_at=NULL, deleted_by=NULL, delete_reason=NULL,
             restored_at=now(), restored_by=auth.uid(), updated_at=now()
       WHERE id=p_id;
    END IF;
  ELSE
    IF v_act = 'archive' THEN
      UPDATE public.clinic_patients
         SET archived_at=now(), archived_by=auth.uid(), archive_reason=p_reason, updated_at=now()
       WHERE id=p_id;
    ELSIF v_act = 'restore_archive' THEN
      UPDATE public.clinic_patients
         SET archived_at=NULL, archived_by=NULL, archive_reason=NULL,
             restored_at=now(), restored_by=auth.uid(), updated_at=now()
       WHERE id=p_id;
    ELSIF v_act = 'delete' THEN
      UPDATE public.clinic_patients
         SET deleted_at=now(), deleted_by=auth.uid(), delete_reason=p_reason, updated_at=now()
       WHERE id=p_id;
    ELSE
      UPDATE public.clinic_patients
         SET deleted_at=NULL, deleted_by=NULL, delete_reason=NULL,
             restored_at=now(), restored_by=auth.uid(), updated_at=now()
       WHERE id=p_id;
    END IF;
  END IF;

  -- NOTE: no child row is touched, on any path. Children are hidden by the
  -- parent-aware predicates and reappear on restore precisely because their
  -- own deleted_at was never written.
  RETURN jsonb_build_object('ok',true,'code',v_act,'kind',v_kind,'id',p_id);
END;
$$;

REVOKE ALL ON FUNCTION public.patient_set_starred(text,uuid,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.patient_lifecycle_action(text,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patient_set_starred(text,uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patient_lifecycle_action(text,uuid,text,text) TO authenticated;

-- ============================================================
-- 7. PERMANENT DELETE — one authority, and the retention rule
-- ============================================================
-- THE FINALIZED LIVE CHART RULE.
-- A finalized anesthesia record is a signed clinical document. It is not part
-- of ordinary patient-list housekeeping and it does not disappear because
-- somebody tidied a patient list. If one exists, permanent deletion is
-- REFUSED — not cascaded, not detached, not anonymised.
--
-- Refusing rather than detaching is the conservative choice: detaching would
-- silently sever a signed record from the person it documents, which is a
-- worse failure than a purge that will not proceed. Anonymisation may be the
-- right answer under a specific retention policy, but that is a legal decision
-- with an audit story of its own, not something to infer here.
--
-- Soft delete is unaffected: a patient with a finalized record can still be
-- removed from every working list. Only irreversible destruction is blocked.
CREATE OR REPLACE FUNCTION public.patient_purge_eligibility(p_kind text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind text := lower(COALESCE(p_kind,''));
  v_del timestamptz; v_found boolean := false; v_final int := 0; v_open int := 0;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RETURN jsonb_build_object('eligible',false,'code','not_authorized',
      'reason','Permanent deletion is an administrator action.');
  END IF;
  IF p_id IS NULL OR v_kind NOT IN ('journey','clinic_patient') THEN
    RETURN jsonb_build_object('eligible',false,'code','invalid_input','reason','Unknown record.');
  END IF;

  IF v_kind = 'journey' THEN
    SELECT true, deleted_at INTO v_found, v_del FROM public.patient_surgeries WHERE id = p_id;
  ELSE
    SELECT true, deleted_at INTO v_found, v_del FROM public.clinic_patients WHERE id = p_id;
  END IF;
  IF NOT COALESCE(v_found,false) THEN
    RETURN jsonb_build_object('eligible',false,'code','record_not_found','reason','That record no longer exists.');
  END IF;

  -- Nothing is destroyed that was not first soft-deleted and reviewed.
  IF v_del IS NULL THEN
    RETURN jsonb_build_object('eligible',false,'code','not_deleted',
      'reason','Only records already in the Recycle Bin can be permanently deleted.');
  END IF;

  IF to_regclass('public.anesthesia_cases') IS NOT NULL THEN
    IF v_kind = 'journey' THEN
      SELECT count(*) FILTER (WHERE status='finalized'),
             count(*) FILTER (WHERE status <> 'finalized')
        INTO v_final, v_open
        FROM public.anesthesia_cases WHERE surgery_id = p_id;
    ELSE
      SELECT count(*) FILTER (WHERE status='finalized'),
             count(*) FILTER (WHERE status <> 'finalized')
        INTO v_final, v_open
        FROM public.anesthesia_cases WHERE clinic_patient_id = p_id;
    END IF;
    IF v_final > 0 THEN
      RETURN jsonb_build_object('eligible',false,'code','retained_clinical_record',
        'reason', v_final || ' finalized anesthesia record(s) reference this patient. '
                  || 'A signed record is retained and cannot be destroyed by patient cleanup.',
        'finalized_cases', v_final);
    END IF;
  END IF;

  RETURN jsonb_build_object('eligible',true,'code','eligible',
    'reason','This record and its dependent rows will be permanently destroyed.',
    'open_anesthesia_cases', v_open);
END;
$$;

CREATE OR REPLACE FUNCTION public.patient_purge(p_kind text, p_id uuid, p_confirm text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_kind text := lower(COALESCE(p_kind,'')); v_elig jsonb; v_label text;
BEGIN
  -- ONE authority. Recycle Bin and Danger Zone both call this; there is no
  -- second set of rules to drift.
  v_elig := public.patient_purge_eligibility(v_kind, p_id);
  IF NOT COALESCE((v_elig->>'eligible')::boolean,false) THEN
    RETURN jsonb_build_object('ok',false,'code',v_elig->>'code','reason',v_elig->>'reason');
  END IF;
  -- A typed confirmation, so an irreversible action cannot be a mis-click.
  IF COALESCE(p_confirm,'') <> 'PERMANENTLY DELETE' THEN
    RETURN jsonb_build_object('ok',false,'code','confirmation_required',
      'reason','Type PERMANENTLY DELETE to confirm.');
  END IF;

  IF v_kind = 'journey' THEN
    SELECT COALESCE(patient_name,'journey') INTO v_label FROM public.patient_surgeries WHERE id = p_id;
    DELETE FROM public.patient_surgeries WHERE id = p_id;
  ELSE
    SELECT COALESCE(patient_name,'patient') INTO v_label FROM public.clinic_patients WHERE id = p_id;
    DELETE FROM public.clinic_patients WHERE id = p_id;
  END IF;

  IF to_regproc('public.admin_log') IS NOT NULL THEN
    PERFORM public.admin_log('patient.purge', v_kind, p_id, v_label, NULL,
                             jsonb_build_object('kind',v_kind), 'permanent deletion');
  END IF;
  RETURN jsonb_build_object('ok',true,'code','purged','kind',v_kind,'id',p_id);
END;
$$;

REVOKE ALL ON FUNCTION public.patient_purge_eligibility(text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.patient_purge(text,uuid,text)        FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patient_purge_eligibility(text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patient_purge(text,uuid,text)        TO authenticated;

-- ============================================================
-- 8. THE RECYCLE BIN READ MODEL
-- ============================================================
-- One view so the eventual UI does not reimplement the rules. security_invoker
-- so RLS still applies: a doctor sees their own deleted records, an admin sees
-- everything, and nobody sees a bin they have no claim to.
CREATE OR REPLACE VIEW public.recycle_bin AS
SELECT 'journey'::text        AS kind,
       s.id,
       COALESCE(s.patient_name, 'Unnamed journey') AS label,
       s.procedure_type       AS detail,
       s.deleted_at, s.deleted_by, s.delete_reason,
       COALESCE(p.full_name, p.email) AS deleted_by_name
  FROM public.patient_surgeries s
  LEFT JOIN public.profiles p ON p.id = s.deleted_by
 WHERE s.deleted_at IS NOT NULL
UNION ALL
SELECT 'clinic_patient'::text,
       cp.id,
       COALESCE(cp.patient_name, 'Unnamed patient'),
       cp.procedure,
       cp.deleted_at, cp.deleted_by, cp.delete_reason,
       COALESCE(p.full_name, p.email)
  FROM public.clinic_patients cp
  LEFT JOIN public.profiles p ON p.id = cp.deleted_by
 WHERE cp.deleted_at IS NOT NULL;

ALTER VIEW public.recycle_bin SET (security_invoker = true);
GRANT SELECT ON public.recycle_bin TO authenticated;

-- Per-row restorability and purge eligibility are answered by RPC rather than
-- baked into the view: they depend on the CALLER, and a view column computed
-- per row would be evaluated for rows the caller may not act on.
CREATE OR REPLACE FUNCTION public.recycle_bin_item(p_kind text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_restore jsonb; v_purge jsonb;
BEGIN
  v_restore := public.patient_lifecycle_eligibility(p_kind, p_id, 'restore_delete');
  v_purge   := public.patient_purge_eligibility(p_kind, p_id);
  RETURN jsonb_build_object(
    'kind', p_kind, 'id', p_id,
    'restorable',       COALESCE((v_restore->>'eligible')::boolean,false),
    'restore_reason',   v_restore->>'reason',
    'purge_eligible',   COALESCE((v_purge->>'eligible')::boolean,false),
    'purge_reason',     v_purge->>'reason',
    'purge_code',       v_purge->>'code');
END;
$$;
REVOKE ALL ON FUNCTION public.recycle_bin_item(text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recycle_bin_item(text,uuid) TO authenticated;

DO $done$
BEGIN
  RAISE NOTICE '--- Patient lifecycle foundation installed ----------------';
  RAISE NOTICE '  is_starred on patient_surgeries + clinic_patients';
  RAISE NOTICE '  clinic_patients gained the shared lifecycle columns';
  RAISE NOTICE '  predicates : lifecycle_state, journey_visible, clinic_patient_visible,';
  RAISE NOTICE '               patient_record_manageable';
  RAISE NOTICE '  rpcs       : patient_lifecycle_eligibility, patient_lifecycle_action,';
  RAISE NOTICE '               patient_set_starred, patient_purge_eligibility, patient_purge,';
  RAISE NOTICE '               recycle_bin_item';
  RAISE NOTICE '  view       : recycle_bin (security_invoker)';
  RAISE NOTICE '----------------------------------------------------------';
END
$done$;

COMMIT;

-- ============================================================
-- ROLLBACK NOTES
-- ============================================================
-- The added columns hold real state once used; dropping them destroys archive
-- and delete history, so rollback is deliberately not a one-liner.
--   Functions/view only:
--     DROP VIEW IF EXISTS public.recycle_bin;
--     DROP FUNCTION IF EXISTS public.recycle_bin_item(text,uuid);
--     DROP FUNCTION IF EXISTS public.patient_purge(text,uuid,text);
--     DROP FUNCTION IF EXISTS public.patient_purge_eligibility(text,uuid);
--     DROP FUNCTION IF EXISTS public.patient_lifecycle_action(text,uuid,text,text);
--     DROP FUNCTION IF EXISTS public.patient_set_starred(text,uuid,boolean);
--     DROP FUNCTION IF EXISTS public.patient_lifecycle_eligibility(text,uuid,text);
--     DROP FUNCTION IF EXISTS public.patient_record_manageable(text,uuid);
--     DROP FUNCTION IF EXISTS public.clinic_patient_visible(uuid);
--     DROP FUNCTION IF EXISTS public.journey_visible(uuid);
--     DROP FUNCTION IF EXISTS public.lifecycle_state(timestamptz,timestamptz);
--   The legacy patient_archive_eligibility()/archive_patient() are left in
--   place untouched, so nothing that still calls them breaks.
