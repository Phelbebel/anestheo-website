-- v6_health_passport.sql — the Anestheo Health Passport.
--
-- WHAT THIS IS
-- A patient keeps a short, structured record of the things an anesthetist
-- needs to know before touching them — the allergy, the difficult airway, the
-- anticoagulant, the pacemaker — and can expose it through a QR code they
-- carry. Someone who scans it in an emergency gets a page. Nobody who scans it
-- gets a database.
--
-- THE THREAT MODEL, STATED PLAINLY
-- Assume the QR is photographed by a stranger. Assume it is posted online.
-- Everything below follows from that:
--
--   * The QR carries no medical information. It carries one opaque token.
--   * The token is 256 bits of randomness and is related to nothing — not the
--     patient id, not the passport id, not the email. It cannot be derived,
--     guessed, or walked.
--   * The database never stores the token. It stores sha256(token). A dump of
--     every row in this schema does not let anyone open a single passport.
--   * The token travels in the URL FRAGMENT, so it is never in a request line
--     and never in a web-server access log. It IS sent in the POST body of
--     hp_rotate_token and hp_resolve_passport, over TLS, and necessarily
--     exists in server memory while those run. That is the precise claim.
--   * The token is revocable and replaceable, and a revoked one dies instantly.
--   * A scanner sees a projection, chosen item by item by the patient. Never a
--     table, never a row, never an id.
--
-- WHY AN RPC AND NOT AN EDGE FUNCTION
-- This codebase already resolves public tokens through SECURITY DEFINER
-- functions granted to anon (get_clinic_patient_by_token,
-- submit_clinic_questionnaire). Adding an Edge Function would mean a second
-- boundary pattern, a second deployment surface, and a service-role key living
-- somewhere new — for a site whose deployment is a manual upload. Keeping the
-- resolver in SQL means the projection lives beside the data and the policies
-- it is guarding, ships in the same migration as the schema it reads, and can
-- never drift out of step with it.
--
-- WHAT THIS FILE DOES NOT DO
-- No document upload. No automatic Live Chart integration — but source_type
-- and source_record_id are shaped so a finalized anesthesia case can later
-- write a clinician-verified difficult airway without touching this schema.
--
-- SAFE TO RE-RUN.

BEGIN;

-- ═══════════ TABLES ════════════════════════════════════════════════════════

/* One passport per patient. Its status can be revoked and restored; a second
   passport for the same person would only create two answers to one question. */
CREATE TABLE IF NOT EXISTS public.health_passports (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id             uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  status                 text NOT NULL DEFAULT 'active',
  emergency_view_enabled boolean NOT NULL DEFAULT true,
  /* Whether a scanner is told WHO this is. Default false: the QR is designed
     on the assumption that a stranger photographs it, and a name is the one
     field that turns a set of conditions into an identified person. The
     consent screen asks for it explicitly before any QR is generated, so
     nearly everyone will turn it on deliberately — which is the point. */
  show_name_on_qr        boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
/* Additive, so an installation created before this hardening pass gains the
   columns with the safe default rather than needing a rebuild. */
ALTER TABLE public.health_passports
  ADD COLUMN IF NOT EXISTS show_name_on_qr boolean NOT NULL DEFAULT false;
ALTER TABLE public.health_passport_contacts
  ADD COLUMN IF NOT EXISTS is_emergency_visible boolean NOT NULL DEFAULT false;
ALTER TABLE public.health_passport_items
  ALTER COLUMN is_emergency_visible SET DEFAULT false;

ALTER TABLE public.health_passports DROP CONSTRAINT IF EXISTS hp_status_chk;
ALTER TABLE public.health_passports
  ADD CONSTRAINT hp_status_chk CHECK (status IN ('active','revoked'));

/* One row, one fact. "Penicillin — anaphylaxis" is an item; a paragraph
   describing three allergies and a heart condition is not, because a scanner
   reading it in ninety seconds cannot triage prose. */
CREATE TABLE IF NOT EXISTS public.health_passport_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passport_id          uuid NOT NULL REFERENCES public.health_passports(id) ON DELETE CASCADE,
  category             text NOT NULL,
  label                text NOT NULL,
  value_text           text,
  severity             text,
  priority             integer NOT NULL DEFAULT 0,
  source_type          text NOT NULL DEFAULT 'patient_reported',
  source_record_id     uuid,
  reported_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at          timestamptz,
  verification_lost_at timestamptz,
  /* Default false, so nothing can become publicly readable through a code
     path that never asked. The add form pre-ticks the box and says plainly
     what it does, so a patient recording an allergy still shares it in one
     deliberate action — but the DEFAULT is the safe one. */
  is_emergency_visible boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);

