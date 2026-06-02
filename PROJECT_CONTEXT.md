# PROJECT_CONTEXT.md — Anestheo v2

> Last updated: 2026-06-02  
> Purpose: Onboarding document for new Claude Code sessions. Contains the full architecture, flows, and decisions needed to continue development without re-reading every file.

---

## 1. Project Overview

**Anestheo v2** is a static-file web application (no build step, no bundler, no framework) served from the `/v2/` path. It is an anesthesiology platform serving three user types:

- **Patients** — educational resources, pre-op questionnaire, surgery preparation journey
- **Doctors / staff** — clinical workspace: patient management, pre-op questionnaire delivery, live clinical tools, references
- **Admins** — user management, doctor verification, platform oversight

All persistence is in a single Supabase project. The UI is rendered in vanilla JavaScript.

---

## 2. File Structure

```
/v2/
├── supabase.js                 ← Supabase client singleton (load first)
├── auth.js                     ← Auth helpers, questionnaire helpers (load second)
├── navbar.js                   ← Shared nav, auth modal, search, live monitor widget
├── styles.css                  ← Global shared stylesheet
│
├── index.html                  ← Landing page (public)
├── patients.html               ← Patient portal / "For Patients"
├── videos.html                 ← Video library
├── resources.html              ← Downloadable books, PDFs, guides
├── ask.html                    ← Ask Anesthesiologist (public form + FAQ)
│
├── airway.html                 ← Airway reference
├── difficult-airway.html       ← CICO / difficult airway algorithm
├── anticoagulation.html        ← ASRA anticoagulation timing tables
├── regional.html               ← Regional blocks, neuraxial, LA max doses
├── obstetric.html              ← Obstetric anesthesia
├── pediatric.html              ← Paediatric formulas
├── icu.html                    ← ICU / critical care reference
├── last.html                   ← LAST protocol
├── anaphylaxis.html            ← Anaphylaxis management
├── recovery.html               ← Post-anesthesia recovery
├── scores.html                 ← Clinical scoring tools
├── references.html             ← Reference library index
│
├── general-surgery.html        ┐
├── orthopedic.html             │
├── ent.html                    │
├── plastic.html                │ Surgical specialty reference pages
├── dental.html                 │
├── urology.html                │
├── oncogynecology.html         │
├── csection.html               │
├── procedures.html             ┘
│
├── dashboard.html              ← Doctor/admin workspace (authenticated)
├── engine.html                 ← Anesthesiology Live Tools (authenticated)
├── patient-dashboard.html      ← Patient journey dashboard (authenticated)
├── questionnaire.html          ← Pre-op questionnaire (authenticated patient path)
├── q.html                      ← Pre-op questionnaire (token-based, no login)
├── questionnaires.html         ← Questionnaire list view (doctor)
├── settings.html               ← Profile / password / role settings
├── admin.html                  ← Full admin center (admin only)
├── role-select.html            ← Role selection for new users during onboarding
│
├── users.html                  ┐
├── questions.html              │ Legacy admin pages (pre-dashboard unification)
├── preop-instructions.html     │
├── doctor-approvals.html       ┘
│
└── *.sql                       ← Database migration scripts (schema history)
```

### Script load order (every page)
```
CDN @supabase/supabase-js@2  →  supabase.js  →  auth.js  →  navbar.js  →  page script
```

---

## 3. Supabase Integration

**Project URL:** `https://zaptzjohvgwayvytntyb.supabase.co`  
**Client:** Single `window.sb` instance in `supabase.js`. Never call `createClient` anywhere else.  
**Storage key:** `'anestheo-auth'` (localStorage)

### Database tables

