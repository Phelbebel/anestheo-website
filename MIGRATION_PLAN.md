# MIGRATION_PLAN.md — Single Questionnaire Architecture

> Created: 2026-06-02
> Status: APPROVED — awaiting execution. No code changed yet.
> Companion docs: [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) §5, [TODO.md](TODO.md)

---

## Goal

Collapse the two independent questionnaire systems into **one engine, one source of truth, one storage location**, with the **doctor-primary token workflow** as the main path:

```
Doctor creates patient → sends link → patient fills questionnaire → doctor sees results
```

---

## Approved Decisions

These were decided by the product owner and are binding for this migration:

1. **Patient accounts are OPTIONAL.**
   - The token workflow is the main workflow. A patient must be able to complete a questionnaire from a link **without creating an account**.
   - `patient_user_id` linking (for the patient dashboard) is **best-effort only** — it enhances the experience for patients who happen to have an account, but is never required for the core flow.
   - `q.html` must NOT enforce sign-in.

2. **Legacy Path B data (`preop_questionnaires`) is NOT auto-migrated.**
   - Do not translate or auto-map old rows.
   - Freeze the table read-only and keep it as an archive for manual review later.
   - No data is deleted.

---

## 1. Current Architecture (problem state)

Two systems, no link between them:

```
SYSTEM A — Clinic / token (KEEP)            SYSTEM B — Self-serve / account (RETIRE)
──────────────────────────────────          ────────────────────────────────────────
dashboard.html creates clinic_patients       patient logs in
   (doctor_id, token)                            │
   │  /v2/q.html?t=<token>  (no login)           ▼
q.html  (35+ adaptive fields, scoring)        questionnaire.html (requireAuth, 6-step)
   │  RPC submit_clinic_questionnaire            │ saveQuestionnaire(uid,...)
   ▼                                             ▼
clinic_patients.questionnaire_answers         preop_questionnaires (keyed by auth uid)
   ├─► Doctor dashboard ✅                        └─► Patient dashboard only
   └─► Patient dashboard (not wired)             Doctor dashboard NEVER reads ❌

         clinic_patients  ╳  no link  ╳  preop_questionnaires
```

**Field vocabularies differ:** System A uses `cardiac:'Yes'`; System B uses `history:['heart']`, `'yes'`.

---

## 2. Recommended Architecture (target state)

```
Doctor → dashboard.html
   creates clinic_patients row (doctor_id, token, patient_user_id?)
   │
   ▼  /v2/q.html?t=<token>     (NO login required — accounts optional)
q.html ──loads──► questionnaire-engine.js ◄──loads── patient-dashboard.html (display only)
   │              (ONE QUESTIONS array + scoring + label map)
   ▼  RPC submit_clinic_questionnaire(token, answers)
clinic_patients.questionnaire_answers   ◄── SINGLE SOURCE OF TRUTH
   │
   ├──► Doctor dashboard    (RLS: doctor_id = auth.uid())          ✅ primary
   └──► Patient dashboard   (RLS: patient_user_id = auth.uid())    ✅ optional, best-effort
```

- **One engine:** `questionnaire-engine.js` (extracted from `q.html`).
- **One store:** `clinic_patients.questionnaire_answers` (JSONB: fields + `_scores` + `_flags`).
- **Two read audiences:** doctor (always) and patient (only if they have an account and claimed the record).

---

## 3. System That Survives — System A (Clinic / Token)

Rationale:
- Server side already complete: `clinic_patients` has all workflow columns + 3 `SECURITY DEFINER` RPCs (`get_clinic_patient_by_token`, `mark_clinic_questionnaire_progress`, `submit_clinic_questionnaire`) + correct per-doctor RLS.
- Already feeds the doctor dashboard (the primary workflow) with zero changes.
- Supports no-account completion via token — matches Decision #1.
- Richer engine: adaptive branching (pregnancy / pediatric / cesarean), STOP-BANG / Apfel / ASA / BMI scoring.

---

## 4. System That Is Retired — System B (`preop_questionnaires` + `questionnaire.html`)

- It is a data dead-end: doctor dashboard never reads it; no key links it to a doctor.
- Weaker engine, divergent field vocabulary.
- **Retirement = freeze, not delete:**
  - `preop_questionnaires` → revoke INSERT/UPDATE, keep SELECT (read-only archive).
  - `questionnaire.html` → redirect logged-in patients to their token `q.html` (keep as shim, do not delete, to preserve bookmarks/links).
- `preop_checklist` is unrelated to this migration and stays as-is.

---

## 5. Migration Plan (phased, reversible, no data loss)

### Phase 0 — Snapshot & verify (no changes)
- [ ] Export `clinic_patients` and `preop_questionnaires` (SQL dump / CSV).
- [ ] Confirm the 3 RPCs exist in the live DB.
- [ ] Confirm a real `q.html` submission currently lands in `clinic_patients` (rules out "RPC not deployed" failure).
- [ ] Record counts: `SELECT count(*) FROM preop_questionnaires WHERE status='submitted';`
- **Rollback:** n/a (read-only).

