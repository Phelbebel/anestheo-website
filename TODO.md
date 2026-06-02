# TODO — Anestheo v2

> Last updated: 2026-06-02
> Derived from current project state and the known issues in [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) §14.
> Priority reflects launch-readiness and user impact, not effort.

---

## HIGH PRIORITY

Launch blockers — these expose debug tooling, internal errors, or break core trust/security.

- [ ] **Remove Eruda debug console from production.** `eruda.init()` is loaded on `index.html`, `dashboard.html`, `engine.html`, `patient-dashboard.html`, `settings.html`, and `ask.html`. Strip the `<script src=".../eruda">` and `<script>eruda.init()</script>` lines from all pages. (CONTEXT §14.1)

- [ ] **Remove the auth debug panel from `dashboard.html`.** The fixed overlay showing `user.id`, session status, and role is injected on every authenticated load. Delete the "TEMPORARY AUTH DEBUG PANEL" block in the DOMContentLoaded handler. (CONTEXT §14.2)

- [ ] **Stop surfacing raw Supabase errors to users.** In `wsSavePatient()` (`dashboard.html`), the toast prints `r.error.message` and `r.error.details` directly. Revert to a generic message ("Could not save patient. Please try again."), and drop the verbose `console.error`/`console.log` payload dumps. (CONTEXT §14.3)

- [ ] **Confirm Supabase Row Level Security (RLS) is enforced on every table.** Since the app is fully static, RLS is the *only* access-control layer. Verify policies on `profiles`, `clinic_patients`, `patient_surgeries`, `preop_questionnaires`, `preop_checklist`, and `questions`:
  - Doctors can only read/write their own `clinic_patients` (`doctor_id = auth.uid()`).
  - `q.html` (anon, token-based) can read/update only the row matching its token.
  - Only admins can update `profiles.verification_status` / `role` / `is_admin`.
  - Patients can only read/write their own `patient_surgeries` / `preop_*` rows.

- [ ] **Verify the `anon` key in `supabase.js` is the anon (public) key, not the service key.** It is committed in plaintext and shipped to every browser — this is expected for the anon key, but confirm no privileged key is exposed.

---

## MEDIUM PRIORITY

Functional gaps and incomplete features that affect real workflows.

- [ ] **Wire up SMS delivery backend.** `wsSendSmsViaBackend()` is a stub. Implement a Supabase Edge Function (e.g. Twilio) and call it via `sb.functions.invoke('send-sms', ...)`. Currently only `wa.me/` WhatsApp delivery works. (CONTEXT §14.4)

- [ ] **Build out the Resources section.** Books, PDFs, Guides, Checklists, and Downloads tiles in the dashboard all show a "coming soon" toast. Decide on storage (Supabase Storage bucket?) and wire real content + download links. (CONTEXT §14.5)

- [ ] **Resolve legacy pages.** `questions.html`, `users.html`, `doctor-approvals.html`, and `preop-instructions.html` predate the unified dashboard. Audit whether anything still links to them; remove or repurpose. (CONTEXT §14.6)

- [ ] **Make `admin.html` Platform Settings tab functional.** Platform name, support email, and feature flags are currently hardcoded HTML. Either back them with a `platform_settings` table or remove the tab to avoid implying they're editable. (CONTEXT §14.9)

- [ ] **Decide on doctor access gating before verification.** `pending` doctors see a verification banner but retain full workspace + tools access. If pre-approval access should be restricted, code the restriction explicitly. (CONTEXT §14.10)

- [ ] **Confirm patient dashboard data sources.** Verify the Education watch-progress and Recent Activity sections on `patient-dashboard.html` are backed by real data, not placeholders. Wire to actual tables if static. (CONTEXT §14.8)

- [ ] **Verify the "Delete account" flow in `settings.html`.** Danger-zone button implementation was not confirmed during review. Ensure it actually deletes the auth user + cascades profile data, with a confirmation step.

- [ ] **Audit `questionnaire.html` vs `q.html` duplication.** Two questionnaire paths exist (authenticated `preop_questionnaires` vs token-based `clinic_patients.questionnaire_answers`). Confirm both are intentional and that scoring logic doesn't drift between them.

---

## LOW PRIORITY

Polish, completeness, and nice-to-haves.

- [ ] **Expand the country picker in `settings.html`.** Currently only Israel, Georgia, USA, UK, Germany, Other. Use a full ISO country list. (CONTEXT §14.7)

- [ ] **Reduce console noise.** Numerous `console.log` diagnostics remain in `auth.js`, `navbar.js`, and `dashboard.html` (e.g. "LOGIN DIAGNOSTIC", "PROFILE LOOKUP"). Gate behind a debug flag or remove for production.

- [ ] **Expand the global search index.** The 18-item index in `navbar.js` (`NB_SEARCH_INDEX`) omits several reference and specialty pages (e.g. recovery, scores, surgical specialties). Add them.

- [ ] **Add a real favicon and page meta/OG tags.** For sharing links (especially the patient questionnaire link sent via WhatsApp).

- [ ] **Consider extracting repeated inline `<style>` blocks** into shared classes in `styles.css` (loader spinner, modal patterns, `.ws-*` workspace styles are duplicated across pages).

- [ ] **Add loading/empty/error states consistently.** Some lists fall back gracefully (patients, ask queue), others assume data exists. Standardize.

- [ ] **Accessibility pass.** Verify keyboard navigation, focus traps in modals, ARIA labels, and color contrast for the dark teal theme.

- [ ] **Mobile QA of the embedded engine iframe.** `engine.html?embed=1` at `78vh` inside the dashboard — verify scrolling and the crisis overlay behave on small screens.
