# ARCHITECTURE.md — Anestheo v2

> Created: 2026-06-02
> Companion docs: [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) · [MIGRATION_PLAN.md](MIGRATION_PLAN.md) · [TODO.md](TODO.md)
> This is a documentation file only. No application code is described as changed.

**Legend**
- ✅ **Active** — current, supported system
- ⚠ **Legacy** — still present, works, but superseded / not the intended path
- ❌ **Planned for retirement** — to be frozen/redirected per MIGRATION_PLAN.md

Static-file app (no build step). Vanilla JS. Single Supabase backend.
Script load order on every page: `CDN supabase-js → supabase.js → auth.js → navbar.js → page script`.

---

## 1. Complete Page Map

### Public / marketing
| Page | Status | Purpose |
|---|---|---|
| `index.html` | ✅ | Landing page; role-aware hero; animated monitor preview |
| `patients.html` | ✅ | "For Patients" portal (also the patient landing after login) |
| `videos.html` | ✅ | Video library |
| `resources.html` | ✅ | Resource library (content largely "coming soon") |
| `ask.html` | ✅ | Ask Anesthesiologist — public form + FAQ |

### Clinical reference pages (public URL, doctor-facing)
| Page | Status |
|---|---|
| `airway.html`, `difficult-airway.html`, `anticoagulation.html`, `regional.html`, `obstetric.html`, `pediatric.html`, `icu.html`, `last.html`, `anaphylaxis.html`, `recovery.html`, `scores.html`, `references.html` | ✅ |

### Surgical specialty references
| Page | Status |
|---|---|
| `general-surgery.html`, `orthopedic.html`, `ent.html`, `plastic.html`, `dental.html`, `urology.html`, `oncogynecology.html`, `csection.html`, `procedures.html` | ✅ |

### Authenticated app
| Page | Status | Purpose |
|---|---|---|
| `dashboard.html` | ✅ | Doctor/admin single-page workspace |
| `engine.html` | ✅ | Anesthesiology Live Tools (calculators) |
| `patient-dashboard.html` | ✅ | Patient surgery-journey dashboard |
| `q.html` | ✅ | **Questionnaire fill — token-based, no login (surviving engine)** |
| `questionnaire.html` | ❌ | Authenticated 6-step questionnaire (System B — planned retirement → redirect) |
| `questionnaires.html` | ⚠ | Questionnaire list view |
| `settings.html` | ✅ | Profile / password / role-change |
| `admin.html` | ✅ | Full admin center |
| `role-select.html` | ✅ | Onboarding role picker for users with no role |

### Legacy / pre-unification pages
| Page | Status | Note |
|---|---|---|
| `users.html` | ⚠ | Superseded by `admin.html` Users tab |
| `questions.html` | ⚠ | Superseded by `admin.html` / dashboard Ask section |
| `doctor-approvals.html` | ⚠ | Superseded by `admin.html` Approvals tab |
| `preop-instructions.html` | ⚠ | Reads `preop_checklist`; standalone |

### Shared assets
| File | Status | Purpose |
|---|---|---|
| `supabase.js` | ✅ | Single `window.sb` client |
| `auth.js` | ✅ | Auth + questionnaire helpers |
| `navbar.js` | ✅ | Nav, auth modal, search, live-monitor widget |
| `styles.css` | ✅ | Global shared styles |

---

## 2. Navigation Flow

```
                          index.html (public)
                                │
                 ┌──────────────┼───────────────┐
            Login/Register   For Patients      Live Monitor widget
                 │           patients.html     → dashboard.html
                 ▼
        navbar.js auth modal
                 │
        sb.auth.signIn / signUp
                 │
                 ▼
          dashboard.html  ──── role router ────┐
                 │                             │
   role=patient  │            role=doctor/admin/other
                 ▼                             ▼
        patients.html               Doctor/Admin workspace
        patient-dashboard.html      (sections switch in-place)
                 │                             │
        q.html (token link)          engine.html (iframe ?embed=1)
                                      admin.html (full)
                                      settings.html
```

- Guests get the navbar "Login" button + public pages.
- Authenticated navbar shows avatar dropdown: Workspace/My Dashboard, Settings, Sign out, and (staff) global search.
- The **Live Monitor widget** in the navbar is always visible (brand identity) and links to `dashboard.html`.

---

## 3. Doctor Workflow ✅

Primary workflow of the product.

