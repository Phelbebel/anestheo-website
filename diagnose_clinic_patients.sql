-- ============================================================
-- DIAGNOSTIC — run in Supabase SQL Editor to inspect the table.
-- Answers: does the table exist, which columns, NOT NULL cols,
-- and which RLS policies are active for INSERT.
-- ============================================================

-- 3 & 4. Table exists? Which columns + nullability + defaults?
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'clinic_patients'
order by ordinal_position;

-- Specifically: any NOT NULL column WITHOUT a default will block inserts
-- if the app doesn't send it (common cause: an old 'name' column left over).
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'clinic_patients'
  and is_nullable = 'NO' and column_default is null;

-- 5. RLS enabled? Which policies exist (esp. INSERT)?
select relname, relrowsecurity
from pg_class where relname = 'clinic_patients';

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'clinic_patients';

-- ============================================================
-- If the second query returns a row like 'name' (an old V4 column),
-- that's the insert failure. Fix by either:
--   alter table public.clinic_patients alter column name drop not null;
-- or drop the leftover column:
--   alter table public.clinic_patients drop column if exists name;
-- (Repeat for any other unexpected NOT-NULL-without-default column,
--  e.g. an old 'phone' or 'visit_status'.)
-- ============================================================