### Phase 1 — Extract the single engine (frontend, behavior-preserving)
- [ ] Create `questionnaire-engine.js` containing, lifted verbatim from `q.html`:
  - `QUESTIONS` array, branching predicates (`isCesarean`, age/sex gates)
  - `computeScores()`, `computeFlags()`
  - the field-label map (currently duplicated 3×)
  - the field renderer (`renderFields` / `pick` / `setVal` / `branchOnBlur`)
- [ ] Point `q.html` at the module. No behavioral change.
- [ ] Validate: `q.html?preview=1` and a real token submission render and save identically to before.
- **Rollback:** revert commit.

### Phase 2 — Patient bridge (additive DB migration)
> Best-effort linking only (Decision #1). Never blocks the token flow.
- [ ] New migration file (additive, idempotent):
  - `ALTER TABLE clinic_patients ADD COLUMN IF NOT EXISTS patient_user_id uuid REFERENCES auth.users(id);`
  - index on `patient_user_id`
  - `SECURITY DEFINER` RPC `claim_clinic_patient(p_token)` → sets `patient_user_id = auth.uid()` for that token **only when currently NULL**; grant to `authenticated` only.
  - extend `cp_select` policy: `... OR auth.uid() = patient_user_id`
- [ ] `q.html`: if a session exists, fire-and-forget `claim_clinic_patient(token)` after load. If no session, do nothing (no prompt, no block).
- **Rollback:** drop column, RPC, revert policy. Nothing depends on it yet.

### Phase 3 — Patient dashboard reads the single store
- [ ] `patient-dashboard.html`: replace the `preop_questionnaires` read with
      `clinic_patients WHERE patient_user_id = auth.uid()` (most recent / upcoming).
- [ ] Render results using the shared engine's label map + `_scores` / `_flags`.
- [ ] "Complete / continue questionnaire" links to the patient's own `/v2/q.html?t=<token>`.
- [ ] If the patient has no claimed record, show a friendly empty state (not an error) — accounts are optional.
- **Rollback:** revert commit.

### Phase 4 — Converge the fill path
- [ ] `questionnaire.html` → redirect shim: if logged in and a claimed `clinic_patients` row exists, send to its token `q.html`; otherwise show an informational message. Do NOT delete the file.
- [ ] Repoint links in `navbar.js`, `index.html`, `patient-dashboard.html` that point at `questionnaire.html` to the token flow.
- [ ] Result: `q.html` is the only questionnaire fill UI.
- **Rollback:** revert commit.

### Phase 5 — Legacy data: ARCHIVE ONLY (per Decision #2)
- [ ] Do NOT auto-map or translate `preop_questionnaires`.
- [ ] Revoke `INSERT, UPDATE` on `preop_questionnaires` from `authenticated`; keep `SELECT`.
- [ ] Leave all rows intact for manual review.
- [ ] (Optional later) build an admin-only read view to inspect archived submissions.
- **Rollback:** re-grant INSERT/UPDATE.

### Phase 6 — Document & close
- [ ] Update `PROJECT_CONTEXT.md` §5 to describe the single architecture.
- [ ] Mark the relevant `TODO.md` items (two questionnaire systems, triple label map) resolved.
- [ ] Note in `PROJECT_CONTEXT.md` that `preop_questionnaires` is a frozen archive.

---

## 6. Risks & Mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **RLS exposure via `patient_user_id` bridge** — a patient could see fields they shouldn't, or claim a record not theirs. | High | `claim_clinic_patient` only sets the link when NULL and matched by the secret token; review `cp_select` before deploy; grant claim RPC to `authenticated` only. |
| 2 | **Engine extraction regressions** — moving `QUESTIONS`/scoring into a module subtly changes branching or scores. | Medium | Phase 1 is behavior-preserving; diff a preview render and a real submission before/after; recompute scores must match. |
| 3 | **Broken `questionnaire.html` links / bookmarks** on retirement. | Medium | Redirect shim, not deletion (Phase 4). |
| 4 | **Legacy archive becomes invisible / forgotten** — manual review never happens. | Low–Med | Keep SELECT grant; optional admin read view; documented in PROJECT_CONTEXT. |
| 5 | **Doctor dashboard staleness** — a just-completed questionnaire needs a manual refresh (pre-existing, not caused here). | Low | Out of scope; consider a Supabase realtime subscription on `clinic_patients` as a follow-up. |
| 6 | **Patients without accounts can't use the patient dashboard.** | By design | Accepted per Decision #1 — token flow is primary; dashboard is a bonus for account holders. |
| 7 | **`q.html` depends on RPCs being deployed** — if missing, submit fails silently with an alert. | Medium | Verified in Phase 0 before any other change. |

---

## Validation Checklist (run after each phase)

1. Doctor creates patient → sends → **no-account** patient fills via token → row shows `completed` in doctor dashboard.
2. Logged-in patient who claimed a record sees identical results on the patient dashboard.
3. Patient with no account still completes via token (no regression, no sign-in prompt).
4. Scores/flags identical across doctor view, patient view, and printout (same engine).
5. No write path targets `preop_questionnaires` anymore; SELECT still works.
6. `questionnaire.html` redirects instead of forking data.

---

## Out of Scope (explicitly deferred)

- Auto-migration / field translation of legacy `preop_questionnaires` rows (manual review later).
- DB-driven questionnaire templates (engine remains code-defined for now).
- Realtime dashboard updates.
- Removing debug tooling (tracked separately in TODO.md HIGH priority).
