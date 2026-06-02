-- ============================================================
-- ANESTHEO V2 — pre-operative preparation tables
-- Run in Supabase SQL Editor
-- ============================================================

-- ── PRE-OP QUESTIONNAIRES ─────────────────────────────────────
create table if not exists preop_questionnaires (
  id              uuid default gen_random_uuid() primary key,
  patient_id      uuid references auth.users(id) on delete cascade not null,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),

  -- workflow
  status          text default 'in_progress',  -- in_progress | submitted
  current_step    int  default 1,
  completion      int  default 0,               -- 0-100 percentage

  -- answers (one JSON blob keeps it simple + expandable)
  answers         jsonb default '{}'::jsonb,

  -- computed risk flags (frontend writes these on submit)
  risk_flags      jsonb default '[]'::jsonb,

  -- one questionnaire per patient (upsert target)
  unique (patient_id)
);

alter table preop_questionnaires enable row level security;

drop policy if exists "preop_select_own"  on preop_questionnaires;
drop policy if exists "preop_insert_own"  on preop_questionnaires;
drop policy if exists "preop_update_own"  on preop_questionnaires;
drop policy if exists "preop_doctor_read" on preop_questionnaires;

-- Patients manage their own
create policy "preop_select_own" on preop_questionnaires for select using (auth.uid() = patient_id);
create policy "preop_insert_own" on preop_questionnaires for insert with check (auth.uid() = patient_id);
create policy "preop_update_own" on preop_questionnaires for update using (auth.uid() = patient_id);

-- Doctors and admins can read all submitted questionnaires
create policy "preop_doctor_read" on preop_questionnaires for select using (
  exists (
    select 1 from profiles
    where profiles.id = auth.uid()
      and (profiles.role in ('doctor','admin') or profiles.is_admin = true)
  )
);

-- ── PREP CHECKLIST PROGRESS ───────────────────────────────────
create table if not exists preop_checklist (
  id          uuid default gen_random_uuid() primary key,
  patient_id  uuid references auth.users(id) on delete cascade not null,
  updated_at  timestamptz default now(),
  items       jsonb default '{}'::jsonb,   -- { "fasting": true, "meds": false, ... }
  unique (patient_id)
);

alter table preop_checklist enable row level security;

drop policy if exists "checklist_select_own" on preop_checklist;
drop policy if exists "checklist_insert_own" on preop_checklist;
drop policy if exists "checklist_update_own" on preop_checklist;
drop policy if exists "checklist_doctor_read" on preop_checklist;

create policy "checklist_select_own" on preop_checklist for select using (auth.uid() = patient_id);
create policy "checklist_insert_own" on preop_checklist for insert with check (auth.uid() = patient_id);
create policy "checklist_update_own" on preop_checklist for update using (auth.uid() = patient_id);
create policy "checklist_doctor_read" on preop_checklist for select using (
  exists (
    select 1 from profiles
    where profiles.id = auth.uid()
      and (profiles.role in ('doctor','admin') or profiles.is_admin = true)
  )
);
