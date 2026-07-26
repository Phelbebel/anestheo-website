-- ============================================================================
-- Evidence Transparency  ·  Phase 1.1 refinement (ADDITIVE migration)
-- Run AFTER evidence_transparency_phase1.sql (and it is safe to run after the
-- seed too). Destroys no data. Existing Evidence IDs remain valid and
-- unchanged. Existing Draft behaviour continues to work.
--
-- Adds two architectural fields:
--   1. tool_slug     — the PUBLIC ROUTING identifier (stable, unique,
--                      immutable). The frontend resolves evidence by this.
--                      It is completely independent of evidence_id.
--   2. review_version — the version of the CLINICAL REVIEW (not the tool):
--                      an integer that starts at 1 and auto-increments per
--                      tool on each new review. Append-only and immutable.
--                      Internal audit field: exposed in the DB and to admins,
--                      but NOT returned by the public get_evidence() payload,
--                      so it never appears in the user-facing drawer.
--
-- evidence_id stays exactly as it was: the PERMANENT AUDIT identifier.
-- Routing identity (tool_slug) and audit identity (evidence_id) are separate.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PART 1 — tool_slug (routing identity), independent of evidence_id (audit)
-- ---------------------------------------------------------------------------

-- 1a. add nullable first (additive; existing rows untouched)
alter table public.evidence_tools add column if not exists tool_slug text;

-- 1b. backfill: known tool gets its real slug; anything else gets a safe,
--     unique slug derived from its (lowercased) evidence_id. Never changes
--     evidence_id.
update public.evidence_tools
   set tool_slug = 'local-anesthetic-max-dose'
 where evidence_id = 'CALC-LA-001' and tool_slug is null;

update public.evidence_tools
   set tool_slug = lower(evidence_id)
 where tool_slug is null;

-- 1c. enforce presence, uniqueness, format, and routing/audit independence
alter table public.evidence_tools alter column tool_slug set not null;

create unique index if not exists idx_evidence_tools_slug on public.evidence_tools(tool_slug);

