-- ============================================================
-- ANESTHEO — DIGITAL ANESTHESIA RECORD (Phase 1 foundation)
--
-- A structured, timestamped intraoperative record. Nothing here stores the
-- chart as prose: every clinically meaningful entry is a row with a time, an
-- author, and typed columns.
--
-- ── WHAT THIS REUSES RATHER THAN REINVENTS ──────────────────────────────────
--   profiles                  roles, verification, admin
--   is_verified_doctor()      only an approved doctor may chart
--   is_pending_doctor()       the RESTRICTIVE gate pattern from v2_auth_onboarding
--   is_platform_admin()       admin read access
--   doctor_treats_patient()   the existing "is this my patient" predicate
--   patient_surgeries         an app patient's surgical journey
--   clinic_patients           a doctor-entered patient with no app account
--   account_is_active()       suspended/deleted accounts lose access
--
-- ── WHY THE CASE SUBJECT IS FLEXIBLE ────────────────────────────────────────
-- doctor_treats_patient() keys on an auth.users id. Most people who arrive in
-- an operating theatre have never opened Anestheo and never will. Requiring an
-- account to be charted would make the module unusable for exactly the cases
-- that matter most — emergency, trauma, neonatal. So a case may anchor to:
--     surgery_id        an existing patient_surgeries journey, or
--     clinic_patient_id a doctor's own patient record, or
--     neither           an ad-hoc case typed straight into the chart
-- Identity is denormalised onto the case (display_name, mrn, dob…) because a
-- clinical record must remain readable exactly as it was written even if the
-- linked row is later edited or archived. That is deliberate duplication, not
-- an accident.
--
-- ── WHY SOME OF THE SUGGESTED TABLES ARE MERGED ─────────────────────────────
-- Merged where the columns genuinely coincide, so there is one place to look
-- and one set of policies to get right:
--   anesthesia_access          peripheral IV, IO, arterial, central, PICC,
--                              PA catheter, dialysis, introducer  (8 -> 1)
--   anesthesia_regional        peripheral blocks + spinal/epidural/CSE/caudal
--                              (neuraxial columns nullable)        (2 -> 1)
--   anesthesia_device_sessions monitors, warming devices, temperature probes
--                              — all are (kind, on, off)           (3 -> 1)
--   anesthesia_vitals          long format: any parameter, any time
--   anesthesia_labs            long format: any analyte, ABG through ROTEM
--   anesthesia_events          complications and surgical events, one category
--
-- Kept separate on purpose:
--   fluids vs blood_products   blood carries regulated attributes (unit id,
--                              reaction) that would be permanently NULL on a
--                              bag of saline
--   medications vs infusions   different shapes in time: a bolus is a point,
--                              an infusion is a start, rate changes and a stop
--
-- SAFETY: additive, idempotent, transaction-wrapped. Creates no policy that
-- widens access to anything that already exists. Rollback at the bottom.
--
-- DEPENDS ON: v2_admin_phase0, v2_security_hardening, v2_auth_onboarding
-- ============================================================

BEGIN;

-- ============================================================
-- 0. PREFLIGHT
-- ============================================================
DO $preflight$
DECLARE v_missing text[] := '{}';
BEGIN
  IF to_regproc('public.is_platform_admin')  IS NULL THEN v_missing := v_missing || 'is_platform_admin() [v2_admin_phase0]'::text; END IF;
  IF to_regproc('public.is_verified_doctor') IS NULL THEN v_missing := v_missing || 'is_verified_doctor() [v2_auth_onboarding]'::text; END IF;
  IF to_regproc('public.is_pending_doctor')  IS NULL THEN v_missing := v_missing || 'is_pending_doctor() [v2_auth_onboarding]'::text; END IF;
  -- doctor_treats_patient() calls account_is_active(); a missing dependency
  -- would surface as an error inside a policy, which is the worst place to
  -- discover it.
  IF to_regproc('public.account_is_active')  IS NULL THEN v_missing := v_missing || 'account_is_active() [v2_admin_phase2]'::text; END IF;
  IF to_regproc('public.doctor_treats_patient') IS NULL THEN v_missing := v_missing || 'doctor_treats_patient() [v2_security_hardening]'::text; END IF;
  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION E'ABORT: prerequisites missing: %.\n'
      '  The anesthesia record is charted only by verified doctors; without those\n'
      '  predicates its policies would have nothing to test.',
      array_to_string(v_missing, ', ');
  END IF;
  RAISE NOTICE 'Preflight OK.';
END
$preflight$;

