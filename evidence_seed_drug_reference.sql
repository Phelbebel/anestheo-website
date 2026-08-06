-- ============================================================================
-- Evidence Transparency — Live Tools clinical content
--
-- Registers the Live Tools drug reference and the perioperative antibiotic
-- prophylaxis module in the EXISTING evidence architecture. No parallel review
-- system is created.
--
-- Run AFTER evidence_transparency_phase1.sql and evidence_transparency_phase1_1.sql
--
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ----------------------------------
--   * It inserts NO evidence_reviews row. Reviewer name, review date,
--     evidence_basis, assumptions and limitations come into existence only when
--     a real clinical review is performed and signed in admin-evidence.html.
--   * It publishes NOTHING. Both tools are created with
--     publication_status = 'draft', so the RLS policies in phase 1 keep them
--     invisible to every non-admin reader.
--   * It records NO antibiotic agent, dose or recommendation. The antibiotic
--     module has no clinical content in this build.
--
-- The client mirrors this gate: clinical-index.js only renders and only
-- returns from search the items whose provenance state is
-- 'existing-unchanged' or 'reviewed'.
-- ============================================================================

begin;

-- ── 1. The drug reference ──────────────────────────────────────────────────
-- The 25 values it renders today were migrated verbatim from the previously
-- shipped Live Tools page. They are unchanged, but they were never formally
-- reviewed, so this tool starts as a draft like any other.
insert into public.evidence_tools
  (evidence_id, tool_slug, type, title, calculation_basis, scope, publication_status)
values
  ('REF-DRUG-001', 'perioperative-drug-reference', 'reference',
   'Perioperative drug reference',
   'Weight-based dose ranges applied to the entered total body weight. '
   || 'Values migrated verbatim from the previously published Live Tools page; '
   || 'no dose, unit or weight basis was altered during migration.',
   'Adult perioperative dosing. Not paediatric-specific. '
   || 'Reference ranges only — not clinical decision support.',
   'draft')
on conflict (evidence_id) do nothing;

-- ── 2. Perioperative antibiotic prophylaxis ────────────────────────────────
-- Architecture only. There is no content to review yet; this row exists so the
-- module has a governed identity from the first day it appears in the product.
insert into public.evidence_tools
  (evidence_id, tool_slug, type, title, calculation_basis, scope, publication_status)
values
  ('REF-ABX-001', 'perioperative-antibiotic-prophylaxis', 'reference',
   'Perioperative antibiotic prophylaxis',
   'Not applicable — no recommendation is published in this build.',
   'Surgical antimicrobial prophylaxis. Requires review by an antimicrobial '
   || 'stewardship physician, an infectious diseases specialist, or a clinical '
   || 'pharmacist with perioperative antimicrobial expertise. Founder review '
   || 'alone is not sufficient. Local institutional antimicrobial policy is '
   || 'authoritative in all cases.',
   'draft')
on conflict (evidence_id) do nothing;

-- ── 3. Candidate sources ───────────────────────────────────────────────────
-- Recorded as CANDIDATES only. None of these was directly accessed while this
-- content was assembled; each must be opened and checked by the reviewer
-- before anything is published. The name below is the intended source of
-- record, not a claim that it has been consulted.
insert into public.evidence_sources (tool_id, name, sort_order)
select et.id, v.name, v.ord
from public.evidence_tools et
cross join (values
  ('CANDIDATE — national formulary (BNF or national equivalent), edition to be recorded at review', 1),
  ('CANDIDATE — manufacturer summary of product characteristics / package insert', 2),
  ('CANDIDATE — institutional perioperative dosing policy', 3)
) as v(name, ord)
where et.evidence_id = 'REF-DRUG-001'
  and not exists (select 1 from public.evidence_sources s where s.tool_id = et.id);

insert into public.evidence_sources (tool_id, name, sort_order)
select et.id, v.name, v.ord
from public.evidence_tools et
cross join (values
  ('CANDIDATE — ASHP/IDSA/SIS/SHEA clinical practice guidelines for antimicrobial prophylaxis in surgery', 1),
  ('CANDIDATE — national antimicrobial prophylaxis guidance', 2),
  ('CANDIDATE — local hospital antimicrobial policy and resistance data', 3)
) as v(name, ord)
where et.evidence_id = 'REF-ABX-001'
  and not exists (select 1 from public.evidence_sources s where s.tool_id = et.id);

-- ── 4. Change history ──────────────────────────────────────────────────────
insert into public.evidence_change_history (tool_id, changed_by, summary)
select et.id, null,
  'Created as draft. Existing Live Tools drug values migrated verbatim into the '
  || 'structured clinical model; no clinical value was altered. Ten additional '
  || 'drugs drafted for review and withheld from the clinician interface.'
from public.evidence_tools et
where et.evidence_id = 'REF-DRUG-001'
  and not exists (select 1 from public.evidence_change_history h where h.tool_id = et.id);

insert into public.evidence_change_history (tool_id, changed_by, summary)
select et.id, null,
  'Created as draft. Module architecture, search category and governance only. '
  || 'No antibiotic agent, dose or recommendation is present.'
from public.evidence_tools et
where et.evidence_id = 'REF-ABX-001'
  and not exists (select 1 from public.evidence_change_history h where h.tool_id = et.id);

commit;

-- ── ROLLBACK ───────────────────────────────────────────────────────────────
-- begin;
--   delete from public.evidence_change_history
--     where tool_id in (select id from public.evidence_tools
--                       where evidence_id in ('REF-DRUG-001','REF-ABX-001'));
--   delete from public.evidence_sources
--     where tool_id in (select id from public.evidence_tools
--                       where evidence_id in ('REF-DRUG-001','REF-ABX-001'));
--   delete from public.evidence_tools
--     where evidence_id in ('REF-DRUG-001','REF-ABX-001');
-- commit;
