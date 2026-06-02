# PHASE 1 — `questionnaire-engine.js` Extraction Plan

> Created: 2026-06-02
> Prereq: Phase 0 PASSED (core loop verified).
> Companion: [MIGRATION_PLAN.md](MIGRATION_PLAN.md) Phase 1
> Status: PLAN ONLY — no code changed yet.

---

## Objective

Create a single, dependency-free module `questionnaire-engine.js` that holds the **data layer** of the questionnaire — questions, branching, scoring, and human-readable labels — and point `q.html` at it. Behavior of the patient fill flow must be **byte-for-byte identical** after the change.

This is the change that creates "one engine / one vocabulary" and unblocks reusing the same questions, scores, and labels in `patient-dashboard.html` (Phase 3) and, later, in `dashboard.html` (which currently duplicates the label map twice).

---

## Design decision: conservative lift (data layer only)

There are two ways to extract. We choose the lower-risk one.

| | Option A — Data layer only (CHOSEN) | Option B — Full renderer extraction |
|---|---|---|
| Moves to engine | QUESTIONS, LABELS, scoring, branching predicates, completion math | All of A + the DOM form renderer (`renderFields`, `setVal`, `pick`, `branchOnBlur`) |
| Stays in `q.html` | DOM rendering, token/preview lifecycle, submit RPC, completion & error screens | Only the page lifecycle |
| Risk | **Low** — the fragile focus/branching workaround stays untouched in `q.html` | Medium — re-homing the renderer risks focus/branch regressions |
| Achieves Phase-1 goal? | **Yes** — single source of questions/scoring/labels | Yes, but more surface area |

