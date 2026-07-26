-- ============================================================================
-- Evidence Transparency  ·  Phase 1 migration
-- Implements docs/CHECK_OUR_WORK_SPEC.md ("Check our work").
-- Additive and backward-compatible. Run once in the Supabase SQL editor.
-- Phase 1 only: the five evidence tables, indexes, constraints, the
-- write-once evidence_id guard, RLS (public-read-published / admin-write),
-- and the get_evidence(evidence_id) read function. No seed here (see
-- evidence_seed_calc_la_001.sql). No fabricated data.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- (a) tool metadata: the unit evidence attaches to
create table if not exists public.evidence_tools (
  id                          uuid primary key default gen_random_uuid(),
  evidence_id                 text not null unique,          -- PERMANENT human-readable id, e.g. 'CALC-LA-001'
  type                        text not null
                              check (type in ('calculator','reference','assessment_rule','other')),
  title                       text not null,                 -- display title; stored separately from evidence_id
  calculation_basis           text,                          -- calculators only; nullable
  scope                       text,                          -- nullable
  publication_status          text not null default 'draft'
                              check (publication_status in ('draft','published','under_revision','retired')),
  under_revision_prior_state  text
                              check (under_revision_prior_state in ('available','withdrawn')),
  supersedes_evidence_id      text references public.evidence_tools(evidence_id),
  current_review_id           uuid,                          -- fk added after evidence_reviews exists
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint evidence_id_format
    check (evidence_id ~ '^[A-Z]+-[A-Z0-9]+-[0-9]{3,}$'),
  constraint under_revision_state_scoped
    check (under_revision_prior_state is null or publication_status = 'under_revision')
);

-- (b) evidence sources: one row per named source; every detail nullable but name
create table if not exists public.evidence_sources (
  id           uuid primary key default gen_random_uuid(),
  tool_id      uuid not null references public.evidence_tools(id) on delete cascade,
  name         text not null,
  citation     text,
  version      text,
  source_date  date,
  url          text,
  sort_order   integer not null default 0
);

-- (c) review records: append-only; a new review supersedes, never edits
create table if not exists public.evidence_reviews (
  id                             uuid primary key default gen_random_uuid(),
  tool_id                        uuid not null references public.evidence_tools(id) on delete cascade,
  reviewer_name                  text not null,
  reviewer_role                  text not null,
  review_type                    text not null
                                 check (review_type in ('founder','internal_clinical','external_clinical')),
  external_reviewer_relationship text,
  evidence_basis                 text not null
                                 check (evidence_basis in ('source_based','guideline_based','consensus_based','calculation_based')),
  reviewed_at                    date not null,
  notes                          text,
  review_status                  text not null default 'published'
                                 check (review_status in ('published','superseded')),
  created_at                     timestamptz not null default now(),
  -- an external review must document how the reviewer is independent of the team
  constraint external_review_documented
    check (review_type <> 'external_clinical' or external_reviewer_relationship is not null)
);

-- tool.current_review_id -> reviews (added now that both tables exist)
alter table public.evidence_tools
  drop constraint if exists evidence_tools_current_review_fk;
alter table public.evidence_tools
  add constraint evidence_tools_current_review_fk
  foreign key (current_review_id) references public.evidence_reviews(id) on delete set null;

-- assumptions / limitations / notes: individually omittable, versioned WITH the review
create table if not exists public.evidence_review_items (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.evidence_reviews(id) on delete cascade,
  kind        text not null check (kind in ('assumption','limitation','note')),
  body        text not null,
  sort_order  integer not null default 0
);

