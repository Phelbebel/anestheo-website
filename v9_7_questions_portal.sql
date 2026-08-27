-- ============================================================================
-- v9_7_questions_portal.sql — Ask the Anesthesiologist, on production truth
--
-- NOT APPLIED. Review first.
--
-- WHY THIS FILE EXISTS AND v2_ask_migration.sql DOES NOT DO THE JOB
-- -----------------------------------------------------------------
-- v2_ask_migration.sql describes a portal table that production never got.
-- A direct read of the live database found public.questions holding ONLY the
-- original contact-form shape:
--
--     id, created_at, name, role, topic, question NOT NULL, email,
--     is_answered, is_published, deleted_at, deleted_by, delete_reason
--
-- and no patient_id, subject, message, status or updated_at.
-- public.question_replies DOES NOT EXIST. Row count is 0, so nothing needs
-- backfilling and no user data is at risk in either direction.
--
-- Applying v2 as written would fail or mislead on three counts:
--   1. it assumes `question` is nullable; production has it NOT NULL, so a
--      canonical insert that writes `message` and leaves `question` empty is
--      rejected by the column, not by any policy;
--   2. it adds its own policies without removing the broad ones production
--      already carries, and PERMISSIVE policies OR together — one open policy
--      makes every careful one beside it decorative;
--   3. it was written before is_verified_doctor() and is_platform_admin()
--      existed, so its staff test is an inline profiles lookup that admits an
--      UNVERIFIED doctor to the patient-question inbox.
--
-- THE SECURITY HOLE THIS CLOSES
-- -----------------------------
-- Production currently has, on public.questions:
--
--     "Allow insert questions"  INSERT WITH CHECK (true)
--     "Allow select questions"  SELECT USING     (true)
--     "Allow update questions"  UPDATE USING     (true)
--     "questions_require_verified" RESTRICTIVE ALL USING (NOT is_pending_doctor())
--
-- and the anon role holds SELECT, INSERT, UPDATE and DELETE on the table.
--
-- The restrictive policy does not rescue this. is_pending_doctor() is
-- EXISTS(profile WHERE id = auth.uid()); for anon auth.uid() is NULL, the
-- EXISTS is false, and NOT false is TRUE. It removes pending doctors, which
-- is what it was written for, and it admits everybody else — including a
-- visitor with no session at all. Combined with the three `true` policies and
-- the anon grants, an anonymous caller can today read, write and modify every
-- row in the table. The table is empty, so nothing has leaked; the door is
-- nonetheless open and this file shuts it.
--
-- WHAT THIS FILE DOES NOT DO
-- --------------------------
--   * does not drop a single legacy column. name/role/topic/question/email/
--     is_answered/is_published stay exactly where they are. Dropping them is a
--     separate decision once nothing reads them.
--   * does not touch v9_5's questions_require_verified. That policy is
--     correct for what it does and is left in place, now beside PERMISSIVE
--     policies narrow enough for it to matter.
--   * does not re-implement verification. is_verified_doctor() and
--     is_platform_admin() are the canonical predicates and are called, not
--     copied.
--   * writes no data.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ── 0 · PREFLIGHT ───────────────────────────────────────────────────────────
-- Refuse rather than half-apply. Every predicate this file leans on must
-- already exist, and the table it rebuilds must be the one that was audited.
do $preflight$
declare
  v_missing text[] := '{}';
  v_rows    bigint;
begin
  if to_regclass('public.questions') is null then
    raise exception 'public.questions does not exist — wrong database?';
  end if;
  if to_regproc('public.is_verified_doctor') is null then
    v_missing := v_missing || 'is_verified_doctor() [v2_auth_onboarding.sql]'::text; end if;
  if to_regproc('public.is_platform_admin') is null then
    v_missing := v_missing || 'is_platform_admin() [v2_admin_phase0.sql]'::text; end if;
  if to_regproc('public.is_pending_doctor') is null then
    v_missing := v_missing || 'is_pending_doctor() [v2_auth_onboarding.sql]'::text; end if;
  if array_length(v_missing, 1) is not null then
    raise exception 'v9_7 preflight failed — missing: %', array_to_string(v_missing, ', ');
  end if;

  /* The audit that justified this file found an empty table. If that is no
     longer true, the person applying it should know before, not after: the
     legacy rows carry no patient_id, so they will be invisible to every
     policy below and will need a deliberate decision. */
  execute 'select count(*) from public.questions' into v_rows;
  if v_rows > 0 then
    raise warning 'v9_7: public.questions holds % row(s). They have no patient_id and will be readable only by staff. Decide what to do with them.', v_rows;
  end if;