| Table | Key columns | Notes |
|---|---|---|
| `profiles` | `id` (FK → auth.users.id), `email`, `full_name`, `role`, `verification_status`, `hospital`, `specialty`, `country`, `phone`, `is_admin` | `role` values: `patient`, `doctor`, `nurse`, `student`, `other`, `admin`. `verification_status`: `pending`, `approved`, `rejected`, `not_required`. |
| `clinic_patients` | `id`, `doctor_id`, `patient_name`, `phone_number`, `procedure`, `hospital`, `surgery_date`, `notes`, `token` (random hex), `questionnaire_status`, `consultation_status`, `patient_status`, `questionnaire_answers` (JSONB), `doctor_notes`, `sent_at`, `completed_at`, `arrived_at`, `reviewed_at`, `ready_at` | `questionnaire_status`: `not_sent`, `sent`, `opened`, `in_progress`, `completed`. `consultation_status`: `not_arrived`, `arrived`, `reviewed`. `patient_status`: `awaiting_questionnaire`, `awaiting_consultation`, `ready_for_surgery`, `completed`. |
| `patient_surgeries` | `patient_id` (FK, unique), `procedure_type`, `surgery_date`, `hospital`, `surgeon`, `anesthesia_type` | Upserted on conflict `patient_id`. Self-reported by patients. |
| `preop_questionnaires` | `patient_id` (unique), `*` (all answer fields), `updated_at` | Authenticated-patient questionnaire path (separate from `clinic_patients`). |
| `preop_checklist` | `patient_id` (unique), `items` (JSONB), `updated_at` | Patient-side checklist state. |
| `questions` | `id`, `name`, `topic`, `question`, `email`, `subject`, `message`, `status`, `created_at` | "Ask Anesthesiologist" submissions. `status`: `new`, `under_review`, `answered`, `closed`. |

### Migration files (schema history)
`v2_profiles_migration.sql`, `v2_clinic_patients_migration.sql`, `v2_preop_migration.sql`, `v2_preop_questionnaires_migration.sql`, `v2_questionnaire_templates_migration.sql`, `v2_patient_surgery_migration.sql`, `v2_ask_migration.sql`

Diagnostic / fix scripts: `diagnose_clinic_patients.sql`, `fix_questionnaire_ambiguity.sql`

---

## 4. Authentication Flow

```
USER CLICKS LOGIN / GET STARTED
        │
        ▼
navbar.js opens auth modal
        │
        ├─── SIGN IN mode ──────────────────────────────────────────────────┐
        │    email + password → sb.auth.signInWithPassword()                │
        │    Error labels (in console log):                                 │
        │      A) Invalid credentials                                       │
        │      B) Email not confirmed                                       │
        │      E) Session not saved (storage blocked)                       │
        │      F) Network/connection error                                  │
        │    On success:                                                     │
        │      • Verify session via getSession()                            │
        │      • Load profiles row; auto-create via ensureProfile() if      │
        │        missing (calls upsert with user metadata role)             │
        │      • resetSessionCache()                                        │
        │      • Redirect → /v2/dashboard.html                             │
        │                                                                   │
        └─── REGISTER mode ─────────────────────────────────────────────────┘
             Step 1: Role chips (patient / doctor / other)
             Step 2: Email + password form
             → sb.auth.signUp({ data: { role, verification_status } })
             • If session returned immediately → saveProfile() → routeByRole()
                 patient → /v2/patients.html
                 doctor/other/admin → /v2/dashboard.html
             • If email confirmation required → show success message

DASHBOARD ROUTING (dashboard.html)
        │
        ├── No session → redirect /v2/index.html
        ├── Profile missing role → redirect /v2/role-select.html
        ├── role = 'patient' → redirect /v2/patients.html
        └── role = doctor/admin/other → render workspace in-place

SESSION MANAGEMENT
  • _sessionPromise cache in auth.js — avoids repeated Supabase round-trips
  • Cache busted on SIGNED_OUT event only (NOT on SIGNED_IN, to avoid loop)
  • 8-second timeout guard on all Supabase calls via withTimeout()
  • 10-second watchdog in dashboard.html — shows "refresh" UI if stalled
  • Sign-out: sb.auth.signOut() + redirect to index.html
  • Forgot password: sb.auth.resetPasswordForEmail(email)
```

