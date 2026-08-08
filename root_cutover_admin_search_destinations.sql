-- Anestheo — ROOT CUTOVER: admin_search destinations move from /v2/ to /
--
-- WHY THIS FILE EXISTS
-- --------------------
-- admin_search() is the only place in the database that emits an application
-- URL. Phase 0 baked six literal destinations into it:
--
--     '/v2/admin.html'      x2   (profile, patient_surgery)
--     '/v2/dashboard.html'  x4   (questionnaire, document, ask, question)
--
-- admin.html reads that column and uses it as the href when a search result is
-- opened. Once the site is served from the document root those paths point at
-- a directory that no longer holds the application. The redirect rule keeps
-- them working, but the database would still be handing out the old shape on
-- every single admin search — a permanent redirect hop and a permanently wrong
-- canonical URL. This migration fixes the source.
--
-- WHY IT REWRITES INSTEAD OF RE-DECLARING
-- ---------------------------------------
-- admin_search() is not a static definition. v2_admin_phase0.sql assembles it
-- at install time from whichever source branches actually exist in the target
-- database (pg_temp.p0_has(...) gates each one) and records the omitted ones in
-- a NOTICE. Two databases can therefore hold two different, equally correct
-- admin_search bodies. Re-declaring the function from a fixed source here would
-- silently reintroduce branches this database deliberately omitted, or drop
-- branches it has.
--
-- So this migration takes the function that is actually installed, rewrites the
-- six literals inside it, and reinstalls exactly that. Whatever branch set
-- production compiled is preserved byte for byte apart from the paths.
--
-- v2_admin_phase0.sql IS NOT MODIFIED. It is applied history and stays as the
-- record of what was installed. This file is the forward step.
--
-- SAFETY
-- ------
--   * Refuses to run if admin_search(text, integer) is not installed.
--   * Refuses to run if the number of '/v2/' literals is not exactly 6 —
--     if the function has drifted, a human looks at it before anything changes.
--   * Idempotent: a second run finds 0 literals and exits without touching
--     anything, reporting that the rewrite is already applied.
--   * Re-asserts the Phase 0 grants afterwards, because CREATE OR REPLACE
--     preserves them but a future DROP/CREATE path would not.
--   * Verifies the result before committing. Wrapped in a transaction, so a
--     failed assertion rolls the whole thing back.
--
-- WHEN TO RUN IT
-- --------------
-- AFTER the root cutover is live and verified, not before. Until the site is
-- served from the root, '/admin.html' is wrong and '/v2/admin.html' is right.
-- Running it early breaks admin search navigation; running it late costs one
-- redirect hop per search. Late is the safe side.
--
-- HOW TO RUN
--   Supabase SQL editor, as the project owner. Read the NOTICE output.
--
-- ROLLBACK
--   Re-run with the direction reversed (see the block at the foot of the file).

BEGIN;

DO $cutover$
DECLARE
  v_oid   oid;
  v_def   text;
  v_new   text;
  v_count integer;
BEGIN
  -- Exact signature lookup. to_regprocedure resolves by argument TYPES and
  -- returns NULL rather than raising when the function is absent, so the
  -- guard below can produce a readable message. Matching on
  -- pg_get_function_identity_arguments would be wrong: it renders parameter
  -- NAMES too ('p_q text, p_limit integer'), which are not part of the identity.
  v_oid := to_regprocedure('public.admin_search(text,integer)');

  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'public.admin_search(text, integer) is not installed. Apply v2_admin_phase0.sql first.';
  END IF;

  v_def := pg_get_functiondef(v_oid);

  -- Count the literals we expect to rewrite. pg_get_functiondef dollar-quotes
  -- the body, so these appear verbatim and are not escaped or doubled.
  v_count := (length(v_def) - length(replace(v_def, '/v2/', ''))) / length('/v2/');

  IF v_count = 0 THEN
    RAISE NOTICE 'admin_search already carries root destinations. Nothing to do.';
    RETURN;
  END IF;

  IF v_count <> 6 THEN
    RAISE EXCEPTION
      'Expected exactly 6 "/v2/" literals in admin_search, found %. The function has drifted from Phase 0 — inspect it manually before rewriting.',
      v_count;
  END IF;

  v_new := replace(v_def, '/v2/', '/');

  -- pg_get_functiondef emits CREATE OR REPLACE, so this preserves the oid,
  -- existing grants and any dependent objects.
  EXECUTE v_new;

  RAISE NOTICE 'admin_search rewritten: 6 destinations moved from /v2/ to /.';
END
$cutover$;

-- Re-assert the Phase 0 privilege model. CREATE OR REPLACE keeps the existing
-- grants, so this is belt and braces — but admin_search is SECURITY DEFINER and
-- reads profiles, so its exposure is stated explicitly rather than assumed.
REVOKE ALL   ON FUNCTION public.admin_search(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search(text, integer) TO authenticated;

-- Verify before committing. If the rewrite did not take, this raises and the
-- transaction rolls back with the old function intact.
DO $verify$
DECLARE
  v_def  text;
  v_left integer;
  v_root integer;
BEGIN
  v_def := pg_get_functiondef(to_regprocedure('public.admin_search(text,integer)'));

  v_left := (length(v_def) - length(replace(v_def, '/v2/', ''))) / length('/v2/');
  v_root := (length(v_def) - length(replace(v_def, '''/admin.html''', '')))
              / length('''/admin.html''')
          + (length(v_def) - length(replace(v_def, '''/dashboard.html''', '')))
              / length('''/dashboard.html''');

  IF v_left <> 0 THEN
    RAISE EXCEPTION 'Verification failed: % "/v2/" literal(s) remain in admin_search.', v_left;
  END IF;
  IF v_root <> 6 THEN
    RAISE EXCEPTION
      'Verification failed: expected 6 root destination literals, found %.', v_root;
  END IF;

  RAISE NOTICE 'Verified: admin_search emits 6 root destinations and no /v2/ paths.';
END
$verify$;

COMMIT;

-- ── POST-CHECK (run separately, as an admin user) ───────────────────────────
--   SELECT DISTINCT destination FROM public.admin_search('a', 100);
-- Expect only '/admin.html' and '/dashboard.html'. An empty result just means
-- the term matched nothing; try a name you know exists.

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- If the cutover is reverted and the site returns to /v2/, run this to put the
-- old destinations back. Same shape, same guards, opposite direction.
--
-- BEGIN;
-- DO $rb$
-- DECLARE v_def text; v_n integer;
-- BEGIN
--   v_def := pg_get_functiondef(to_regprocedure('public.admin_search(text,integer)'));
--   IF v_def IS NULL THEN RAISE EXCEPTION 'admin_search not installed'; END IF;
--   v_n := (length(v_def) - length(replace(v_def, '''/admin.html''','')))
--            / length('''/admin.html''')
--        + (length(v_def) - length(replace(v_def, '''/dashboard.html''','')))
--            / length('''/dashboard.html''');
--   IF v_n <> 6 THEN RAISE EXCEPTION 'Expected 6 root literals, found %', v_n; END IF;
--   EXECUTE replace(replace(v_def, '''/admin.html''', '''/v2/admin.html'''),
--                            '''/dashboard.html''', '''/v2/dashboard.html''');
--   RAISE NOTICE 'admin_search reverted to /v2/ destinations.';
-- END $rb$;
-- REVOKE ALL   ON FUNCTION public.admin_search(text, integer) FROM PUBLIC, anon;
-- GRANT EXECUTE ON FUNCTION public.admin_search(text, integer) TO authenticated;
-- COMMIT;