end
$preflight$;

-- ── 1 · CANONICAL COLUMNS, ALONGSIDE THE LEGACY ONES ────────────────────────
alter table public.questions add column if not exists patient_id uuid references auth.users(id) on delete set null;
alter table public.questions add column if not exists subject    text;
alter table public.questions add column if not exists message    text;
alter table public.questions add column if not exists status     text default 'new';
alter table public.questions add column if not exists updated_at timestamptz default now();

/* STATUS IS NOT NULLABLE, and production having zero rows is what makes this
   safe to say now rather than later. An earlier draft wrote
   `check (status is null or status in (...))`, which permitted NULL for the
   benefit of legacy rows that do not exist. A nullable status means every
   reader has to write `status || 'new'` forever and one that forgets shows a
   question in no state at all.

   Backfilled first so the SET NOT NULL cannot fail on a row added between the
   audit and the apply. */
update public.questions set status = 'new' where status is null;
alter table public.questions alter column status set default 'new';
alter table public.questions alter column status set not null;

-- Status is a closed set, and NULL is no longer one of its members.
alter table public.questions drop constraint if exists questions_status_check;
alter table public.questions add  constraint questions_status_check
  check (status in ('new','under_review','answered','closed'));

/* WHAT A PATIENT QUESTION HAS TO CONTAIN, enforced at the boundary rather
   than in JavaScript. The form validates too, but a form is a courtesy: the
   API is reachable directly with a token, and "subject and message are real
   text of a sane size" is a property of the data, not of the page.

   The upper bounds are deliberately generous for a person describing a
   worry, and deliberately finite so a direct caller cannot post a megabyte.
   They apply to every row, not only to patient inserts, so a clinician
   cannot widen them by editing through some other path either. */
alter table public.questions drop constraint if exists questions_content_check;
alter table public.questions add  constraint questions_content_check
  check (
    patient_id is null            -- legacy contact-form rows are exempt
    or (
      subject is not null and btrim(subject) <> '' and char_length(subject) <= 200
      and message is not null and btrim(message) <> '' and char_length(message) <= 5000
    )
  );

/* THE LEGACY `question` COLUMN LOSES ITS NOT NULL, and this is the line that
   makes the whole thing work. A canonical insert writes message and leaves
   question empty. With NOT NULL still on it, that insert fails on the column
   before any policy is consulted — and the only ways around it are to write a
   fake legacy value or to drop the column, one dishonest and the other
   premature. Making it nullable costs nothing: no row depends on it, and the
   column keeps its data for whatever still reads it. */
alter table public.questions alter column question drop not null;

-- Same reasoning for anything else the old form insisted on.
do $legacy$
declare r record;
begin
  for r in
    select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'questions'
       and column_name in ('name','role','topic','email')
       and is_nullable = 'NO'
  loop
    execute format('alter table public.questions alter column %I drop not null', r.column_name);
    raise notice 'v9_7: dropped NOT NULL from legacy column %', r.column_name;
  end loop;
end
$legacy$;

create index if not exists idx_questions_patient on public.questions(patient_id);
create index if not exists idx_questions_status  on public.questions(status);

