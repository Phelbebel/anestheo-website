# Verification gates, approval state, OAuth onboarding, admin capability

Audit only. No SQL written or run, no code changed, nothing merged.
Baseline: `main` @ `123fbbb` + branch `claude/prep-plan-patient-guide-uo5xM` @ `d1ec7a2`.

New product decision applied as the lens throughout: **manual approval no longer
gates ordinary doctor product access.** Verification becomes an optional
"Verified Clinician" status that controls trust-facing features only.

---

## 0. A correction to my own earlier count

I previously reported "26 `is_verified_doctor()` call sites across 6 files".
That number counted comment lines and non-enforcement references. The accurate
inventory, re-derived line by line:

| Kind | Count |
| --- | --- |
| Textual references to `is_verified_doctor` in `*.sql` | 21 |
| — of which definition / `REVOKE` / `GRANT` | 3 |
| — of which preflight `to_regproc` existence checks | 3 |
| **Enforcement call sites** | **15** |
| Plus the same rule written as an inline literal | 1 |
| **Total verification gates keyed on "approved"** | **16** |

And separately — this is the part that actually blocks a doctor today:

| Kind | Count |
| --- | --- |
| RESTRICTIVE `*_require_verified` policies (`NOT is_pending_doctor()`) | **33** |
| — `v2_auth_onboarding.sql` (12 clinical tables) | 12 |
| — `v3_anesthesia_record.sql` `anesthesia_cases` | 1 |
| — `v3_anesthesia_record.sql` 19 child tables (loop) | 19 |
| — `v3_anesthesia_record.sql` `anesthesia_amendments` | 1 |

**The 33 restrictive policies are the wall. The 16 `is_verified_doctor()` sites
are mostly write-narrowing on top of it.** Removing the 16 without the 33 changes
nothing for a pending doctor — they would still read zero rows. That ordering
matters for the migration and is why the table below is not the whole answer.

`v4_3_function_hardening.sql:89` adds a 34th (`patient_record_readable`), but you
instructed that v4_2/v4_3 were never run, so I have treated it as **not
installed** and excluded it. Confirm before writing the migration.

---

## 1. The verification gate table

Classification: **A** = should become account-role based · **B** = genuine trust
gate, keep verification · **C** = obsolete / duplicated.

### `is_verified_doctor()` enforcement sites

