# Admin RPC EXECUTE grants — audit

Audit only. **Nothing here has been run.** No schema change, no RLS change, no
function change, no new RPC. Every statement below is a `GRANT EXECUTE`.

## 1. What the audit found

`admin_set_verification` needing a manual grant in production is not a one-off.
The 15 `admin_*` RPCs the Admin Center calls are granted to `authenticated` by
**two `DO` blocks** — one in `v2_admin_phase2.sql` (10 functions), one in
`v2_admin_phase3.sql` (5 functions):

```sql
DO $g$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[ ... ] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.'||f||' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||f||' TO authenticated';
  END LOOP;
END
$g$;
```

A `DO` block is **one statement**. If any single iteration raises — a function
not yet created, a signature that does not match, anything — the whole block
rolls back and *none* of that group's grants are applied. The `REVOKE` in the
same loop is what makes the failure bite: `authenticated` never held EXECUTE
directly, it inherited it from `PUBLIC`, so once the group is revoked and the
grant is lost, every function in that group is unreachable.

That predicts exactly the observed behaviour:

| Applied by | Form | Outcome |
|---|---|---|
| `v2_admin_phase0.sql` | plain statements | `is_platform_admin`, `admin_search` work — **Admin Center loads** |
| `v2_admin_phase2.sql` | one `DO` block, 10 functions | all-or-nothing |
| `v2_admin_phase3.sql` | one `DO` block, 5 functions | all-or-nothing |
| `v4_patient_lifecycle.sql`, `v4_1_purge_safety.sql` | plain statements | recycle bin / purge work |
| `v4_2_delete_lockdown.sql` | plain statements | not applied in production |

**The migrations are not wrong.** Applied cleanly to a fresh PostgreSQL 16
replica, all 20 functions end up `authenticated=X/postgres` with `anon` false.
This is a divergence between production and the migration source, not a defect
in the SQL — which is why the fix below is grants only and changes nothing else.

The grants below are written as **one plain statement per function**, not a
loop, so a failure on one cannot take down the other nineteen. That is the only
difference from what the migrations already say.

## 2. The RPCs the Admin UI calls

20 functions, 42 call sites in `admin.html`. Signatures confirmed against a
PostgreSQL 16 replica with every migration applied; exactly one overload each,
so there is no ambiguity for PostgREST to resolve badly.

| RPC | Signature | Granted by | Form |
|---|---|---|---|
| `is_platform_admin` | `()` | phase0 | plain — reliable |
| `admin_search` | `(text,integer)` | phase0 + root cutover | plain — reliable |
| `admin_set_verification` | `(uuid,text,text)` | phase2 **and** phase3 | `DO` block |
| `admin_update_profile_fields` | `(uuid,jsonb,text)` | phase2 | `DO` block |
| `admin_change_role` | `(uuid,text,text)` | phase2 | `DO` block |
| `admin_assign_doctor` | `(uuid,uuid,text)` | phase2 | `DO` block |
| `admin_reassign_doctor_patients` | `(uuid,uuid,text)` | phase2 | `DO` block |
| `admin_set_account_status` | `(uuid,text,text,timestamptz)` | phase2 | `DO` block |
| `admin_soft_delete_account` | `(uuid,text)` | phase2 | `DO` block |
| `admin_restore_account` | `(uuid,text)` | phase2 | `DO` block |
| `admin_purge_account` | `(uuid,text,text)` | phase2 | `DO` block |
| `admin_care_request_action` | `(uuid,text,text,uuid)` | phase2 | `DO` block |
| `admin_add_verification_note` | `(uuid,text)` | phase3 | `DO` block |
| `admin_request_documents` | `(uuid,text[],text)` | phase3 | `DO` block |
| `admin_report_action` | `(uuid,text,text,uuid)` | phase3 | `DO` block |
| `admin_record_action` | `(text,uuid,text,text,text)` | phase3 + v4_2 | `DO` block / plain |
| `patient_lifecycle_action` | `(text,uuid,text,text)` | v4 | plain — reliable |
| `patient_purge` | `(text,uuid,text)` | v4 | plain — reliable |
| `patient_purge_eligibility` | `(text,uuid)` | v4_1 + v4 | plain — reliable |
| `recycle_bin_list` | `()` | v4_1 | plain — reliable |

`admin_set_verification` appears in both blocks — consistent with it being the
first failure noticed, and with the rest of both groups being in the same state.