---

## 5. Questionnaire Flow

### Doctor side — sending (`dashboard.html`)

1. Doctor fills "Add patient" form: name (required), phone, procedure, hospital, surgery date, notes.
2. `wsSavePatient()` inserts into `clinic_patients` with:
   - `token` = 18-byte random hex (generated client-side via `window.crypto`)
   - `questionnaire_status = 'not_sent'`
   - `consultation_status = 'not_arrived'`
   - `patient_status = 'awaiting_questionnaire'`
3. "Send questionnaire" → `wsSendWhatsApp(id)`:
   - Opens `https://wa.me/<phone>?text=<pre-filled message>` in new window
   - Message includes: greeting, short instructions, and the link `/v2/q.html?t=<token>`
   - If the pop-up opened → updates `questionnaire_status = 'sent'`
   - If pop-up blocked → does NOT mark sent (intentional: only real delivery triggers status)
4. Fallback: `wsSendSms(id)` → opens native SMS app via `sms:` URI, then marks sent.
5. `wsCopyLink(id)` / `wsOpenLink(id)` — doctor can copy or preview the exact link.

### Patient side — filling (`q.html`)

`q.html` requires no login. It is driven entirely by `?t=<token>`.

1. Fetches `clinic_patients` row matching token. On open → `questionnaire_status = 'opened'`.
2. `?preview=1` skips the Supabase lookup and renders with dummy data.
3. QUESTIONS array (35+ items) with branching predicates `show(A, ctx)`:
   - **Basics** — age, sex, height, weight (always visible)
   - **Pregnancy** — shown when `sex === 'Female'`
   - **Cesarean pathway** — shown when `procedure` matches `/cesarean|c-section|csection|childbirth/i`
   - **Pediatric** — shown when `age < 18`: guardian, birth issues, recent cold
   - **Conditional follow-ups** — cardiac detail (if cardiac=Yes), lung detail (if lung=Yes), anticoag detail, CPAP (if lung=Yes or apnea=Yes), etc.
4. BMI calculated live: `weight / (height/100)²`
5. Progress bar: `answered / visibleQuestions.length * 100`
6. Branching: yesno buttons and selects call `renderFields()` immediately (re-renders form). Text/number fields call `branchOnBlur()` only on blur to avoid losing cursor focus.
7. On submit — client-side scoring computed and saved to `questionnaire_answers` JSONB:
   - `_scores.bmi`
   - `_scores.stopbang` (0-8 OSA score: snore, tired, apnea, neck ≥40cm, hypertension, age >50, BMI >35, sex=Male)
   - `_scores.stopbang_risk` — Low / Intermediate / High
   - `_scores.ponv` (0-4 Apfel: female sex, non-smoker, PONV history, not opioid-naive)
   - `_scores.ponv_risk`
   - `_scores.asa_suggestion` — heuristic I/II/III/IV suggestion
   - `_scores.completion` — percentage
   - `_flags` — array of risk-flag strings (e.g. "Difficult airway risk", "OSA — STOP-BANG ≥3")
8. `questionnaire_status = 'completed'`, `completed_at` timestamped.
9. Completion screen shows: journey stepper, score stats card, risk flags, full answer table.

### Doctor review (in `dashboard.html` patient cards)

Each patient card displays:
- **Stepper**: Not sent → Sent → Opened → Completed → Reviewed → Ready → Arrived
- **Progress bar** (percentage based on answered fields when completed, or status-based estimate when not)
- **Score chips**: Questionnaire status + %, Consultation, Arrival
- **Clinical row** (completed only): BMI, STOP-BANG, Pregnancy, ASA suggestion
- **Risk flags**: amber badges for each flag
- **Action buttons**:
  - Not completed: Send / Resend questionnaire (WhatsApp), Preview questionnaire
  - Completed: View summary, View full questionnaire, Print PDF
  - Workflow: Patient arrived → Mark reviewed → Ready for surgery
