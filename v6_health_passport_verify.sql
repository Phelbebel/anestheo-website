-- v6_health_passport_verify.sql
-- POST-MIGRATION VERIFIER for the Anestheo Health Passport.
--
-- HOW TO RUN
-- Paste the whole file into the Supabase SQL Editor and run it. It is ONE
-- statement, so the Results grid shows every check and a summary row.
--
-- WHAT IT DOES
-- Reads system catalogues. Nothing else. It creates nothing, changes nothing,
-- and touches no patient row — there is no INSERT, UPDATE, DELETE, CREATE,
-- ALTER, GRANT or REVOKE anywhere in it, and no temporary table or helper
-- function, so it is safe to run against production at any time and as often
-- as you like.
--
-- WHAT TO EXPECT
-- The last row reads ALL PASS. Any other value means do not deploy the
-- frontend yet: read the failing rows, which name what is wrong.
--
-- WHY IT IS WORTH RUNNING
-- The migration is idempotent and was proved on a fresh database, on an
-- upgraded one, and on a re-run. This confirms the database you actually own
-- ended up in that state, rather than assuming it.

WITH
/* ── what the schema is supposed to contain ──────────────────────────────
   Written out longhand rather than counted, so that something appearing or
   disappearing shows up by name instead of shifting a tally. */
want_tbl(tbl) AS (VALUES
  ('health_passports'), ('health_passport_items'), ('health_passport_contacts'),
  ('health_passport_tokens'), ('health_passport_access_log'),
  ('health_passport_consents')),

want_col(tbl, col) AS (VALUES
  ('health_passports','id'), ('health_passports','patient_id'),
  ('health_passports','status'), ('health_passports','emergency_view_enabled'),
  ('health_passports','show_name_on_qr'), ('health_passports','created_at'),
  ('health_passports','updated_at'),
  ('health_passport_items','id'), ('health_passport_items','passport_id'),
  ('health_passport_items','category'), ('health_passport_items','label'),
  ('health_passport_items','value_text'), ('health_passport_items','severity'),
  ('health_passport_items','priority'), ('health_passport_items','source_type'),
  ('health_passport_items','source_record_id'), ('health_passport_items','reported_by'),
  ('health_passport_items','verified_by'), ('health_passport_items','verified_at'),
  ('health_passport_items','verification_lost_at'),
  ('health_passport_items','is_emergency_visible'),
  ('health_passport_items','created_at'), ('health_passport_items','updated_at'),
  ('health_passport_items','deleted_at'),
  ('health_passport_contacts','id'), ('health_passport_contacts','passport_id'),
  ('health_passport_contacts','name'), ('health_passport_contacts','relationship'),
  ('health_passport_contacts','phone'), ('health_passport_contacts','is_primary'),
  ('health_passport_contacts','is_emergency_visible'),
  ('health_passport_contacts','created_at'), ('health_passport_contacts','updated_at'),
  ('health_passport_contacts','deleted_at'),
  ('health_passport_tokens','id'), ('health_passport_tokens','passport_id'),
  ('health_passport_tokens','token_hash'), ('health_passport_tokens','token_prefix'),
  ('health_passport_tokens','scope'), ('health_passport_tokens','created_at'),
  ('health_passport_tokens','expires_at'), ('health_passport_tokens','revoked_at'),
  ('health_passport_tokens','last_used_at'),
  ('health_passport_access_log','id'), ('health_passport_access_log','passport_id'),
  ('health_passport_access_log','token_id'), ('health_passport_access_log','accessed_at'),
  ('health_passport_access_log','outcome'),
  ('health_passport_consents','id'), ('health_passport_consents','passport_id'),
  ('health_passport_consents','patient_id'), ('health_passport_consents','consent_version'),
  ('health_passport_consents','granted_at'), ('health_passport_consents','categories'),
  ('health_passport_consents','item_count'), ('health_passport_consents','contact_count'),
  ('health_passport_consents','name_shared')),

