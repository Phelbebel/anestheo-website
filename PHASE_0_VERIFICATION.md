# PHASE 0 — Verification Procedure

> Created: 2026-06-02
> Companion: [MIGRATION_PLAN.md](MIGRATION_PLAN.md) Phase 0
> Purpose: Confirm the questionnaire core loop works before any code/DB change.

## Ground rules

- **Sections 1 & 2 are strictly READ-ONLY SQL** — they only inspect catalogs and select rows. They modify nothing.
- **Section 3 is an end-to-end test through the normal application UI.** It necessarily *creates one test patient row* via the app's own write path (that is the test). It does **not** hand-edit the database. A cleanup query is provided at the end and is the only optional write — run it only if you choose to remove the test row.
- Do not change application code or schema during this procedure.

Run Section 1 & 2 in the **Supabase SQL Editor**. Run Section 3 in a **browser**.

---

## 1. Verify the three RPCs exist and are correctly defined

### 1a. All three functions exist, with SECURITY DEFINER

```sql
SELECT
  p.proname                                   AS function_name,
  pg_get_function_identity_arguments(p.oid)   AS arguments,
  CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS security,
  pg_get_function_result(p.oid)               AS returns
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_clinic_patient_by_token',
    'mark_clinic_questionnaire_progress',
    'submit_clinic_questionnaire'
  )
ORDER BY p.proname;
```

**Expected:** exactly **3 rows**.

| function_name | arguments | security | returns (summary) |
|---|---|---|---|
| `get_clinic_patient_by_token` | `p_token text` | `DEFINER` | `TABLE(id uuid, patient_name text, procedure text, hospital text, surgery_date date, questionnaire_status text, questionnaire_answers jsonb)` |
| `mark_clinic_questionnaire_progress` | `p_token text` | `DEFINER` | `void` |
| `submit_clinic_questionnaire` | `p_token text, p_answers jsonb` | `DEFINER` | `void` |

**Fail conditions:** fewer than 3 rows (RPC missing → `q.html` cannot load/submit), or `security = INVOKER` (anon caller will be blocked by RLS → silent failure).

### 1b. Execute grants include `anon` and `authenticated`

```sql
SELECT
  p.proname AS function_name,
  r.rolname AS granted_to,
  has_function_privilege(r.rolname, p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN (SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')) r
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_clinic_patient_by_token',
    'mark_clinic_questionnaire_progress',
    'submit_clinic_questionnaire'
  )
ORDER BY p.proname, r.rolname;
```

**Expected:** **6 rows**, every `can_execute = true`.
The `anon` grant is essential — patients fill the questionnaire without logging in.

**Fail condition:** any `can_execute = false`, especially for `anon` → no-account patients get a silent submit failure.

### 1c. Inspect the function bodies (confirm logic matches the migration file)

```sql
SELECT pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_clinic_patient_by_token',
    'mark_clinic_questionnaire_progress',
    'submit_clinic_questionnaire'
  );
```

**Expected (cross-check against `v2_clinic_patients_migration.sql`):**
- `get_clinic_patient_by_token`: UPDATEs `questionnaire_status` `sent → opened` and sets `opened_at`, then RETURNs the row by token.
- `submit_clinic_questionnaire`: SETs `questionnaire_answers = p_answers`, `questionnaire_status = 'completed'`, `completed_at = now()`, and advances `patient_status` from `awaiting_questionnaire → awaiting_consultation`.
- All three include `SET search_path = public` (matches `fix_questionnaire_ambiguity.sql` intent — guards against column/identifier ambiguity).

**Fail condition:** body differs from the migration file (e.g. ambiguity fix never applied) → suspect silent submit failures.

---

## 2. Inspect RLS policies and existing data

### 2a. RLS is ENABLED on clinic_patients

```sql
SELECT relname AS table_name, relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relname = 'clinic_patients' AND relnamespace = 'public'::regnamespace;
```

**Expected:** 1 row, `rls_enabled = true`.
**Fail condition:** `false` → every doctor could read every patient (privacy breach).

### 2b. List the clinic_patients policies

```sql
SELECT policyname, cmd, roles, qual AS using_expr, with_check AS check_expr
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'clinic_patients'
ORDER BY cmd, policyname;
```

**Expected:** 4 policies matching `v2_clinic_patients_migration.sql`:

| policyname | cmd | using_expr (summary) | check_expr |
|---|---|---|---|
| `cp_select` | SELECT | `auth.uid() = doctor_id OR (admin via profiles)` | — |
| `cp_insert` | INSERT | — | `auth.uid() = doctor_id` |
| `cp_update` | UPDATE | `auth.uid() = doctor_id` | `auth.uid() = doctor_id` |
| `cp_delete` | DELETE | `auth.uid() = doctor_id` | — |

**Notes:**
- There is intentionally **no anon SELECT policy** — anonymous patient access flows only through the SECURITY DEFINER RPCs. That is correct.
- If you have already run the Phase 2 bridge migration (you should NOT have yet), `cp_select` would also contain `OR auth.uid() = patient_user_id`. For Phase 0 it should not.

