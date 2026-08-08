# Anestheo Admin Center — Architecture Proposal

**Status:** Design for review. No implementation code written yet.
**Scope:** Operational control center for the whole platform, built on the existing
static + Supabase architecture at the document root. Reuses existing routes, schema, RPCs and
Edge Functions. Invents no tables, columns or routes without flagging them.

---

## 0. Inspection findings (what exists today)

### 0.1 Authentication & roles
| Item | Reality |
|---|---|
| Identity | Supabase Auth (`auth.users`) |
| Profile | `public.profiles` (`id` FK → auth.users, `role`, `is_admin`, `verification_status`, …) |
| Roles in use | `pending`, `patient`, `doctor`, `admin`, `other`, `nurse`, `student` |
| Admin test | `auth.js:92` → `isAdmin = (p.is_admin === true \|\| role === 'admin')` |
| Page gate | `requireRole('admin')` (UX guard only; DB safety is RLS) |
| Client key | anon key + user JWT → **all client reads/writes are RLS-bound** |

### 0.2 Existing admin surfaces (4 pages, overlapping)
| Route | Lines | Does today |
|---|---|---|
| `admin.html` | 280 | Doctor approvals, user role change, submitted questions, **Patients** (archive/restore/delete), static "Platform settings" |
| `users.html` | 93 | Admin-gated user list (superset lives in admin.html) |
| `doctor-approvals.html` | 95 | `verification_status` update (duplicate of admin.html tab) |
| `admin-evidence.html` | 222 | Evidence Transparency editor (`evidence_*` tables) — genuinely distinct |

→ `users.html` and `doctor-approvals.html` are **duplicates** of admin.html tabs.

### 0.3 Schema actually present (19 tables)
`profiles`, `clinic_patients`, `patient_surgeries`, `care_requests`,
`preop_questionnaires`, `preop_checklist`, `questions`, `question_replies`,
`preparation_plans`, `requirement_documents`, `patient_recommendations`,
`patient_archive_audit`, `questionnaire_templates`, `video_progress`,
`evidence_tools`, `evidence_reviews`, `evidence_sources`,
`evidence_review_items`, `evidence_change_history`.

### 0.4 RPCs callable from the client (20)
`request_clinician`, `respond_care_request`, `revoke_care_request`,
`start_review`, `submit_for_review`, `request_changes`, `approve_plan`,
`reopen_review`, `save_doctor_plan`, `get_patient_plan`,
`mark_document_reviewed`, `get_clinician_directory`, `claim_patient_record`,
`get_clinic_patient_by_token`, `mark_clinic_questionnaire_progress`,
`submit_clinic_questionnaire`, `archive_patient`, `restore_patient`,
`patient_archive_eligibility`, `admin_delete_patient`.

### 0.5 Edge Functions (2)
| Function | Auth model | Notes |
|---|---|---|
| `convert_clinic_patient` | **service-role**, proven by clinic token, `--no-verify-jwt` | Already uses `auth.admin.createUser` / `generateLink` — the reusable privileged pattern |
| `youtube-latest` | public, YouTube Data API key in Supabase secrets | Single source of video truth (`videos-data.js` consumes it) |

### 0.6 🔴 Blocking finding #1 — `profiles` has no admin RLS policy
RLS is **enabled** on `profiles`, with only:
```
profiles_select_own      USING (auth.uid() = id)
profiles_insert_own      WITH CHECK (auth.uid() = id)
profiles_update_own      USING (auth.uid() = id)
profiles_directory_read  USING (accepting_patients = true)
```
**Consequence:** today's `admin.html` `from('profiles').select('*')` returns only
the admin's own row plus directory-opted-in doctors, and role /
`verification_status` updates on *other* users are silently rejected. **The
existing admin user-management is effectively non-functional under RLS.** This is
the first thing the Admin Center must fix (§6.1).