- **"View summary" modal**: full answers, scores, private doctor notes (saved to `doctor_notes` column)
- **"Print PDF"**: opens a new window with a print-ready HTML table (no server, no library)

---

## 6. Doctor Dashboard (`dashboard.html`)

A single-page workspace — no navigation away from the page. Sections switch by showing/hiding `<div class="ws-sec">` via `wsShow(sec)`.

### Layout
```
Fixed navbar (56px)
Top bar: greeting + role + session status
Verification banner (doctors with status = 'pending')
ws-shell (grid: 210px rail | 1fr body)
  Rail (sticky sidebar tabs):
    Patient Management
    Live Tools
    References
    Resources
    Questions Management
    Admin (admin role only)
    ── separator ──
    Settings (link)
    Sign out
  Body: active section panel
```

### Section 1 — Patient Management (default active)
- Stats row: total patients, awaiting questionnaire, questionnaire done, ready for surgery
- Two-column layout: Add Patient form (left, sticky) | My Patients list (right)
- Filter tabs: All / Awaiting questionnaire / Awaiting consultation / Ready for surgery
- Patient cards described in Section 5 above

### Section 2 — Live Tools
- iframe embedding `/v2/engine.html?embed=1` at `78vh` height
- "Open full screen" link opens `engine.html` in a new tab

### Section 3 — Clinical References
- Grid of tiles linking to reference pages (Airway, Anticoagulation, Regional, Obstetric, Pediatric, ICU, LAST, Anaphylaxis)

### Section 4 — Resources
- Grid tiles for Books, PDFs, Guides, Checklists, Downloads (all show "coming soon" toast)
- Videos tile links to `videos.html`

### Section 5 — Questions Management
- Lists `questions` table rows filtered by status (Pending / Answered / All)
- "Open & reply" links to `ask.html`

### Section 6 — Admin (admin role only)
- Stats, pending doctor approvals (approve/reject), users list (role dropdown, first 20)
- Link to full `admin.html`

---

## 7. Patient Dashboard (`patient-dashboard.html`)

Requires authentication. Patients redirected here from `dashboard.html`.

### Sections
- **Upcoming surgery** — reads from `patient_surgeries` table. Shows procedure, date, countdown ("in 3 days"), hospital, surgeon, anesthesia type. If empty, shows "Add my surgery" prompt. Editable via modal (procedure select, date, hospital, surgeon, anesthesia type). Upserted on `patient_id`.
- **Preparation progress** — percentage bar + progress item checklist. Items: Profile complete, Surgery added, Questionnaire done, Videos watched, Questions asked.
- **Questionnaire** — links to `q.html` or `questionnaire.html`. Shows completion status and any submitted risk flags.
- **My questions** — lists the patient's `questions` rows with status badges (New / Under review / Answered / Closed). Shows doctor reply when status = answered.
- **Education** — links to educational content with watch progress indicators.
- **Recent activity** — timeline of timestamped actions.

---

## 8. Admin Panel

### Inline in `dashboard.html` (admin tab)
Quick view: stats, pending approvals, first 20 users with role dropdown.

### Full admin center (`admin.html`)
Protected: requires `is_admin === true` or `role === 'admin'`.

**Stats bar:** Total users · Total doctors · Pending · Total questions

**Tabs:**

| Tab | What it does |
|---|---|
| Doctor approvals | Table of `verification_status = 'pending'` doctors with Approve / Reject buttons → `profiles.verification_status` update |
| User management | All profiles, role dropdown per user (`changeUserRole`). Changing role to `doctor` sets `verification_status = 'pending'`. |
| Submitted questions | Read-only table from `questions` (name, topic, question, email) |
| Platform settings | Static display: platform name, support email, feature flags (not editable in UI) |