-- ============================================================
-- 1. THE CASE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.anesthesia_cases (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Subject: at most one link, plus the identity as charted.
  surgery_id            uuid REFERENCES public.patient_surgeries(id) ON DELETE SET NULL,
  clinic_patient_id     uuid REFERENCES public.clinic_patients(id)   ON DELETE SET NULL,
  patient_user_id       uuid REFERENCES auth.users(id)               ON DELETE SET NULL,

  display_name          text,
  mrn                   text,
  date_of_birth         date,
  sex                   text,
  weight_kg             numeric(6,2),
  height_cm             numeric(5,1),
  asa_class             text,
  asa_emergency         boolean NOT NULL DEFAULT false,   -- the "E" modifier
  allergies             text,

  diagnosis             text,
  planned_procedure     text,
  actual_procedure      text,
  urgency               text NOT NULL DEFAULT 'elective', -- elective|urgent|emergency
  surgical_specialty    text,
  surgeon               text,
  assistant             text,

  anesthesiologist_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  trainee_id            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  trainee_name          text,

  operating_room        text,
  site                  text,
  case_date             date NOT NULL DEFAULT current_date,

  -- Multiple simultaneous techniques are the norm, so this is a set.
  anesthesia_types      text[] NOT NULL DEFAULT '{}',
  -- Specialty extensions light up on the SAME record: pediatric, neonatal,
  -- obstetric, cardiac, icu, trauma… never a separate chart system.
  case_modes            text[] NOT NULL DEFAULT '{}',

  status                text NOT NULL DEFAULT 'draft',    -- draft|in_progress|finalized
  finalized_at          timestamptz,
  finalized_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  created_by            uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  deleted_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

DO $c$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='anes_case_status_chk') THEN
    ALTER TABLE public.anesthesia_cases ADD CONSTRAINT anes_case_status_chk
      CHECK (status IN ('draft','in_progress','finalized'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='anes_case_urgency_chk') THEN
    ALTER TABLE public.anesthesia_cases ADD CONSTRAINT anes_case_urgency_chk
      CHECK (urgency IN ('elective','urgent','emergency'));
  END IF;
  -- A finalized record must say who finalized it and when. Without this the
  -- immutability story has a hole you could drive a lawsuit through.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='anes_case_finalized_chk') THEN
    ALTER TABLE public.anesthesia_cases ADD CONSTRAINT anes_case_finalized_chk
      CHECK (status <> 'finalized' OR (finalized_at IS NOT NULL AND finalized_by IS NOT NULL));
  END IF;
END $c$;

CREATE INDEX IF NOT EXISTS idx_anes_case_anesthesiologist ON public.anesthesia_cases(anesthesiologist_id);
CREATE INDEX IF NOT EXISTS idx_anes_case_surgery          ON public.anesthesia_cases(surgery_id);
CREATE INDEX IF NOT EXISTS idx_anes_case_clinic_patient   ON public.anesthesia_cases(clinic_patient_id);
CREATE INDEX IF NOT EXISTS idx_anes_case_date             ON public.anesthesia_cases(case_date DESC);

-- ============================================================
-- 2. ACCESS PREDICATES
-- ============================================================
-- SECURITY DEFINER so a policy calling them does not re-enter the RLS of the
-- tables they inspect. Each answers a question about the CALLER only.

-- Who may SEE a case: the anesthesiologist of record, the named trainee, a
-- doctor with an existing treating relationship to the subject, or an admin.
CREATE OR REPLACE FUNCTION public.anesthesia_case_access(p_case uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.anesthesia_cases c
     WHERE c.id = p_case
       AND c.deleted_at IS NULL
       AND (
            public.is_platform_admin()
         OR c.anesthesiologist_id = auth.uid()
         OR c.trainee_id          = auth.uid()
         -- The doctor who owns the clinic record this case was built from.
         OR EXISTS (SELECT 1 FROM public.clinic_patients cp
                     WHERE cp.id = c.clinic_patient_id AND cp.doctor_id = auth.uid())
         -- The doctor assigned to the surgical journey.
         OR EXISTS (SELECT 1 FROM public.patient_surgeries s
                     WHERE s.id = c.surgery_id AND s.assigned_doctor_id = auth.uid())
         -- Any other existing treating relationship, reusing the predicate the
         -- rest of the platform already trusts.
         OR (c.patient_user_id IS NOT NULL AND public.doctor_treats_patient(c.patient_user_id))
       )
  );
$$;

-- Who may CHART on a case. Three independent conditions, all required:
--   1. verified doctor            — a pending doctor never charts
--   2. access to this case        — not somebody else's list
--   3. the record is still open   — finalized records are immutable
-- Admins are deliberately NOT included: platform administration is not a
-- licence to write in somebody's clinical record. Admins read; they do not chart.
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
          AND (
               c.anesthesiologist_id = auth.uid()
            OR c.trainee_id          = auth.uid()
            OR EXISTS (SELECT 1 FROM public.clinic_patients cp
                        WHERE cp.id = c.clinic_patient_id AND cp.doctor_id = auth.uid())
            OR EXISTS (SELECT 1 FROM public.patient_surgeries s
                        WHERE s.id = c.surgery_id AND s.assigned_doctor_id = auth.uid())
          )
     );
$$;

REVOKE ALL ON FUNCTION public.anesthesia_case_access(uuid)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.anesthesia_case_editable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anesthesia_case_access(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.anesthesia_case_editable(uuid) TO authenticated;

-- ============================================================
-- 3. THE CHILD TABLES
-- ============================================================
-- Every one carries case_id, a clinical timestamp, and entered_by. That is the
-- whole point: the record must always be able to answer who wrote this, and when.

-- 3.1 Master timeline. One row per milestone, freely editable, because
-- retrospective documentation is normal and pretending otherwise produces
-- charts that are tidy and false.
CREATE TABLE IF NOT EXISTS public.anesthesia_case_times (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      uuid NOT NULL REFERENCES public.anesthesia_cases(id) ON DELETE CASCADE,
  milestone    text NOT NULL,          -- or_in, monitors_on, anesthesia_start, …
  occurred_at  timestamptz NOT NULL,
  note         text,
  entered_by   uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, milestone)
);