ALTER TABLE public.health_passport_items DROP CONSTRAINT IF EXISTS hp_item_category_chk;
ALTER TABLE public.health_passport_items
  ADD CONSTRAINT hp_item_category_chk CHECK (category IN (
    'allergy','difficult_airway','anticoagulation','medication','implanted_device',
    'cardiovascular','respiratory','neurologic','renal','hepatic','endocrine',
    'hematologic','previous_anesthesia','anesthesia_complication','emergency_note','other'));

ALTER TABLE public.health_passport_items DROP CONSTRAINT IF EXISTS hp_item_source_chk;
ALTER TABLE public.health_passport_items
  ADD CONSTRAINT hp_item_source_chk CHECK (source_type IN (
    'patient_reported','document_supported','clinician_verified','system_derived'));

ALTER TABLE public.health_passport_items DROP CONSTRAINT IF EXISTS hp_item_severity_chk;
ALTER TABLE public.health_passport_items
  ADD CONSTRAINT hp_item_severity_chk CHECK (
    severity IS NULL OR severity IN ('critical','high','moderate','low','info'));

/* Verified means a named clinician stood behind it at a known moment. A row
   claiming verification without either is a badge with nobody behind it. */
ALTER TABLE public.health_passport_items DROP CONSTRAINT IF EXISTS hp_item_verified_chk;
ALTER TABLE public.health_passport_items
  ADD CONSTRAINT hp_item_verified_chk CHECK (
    source_type <> 'clinician_verified'
    OR (verified_by IS NOT NULL AND verified_at IS NOT NULL));

CREATE INDEX IF NOT EXISTS hp_items_passport_idx
  ON public.health_passport_items(passport_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.health_passport_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passport_id  uuid NOT NULL REFERENCES public.health_passports(id) ON DELETE CASCADE,
  name         text NOT NULL,
  relationship text,
  phone        text,
  is_primary   boolean NOT NULL DEFAULT false,
  /* Default false. A contact's name and number are a THIRD PARTY's personal
     data; that person never agreed to be reachable by anyone who photographs
     a card. Publishing them is a separate, deliberate act by the patient. */
  is_emergency_visible boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE INDEX IF NOT EXISTS hp_contacts_passport_idx
  ON public.health_passport_contacts(passport_id) WHERE deleted_at IS NULL;

/* THE TOKEN IS NOT HERE. token_hash is sha256 of the raw token, hex, so this
   table and every backup of it are useless to anyone who steals them.

   The raw value lives in the printed QR and in the patient's browser. It also
   passes through this server, in the body of hp_rotate_token when it is minted
   and of hp_resolve_passport on every scan — it cannot be looked up without
   being sent. What is guaranteed is that it is not PERSISTED here and not in a
   URL; what is not guaranteed is whatever the hosting platform logs about an
   RPC body, which is not ours to promise.

   token_prefix is the first eight characters of the HASH, not of the token. It
   exists so a patient can be shown "ending 3f9a…" to tell two QR cards apart,
   and it leaks nothing: knowing part of a hash does not help you produce the
   preimage. */
CREATE TABLE IF NOT EXISTS public.health_passport_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passport_id  uuid NOT NULL REFERENCES public.health_passports(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  token_prefix text,
  scope        text NOT NULL DEFAULT 'emergency',
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  revoked_at   timestamptz,
  last_used_at timestamptz
);
ALTER TABLE public.health_passport_tokens DROP CONSTRAINT IF EXISTS hp_token_scope_chk;
ALTER TABLE public.health_passport_tokens
  ADD CONSTRAINT hp_token_scope_chk CHECK (scope IN ('emergency'));
CREATE INDEX IF NOT EXISTS hp_tokens_passport_idx ON public.health_passport_tokens(passport_id);

/* What a patient is owed: "your QR was opened at 14:32". Nothing more is
   stored — no address, no user agent, no location. A scan is somebody helping
   you in an emergency; turning it into a tracking record would be a second,
   quieter harm.

   Only SUCCESSFUL resolutions are written. Logging failures would let anyone
   on the internet grow this table by guessing tokens. */
CREATE TABLE IF NOT EXISTS public.health_passport_access_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passport_id uuid NOT NULL REFERENCES public.health_passports(id) ON DELETE CASCADE,
  token_id    uuid REFERENCES public.health_passport_tokens(id) ON DELETE SET NULL,
  accessed_at timestamptz NOT NULL DEFAULT now(),
  outcome     text NOT NULL DEFAULT 'resolved'
);
CREATE INDEX IF NOT EXISTS hp_access_passport_idx
  ON public.health_passport_access_log(passport_id, accessed_at DESC);

