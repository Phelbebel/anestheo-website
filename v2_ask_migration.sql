-- ============================================================
-- Anestheo /v2 — Ask Anesthesiologist: two-way communication
-- Run in Supabase SQL Editor.
-- Safe to re-run (uses IF NOT EXISTS / idempotent policies).
-- ============================================================

-- ── 1. QUESTIONS TABLE ──────────────────────────────────────
-- The original lightweight `questions` table (name/role/topic/question/email)
-- may already exist from the contact form. This migration evolves it into a
-- real portal table. New columns are added non-destructively.

create table if not exists public.questions (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid references auth.users(id) on delete set null,
  subject     text,
  message     text,
  status      text not null default 'new',   -- new | under_review | answered | closed
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Add columns if upgrading an older questions table
alter table public.questions add column if not exists patient_id uuid references auth.users(id) on delete set null;
alter table public.questions add column if not exists subject    text;
alter table public.questions add column if not exists message    text;
alter table public.questions add column if not exists status     text default 'new';
alter table public.questions add column if not exists created_at timestamptz default now();
alter table public.questions add column if not exists updated_at timestamptz default now();

-- Constrain status to known values (drop first so re-runs don't error)
alter table public.questions drop constraint if exists questions_status_check;
alter table public.questions add  constraint questions_status_check
  check (status in ('new','under_review','answered','closed'));

-- ── 2. QUESTION REPLIES TABLE ───────────────────────────────
create table if not exists public.question_replies (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.questions(id) on delete cascade,
  author_id    uuid references auth.users(id) on delete set null,
  author_role  text,                          -- patient | doctor | admin
  message      text not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_replies_question on public.question_replies(question_id);
create index if not exists idx_questions_patient on public.questions(patient_id);

-- ── 3. updated_at trigger on questions ──────────────────────
create or replace function public.touch_questions_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists trg_touch_questions on public.questions;
create trigger trg_touch_questions
  before update on public.questions
  for each row execute function public.touch_questions_updated_at();

-- ── 4. ROW LEVEL SECURITY ───────────────────────────────────
alter table public.questions        enable row level security;
alter table public.question_replies enable row level security;

-- Helper: is the current user staff (doctor or admin)?
-- Uses the profiles table (id, role, is_admin) created in earlier migrations.

-- QUESTIONS policies -----------------------------------------
-- Patients can insert their own questions
drop policy if exists q_insert_own on public.questions;
create policy q_insert_own on public.questions
  for insert with check ( auth.uid() = patient_id );

-- Patients can read their own; staff can read all
drop policy if exists q_select_own_or_staff on public.questions;
create policy q_select_own_or_staff on public.questions
  for select using (
    auth.uid() = patient_id
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_admin = true or p.role in ('doctor','admin'))
    )
  );

-- Staff can update status (and any field); patients cannot update after submit
drop policy if exists q_update_staff on public.questions;
create policy q_update_staff on public.questions
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_admin = true or p.role in ('doctor','admin'))
    )
  );

-- REPLIES policies -------------------------------------------
-- Read replies if you own the parent question or you are staff
drop policy if exists r_select_own_or_staff on public.question_replies;
create policy r_select_own_or_staff on public.question_replies
  for select using (
    exists (
      select 1 from public.questions q
      where q.id = question_replies.question_id
        and (
          q.patient_id = auth.uid()
          or exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and (p.is_admin = true or p.role in ('doctor','admin'))
          )
        )
    )
  );

-- Insert a reply: patient on own question, or staff on any
drop policy if exists r_insert_participant on public.question_replies;
create policy r_insert_participant on public.question_replies
  for insert with check (
    author_id = auth.uid()
    and (
      exists (
        select 1 from public.questions q
        where q.id = question_replies.question_id
          and q.patient_id = auth.uid()
      )
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and (p.is_admin = true or p.role in ('doctor','admin'))
      )
    )
  );

-- ============================================================
-- Done. Tables: questions (with status), question_replies.
-- The UI for replies/status will be built in a dedicated pass.
-- ============================================================