```
1. Doctor signs in → dashboard.html (role=doctor)
2. Patient Management section (default):
     Add patient form → INSERT clinic_patients
        (doctor_id, name, phone, procedure, hospital, date; token generated;
         questionnaire_status='not_sent')
3. Send questionnaire:
     wsSendWhatsApp() → opens wa.me/<phone>?text=...<link /v2/q.html?t=token>
     → on real send: questionnaire_status='sent'
4. Patient fills (see §6). Status flows: sent → opened → in_progress → completed
5. Doctor sees results:
     wsLoadPatients() → SELECT * FROM clinic_patients (RLS: doctor_id = auth.uid())
     Patient card shows stepper, scores (BMI/STOP-BANG/Apfel/ASA), risk flags
     View summary modal · Print PDF · private doctor_notes
6. Consultation workflow:
     Patient arrived → Mark reviewed → Ready for surgery
     (consultation_status / patient_status transitions)
```

Other dashboard sections: Live Tools (iframe), References, Resources, Questions Management (reads `questions`), Admin (admin only).

---

## 4. Patient Workflow

### Primary (token, no account) ✅
```
Receives WhatsApp/SMS link → /v2/q.html?t=<token>
   → RPC get_clinic_patient_by_token (marks 'opened')
   → fills adaptive questionnaire
   → RPC submit_clinic_questionnaire → clinic_patients.questionnaire_answers, 'completed'
   → completion summary + print/PDF
NO account required.
```

### Optional (with account) ✅
```
Signs in → patient-dashboard.html
   - Upcoming surgery (patient_surgeries, self-reported)
   - Preparation progress
   - Questionnaire status + results
   - My questions (questions table)
   - Education / activity
```

> Per MIGRATION_PLAN.md: the patient dashboard will read `clinic_patients`
> (via best-effort `patient_user_id` link). Accounts remain optional.

### Legacy authenticated fill ❌
```
questionnaire.html (requireAuth) → preop_questionnaires
   System B — planned retirement (redirect to token flow).
```

---

## 5. Admin Workflow ✅

```
Admin signs in → dashboard.html (Admin section) OR admin.html (full)
   Doctor approvals:  profiles.verification_status pending → approve/reject
   User management:   change profiles.role / verification_status
   Submitted questions: read questions table
   Platform settings: static display (not yet persisted)
Gate: is_admin === true OR role === 'admin' (client-side check + RLS).
```

---

## 6. Questionnaire Workflow

> **Two systems exist today. One is being consolidated out.** See MIGRATION_PLAN.md.

### ✅ SURVIVING — System A (Clinic / Token)
```
dashboard.html (doctor) ─creates─► clinic_patients (doctor_id, token)
        │  /v2/q.html?t=<token>   (no login)
        ▼
q.html  engine: QUESTIONS array (35+ adaptive fields), branching
        (pregnancy / pediatric / cesarean pathways),
        scoring: BMI, STOP-BANG, Apfel PONV, ASA suggestion
        │  RPC submit_clinic_questionnaire(token, answers)
        ▼
clinic_patients.questionnaire_answers (JSONB: fields + _scores + _flags)
        ├─► Doctor dashboard ✅
        └─► Patient dashboard ✅ (planned, via patient_user_id)

RPCs (SECURITY DEFINER, granted to anon+authenticated):
  get_clinic_patient_by_token(token)        → reads + marks 'opened'
  mark_clinic_questionnaire_progress(token) → marks 'in_progress'
  submit_clinic_questionnaire(token, jsonb) → writes answers, marks 'completed'
```

### ❌ RETIRING — System B (Self-serve / Account)
```
questionnaire.html (requireAuth) ─saveQuestionnaire()─► preop_questionnaires
   6-step wizard; field vocab 'history:[heart]', 'yes'/'no'
   Doctor dashboard NEVER reads this table → data dead-end.
   Plan: freeze table read-only; redirect page; archive existing rows (no auto-map).
```

### Engine status
- ⚠ Today the engine is duplicated/divergent (q.html vs questionnaire.html) and the field-label map is repeated 3× inside the code.
- ✅ Target: single `questionnaire-engine.js` extracted from `q.html` (MIGRATION_PLAN Phase 1).

---

## 7. Authentication Flow ✅

```
navbar.js auth modal
  ├─ Sign in:  sb.auth.signInWithPassword()
  │     → verify getSession() → load/auto-create profiles (ensureProfile)
  │     → redirect /v2/dashboard.html
  └─ Register: role chips (patient/doctor/other) → sb.auth.signUp({data:{role,...}})
        → routeByRole()  (patient→patients.html; else dashboard.html)

dashboard.html role router:
  no session         → index.html
  no/pending role    → role-select.html
  role=patient       → patients.html
  doctor/admin/other → render workspace in place

Session: localStorage key 'anestheo-auth'; _sessionPromise cache in auth.js
  (busted on SIGNED_OUT only). 8s timeout guards; 10s dashboard watchdog.
ensureProfile() guarantees a profiles row so login never fails on a missing row.
```