-- ═══════════ PROVENANCE GUARD ══════════════════════════════════════════════

/* A clinician verified a FACT, not a row. If the patient later edits what the
   fact says, the verification no longer describes what is written there, and
   silently keeping the badge would put a clinician's name behind a sentence
   they never read.
--
   So a change to anything medically load-bearing — the category, the label,
   the value, the severity — drops the row back to patient_reported and stamps
   verification_lost_at, which is how the patient page can say "this needs
   re-checking" rather than quietly losing a badge.
--
   Rearranging, hiding or re-prioritising an item changes no clinical claim and
   keeps its verification.
--
   Mirrors guard_profiles_self_update, which does the same thing to a doctor's
   own verification when they edit the identity it was granted against. */
CREATE OR REPLACE FUNCTION public.hp_guard_item_provenance()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    /* Anything a signed-in patient creates is patient_reported. Full stop.
       Not "unless they asked for document_supported" — a hand-rolled REST call
       can ask for anything, and document_supported is a claim that a document
       was checked, which no V1 workflow has done. It is reserved for a future
       validated-document flow, and clinician_verified for hp_verify_item(),
       and system_derived for trusted server work. None of those is reachable
       from a browser. */
    IF current_user IN ('authenticated','anon') THEN
      NEW.source_type  := 'patient_reported';
      NEW.verified_by  := NULL;
      NEW.verified_at  := NULL;
      NEW.verification_lost_at := NULL;
      NEW.reported_by  := auth.uid();
    END IF;
    RETURN NEW;
  END IF;

  NEW.updated_at := now();

  IF current_user NOT IN ('authenticated','anon') THEN
    RETURN NEW;                       -- hp_verify_item and admin paths
  END IF;

  /* A patient can never write these columns directly, in either direction:
     not to grant a badge, not to forge who granted it, and not to move an
     entry sideways into document_supported. The value is simply carried over
     from the existing row, whatever the request asked for. */
  NEW.source_type := OLD.source_type;
  NEW.verified_by := OLD.verified_by;
  NEW.verified_at := OLD.verified_at;

  IF OLD.source_type = 'clinician_verified'
     AND (   OLD.category   IS DISTINCT FROM NEW.category
          OR OLD.label      IS DISTINCT FROM NEW.label
          OR OLD.value_text IS DISTINCT FROM NEW.value_text
          OR OLD.severity   IS DISTINCT FROM NEW.severity)
  THEN
    NEW.source_type          := 'patient_reported';
    NEW.verified_by          := NULL;
    NEW.verified_at          := NULL;
    NEW.verification_lost_at := now();
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_hp_guard_item_provenance ON public.health_passport_items;
CREATE TRIGGER trg_hp_guard_item_provenance
  BEFORE INSERT OR UPDATE ON public.health_passport_items
  FOR EACH ROW EXECUTE FUNCTION public.hp_guard_item_provenance();