**Why A:** the documented questionnaire risk (PROJECT_CONTEXT §5.6, MIGRATION_PLAN Risk #2) is the branching/focus behavior in `renderFields`/`branchOnBlur`. Option A does not touch that code at all — it only centralizes the *data*. Patient-dashboard reuse needs `LABELS` + `computeScores`/`computeFlags` over *stored* answers, NOT the live form renderer — so Option A delivers everything Phase 3 needs. The renderer can move in a later, optional phase if we want.

---

## Target module: `questionnaire-engine.js`

### Conventions
- Plain `<script>` (no ES modules), matching the codebase (`navbar.js` style).
- IIFE attaching one global namespace: **`window.AnestheoQ`**.
- **Zero dependencies** — no Supabase, no DOM access, no `auth.js`. Pure functions + data.
- All functions are **stateless**: they receive `answers` (and `ctx` where needed) as arguments. The engine holds no mutable answer state (that stays in `q.html`'s `A`).

### Public API
```js
window.AnestheoQ = {
  VERSION: '1.0.0',

  // Data
  QUESTIONS,                 // the array (each item: {sec,id,label,type,hint?,options?,yn?,bmi?,show?})
  LABELS,                    // { fieldId: 'Human label' } — the single label map

  // Branching / helpers (all take explicit args; no globals)
  isCesarean(ctx),           // ctx = { procedure }
  ageNum(answers),
  bmi(answers),              // number | null
  visibleQuestions(answers, ctx),   // filtered QUESTIONS via each q.show(answers, ctx)
  completionPct(answers, ctx),      // 0–100, same math as q.html updateProgress()

  // Scoring (pure; identical numeric output to current q.html)
  computeScores(answers, ctx),      // { bmi, stopbang, stopbang_risk, ponv, ponv_risk, asa_suggestion, completion }
  computeFlags(answers, ctx)        // [ 'Cardiac disease', ... ]
};
```

> Note: `esc()` stays a per-page helper (it's a DOM/string concern, used widely). The engine does not own it.

---

## Exact source mapping (from current `q.html`)

### MOVES into `questionnaire-engine.js`
| Current in `q.html` | Becomes in engine | Transform required |
|---|---|---|
| `var QUESTIONS = [ ... ]` | `QUESTIONS` | **Change every `show:function(){...}` → `show:function(A, ctx){...}`** and reference the passed args instead of module globals |
| `isCesarean()` | `isCesarean(ctx)` | read `ctx.procedure` instead of `_ctx.procedure` |
| `ageNum()` | `ageNum(answers)` | read `answers.age` instead of `A.age` |
| `bmi()` | `bmi(answers)` | read `answers.height/weight` |
| `visibleQuestions()` | `visibleQuestions(answers, ctx)` | call `q.show(answers, ctx)` |
| `computeScores()` | `computeScores(answers, ctx)` | replace `updateProgress()` call with `completionPct(answers, ctx)` (see below) |
| `computeFlags()` | `computeFlags(answers, ctx)` | call `computeScores(answers, ctx)` internally |
| `LBL` map (inside `renderDone`) | `LABELS` | lift to module scope; `renderDone` references `AnestheoQ.LABELS` |

### STAYS in `q.html` (unchanged logic, only re-pointed to engine)
- `ge`, `esc`
- `_token`, `_preview`, `_ctx`, `A`
- `renderForm(p)`, `renderFields()`, `pick`, `pickSelect`, `setVal`, `branchOnBlur`, `BRANCH_FIELDS` — **untouched** (the fragile focus/branch code)
- `updateBmiLive()` → calls `AnestheoQ.bmi(A)`
- `updateProgress()` → may call `AnestheoQ.completionPct(A, _ctx)` for the number, still updates the DOM bar
- `submitForm()` → calls `AnestheoQ.computeScores(A, _ctx)` + `AnestheoQ.computeFlags(A, _ctx)`; RPC `submit_clinic_questionnaire` unchanged
- `renderDone()`, `renderError()`, the `DOMContentLoaded` token/preview lifecycle — unchanged except `renderDone` uses `AnestheoQ.LABELS`

---

## The one semantically-sensitive refactor: `completion`

Today, `computeScores()` sets `completion: updateProgress()` — i.e. scoring reaches into the DOM (`updateProgress` reads `#q-prog` and mutates it). The engine must be DOM-free, so:

- Add pure `completionPct(answers, ctx)` = `round(answeredVisible / visible.length * 100)`, using `visibleQuestions(answers, ctx)` and the same "non-empty trimmed value" test as the current `updateProgress`.
- `computeScores` uses `completionPct(...)` for its `completion` field.
- `q.html`'s `updateProgress()` (live bar during typing) **remains** in the page and may call `completionPct` internally — its DOM side effects stay in the page.

**Parity requirement:** for any given answers set, `completionPct(A,_ctx)` must return the exact integer the old `updateProgress()` returned. This is the single thing to assert in validation.

---

## `q.html` load-order change

Current head (relevant lines): `…supabase-js CDN → /v2/supabase.js → /v2/styles.css → inline <script>`.
(`q.html` does **not** load `auth.js`/`navbar.js` — it's the no-login page. The engine has no dependency on either, so this stays true.)

**Add one line**, before the inline page script:
```html
<script src="/v2/questionnaire-engine.js"></script>
```
Place it after `/v2/supabase.js` (engine is pure, so exact position only needs to be before the inline script that uses `AnestheoQ`).

---

## Step-by-step execution sequence (when approved)

1. **Create `questionnaire-engine.js`** with the API above. Lift `QUESTIONS`, helpers, scoring, and `LABELS` verbatim, applying only the mechanical `(answers, ctx)` parameterization and the `completionPct` extraction.
2. **Add the `<script>` tag** to `q.html`.
3. **Delete the moved definitions from `q.html`'s inline script** (`QUESTIONS`, `isCesarean`, `ageNum`, `bmi`, `visibleQuestions`, `computeScores`, `computeFlags`, the `LBL` map).
4. **Re-point the remaining `q.html` code** to `AnestheoQ.*`:
   - `renderFields()` iterates `AnestheoQ.visibleQuestions(A, _ctx)`
   - `updateBmiLive()` → `AnestheoQ.bmi(A)`
   - `updateProgress()` → `AnestheoQ.completionPct(A, _ctx)`
   - `submitForm()` → `AnestheoQ.computeScores(A, _ctx)` / `computeFlags(A, _ctx)`
   - `renderDone()` → `AnestheoQ.LABELS`
5. **Do not touch** `renderFields`/`setVal`/`pick`/`branchOnBlur` internals beyond the `visibleQuestions` call.

> Scope guard: this phase modifies **only** `q.html` and **adds** `questionnaire-engine.js`. It does NOT modify `dashboard.html`, `questionnaire.html`, `patient-dashboard.html`, the DB, or any RPC.

---

## Validation (behavior-preserving proof)

Run before/after on the same browser:

1. **Preview parity:** open `q.html?preview=1`. The rendered question set, section order, and field types must be identical to a pre-change screenshot. Submit button shows "Preview only".
2. **Branching parity:** with a real token, exercise each pathway and confirm identical show/hide:
   - Sex = Female → Pregnancy section appears.
   - Age < 18 → Pediatric section appears.
   - Procedure matching cesarean → Delivery section appears.
   - Cardiac = Yes → cardiac detail appears; Lung = Yes → lung detail; Anticoag = Yes → which/last dose.
   - **Focus check:** typing in Age then tabbing out re-branches (the `branchOnBlur` path) exactly as before — cursor/focus behavior unchanged.
3. **Score parity (the critical assert):** for a fixed answer set (e.g. Age 58, Male, 175cm, 120kg, Snore Yes, Cardiac Yes, Anticoag Yes), record `_scores` and `_flags` from a pre-change submission, then confirm the post-change submission writes the **identical** `bmi`, `stopbang`, `stopbang_risk`, `ponv`, `ponv_risk`, `asa_suggestion`, `completion`, and the same `_flags` array.
   - Re-use the Phase 0 SQL (PHASE_0_VERIFICATION §3.4) to read back `questionnaire_answers->'_scores'`.
4. **Completion-number parity:** confirm the live progress bar percentage matches the old behavior at several fill states (this validates the `completionPct` extraction).
5. **End-to-end:** re-run PHASE_0_VERIFICATION §3.1–3.5 once. Doctor still sees the completed result with the same scores/flags/labels.
6. **Console:** no errors; `AnestheoQ.VERSION` resolves in the console.

If any of 1–5 differ, the lift introduced a regression — revert and re-diff.

---

## Rollback

Single-commit revert. The change is additive (new file) + one isolated file edit (`q.html`). Reverting the commit restores the inline definitions and removes the `<script>` tag. No DB or RPC involved, so rollback is instant and total.

---

## Out of scope for Phase 1 (explicit follow-ons)

- **`dashboard.html` label-map consolidation.** `wsPrint()` and `wsDetail()` each hold their own copy of the label map. Re-pointing them to `AnestheoQ.LABELS` removes the remaining 2× duplication — but it touches the doctor dashboard (higher blast radius), so it is a **separate, optional step (1b)** to do *after* Phase 1 is validated, with its own before/after check on the print and summary modals.
- **Moving the DOM form renderer** into the engine (Option B) — deferred; not required for Phase 3.
- **`questionnaire.html` / `preop_questionnaires`** — untouched here; handled in Phases 4–5.
- **Patient-dashboard wiring** — that consumes `AnestheoQ` but is Phase 3.

---

## Risks specific to Phase 1

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | `show()` predicates still reference globals after the move → `ReferenceError` or wrong branching | Medium | Mechanical sweep: every `show` becomes `show(A, ctx)` and uses only its args; validation step 2 catches any miss |
| 2 | `completion` value drifts because `updateProgress()` (DOM) was the old source | Medium | Pure `completionPct` mirrors the exact math; validation step 4 asserts equality |
| 3 | `computeFlags` internally re-calls `computeScores` with a different arg shape | Low | Keep the internal call signature `(answers, ctx)`; validation step 3 asserts identical `_flags` |
| 4 | Load-order: inline script runs before engine defines `AnestheoQ` | Low | Place `<script src="questionnaire-engine.js">` before the inline script (both in `<head>`/end of body as today); engine is synchronous, no defer |
| 5 | Accidental scope creep into the fragile renderer | Medium | Scope guard: do not edit `renderFields`/`setVal`/`pick`/`branchOnBlur` beyond the single `visibleQuestions` call |

---

## Definition of done

- `questionnaire-engine.js` exists, pure, exposing the API above.
- `q.html` loads it and contains **no** local copy of QUESTIONS / scoring / branching / label map.
- All six validation checks pass; scores/flags/labels identical pre vs post.
- Doctor still sees completed questionnaires (PHASE_0 §3.5 re-run).
- No other file or the DB changed.
```