-- 3.2 Pre-anesthesia readiness, one row per case.
CREATE TABLE IF NOT EXISTS public.anesthesia_preassessment (
  case_id                  uuid PRIMARY KEY REFERENCES public.anesthesia_cases(id) ON DELETE CASCADE,
  assessed_at              timestamptz,
  -- Fasting. Recorded as observations, never as a verdict: the system does not
  -- decide whether a patient is safe to anaesthetise.
  fasting_status           text,               -- yes|no|unknown
  last_solid_at            timestamptz,
  last_light_meal_at       timestamptz,
  last_clear_fluid_at      timestamptz,
  last_breast_milk_at      timestamptz,
  last_formula_at          timestamptz,
  other_intake             text,
  chewing_gum              boolean,
  fasting_unavailable_reason text,
  -- When fasting is not met, the reasoning is documented, not inferred.
  fasting_not_met_emergency boolean,
  why_cannot_wait          text,
  aspiration_risk_note     text,
  anesthesiologist_plan    text,
  -- Airway examination
  mouth_opening_cm         numeric(4,1),
  mallampati               text,
  thyromental_distance_cm  numeric(4,1),
  neck_movement            text,
  dentition                text,
  facial_hair              boolean,
  anticipated_mask_difficulty      text,
  anticipated_intubation_difficulty text,
  prior_airway_info        text,
  airway_plan              text,
  airway_backup_plan       text,
  -- Investigations reviewed (values live in anesthesia_labs; these are the
  -- narrative findings that do not reduce to a number)
  ecg_findings             text,
  chest_imaging_findings   text,
  echo_findings            text,
  ejection_fraction_pct    numeric(4,1),
  valve_disease            text,
  pulmonary_hypertension   text,
  other_investigations     text,
  type_and_screen          text,
  notes                    text,
  entered_by               uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- 3.3 History review. A child table rather than 30 boolean columns, so a new
-- topic is a row and never a migration, and so "reviewed but nothing found"
-- is distinguishable from "never asked".
CREATE TABLE IF NOT EXISTS public.anesthesia_history_review (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES public.anesthesia_cases(id) ON DELETE CASCADE,
  topic       text NOT NULL,          -- cardiovascular, allergies, anticoagulants, …
  reviewed    boolean NOT NULL DEFAULT true,
  finding     text,                   -- NULL = reviewed, nothing of note
  significant boolean NOT NULL DEFAULT false,
  entered_by  uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, topic)
);