---

## 9. Live Tools (`engine.html`)

The flagship clinical calculator suite for anesthesiologists.

### Embed mode
When loaded with `?embed=1` (inside the Doctor Workspace iframe), `body.embed` class is added → the duplicate shared navbar is hidden via CSS (`body.embed .nb { display: none !important }`). The wrapper padding is reduced from `30px` to `14px` top.

### Monitor header
An animated anesthesia workstation header visible on every load:
- Three SVG waveform traces: **ECG II** (green `#46d39a`), **SpO₂ pleth** (cyan `#5ad0e6`), **EtCO₂ capnography** (amber `#e8c454`)
- CSS animation `sweep` scrolls the duplicated SVG path at a constant speed
- Six vital cells: HR, SpO₂, NIBP, EtCO₂, RR, Temp — values jitter on a 3-second interval
- **Crisis button** — red-tinted; opens the crisis overlay

### Crisis overlay
Full-screen modal (z-index 5000) with:
- Tabbed emergency protocols (LAST, Anaphylaxis, Malignant Hyperthermia, others)
- Each tab: numbered step-by-step instructions + weight-based dosing rows
- Closed with ✕ button or clicking background

### Calculator panels
Multi-panel layout accessed via tabs. Panels include:
- **Airway** — ETT sizing, depth, Mallampati, RSI drugs
- **Drug dosing** — weight-based induction, relaxant, opioid dosing
- **Ventilation** — tidal volume, PEEP, ARDSnet
- **TIVA / TCI** — propofol/remifentanil infusion guidance
- **Regional anesthesia** — block reference, max local anesthetic dose calculator
- **Vasopressors / Inotropes** — weight-based infusion rates
- **ICU tools** — vasoactive dosing, sedation
- **Fluid management** — MABL, fluid targets
- **Clinical scores** — STOP-BANG, Apfel, ASA, Mallampati
- **Neuraxial** — spinal/epidural dosing

### Patient banner
A sticky strip at the top showing the current patient context (name, procedure, age/weight). Populated from the doctor workspace when a patient is selected.

### Auth
`requireAuth()` is called on load. Patients are redirected away. Accessible to doctors, admins, and "other" staff roles.

---

## 10. Global Navbar (`navbar.js`)

The entire navbar is injected into the DOM by `navbar.js` as an IIFE. It looks for `<div id="nb-placeholder">` and replaces it; if not found it prepends to `<body>`.

### Features
- **Logo** → `index.html`
- **Nav links**: Home, For Patients, Videos, Ask Anesthesiologist
- **Live Monitor widget** — animated ECG SVG + jittering HR/SpO₂/EtCO₂ values (cosmetic, 3.5s interval). Links to `dashboard.html`. Tooltip on hover.
- **Global search** (staff only) — 18-item client-side index, scored by exact/prefix/substring match, max 8 results, keyboard-navigable (↑↓ Enter Escape)
- **Guest state** — "Login" button
- **Auth state** — avatar button with dropdown (initials from full_name; doctors get "Dr. [Last]")
- **Avatar dropdown** — name, role label, email, Doctor Workspace or My Dashboard link, Settings, Sign out
- **Mobile drawer** — hamburger button, full-width link list
- **Auth modal** — sign in / register (two-step register: role chips → credentials), forgot password

### Auth modal registration flow
1. Toggle to "Create an account"
2. Role selection chips: Patient / Doctor / Nurse+Student+Other
3. Role pill shown above email field ("Signing up as Doctor")
4. Email + password fields
5. Submit → `signUp` with `user_metadata.role`

---

## 11. Shared Styles (`styles.css`)