**Fail condition:** `cp_select` is missing the `doctor_id` match, or is overly broad (e.g. `USING (true)`) → doctors see others' patients, or see none.

### 2c. Table grants

```sql
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'clinic_patients'
  AND grantee IN ('anon','authenticated')
ORDER BY grantee, privilege_type;
```

**Expected:** `authenticated` has SELECT/INSERT/UPDATE/DELETE; `anon` has SELECT only (table-level; RLS still restricts rows, and anon has no matching policy so direct anon reads return nothing — by design).

### 2d. Row counts (baseline)

```sql
SELECT
  count(*)                                                   AS total_patients,
  count(*) FILTER (WHERE questionnaire_status = 'not_sent')   AS not_sent,
  count(*) FILTER (WHERE questionnaire_status = 'sent')       AS sent,
  count(*) FILTER (WHERE questionnaire_status = 'opened')     AS opened,
  count(*) FILTER (WHERE questionnaire_status = 'in_progress')AS in_progress,
  count(*) FILTER (WHERE questionnaire_status = 'completed')  AS completed
FROM public.clinic_patients;
```

**Expected:** numbers consistent with usage. Record these as your baseline — `completed` should increase by exactly 1 after the Section 3 test.

### 2e. Completed questionnaires actually contain answers + scores

```sql
SELECT
  id, patient_name, questionnaire_status, completed_at,
  (questionnaire_answers ? '_scores') AS has_scores,
  (questionnaire_answers ? '_flags')  AS has_flags,
  jsonb_object_keys_count(questionnaire_answers) AS answer_key_count
FROM (
  SELECT *, (SELECT count(*) FROM jsonb_object_keys(questionnaire_answers)) AS jsonb_object_keys_count
  FROM public.clinic_patients
  WHERE questionnaire_status = 'completed'
) s
ORDER BY completed_at DESC NULLS LAST
LIMIT 20;
```

> If `jsonb_object_keys_count` helper expression errors in your editor, use this simpler form:

```sql
SELECT id, patient_name, questionnaire_status, completed_at,
       (questionnaire_answers ? '_scores') AS has_scores,
       (questionnaire_answers ? '_flags')  AS has_flags
FROM public.clinic_patients
WHERE questionnaire_status = 'completed'
ORDER BY completed_at DESC NULLS LAST
LIMIT 20;
```

**Expected:** for genuine completions, `has_scores = true`, `has_flags = true`, and `completed_at` is set.
**Fail condition:** `status='completed'` but `questionnaire_answers` is null/empty → writes are partially failing.

### 2f. Look for stuck rows (symptom of a broken submit path)

```sql
SELECT questionnaire_status, count(*)
FROM public.clinic_patients
WHERE questionnaire_status IN ('opened','in_progress')
GROUP BY questionnaire_status;
```

**Interpretation:** a large pile of `opened`/`in_progress` that never reach `completed` is the classic fingerprint of a failing `submit_clinic_questionnaire` (patients open and fill, but the final write silently fails). Note the numbers; compare again after the test.

---

## 3. End-to-end test (browser, normal app flow)

> This is the definitive test. It exercises the exact path: doctor → send → fill → store → doctor sees result. Use a **doctor (or admin) account** you control. Use two browser contexts so the patient step has no doctor session.

### Step 3.0 — Pre-test snapshot
- Run **2d** and record `total_patients` and `completed`.
- Decide a unique test name, e.g. `ZZ_TEST_<today's date>` so it's easy to find/clean up.

### Step 3.1 — Doctor creates a test patient
1. Sign in as the doctor → `dashboard.html` → **Patient Management**.
2. Add patient: Name = `ZZ_TEST_2026-06-02`; Phone = a number you control (or your own); Procedure = `Knee arthroscopy`; Hospital = `Test`; pick any surgery date.
3. Click **Save patient** (not "Send" yet).

