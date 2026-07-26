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

Five properties are non-negotiable:

- **It discloses only what genuinely exists.** Every field is optional; an
  absent field is omitted, never filled with "N/A", "TBD", or an invented
  value.
- **It never upgrades a claim.** Founder review is shown as founder review.
  "Validated" appears only with cited external (independent) validation
  (Article 3).
- **Its absence is honest too.** A tool with no published review shows an
  explicit "not yet published" state, not a fabricated one.
- **Every item has a stable identity.** A permanent, human-readable
  **Evidence ID** (§3a) names each evidence-bearing unit for the life of the
  platform, independent of its title, content, or review state.
- **Level describes reality, never rank.** The review type and evidence basis
  (§3b) state *what actually happened* to an item. They are traceability and
  disclosure, never a quality score, ranking, certification, or badge (see
  **Anti-marketing rule**).

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
time** except the item's own identity (**Evidence ID**, always present).

### 3a · Evidence ID (permanent identifier)

Every evidence-bearing unit has a stable, human-readable **Evidence ID**,
assigned once at creation and never changed.

- **Format:** `{TYPE}-{DOMAIN}-{SEQ}` — uppercase ASCII, hyphenated. `TYPE` ∈
  `CALC` (calculator), `REF` (reference), `ASSESS` (assessment rule), plus
  future prefixes for new tool classes; `DOMAIN` is a short topic slug; `SEQ`
  is a zero-padded platform-unique sequence. Examples: `CALC-LA-001`,
  `REF-AIRWAY-001`, `ASSESS-FASTING-001`.
- **Permanent and immutable.** It does not change when the title, content,
  sources, or review change. The display **title is stored separately** and may
  change freely; the ID may not.
- **Unique across the entire platform**, forever.
- **Carries no meaning beyond identity.** It must not contain patient data, and
  must not encode reviewer identity, review type, or publication status — those
  live in their own fields and can change; the ID cannot.
- **Appears in:** review records, change history, the admin interface, API
  responses, and bug reports. It **may** be shown in the public evidence drawer
  as a quiet metadata line (for support and traceability), never as a headline.
- **Retirement keeps the ID.** A retired item retains its original Evidence ID
  permanently.
- **Replacement gets a new ID.** When an item is replaced (not merely revised),
  the replacement receives a **new** Evidence ID and records
  `supersedes_evidence_id` pointing at the item it replaces; the superseded item
  keeps its own ID and its history.

### 3b · Evidence level (three separate fields, not one)

An item's "level" is **not** a single status and **not** a score. Collapsing it
into one field invites misleading combinations (e.g. reading "guideline based"
as "independently validated"). It is therefore modelled as **three orthogonal
fields**, each stating a different fact:

| Field | Controlled values | States |
|---|---|---|
| **`publication_status`** | `draft` \| `published` \| `under_revision` \| `retired` | where the item is in its lifecycle |
| **`review_type`** | `none` \| `founder` \| `internal_clinical` \| `external_clinical` | who (if anyone) has clinically reviewed it |
| **`evidence_basis`** | `source_based` \| `guideline_based` \| `consensus_based` \| `calculation_based` | what the content rests on |

Value definitions (each describes reality only):

- **`publication_status`**
  - `draft` — not published for normal clinical use; evidence or review is
    incomplete. This is the state whenever `review_type = none`.
  - `published` — live for clinical reference use; requires a signed review
    (`review_type ≠ none`) and at least one source.
  - `under_revision` — previously published content is being reassessed. The
    interface must **clearly state** whether the previous version remains
    available or is temporarily withdrawn (`under_revision_prior_state` =
    `available` | `withdrawn`).
  - `retired` — no longer active or recommended for current use; history remains
    available; the Evidence ID is retained.
