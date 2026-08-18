# Permissions, roles and doctor onboarding — audit and fix

Branch `claude/prep-plan-patient-guide-uo5xM`, based on `main` @ `123fbbb`.
**Nothing is merged. No production SQL was run.** One migration is prepared for
review and deliberately not applied.

The audit was done first, against the migration files that are actually
installed in production — not against the test mocks. Where a claim below is
about the database, the file and line are named so it can be checked.

---

## The fifteen questions

### 1. Exact cause of Archive / Delete staying on "Checking…"

`patient-lifecycle.js`, in `eligibilityFor()` and `recycleBin()`:

```js
return Promise.resolve(client.rpc(name, args)).then(function (r) {
    if (r && r.error) throw r.error;     // thrown INSIDE the fulfilment handler
    ...
  }, function (e) { ... });              // the sibling handler cannot catch it
```

`.then(onFulfilled, onRejected)` does **not** route a throw from `onFulfilled`
into `onRejected` — that is only true of `.catch()`. So every RPC that answered
with an error object produced a rejected promise that nothing handled.
`dashboard.html`'s `wsLcToggle()` awaited it, the await threw, and every line
after it — including the one that replaces the "Checking…" hint — never ran.
The menu sat on "Checking…" for ever with the actions disabled.

It was not a permissions problem. `patient_lifecycle_eligibility(text,uuid,text)`
exists and carries a plain `GRANT ... TO authenticated`; the RPC was reachable
the whole time.

**Fixed** — the throw is now caught by a real `.catch()`, a synchronous throw
from `client.rpc` is caught too, and a null payload is reported rather than
silently treated as "eligible". `wsLcToggle()` additionally wraps its own await
so a failure paints *"Could not check this action: <reason>"* in the hint.
Reproduced before and after: `stuck: 2` → `stuck: 0`.

### 2. Every failing RPC / permission

**None found in production.** The admin RPC grants were repaired in the earlier
pass; `docs/ADMIN_RPC_GRANTS.md` records what was missing and why (the `DO`-block
grant pattern in phase 2 and phase 3 is one statement, so a single failing
iteration rolls the whole group back).

Two *latent* refusals were found by reading the installed definitions:

| Call | Refusal | Where |
| --- | --- | --- |
| `admin_update_profile_fields(..., {"professional_level": …})` | `42501 Field(s) professional_level cannot be edited here` | `v2_admin_phase2.sql:358` |
| `admin_update_profile_fields(..., {"medical_university": …})` | same | same |

Neither is reachable from the current UI, because the Admin Center's edit dialog
does not offer those two fields. That is the *symptom* covered in question 12,
not a bug that fires today.

### 3. Why Approve does not immediately show the new state

The Admin Center is not at fault. `fetchTable()` is a fresh read with no
caching, and `acAfter()` is `await loadAll(); acSelClear(); await render();` —
the list is genuinely re-read from the server after every action.

The cause is a database rule that puts an approved doctor back into the queue.
`guard_profiles_self_update()` (`v2_auth_onboarding.sql:162`) contains:

```sql
IF TG_OP = 'UPDATE'
   AND OLD.role = 'doctor'
   AND COALESCE(OLD.verification_status,'') = 'approved'
   AND ( full_name / professional_level / medical_license_number /
         country / hospital / medical_university / specialty  changed )
THEN NEW.verification_status := 'pending';
```

Any self-service write touching one of those seven fields silently returns an
approved doctor to `pending`. That rule is **correct and stays** — approval is
granted against a specific professional identity, and letting someone get
approved on a real licence and then edit the licence number would be the hole it
closes. What was wrong is the *product* around it, in two places, both now fixed:

* `settings.html` collapsed a doctor-administrator's role into `admin`, so they
  were shown the **patient** "Personal information" form. Saving a corrected
  name from that form tripped the rule with no explanation at all — the doctor
  form's re-verification notice is in `saveDoctorData()`, which they could never
  reach. Fixed by reading role and privilege separately (question 5).
* An administrator could not correct the two fields the rule watches that are
  missing from `admin_update_profile_fields`'s allowlist, so the only way to fix
  a typo in `professional_level` or `medical_university` was to have the doctor
  do it — which re-opened their verification. Prepared migration, question 14.