-- ═══════════ RLS ═══════════════════════════════════════════════════════════

ALTER TABLE public.health_passports            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_passport_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_passport_contacts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_passport_tokens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_passport_access_log  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.health_passports            FORCE ROW LEVEL SECURITY;
ALTER TABLE public.health_passport_items       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.health_passport_contacts    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.health_passport_tokens      FORCE ROW LEVEL SECURITY;
ALTER TABLE public.health_passport_access_log  FORCE ROW LEVEL SECURITY;

/* anon gets nothing, anywhere. The public view is the resolver function and
   only the resolver function. These REVOKEs are belt as well as braces —
   this database grants nothing to new tables by default — but the cost of
   being wrong here is every passport in the system. */
REVOKE ALL ON public.health_passports           FROM anon;
REVOKE ALL ON public.health_passport_items      FROM anon;
REVOKE ALL ON public.health_passport_contacts   FROM anon;
REVOKE ALL ON public.health_passport_tokens     FROM anon;
REVOKE ALL ON public.health_passport_access_log FROM anon;

/* The tokens table and the access log are not client-readable by ANYONE, not
   even their owner. Everything a patient needs from them arrives through a
   function that returns a safe projection. A browser that cannot query a table
   cannot be tricked into querying it. */
REVOKE ALL ON public.health_passport_tokens     FROM authenticated;
REVOKE ALL ON public.health_passport_access_log FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.health_passports         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.health_passport_items    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.health_passport_contacts TO authenticated;