### 0.7 🔴 Blocking finding #2 — `auth.users` is unreachable from the browser
Last login, provider, active sessions, failed logins, ban/disable, force logout
and password reset all live in `auth.users` / GoTrue admin API. These are
**impossible from the client** and require a service-role Edge Function (§6.2).

### 0.8 What does **not** exist (probed, absent)
`email_log`, `email_events`, `notifications`, `audit_log`/`admin_audit`,
`sessions`, `login_attempts`, `feature_flags`, `app_settings`, `maintenance`,
`videos`/`video_meta`, `analytics`/`events`, `consultations` (consultations are
`care_requests`).
Email today = **`mailto:` drafts + `wa.me` links** from dashboard.html; the only
real send is the best-effort magic link inside `convert_clinic_patient`. There is
**no ESP and no delivery tracking**.

---

## 1. Information architecture

Three concentric rings — visibility first, then control, then danger.

```
ADMIN CENTER
├── ① OVERVIEW            Operational state of the platform (all tiles clickable)
├── ② DIRECTORY  (people) Doctors · Patients · User accounts
├── ③ WORKFLOWS  (work)   Questionnaires · Consultations · Questions · Documents
├── ④ CONTENT             Videos · Procedures/Guides/References · Evidence · Legal
├── ⑤ PLATFORM            System health · Audit log · Analytics · Notifications
└── ⑥ SUPER ADMIN         Destructive & global controls (extra confirmation)
```

**Object model** (everything resolves to one of these, each with a canonical detail view):
`User` → `Doctor` | `Patient` → `Surgery/Journey` → {`Questionnaire`, `Consultation`, `Question`, `Document`, `Plan`}.

**Invariants**
1. Every number is a link into a filtered list. No decorative statistics.
2. Every list row opens a 360° detail view of that object.
3. Every mutation is written to the audit log — no silent state change.
4. Destructive actions require typed confirmation + a reason.
5. Reads are broad; writes are narrow, explicit and logged.

---

## 2. Page hierarchy

Consolidate into **one shell at the existing `/admin.html` route** (no new
routes) with hash-addressable sections, absorbing the two duplicate pages.

```
/admin.html                       Admin Center shell (single page app-shell)
  #overview                          ① dashboard
  #search?q=…                        global search results
  #doctors        · #doctors/:id     ② doctor list → 360° profile (tabs)
  #patients       · #patients/:id    ② patient list → 360° record (tabs)
  #accounts       · #accounts/:id    ② every auth account
  #questionnaires · #questionnaires/:id
  #consultations  · #consultations/:id     (= care_requests)
  #questions      · #questions/:id
  #documents                         requirement_documents review queue
  #videos                            YouTube sync + metadata
  #content                           procedures / guides / references / legal
  #evidence      → deep-links to existing /admin-evidence.html (kept)
  #health                            system health probes
  #audit                             audit log
  #analytics                         analytics
  #notifications                     admin notification centre
  #super                             super-admin tools (feature-gated)
  #explorer                          database explorer (read-only default)

/admin-evidence.html              KEPT as-is (deep tool, linked from #content)
/users.html                       DEPRECATE → redirect to admin.html#accounts
/doctor-approvals.html            DEPRECATE → redirect to admin.html#doctors?filter=pending
```

Rationale for one shell: shared search, shared audit surface, one auth gate, one
data layer; matches Stripe/Linear "one console, many sections". Hash routing =
no new server routes, deep-linkable, back-button correct.

### Detail views (tabs)
| Object | Tabs |
|---|---|
| Doctor | Overview · Patients · Questionnaires · Consultations · Questions · Documents · Activity · Audit · Settings |
| Patient | Overview · Journey/Timeline · Questionnaire · Checklist · Documents · Consultations · Questions · Recommendations · Audit |
| Account | Identity · Sessions & security · Roles · Audit |

---

## 3. Navigation

- **Left rail** (persistent, grouped as §1): Overview / Directory / Workflows /
  Content / Platform / Super Admin. Collapses to icons < 1100px, drawer < 760px.
- **Command bar** (top): global search (`/` or `⌘K`), environment chip
  (`prod`), admin identity, notification bell with unread count.