**No change was made to the trigger.**

### 4. Why Google doctor onboarding differs

The OAuth path itself is sound. `auth.js signInWithProvider()` →
`auth-callback.html` → `resolveAuthDestination()` → `role-select.html` when
`role = 'pending'`. `handle_new_user()` (`v2_profiles_migration.sql:33`) inserts
`role='pending'`, no metadata is consulted anywhere, and `ensureProfile()`
forces the same values client-side.

The difference is what happens when a roleless account reaches **any other
page**. An email/password signup is navigated straight to `/role-select.html`
by `navbar.js:1245`. A Google account is only guaranteed to pass through
`auth-callback.html` once — and Supabase silently falls back to the Site URL
whenever `redirectTo` does not match a Redirect-URLs entry verbatim
(`auth.js:458` documents this). A Google user landing on `/index.html` instead
hit `index.html:1487`:

```js
var isDoc = role==='doctor'||role==='admin'||role==='pending'|| …
```

so an account that had never claimed to be clinical was rendered the **doctor**
home, complete with *"Your clinician account is pending verification"*
(`index.html:1089`) — for an account with no role and no verification to speak
of. `navbar.js` compounded it: `isStaff = (role !== 'patient')` was true for
`pending`, so they also got the clinical global search and the staff workspace
switcher. And `nbGoWorkspace('pending')` sent them to `/dashboard.html`, which
`requireRole('staff')` bounced straight back.

**Fixed** — `renderAppHome()` now redirects a roleless account to
`/role-select.html`, `navbar.js` treats absence of a role as neither staff nor
patient, and `nbGoWorkspace()` routes it to the chooser.

### 5. Every place admin privilege replaces doctor identity

Four, all fixed:

| File | Was | Consequence |
| --- | --- | --- |
| `settings.html:603` | `_curRole = (_isAdmin ? 'admin' : profile.role)` | **The worst of the four.** `_curRole` drives `isDoctor`, which decides whether the professional-profile section renders. A doctor-administrator was shown the patient form and had no way, anywhere in the product, to read or edit their own licence number, institution, specialty or verification state. |
| `navbar.js:773` | `_nbRole = isAdmin ? 'admin' : role` | The remembered role was `admin`, so nothing downstream could tell the person was a doctor. |
| `dashboard.html:3349` | `profile.role \|\| (isAdmin ? 'admin' : 'patient')` | An administrator with an empty role column was treated as a clinician by the greeting and every role test after it. |
| `admin.html` ×4 (1310, 1793, 2519, 3674) | `isAdminRole(p) ? 'admin' : p.role` | See question 11. |

Not defects, and left alone: `navbar.js:814–845` and `dashboard.html:3377`
already key admin surfaces on the privilege and clinical surfaces on the role.
`auth.js requireRole` reads both separately and always did.

### 6. Every feature currently gated by verification_status

**Client-side (the wall), before this branch:** `auth.js:159` redirected every
unapproved doctor to `/doctor-pending.html` from all eleven pages that call
`requireRole` — `admin.html`, `admin-evidence.html`, `anesthesia-cases.html`,
`anesthesia-record.html`, `dashboard.html`, `doctor-approvals.html`,
`engine.html`, `questionnaires.html`, `questions.html`, `scores.html`,
`settings.html`. `resolveAuthDestination()` routed them there on every sign-in.

**Server-side (the real boundary), unchanged:**

* 12 RESTRICTIVE `*_require_verified` policies, `FOR ALL TO authenticated`,
  `USING (NOT is_pending_doctor())` — `v2_auth_onboarding.sql:329` — on
  `care_requests`, `clinic_patients`, `patient_archive_audit`,
  `patient_recommendations`, `patient_surgeries`, `preop_checklist`,
  `preop_questionnaires`, `preparation_plans`, `question_replies`, `questions`,
  `questionnaire_templates`, `requirement_documents`. RESTRICTIVE is ANDed with
  every permissive policy, so it can only remove access.