| # | File:line | Function / policy | Purpose | Operation | → `is_doctor_account()`? | Class | Why | Security consequence of changing it |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `v3_1:81` | `anesthesia_case_access(uuid)` | Who may READ an anesthesia case | SELECT (cases + all 19 children + amendments + audit) | **Yes** | **A** | Reading the chart you are the anesthesiologist of record on is the core of the workspace. The ownership clauses beside it (`anesthesiologist_id = auth.uid()`, trainee, treating relationship) already scope it to your own patients. | **None.** Ownership is unchanged; the only widening is that an unverified doctor can read *their own* cases. They can only have their own cases if #7 also changes, so this is self-consistent. |
| 2 | `v3_1:110` | `anesthesia_case_editable(uuid)` | Who may CHART | UPDATE/INSERT/DELETE on children | **Yes** | **A** | Charting is the product. Narrowed already to the anesthesiologist of record or a named trainee on an open case. | **None beyond intent.** The record still names its author (`entered_by = auth.uid()`), the audit trigger still fires, and finalization is still one-way. What changes is that an unverified doctor's chart is not stamped by a verified one — a *provenance* question, answered by #16, not an access one. |
| 3 | `v3_1:275` | `anesthesia_amend_case(...)` RPC | Amend a finalized record | INSERT amendment | **Yes** | **A** | An amendment corrects your own signed record. Refusing it leaves a known-wrong finalized chart standing, which is worse. | **None.** Amendments append, never overwrite; author, time and reason are all recorded. |
| 4 | `v3_1:313` | `anes_amend_insert` policy | Same rule at the table | INSERT | **Yes** | **A** | Must move together with #3 or the RPC succeeds and the policy refuses. | **None** — it mirrors #3 exactly. Changing one without the other is the actual risk. |
| 5 | `v3_1:331` | `anesthesia_set_trainee(...)` RPC — *caller* test | Who may change the anesthesia team | UPDATE `trainee_id` | **Yes** | **A** | The caller is already required to be `anesthesiologist_id` on an open case. | **None.** The *target* test (#16) is the one that matters and is classified separately. |
| 6 | `v3:202` | `anesthesia_case_editable(uuid)` | Superseded definition | — | n/a | **C** | `v3_1:110` replaces this body via `CREATE OR REPLACE`. The live database runs v3_1's. | **Real trap:** re-running `v3_anesthesia_record.sql` silently *reverts* the V5 hardening — v3's version grants CHART to any treating doctor, v3_1's narrows it to the anesthesiologist of record and named trainee. Delete this block or add a guard. |
| 7 | `v3:753` | `anes_case_insert` policy | Open a new anesthesia case | INSERT | **Yes** | **A** | This is "start a chart", the single most basic doctor action. Pinned to `anesthesiologist_id = auth.uid() AND created_by = auth.uid()`. | **None.** A case cannot be opened in someone else's name either way. Note: `anesthesia-cases.html` currently closes this action for unapproved doctors — that UI restriction should be lifted **in the same release**, not before. |
| 8 | `v3:765` | `anes_case_update` `WITH CHECK` | What a case may become | UPDATE | **Yes** | **A** | `USING` is already `anesthesia_case_editable(id)`; this only stops an editable case being updated into a disallowed state. | **None.** It is a redundant restatement of #2 in the same statement. |
| 9 | `v3:814` | `anes_amend_insert` policy | Superseded | — | n/a | **C** | Replaced by `v3_1:313`, which adds `status = 'finalized'`. Same re-run trap as #6. | Re-running v3 would allow amendments on **draft** records again — an amendment trail implying a formality that never happened. |
| 10 | `v3:939` | `anesthesia_finalize_case(...)` RPC | Sign the record | UPDATE → `finalized` | **Yes** | **A** | Finalizing your own chart is a normal end-of-case action. `finalized_by` is written server-side and cannot be forged. | **None for access.** But see #16 — finalization is where *provenance* is captured, so this is where a `finalized_by_verified` fact should be recorded rather than refused. |
| 11 | `v3:971` | `anesthesia_amend_case(...)` RPC | Superseded | — | n/a | **C** | Replaced by `v3_1:275`. Same re-run trap. | Re-running v3 loses the "must be finalized" guard added by v3_1. |
| 12 | `v4_1:318` | `recycle_bin_list()` | Who sees the Recycle Bin | SELECT (function-returned) | **Yes** | **A** | The bin lists records *you* deleted. Returns an empty set rather than an error for anyone else. | **None.** The body still filters to `assigned_doctor_id = auth.uid()` / `doctor_id = auth.uid()` per row. This is the gate that currently makes the doctor dashboard's Recycle Bin come back empty for a pending doctor. |
| 13 | `v4:158` | `patient_record_manageable(text,uuid)` | Archive / delete / restore a journey or clinic patient | UPDATE lifecycle columns | **Yes** | **A** | Managing the patients you were assigned is ordinary workspace work. Ownership is checked in the same expression. | **None.** This predicate feeds `patient_lifecycle_eligibility()`, which is what the dashboard's Archive/Delete menu calls — so changing it is what actually makes those buttons work for a new doctor. |
| 14 | `v6:389` | `hp_clinician_may_read(uuid)` | Doctor reads a **patient's** Health Passport | SELECT | **No** | **B** | This is the one place a doctor reads a record belonging to *another person* on the strength of being a clinician. The treating relationship narrows *which* patient; verification is what says the reader is a real clinician at all. A patient sharing an allergy list has a reasonable expectation that the person reading it was checked. | Changing it to `is_doctor_account()` would let a self-declared doctor read the passports of any patient they can form a treating relationship with — and a clinic patient can be **self-created** (`clinic_patients` INSERT by the doctor). That is a self-serve path to other people's medical data. **Keep verification.** |
| 15 | `v6:585` | `hp_verify_item(uuid,boolean)` | Stamp a passport entry `clinician_verified` | UPDATE | **No** | **B** | The whole value of the flag is that a checked clinician confirmed it. An unverified doctor marking entries "clinician verified" makes the badge meaningless and is actively misleading to the next reader. | Changing it destroys the meaning of the only clinical-provenance flag the Health Passport has. **Keep verification.** |
| 16 | `v3_1:344` | `anesthesia_set_trainee` — *target* test (inline `p.verification_status = 'approved'`) | Who may be **added to a team** | UPDATE `trainee_id` | **No** | **B** | Naming someone as a co-author of a clinical record is a statement about *them*, not about you. It is also the exact hole V1 closed at the other end. | Relaxing it lets any doctor attach any self-declared doctor account to a real chart, which launders unverified authorship into a verified doctor's record. **Keep verification** — and note it is written as a literal, not via the predicate, so a migration that only rewrites `is_verified_doctor()` will miss it. |

**Summary: 10 × A, 3 × B, 3 × C.**

### The 33 RESTRICTIVE policies — the actual wall

| File | Tables | Predicate | Class | Why |
| --- | --- | --- | --- | --- |
| `v2_auth_onboarding.sql:329` | `care_requests`, `clinic_patients`, `patient_archive_audit`, `patient_recommendations`, `patient_surgeries`, `preop_checklist`, `preop_questionnaires`, `preparation_plans`, `question_replies`, `questions`, `questionnaire_templates`, `requirement_documents` (12) | `NOT is_pending_doctor()` | **A** | These are the doctor's own workspace tables. This is what makes a new doctor's dashboard render empty. Must be **dropped**, not rewritten — the permissive policies underneath already scope every one of them to the caller. |
| `v3_anesthesia_record.sql:772, 800, 820` | `anesthesia_cases` + 19 children + `anesthesia_amendments` (21) | `NOT is_pending_doctor()` | **A** | Same reasoning, for the chart. Must be dropped together with #1/#2/#7 or the chart stays empty regardless. |

**These 33 are step one of any migration.** Rewriting the 16 predicates while
leaving the 33 in place would produce a doctor who is permitted everything and
can still read nothing — which is exactly the failure mode of a
frontend-only fix, moved into SQL.

### Two gates NOT in the inventory that the new model **tightens**

| Where | Now | Under the new model |
| --- | --- | --- |
| `v2_bridge_directory_rpcs.sql:94` `get_clinician_directory()` | `WHERE accepting_patients = true AND (role='doctor' OR is_admin=true)` — **no verification check at all** | **Must gain one.** The public directory is the definitive trust surface. Today the approval wall hid this by keeping unverified doctors out of Settings; once they can reach Settings, ticking one checkbox puts an unchecked account in front of patients. This is a **regression risk created by the new model**, and it must ship in the same migration. |
| `v2_bridge_directory_rpcs.sql` `request_clinician()` | Patient picks from the directory | Inherits the fix above. |

---

## 2. Bug A — approval "visually stays PENDING": root cause

**Not the RPC. Not the GRANT. Not a stale UI. The approval is genuinely being
reverted afterwards — by the doctor's own next profile save.**

Traced end to end, then reproduced on the local PostgreSQL replica.

**What I ruled out, with evidence:**

* *RPC write* — `admin_set_verification` executed as an admin on the replica
  returned `{"ok": true, "verification_status": "approved"}` and the row changed.
* *GRANT* — the call succeeded under `SET ROLE authenticated`; a missing EXECUTE
  would have raised `42501`.
* *Read-back* — the admin re-read the row through RLS (26 rows visible via
  `profiles_admin_read`) and saw `approved`. The doctor re-read their own row and
  saw `approved`, with `is_verified_doctor() = true`.
* *Stale UI* — `acVerify`, the row buttons and the bulk runner all
  `await acRpc(...); await loadAll(); acSelClear(); await render();`.
  `fetchTable()` is a fresh query with no caching, and `loadAll()` rebuilds
  `AC.profById` (`admin.html:1078`). `getProfile()` in `auth.js` is uncached.
* *Different state sources* — `vSearch` uses the `admin_search` RPC rather than
  `AC.db`, but it is an async view re-invoked by `render()`, so it refreshes too.

**What actually happens** — `guard_profiles_self_update()`
(`v2_auth_onboarding.sql:162`) resets an approved doctor to `pending` whenever a
self-service UPDATE changes any of seven fields. `settings.html saveDoctorData()`
sends **all eight professional fields on every save, whether they changed or
not**, and three of them are read by a *separate, best-effort query*
(`settings.html:700–708`) whose failure path silently leaves the inputs empty:

```js
try {
  var extra = await window.sb.from('profiles')
    .select('professional_level,medical_license_number,medical_university')
    .eq('id', user.id).maybeSingle();
  if(!extra.error && extra.data){ …populate three inputs… }
} catch(e){ /* leave those fields empty rather than fail the page */ }
```

Empty input → `'' || null` → `null` written over a real value → three watched
fields change → **silently un-approved, and the licence number is wiped.**

Reproduced on the replica (`ROLLBACK`ed):

```
=== state after an admin approves ===  approved
=== doctor saves their profile from settings.html (only the phone edited) ===
=== state AFTER that save ===
 verification_status | professional_level | medical_license_number | medical_university | specialty
 pending             |                    |                        |                    |
 is_verified_doctor()=false   is_pending_doctor()=true
```

**Three independent frontend triggers, all live today:**

1. **The silent `try`/`catch` above.** Any transient failure of that second query
   blanks three watched fields.
2. **`<select>` value mismatch.** `d-specialty` and `d-country` are closed
   `<select>`s; assigning a value that is not in the option list silently leaves
   them at `''`. This is reachable *right now*, because the Admin Center's edit
   dialog writes `specialty`, `hospital` and `country` as **free text**
   (`admin.html acEdit`, `type:'text'`) through
   `admin_update_profile_fields`, which validates none of them. An admin tidying
   a specialty string un-approves the doctor on their next save.
3. **Unconditional full-payload save.** `saveDoctorData()` never diffs against
   what it loaded, so every one of the seven watched fields is a candidate.

**The rule itself is correct and must stay.** The defect is that the client can
send a NULL it never meant to send, and that nothing tells anyone it happened.

**Fix shape** (frontend, plus one server-side belt-and-braces — not written yet):

* Send only fields that actually changed, diffed against the loaded row.
* Never write `null` over a non-null watched field from a control that failed to
  populate; if the professional-fields read fails, disable the form and say so.
* Make the two `<select>`s tolerant: if the stored value is not in the list,
  inject it as an option and select it rather than falling back to `''`.
* Consider a server-side guard: ignore a self-update that sets a watched field
  from non-null to NULL, or require an explicit intent flag. Cheap, and it makes
  the whole class of client bug non-destructive.

---

## 3. Bug B — OAuth doctor onboarding: root cause

**The OAuth path is not the problem. The problem is that "required onboarding
fields" are enforced only in the browser — and the new model removes the human
who used to catch that.**

Traced: `signInWithProvider()` (`auth.js:613`) → `auth-callback.html`
`waitForSession(8000)` → `resolveAuthDestination()` → `role-select.html` when
`role='pending'`. `handle_new_user()` (`v2_profiles_migration.sql:33`) inserts
`role='pending', verification_status='not_required'`; `ensureProfile()` forces the
same values and **returns early when a row already exists**, so it never
overwrites anything. No provider metadata is read anywhere. That part is sound.

**Gap 1 — enforcement is client-side only.**
`set_own_role('doctor')` (`v2_security_hardening.sql:185`) validates the role
string, refuses `admin`, refuses admin callers, sets
`verification_status='pending'` — and requires **no professional field
whatsoever**. `submitDoctor()` in `role-select.html` validates all eight fields,
but that is a browser check. `sb.rpc('set_own_role',{p_role:'doctor'})` typed in a
console produces a doctor account with a completely empty professional file.

Under the old model an administrator reviewed every such account before it could
do anything. **Under the new model that account gets the workspace immediately.**
This is the single most important consequence of the product decision, and it
applies equally to email/password — OAuth is not special, it is just the path
where I expected the difference to be.

**Gap 2 — non-atomic onboarding.** `submitDoctor()` calls `setOwnRole('doctor')`
*then* `saveProfile(...)`. If the second call fails the account is already a
doctor with no details; the page says so honestly, but the state persists and
nothing ever asks again. Ordering is deliberate and correct (the privileged call
first), but it needs to be one transaction.

**Gap 3 — the roleless account had no route back.** Fixed on the current branch:
`index.html renderAppHome()` and `navbar.js nbGoWorkspace()` now send a
`role='pending'` account to `/role-select.html` instead of rendering it the
clinician home.

**Fix shape** — replace `set_own_role('doctor')` for the doctor case with one
`submit_doctor_onboarding(p_full_name, p_professional_level, p_country, p_phone,
p_license, p_hospital, p_university, p_specialty)` RPC that validates every
required field server-side and writes role + fields atomically. Email/password
and OAuth then land on identical, enforced onboarding by construction rather than
by both remembering to. `set_own_role` keeps handling `patient` and the rest.

---

## 4. Bug C — admin capability map

`admin_assert_target()` / `assert_admin()` gate every one of these, and each
writes an `admin_audit_log` row.

| Capability | Today | Mechanism | Needed |
| --- | --- | --- | --- |
| `full_name` | ✅ | `admin_update_profile_fields` | — |
| `phone` | ✅ | same | — |
| `country` | ✅ | same | — |
| `hospital` | ✅ | same | — |
| `specialty` | ✅ | same | — |
| `medical_license_number` | ✅ | same | — |
| `bio`, `city` | ✅ | same | — |
| **`professional_level`** | ❌ `42501` | allowlist at `v2_admin_phase2.sql:358` predates the column (`v2_auth_onboarding.sql:60`) | **Allowlist entry.** Prepared, unapplied, in `v8_admin_profile_fields.sql`. |
| **`medical_university`** | ❌ `42501` | same | same |
| **`avatar_url`** | ❌ | no RPC | **New RPC.** Not an allowlist entry: removing a photo is a moderation act that must decide whether the Storage object is deleted with the row, and `avatar_url` is a signed-path reference, not free text. Needs `admin_clear_avatar(p_target, p_reason)` — clears the column, deletes the object, writes one audit row. |
| `role` | ✅ (except `admin`) | `admin_change_role`, reason required | Under the new model this RPC **must change**: it currently forces `verification_status='pending'` when setting `role='doctor'`, which under "verification is optional" is no longer the right default. |
| Account status (suspend / ban / reactivate) | ✅ | `admin_set_account_status`, reason + optional expiry | — |
| `verification_status` | ✅ 5 states | `admin_set_verification` (phase 3 body wins over phase 2) | — |
| Verification notes | ✅ | `admin_add_verification_note` → `verification_notes` | — |
| Document requests | ✅ | `admin_request_documents` — **also sets `verification_status='changes_requested'`** | Under the new model this side effect becomes wrong: requesting optional evidence should not change the account's state. |
| Verification documents (view) | ✅ | `AC.docOpen`, 5-minute signed URL | — |
| Soft delete | ✅ | `admin_soft_delete_account` | — |
| Restore | ✅ | `admin_restore_account` | — |
| Permanent purge | ✅ | `admin_purge_account`, typed confirmation | — |
| Doctor reassignment | ✅ | `admin_assign_doctor`, `admin_reassign_doctor_patients` | — |
| `is_admin` grant/revoke | ❌ by design | none | Keep as a deliberate database action. |
| **Auth email** | ❌ by design | none | **Leave it.** It lives in `auth.users` and only the Admin API (service-role key) can change it. There is no server component in this deployment, so any mechanism would mean shipping a service-role key or standing up an Edge Function. Out of scope, and correctly so. |
| **Auth password** | ❌ by design | none | Same. The supported path is the user's own reset link. |

**Why each gap needs an RPC rather than a direct write:** `profiles` is protected
by `trg_guard_profiles_self_update`, which rejects any privileged column for the
`authenticated` role. A `SECURITY DEFINER` RPC is the only way past it, and it is
also the only place `admin_log()` is guaranteed to run — so "audited" and
"permitted" are the same mechanism rather than two things that can drift apart.

---

## 5. Bug D — Health Passport: root causes

**The doctor → dashboard redirect.** `patients.html renderHpFeature()` was keyed
on the rendered **view** (`home` for patients, `guest` for staff) rather than on
whether a session existed. Staff got the guest branch, whose CTA is a
`<button onclick="nbOpenModal()">`; `nbOpenModal()` on an authenticated session
calls `nbGoWorkspace()`, which sends staff to `/dashboard.html`. So the button
labelled "Create my Health Passport" opened the doctor workspace.

Fixed at `123fbbb`: `renderHpFeature(view, hasSession)`, with `showGuest(true)` on
the staff path (`patients.html:270–303`). Held by `roleindep.js`, 127 checks.
**No role-based redirect remains on any Health Passport entry point** — verified
across `patients.html`, `patient-dashboard.html`, the navbar account menu, and
`health-passport.html` itself, which is guarded by `requireAuth()` only, with no
role test.

**The duplicate create step.** `health-passport.html render()` showed an empty
state whose only action was a second button with the *same label* as the CTA that
brought the person there, calling `createPassport()` → one `HP.create()` INSERT
with no input at all.

Fixed on the current branch: the intent travels with the link as `?create=1`, and
the page creates and drops straight into the editor. Without the flag nothing is
written — arriving from a bookmark or the account menu is not a request to write
to your own medical record.

**Existing-passport labels** are now *Show my QR* / *Set up my emergency QR* /
*Open my passport* / *Edit my passport*. This also fixed a second bug in the same
family: `patient-dashboard.html:2070` offered "Create my Health Passport" to
someone who already had one, because it was keyed on whether the QR was switched
on rather than on whether the passport existed.

**The em dash** is replaced with a comma in `patients.html:248` and
`patient-dashboard.html:2079`. The third instance is in `index.html` on the
unmerged `claude/homepage-redesign` branch and travels with it — deliberately not
touched, per your instruction to keep that branch separate.

---

## 6. Bug E — Live Tools: entry-point map

**Nothing to remove. It is already gone.** Verified across the whole tree:

* `grep -rn "<iframe" *.html` → **zero matches anywhere in the repository.**
* `?embed=1` → **zero live occurrences.** The only three hits are historical
  comments in `dashboard.html:3455` and `engine.html:3089–3092` recording that
  the branch was deleted, and with it a role-check bypass — the `?embed=1` branch
  used to `return` *before* `requireRole('staff')`.
* No nested navbar: `engine.html` contains exactly one navbar mount point.

Every launcher, all plain navigations to the standalone workspace:

| Location | Element |
| --- | --- |
| `dashboard.html:3420` | `<a class="ws-sig" href="/engine.html">` — sidebar signature card |
| `dashboard.html:3462` | `<a class="ws-launch" href="/engine.html">` — the panel that replaced the iframe |
| `index.html:709, 749, 787` | public marketing CTAs |
| `index.html:1109` | authenticated clinician home |
| `navbar.js:398` | desktop primary nav (doctor) |
| `navbar.js:488` | mobile nav |
| `navbar.js:664, 672, 685` | workspace switcher (doctor and admin sets) |
| `navbar.js:872` | global clinical search result |
| `clinical-search.js:18` | `ENGINE = '/engine.html'` |

**Live Chart is separate and stays separate.** The only shared surface is
`nbToolsBar()` (`navbar.js:694`) — a two-link section strip, *Live Tools* ·
*Live Chart*, rendered by the tool pages themselves rather than injected into the
site chrome, and shown on `engine.html` and `anesthesia-cases.html` only. That is
a section nav, not a second navbar, and I would keep it.

---

## 7. Proposed migration architecture

Not written. For your approval before any SQL exists.

**Shape: one new predicate, then three ordered phases.**

```
is_doctor_account()   role = 'doctor'                    -- exists already
is_verified_doctor()  role = 'doctor' AND approved       -- exists, meaning narrows
is_pending_doctor()   role = 'doctor' AND NOT approved   -- becomes UNUSED
```

`is_verified_doctor()` is **not** redefined. Its meaning becomes "holds the
optional Verified Clinician status", which is what the three B-class gates and
the directory need. Redefining it in place would silently relax #14, #15 and #16
along with everything else — the exact mistake to avoid.

**Phase 1 — drop the wall (33 policies).**
`DROP POLICY <t>_require_verified` on all 33 tables. Nothing is rewritten; the
permissive policies underneath already scope every table to the caller.
Reversible by re-running the creating loops. This alone is what makes a new
doctor's workspace non-empty, and it is the whole of the access change.

**Phase 2 — re-point the 10 A-class gates (`is_verified_doctor` →
`is_doctor_account`).** Five function bodies (#1, #2, #12, #13, and
`anesthesia_case_editable`) and five policies/RPCs (#3+#4 together, #5, #7, #8,
#10). Each is a `CREATE OR REPLACE` of a body already in the repository with one
identifier changed. **#3 and #4 must move in the same transaction** or the RPC
and the policy disagree.

**Phase 3 — resolve the C-class and close the directory gap.**
* Guard or delete the three superseded blocks (#6, #9, #11) in
  `v3_anesthesia_record.sql`, so re-running it can never revert the v3_1
  hardening. This is a **repository** change, not a database one.
* Add the missing verification check to `get_clinician_directory()`. This is the
  new model's *tightening* and must not be deferred.
* Amend `admin_change_role` so `role='doctor'` no longer forces
  `verification_status='pending'`.
* Amend `admin_request_documents` so requesting optional evidence no longer
  rewrites `verification_status`.

**Separately, and arguably before all of it — onboarding integrity.**
`submit_doctor_onboarding(...)` as one atomic, server-validated RPC. Under the old
model an administrator was the backstop for an incomplete doctor record; the new
model removes that backstop, so the enforcement has to move to where it cannot be
skipped. I would treat this as a **prerequisite** for phase 1 rather than a
follow-up: phase 1 is what grants access, and it should not land before the thing
that ensures the account claiming it is complete.

**Provenance, which the new model must answer explicitly.** Once an unverified
doctor can finalize a chart, "who signed this" needs a durable answer.
Recommendation: capture the fact at signing time rather than gating the action —
`anesthesia_cases.finalized_by_verified boolean`, written by
`anesthesia_finalize_case()` from `is_verified_doctor()` at that moment. It costs
one column, cannot be back-dated, and survives a later change in the author's
status. Deciding this is the one open product question in the whole plan, and I
would want your answer before phase 2.

**Deliberately unchanged:** the three B-class gates (#14, #15, #16),
`guard_profiles_self_update` and its re-verification rule, `set_own_role`'s
refusal of `admin`, every `admin_*` authorization check, and the entire Health
Passport QR/token model.

**Stopping here as instructed.** No SQL will be written until you approve this
architecture — in particular the provenance question, and whether
`submit_doctor_onboarding` is a prerequisite or a follow-up.