-- ── 2 · QUESTION REPLIES ────────────────────────────────────────────────────
-- Production has no such table. This creates it.
create table if not exists public.question_replies (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  author_role text,
  message     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_replies_question on public.question_replies(question_id);

-- ── 3 · updated_at ──────────────────────────────────────────────────────────
create or replace function public.touch_questions_updated_at()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end
$$;
drop trigger if exists trg_questions_updated_at on public.questions;
create trigger trg_questions_updated_at
  before update on public.questions
  for each row execute function public.touch_questions_updated_at();

-- ── 4 · RLS ─────────────────────────────────────────────────────────────────
alter table public.questions        enable row level security;
alter table public.question_replies enable row level security;

/* THE THREE OPEN DOORS, REMOVED BY NAME.

   Dropping these is the point of the file. PERMISSIVE policies are OR'd, so
   for as long as "Allow select questions USING (true)" exists, every careful
   policy written beside it is decoration. They are dropped explicitly rather
   than by a pattern sweep, so that applying this file cannot quietly remove
   something nobody meant to remove. */
drop policy if exists "Allow insert questions" on public.questions;
drop policy if exists "Allow select questions" on public.questions;
drop policy if exists "Allow update questions" on public.questions;

-- Any earlier attempt at the portal model, so a re-run is clean.
drop policy if exists q_insert_own            on public.questions;
drop policy if exists q_select_own_or_staff   on public.questions;
drop policy if exists q_update_staff          on public.questions;
drop policy if exists q_select_own            on public.questions;
drop policy if exists q_select_clinician      on public.questions;
drop policy if exists q_update_clinician      on public.questions;
drop policy if exists r_select_own_or_staff   on public.question_replies;
drop policy if exists r_insert_participant    on public.question_replies;
drop policy if exists r_select_participant    on public.question_replies;
drop policy if exists r_insert_clinician      on public.question_replies;
drop policy if exists r_insert_patient        on public.question_replies;

/* ── QUESTIONS ────────────────────────────────────────────────────────────
   A PATIENT OWNS THEIR QUESTION. Two conditions, not one:

     patient_id = auth.uid()   the row is theirs, and cannot be forged for
                               somebody else — WITH CHECK is evaluated against
                               the row being written, so patient_id = <other
                               user> fails here and not in the application.

     the caller is a patient   role = 'patient' on their own profile row. A
                               doctor account has the clinician surfaces and a
                               roleless account has not finished onboarding;
                               neither should be creating rows in the patient
                               question queue. This is written inline rather
                               than as a fifth helper: it is one EXISTS, used
                               in one policy, and a new SECURITY DEFINER
                               function is a new thing to audit forever. */
create policy q_insert_patient on public.questions
  for insert to authenticated
  with check (
    patient_id = auth.uid()
    and status = 'new'
    and subject is not null and btrim(subject) <> '' and char_length(subject) <= 200
    and message is not null and btrim(message) <> '' and char_length(message) <= 5000
    and exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.role = 'patient'
    )
  );

-- A patient reads their own, and nothing else. No staff clause here: the
-- clinician read is its own policy so each can be reasoned about alone.
create policy q_select_own on public.questions
  for select to authenticated
  using ( patient_id = auth.uid() );

/* THE CLINICIAN INBOX IS FOR VERIFIED CLINICIANS. is_verified_doctor() is
   role='doctor' AND verification_status='approved'; is_platform_admin() is the
   server-side admin predicate. An unverified doctor satisfies neither and is
   additionally removed by v9_5's RESTRICTIVE questions_require_verified — two
   independent reasons, which is how it should be for patient data. */
create policy q_select_clinician on public.questions
  for select to authenticated
  using ( public.is_verified_doctor() or public.is_platform_admin() );

-- Status moves; the patient's words do not. A patient cannot update at all:
-- there is no UPDATE policy admitting them, and a missing policy is a denial.
create policy q_update_clinician on public.questions
  for update to authenticated
  using      ( public.is_verified_doctor() or public.is_platform_admin() )
  with check ( public.is_verified_doctor() or public.is_platform_admin() );

/* ── REPLIES ──────────────────────────────────────────────────────────────
   Reads follow the parent question: you may read a reply if you may read the
   thing it is attached to. */