want_fn(fn) AS (VALUES
  ('hp_resolve_passport'), ('hp_rotate_token'), ('hp_disable_token'),
  ('hp_token_status'), ('hp_verify_item'), ('hp_access_history'),
  ('hp_owns'), ('hp_clinician_may_read'), ('hp_hash_token'),
  ('hp_guard_item_provenance')),

-- exactly one function is public-facing
want_anon_fn(fn) AS (VALUES ('hp_resolve_passport')),

-- and these are the ones a signed-in user may call
want_auth_fn(fn) AS (VALUES
  ('hp_resolve_passport'), ('hp_rotate_token'), ('hp_disable_token'),
  ('hp_token_status'), ('hp_verify_item'), ('hp_access_history'),
  ('hp_owns'), ('hp_clinician_may_read')),

want_pol(tbl, pol) AS (VALUES
  ('health_passports','hp_select'), ('health_passports','hp_insert'),
  ('health_passports','hp_update'), ('health_passports','hp_delete'),
  ('health_passport_items','hp_item_select'), ('health_passport_items','hp_item_insert'),
  ('health_passport_items','hp_item_update'), ('health_passport_items','hp_item_delete'),
  ('health_passport_contacts','hp_contact_select'),
  ('health_passport_contacts','hp_contact_write')),

want_chk(con) AS (VALUES
  ('hp_status_chk'), ('hp_item_category_chk'), ('hp_item_source_chk'),
  ('hp_item_severity_chk'), ('hp_item_verified_chk'), ('hp_item_text_len_chk'),
  ('hp_token_scope_chk')),

/* ── what the database actually contains ─────────────────────────────── */
have_tbl AS (
  SELECT c.oid, c.relname::text AS tbl, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
         c.relacl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND c.relname IN (SELECT tbl FROM want_tbl)),

have_col AS (
  SELECT table_name::text AS tbl, column_name::text AS col, column_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name IN (SELECT tbl FROM want_tbl)),

/* Grants read from the ACL on the table itself rather than from
   information_schema, which only reports grants the querying role can see. */
have_grant AS (
  SELECT t.tbl, a.grantee::regrole::text AS grantee, a.privilege_type
    FROM have_tbl t, aclexplode(t.relacl) a),

have_fn AS (
  SELECT p.oid, p.proname::text AS fn, p.prosecdef AS sec_def,
         EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) cfg
                  WHERE cfg LIKE 'search_path=%') AS pinned
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'hp\_%'),

/* The roles may legitimately be absent on a non-Supabase database, and asking
   has_function_privilege about a role that does not exist raises an error
   rather than returning false. */
roles AS (SELECT to_regrole('anon') AS anon, to_regrole('authenticated') AS auth),

fn_exec AS (
  SELECT f.fn, f.sec_def, f.pinned,
         CASE WHEN r.anon IS NULL THEN NULL
              ELSE has_function_privilege('anon', f.oid, 'EXECUTE') END AS anon_exec,
         CASE WHEN r.auth IS NULL THEN NULL
              ELSE has_function_privilege('authenticated', f.oid, 'EXECUTE') END AS auth_exec
    FROM have_fn f CROSS JOIN roles r),

have_pol AS (
  SELECT tablename::text AS tbl, policyname::text AS pol, with_check
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN (SELECT tbl FROM want_tbl)),

have_chk AS (SELECT conname::text AS con FROM pg_constraint WHERE contype = 'c'),