- **Breadcrumb**: `Admin › Doctors › Dr. Jane Smith › Questionnaires`.
- **Row-level "open" everywhere**; no dead ends.
- Reuses `navbar.js` shell (auth, avatar, sign-out, footer) exactly as other
  authenticated pages — the admin rail is *inside* the page, not a second navbar.

---

## 4. UX flows (canonical)

**F1 — Verify a doctor**
`#overview` "Pending verification 3" → `#doctors?filter=pending` → row → Doctor
360° → **Verify** → confirmation sheet (reason optional) → `admin_set_verification`
RPC → audit row → toast → list refreshes.

**F2 — Investigate a patient**
Global search "Kajada" → Patient hit → `#patients/:id` → Timeline shows
questionnaire submitted → reviewed → plan approved → documents; every event links
to the underlying object; Audit tab shows who did what.

**F3 — Reassign a patient to another doctor**
Patient 360° → **Assign / move doctor** → doctor picker (search) → typed reason →
`admin_reassign_patient` RPC (writes `patient_surgeries.assigned_doctor_id`,
audited) → timeline gains a "reassigned" entry.

**F4 — Destructive delete**
Any delete → red sheet: impact summary (what will be removed / what is preserved)
→ type `DELETE JOHN SMITH` → reason (required) → RPC → audit row. Archive is
always offered first as the reversible alternative (already built).

**F5 — Triage a failure**
`#notifications` "SMTP failure" → detail → linked object → retry/act → audit.

---

## 5. Required backend capabilities

Two mechanisms only, both already proven in this codebase:

**(A) SECURITY DEFINER RPCs** — for everything that lives in `public.*`.
Each begins with a shared assert:
```sql
CREATE FUNCTION public.assert_admin() RETURNS void ... AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = auth.uid() AND (is_admin = true OR role = 'admin'))
  THEN RAISE EXCEPTION 'Admin privilege required'; END IF;
END $$;
```
Pattern is identical to the shipped `admin_delete_patient`.

**(B) One `admin-api` Edge Function (service-role)** — only for `auth.users` /
GoTrue operations that RLS cannot express. Must verify the caller's JWT **and**
their admin profile before acting (unlike `convert_clinic_patient`, which is
token-proved and unauthenticated by design).

### Capability matrix
| Capability | Mechanism | Exists? |
|---|---|---|
| Read any profile / doctor / patient | RLS admin-read policies (§6.1) | ❌ must add |
| Set verification / role | RPC `admin_set_verification`, `admin_set_role` | ❌ |
| Archive / restore / delete patient | `archive_patient`, `restore_patient`, `admin_delete_patient` | ✅ shipped |
| Reassign patient | RPC `admin_reassign_patient` | ❌ |
| Read questionnaires / consultations / questions platform-wide | RLS admin-read | ⚠️ partial |
| Account: last login, provider, sessions, failed logins | `admin-api` (service-role) | ❌ |
| Disable / enable login, force logout, reset password | `admin-api` (`auth.admin.updateUserById`, `signOut`, `generateLink`) | ❌ |
| Audit log (all actions) | table `admin_audit_log` + RPC writes | ⚠️ only `patient_archive_audit` |
| Global search | RPC `admin_search(q)` (UNION over indexed columns) | ❌ |
| Video metadata (featured/pinned/visible) | small table + `youtube-latest` for live data | ❌ (live data ✅) |
| System health | live probes (DB query, function ping, storage HEAD) | ⚠️ probes only |
| Analytics | aggregate RPCs over existing tables | ⚠️ partial |
| Email center | requires an ESP + `email_log` | ❌ (see §7.1) |
| Impersonation | service-role token minting | ❌ (see §7.3) |

---

## 6. Existing schema reused (section → real data)