create policy r_select_participant on public.question_replies
  for select to authenticated
  using (
    public.is_verified_doctor() or public.is_platform_admin()
    or exists (
      select 1 from public.questions q
       where q.id = question_replies.question_id
         and q.patient_id = auth.uid()
    )
  );

-- A clinician replies to anything in the inbox. author_id is pinned to the
-- caller so a reply cannot be attributed to another clinician.
create policy r_insert_clinician on public.question_replies
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and (
      ( public.is_verified_doctor() and author_role = 'doctor' )
      or
      ( public.is_platform_admin()  and author_role = 'admin'  )
    )
  );

/* NO PATIENT REPLY POLICY IN THIS RELEASE, and its absence is deliberate.
   An earlier draft granted patients INSERT on question_replies so they could
   continue a thread. Nothing in the patient product does that: My Space's
   "Continue conversation" opened /ask.html, which starts a NEW question. A
   permission with no caller is a permission nobody is watching, so it is not
   shipped. Patients create questions and read the answers; thread
   continuation becomes a feature when there is a UI that means it. */

/* v9_5's RESTRICTIVE gate, re-asserted on the new table so the two agree.
   RESTRICTIVE policies AND with everything else, so this can only ever remove
   access — it never grants. It is what keeps an unverified doctor out even if
   a future PERMISSIVE policy is written carelessly. */
drop policy if exists replies_require_verified on public.question_replies;
create policy replies_require_verified on public.question_replies
  as restrictive for all to authenticated
  using      ( not public.is_pending_doctor() )
  with check ( not public.is_pending_doctor() );

-- ── 5 · SENDER LABELS FOR THE CLINICIAN INBOX ──────────────────────────────
/* THE INBOX NEEDS A NAME, AND profiles WILL NOT GIVE IT ONE.

   questions.html resolved the sender by selecting id/full_name/email straight
   from public.profiles. In production that returns nothing for an ordinary
   verified doctor: profiles RLS lets a user read their own row, and platform
   admins read others. A doctor is not automatically an admin, so the inbox
   would have shown "Patient account" for every row — or, worse, tempted
   somebody to widen profiles RLS and expose every patient profile to every
   clinician in order to print a name.

   So the name comes through a keyhole instead. This function is the ONLY way
   the inbox learns who sent a question, and it is deliberately poor at
   everything else:

     * it returns two columns. No email, no phone, no date of birth, no
       address, no verification state, no role, no is_admin. A caller who
       wants those must find another door, and there isn't one.
     * it returns only patients who actually own a question. It cannot be used
       to enumerate the user table, or to test whether a given person has an
       account.
     * it authorises itself. SECURITY DEFINER bypasses RLS, so the check is
       inside: verified doctor or platform admin, and nobody else. A pending
       doctor gets an exception, not an empty set — silence would read as
       "no patients" rather than "not for you".
     * it takes no arguments, so there is no id to probe with.

   full_name may be empty. The label is then the empty string and the UI says
   "Patient account" — there is no fallback to the email or to any part of it,
   because a local part identifies a person as readily as the whole address
   and this function exists precisely to return no contact detail. */
create or replace function public.get_question_sender_labels()
returns table (patient_id uuid, label text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.is_verified_doctor() or public.is_platform_admin()) then
    raise exception 'Not authorised to read patient question senders'
      using errcode = '42501';
  end if;

  /* THE EMAIL IS NOT A NAME, AND IS NOT RETURNED IN ANY FORM.
     An earlier draft fell back to split_part(email, '@', 1) when full_name was
     blank. That is still the email — a local part identifies a person as
     readily as the whole address, and this function's entire justification is
     that it returns no contact detail. Blank name, blank label; the inbox
     already renders "Patient account" for an empty one. */
  return query
    select p.id, coalesce(nullif(btrim(p.full_name), ''), '')::text
      from public.profiles p
     where p.role = 'patient'
       and exists (
         select 1 from public.questions q
          where q.patient_id = p.id
            and q.deleted_at is null
       );
end
$$;

revoke all on function public.get_question_sender_labels() from public, anon;
grant execute on function public.get_question_sender_labels() to authenticated;