---

## 8. Supabase Table Relationships

```
auth.users (Supabase managed)
   │ 1───1
   ▼
profiles ✅                         id = auth.users.id (PK/FK)
   role, verification_status, is_admin, full_name, hospital, specialty, ...
   │
   │ doctor_id (FK → auth.users.id)
   ▼
clinic_patients ✅  ◄── SINGLE SOURCE OF TRUTH for the doctor workflow
   id, doctor_id, token (UNIQUE), patient_name, phone, procedure, hospital,
   surgery_date, questionnaire_status, consultation_status, patient_status,
   questionnaire_answers (JSONB: fields + _scores + _flags), doctor_notes,
   [planned] patient_user_id (FK → auth.users.id, best-effort patient link)
   RLS: doctor_id = auth.uid() OR admin  [+ planned OR patient_user_id = auth.uid()]
   Anon access only via SECURITY DEFINER token RPCs.

preop_questionnaires ❌ (retiring → read-only archive)
   patient_id (FK → auth.users.id, UNIQUE), answers, risk_flags, status, ...
   NOT linked to clinic_patients. NOT read by doctor dashboard.

preop_checklist ✅ (unrelated to consolidation)
   patient_id (FK → auth.users.id, UNIQUE), items (JSONB)

patient_surgeries ✅
   patient_id (FK → auth.users.id, UNIQUE), procedure_type, surgery_date,
   hospital, surgeon, anesthesia_type   (patient self-reported)

questions ✅
   name, topic, question, email, subject, message, status
   Written by ask.html; read by dashboard (Ask) + admin.html.

NOTE: clinic_patients ╳ preop_questionnaires have NO relationship today.
```

---

## 9. Live Tools Architecture ✅

```
engine.html
  ├─ Standalone:  /v2/engine.html              (full screen, with navbar)
  └─ Embedded:    /v2/engine.html?embed=1       (iframe inside dashboard.html
                     → body.embed hides duplicate navbar via CSS)

Components:
  - Monitor header: animated SVG traces (ECG / SpO2 pleth / EtCO2 capno)
       + jittering vitals (HR, SpO2, NIBP, EtCO2, RR, Temp). Cosmetic.
  - Crisis overlay (z-index 5000): tabbed emergency protocols
       (LAST, anaphylaxis, MH, ...) with steps + weight-based dosing.
       ⚠ Rendered INSIDE the iframe → clipped on mobile (known issue).
  - Calculator panels: Airway, Drug dosing, Ventilation, TIVA/TCI,
       Regional, Vasopressors/Inotropes, ICU, Fluids, Scores, Neuraxial.
  - Patient banner: sticky context strip (name/procedure/age/weight).

Auth: requireAuth() on load; patients redirected; doctors/admin/other allowed.
```

---

## 10. Current Source of Truth (per feature)

| Feature | Source of truth | Status |
|---|---|---|
| User identity / role / verification | `profiles` (+ `auth.users`) | ✅ |
| Doctor's patients & workflow status | `clinic_patients` | ✅ |
| **Questionnaire answers + scores** | `clinic_patients.questionnaire_answers` | ✅ (single, target) |
| Questionnaire answers (legacy) | `preop_questionnaires` | ❌ retiring → archive |
| Questionnaire engine (questions + scoring) | `q.html` (→ to be extracted to `questionnaire-engine.js`) | ✅ / ⚠ duplicated today |
| Patient self-reported surgery | `patient_surgeries` | ✅ |
| Pre-op checklist | `preop_checklist` | ✅ |
| Ask-the-anesthesiologist Q&A | `questions` | ✅ |
| Clinical references content | Hardcoded in each reference HTML page | ✅ |
| Live Tools calculators | Hardcoded in `engine.html` | ✅ |
| Patient ↔ account link | (none today) → planned `clinic_patients.patient_user_id` | ⚠ planned |
| Platform settings | Hardcoded HTML in `admin.html` | ⚠ not persisted |

---

## Known Architectural Issues (cross-ref TODO.md)

- ⚠ Two questionnaire systems (being consolidated — MIGRATION_PLAN.md).
- ⚠ No shared template/component system; `<head>`, loader, `ge()`/`esc()`, label maps duplicated across pages.
- ⚠ Authorization is client-side `if` + RLS only; RLS is the real boundary (verify policies).
- ⚠ Debug tooling (Eruda, auth debug panel, raw error toasts) shipped to users — HIGH priority in TODO.md.
- ⚠ Crisis overlay rendered inside the engine iframe → clipped on mobile.