- **`review_type`**
  - `none` — no review has occurred; the item cannot be presented as reviewed.
  - `founder` — reviewed by the founder acting in a clinical capacity. **Never**
    described as independent, internal-to-a-team, or external.
  - `internal_clinical` — reviewed by another qualified clinician working within
    the project/organisation.
  - `external_clinical` — reviewed by a qualified clinician **independent of the
    product team**. The reviewer relationship must be documented
    (`external_reviewer_relationship`). This is the Constitution's "independent
    review."
- **`evidence_basis`**
  - `source_based` — rests on one or more named sources that are not (all)
    current guidelines.
  - `guideline_based` — the content **directly reflects one or more named
    current guidelines**. This does **not** imply independent product
    validation, and is **not** inferred from the mere presence of a citation.
  - `consensus_based` — reflects genuine, disclosed multi-expert agreement
    (Article 9). **Not available today** — no such consensus exists; the value
    is reserved and may be applied only when real consensus is documented.
  - `calculation_based` — a formula with stated constants (calculators). The
    formula lives in `calculation_basis`; any guideline behind a constant is
    recorded as a source.

**Field-combination rules**

- `review_type` and `evidence_basis` are independent and **coexist**. e.g.
  `review_type = founder` + `evidence_basis = guideline_based` is valid and
  common (founder-reviewed content that reflects a named guideline) — and it is
  **not** the same as, and must never be shown as, external validation.
- `review_type` never auto-upgrades: `founder` is never rendered as
  `internal_clinical` or `external_clinical`.
- `evidence_basis` is set from what the content actually rests on, **never
  inferred from a citation's presence**. A cited item is not automatically
  `guideline_based`.
- Where no review has occurred, the item is `publication_status = draft`,
  `review_type = none`, and cannot be presented as reviewed at any level.
- Historical values are preserved: each `evidence_reviews` row keeps the
  `review_type` and `evidence_basis` that applied at that review (append-only).

### 3c · The disclosure fields

| Field | Meaning | Notes |
|---|---|---|
| **Evidence ID** | Permanent identifier (§3a) | always present; may be shown as a quiet metadata line |
| **Source** (1..n) | Named guideline, textbook, primary literature, or product-labeling reference the item rests on | at least one required to *publish*; each source is its own row |
| **Source version / edition** | The edition or version of that source | per source; omit if unknown |
| **Publication date** | Publication/effective date *of the source* | per source; omit if unknown |
| **Calculation basis** | The formula and constants used (calculators only) | a genuine existing fact for every calculator; e.g. "IBW = 50 (M) / 45.5 (F) + 2.3 kg per inch over 5 ft" |
| **Scope** | What the item covers and for whom | e.g. "Adult, total body weight; not established for paediatrics" |
| **Publication status** | Lifecycle (§3b) | `draft` \| `published` \| `under_revision` \| `retired`; only `published` (and, where prior remains available, `under_revision`) is shown to end users |
| **Review type** | Who reviewed it (§3b) | `none` \| `founder` \| `internal_clinical` \| `external_clinical`; founder is never rendered as internal/external |
| **Evidence basis** | What it rests on (§3b) | `source_based` \| `guideline_based` \| `consensus_based` \| `calculation_based` |
| **Review date** | When *Anestheo* last reviewed this item | distinct from source publication date |
| **Reviewer** | Named person + role | shown with **review type** |
| **External reviewer relationship** | How an external reviewer is independent of the team | required when `review_type = external_clinical`; omitted otherwise |
| **Assumptions** (0..n) | What the output assumes | e.g. "weight basis = total body weight; lean weight in obesity" |
| **Limitations** (0..n) | Where it must not be relied upon | shown beside the output, never buried (Article 4.5) |
| **Notes** (0..1) | Freeform caveat that is not an assumption or limitation | optional |
| **Change history** (0..n) | Dated, attributed record of each revision | append-only (§7) |

