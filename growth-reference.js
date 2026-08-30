/* growth-reference.js — PAEDIATRIC GROWTH REFERENCE
   ═══════════════════════════════════════════════════════════════════════════
   THIS FILE IS DELIBERATELY EMPTY OF DATA.

   It is the source boundary for the paediatric weight/height estimate. Until
   a verified dataset is placed here, window.PEDS_GROWTH_REFERENCE stays null,
   the estimate assistant in Live Tools does not render at all, and no number
   is shown to anyone. Nothing in this repository fabricates a growth value.

   Kept separate from clinical-index.js on purpose: that file is the drug
   index, this is reference anthropometry, and mixing them would make one
   dataset's provenance inherit the other's.

   ── TODO: WHAT TO PUT HERE ────────────────────────────────────────────────

   DATASETS REQUIRED (two, because neither covers the whole paediatric range)

     1. WHO Child Growth Standards, 2006
        Coverage      birth to 60 months
        Indicators    weight-for-age            AVAILABLE 0–60 months
                      length/height-for-age     AVAILABLE 0–60 months
        Note          recumbent LENGTH to 24 months, standing HEIGHT from 24
                      months. They are not interchangeable and the published
                      tables say which is which; carry the distinction into
                      the data rather than flattening it.
        Reference     https://www.who.int/tools/child-growth-standards/standards

     2. WHO Growth Reference, 2007
        Coverage      5 to 19 years
        Indicators    weight-for-age            AVAILABLE ONLY TO 10 YEARS
                      height-for-age            AVAILABLE 5–19 years
                      BMI-for-age               AVAILABLE 5–19 years
        Reference     https://www.who.int/tools/growth-reference-data-for-5to19-years

   THE COVERAGE GAP THIS CREATES, AND WHY IT MATTERS
     WHO does not publish weight-for-age above 10 years — the stated reason is
     that it does not separate height from body mass through puberty. So a
     weight estimate can be offered from 0 to 10 years and a height estimate
     to 19, and between 10 and 16 there is height but no weight.

     Do NOT paper over that band with a different reference without saying so
     on screen. pedsEstimate() already returns weight and height independently
     and the UI already draws a card per available value, so the gap is
     representable without inventing anything.

   SEX
     Boys and girls are separate tables in both datasets. Do not average them
     and do not fall back to one when sex is unrecorded — the estimate simply
     is not available without it, which is what the code already does.

   AGE UNIT AND RESOLUTION
     Store ageDays as the key. WHO publishes daily tables for 0–5 years and
     monthly tables thereafter; ageDays holds both without a second code path.
     Interpolate linearly between adjacent rows. Do NOT extrapolate past
     either end of a table — return null, and let the UI say nothing.

   REPRESENTATION: LMS, NOT PERCENTILE GRIDS
     Each row is (sex, ageDays, L, M, S). Every centile and z-score is
     recoverable from those three:

         X(z) = M * (1 + L*S*z)^(1/L)      when L != 0
         X(z) = M * exp(S*z)               when L == 0

     M alone is the median, which is exactly the "suggested typical value" the
     assistant offers, so the ordinary case is a lookup with no arithmetic.
     Four tables in total: weight-for-age and height-for-age, boys and girls.

   ── THE CONTRACT THE UI EXPECTS ───────────────────────────────────────────

     window.PEDS_GROWTH_REFERENCE = {
       source:   'WHO Child Growth Standards (2006)',   // shown to the user
       revision: '2006',                                 // optional
       lookup: function (q) {
         // q = { ageDays:Number, ageYears:Number, sex:'M'|'F' }
         // return null when the query falls outside the dataset, otherwise:
         return { weightKg: Number|null,     // median for age and sex
                  heightCm: Number|null,     // null above 10y for weight
                  basis:    '50th centile' };
       }
     };

   ── PROVENANCE OF THIS NOTE ───────────────────────────────────────────────
   Written from knowledge of the WHO standards, not from a file in this
   repository and not from a fetch: outbound network access is blocked in the
   build environment. Verify the coverage claims above against who.int before
   building the tables. Nothing downstream depends on this note being right —
   it is guidance for whoever fills the file, and the code refuses to run
   without real data either way.
*/
(function (root) {
  'use strict';

  /* No data. Not a placeholder object, not an empty table that could be
     mistaken for a loaded one — null, which is the single value the estimate
     assistant treats as "unavailable". */
  root.PEDS_GROWTH_REFERENCE = null;
})(typeof window !== 'undefined' ? window : this);