CREATE OR REPLACE FUNCTION public.hp_owns(p_passport uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $$
  SELECT EXISTS (SELECT 1 FROM public.health_passports p
                  WHERE p.id = p_passport AND p.patient_id = auth.uid());
$$;

/* A doctor with a real, current treating relationship may READ a passport.
   That is the whole of the doctor's V1 access: no browsing, no search, no
   list. doctor_treats_patient() is the same predicate the rest of the app
   uses, so there is one definition of "my patient". */
CREATE OR REPLACE FUNCTION public.hp_clinician_may_read(p_passport uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $$
  SELECT public.is_verified_doctor()
     AND EXISTS (SELECT 1 FROM public.health_passports p
                  WHERE p.id = p_passport
                    AND public.doctor_treats_patient(p.patient_id));
$$;

-- ── passports ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS hp_select ON public.health_passports;
CREATE POLICY hp_select ON public.health_passports FOR SELECT
  USING (patient_id = auth.uid() OR hp_clinician_may_read(id));

DROP POLICY IF EXISTS hp_insert ON public.health_passports;
CREATE POLICY hp_insert ON public.health_passports FOR INSERT
  WITH CHECK (patient_id = auth.uid());

DROP POLICY IF EXISTS hp_update ON public.health_passports;
CREATE POLICY hp_update ON public.health_passports FOR UPDATE
  USING (patient_id = auth.uid()) WITH CHECK (patient_id = auth.uid());

DROP POLICY IF EXISTS hp_delete ON public.health_passports;
CREATE POLICY hp_delete ON public.health_passports FOR DELETE
  USING (patient_id = auth.uid());

-- ── items ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS hp_item_select ON public.health_passport_items;
CREATE POLICY hp_item_select ON public.health_passport_items FOR SELECT
  USING (hp_owns(passport_id) OR hp_clinician_may_read(passport_id));

DROP POLICY IF EXISTS hp_item_insert ON public.health_passport_items;
/* Belt as well as braces: the trigger already forces patient_reported, and
   this refuses anything else outright. Either alone would hold; a direct REST
   insert asking for clinician_verified now meets both. */
CREATE POLICY hp_item_insert ON public.health_passport_items FOR INSERT
  WITH CHECK (hp_owns(passport_id) AND source_type = 'patient_reported');

DROP POLICY IF EXISTS hp_item_update ON public.health_passport_items;
CREATE POLICY hp_item_update ON public.health_passport_items FOR UPDATE
  USING (hp_owns(passport_id)) WITH CHECK (hp_owns(passport_id));

DROP POLICY IF EXISTS hp_item_delete ON public.health_passport_items;
CREATE POLICY hp_item_delete ON public.health_passport_items FOR DELETE
  USING (hp_owns(passport_id));

-- ── contacts ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS hp_contact_select ON public.health_passport_contacts;
CREATE POLICY hp_contact_select ON public.health_passport_contacts FOR SELECT
  USING (hp_owns(passport_id) OR hp_clinician_may_read(passport_id));

DROP POLICY IF EXISTS hp_contact_write ON public.health_passport_contacts;
CREATE POLICY hp_contact_write ON public.health_passport_contacts FOR ALL
  USING (hp_owns(passport_id)) WITH CHECK (hp_owns(passport_id));

/* No policy on health_passport_tokens or health_passport_access_log, and no
   grants either. With RLS forced and nothing permitted, every direct query
   from any client role returns nothing and every write is refused. The only
   way in is through the functions below. */

-- ═══════════ TOKENS ════════════════════════════════════════════════════════

/* The raw token is generated in the browser by crypto.getRandomValues — 256
   bits, base64url — and posted here once to be hashed. pgcrypto is not
   installed on this database, so gen_random_bytes() is unavailable; requiring
   a new extension in production for this alone would be a larger change than
   the feature. The consequence is stated rather than hidden: the entropy comes
   from the client CSPRNG, and the server enforces that whatever arrives is at
   least 43 base64url characters so a short or empty token cannot be set. */
CREATE OR REPLACE FUNCTION public.hp_hash_token(p_token text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path TO 'public','pg_temp' AS $$
  SELECT encode(sha256(convert_to(p_token, 'utf8')), 'hex');
$$;

/* Replace the QR. Every previous token dies in the same statement that mints
   the new one, so there is never a moment when two cards both work. The
   medical content is untouched — this rotates a key, it does not edit a
   record. */
CREATE OR REPLACE FUNCTION public.hp_rotate_token(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $$
DECLARE v_passport uuid; v_hash text; v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  /* Exactly the shape HP.newToken() produces: 43 base64url characters, which
     is 256 bits. Not "at least" — a longer or differently-shaped value did not
     come from our generator, and there is no reason to accept one. */
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'A passport token must be exactly 43 url-safe characters'
      USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_passport FROM public.health_passports WHERE patient_id = auth.uid();
  IF v_passport IS NULL THEN
    RAISE EXCEPTION 'You do not have a Health Passport yet' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.health_passport_tokens
     SET revoked_at = now()
   WHERE passport_id = v_passport AND revoked_at IS NULL;

  v_hash := public.hp_hash_token(p_token);
  INSERT INTO public.health_passport_tokens(passport_id, token_hash, token_prefix, scope)
  VALUES (v_passport, v_hash, left(v_hash, 8), 'emergency')
  RETURNING id INTO v_id;

  UPDATE public.health_passports
     SET emergency_view_enabled = true, status = 'active', updated_at = now()
   WHERE id = v_passport;

  RETURN jsonb_build_object('ok', true, 'token_prefix', left(v_hash, 8),
                            'created_at', now());
END $$;

/* Turn the QR off without destroying anything. The medical record stays; the
   door closes. Generating a new token opens it again. */
CREATE OR REPLACE FUNCTION public.hp_disable_token()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $$
DECLARE v_passport uuid; v_n int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT id INTO v_passport FROM public.health_passports WHERE patient_id = auth.uid();
  IF v_passport IS NULL THEN
    RAISE EXCEPTION 'You do not have a Health Passport yet' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.health_passport_tokens SET revoked_at = now()
   WHERE passport_id = v_passport AND revoked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.health_passports
     SET emergency_view_enabled = false, updated_at = now() WHERE id = v_passport;
  RETURN jsonb_build_object('ok', true, 'revoked', v_n);
END $$;

/* What the patient may know about their own QR: whether one is live, when it
   was made, when it was last scanned, and a fragment of its HASH to tell two
   printed cards apart. Never the token. */
CREATE OR REPLACE FUNCTION public.hp_token_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $$
DECLARE v_passport uuid; v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('active', false); END IF;
  SELECT id INTO v_passport FROM public.health_passports WHERE patient_id = auth.uid();
  IF v_passport IS NULL THEN RETURN jsonb_build_object('active', false); END IF;
  SELECT jsonb_build_object(
           'active', true, 'token_prefix', t.token_prefix,
           'created_at', t.created_at, 'last_used_at', t.last_used_at,
           'scans', (SELECT count(*) FROM public.health_passport_access_log l
                      WHERE l.token_id = t.id))
    INTO v
    FROM public.health_passport_tokens t
   WHERE t.passport_id = v_passport AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now())
   ORDER BY t.created_at DESC LIMIT 1;
  RETURN COALESCE(v, jsonb_build_object('active', false));
END $$;

-- ═══════════ CLINICIAN VERIFICATION ════════════════════════════════════════

/* The only way an item becomes clinician_verified. A doctor cannot reach it by
   updating a row — they have no UPDATE policy on items at all — and a patient
   cannot reach it in any way.
--
   Verification is an act by a named person at a known time against a specific
   wording, so all three are recorded together. Merely reading a passport
   verifies nothing: a doctor who opens a patient-reported difficult airway and
   does nothing leaves it patient-reported, which is the honest state. */
CREATE OR REPLACE FUNCTION public.hp_verify_item(p_item uuid, p_verify boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $$
DECLARE v_passport uuid;
BEGIN
  IF NOT public.is_verified_doctor() THEN
    RAISE EXCEPTION 'Only an approved doctor may verify a Health Passport entry'
      USING ERRCODE = '42501';
  END IF;
  SELECT passport_id INTO v_passport FROM public.health_passport_items
   WHERE id = p_item AND deleted_at IS NULL;
  IF v_passport IS NULL THEN
    RAISE EXCEPTION 'No such Health Passport entry' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.hp_clinician_may_read(v_passport) THEN
    RAISE EXCEPTION 'You do not have a treating relationship with this patient'
      USING ERRCODE = '42501';
  END IF;

  IF p_verify THEN
    UPDATE public.health_passport_items
       SET source_type = 'clinician_verified', verified_by = auth.uid(),
           verified_at = now(), verification_lost_at = NULL, updated_at = now()
     WHERE id = p_item;
  ELSE
    UPDATE public.health_passport_items
       SET source_type = 'patient_reported', verified_by = NULL,
           verified_at = NULL, updated_at = now()
     WHERE id = p_item;
  END IF;
  RETURN jsonb_build_object('ok', true, 'verified', p_verify);
END $$;

-- ═══════════ THE PUBLIC RESOLVER ═══════════════════════════════════════════

/* The single door a scanner may open, and the only thing anon may execute.
--
   It takes a raw token, hashes it, and either returns the projection the
   patient chose to publish or says the passport is unavailable. Every failure
   — unknown token, revoked token, disabled view, revoked passport — returns
   the SAME shape. A stranger holding a photographed QR cannot learn whether a
   token ever existed, whether it was turned off, or whether the person behind
   it is a patient here at all.
--
   What it returns contains no id of any kind: not the passport, not the items,
   not the patient. There is nothing in the response to correlate, enumerate or
   come back with. */
CREATE OR REPLACE FUNCTION public.hp_resolve_passport(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_hash text; v_tok public.health_passport_tokens%ROWTYPE;
  v_pass public.health_passports%ROWTYPE; v_name text; v_items jsonb; v_contacts jsonb;
  v_unavailable CONSTANT jsonb := jsonb_build_object('found', false);
BEGIN
  /* Refuse anything that is not shaped like one of our tokens before touching
     the database. Same generic answer, so this reveals nothing. */
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN v_unavailable; END IF;
  v_hash := public.hp_hash_token(p_token);

  SELECT * INTO v_tok FROM public.health_passport_tokens
   WHERE token_hash = v_hash
     AND revoked_at IS NULL
     AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN v_unavailable; END IF;

  SELECT * INTO v_pass FROM public.health_passports WHERE id = v_tok.passport_id;
  IF NOT FOUND OR v_pass.status <> 'active' OR NOT v_pass.emergency_view_enabled THEN
    RETURN v_unavailable;
  END IF;

  /* The name only if the patient chose to share it, and nothing else from
     their account ever: no email, no account id, no role, no metadata. */
  IF v_pass.show_name_on_qr THEN
    SELECT NULLIF(btrim(COALESCE(pr.full_name, '')), '') INTO v_name
      FROM public.profiles pr WHERE pr.id = v_pass.patient_id;
  ELSE
    v_name := NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.ord, x.pri DESC, x.label), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT i.category, i.label, i.value_text, i.severity, i.source_type,
             i.verified_at IS NOT NULL AS is_verified,
             i.priority AS pri,
             CASE i.category
               WHEN 'difficult_airway'        THEN 0
               WHEN 'allergy'                 THEN 1
               WHEN 'anesthesia_complication' THEN 2
               WHEN 'anticoagulation'         THEN 3
               WHEN 'implanted_device'        THEN 4
               WHEN 'emergency_note'          THEN 5
               ELSE 9 END AS ord
        FROM public.health_passport_items i
       WHERE i.passport_id = v_pass.id
         AND i.deleted_at IS NULL
         AND i.is_emergency_visible          -- the patient decided, item by item
    ) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'name', c.name, 'relationship', c.relationship, 'phone', c.phone)
           ORDER BY c.is_primary DESC, c.created_at), '[]'::jsonb)
    INTO v_contacts
    FROM public.health_passport_contacts c
   WHERE c.passport_id = v_pass.id AND c.deleted_at IS NULL
     AND c.is_emergency_visible;          -- the patient chose, contact by contact

  UPDATE public.health_passport_tokens SET last_used_at = now() WHERE id = v_tok.id;
  INSERT INTO public.health_passport_access_log(passport_id, token_id, outcome)
  VALUES (v_pass.id, v_tok.id, 'resolved');

  RETURN jsonb_build_object(
    'found', true,
    'patient_name', v_name,
    'items', v_items,
    'contacts', v_contacts,
    'generated_at', now());