| Admin section | Tables / columns (all existing) |
|---|---|
| Doctors | `profiles` (`role='doctor'`, `verification_status`, `hospital`, `specialty`, `country`, `phone`, `accepting_patients`, `display_name`, `clinic_name`, `bio`, `created_at`) |
| Patients | `patient_surgeries` (canonical: `assigned_doctor_id`, `patient_id`, `patient_name`, `procedure_type`, `surgery_date`, `hospital`, `care_state`, `ready_at`, `completed_at`, `archived_at/by`, `archive_reason`, `restored_at/by`, `clinic_patient_id`) + `clinic_patients` (invited, `token`, `questionnaire_status`, `consultation_status`, `patient_status`) |
| User accounts | `profiles` (+ `auth.users` via `admin-api` for login/session facts) |
| Questionnaires | `preop_questionnaires` (`status` in_progress\|submitted, `review_state` not_submitted\|pending\|in_review\|changes_requested\|approved, `completion`, `answers`, `risk_flags`, `reviewed_by/at`, `reviewer_notes`) + `clinic_patients.questionnaire_answers` |
| Consultations | `care_requests` — **status map (no invention):** Pending=`requested`, Accepted=`accepted`, Rejected=`declined`, Cancelled=`revoked`, Completed=`closed`; lane via `is_consultation` / `patient_surgeries.care_state` |
| Patient questions | `questions` (`status` new\|under_review\|answered\|closed) + `question_replies` |
| Documents | `requirement_documents` (`reviewed_at/by`, `storage_path`) + `patient-documents` private bucket |
| Plans / readiness | `preparation_plans` (`status` draft\|approved\|superseded, `version`), `patient_surgeries.ready_at` |
| Archive audit | `patient_archive_audit` (actor, action, reason, prev state) — **the pattern to generalise** |
| Evidence / content | `evidence_tools`, `evidence_reviews`, `evidence_sources`, `evidence_review_items`, `evidence_change_history` |
| Templates | `questionnaire_templates` |
| Videos | `youtube-latest` Edge Function (live: id, title, published, thumb, duration, views) + `video_progress` (patient watch state) |
| Static content | Files on disk: `procedures.html`, 8 procedure pages, `preop-instructions.html`, `recovery.html`, 8 reference pages, `resources.html`, legal pages |

---

## 7. Missing capabilities (honest gaps + options)

### 7.1 Email Center — **cannot be built on real data today**
No ESP, no `email_log`, no delivery/open/click webhooks. "Emails" are `mailto:`
drafts the admin's own mail client sends — Anestheo never sees them.
*Options:* **(a)** ship an "Outbound messages" view of what the product *can*
prove (questionnaire `sent_at`, `opened_at`, WhatsApp/email/link dispatch marks
on `clinic_patients`) and label it honestly — no delivered/opened/clicked;
**(b)** later adopt an ESP (Resend/Postmark) + `email_log` + webhook Edge
Function, then the full center becomes real. **Recommend (a) now, (b) as a
separate epic.** Do not fabricate delivery states.

### 7.2 Suspend / disable / deleted states for users
`profiles` has no `suspended_at`/`disabled_at`/`deleted_at`. Two honest paths:
(i) additive columns + RLS (soft state, reversible, in-app), or
(ii) GoTrue `ban_duration` via `admin-api` (blocks login at the identity layer).
**Recommend both:** (ii) for real login blocking, (i) for product-visible state.

### 7.3 Impersonation ("Login as patient") — **highest risk**
Requires minting a session for another user (service-role `generateLink` /
`admin.createSession`). Clinical data + GDPR implications. If approved it must
be: super-admin only, reason required, time-boxed, banner visible during the
session, fully audited, read-only where possible. **Recommend deferring** to a
dedicated review; not in the first implementation.

### 7.4 Analytics: traffic & retention — not available
No analytics/events table and no web-analytics integration. Computable **today**
from existing rows: doctors/patients counts, registrations over time
(`created_at`), country/hospital/procedure distribution, questionnaire
completion, consultation funnel, archive rates, video views (from YouTube stats).
**Not computable:** page traffic, sessions, retention cohorts, video watch-through
(unless `video_progress` is populated). Report as unavailable rather than guess.

