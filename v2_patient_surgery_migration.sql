-- ============================================================
-- Anestheo /v2 — Patient Dashboard 2.0 foundation
-- Tables: patient_surgeries, video_progress
-- Run in Supabase SQL Editor. Idempotent and non-destructive.
-- ============================================================

-- ── 1. PATIENT SURGERIES ────────────────────────────────────
-- One upcoming surgery record per patient (patient_id unique → simple upsert).
create table if not exists public.patient_surgeries (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references auth.users(id) on delete cascade,
  procedure_type  text,
  surgery_date    date,
  hospital        text,
  surgeon         text,
  anesthesia_type text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (patient_id)
);

-- ── 2. VIDEO PROGRESS ───────────────────────────────────────
create table if not exists public.video_progress (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references auth.users(id) on delete cascade,
  video_id        text not null,
  watched_percent int  not null default 0,
  completed       boolean not null default false,
  last_viewed_at  timestamptz not null default now(),
  unique (patient_id, video_id)
);

create index if not exists idx_video_progress_patient on public.video_progress(patient_id);

-- ── 3. updated_at trigger for patient_surgeries ─────────────
create or replace function public.touch_patient_surgeries_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists trg_touch_patient_surgeries on public.patient_surgeries;
create trigger trg_touch_patient_surgeries
  before update on public.patient_surgeries
  for each row execute function public.touch_patient_surgeries_updated_at();

-- ── 4. ROW LEVEL SECURITY ───────────────────────────────────
alter table public.patient_surgeries enable row level security;
alter table public.video_progress    enable row level security;

-- patient_surgeries: patient manages own; staff can read all
drop policy if exists ps_select on public.patient_surgeries;
create policy ps_select on public.patient_surgeries
  for select using (
    auth.uid() = patient_id
    or exists (select 1 from public.profiles p
               where p.id = auth.uid()
                 and (p.is_admin = true or p.role in ('doctor','admin')))
  );

drop policy if exists ps_insert on public.patient_surgeries;
create policy ps_insert on public.patient_surgeries
  for insert with check ( auth.uid() = patient_id );

drop policy if exists ps_update on public.patient_surgeries;
create policy ps_update on public.patient_surgeries
  for update using ( auth.uid() = patient_id );

-- video_progress: patient manages own
drop policy if exists vp_select on public.video_progress;
create policy vp_select on public.video_progress
  for select using ( auth.uid() = patient_id );

drop policy if exists vp_insert on public.video_progress;
create policy vp_insert on public.video_progress
  for insert with check ( auth.uid() = patient_id );

drop policy if exists vp_update on public.video_progress;
create policy vp_update on public.video_progress
  for update using ( auth.uid() = patient_id );

-- ============================================================
-- Done. The Patient Dashboard reads these tables and degrades
-- gracefully (shows empty/prompt states) if data is absent.
-- ============================================================