## 3. Confirm production first — read-only

One statement, Supabase SQL Editor compatible, no meta commands, reads nothing
but the catalog. It lists **every** overload, so a stray second signature would
show up rather than hide.

```sql
SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS function,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_can_execute,
       COALESCE(array_to_string(p.proacl, '  '), '(default: PUBLIC)') AS acl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN (
     'admin_add_verification_note','admin_assign_doctor','admin_care_request_action',
     'admin_change_role','admin_purge_account','admin_reassign_doctor_patients',
     'admin_record_action','admin_report_action','admin_request_documents',
     'admin_restore_account','admin_search','admin_set_account_status',
     'admin_set_verification','admin_soft_delete_account','admin_update_profile_fields',
     'is_platform_admin','patient_lifecycle_action','patient_purge',
     'patient_purge_eligibility','recycle_bin_list')
 ORDER BY authenticated_can_execute, p.proname;
```

Rows with `authenticated_can_execute = false` are the ones to grant. They sort
first. `anon_can_execute` must be **false on every row** — if any row shows
true, stop and report it rather than granting anything, because that is a
different and more serious problem than the one this document is about.

## 4. The grants

Minimal and idempotent — `GRANT` on an already-granted function is a no-op, so
running the whole list is safe even if only some are missing. **No `REVOKE`:**
the revokes already happened and are the posture we want; re-running them is
what would risk breaking something.

```sql
GRANT EXECUTE ON FUNCTION public.admin_add_verification_note(uuid,text)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_doctor(uuid,uuid,text)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_care_request_action(uuid,text,text,uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_change_role(uuid,text,text)                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_account(uuid,text,text)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reassign_doctor_patients(uuid,uuid,text)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_action(text,uuid,text,text,text)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_report_action(uuid,text,text,uuid)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_request_documents(uuid,text[],text)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_restore_account(uuid,text)                             TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search(text,integer)                                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_account_status(uuid,text,text,timestamptz)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_verification(uuid,text,text)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_soft_delete_account(uuid,text)                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_profile_fields(uuid,jsonb,text)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin()                                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.patient_lifecycle_action(text,uuid,text,text)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.patient_purge(text,uuid,text)                                TO authenticated;
GRANT EXECUTE ON FUNCTION public.patient_purge_eligibility(text,uuid)                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.recycle_bin_list()                                           TO authenticated;
```

### This grants nothing to anyone who could not already act

Every one of these is `SECURITY DEFINER` and begins with its own authorisation
check — `assert_admin()`, or `admin_assert_target()` which additionally refuses
the caller's own account and refuses any other administrator. EXECUTE only
lets a signed-in user *reach* the function; the function still decides. A
non-admin who calls `admin_soft_delete_account` after this gets the same
refusal they would get today, from the same line of PL/pgSQL.

`anon` is granted nothing here, and must stay that way.

### After granting

Re-run the query in §3. Every row should read `true / false`. Then confirm in
the UI: approve a doctor, suspend an account, add a verification note.

## 5. Frontend wiring — verified, no change needed

All 42 `acRpc()` call sites were checked mechanically against the real
signatures. Every call sends only argument names the function actually
declares. This matters because a wrong argument name produces PostgREST
`PGRST202` — *"Could not find the function in the schema cache"* — which reads
like a permission error and is not one. There are no such mismatches.

| UI action | admin.html | RPC | Signature match |
|---|---|---|---|
| Add note | 2747 | `admin_add_verification_note` | `p_doctor`, `p_note` ✓ |
| Request documents | 2738 | `admin_request_documents` | `p_doctor`, `p_types` (array) , `p_reason` ✓ |
| Delete | 724, 1504 | `admin_soft_delete_account` | `p_target`, `p_reason` ✓ |
| Suspend | 690, 1498 | `admin_set_account_status` | `p_target`, `p_status:'suspended'`, `p_reason` ✓ |
| Ban | 700, 1500 | `admin_set_account_status` | + `p_expires` ✓ |
| Reactivate | 710 | `admin_set_account_status` | `p_status:'active'` ✓ |
| Approve / Reject | 770, 1492–1496 | `admin_set_verification` | `p_target`, `p_state`, `p_reason` ✓ |
| Change role | 798 | `admin_change_role` | `p_target`, `p_role`, `p_reason` ✓ |

No code change is warranted.