### CSS custom properties
```css
--teal:   #1B6B5A    /* primary dark teal */
--teal2:  #2A8A74    /* hover teal */
--accent: #7ECFC0    /* light teal, labels, links */
--dark:   #0A1A15    /* page background */
--dark2:  #0C1F18    /* card/modal background */
--border: rgba(27,107,90,0.22)
--text:   #ffffff
--muted:  rgba(255,255,255,0.55)
--hint:   rgba(255,255,255,0.28)
--max:    1060px     /* max content width */
--font:   'DM Sans', sans-serif
--serif:  'Playfair Display', serif
```

### Key shared classes
- `.page-wrap` — `max-width: var(--max)`, centered, `padding: 52px 28px 80px`
- `.card-grid` — auto-fill grid, `minmax(260px, 1fr)`, gap 14px
- `.card` — semi-transparent card with top-border hover reveal animation
- `.hero-section` — radial gradient hero with `.hero-eyebrow`, `.hero-h1`, `.hero-sub`, `.hero-btns`
- `.btn-primary` / `.btn-ghost` — action buttons
- `.section-tag`, `.section-title`, `.section-sub` — section headers
- `.site-footer` / `.footer-inner` / `.footer-links`
- Body grid background via `body::before` at 52px × 52px with `rgba(255,255,255,0.022)` lines

`navbar.js` injects its own `<style id="nb-css">` and `body { padding-top: 56px }` for the fixed nav.

---

## 12. Settings Page (`settings.html`)

Traditional two-column layout (210px sidebar + main content). Sidebar has a single "Dashboard" link.

### Sections
- **Account** — read-only email + user ID; current role display; "Request role change" expandable box with radio buttons (patient / other / doctor). Doctor role change sets `verification_status = 'pending'`.
- **Profile** — full name, country, hospital, specialty, phone → `saveProfile()` → `profiles` upsert
- **Change password** — new + confirm fields → `sb.auth.updateUser({ password })`. Min 6 chars, must match.
- **Danger zone** — "Delete account" button (implementation not confirmed in code review)

---

## 13. Ask Anesthesiologist (`ask.html`)

Two-column layout (60% form | 40% FAQ accordion).

### Form fields
- Name, "I am a" (patient / family / nurse / student / other), topic (general, regional/spinal/epidural, pediatric, obstetric, medication, anxiety/other), email (optional), question (textarea)
- Submits to `questions` table with `status = 'new'`

### FAQ accordion
Static FAQ items with CSS max-height animation on toggle.

---

## 14. Current Known Issues

These are issues confirmed by inline code comments or diagnostic code still present in the codebase:

1. **Eruda debug console included in production** — `eruda.init()` is loaded on `index.html`, `dashboard.html`, `engine.html`, `patient-dashboard.html`, `settings.html`, and `ask.html`. Adds a floating dev console button visible to all users. Must be removed before launch.

2. **Auth debug panel rendered on every dashboard load** — Inside `dashboard.html` DOMContentLoaded handler, a fixed overlay showing `user.id`, session status, and role is injected into the DOM for every authenticated visit. Marked "TEMP — remove before launch" in a comment.

3. **Raw Supabase error surfaced to users** — In `wsSavePatient()` (patient insert), the Supabase error message and details are shown directly in the toast: `wsToast('Insert error: ' + r.error.message + ...)`. Comment reads "TEMP: surface the real error (revert to generic before launch)".

4. **WhatsApp delivery only — SMS backend not wired** — `wsSendSmsViaBackend()` is a stub with a `// TODO: call your Edge Function` comment. The only working delivery method is opening `wa.me/`. SMS via Twilio/Edge Function is not implemented.

5. **Resources section is incomplete** — Books, PDFs, Guides, Checklists, Downloads tiles in the dashboard all show a "coming soon" toast. No actual content or links are wired.

6. **`questions.html`, `users.html`, `doctor-approvals.html`, `preop-instructions.html` are legacy pages** — These predate the unified dashboard. Their current state and whether they are still linked anywhere is uncertain. They may be safe to remove or repurpose.

7. **Country list is limited** — Settings page only offers Israel, Georgia, USA, UK, Germany, Other. No full country picker.

