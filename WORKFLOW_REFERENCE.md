# Anestheo — Patient ↔ Clinician Workflow
## Authoritative Sign-Off Reference (pre-implementation)

```
Version: 1.0
Status: APPROVED
```

*Scope: Priority #1 (stages 1–7) with stages 8–10 specified · Supersedes all prior spine/state drafts · Separate from ARCHITECTURE.md*

> **Load-bearing sections** (changes require re-review): **§1 State Model**, **§3 Invariants**, **§4 Completion Ownership Decision**, **§5 Clinic ↔ Bridge Convergence Decision**.

---

### 1. Single-source-of-truth state model  🔒 LOAD-BEARING

**Two mutable status enums (authoritative). Everything else is derived or set-once.**

| Dimension | Authoritative field | Values |
|---|---|---|
| Attachment | `care_request.status` | requested · accepted · declined · revoked · closed |
| Clinical review | `review_state` | not_submitted · pending · in_review · changes_requested · approved |
| Post-approval lifecycle | set-once milestones | `ready_at` · `completed_at` · `recovery_started_at` · `archived_at` |

**Derived (never written by app code):** `journey_status`, stage, review pill, next-step line, clinician queue label.

**Derived `journey_status`** (top-down, first match):
archived_at→`archived` · recovery_started_at→`in_recovery` · completed_at→`completed` · ready_at→`ready_for_surgery` · review=approved→`plan_approved` · review=changes_requested→`changes_requested` · review=in_review→`in_review` · review=pending→`submitted_for_review` · else→`preparing`.

**Rule:** if `journey_status` is materialized, only a recompute-trigger may write it.

---

### 2. Acceptance scenarios S1–S10

| # | Scenario | Proves |
|---|---|---|
| S1 | Patient-initiated happy path (add→questionnaire→connect→review→approve→ready→completed→recovery) | Full forward spine |
| S2 | Clinic-initiated happy path (create→questionnaire→review→approve→ready) | Clinic path on canonical core |
| S3 | Changes-requested loop (submit→request changes→update→approve) | Bounce loop, versioning |
| S4 | Clinician decline (request→decline→choose another) | Decline never grants access |
| S5 | Clinician switch mid-review (Dr A→Dr B) | Instant access revoke + review reset |
| S6 | Recovery tail (ready→completed→recovery→record) | Terminal chain |
| S7 | Share-code attachment (auto + manual accept) | Path B → canonical core |
| S8 | Cancel pending request | requested→revoked; re-request frees |
| S9 | Post-approval switch + lifecycle close | superseded plan, accepted→closed at archive |
| S10 | Negative guards | submit blocked unless both prereqs; one-active-request |

**Coverage: GREEN** — every authoritative state and transition exercised by ≥1 scenario.

---

### 3. Cross-scenario invariants  🔒 LOAD-BEARING

1. **Access is earned** — a clinician reads a surgery/questionnaire **only** via an `accepted` care_request (now universal, incl. clinic via pre-accept).
2. **One active clinician & one active request** per surgery.
3. **Determinism** — every state yields exactly one pill + a non-empty next-step.
4. **Answer immutability** — only patients edit answers; only clinicians create/approve plans.
5. **Plan versioning** — rejected/withdrawn/superseded drafts never reach the patient; history retained.
6. **Prerequisite gating** — review begins only when questionnaire `submitted` **AND** clinician `accepted` (either order).

---

### 4. Stage-8 completion ownership  🔒 LOAD-BEARING

**Hybrid — clinician-authoritative, patient-confirmed fallback, date-as-trigger-only.**

- Authoritative completion = assigned reviewer **or** operating clinic → `completion_source = clinician_confirmed`.
- Date passing **never** auto-completes; it **triggers a patient prompt**: *"Did your surgery take place?"*
- Patient "Yes" → `patient_reported` completion (unlocks recovery, flagged self-reported, upgradeable to clinician_confirmed).
- Patient "No/postponed" → stays `ready_for_surgery`, prompts date update; nothing marked completed.
- "Any clinician" and "date-alone auto" are **rejected** (access-model / safety).

---