**Deliberately excluded** (would invent claims): a positive "validated"
badge (only meaningful if an `external_clinical` review with cited validation
exists), star ratings, confidence scores, adoption counts, "peer-reviewed"
labels, or any single combined "evidence level / grade" that could read as a
rank. None of these can genuinely exist today, so none are fields.

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
│ Review            {Founder-reviewed | Internal clinical      │  ← plain label; omit if review_type=none
│                    review | External clinical review}        │
│ Basis             {Source based | Guideline based | ...}     │  ← plain label; omit if unset
│                                                             │
│ Source            {name} · {version} · {publication date}   │  ← repeats per source
│ Calculation basis {formula / constants}   (calculators)     │
│ Scope             {scope}                                   │
│ Assumptions       • {a} • {b}                               │  ← omit block if none
│ Limitations       • {a} • {b}                               │  ← omit block if none
│ Reviewed          {reviewer name}, {role} · {review date}   │
│ Independent of     {external_reviewer_relationship}          │  ← only when External clinical review
│ Notes             {note}                                    │
│ ▸ Change history  {date — who — summary} (collapsible)      │  ← omit if none
│                                                             │
│ {standing disclaimer — the tool's own}                      │
│ Ref {evidence_id}                                           │  ← quiet, small, for support/traceability
└─────────────────────────────────────────────────────────────┘
```
Row labels are the product's existing dark-theme label style; values are real
selectable text (never baked into an image). The Review and Basis lines are
**plain text rows, not badges** — no colour-as-achievement, no "trust seal", no
ranking; they state a fact and nothing more (see **Anti-marketing rule**). The
Evidence ID is a quiet reference line, never a headline.

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
  id                         uuid primary key default gen_random_uuid(),
  evidence_id                text unique not null,   -- PERMANENT human-readable ID, e.g. 'CALC-LA-001'; never changes
  type                       text not null check (type in ('calculator','reference','assessment_rule','other')),
  title                      text not null,          -- display title; may change freely, stored SEPARATELY from evidence_id
  calculation_basis          text,                    -- calculators only; nullable
  scope                      text,                    -- nullable
  publication_status         text not null default 'draft'
                             check (publication_status in ('draft','published','under_revision','retired')),
  under_revision_prior_state text
                             check (under_revision_prior_state in ('available','withdrawn')),  -- set only while under_revision
  supersedes_evidence_id     text references evidence_tools(evidence_id),  -- a replacement points at what it replaces; nullable
  current_review_id          uuid,                    -- set on publish -> evidence_reviews.id (null => review_type is effectively 'none')
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
-- evidence_id is immutable and carries no reviewer/status meaning; it is the ID used
-- in review records, change history, admin, API responses, and bug reports.

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

-- (c) review records: append-only; a new review supersedes, never edits.
-- Each row also preserves the review_type + evidence_basis that applied at that review.
create table evidence_reviews (
  id                             uuid primary key default gen_random_uuid(),
  tool_id                        uuid not null references evidence_tools(id) on delete cascade,
  reviewer_name                  text not null,
  reviewer_role                  text not null,
  review_type                    text not null
                                 check (review_type in ('founder','internal_clinical','external_clinical')),
  external_reviewer_relationship text,   -- REQUIRED when review_type='external_clinical'; null otherwise
  evidence_basis                 text not null
                                 check (evidence_basis in ('source_based','guideline_based','consensus_based','calculation_based')),
  reviewed_at                    date not null,
  notes                          text,                            -- nullable
  review_status                  text not null default 'published'
                                 check (review_status in ('published','superseded')),
  created_at                     timestamptz not null default now(),
  -- an external review must document how the reviewer is independent of the team:
  check (review_type <> 'external_clinical' or external_reviewer_relationship is not null)
);
-- Note: a review row's review_type is never 'none'; 'none' is the tool-level effective
-- value when current_review_id is null (no published review exists).

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
  `publication_status = 'published'` (and `under_revision` rows whose
  `under_revision_prior_state = 'available'`, which show the prior review under
  an "under revision" banner), their `evidence_sources`, the `current_review_id`
  review with `review_status = 'published'`, that review's `evidence_review_items`,
  and `evidence_change_history`. `draft`, `superseded`, `retired`, and
  `under_revision` items whose prior is `withdrawn` are invisible to `anon` and
  non-admin `authenticated` (a `withdrawn` item exposes only its "temporarily
  withdrawn" state, no content).
- **Writes are admin/reviewer only**, via SECURITY DEFINER RPCs (owner
  `postgres`), matching the product's existing guard-trigger convention so
  protected columns (`evidence_id`, `publication_status`, `current_review_id`,
  `review_status`) are system-managed and cannot be set by ordinary roles.
  `evidence_id` in particular is write-once: it may be set at creation and never
  updated.
- Evidence content is **not patient data** — it carries no assignment scope; it
  is deliberately world-readable once published (it exists to be shown).

### API response shape

`get_evidence(evidence_id)` returns the published item with **only the fields
that exist** — empty values and their labels are absent, not null. Example
(Phase 1, founder-reviewed, guideline-anchored calculator):

```jsonc
{
  "evidence_id": "CALC-LA-001",
  "type": "calculator",
  "title": "Local anaesthetic maximum dose",
  "publication_status": "published",
  "review_type": "founder",           // never upgraded; shown as "Founder-reviewed"
  "evidence_basis": "calculation_based",
  "calculation_basis": "max dose (mg) = weight (kg) × agent limit (mg/kg)",
  "scope": "Adult; total body weight",
  "sources": [
    { "name": "…named guideline…", "version": "…", "source_date": "…" }
  ],
  "reviewer": { "name": "…", "role": "…" },   // review_type=founder → no external_reviewer_relationship
  "reviewed_at": "…",
  "assumptions": [ "weight basis = total body weight" ],
  "limitations": [ "not established for paediatric dosing" ],
  "change_history": [ { "changed_at": "…", "changed_by": "…", "summary": "…" } ]
  // no "notes" key here because none exists; no "validated"/"external" keys ever
}
```

For an item with no review, the response is minimal — `publication_status:
"draft"`, `review_type: "none"` — and the client renders the "not yet published"
state (§6). `evidence_id` is always present.

---

## 6 · Missing information

**Absence is rendered as absence, never as content.** Enforced in two places so
it cannot leak:

1. **API:** `get_evidence(evidence_id)` returns only non-null fields and only
   rows that exist. Empty arrays come back empty.
2. **Renderer:** each row/block is conditionally rendered; a null/empty value
   omits the whole row (label included). No "N/A", "None", "TBD", "0", or em-dash
   filler.

Concrete rules:
- **Evidence ID is always present** and never omitted — it is a real identifier
  assigned at creation, not content that could be missing. It is the one field
  that never disappears.
- No reviewer → the "Reviewed" row is omitted, and `review_type` is `none`.
- No review date → omitted (and, without a review, the item stays `draft` and
  cannot be `published` — see §7).
- No limitations → the Limitations block is omitted (not shown as "none").
- No sources → the item **cannot be published**; publish is blocked.
- `review_type = external_clinical` without a documented
  `external_reviewer_relationship` → **cannot be published as external**; the
  publish is blocked (never shown as independent on an undocumented basis).
- **No review at all** → `publication_status = draft`, `review_type = none`; the
  item cannot be presented as reviewed at any level. The `Check our work`
  control renders the honest state: *"Source and review information is not yet
  published for this tool."* It never shows an empty drawer dressed as evidence,
  and the item carries no review badge.

Never fabricate a source, version, date, reviewer, assumption, limitation, or
evidence level to fill a row. `evidence_basis` is never inferred from a
citation's presence, and `review_type` is never inferred at all — both are set
explicitly by a human or left at their honest default. Silence is permitted;
invention is not (Article 1).

---

## 7 · Review workflow

Roles map onto the current reality (a single founder) without pretending
otherwise.

| Step | Who | Action |
|---|---|---|
| **Author** | content owner | assign a permanent **`evidence_id`** and create `evidence_tools` (`publication_status='draft'`) + `evidence_sources` + a draft `evidence_reviews` with its `evidence_basis`, assumptions, and limitations |
| **Review** | clinician reviewer (today: the founder) | verify against the named sources; set `reviewer_name/role`, `review_type` (**`founder`** today — never `internal_clinical`/`external_clinical`), `evidence_basis`, `reviewed_at`; for `external_clinical`, record `external_reviewer_relationship` |
| **Publish** | admin | set `publication_status='published'` and `current_review_id` → the signed review; append an `evidence_change_history` row (referencing the `evidence_id`) |
| **Revise** | reviewer + admin | set `publication_status='under_revision'` and `under_revision_prior_state` (`available` \| `withdrawn`); **create a NEW `evidence_reviews` row**; mark the prior `review_status='superseded'`; move `current_review_id`; return to `published`; append change history. The old review is retained, not edited |
| **Replace** | admin | when an item is replaced (not revised), create a NEW item with a **new `evidence_id`** and set its `supersedes_evidence_id` to the old one; the old item is retired but keeps its ID and history |
| **Retire** | admin | set `publication_status='retired'`; the item stops presenting as active, keeps its `evidence_id` and history, is marked retired; nothing is hard-deleted |

Invariants (Article 4.9): reviews and change history are **append-only**;
superseded content is retired and marked, never silently overwritten; history —
including each review's historical `review_type` and `evidence_basis` — is
preserved indefinitely. The `evidence_id` never changes across any of these
steps. A founder review is disclosed as `founder`; the day a clinician
independent of the team signs, `review_type='external_clinical'` (with its
relationship documented) and only then may "independently reviewed" appear. An
`under_revision` item must state, in the interface, whether the prior version
remains `available` or is temporarily `withdrawn`.

**Publish gate (extends to all new clinical surfaces in Phase 4):** a tool of
type `calculator`/`reference`/`assessment_rule` may not present a clinical
output in production unless it is `published` (or `under_revision` with prior
`available`) **and** carries a signed review (`review_type ≠ none`) and at least
one source — **or** it visibly carries the "not yet published" state. A `draft`
item is never presented as reviewed at any level. This is the enforcement point
that keeps the platform honest as it grows.

---

## 8 · Implementation phases

Each phase is shippable and independently truthful.

- **Phase 1 — one calculator (end to end).** Ship the schema, RLS, read/write
  RPCs, the shared drawer component, and **one** fully reviewed calculator
  (recommended: Local anesthetic max-dose panel, whose calculation basis is
  explicit). It gets the first Evidence ID — `CALC-LA-001` — with
  `publication_status = published`, `review_type = founder` (labelled
  "Founder-reviewed", never independent), and `evidence_basis =
  calculation_based`, with the guideline behind each mg/kg constant recorded as
  a source. This alone: unblocks homepage **View B**, upgrades homepage
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
- 5 new tables (`evidence_tools`, `evidence_sources`, `evidence_reviews`,
  `evidence_review_items`, `evidence_change_history`).
- Identity + level columns: `evidence_tools.evidence_id` (unique, **write-once**,
  immutable), `publication_status`, `under_revision_prior_state`,
  `supersedes_evidence_id`; `evidence_reviews.review_type`,
  `evidence_basis`, `external_reviewer_relationship` (with the
  external-review CHECK constraint). All controlled-vocabulary via CHECK.
- RLS policies (public-read published / under-revision-available; admin-write).
- SECURITY DEFINER RPCs: `get_evidence(evidence_id)` (read); `create_evidence_tool`
  (assigns the write-once `evidence_id`), `add_evidence_source`,
  `create_evidence_review`, `publish_evidence_review`, `revise_evidence_tool`,
  `replace_evidence_tool` (new id + `supersedes_evidence_id`),
  `retire_evidence_tool` (write, admin-gated).
- One additive migration; then a data-only seed of the Phase 1 tool
  (`CALC-LA-001`) with its real reviewed content. Additive and
  backward-compatible — no existing table changes.

**Frontend**
- A shared `evidence.js` + scoped CSS component: the `Check our work` trigger
  (`aria-expanded`), the drawer/bottom-sheet (focus-trapped, reduced-motion
  aware), and the persistent metadata badge.
- Row renderer that omits empty rows and renders the "not yet published" state.
- Integration points: `engine.html` panel heads (per calculation), reference
  page headers/sections, assessment "surfaced for review" chips.

**API**
- Read path: `get_evidence(evidence_id)` returning only populated fields for
  published items, including `evidence_id`, `publication_status`, `review_type`,
  and `evidence_basis` (usable from the existing `window.sb` client).
- Write path: the authoring RPCs above; no direct table writes from the client.

**Admin interface**
- A new authoring/review screen (sibling to `doctor-approvals.html`): create a
  tool (assign the `evidence_id` once; immutable thereafter and shown in every
  list, record, and history row), add sources, draft assumptions/limitations,
  sign a review (name, role, `review_type`, `evidence_basis`, date, and the
  external-reviewer relationship when applicable), publish, revise/supersede,
  replace (mint a new `evidence_id`), retire, and view change history.
- Read-only history view so superseded reviews — and their historical
  `review_type`/`evidence_basis` — remain inspectable, keyed by `evidence_id`.

**Migration strategy**
- Ship schema + RLS first (no user-visible change).
- Backfill the Phase 1 tool (`CALC-LA-001`) with real, reviewed content.
- Enable the drawer on that one tool, gated on presence of a `published` review;
  everything else continues to show the "not yet published" state.
- Expand per phase. Never expose `draft`, `superseded`, `retired`, or
  `withdrawn`-prior `under_revision` items as published.
- Rollback is a policy/flag toggle (hide the control); data is retained.

---

## Anti-marketing rule

Evidence ID, review type, and evidence basis exist for one purpose:
**traceability and disclosure.** They record what an item is and what has
genuinely happened to it, so a clinician can check our work and a support ticket
can name an exact item.

They must **never** be converted into:

- a **trust score** or numeric grade;
- a **quality ranking** or ordering of items ("best", "gold standard");
- a **promotional badge**, seal, medal, colour-as-achievement, or "verified"
  chip;
- a **comparative claim** against other tools, products, or competitors.

Concretely: the Review and Basis lines render as plain text, never as coloured
"achievement" chips. `guideline_based` is a statement of what the content
reflects, not a mark of validation. `founder` is never softened, upgraded, or
dressed up. The words **verified, validated, certified, approved, gold standard,
trusted** do not appear anywhere in the drawer or its surrounding UI unless a
specific, cited `external_clinical` review separately supports that exact word
(Article 3, Article 6). A higher review type is not "better" — it is simply a
different, documented fact. If any of these fields ever start reading as a
badge, ranking, or boast, the implementation has failed this rule and must be
corrected.

---

## Acceptance (per the Trust Constitution)

A `Check our work` implementation is acceptable only when: every item carries a
permanent, immutable `evidence_id`; every row shown maps to a real stored value;
every absent value omits its row; `publication_status`, `review_type`, and
`evidence_basis` describe reality only and are never combined, coloured, or
ranked into a quality badge; founder review is labelled founder review and never
internal or external; `evidence_basis` is never inferred from a citation and
`guideline_based` never implies independent validation; no
"validated"/"peer-reviewed"/"verified" appears without a cited `external_clinical`
review; the not-yet-published state is honest and unfabricated; historical review
types and bases are preserved append-only; and every published clinical statement
inside the drawer would survive the Trust Test (Article 10): *"If a consultant
anesthesiologist with thirty years of experience challenged this sentence in
public tomorrow, could we defend every word with evidence?"*

*End of specification. Nothing here is implemented. This document is the plan.*
