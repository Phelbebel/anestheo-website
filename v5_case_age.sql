-- v5_case_age.sql — represent a patient's age when the date of birth is unknown.
--
-- WHY THIS IS NEEDED
-- anesthesia_cases has exactly one age-bearing column, date_of_birth. That is
-- fine for an elective list and useless in the situation anesthesia actually
-- has to chart: an unidentified trauma patient, a neonate transferred without
-- notes, an emergency where nobody knows the birthday and the team knows only
-- "about seventy" or "four days old".
--
-- Without somewhere to put that, the only ways to record it are to leave the
-- patient ageless — losing the single most important number for dosing and
-- airway sizing — or to compute a birthday backwards from an estimate and
-- write it into date_of_birth. The second is worse: it manufactures a fact.
-- A derived date is indistinguishable from a known one once stored, and it
-- reads as identity to everyone downstream.
--
-- So: two additive nullable columns, and the constraints that keep them
-- honest. Nothing existing changes; every current row stays valid.
--
-- WHAT IT DOES NOT DO
-- It does not touch RLS, the lifecycle, finalization, or any policy. New
-- columns inherit the table's existing policies unchanged.

BEGIN;

ALTER TABLE public.anesthesia_cases
  ADD COLUMN IF NOT EXISTS age_value integer,
  ADD COLUMN IF NOT EXISTS age_unit  text;

COMMENT ON COLUMN public.anesthesia_cases.age_value IS
  'Patient age when the date of birth is unknown. Never derived from date_of_birth — if date_of_birth is present, age is computed for display and this stays NULL.';
COMMENT ON COLUMN public.anesthesia_cases.age_unit IS
  'Unit for age_value: years, months or days. Months and days matter for neonates and infants, where "0 years" is not an age.';

-- Both or neither. A number with no unit is not an age, and a unit with no
-- number is not information.
ALTER TABLE public.anesthesia_cases
  DROP CONSTRAINT IF EXISTS anes_case_age_pair_chk;
ALTER TABLE public.anesthesia_cases
  ADD CONSTRAINT anes_case_age_pair_chk
  CHECK ((age_value IS NULL) = (age_unit IS NULL));

ALTER TABLE public.anesthesia_cases
  DROP CONSTRAINT IF EXISTS anes_case_age_unit_chk;
ALTER TABLE public.anesthesia_cases
  ADD CONSTRAINT anes_case_age_unit_chk
  CHECK (age_unit IS NULL OR age_unit IN ('years','months','days'));

-- Bounds per unit. Generous enough never to argue with a real patient, tight
-- enough to catch a mistyped field: 150 years, and the month/day ranges past
-- which the larger unit is the honest one.
ALTER TABLE public.anesthesia_cases
  DROP CONSTRAINT IF EXISTS anes_case_age_range_chk;
ALTER TABLE public.anesthesia_cases
  ADD CONSTRAINT anes_case_age_range_chk
  CHECK (age_value IS NULL OR (
    age_value >= 0 AND CASE age_unit
      WHEN 'years'  THEN age_value <= 150
      WHEN 'months' THEN age_value <= 36
      WHEN 'days'   THEN age_value <= 400
      ELSE false END));

-- One source of truth. If the birthday is known, age is arithmetic, not data:
-- storing both invites them to disagree, and a chart that states an age its
-- own date of birth contradicts is worse than one that states neither.
ALTER TABLE public.anesthesia_cases
  DROP CONSTRAINT IF EXISTS anes_case_age_xor_dob_chk;
ALTER TABLE public.anesthesia_cases
  ADD CONSTRAINT anes_case_age_xor_dob_chk
  CHECK (date_of_birth IS NULL OR age_value IS NULL);

-- A patient cannot be born tomorrow. Safe as a CHECK because it only ever
-- becomes more true: a date that is in the past today is in the past forever,
-- so no stored row can be invalidated by the clock, and a dump reloads clean.
ALTER TABLE public.anesthesia_cases
  DROP CONSTRAINT IF EXISTS anes_case_dob_not_future_chk;
ALTER TABLE public.anesthesia_cases
  ADD CONSTRAINT anes_case_dob_not_future_chk
  CHECK (date_of_birth IS NULL OR date_of_birth <= CURRENT_DATE);

COMMIT;