-- (d) change history: append-only, human-readable
create table if not exists public.evidence_change_history (
  id          uuid primary key default gen_random_uuid(),
  tool_id     uuid not null references public.evidence_tools(id) on delete cascade,
  review_id   uuid references public.evidence_reviews(id) on delete set null,
  changed_at  timestamptz not null default now(),
  changed_by  text not null,
  summary     text not null
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_evidence_tools_pubstatus     on public.evidence_tools(publication_status);
create index if not exists idx_evidence_sources_tool        on public.evidence_sources(tool_id);
create index if not exists idx_evidence_reviews_tool        on public.evidence_reviews(tool_id);
create index if not exists idx_evidence_reviews_toolstatus  on public.evidence_reviews(tool_id, review_status);
create index if not exists idx_evidence_review_items_review on public.evidence_review_items(review_id);
create index if not exists idx_evidence_change_hist_tool    on public.evidence_change_history(tool_id, changed_at);

-- ---------------------------------------------------------------------------
-- Write-once evidence_id guard + updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.evidence_tools_guard() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'UPDATE' then
    if NEW.evidence_id is distinct from OLD.evidence_id then
      raise exception 'evidence_id is immutable (write-once)';
    end if;
    NEW.updated_at := now();
  end if;
  return NEW;
end$$;

drop trigger if exists trg_evidence_tools_guard on public.evidence_tools;
create trigger trg_evidence_tools_guard
  before update on public.evidence_tools
  for each row execute function public.evidence_tools_guard();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.evidence_tools          enable row level security;
alter table public.evidence_sources        enable row level security;
alter table public.evidence_reviews        enable row level security;
alter table public.evidence_review_items   enable row level security;
alter table public.evidence_change_history enable row level security;

-- admin check — matches the product convention (profiles.role = 'admin')
create or replace function public.is_evidence_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- A tool is publicly visible when published, or under revision with the prior
-- version still available.
--   evidence_tools: SELECT
drop policy if exists evidence_tools_read on public.evidence_tools;
create policy evidence_tools_read on public.evidence_tools
  for select using (
    publication_status = 'published'
    or (publication_status = 'under_revision' and under_revision_prior_state = 'available')
    or public.is_evidence_admin()
  );
--   evidence_tools: admin write
drop policy if exists evidence_tools_admin_write on public.evidence_tools;
create policy evidence_tools_admin_write on public.evidence_tools
  for all using (public.is_evidence_admin()) with check (public.is_evidence_admin());

--   evidence_sources: SELECT (parent tool public) / admin write
drop policy if exists evidence_sources_read on public.evidence_sources;
create policy evidence_sources_read on public.evidence_sources
  for select using (
    public.is_evidence_admin()
    or exists (
      select 1 from public.evidence_tools t
      where t.id = evidence_sources.tool_id
        and (t.publication_status = 'published'
             or (t.publication_status = 'under_revision' and t.under_revision_prior_state = 'available'))
    )
  );
drop policy if exists evidence_sources_admin_write on public.evidence_sources;
create policy evidence_sources_admin_write on public.evidence_sources
  for all using (public.is_evidence_admin()) with check (public.is_evidence_admin());

--   evidence_reviews: SELECT (only the tool's current, published review) / admin write
drop policy if exists evidence_reviews_read on public.evidence_reviews;
create policy evidence_reviews_read on public.evidence_reviews
  for select using (
    public.is_evidence_admin()
    or (
      review_status = 'published'
      and exists (
        select 1 from public.evidence_tools t
        where t.id = evidence_reviews.tool_id
          and t.current_review_id = evidence_reviews.id
          and (t.publication_status = 'published'
               or (t.publication_status = 'under_revision' and t.under_revision_prior_state = 'available'))
      )
    )
  );
drop policy if exists evidence_reviews_admin_write on public.evidence_reviews;
create policy evidence_reviews_admin_write on public.evidence_reviews
  for all using (public.is_evidence_admin()) with check (public.is_evidence_admin());

--   evidence_review_items: SELECT (parent review public) / admin write
drop policy if exists evidence_review_items_read on public.evidence_review_items;
create policy evidence_review_items_read on public.evidence_review_items
  for select using (
    public.is_evidence_admin()
    or exists (
      select 1
        from public.evidence_reviews r
        join public.evidence_tools  t on t.id = r.tool_id
       where r.id = evidence_review_items.review_id
         and r.review_status = 'published'
         and t.current_review_id = r.id
         and (t.publication_status = 'published'
              or (t.publication_status = 'under_revision' and t.under_revision_prior_state = 'available'))
    )
  );
drop policy if exists evidence_review_items_admin_write on public.evidence_review_items;
create policy evidence_review_items_admin_write on public.evidence_review_items
  for all using (public.is_evidence_admin()) with check (public.is_evidence_admin());

--   evidence_change_history: SELECT (parent tool public) / admin write
drop policy if exists evidence_change_history_read on public.evidence_change_history;
create policy evidence_change_history_read on public.evidence_change_history
  for select using (
    public.is_evidence_admin()
    or exists (
      select 1 from public.evidence_tools t
      where t.id = evidence_change_history.tool_id
        and (t.publication_status = 'published'
             or (t.publication_status = 'under_revision' and t.under_revision_prior_state = 'available'))
    )
  );
drop policy if exists evidence_change_history_admin_write on public.evidence_change_history;
create policy evidence_change_history_admin_write on public.evidence_change_history
  for all using (public.is_evidence_admin()) with check (public.is_evidence_admin());

-- ---------------------------------------------------------------------------
-- Read API: get_evidence(evidence_id)
-- SECURITY DEFINER so the public gets a single controlled shape; enforces
-- "published only" internally, and OMITS every field that does not exist
-- (jsonb_strip_nulls + null-if-empty arrays). Never fabricates.
-- ---------------------------------------------------------------------------
create or replace function public.get_evidence(p_evidence_id text)
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
  select * into t from public.evidence_tools where evidence_id = p_evidence_id;
  if not found then
    return null;                                   -- unknown id
  end if;

  v_public := t.publication_status = 'published'
           or (t.publication_status = 'under_revision' and t.under_revision_prior_state = 'available');

  if not v_public then
    -- expose lifecycle only; never unreviewed content
    return jsonb_build_object(
      'evidence_id',        t.evidence_id,
      'type',               t.type,
      'title',              t.title,
      'publication_status', t.publication_status,
      'review_type',        'none'
    );
  end if;

  -- the tool's current, published review (if any)
  select * into r
    from public.evidence_reviews
   where id = t.current_review_id and review_status = 'published';

  -- sources (each element strips its own nulls); null when there are none
  select jsonb_agg(
           jsonb_strip_nulls(jsonb_build_object(
             'name',           s.name,
             'citation',       s.citation,
             'version',        s.version,
             'publication_date', s.source_date,
             'url',            s.url
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

-- End of Phase 1 migration.