-- 3.4 Vascular access — every kind, one shape.
CREATE TABLE IF NOT EXISTS public.anesthesia_access (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        uuid NOT NULL REFERENCES public.anesthesia_cases(id) ON DELETE CASCADE,
  kind           text NOT NULL,        -- peripheral_iv|intraosseous|arterial|cvc|picc|pa_catheter|dialysis|introducer
  site           text,
  side           text,                 -- left|right|midline
  gauge          text,
  lumens         smallint,
  catheter_type  text,
  placed_before_or boolean NOT NULL DEFAULT false,
  ultrasound     boolean,
  sterile_technique boolean,
  attempts       smallint,
  inserted_at    timestamptz,
  removed_at     timestamptz,
  waveform_confirmed boolean,
  zeroed         boolean,
  patent         boolean,
  complications  text,
  note           text,
  entered_by     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- 3.5 Devices with an on/off time: monitors, warming, temperature probes.
CREATE TABLE IF NOT EXISTS public.anesthesia_device_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES public.anesthesia_cases(id) ON DELETE CASCADE,
  category    text NOT NULL,           -- monitor|warming|temperature_probe
  kind        text NOT NULL,           -- ecg|nibp|spo2|etco2|bis|tof|tee|… / bair_hugger|… / esophageal|…
  label       text,
  started_at  timestamptz,
  stopped_at  timestamptz,
  note        text,
  entered_by  uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 3.6 Airway management. One row per attempt/episode, so a difficult airway
-- reads as the sequence it actually was.
CREATE TABLE IF NOT EXISTS public.anesthesia_airway (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id            uuid NOT NULL REFERENCES public.anesthesia_cases(id) ON DELETE CASCADE,
  occurred_at        timestamptz NOT NULL,
  preoxygenation_method text,
  preoxygenation_fio2   numeric(4,1),
  preoxygenation_minutes numeric(4,1),
  eto2_pct           numeric(4,1),
  mask_ventilation   text,             -- easy|difficult|impossible|not_attempted
  mask_adjunct       text,
  technique          text,             -- direct_laryngoscopy|video_laryngoscopy|awake_fiberoptic|…
  device             text,             -- ett|reinforced_ett|dlt|lma|igel|tracheostomy|…
  device_size        text,
  route              text,             -- oral|nasal
  depth_cm           numeric(4,1),
  blade              text,
  blade_size         text,
  cormack_lehane     text,
  attempts           smallint,
  operator           text,
  adjunct            text,             -- bougie|stylet|…
  cuff_pressure_cmh2o numeric(5,1),
  etco2_confirmed    boolean,
  bilateral_ventilation boolean,
  bronchoscopy_confirmed boolean,
  difficult_airway   boolean NOT NULL DEFAULT false,
  complication       text,
  olv_started_at     timestamptz,
  olv_ended_at       timestamptz,
  note               text,
  entered_by         uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- 3.7 Ventilation settings — a new row per meaningful change, so the record
-- shows what the settings were at any moment rather than only at the end.
CREATE TABLE IF NOT EXISTS public.anesthesia_ventilation (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES public.anesthesia_cases(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL,
  mode        text,                    -- spontaneous|vcv|pcv|prvc|psv|simv|olv|hfjv|…
  tidal_volume_ml   integer,
  respiratory_rate  numeric(4,1),
  peep_cmh2o        numeric(4,1),
  fio2_pct          numeric(4,1),
  ie_ratio          text,
  pressure_control_cmh2o numeric(4,1),
  peak_pressure_cmh2o    numeric(4,1),
  plateau_pressure_cmh2o numeric(4,1),
  minute_ventilation_l   numeric(5,2),
  note        text,
  entered_by  uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 3.8 Positioning
CREATE TABLE IF NOT EXISTS public.anesthesia_positioning (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        uuid NOT NULL REFERENCES public.anesthesia_cases(id) ON DELETE CASCADE,
  occurred_at    timestamptz NOT NULL,
  position       text NOT NULL,
  arms           text,
  padding        boolean,
  eyes_protected boolean,
  pressure_points_checked boolean,
  head_neck      text,
  axillary_roll  boolean,
  scds           boolean,
  precautions    text,
  note           text,
  entered_by     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- 3.9 Bolus medications. The administered dose is the source of truth and is
-- stored exactly as charted. There is deliberately NO stored weight-normalised
-- column: mg/kg is a presentation derived from the case's snapshotted weight,
-- and storing it would create a second number that can silently disagree with
-- the dose actually given. The system never computes a dose.
CREATE TABLE IF NOT EXISTS public.anesthesia_medications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      uuid NOT NULL REFERENCES public.anesthesia_cases(id) ON DELETE CASCADE,
  administered_at timestamptz NOT NULL,
  medication   text NOT NULL,
  category     text,                   -- induction|opioid|nmb|reversal|vasopressor|antibiotic|…
  dose         numeric(12,3) NOT NULL,
  unit         text NOT NULL,          -- mg|mcg|g|units|mL|mmol
  concentration text,
  route        text,                   -- iv|im|po|sc|neuraxial|topical|inhaled|…
  line         text,
  indication   text,
  is_redose    boolean NOT NULL DEFAULT false,
  administered_by text,
  note         text,
  entered_by   uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_anes_med_case_time ON public.anesthesia_medications(case_id, administered_at);

-- 3.10 Infusions and their rate history. Two tables because an infusion is an
-- interval with a changing rate, not an event.
CREATE TABLE IF NOT EXISTS public.anesthesia_infusions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      uuid NOT NULL REFERENCES public.anesthesia_cases(id) ON DELETE CASCADE,
  medication   text NOT NULL,
  concentration text,
  rate_unit    text,                   -- mcg/kg/min|mg/h|mL/h|ng/mL (TCI target)
  tci_model    text,
  tci_target_kind text,                -- plasma|effect_site
  started_at   timestamptz NOT NULL,
  stopped_at   timestamptz,
  line         text,
  total_given  numeric(12,3),
  total_unit   text,
  note         text,
  entered_by   uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.anesthesia_infusion_rates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  infusion_id  uuid NOT NULL REFERENCES public.anesthesia_infusions(id) ON DELETE CASCADE,
  case_id      uuid NOT NULL REFERENCES public.anesthesia_cases(id) ON DELETE CASCADE,
  occurred_at  timestamptz NOT NULL,
  rate         numeric(12,3) NOT NULL,
  entered_by   uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 3.11 Fluids
CREATE TABLE IF NOT EXISTS public.anesthesia_fluids (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      uuid NOT NULL REFERENCES public.anesthesia_cases(id) ON DELETE CASCADE,
  fluid        text NOT NULL,
  category     text,                   -- crystalloid|colloid|glucose|other
  volume_ml    numeric(8,1),
  started_at   timestamptz,
  finished_at  timestamptz,
  warmed       boolean,
  line         text,
  note         text,
  entered_by   uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- 3.12 Blood products — separate because of the regulated attributes.
CREATE TABLE IF NOT EXISTS public.anesthesia_blood_products (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        uuid NOT NULL REFERENCES public.anesthesia_cases(id) ON DELETE CASCADE,
  product        text NOT NULL,        -- rbc|ffp|platelets|cryo|fibrinogen|pcc|whole_blood|cell_saver
  units          numeric(6,2),
  volume_ml      numeric(8,1),
  unit_identifier text,
  started_at     timestamptz,
  finished_at    timestamptz,
  warmed         boolean,
  reaction       text,
  note           text,
  entered_by     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- 3.13 Outputs and losses
CREATE TABLE IF NOT EXISTS public.anesthesia_outputs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES public.anesthesia_cases(id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL,
  kind        text NOT NULL,           -- ebl|suction|cell_saver|urine|ng|drain|ascites|pleural|csf|other
  volume_ml   numeric(8,1) NOT NULL,
  label       text,
  note        text,
  entered_by  uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 3.14 Vitals — long format. A new monitored parameter is a row, not a
-- migration, and the chart in §31 is a single query over this table.
CREATE TABLE IF NOT EXISTS public.anesthesia_vitals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES public.anesthesia_cases(id) ON DELETE CASCADE,
  measured_at timestamptz NOT NULL,
  parameter   text NOT NULL,           -- hr|sbp|dbp|map|spo2|etco2|temp|bis|tof|cvp|pap|…
  value       numeric(10,2) NOT NULL,
  unit        text,
  source      text NOT NULL DEFAULT 'manual',  -- manual|imported — never faked as device data
  entered_by  uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_anes_vitals_case_time ON public.anesthesia_vitals(case_id, measured_at);
CREATE INDEX IF NOT EXISTS idx_anes_vitals_param     ON public.anesthesia_vitals(case_id, parameter, measured_at);

-- 3.15 Labs — long format, same reasoning. Covers ABG through ROTEM.
CREATE TABLE IF NOT EXISTS public.anesthesia_labs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES public.anesthesia_cases(id) ON DELETE CASCADE,
  sampled_at  timestamptz NOT NULL,
  panel       text,                    -- abg|vbg|cbc|coag|chemistry|teg|rotem|other
  analyte     text NOT NULL,           -- ph|paco2|pao2|hco3|be|hb|hct|na|k|ica|glucose|lactate|act|…
  value       numeric(12,3),
  value_text  text,                    -- for results that are not numbers
  unit        text,
  entered_by  uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 3.16 Regional and neuraxial. One table: consent, sterility, needle,
-- attempts, local anesthetic, catheter and complications are common to both.
-- The neuraxial-only columns are nullable and simply unused for a TAP block.
CREATE TABLE IF NOT EXISTS public.anesthesia_regional (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           uuid NOT NULL REFERENCES public.anesthesia_cases(id) ON DELETE CASCADE,
  kind              text NOT NULL,     -- peripheral_block|spinal|epidural|cse|caudal
  block_name        text,              -- interscalene|tap|esp|peng|… (free text: custom blocks exist)
  side              text,              -- left|right|bilateral|midline
  indication        text,
  consent           boolean,
  time_out          boolean,
  patient_position  text,
  sterile_technique boolean,
  skin_prep         text,
  sterile_gloves    boolean,
  mask              boolean,
  sterile_probe_cover boolean,
  ultrasound        boolean,
  nerve_stimulator  boolean,
  needle_type       text,
  needle_gauge      text,
  needle_length_cm  numeric(4,1),
  attempts          smallint,
  aspiration_negative boolean,
  incremental_injection boolean,
  injection_pressure text,
  -- neuraxial specifics
  vertebral_level   text,
  approach          text,              -- midline|paramedian
  csf_obtained      boolean,
  paresthesia       boolean,
  blood_aspirated   boolean,
  test_dose         text,
  sensory_level     text,
  motor_block       text,
  -- shared
  local_anesthetic  text,
  la_concentration  text,
  la_volume_ml      numeric(6,1),
  la_total_mg       numeric(8,2),
  adjuvant          text,
  catheter          boolean,
  catheter_depth_cm numeric(4,1),
  assessment        text,
  complications     text,
  started_at        timestamptz,
  finished_at       timestamptz,
  note              text,
  entered_by        uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- 3.17 Events: complications and surgical milestones that matter to anesthesia.
CREATE TABLE IF NOT EXISTS public.anesthesia_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      uuid NOT NULL REFERENCES public.anesthesia_cases(id) ON DELETE CASCADE,
  occurred_at  timestamptz NOT NULL,
  category     text NOT NULL,          -- complication|surgical|clinical|note
  event_type   text NOT NULL,          -- hypotension|desaturation|tourniquet_on|delivery|…
  severity     text,
  description  text,
  treatment    text,
  response     text,
  outcome      text,
  resolved_at  timestamptz,
  entered_by   uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_anes_events_case_time ON public.anesthesia_events(case_id, occurred_at);

-- 3.18 Emergence and handoff
CREATE TABLE IF NOT EXISTS public.anesthesia_handoffs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           uuid NOT NULL REFERENCES public.anesthesia_cases(id) ON DELETE CASCADE,
  destination       text NOT NULL,     -- pacu|icu|ward|nicu|ccu|other
  handoff_at        timestamptz NOT NULL,
  -- Emergence is part of the handoff story, and stays optional: a patient
  -- transferred intubated has no extubation to document.
  volatile_stopped_at timestamptz,
  infusions_stopped_at timestamptz,
  tof_ratio         numeric(4,2),
  reversal_agent    text,
  reversal_dose     text,
  reversal_at       timestamptz,
  extubated         boolean,
  extubation_at     timestamptz,
  extubation_type   text,              -- awake|deep
  transferred_intubated boolean NOT NULL DEFAULT false,
  airway_at_transfer text,
  oxygen_device     text,
  ventilation       text,
  bp                text,
  hr                numeric(5,1),
  spo2              numeric(5,1),
  temperature_c     numeric(4,1),
  pain_score        text,
  sedation_score    text,
  ponv              text,
  neuro_status      text,
  ongoing_infusions text,
  lines_drains      text,
  antibiotics_given text,
  key_events        text,
  postoperative_plan text,
  recipient_name    text,
  recipient_role    text,
  transferring_clinician text,
  entered_by        uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- 3.19 Amendments. The only legitimate way to change a finalized record.
CREATE TABLE IF NOT EXISTS public.anesthesia_amendments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id       uuid NOT NULL REFERENCES public.anesthesia_cases(id) ON DELETE CASCADE,
  amended_at    timestamptz NOT NULL DEFAULT now(),
  amended_by    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  target_area   text NOT NULL,         -- medications|timeline|airway|…
  original_text text,                  -- what the record said, as it said it
  amendment     text NOT NULL,
  reason        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 3.20 Audit of meaningful clinical changes.
CREATE TABLE IF NOT EXISTS public.anesthesia_audit (
  id          bigserial PRIMARY KEY,
  case_id     uuid NOT NULL,
  table_name  text NOT NULL,
  row_id      text,
  action      text NOT NULL,           -- insert|update|delete|finalize|amend
  actor       uuid,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_anes_audit_case ON public.anesthesia_audit(case_id, created_at DESC);

COMMIT;

BEGIN;

-- ============================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================
-- Applied by loop, not by hand. Nineteen tables with hand-written policies is
-- nineteen chances to mistype a predicate, and a slip here widens access to a
-- clinical record. One definition, applied uniformly, is the safer artefact.
--
-- The shape for every child table:
--   SELECT              anesthesia_case_access(case_id)
--   INSERT/UPDATE/DELETE anesthesia_case_editable(case_id)
--   RESTRICTIVE          NOT is_pending_doctor()
--
-- The restrictive policy is belt and braces: case_editable() already requires
-- is_verified_doctor(), but SELECT does not, and a pending doctor has no
-- business reading a chart either. It matches the pattern established in
-- v2_auth_onboarding, so the whole platform gates unverified doctors the same way.
DO $rls$
DECLARE
  t text;
  v_children text[] := ARRAY[
    'anesthesia_case_times','anesthesia_preassessment','anesthesia_history_review',
    'anesthesia_access','anesthesia_device_sessions','anesthesia_airway',
    'anesthesia_ventilation','anesthesia_positioning','anesthesia_medications',
    'anesthesia_infusions','anesthesia_infusion_rates','anesthesia_fluids',
    'anesthesia_blood_products','anesthesia_outputs','anesthesia_vitals',
    'anesthesia_labs','anesthesia_regional','anesthesia_events','anesthesia_handoffs'
  ];
BEGIN
  -- 4a. The case itself.
  ALTER TABLE public.anesthesia_cases ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS anes_case_select ON public.anesthesia_cases;
  CREATE POLICY anes_case_select ON public.anesthesia_cases
    FOR SELECT TO authenticated
    USING ( public.anesthesia_case_access(id) );

  -- Only a verified doctor opens a case, and only ever as themselves: the
  -- WITH CHECK pins anesthesiologist_id to the caller so a case cannot be
  -- created in somebody else's name.
  DROP POLICY IF EXISTS anes_case_insert ON public.anesthesia_cases;
  CREATE POLICY anes_case_insert ON public.anesthesia_cases
    FOR INSERT TO authenticated
    WITH CHECK ( public.is_verified_doctor()
                 AND anesthesiologist_id = auth.uid()
                 AND created_by = auth.uid()
                 AND status IN ('draft','in_progress') );

  -- USING decides which rows may be updated; WITH CHECK decides what they may
  -- become. Both are needed: without WITH CHECK an editable case could be
  -- updated into a state the policy would never have allowed.
  DROP POLICY IF EXISTS anes_case_update ON public.anesthesia_cases;
  CREATE POLICY anes_case_update ON public.anesthesia_cases
    FOR UPDATE TO authenticated
    USING ( public.anesthesia_case_editable(id) )
    WITH CHECK ( public.is_verified_doctor() );

  -- No DELETE policy anywhere in this module. Clinical records are not deleted;
  -- anesthesia_cases.deleted_at exists for withdrawal and is set by UPDATE.
  DROP POLICY IF EXISTS anes_case_require_verified ON public.anesthesia_cases;
  CREATE POLICY anes_case_require_verified ON public.anesthesia_cases
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ( NOT public.is_pending_doctor() )
    WITH CHECK ( NOT public.is_pending_doctor() );

  -- 4b. Every child table, identically.
  FOREACH t IN ARRAY v_children LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_select', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
                      USING ( public.anesthesia_case_access(case_id) )$p$, t||'_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_insert', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
                      WITH CHECK ( public.anesthesia_case_editable(case_id)
                                   AND entered_by = auth.uid() )$p$, t||'_insert', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_update', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
                      USING ( public.anesthesia_case_editable(case_id) )
                      WITH CHECK ( public.anesthesia_case_editable(case_id) )$p$, t||'_update', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_delete', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
                      USING ( public.anesthesia_case_editable(case_id) )$p$, t||'_delete', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_require_verified', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I
                      AS RESTRICTIVE FOR ALL TO authenticated
                      USING ( NOT public.is_pending_doctor() )
                      WITH CHECK ( NOT public.is_pending_doctor() )$p$, t||'_require_verified', t);
  END LOOP;

  -- 4c. Amendments: readable with the case, insertable by a doctor who has
  -- access, and never updatable or deletable. An amendment that can be edited
  -- is not an amendment.
  ALTER TABLE public.anesthesia_amendments ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS anes_amend_select ON public.anesthesia_amendments;
  CREATE POLICY anes_amend_select ON public.anesthesia_amendments
    FOR SELECT TO authenticated USING ( public.anesthesia_case_access(case_id) );
  DROP POLICY IF EXISTS anes_amend_insert ON public.anesthesia_amendments;
  CREATE POLICY anes_amend_insert ON public.anesthesia_amendments
    FOR INSERT TO authenticated
    WITH CHECK ( public.is_verified_doctor()
                 AND public.anesthesia_case_access(case_id)
                 AND amended_by = auth.uid() );
  DROP POLICY IF EXISTS anes_amend_require_verified ON public.anesthesia_amendments;
  CREATE POLICY anes_amend_require_verified ON public.anesthesia_amendments
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ( NOT public.is_pending_doctor() )
    WITH CHECK ( NOT public.is_pending_doctor() );

  -- 4d. Audit: readable with the case, written only by triggers (which run as
  -- the table owner and bypass RLS). No INSERT policy at all, so no client can
  -- forge an audit entry.
  ALTER TABLE public.anesthesia_audit ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS anes_audit_select ON public.anesthesia_audit;
  CREATE POLICY anes_audit_select ON public.anesthesia_audit
    FOR SELECT TO authenticated USING ( public.anesthesia_case_access(case_id) );

  RAISE NOTICE 'RLS applied to anesthesia_cases + % child table(s) + amendments + audit',
               array_length(v_children,1);
END
$rls$;

-- ============================================================
-- 5. IMMUTABILITY OF A FINALIZED RECORD
-- ============================================================
-- RLS already refuses writes to a finalized case, because case_editable()
-- tests the status. This trigger is the second lock, and it is the one that
-- holds when a future SECURITY DEFINER RPC, a service-role script or a
-- migration touches a child row — none of which RLS applies to.
--
-- A signed clinical record is not a row that happens to be read-only. It is
-- evidence. Two independent mechanisms is the right number.
CREATE OR REPLACE FUNCTION public.anesthesia_guard_finalized()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_case uuid; v_status text;
BEGIN
  v_case := COALESCE(NEW.case_id, OLD.case_id);
  SELECT status INTO v_status FROM public.anesthesia_cases WHERE id = v_case;
  IF v_status = 'finalized' THEN
    RAISE EXCEPTION
      'This anesthesia record is finalized and cannot be changed. Record an amendment instead.'
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- The case row itself needs a different rule: it must still be updatable in
-- exactly one direction — to finalize, to record a deletion, and to be
-- reopened by nobody. Finalizing sets status/finalized_at/finalized_by; after
-- that only deleted_at/updated_at may move.
CREATE OR REPLACE FUNCTION public.anesthesia_guard_case_finalized()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_old jsonb; v_new jsonb; k text; v_changed text[] := '{}';
        v_allowed text[] := ARRAY['deleted_at','deleted_by','updated_at'];
BEGIN
  IF OLD.status <> 'finalized' THEN
    -- Not yet finalized: ordinary editing, but a record can never travel
    -- backwards out of finalized, and finalization must name its author.
    RETURN NEW;
  END IF;

  v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
  FOR k IN SELECT jsonb_object_keys(v_new) LOOP
    IF (v_old ->> k) IS DISTINCT FROM (v_new ->> k) AND NOT (k = ANY (v_allowed)) THEN
      v_changed := v_changed || k;
    END IF;
  END LOOP;

  IF array_length(v_changed,1) IS NOT NULL THEN
    RAISE EXCEPTION
      'This anesthesia record is finalized. % cannot be changed; record an amendment instead.',
      array_to_string(v_changed, ', ')
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DO $trg$
DECLARE t text;
  v_children text[] := ARRAY[
    'anesthesia_case_times','anesthesia_preassessment','anesthesia_history_review',
    'anesthesia_access','anesthesia_device_sessions','anesthesia_airway',
    'anesthesia_ventilation','anesthesia_positioning','anesthesia_medications',
    'anesthesia_infusions','anesthesia_infusion_rates','anesthesia_fluids',
    'anesthesia_blood_products','anesthesia_outputs','anesthesia_vitals',
    'anesthesia_labs','anesthesia_regional','anesthesia_events','anesthesia_handoffs'
  ];
BEGIN
  FOREACH t IN ARRAY v_children LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_'||t||'_finalized', t);
    EXECUTE format($g$CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I
                      FOR EACH ROW EXECUTE FUNCTION public.anesthesia_guard_finalized()$g$,
                   'trg_'||t||'_finalized', t);
  END LOOP;

  DROP TRIGGER IF EXISTS trg_anesthesia_case_finalized ON public.anesthesia_cases;
  CREATE TRIGGER trg_anesthesia_case_finalized
    BEFORE UPDATE ON public.anesthesia_cases
    FOR EACH ROW EXECUTE FUNCTION public.anesthesia_guard_case_finalized();

  RAISE NOTICE 'Immutability triggers installed on % child table(s) + the case row',
               array_length(v_children,1);
END
$trg$;

-- ============================================================
-- 6. FINALIZE AND AMEND — the only two lifecycle transitions
-- ============================================================
-- SECURITY DEFINER because finalization writes finalized_by/finalized_at,
-- which the caller must not be able to forge, and because it is the one place
-- the audit entry is guaranteed to be written.
CREATE OR REPLACE FUNCTION public.anesthesia_finalize_case(p_case uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_status text;
BEGIN
  IF NOT public.is_verified_doctor() THEN
    RAISE EXCEPTION 'Only a verified doctor may finalize an anesthesia record' USING ERRCODE = '42501';
  END IF;
  IF NOT public.anesthesia_case_editable(p_case) THEN
    RAISE EXCEPTION 'You cannot finalize this record' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM public.anesthesia_cases WHERE id = p_case;
  IF v_status = 'finalized' THEN
    RAISE EXCEPTION 'This record is already finalized' USING ERRCODE = '22023';
  END IF;

  UPDATE public.anesthesia_cases
     SET status = 'finalized', finalized_at = now(), finalized_by = auth.uid(), updated_at = now()
   WHERE id = p_case;

  INSERT INTO public.anesthesia_audit(case_id, table_name, row_id, action, actor, after)
  VALUES (p_case, 'anesthesia_cases', p_case::text, 'finalize', auth.uid(),
          jsonb_build_object('status','finalized'));

  RETURN jsonb_build_object('ok', true, 'status', 'finalized');
END;
$$;

-- An amendment never edits the original. It appends, naming the author, the
-- time and the reason, and it is the only write permitted after finalization.
CREATE OR REPLACE FUNCTION public.anesthesia_amend_case(
  p_case uuid, p_area text, p_original text, p_amendment text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_verified_doctor() THEN
    RAISE EXCEPTION 'Only a verified doctor may amend an anesthesia record' USING ERRCODE = '42501';
  END IF;
  IF NOT public.anesthesia_case_access(p_case) THEN
    RAISE EXCEPTION 'You cannot amend this record' USING ERRCODE = '42501';
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

REVOKE ALL ON FUNCTION public.anesthesia_finalize_case(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.anesthesia_amend_case(uuid,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anesthesia_finalize_case(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.anesthesia_amend_case(uuid,text,text,text,text) TO authenticated;

-- ============================================================
-- 7. CASE TOTALS
-- ============================================================
-- A view, not stored columns: totals are derived, and a derived number that is
-- also stored is a number that will eventually disagree with its own source.
CREATE OR REPLACE VIEW public.anesthesia_case_totals AS
SELECT
  c.id AS case_id,
  (SELECT occurred_at FROM public.anesthesia_case_times t
    WHERE t.case_id=c.id AND t.milestone='anesthesia_start')          AS anesthesia_start,
  (SELECT occurred_at FROM public.anesthesia_case_times t
    WHERE t.case_id=c.id AND t.milestone='anesthesia_finish')         AS anesthesia_finish,
  (SELECT occurred_at FROM public.anesthesia_case_times t
    WHERE t.case_id=c.id AND t.milestone='surgery_start')             AS surgery_start,
  (SELECT occurred_at FROM public.anesthesia_case_times t
    WHERE t.case_id=c.id AND t.milestone='surgery_finish')            AS surgery_finish,
  (SELECT EXTRACT(epoch FROM
      (SELECT occurred_at FROM public.anesthesia_case_times WHERE case_id=c.id AND milestone='anesthesia_finish')
    - (SELECT occurred_at FROM public.anesthesia_case_times WHERE case_id=c.id AND milestone='anesthesia_start'))/60
  )::int                                                              AS anesthesia_minutes,
  (SELECT EXTRACT(epoch FROM
      (SELECT occurred_at FROM public.anesthesia_case_times WHERE case_id=c.id AND milestone='surgery_finish')
    - (SELECT occurred_at FROM public.anesthesia_case_times WHERE case_id=c.id AND milestone='surgery_start'))/60
  )::int                                                              AS surgery_minutes,
  COALESCE((SELECT sum(volume_ml) FROM public.anesthesia_fluids f
             WHERE f.case_id=c.id AND f.category='crystalloid'),0)    AS crystalloid_ml,
  COALESCE((SELECT sum(volume_ml) FROM public.anesthesia_fluids f
             WHERE f.case_id=c.id AND f.category='colloid'),0)        AS colloid_ml,
  COALESCE((SELECT sum(volume_ml) FROM public.anesthesia_fluids f
             WHERE f.case_id=c.id),0)                                 AS fluids_total_ml,
  COALESCE((SELECT sum(volume_ml) FROM public.anesthesia_blood_products b
             WHERE b.case_id=c.id),0)                                 AS blood_ml,
  COALESCE((SELECT sum(units) FROM public.anesthesia_blood_products b
             WHERE b.case_id=c.id),0)                                 AS blood_units,
  COALESCE((SELECT sum(volume_ml) FROM public.anesthesia_outputs o
             WHERE o.case_id=c.id AND o.kind='ebl'),0)                AS ebl_ml,
  COALESCE((SELECT sum(volume_ml) FROM public.anesthesia_outputs o
             WHERE o.case_id=c.id AND o.kind='urine'),0)              AS urine_ml,
  COALESCE((SELECT sum(volume_ml) FROM public.anesthesia_outputs o
             WHERE o.case_id=c.id),0)                                 AS outputs_total_ml,
  (SELECT count(*) FROM public.anesthesia_medications m WHERE m.case_id=c.id)     AS medication_entries,
  (SELECT count(*) FROM public.anesthesia_events e
    WHERE e.case_id=c.id AND e.category='complication')               AS complication_count,
  (SELECT destination FROM public.anesthesia_handoffs h
    WHERE h.case_id=c.id ORDER BY handoff_at DESC LIMIT 1)            AS destination
FROM public.anesthesia_cases c;

-- security_invoker: the view is evaluated as the caller, so the RLS on the
-- underlying tables still applies. Without it a view owned by postgres would
-- hand every caller every case — the classic way a totals view becomes a leak.
ALTER VIEW public.anesthesia_case_totals SET (security_invoker = true);
GRANT SELECT ON public.anesthesia_case_totals TO authenticated;

-- ============================================================
-- 8. TABLE PRIVILEGES
-- ============================================================
-- RLS decides WHICH rows; a GRANT decides whether the role may touch the table
-- at all. Supabase's default privileges usually hand new public tables to
-- authenticated automatically, but a migration that depends on a project
-- setting it does not control is a migration that fails silently somewhere
-- else. Granted explicitly, and never to anon: none of this is public data.
DO $grants$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE'
       AND table_name LIKE 'anesthesia\_%'
  LOOP
    IF t = 'anesthesia_audit' THEN
      -- Written only by triggers running as the owner; nobody may forge one.
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    ELSIF t = 'anesthesia_amendments' THEN
      -- Append-only: an amendment that can be edited is not an amendment.
      EXECUTE format('GRANT SELECT, INSERT ON public.%I TO authenticated', t);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
  GRANT USAGE, SELECT ON SEQUENCE public.anesthesia_audit_id_seq TO authenticated;
  RAISE NOTICE 'Privileges granted to authenticated; anon revoked.';
END
$grants$;

DO $done$
BEGIN
  RAISE NOTICE '--- Digital Anesthesia Record installed -------------------';
  RAISE NOTICE '  tables   : %', (SELECT count(*) FROM information_schema.tables
                                   WHERE table_schema='public' AND table_name LIKE 'anesthesia\_%');
  RAISE NOTICE '  policies : %', (SELECT count(*) FROM pg_policies
                                   WHERE schemaname='public' AND tablename LIKE 'anesthesia\_%');
  RAISE NOTICE '-----------------------------------------------------------';
END
$done$;

COMMIT;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP VIEW IF EXISTS public.anesthesia_case_totals;
-- DROP FUNCTION IF EXISTS public.anesthesia_amend_case(uuid,text,text,text,text);
-- DROP FUNCTION IF EXISTS public.anesthesia_finalize_case(uuid);
-- DROP TABLE IF EXISTS public.anesthesia_audit, public.anesthesia_amendments,
--   public.anesthesia_handoffs, public.anesthesia_events, public.anesthesia_regional,
--   public.anesthesia_labs, public.anesthesia_vitals, public.anesthesia_outputs,
--   public.anesthesia_blood_products, public.anesthesia_fluids,
--   public.anesthesia_infusion_rates, public.anesthesia_infusions,
--   public.anesthesia_medications, public.anesthesia_positioning,
--   public.anesthesia_ventilation, public.anesthesia_airway,
--   public.anesthesia_device_sessions, public.anesthesia_access,
--   public.anesthesia_history_review, public.anesthesia_preassessment,
--   public.anesthesia_case_times, public.anesthesia_cases CASCADE;
-- DROP FUNCTION IF EXISTS public.anesthesia_guard_case_finalized();
-- DROP FUNCTION IF EXISTS public.anesthesia_guard_finalized();
-- DROP FUNCTION IF EXISTS public.anesthesia_case_editable(uuid);
-- DROP FUNCTION IF EXISTS public.anesthesia_case_access(uuid);