-- ── 6 · GRANTS ──────────────────────────────────────────────────────────────
/* THE PUBLIC ASK PAGE NEEDS NO DATABASE ACCESS AT ALL. Its hero, its topics
   and its ten answers are static text in ask.html. Nothing anonymous reads or
   writes these tables, so anon holds nothing on them — belt as well as braces,
   because a policy protects rows and a grant protects the table. */
revoke all on public.questions        from anon;
revoke all on public.question_replies from anon;

/* COLUMN-LEVEL, BECAUSE RLS LIMITS ROWS AND NOT COLUMNS.

   The earlier draft granted SELECT, INSERT, UPDATE on the whole table. The
   stated invariant is that a clinician moves the STATUS and never the
   patient's words — but q_update_clinician passes for any row a clinician can
   see, and with table-wide UPDATE that clinician could rewrite message,
   subject, or patient_id itself and the policy would not object. A policy
   cannot express "only this column". A grant can, so the grant is where the
   invariant lives.

   status is NOT insertable. It is not in the INSERT column list at all, so a
   patient cannot submit a question pre-marked 'answered' — the column takes
   its DEFAULT 'new'. q_insert_patient also checks status = 'new', which is
   redundant today and is the thing that still holds if this grant is ever
   widened. Two locks, one door.

   Legacy columns are absent from both lists: nothing may write name, topic,
   question or email from a client again. */
revoke all on public.questions from authenticated;
grant select on public.questions to authenticated;
grant insert (patient_id, subject, message) on public.questions to authenticated;
grant update (status)                       on public.questions to authenticated;

/* Same reasoning for replies. created_at is server-owned and absent from the
   list, so a caller cannot backdate a reply; id and the rest default. */
revoke all on public.question_replies from authenticated;
grant select on public.question_replies to authenticated;
grant insert (question_id, author_id, author_role, message)
  on public.question_replies to authenticated;

/* No UPDATE and no DELETE for anybody, on either table. A reply is a record of
   what was said, not a draft. Soft delete (deleted_at) and the admin purge
   run through admin_record_action() and the existing SECURITY DEFINER tooling,
   which is why deleted_at/deleted_by/delete_reason are not granted here — a
   direct client UPDATE on them would be a second, unaudited delete path. */
revoke update, delete on public.question_replies from anon, authenticated;
revoke delete         on public.questions        from anon, authenticated;

commit;

-- ============================================================================
-- VERIFY (read-only; run after applying)
-- ============================================================================
-- select policyname, permissive, roles, cmd, qual, with_check
--   from pg_policies where schemaname='public' and tablename in ('questions','question_replies')
--  order by tablename, policyname;
--
-- -- COLUMN-level grants, which is where the least-privilege claim lives:
-- select table_name, grantee, privilege_type, column_name
--   from information_schema.column_privileges
--  where table_schema='public' and table_name in ('questions','question_replies')
--    and grantee in ('anon','authenticated')
--  order by table_name, grantee, privilege_type, column_name;
--
-- -- and the table-level ones, which should show SELECT and nothing else:
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema='public' and table_name in ('questions','question_replies')
--    and grantee in ('anon','authenticated') order by grantee, privilege_type;
--
-- Expected:
--   * no policy named "Allow % questions";
--   * anon appears in NEITHER result set;
--   * authenticated holds table-level SELECT only;
--   * authenticated holds INSERT on questions(patient_id, subject, message)
--     and UPDATE on questions(status) — nothing else, and NOT status on insert;
--   * authenticated holds INSERT on question_replies(question_id, author_id,
--     author_role, message) and no UPDATE or DELETE anywhere.
--
-- select has_function_privilege('anon', 'public.get_question_sender_labels()', 'execute');
--   -> expected false
--
-- ROLLBACK
-- --------
-- The dropped policies were USING(true)/WITH CHECK(true) and are trivially
-- recreatable, but restoring them re-opens the table to anon. If this must be
-- reverted, prefer reverting the FRONTEND and leaving the policies closed.
-- ============================================================================