END $$;

/* A patient's own scan history, by passport rather than by token, so replacing
   a QR does not erase the fact that the old one was used. */
CREATE OR REPLACE FUNCTION public.hp_access_history(p_limit integer DEFAULT 20)
RETURNS TABLE(accessed_at timestamptz, outcome text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $$
  SELECT l.accessed_at, l.outcome
    FROM public.health_passport_access_log l
    JOIN public.health_passports p ON p.id = l.passport_id
   WHERE p.patient_id = auth.uid()
   ORDER BY l.accessed_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));
$$;

-- ═══════════ EXECUTE GRANTS ════════════════════════════════════════════════

/* PostgreSQL grants EXECUTE on a new function to PUBLIC by default, which
   silently included anon. None of the helpers below leaks anything when called
   without a session — hp_owns and hp_clinician_may_read both collapse to false
   when auth.uid() is null, and sha256 is not a secret — but "harmless to call"
   is not the standard here. Anon may reach exactly one function in this
   schema, and it is the resolver. */
REVOKE ALL ON FUNCTION public.hp_owns(uuid)               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hp_clinician_may_read(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hp_hash_token(text)         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hp_guard_item_provenance()  FROM PUBLIC;

/* These two are named inside RLS policy expressions, which are evaluated as
   the calling role, so a signed-in user must be able to execute them. Anon is
   not granted, and anon has no policy to evaluate them from anyway. */
GRANT EXECUTE ON FUNCTION public.hp_owns(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.hp_clinician_may_read(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.hp_resolve_passport(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hp_rotate_token(text)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hp_disable_token()        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hp_token_status()         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hp_verify_item(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hp_access_history(integer) FROM PUBLIC;

-- The resolver is the ONLY thing a scanner may call.
GRANT EXECUTE ON FUNCTION public.hp_resolve_passport(text)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hp_rotate_token(text)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.hp_disable_token()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.hp_token_status()              TO authenticated;
GRANT EXECUTE ON FUNCTION public.hp_verify_item(uuid, boolean)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.hp_access_history(integer)     TO authenticated;

COMMIT;
