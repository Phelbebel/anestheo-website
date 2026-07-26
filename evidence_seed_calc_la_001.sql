-- ============================================================================
-- Evidence Transparency  ·  Phase 1 seed  ·  CALC-LA-001
-- Local anaesthetic maximum dose calculator.
--
-- TRUTHFUL by construction:
--   * No clinical review has actually been performed, and no real reviewer
--     name or review date exists, so NONE is fabricated.
--   * Therefore NO evidence_reviews row is inserted. review_type is
--     effectively 'none', publication_status stays 'draft', and the tool
--     renders the approved "not yet published" state in the UI.
--   * Only genuinely-true, verifiable facts are stored: the calculation
--     formula, the population scope, and the real source class the limits
--     derive from (manufacturer product labeling). Version/date are left
--     ABSENT because they are not verified here.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

insert into public.evidence_tools
  (evidence_id, type, title, calculation_basis, scope, publication_status)
values (
  'CALC-LA-001',
  'calculator',
  'Local anaesthetic maximum dose',
  'Maximum dose (mg) = weight (kg) × agent limit (mg/kg). '
    || 'Volume (mL) = dose (mg) ÷ concentration (mg/mL); 1% solution = 10 mg/mL.',
  'Adult; single-injection maximum by total body weight. '
    || 'Not cumulative dosing, not infusions, not paediatric dosing.',
  'draft'
)
on conflict (evidence_id) do nothing;

-- Real source (named). Version and publication date are left ABSENT
-- (not verified here) rather than fabricated.
insert into public.evidence_sources (tool_id, name, sort_order)
select et.id,
       'Manufacturer prescribing information (local anaesthetic product labeling)',
       0
from public.evidence_tools et
where et.evidence_id = 'CALC-LA-001'
  and not exists (
    select 1 from public.evidence_sources s
    where s.tool_id = et.id
      and s.name = 'Manufacturer prescribing information (local anaesthetic product labeling)'
  );

-- Truthful change-history entry: created by the seed, awaiting review.
insert into public.evidence_change_history (tool_id, changed_by, summary)
select et.id,
       'migration seed',
       'Draft record created. Formula, scope and source class recorded; '
         || 'no clinical review performed yet, so the item remains Draft and is not shown as reviewed.'
from public.evidence_tools et
where et.evidence_id = 'CALC-LA-001'
  and not exists (
    select 1 from public.evidence_change_history h where h.tool_id = et.id
  );

-- Deliberately NOT inserted: any evidence_reviews row, reviewer name, review
-- date, evidence_basis, assumptions, or limitations. These come into existence
-- only when a real clinical review is performed and signed (see admin-evidence.html).