### 5. Clinic ↔ bridge convergence  🔒 LOAD-BEARING

**One canonical core, two thin front-ends.** Clinic creation **=** a `care_request` that starts `accepted` (`origin_method = clinic_created`).

| Converges (identical) | Legitimately differs (edges) |
|---|---|
| care_request · review_state · preparation_plans · ready_at · completion chain | Identity/delivery (account dashboard vs token snapshot + WhatsApp/SMS) |
| | Attachment origination (patient-request vs clinic pre-accept) |
| | **Question schema** (see §10 — the one open dependency) |
| | Physical-visit tracking (`consultation_status`) — **clinic-only, orthogonal** to review |

Reframing also **universalizes Invariant #1** (clinic access now flows through an accepted care_request). Clinic patients may optionally **claim an account** to gain the live experience.

---

### 6. Patient-facing status spine (10 stages)

| # | Stage | Pill | "Who acts next / what's next" |
|---|---|---|---|
| 1 | Surgery Added | 🟡 | Patient → complete questionnaire |
| 2 | Questionnaire | 🟡 | Patient → connect clinician *(parallel to 3)* |
| 3 | Connect Clinician | 🟡 | Patient requests → clinician accepts |
| 4 | Awaiting Review | 🟡 | Clinician → start review |
| 5 | Under Review | 🟢 | Clinician → approve / request changes |
| — | *Requires additional info* | ❌ | Patient → update & resubmit *(transient)* |
| 6 | Preparation Plan Ready | ✅ | Patient → read approved plan |
| 7 | Ready For Surgery | ✅ | Clinic → operate |
| 8 | Surgery Completed | ✅ | Patient/clinician confirm → recovery |
| 9 | Recovery | ✅ | Patient → follow guide / report |
| 10 | Lifetime Anesthesia Record | ✅ | System archives; patient owns forever |

Stages 2 & 3 are **parallel prerequisites**; review starts only when both complete.
Pills: 🟡 Waiting for clinician · 🟢 Under review · ✅ Reviewed · ❌ Requires additional information.

---

### 7. Care-request lifecycle

```
(none) → requested → accepted → revoked        (switch/disconnect → resets review)
                   → declined                  (terminal; clinician never gains access)
        requested → revoked                    (patient cancels pending)
                     accepted → closed         (natural end at archive)
clinic-created: → accepted   (pre-accepted at creation)
share-code:     → requested | accepted(auto)
```
Guards: one active (`requested`/`accepted`) per surgery; only owning doctor accepts/declines; only patient revokes.

---

### 8. Review lifecycle (single source of truth)

```
not_submitted → pending → in_review → approved
                            in_review → changes_requested → pending  (resubmit, same clinician)
any active → not_submitted   (on revoke/switch — atomic with plan supersede)
```
Guards: `pending` requires §3-prereqs (Inv6); `in_review`/`changes_requested`/`approved` require caller = assigned clinician (Inv4).

---

### 9. Plan-approval lifecycle

```
draft (preloaded from educational guide) → approved (vN)   [approve_plan]
prior approved/draft → superseded                          [resubmit / switch]
```
- Plan versions are **immutable snapshots**; each flagged high-risk medication requires a clinician decision before approval.
- Patient reads **only** `approved` versions; drafts/superseded are never patient-visible (Inv5).
- `approve_plan` atomically: writes `review_state=approved` + creates approved `vN`.

---

### 10. Open follow-on dependency

**Question-schema reconciliation** — patient-initiated (`preop_questionnaires`: `history[]`, `medications[]`…) and clinic-initiated (`clinic_patients.questionnaire_answers`: `anticoag`, `cpap`, `snore`…) use **different answer keys**. Until unified into a shared schema (or mapping layer), the prep-guide / medication-decision logic is **origin-specific**. This is the **single substantive data task** remaining for full convergence; it does **not** block Priority #1 (patient-initiated channel), but **must precede** clinic-initiated running on the canonical plan logic.

---

*End of authoritative reference. All state, scenario, invariant, and process decisions above are approved as the basis for implementation. Changes require re-review of the load-bearing sections (§1, §3, §4, §5).*