* 26 `is_verified_doctor()` call sites across `v3_anesthesia_record.sql`,
  `v3_1_anesthesia_hardening.sql`, `v4_patient_lifecycle.sql`,
  `v4_1_purge_safety.sql`, `v6_health_passport.sql` and
  `v2_auth_onboarding.sql`. These are predominantly on **writes** — `WITH CHECK`
  on the chart tables, and `IF NOT public.is_verified_doctor() THEN` at the top
  of the clinical RPCs.
* Not gated, deliberately: `profiles` (a pending doctor must read and edit their
  own row) and `doctor_verification_documents` (gating the upload is the
  circular lockout where you cannot get verified without being verified).

### 7. Which verification gates should remain

**All 38 of them.** Every server-side gate stays exactly as it is. They are what
actually protects patient data, they fail closed (`is_pending_doctor()` tests
for a status that is not exactly `approved`, so any state invented later is
gated), and nothing in this pass gives a reason to relax one. No SQL touching
them was written, prepared or run.

### 8. Which verification gates should be removed

**One, and it was never a gate: the client-side redirect.**

`auth.js:159` and the `/doctor-pending.html` branch of
`resolveAuthDestination()`. Removing them does not widen access by one row —
the database returns the same zero rows and refuses the same writes as before.
What changes is only what an unapproved doctor is *shown*: they can now use the
tools, the clinical references and their own account instead of being held on a
page with no way forward until an administrator acted.

Replaced with an explanation rather than silence, so a section that comes back
empty is never mistaken for a section with nothing in it:

* `auth.js showPendingDoctorNotice()` injects one sticky banner from
  `requireRole()` itself, so all eleven pages are covered and none can forget it.
* `dashboard.html` owns a fuller message there, and now covers `rejected` and
  `changes_requested` — previously silent, so a rejected doctor saw an ordinary
  empty workspace.
* `anesthesia-cases.html` closes the **create** action for an unapproved doctor
  and says why. Letting them type a patient's name, date of birth and ASA class
  into a form whose INSERT was never going to be accepted would be worse than
  the old bounce, not better.
* Administrators are exempt from the banner exactly as `is_pending_doctor()`
  exempts them in the database, so nobody is told about a restriction they do
  not have.

### 9. Exact cause of the Health Passport doctor redirect

Fixed in the previous pass and verified still fixed here (`roleindep.js`, 127
checks). `patients.html renderHpFeature()` was keyed on the **view** (`home` vs
`guest`) rather than on the session, so a doctor — who gets the guest view —
was given the sign-in button, and `nbOpenModal()` on an authenticated session
routes to `/dashboard.html`. It now takes `hasSession`.

### 10. Exact cause of the duplicate Health Passport create step

Every entry point in the product says *"Create my Health Passport"* —
`patients.html:240`, `patient-dashboard.html:2072`, the navbar account menu.
Arriving at `health-passport.html` showed a card that said it **again**
(`render()`, line 331), and the button behind it took no input at all:
`createPassport()` is one `HP.create()` INSERT with no fields, then reload. The
second click asked the person to confirm a decision they had already made, with
no new information on the screen to confirm it against.

A second, smaller bug in the same family: `patient-dashboard.html:2070` offered
*"Create my Health Passport"* to someone who **already had one** — it was keyed
on whether the QR was switched on, not on whether the passport existed. So the
product offered to create a thing it was at that moment displaying facts about.

**Fixed** — the intent travels with the link. A CTA whose label says "create"
appends `?create=1`; `health-passport.html` acts on it and drops the person
straight into the editor. Deliberately **not** unconditional: someone arriving
from the account menu or a bookmark has not asked for anything to be written to
their record, and without the flag the empty state still explains itself and
still offers the button. The existing-passport labels are now *Show my QR* /
*Set up my emergency QR* / *Open my passport* / *Edit my passport*.

The em dash in the Health Passport copy is replaced with a comma in
`patients.html:248` and `patient-dashboard.html:2079`. The third instance is in
`index.html` on the unmerged `claude/homepage-redesign` branch and travels with it.

### 11. Admin Center user model

Four display sites read `isAdminRole(p) ? 'admin' : p.role`. That is not a
shorthand — it is a claim that the two are alternatives. They are not: `role` is
what someone does clinically, `is_admin` is what they may administer, and the
founder account is deliberately both. Under it, an approved anesthesiologist who
administers the platform appeared in the People table as plain `admin`, with no
clinical role and no verification state worth reading.

