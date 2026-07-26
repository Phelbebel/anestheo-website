# Evidence Transparency — "Check our work"

**Product feature specification. Not implemented. This document is the implementation plan.**

*Governed by `design-system/TRUST_CONSTITUTION.md` (Articles 3, 4, 5, 7, 9) and
`design-system/FOUNDATION.md`. Where this spec and the Constitution ever
disagree, the Constitution wins.*

Status: **DRAFT SPEC** · Owner: founder · Scope: product (calculators,
references, assessment logic, future tools). This is a backend + frontend +
admin feature. It is **not** a homepage feature; the homepage only *surfaces*
it once it exists.

---

## 1 · Purpose

Every clinical output in Anestheo — a calculator result, a reference
statement, an item an assessment surfaces "for review" — currently appears
with no traceable basis. A user cannot see what it rests on, who checked it,
when, or where it must not be relied upon. The product therefore cannot
honestly say it "shows its work," and the Trust Constitution forbids claiming
otherwise.

**"Check our work" is the mechanism that makes each clinical output
traceable to its basis, from the exact point of use.** Opening it reveals, for
that specific item: its named source(s) and version, the date Anestheo last
reviewed it, who reviewed it (and whether that review was founder/internal or
independent — never conflated), its scope, its assumptions, its limitations,
and its change history.

Three properties are non-negotiable:

- **It discloses only what genuinely exists.** Every field is optional; an
  absent field is omitted, never filled with "N/A", "TBD", or an invented
  value.
- **It never upgrades a claim.** Founder review is shown as founder review.
  "Validated" appears only with cited independent validation (Article 3).
- **Its absence is honest too.** A tool with no published review shows an
  explicit "not yet published" state, not a fabricated one.

This feature operationalises Article 4 (show sources, admit limitations,
distinguish founder from independent review, retire-not-edit) and Article 5
(what a feature does / does not do / who is responsible). It is the single
prerequisite that makes the homepage's Point-of-care section
("Our tools show their work") truthful.

---

## 2 · Which product types use it

The unit that carries an evidence record is a **tool** — any surface that
produces a clinical output. Four types, one contract:

| Type | Concrete examples in the product | Unit of evidence |
|---|---|---|
| **Calculator** | `engine.html` panels: Local anesthetic limits, Derived Values (IBW/LBW/BSA/EBV/MAC), MABL, PACU dosing | one record per calculation/panel (keyed by its formula) |
| **Reference** | `airway.html`, `anticoagulation.html`, and the other topic pages | one record per document; optionally one per `.block` section |
| **Assessment rule** | the logic that flags an item "surfaced for review" in the pre-op review surface (`dashboard.html`) | one record per surfacing rule (what criterion flagged it, and why) |
| **Future tools** | AI features, any new decision-support surface | same contract; **publish gate** applies (§7) — no clinical output ships without a linked evidence record or an explicit not-yet-reviewed state |

Granularity rule: attach evidence at the **smallest stable unit that has its
own source** — a single formula, a single reference document/section, a single
surfacing rule. Do not attach one blanket record to a whole page.

---

## 3 · Minimum metadata model

Only fields that can genuinely exist. Every field is **optional at render
time** except the item's own identity.

| Field | Meaning | Notes |
|---|---|---|
| **Source** (1..n) | Named guideline, textbook, primary literature, or product-labeling reference the item rests on | at least one required to *publish*; each source is its own row |
| **Source version / edition** | The edition or version of that source | per source; omit if unknown |
| **Publication date** | Publication/effective date *of the source* | per source; omit if unknown |
| **Calculation basis** | The formula and constants used (calculators only) | this is a genuine existing fact for every calculator; e.g. "IBW = 50 (M) / 45.5 (F) + 2.3 kg per inch over 5 ft" |
| **Scope** | What the item covers and for whom | e.g. "Adult, total body weight; not validated for paediatrics" |
| **Review date** | When *Anestheo* last reviewed this item | distinct from source publication date |
| **Reviewer** | Named person + role | shown with **review type**, below |
| **Review type** | `founder` \| `internal` \| `independent` | Article 4.10: founder/internal is **never** rendered as independent |
| **Assumptions** (0..n) | What the output assumes | e.g. "weight basis = total body weight; lean weight in obesity" |
| **Limitations** (0..n) | Where it must not be relied upon | shown beside the output, never buried (Article 4.5) |
| **Notes** (0..1) | Freeform caveat that is not an assumption or limitation | optional |
| **Change history** (0..n) | Dated, attributed record of each revision | append-only (§7) |
| **Status** | `draft` \| `in_review` \| `published` \| `retired` | only `published` is ever shown to end users |