8. **`patient-dashboard.html` education and recent activity sections** — Education watch progress and activity timeline appear to be partially or fully static/placeholder. Confirm data source before treating as complete.

9. **`admin.html` Platform settings tab is static** — Values (platform name, support email, feature flags) are hardcoded HTML, not fetched from or saved to any table.

10. **`doctor` role users see a verification banner but can still use the full workspace** — Verification status (`pending`) shows a warning but does not restrict access to any tool. If access restriction before approval is desired, it must be explicitly coded.

---

## 15. Current UI Decisions

These decisions are intentional and should be preserved unless explicitly changed:

1. **Single shared Supabase client** — `window.sb` is the only instance. Never call `createClient` in page scripts. This prevents session conflicts.

2. **Session cache busted on SIGNED_OUT only** — `_sessionPromise` in `auth.js` is intentionally NOT reset on `SIGNED_IN` to avoid redundant network calls. It is reset manually via `resetSessionCache()` after a fresh login.

3. **The Live Monitor widget is always visible in the navbar** — It is part of the brand identity and deliberately shown to both authenticated and guest users. Its vitals values are cosmetic (random jitter), not real data.

4. **Questionnaire delivered without login** — `q.html` uses a random token, not a session, so patients do not need to create an account. This is by design for frictionless patient access.

5. **`questionnaire_status` is set to `'sent'` ONLY after a real delivery action** — Creating a patient never sets it. The WhatsApp pop-up must actually open. Pop-up blocked → status stays `'not_sent'`. This prevents phantom "sent" records.

6. **Score computation is fully client-side** — STOP-BANG, Apfel PONV, BMI, and ASA suggestion are all calculated in the browser at submission time and saved inside the `questionnaire_answers` JSONB column under `_scores` and `_flags`. There is no server-side scoring.

7. **Print PDF is client-side** — `wsPrint()` opens a new window and writes a complete HTML document with inline styles. No server, no PDF library. The window's `print()` method produces the PDF.

8. **Dashboard is a single-page workspace, not multi-page** — All sections (patients, tools, references, ask, admin) switch by toggling `.ws-sec.active`. Navigation tabs do not load new pages. The one exception is clicking "Open full screen" for Live Tools, which opens `engine.html` in a new tab.

9. **Engine embeds inside the dashboard as an iframe** — `engine.html?embed=1` is served inside a `78vh` iframe in the "Live Tools" section. In embed mode, the shared navbar is hidden via `body.embed .nb { display: none }` to avoid double navbars.

10. **Role routing on login always goes to `/v2/dashboard.html` first** — The dashboard then performs role-based redirects (patient → patients.html; no role → role-select.html). This centralises routing logic in one place.

11. **Dark teal colour system** — All UI uses the CSS custom property palette defined in `styles.css`. Do not introduce new brand colours without updating the `:root` block. The primary action colour is `--teal` (`#1B6B5A`) / `--teal2` (`#2A8A74`). Accent labels and links use `--accent` (`#7ECFC0`).

12. **Typography: Playfair Display for headings, DM Sans for body** — Loaded from Google Fonts. Playfair is used for `h1/h2`, card titles, modal titles, and numbers in stat blocks. DM Sans for all body copy, labels, and UI text.

13. **`body::before` grid background** — A subtle 52px × 52px dot grid is rendered globally as a pseudo-element on `body`. Do not remove; it is a deliberate design element on all pages.

14. **`ensureProfile()` never fails a login** — If the Supabase `handle_new_user` trigger does not run (or fails), `ensureProfile()` auto-creates the row from `user_metadata`. A login is never aborted due to a missing profile row.

15. **Timeout guards on all Supabase calls** — `withTimeout(promise, 8000, label)` wraps `getSession` and `getProfile` to prevent indefinite hangs. The dashboard also has a 10-second watchdog that replaces the spinner with a "refresh" message if the page stalls entirely.