**Fixed** — `acRoleCell()` / `acRoleText()` print the clinical role and add
*platform admin* as a separate badge. A pure administrator (`role='admin'`) gets
one badge, because there the two facts genuinely coincide. The **filters were
already correct** (`isDoctor(p)` is `p.role === 'doctor'`), so a doctor-admin was
always counted under *Doctors* — only the printed cell was wrong.

### 12. Admin profile-management limitations, and their source

| Limitation | Source | Verdict |
| --- | --- | --- |
| Cannot edit `professional_level`, `medical_university` | `v2_admin_phase2.sql:358` allowlist, written before `v2_auth_onboarding.sql:60` added the columns | **A real gap.** Migration prepared, question 14. |
| Cannot edit `email` | same allowlist, deliberate | Correct — it would desync from `auth.users`. |
| Cannot grant or revoke `is_admin` | `admin_change_role` refuses `'admin'` by name | Correct — a deliberate database action, not a form field. |
| Cannot remove a user's avatar | no RPC exists | Out of scope. A moderation verb needs its own audit entry and a decision about whether the storage object goes with it; smuggling it into a field allowlist would be the wrong shape. |
| `verification_status` only through `admin_set_verification` | by design | Correct — it is audited. |

Everything else asked for is already present and wired: soft delete, restore,
recycle bin, permanent purge with a typed confirmation, suspend, ban, role
change, doctor reassignment, document requests, verification notes, and the full
audit history — all through the audited `admin_*` RPCs listed in
`docs/ADMIN_RPC_GRANTS.md`.

### 13. Required frontend changes

| File | Change |
| --- | --- |
| `patient-lifecycle.js` | real `.catch()`; synchronous throws caught; null payload reported |
| `dashboard.html` | eligibility await wrapped and the reason shown; role no longer falls back to `admin`; verification banner covers every non-approved state and removes the injected one |
| `auth.js` | approval-wall redirect replaced by `auth.pendingDoctor` + `showPendingDoctorNotice()`; `resolveAuthDestination()` lands unapproved doctors in the workspace |
| `navbar.js` | `_nbRole` keeps the clinical role, `_nbIsAdmin` added; `nbGoWorkspace(role, isAdmin)` routes roleless accounts to the chooser; `pending` is neither staff nor patient |
| `settings.html` | role and privilege read separately (professional profile now reachable for a doctor-admin); account-type pill states both; `saveError()` translates guard and constraint failures |
| `index.html` | roleless account → chooser; `pending` no longer counts as a doctor; the pending banner is for real doctors only |
| `admin.html` | `acRoleCell()` / `acRoleText()`; four display sites |
| `health-passport.html` | `?create=1` collapses the duplicate step |
| `patients.html`, `patient-dashboard.html` | honest CTA labels, create intent on the link, em dash removed |
| `anesthesia-cases.html` | create action closed and explained for an unapproved doctor |
| `doctor-pending.html` | a route onward, and copy that no longer describes itself as a holding pen |

### 14. Required SQL / security changes

**One file, prepared and not applied: `v8_admin_profile_fields.sql`.**

It adds `professional_level` and `medical_university` to
`admin_update_profile_fields`'s allowlist. Two array entries. No policy, no
trigger, no new function, no change to who may call it, no change to the audit
log. `professional_level` stays protected by `profiles_professional_level_chk`,
and the column name still comes from the server-side allowlist, never the
caller. The file carries a preflight, a verify block and a rollback note.

**Nothing else.** No change to RLS, to the verification predicates, to the
re-verification trigger, or to any of the 38 server-side gates.

### 15. Exact deployment order

1. **Review this branch.** Nothing is merged.
2. **Optional, independent:** apply `v8_admin_profile_fields.sql` in the SQL
   editor and run its verify block. The frontend does **not** depend on it — the
   Admin Center's edit dialog still offers only the eight fields the installed
   function accepts, so there is no window in which the UI offers something the
   database refuses. Wiring the two new fields into the dialog is a one-line
   follow-up **after** the migration, not part of this branch.
