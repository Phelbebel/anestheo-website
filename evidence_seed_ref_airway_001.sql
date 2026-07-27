-- ============================================================================
-- Evidence Transparency  ·  seed  ·  REF-AIRWAY-001
-- First Clinical Reference adoption: the Airway reference (airway.html).
--
-- Reuses the existing evidence tables, routing model (tool_slug), review
-- model, and drawer. No new infrastructure.
--
-- TRUTHFUL by construction (same rule as CALC-LA-001):
--   * No clinical review has been performed on this reference, and no real
--     reviewer name or review date exists, so NONE is fabricated and NO
--     evidence_reviews row is inserted. review_type is effectively 'none',
--     publication_status stays 'draft', and the page shows the approved
--     "not yet published" state.
--   * The reference's dose tables and algorithms are NOT recorded as sourced
--     evidence here — they are unreviewed, so only the item's identity,
--     type, and coverage scope are stored.
--
--   evidence_id ('REF-AIRWAY-001')  = permanent AUDIT identifier
--   tool_slug   ('airway-reference') = public ROUTING identifier
--
-- Run AFTER evidence_transparency_phase1.sql and evidence_transparency_phase1_1.sql.
-- Idempotent: safe to run more than once.
-- ============================================================================

insert into public.evidence_tools
  (evidence_id, tool_slug, type, title, scope, publication_status)
values (
  'REF-AIRWAY-001',
  'airway-reference',
  'reference',
  'Airway',
  'Adult and paediatric airway assessment, equipment sizing, and routine management. Educational quick reference.',
  'draft'
)
on conflict (evidence_id) do nothing;

-- Truthful change-history entry: created by the seed, awaiting review.
insert into public.evidence_change_history (tool_id, changed_by, summary)
select et.id,
       'migration seed',
       'Draft reference record created (identity, type and scope). No clinical '
         || 'review performed yet, so the reference remains Draft and is not shown as reviewed.'
from public.evidence_tools et
where et.evidence_id = 'REF-AIRWAY-001'
  and not exists (
    select 1 from public.evidence_change_history h where h.tool_id = et.id
  );

-- Deliberately NOT inserted: any evidence_reviews row, reviewer name, review
-- date, evidence_basis, sources, or the reference's clinical statements. These
-- come into existence only when a real clinical review is performed and signed
-- (via admin-evidence.html?slug=airway-reference).