/* ── the checks ──────────────────────────────────────────────────────── */
checks(ord, name, pass, detail) AS (

  SELECT 1, 'all six health_passport_* tables exist',
         (SELECT count(*) FROM have_tbl) = 6,
         COALESCE((SELECT string_agg(w.tbl, ', ' ORDER BY w.tbl) FROM want_tbl w
                    WHERE w.tbl NOT IN (SELECT tbl FROM have_tbl)), 'none missing')

  UNION ALL SELECT 2, 'every required column is present',
         NOT EXISTS (SELECT 1 FROM want_col w
                      WHERE NOT EXISTS (SELECT 1 FROM have_col h
                                         WHERE h.tbl = w.tbl AND h.col = w.col)),
         COALESCE((SELECT string_agg(w.tbl || '.' || w.col, ', ') FROM want_col w
                    WHERE NOT EXISTS (SELECT 1 FROM have_col h
                                       WHERE h.tbl = w.tbl AND h.col = w.col)), 'none missing')

  UNION ALL SELECT 3, 'health_passports.show_name_on_qr defaults to false',
         (SELECT column_default FROM have_col
           WHERE tbl = 'health_passports' AND col = 'show_name_on_qr') = 'false',
         COALESCE((SELECT column_default FROM have_col
                    WHERE tbl = 'health_passports' AND col = 'show_name_on_qr'), '(no such column)')

  UNION ALL SELECT 4, 'health_passport_items.is_emergency_visible defaults to false',
         (SELECT column_default FROM have_col
           WHERE tbl = 'health_passport_items' AND col = 'is_emergency_visible') = 'false',
         COALESCE((SELECT column_default FROM have_col
                    WHERE tbl = 'health_passport_items' AND col = 'is_emergency_visible'), '(no such column)')

  UNION ALL SELECT 5, 'health_passport_contacts.is_emergency_visible defaults to false',
         (SELECT column_default FROM have_col
           WHERE tbl = 'health_passport_contacts' AND col = 'is_emergency_visible') = 'false',
         COALESCE((SELECT column_default FROM have_col
                    WHERE tbl = 'health_passport_contacts' AND col = 'is_emergency_visible'), '(no such column)')

  UNION ALL SELECT 6, 'RLS is ENABLED and FORCED on all six tables',
         (SELECT count(*) FROM have_tbl WHERE rls AND forced) = 6,
         COALESCE((SELECT string_agg(tbl || ' rls=' || rls::text || ' forced=' || forced::text, ', ')
                     FROM have_tbl WHERE NOT (rls AND forced)), 'all six enabled and forced')

  UNION ALL SELECT 7, 'anon has ZERO direct privileges on all six tables',
         NOT EXISTS (SELECT 1 FROM have_grant WHERE grantee = 'anon'),
         COALESCE((SELECT string_agg(DISTINCT tbl || ':' || privilege_type, ', ')
                     FROM have_grant WHERE grantee = 'anon'), 'none')

  UNION ALL SELECT 8, 'authenticated has NO direct privileges on health_passport_tokens',
         NOT EXISTS (SELECT 1 FROM have_grant
                      WHERE grantee = 'authenticated' AND tbl = 'health_passport_tokens'),
         COALESCE((SELECT string_agg(DISTINCT privilege_type, ', ') FROM have_grant
                    WHERE grantee = 'authenticated' AND tbl = 'health_passport_tokens'), 'none')

  UNION ALL SELECT 9, 'authenticated has NO direct privileges on health_passport_access_log',
         NOT EXISTS (SELECT 1 FROM have_grant
                      WHERE grantee = 'authenticated' AND tbl = 'health_passport_access_log'),
         COALESCE((SELECT string_agg(DISTINCT privilege_type, ', ') FROM have_grant
                    WHERE grantee = 'authenticated' AND tbl = 'health_passport_access_log'), 'none')

  /* A consent record the subject can edit is not evidence of anything. */
  UNION ALL SELECT 21, 'authenticated has NO direct privileges on health_passport_consents',
         NOT EXISTS (SELECT 1 FROM have_grant
                      WHERE grantee = 'authenticated' AND tbl = 'health_passport_consents'),
         COALESCE((SELECT string_agg(DISTINCT privilege_type, ', ') FROM have_grant
                    WHERE grantee = 'authenticated' AND tbl = 'health_passport_consents'), 'none')

  /* The record exists to prove consent, not to become a second copy of the
     data it is evidence about. */
  UNION ALL SELECT 22, 'the consent record holds NO medical content',
         NOT EXISTS (SELECT 1 FROM have_col
                      WHERE tbl = 'health_passport_consents'
                        AND col IN ('label','value_text','severity','notes','detail','content')),
         COALESCE((SELECT string_agg(col, ', ' ORDER BY col) FROM have_col
                    WHERE tbl = 'health_passport_consents'), '(table missing)')

  UNION ALL SELECT 23, 'the public projection is capped at 120 characters',
         EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'hp_item_text_len_chk'
                    AND pg_get_constraintdef(oid) LIKE '%120%'),
         COALESCE((SELECT pg_get_constraintdef(oid) FROM pg_constraint
                    WHERE conname = 'hp_item_text_len_chk'), '(constraint missing)')

  UNION ALL SELECT 10, 'authenticated CAN work with passports, items and contacts',
         (SELECT count(DISTINCT tbl) FROM have_grant
           WHERE grantee = 'authenticated'
             AND tbl IN ('health_passports','health_passport_items','health_passport_contacts')
             AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')) = 3,
         COALESCE((SELECT string_agg(DISTINCT tbl, ', ') FROM have_grant
                    WHERE grantee = 'authenticated'
                      AND tbl IN ('health_passports','health_passport_items','health_passport_contacts')),
                  'NONE — the patient page cannot work')

  UNION ALL SELECT 11, 'every expected V6 function exists',
         NOT EXISTS (SELECT 1 FROM want_fn w
                      WHERE w.fn NOT IN (SELECT fn FROM have_fn)),
         COALESCE((SELECT string_agg(w.fn, ', ') FROM want_fn w
                    WHERE w.fn NOT IN (SELECT fn FROM have_fn)), 'none missing')

  UNION ALL SELECT 12, 'every SECURITY DEFINER function pins its search_path',
         NOT EXISTS (SELECT 1 FROM have_fn WHERE sec_def AND NOT pinned),
         COALESCE((SELECT string_agg(fn, ', ') FROM have_fn WHERE sec_def AND NOT pinned),
                  'all definer functions pinned')

  UNION ALL SELECT 13, 'hp_resolve_passport is executable by anon',
         (SELECT anon_exec FROM fn_exec WHERE fn = 'hp_resolve_passport') IS TRUE,
         COALESCE((SELECT CASE WHEN anon_exec IS NULL THEN 'role anon does not exist'
                               ELSE anon_exec::text END
                     FROM fn_exec WHERE fn = 'hp_resolve_passport'), '(function missing)')

  UNION ALL SELECT 14, 'anon can execute NO other Health Passport function',
         NOT EXISTS (SELECT 1 FROM fn_exec
                      WHERE anon_exec IS TRUE AND fn NOT IN (SELECT fn FROM want_anon_fn)),
         COALESCE((SELECT string_agg(fn, ', ') FROM fn_exec
                    WHERE anon_exec IS TRUE AND fn NOT IN (SELECT fn FROM want_anon_fn)),
                  'only the resolver')

  UNION ALL SELECT 15, 'authenticated can execute exactly the intended functions',
         NOT EXISTS (SELECT 1 FROM fn_exec
                      WHERE auth_exec IS TRUE AND fn NOT IN (SELECT fn FROM want_auth_fn))
         AND NOT EXISTS (SELECT 1 FROM want_auth_fn w
                          WHERE (SELECT auth_exec FROM fn_exec WHERE fn = w.fn) IS DISTINCT FROM TRUE),
         COALESCE(
           NULLIF(
             COALESCE((SELECT 'unexpected: ' || string_agg(fn, ' ') FROM fn_exec
                        WHERE auth_exec IS TRUE AND fn NOT IN (SELECT fn FROM want_auth_fn)), '') ||
             COALESCE((SELECT ' missing: ' || string_agg(w.fn, ' ') FROM want_auth_fn w
                        WHERE (SELECT auth_exec FROM fn_exec WHERE fn = w.fn) IS DISTINCT FROM TRUE), ''),
             ''),
           'exactly the eight intended')

  UNION ALL SELECT 16, 'the provenance trigger is attached to health_passport_items',
         EXISTS (SELECT 1 FROM pg_trigger tg
                  JOIN pg_class c ON c.oid = tg.tgrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relname = 'health_passport_items'
                   AND tg.tgname = 'trg_hp_guard_item_provenance' AND NOT tg.tgisinternal),
         'trg_hp_guard_item_provenance'

  UNION ALL SELECT 17, 'exactly the ten expected policies exist, by name',
         NOT EXISTS (SELECT 1 FROM want_pol w
                      WHERE NOT EXISTS (SELECT 1 FROM have_pol h
                                         WHERE h.tbl = w.tbl AND h.pol = w.pol))
         AND NOT EXISTS (SELECT 1 FROM have_pol h
                          WHERE NOT EXISTS (SELECT 1 FROM want_pol w
                                             WHERE w.tbl = h.tbl AND w.pol = h.pol)),
         COALESCE(
           NULLIF(
             COALESCE((SELECT 'missing: ' || string_agg(w.tbl || '.' || w.pol, ' ') FROM want_pol w
                        WHERE NOT EXISTS (SELECT 1 FROM have_pol h
                                           WHERE h.tbl = w.tbl AND h.pol = w.pol)), '') ||
             COALESCE((SELECT ' unexpected: ' || string_agg(h.tbl || '.' || h.pol, ' ') FROM have_pol h
                        WHERE NOT EXISTS (SELECT 1 FROM want_pol w
                                           WHERE w.tbl = h.tbl AND w.pol = h.pol)), ''),
             ''),
           'all ten present, none extra')

  UNION ALL SELECT 18, 'tokens, access log and consents carry NO policy at all',
         NOT EXISTS (SELECT 1 FROM have_pol
                      WHERE tbl IN ('health_passport_tokens','health_passport_access_log',
                                    'health_passport_consents')),
         COALESCE((SELECT string_agg(tbl || '.' || pol, ', ') FROM have_pol
                    WHERE tbl IN ('health_passport_tokens','health_passport_access_log',
                                  'health_passport_consents')),
                  'none, as intended')

  UNION ALL SELECT 19, 'hp_item_insert permits only patient_reported',
         (SELECT with_check FROM have_pol
           WHERE tbl = 'health_passport_items' AND pol = 'hp_item_insert') LIKE '%patient_reported%'
         AND (SELECT with_check FROM have_pol
               WHERE tbl = 'health_passport_items' AND pol = 'hp_item_insert')
             NOT LIKE '%document_supported%'
         AND (SELECT with_check FROM have_pol
               WHERE tbl = 'health_passport_items' AND pol = 'hp_item_insert')
             NOT LIKE '%clinician_verified%',
         COALESCE((SELECT with_check FROM have_pol
                    WHERE tbl = 'health_passport_items' AND pol = 'hp_item_insert'), '(policy missing)')

  UNION ALL SELECT 20, 'every expected CHECK constraint exists',
         NOT EXISTS (SELECT 1 FROM want_chk w WHERE w.con NOT IN (SELECT con FROM have_chk)),
         COALESCE((SELECT string_agg(w.con, ', ') FROM want_chk w
                    WHERE w.con NOT IN (SELECT con FROM have_chk)), 'none missing')
)

SELECT lpad(ord::text, 2, '0') AS "#",
       CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result,
       name AS check_name,
       detail
  FROM checks
UNION ALL
SELECT '99',
       CASE WHEN bool_and(pass) THEN 'ALL PASS' ELSE 'FAILURES' END,
       count(*) FILTER (WHERE pass) || ' / ' || count(*) || ' checks passed',
       COALESCE(string_agg(name, '; ') FILTER (WHERE NOT pass),
                'Health Passport schema verified — safe to deploy the frontend')
  FROM checks
ORDER BY 1;