**Deliberately excluded** (would invent claims): a positive "validated"
badge (only appears if an `independent` review with cited validation exists),
star ratings, confidence scores, adoption counts, "peer-reviewed" labels. None
of these can genuinely exist today, so none are fields.

---

## 4 · User experience

### Where it appears
- **On each tool/reference/assessment-rule:** a `Check our work` control,
  plus **persistent card metadata** always visible without opening the drawer:
  the primary source name + the last-reviewed date (or, if none, a quiet
  "Review information not yet published").
- **In the assessment surface:** on each "surfaced for review" chip, the
  control opens the rule's basis (what criterion flagged it).
- **On the homepage:** once, as the ethos line — already built; it links to a
  tool where the control genuinely exists. No decorative use elsewhere
  (Article 6 habit: describe, don't laud).

### How the drawer opens
- The control is a real `<button aria-expanded="false" aria-controls="cow-<id>">`.
- Activating it opens an **inline disclosure region** — it never navigates
  away and never covers the output it explains.
- Desktop: a right-aligned drawer or a panel directly beneath the tool.
- Focus moves into the drawer on open; `Esc` closes and returns focus to the
  trigger.

### Drawer layout (rows render top-to-bottom; **any empty row is omitted**)
```
┌ Check our work — {tool title}                      [× close] ┐
│ {review-type badge: "Founder-reviewed" | "Independently     │
│  reviewed" | (omitted if no review)}                        │
│                                                             │
│ Source            {name} · {version} · {publication date}   │  ← repeats per source
│ Calculation basis {formula / constants}   (calculators)     │
│ Scope             {scope}                                   │
│ Assumptions       • {a} • {b}                               │  ← omit block if none
│ Limitations       • {a} • {b}                               │  ← omit block if none
│ Reviewed          {reviewer name}, {role} · {review date}   │
│ Notes             {note}                                    │
│ ▸ Change history  {date — who — summary} (collapsible)      │  ← omit if none
│                                                             │
│ {standing disclaimer — the tool's own}                      │
└─────────────────────────────────────────────────────────────┘
```
Row labels are the product's existing dark-theme label style; values are real
selectable text (never baked into an image). The review-type badge is neutral,
never a "trust seal."

### Mobile behavior
Full-width bottom sheet, scrollable, dismissible by swipe-down / `×` / backdrop
tap. Persistent card metadata stays visible above the sheet. Same row-omission
rules.

### Keyboard accessibility
- Trigger: `Enter`/`Space` toggles; `aria-expanded` reflects state.
- Open drawer: focus trapped within it; `Tab`/`Shift+Tab` cycle; `Esc` closes;
  focus returns to the trigger.
- The collapsible change-history is itself a `<button aria-expanded>` /
  `<details>`.
- The drawer is announced (`role="region"` + `aria-label`), all rows are
  readable prose, contrast meets WCAG AA on the dark surface.

### Reduced-motion behavior
The drawer opens/closes with **opacity only** (or instantly) under
`prefers-reduced-motion: reduce` — no slide, scale, or height animation. In the
default state a short height/opacity ease is acceptable but never required to
read the content.

---

## 5 · Data model

Four concerns, kept separate. Supabase/Postgres, consistent with the existing
RLS + SECURITY DEFINER pattern. **Illustrative DDL — not run.**

```sql
-- (a) tool metadata: the unit evidence attaches to
create table evidence_tools (
  id                uuid primary key default gen_random_uuid(),
  key               text unique not null,      -- stable slug, e.g. 'la-max-dose'
  type              text not null check (type in ('calculator','reference','assessment_rule','other')),
  title             text not null,
  calculation_basis text,                       -- calculators only; nullable
  scope             text,                        -- nullable
  status            text not null default 'draft'
                    check (status in ('draft','in_review','published','retired')),
  current_review_id uuid,                        -- set on publish -> evidence_reviews.id
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- (b) evidence sources: one row per named source; every detail nullable
create table evidence_sources (
  id           uuid primary key default gen_random_uuid(),
  tool_id      uuid not null references evidence_tools(id) on delete cascade,
  name         text not null,                    -- the one required detail
  citation     text,                             -- nullable
  version      text,                             -- nullable (edition/version)
  source_date  date,                             -- nullable (source publication date)
  url          text,                             -- nullable
  sort_order   int  not null default 0
);

-- (c) review records: append-only; a new review supersedes, never edits
create table evidence_reviews (
  id             uuid primary key default gen_random_uuid(),
  tool_id        uuid not null references evidence_tools(id) on delete cascade,
  reviewer_name  text not null,
  reviewer_role  text not null,
  review_type    text not null check (review_type in ('founder','internal','independent')),
  reviewed_at    date not null,
  notes          text,                            -- nullable
  review_status  text not null default 'published'
                 check (review_status in ('published','superseded')),
  created_at     timestamptz not null default now()
);

-- assumptions / limitations / notes: individually omittable, versioned WITH the review
create table evidence_review_items (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references evidence_reviews(id) on delete cascade,
  kind        text not null check (kind in ('assumption','limitation','note')),
  body        text not null,
  sort_order  int  not null default 0
);

-- (d) change history: append-only, human-readable
create table evidence_change_history (
  id          uuid primary key default gen_random_uuid(),
  tool_id     uuid not null references evidence_tools(id) on delete cascade,
  review_id   uuid references evidence_reviews(id),  -- nullable
  changed_at  timestamptz not null default now(),
  changed_by  text not null,
  summary     text not null
);
```

### Access control (RLS)
- **Public read of published only.** Policies expose `evidence_tools` rows with
  `status = 'published'`, their `evidence_sources`, the `current_review_id`
  review with `review_status = 'published'`, that review's `evidence_review_items`,
  and `evidence_change_history`. `draft` / `in_review` / `superseded` /
  `retired` are invisible to `anon` and non-admin `authenticated`.
- **Writes are admin/reviewer only**, via SECURITY DEFINER RPCs (owner
  `postgres`), matching the product's existing guard-trigger convention so
  protected columns (`status`, `current_review_id`, `review_status`) are
  system-managed and cannot be set by ordinary roles.
- Evidence content is **not patient data** — it carries no assignment scope; it
  is deliberately world-readable once published (it exists to be shown).

---

## 6 · Missing information

**Absence is rendered as absence, never as content.** Enforced in two places so
it cannot leak:

1. **API:** `get_evidence(key)` returns only non-null fields and only rows that
   exist. Empty arrays come back empty.
2. **Renderer:** each row/block is conditionally rendered; a null/empty value
   omits the whole row (label included). No "N/A", "None", "TBD", "0", or em-dash
   filler.

Concrete rules:
- No reviewer → the "Reviewed" row is omitted.
- No review date → omitted (and, without a review, the tool cannot be
  `published` — see §7).
- No limitations → the Limitations block is omitted (not shown as "none").
- No sources → the tool **cannot be published**; publish is blocked.
- **No published review at all** → the `Check our work` control renders the
  honest state: *"Source and review information is not yet published for this
  tool."* It never shows an empty drawer dressed as evidence, and the tool must
  not carry a "reviewed" badge.

Never fabricate a source, version, date, reviewer, assumption, or limitation to
fill a row. Silence is permitted; invention is not (Article 1).

---

## 7 · Review workflow

Roles map onto the current reality (a single founder) without pretending
otherwise.

| Step | Who | Action |
|---|---|---|
| **Author** | content owner | create `evidence_tools` (draft) + `evidence_sources` + a draft `evidence_reviews` with its assumptions/limitations |
| **Review** | clinician reviewer (today: the founder) | verify against the named sources; set `reviewer_name/role`, `review_type` (**`founder`** today — never `independent`), `reviewed_at` |
| **Publish** | admin | set `evidence_tools.status='published'` and `current_review_id` → the signed review; append a `evidence_change_history` row |
| **Update** | reviewer + admin | **create a NEW `evidence_reviews` row**; mark the prior `review_status='superseded'`; move `current_review_id`; append change history. The old review is retained, not edited |
| **Retire** | admin | set `status='retired'`; the tool stops showing evidence and is marked retired; nothing is hard-deleted |

Invariants (Article 4.9): reviews and change history are **append-only**;
superseded content is retired and marked, never silently overwritten; history is
preserved indefinitely. A single reviewer is disclosed as such; the day an
independent reviewer signs, `review_type='independent'` and only then may
"independently reviewed" appear.

**Publish gate (extends to all new clinical surfaces in Phase 4):** a tool of
type `calculator`/`reference`/`assessment_rule` may not present a clinical
output in production unless it has a `published` evidence record **or** it
visibly carries the "not yet published" state. This is the enforcement point
that keeps the platform honest as it grows.

---

## 8 · Implementation phases

Each phase is shippable and independently truthful.

- **Phase 1 — one calculator (end to end).** Ship the schema, RLS, read/write
  RPCs, the shared drawer component, and **one** fully reviewed calculator
  (recommended: Local anesthetic max-dose panel, whose calculation basis is
  explicit). This alone: unblocks homepage **View B**, upgrades homepage
  **View A** from empty-state to the full rigor object, and makes
  "Our tools show their work" true for at least one tool.
- **Phase 2 — clinical references.** Attach evidence to reference documents
  (and, where useful, `.block` sections). Enables homepage **View C** to show
  real source/version/review metadata instead of structure-only.
- **Phase 3 — assessment logic.** Attach evidence to each surfacing rule; the
  assessment drawer explains *why* an item was surfaced for review, reinforcing
  "surfaced, not decided."
- **Phase 4 — entire platform + publish gate.** Every calculator, reference,
  assessment rule, and future/AI tool carries an evidence record or the
  not-yet-published state; the publish gate (§7) is enforced in CI/authoring so
  no unreviewed clinical output can ship silently.

---

## 9 · Summary of changes required

**Database**
- 4 new tables (`evidence_tools`, `evidence_sources`, `evidence_reviews`,
  `evidence_review_items`, `evidence_change_history` — 5 including the review-items
  child).
- RLS policies (public-read-published; admin-write).
- SECURITY DEFINER RPCs: `get_evidence(key)` (read); `upsert_evidence_tool`,
  `add_evidence_source`, `create_evidence_review`, `publish_evidence_review`,
  `retire_evidence_tool` (write, admin-gated).
- One additive migration; then a data-only seed of the Phase 1 tool's real
  reviewed content. Additive and backward-compatible — no existing table changes.

**Frontend**
- A shared `evidence.js` + scoped CSS component: the `Check our work` trigger
  (`aria-expanded`), the drawer/bottom-sheet (focus-trapped, reduced-motion
  aware), and the persistent metadata badge.
- Row renderer that omits empty rows and renders the "not yet published" state.
- Integration points: `engine.html` panel heads (per calculation), reference
  page headers/sections, assessment "surfaced for review" chips.

**API**
- Read path: `get_evidence(key)` returning only populated fields for published
  tools (usable from the existing `window.sb` client).
- Write path: the authoring RPCs above; no direct table writes from the client.

**Admin interface**
- A new authoring/review screen (sibling to `doctor-approvals.html`): create a
  tool, add sources, draft assumptions/limitations, sign a review (name, role,
  type, date), publish, supersede/update, retire, and view change history.
- Read-only history view so superseded reviews remain inspectable.

**Migration strategy**
- Ship schema + RLS first (no user-visible change).
- Backfill the Phase 1 tool with real, reviewed content.
- Enable the drawer on that one tool, gated on presence of a `published` review;
  everything else continues to show the "not yet published" state.
- Expand per phase. Never expose `draft`/`in_review`/`superseded` as published.
- Rollback is a policy/flag toggle (hide the control); data is retained.

---

## Acceptance (per the Trust Constitution)

A `Check our work` implementation is acceptable only when: every row shown maps
to a real stored value; every absent value omits its row; founder review is
labelled founder review and never independent; no "validated"/"peer-reviewed"
appears without a cited independent review; the not-yet-published state is honest
and unfabricated; and every published clinical statement inside the drawer would
survive the Trust Test (Article 10): *"If a consultant anesthesiologist with
thirty years of experience challenged this sentence in public tomorrow, could we
defend every word with evidence?"*

*End of specification. Nothing here is implemented. This document is the plan.*