do $$ begin
  alter table public.evidence_tools
    add constraint tool_slug_format check (tool_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
exception when duplicate_object then null; end $$;

-- 1d. tool_slug is write-once (immutable), like evidence_id. Extend the guard.
create or replace function public.evidence_tools_guard() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'UPDATE' then
    if NEW.evidence_id is distinct from OLD.evidence_id then
      raise exception 'evidence_id is immutable (write-once)';
    end if;
    if NEW.tool_slug is distinct from OLD.tool_slug then
      raise exception 'tool_slug is immutable (write-once)';
    end if;
    NEW.updated_at := now();
  end if;
  return NEW;
end$$;
-- (trg_evidence_tools_guard already exists from Phase 1; function replaced above.)

-- ---------------------------------------------------------------------------
-- PART 2 — review_version (version of the clinical review)
-- ---------------------------------------------------------------------------

-- 2a. add nullable first (additive)
alter table public.evidence_reviews add column if not exists review_version integer;

-- 2b. auto-increment on insert (per tool); immutable on update. Backfill of a
--     currently-NULL value is permitted (OLD is null); a set value can never
--     change afterwards.
create or replace function public.evidence_reviews_guard() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.review_version is null then
      select coalesce(max(review_version), 0) + 1
        into NEW.review_version
        from public.evidence_reviews
       where tool_id = NEW.tool_id;
    end if;
  elsif TG_OP = 'UPDATE' then
    if OLD.review_version is not null
       and NEW.review_version is distinct from OLD.review_version then
      raise exception 'review_version is immutable';
    end if;
  end if;
  return NEW;
end$$;

drop trigger if exists trg_evidence_reviews_guard on public.evidence_reviews;
create trigger trg_evidence_reviews_guard
  before insert or update on public.evidence_reviews
  for each row execute function public.evidence_reviews_guard();

-- 2c. backfill any existing reviews (append-only history preserved: numbered by
--     creation order within each tool). Normally a no-op (no reviews yet).
with numbered as (
  select id, row_number() over (partition by tool_id order by created_at, id) as rn
    from public.evidence_reviews
   where review_version is null
)
update public.evidence_reviews r
   set review_version = n.rn
  from numbered n
 where n.id = r.id;

-- 2d. now enforce presence
alter table public.evidence_reviews alter column review_version set not null;

create index if not exists idx_evidence_reviews_version
  on public.evidence_reviews(tool_id, review_version);

-- ---------------------------------------------------------------------------
-- PART 3 — API resolves by tool_slug (routing), returns evidence_id (audit)
-- The payload continues to include evidence_id (shown in the drawer) and
-- deliberately DOES NOT include review_version (internal audit field only).
-- ---------------------------------------------------------------------------
drop function if exists public.get_evidence(text);

create or replace function public.get_evidence(p_tool_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t public.evidence_tools;
  r public.evidence_reviews;
  v_public       boolean;
  v_sources      jsonb;
  v_assumptions  jsonb;
  v_limitations  jsonb;
  v_notes        jsonb;
  v_history      jsonb;
  v_reviewer     jsonb;
begin
  -- resolve by ROUTING identity
  select * into t from public.evidence_tools where tool_slug = p_tool_slug;
  if not found then
    return null;                                   -- unknown slug
  end if;

  v_public := t.publication_status = 'published'
           or (t.publication_status = 'under_revision' and t.under_revision_prior_state = 'available');

  if not v_public then
    -- lifecycle only; never unreviewed content. Includes the AUDIT id.
    return jsonb_build_object(
      'evidence_id',        t.evidence_id,
      'type',               t.type,
      'title',              t.title,
      'publication_status', t.publication_status,
      'review_type',        'none'
    );
  end if;

  select * into r
    from public.evidence_reviews
   where id = t.current_review_id and review_status = 'published';

  select jsonb_agg(
           jsonb_strip_nulls(jsonb_build_object(
             'name',             s.name,
             'citation',         s.citation,
             'version',          s.version,
             'publication_date', s.source_date,
             'url',              s.url
           )) order by s.sort_order)
    into v_sources
    from public.evidence_sources s
   where s.tool_id = t.id;

  if r.id is not null then
    select jsonb_agg(i.body order by i.sort_order) filter (where i.kind = 'assumption'),
           jsonb_agg(i.body order by i.sort_order) filter (where i.kind = 'limitation'),
           jsonb_agg(i.body order by i.sort_order) filter (where i.kind = 'note')
      into v_assumptions, v_limitations, v_notes
      from public.evidence_review_items i
     where i.review_id = r.id;

    v_reviewer := jsonb_strip_nulls(jsonb_build_object(
      'name',           r.reviewer_name,
      'role',           r.reviewer_role,
      'independent_of', r.external_reviewer_relationship
    ));
  end if;

  select jsonb_agg(jsonb_build_object(
           'changed_at', h.changed_at,
           'changed_by', h.changed_by,
           'summary',    h.summary
         ) order by h.changed_at desc)
    into v_history
    from public.evidence_change_history h
   where h.tool_id = t.id;

  -- NOTE: review_version is intentionally NOT included in this public payload.
  return jsonb_strip_nulls(jsonb_build_object(
    'evidence_id',        t.evidence_id,
    'type',               t.type,
    'title',              t.title,
    'publication_status', t.publication_status,
    'review_type',        coalesce(r.review_type, 'none'),
    'evidence_basis',     r.evidence_basis,
    'calculation_basis',  t.calculation_basis,
    'scope',              t.scope,
    'sources',            v_sources,
    'reviewer',           case when r.id is not null then v_reviewer end,
    'reviewed_at',        r.reviewed_at,
    'assumptions',        v_assumptions,
    'limitations',        v_limitations,
    'notes',              case when v_notes is not null then v_notes->>0 end,
    'change_history',     v_history
  ));
end$$;

grant execute on function public.get_evidence(text) to anon, authenticated;

-- End of Phase 1.1 refinement.