3. **Merge the frontend** to `main` (`--ff-only`), which deploys.
   `VERSION` is bumped to `2026.08.18-01` and all 59 asset-carrying files are
   re-stamped — this matters: `auth.js` gains `showPendingDoctorNotice` and
   `requireRole` sets `auth.pendingDoctor`, and new HTML against a cached
   `auth.js` would leave `anesthesia-cases.html` reading `auth.pendingDoctor`
   as `undefined` (harmless) and the banner absent (not harmless).
4. **Then** the three unmerged branches, each rebased and re-stamped:
   `claude/homepage-redesign`, `claude/doctor-verification-documents`. See below.

Steps 2 and 3 are independent of each other and can be done in either order.

---

## The other branches

`claude/lifecycle-checking-hang` (`5948766`) is now **redundant** — its two
changes are in this branch, applied verbatim.

`claude/homepage-redesign` (`f7403b6`) is unaffected in substance but will
conflict on the asset stamps and on `index.html`'s `renderAppHome()`. Rebase
onto the new `main`, re-apply the roleless redirect there, and re-stamp.

`claude/doctor-verification-documents` (`25a6b65`) — **re-audited, still do not
merge blindly.** It is compatible with the new model: the RLS it adds is keyed
on `is_doctor_account() AND is_pending_doctor()`, which is exactly the pairing
the wall removal relies on (an unapproved doctor must be able to upload evidence
while everything clinical stays shut). Three things to settle first:

* It rewrites `doctor-pending.html` (+218 lines) and this branch edits the same
  file. Real conflict, must be resolved by hand, not by taking one side.
* Its `dvui.js` suite assumes the old wall — an unapproved doctor being held on
  `doctor-pending.html` is now something they choose, not something that happens
  to them. The suite needs the same treatment `anes.js` / `createui.js` /
  `dobage.js` got here.
* With the wall gone, the upload UI should also be reachable **from** the
  banner, not only from a page they used to be trapped on.

`claude/passport-primary-and-avatars` (`61623fc`) remains superseded and can be
deleted whenever you want.

---

## Tests

1,545 checks across 21 Playwright suites, all passing:

`permaudit` 138 · `roleindep` 127 · `hpentry` 84 · `prod` 186 · `regress` 21 ·
`acmenu` 60 · `rowact` 153 · `idui` 9 · `dash` 129 · `lifecycle-ui` 174 ·
`admin-lc` 69 · `patient` 55 · `signup` 54 · `hp` 116 · `qr` 17 · `chart` 104 ·
`anes` 26 · `createui` 28 · `dobage` 65 · `openers` 64 · `livechart` 90 ·
`visibility-audit` (0 unaccounted).

`permaudit.js` is new and covers exactly what this branch changed, at
390 / 834 / 1440: the wall removal and its banner, the doctor-administrator's
professional profile, the roleless redirect, the collapsed create step, and the
two-dimension Admin Center rendering — each asserting both the new behaviour and
the thing that must not have changed alongside it.

Eight suites had assertions that encoded the old wall (`regress`, `anes`,
`createui`, `dobage`) or the exact CTA href (`prod`, `hpentry`, `roleindep`).
Each was updated with a comment naming the behaviour change, not loosened:
where an assertion was relaxed from an exact href to a path, a second assertion
was added that the create intent is present on the create CTA and absent from
navigation links.

Not run, and why: `home.js` targets the unmerged homepage branch; `dvui.js`
targets the parked doctor-documents branch; `schema-contract.js` needs the local
Postgres replica and no installed database object was changed.

### The test matrix

| Account | Result |
| --- | --- |
| A — new unverified doctor | Reaches the workspace, banner explains what is closed, Live Tools and references open, create action closed with a reason, patient sections empty as the database dictates |
| B — verified doctor | Unchanged. No banner. |
| C — doctor + admin | Described as both everywhere; professional profile reachable in Settings for the first time; Admin Center prints doctor + platform admin; never told they are gated |
| D — pure admin | Unchanged; still reaches the workspace and the Admin Center |
| E — patient | Unchanged throughout |
| F — OAuth account with no role yet | Sent to `/role-select.html` from `index.html` and from the navbar, instead of being rendered the clinician home |