**Expected:**
- Toast: "Patient saved" (NOT a raw "Insert error: …" — if you see a raw Postgres error, that's TODO HIGH item #3 and a real RLS/insert problem).
- A new card appears with status **Awaiting questionnaire**, questionnaire chip **Not sent**.

Confirm in SQL (read-only):
```sql
SELECT id, token, questionnaire_status, patient_status, doctor_id, created_at
FROM public.clinic_patients
WHERE patient_name = 'ZZ_TEST_2026-06-02'
ORDER BY created_at DESC LIMIT 1;
```
**Expected:** 1 row; `token` is a long hex string; `questionnaire_status='not_sent'`; `patient_status='awaiting_questionnaire'`; `doctor_id` = your auth uid.

➡️ **Copy the `token` value** for Step 3.3.

### Step 3.2 — Send questionnaire (status → sent)
1. On the patient card click **Send questionnaire**.
2. If a WhatsApp tab opens, you can close it — opening is what matters.

**Expected:**
- Toast: "WhatsApp opened — status set to Sent".
- Card chip changes to **Sent**.

Confirm:
```sql
SELECT questionnaire_status, sent_at
FROM public.clinic_patients
WHERE patient_name = 'ZZ_TEST_2026-06-02'
ORDER BY created_at DESC LIMIT 1;
```
**Expected:** `questionnaire_status='sent'`, `sent_at` set.
*(If the pop-up was blocked, status stays `not_sent` — that is intended behavior, not a bug. Use Copy Link instead.)*

### Step 3.3 — Open the token link as the patient (status → opened)
1. Open a **different browser / incognito window** with **no doctor session**.
2. Navigate to `https://<your-host>/v2/q.html?t=<TOKEN_FROM_3.1>`.

**Expected:**
- Loader, then the questionnaire renders with the greeting and the procedure/hospital/date chips.
- The form shows adaptive questions (age, sex, height, weight, then branching sections).
- Browser console (optional): `Question Count:` > 0, no errors.

Confirm the RPC flipped the status:
```sql
SELECT questionnaire_status, opened_at
FROM public.clinic_patients
WHERE patient_name = 'ZZ_TEST_2026-06-02'
ORDER BY created_at DESC LIMIT 1;
```
**Expected:** `questionnaire_status='opened'`, `opened_at` set.
**Fail condition:** still `sent`, or "Link not found" → `get_clinic_patient_by_token` not working (recheck 1a/1b).

### Step 3.4 — Complete and submit the questionnaire (status → completed)
1. Fill the questions. To exercise scoring/flags, set values such as: Age `58`, Sex `Male`, Height `175`, Weight `120` (BMI ~39 → obesity/STOP-BANG signals), Snore `Yes`, Heart disease `Yes`, Blood thinners `Yes`.
2. Click **Submit questionnaire**.

**Expected:**
- The completion screen appears ("Questionnaire complete") with a summary card: Height, Weight, BMI, STOP-BANG, risk flags, completion %.
- NO `alert('Unable to save questionnaire…')`. That alert = `submit_clinic_questionnaire` failed → core loop broken (recheck 1a/1c, 2a/2b).

Confirm the write:
```sql
SELECT questionnaire_status, completed_at, patient_status,
       (questionnaire_answers ? '_scores') AS has_scores,
       (questionnaire_answers ? '_flags')  AS has_flags,
       questionnaire_answers -> '_scores' ->> 'stopbang' AS stopbang,
       questionnaire_answers -> '_scores' ->> 'bmi'      AS bmi
FROM public.clinic_patients
WHERE patient_name = 'ZZ_TEST_2026-06-02'
ORDER BY created_at DESC LIMIT 1;
```
**Expected:**
- `questionnaire_status='completed'`, `completed_at` set.
- `patient_status='awaiting_consultation'` (auto-advanced).
- `has_scores=true`, `has_flags=true`; `bmi` ≈ `39.2`, `stopbang` a number 0–8.

### Step 3.5 — Verify the doctor dashboard receives the result
1. Return to the **doctor browser**. Reload `dashboard.html` (the dashboard does not auto-refresh — see Risk #5).
2. Find the `ZZ_TEST` card.

**Expected:**
- Status now **Awaiting consultation**; questionnaire chip **Completed · NN%**.
- Clinical row shows **BMI**, **STOP-BANG**, **Pregnancy**, **ASA**.
- Risk flags (amber badges) such as "Cardiac disease", "Anticoagulant use", "Morbid obesity (BMI …)".
- **View summary** opens the full answers + scores modal.
- **Print PDF** opens a print-ready window.

**This is the success criterion for the whole core loop.** If the completed data shows here, *doctor creates → send → patient fills → doctor sees results* is verified end-to-end.

### Step 3.6 — Post-test count check
```sql
SELECT
  count(*) AS total_patients,
  count(*) FILTER (WHERE questionnaire_status='completed') AS completed
FROM public.clinic_patients;
```
**Expected:** `total_patients` = baseline + 1; `completed` = baseline + 1.

### Step 3.7 — (Optional) Clean up the test row
> Only run this if you want to remove the test patient. It is the single optional write in this procedure. Run as the doctor who owns the row (so RLS permits it), or via SQL editor:
```sql
DELETE FROM public.clinic_patients
WHERE patient_name = 'ZZ_TEST_2026-06-02';
```
**Expected:** 1 row deleted. Re-run 3.6 to confirm counts return to baseline.

---

## Pass / Fail summary

| Check | Pass means |
|---|---|
| 1a/1b/1c | 3 RPCs exist, SECURITY DEFINER, anon+authenticated EXECUTE, bodies match migration |
| 2a/2b/2c | RLS enabled; 4 correct policies; sane grants; no anon SELECT policy |
| 2e/2f | Completed rows hold answers+scores; no large stuck `opened/in_progress` pile |
| 3.1 | Patient inserts cleanly (no raw error) |
| 3.2 | Status → sent on real send |
| 3.3 | Token link loads; status → opened |
| 3.4 | Submit succeeds; status → completed; scores+flags written; patient_status auto-advances |
| 3.5 | **Doctor dashboard shows the completed questionnaire** ← core loop verified |

**If all pass:** proceed to MIGRATION_PLAN Phase 1 (extract the single engine).
**If any fail:** the failing RPC/policy is now the highest-value fix — repair it before any consolidation work. Capture the failing query output for diagnosis.