### 7.5 System health — probes, not a status feed
No health endpoint. Achievable honestly: DB round-trip probe, `youtube-latest`
ping, storage HEAD, last-successful-sync timestamps, app version/build stamp.
SMTP status is **not observable** (no ESP). Label each as "probe" and never
render a green "all systems operational" that isn't measured.

### 7.6 Merge duplicates
No merge architecture beyond `claim_patient_record`'s narrow re-point-and-delete.
A general merge (choose survivor, re-point FKs, archive loser, audited) is a
design of its own. **Defer**; expose "possible duplicates" detection first
(same email/phone/name), acting manually via reassign + archive.

### 7.7 Database explorer
Safe read-only browse/search/filter/CSV over the 19 known tables is fine via
admin-read RLS + an allow-list. **No arbitrary SQL** from the browser. Editing
should stay out of v1 (RPC-mediated, per-table, typed confirmation if ever added).

### 7.8 Notifications & feature flags / maintenance / read-only mode
No tables. Notifications can be **derived** in v1 (pending verifications,
unreviewed documents, unanswered questions, failed syncs) with no new schema.
Feature flags / maintenance / read-only need a tiny `app_settings` table plus
enforcement points — enforcement is the hard part (must be honoured by RLS or
every write path), so **scope carefully or defer**.

---

## 8. Incremental implementation plan

Each phase is independently shippable, reversible, and ends green.

**Phase 0 — Foundations (unblocks everything)**
`v2_admin_center.sql` (additive, idempotent):
`assert_admin()` + `is_platform_admin()` helpers · **admin-read RLS policies** for
`profiles` and the tables missing them (fixes §0.6) · `admin_audit_log` table
(generalises `patient_archive_audit`) + `admin_log()` writer · `admin_search(q)`
RPC. No UI change. *Deliverable: admin can finally see the platform, safely.*

**Phase 1 — Shell + Overview + Global search**
Rebuild `admin.html` as the shell (left rail, command bar, hash routing) using
the approved Anestheo dark/glass language. Real, clickable overview tiles.
Deprecate `users.html` / `doctor-approvals.html` → redirects.

**Phase 2 — Directory**
Doctors list + 360° profile; Patients list + 360° record (reusing the shipped
archive/restore/delete). RPCs: `admin_set_verification`, `admin_set_role`,
`admin_reassign_patient` — all audited.

**Phase 3 — Workflows**
Questionnaires, Consultations (care_requests), Questions, Documents — read,
filter, drill-through, and the few safe state actions, all audited.

**Phase 4 — Accounts & security**
`admin-api` Edge Function (service-role, admin-verified): last login, provider,
sessions, disable/enable, force logout, password reset. Optional suspend columns.

**Phase 5 — Platform**
Audit log viewer · System health probes · Notifications (derived) · Analytics
(computable metrics only) · Database explorer (read-only + CSV).

**Phase 6 — Content & Videos**
Video sync view over `youtube-latest` (+ optional tiny `video_meta` for
featured/pinned/visible) · content inventory linking existing pages ·
`admin-evidence.html` linked in.

**Phase 7 — Super Admin (gated review)**
Typed-confirmation destructive actions, feature flags / maintenance / read-only,
merge duplicates, impersonation — each only after its own approval (§7.3, §7.6, §7.8).

**Deferred pending product decision:** Email Center (needs ESP), impersonation,
traffic/retention analytics, general merge, enforceable maintenance mode.

---

## 9. Design language

Reuse exactly what is approved: `#0A1A15` grid background, DM Sans (Playfair for
display), glass cards (`linear-gradient` + `inset 0 1px 0` highlight), restrained
teal glow (`#7ECFC0` / `#1B6B5A`), 44px touch targets, `prefers-reduced-motion`
respected, the shared `navbar.js` shell and application footer. Density is higher
than the clinical apps (this is a console), but the tokens do not change. No
Bootstrap, no template chrome, no decorative animation.
