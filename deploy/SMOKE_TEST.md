# Post-cutover smoke test

Run immediately after `.htaccess` goes live (step 10 of the cutover sequence).
Budget 10–15 minutes. Work top to bottom.

**Stop rule:** anything marked **CRITICAL** that fails means roll back now —
`ROOT_CUTOVER.md` §10, delete `.htaccess`, one action. Do not debug a live
clinical site. Roll back first, diagnose second.

Use a **private/incognito window** for the signed-out section so a cached
session does not mask a failure. Keep the browser network panel open throughout.

---

## A. Public — signed out  (2 min)

| ☐ | Check | Expect | |
|---|---|---|---|
| ☐ | `anestheo.com/` | V2 homepage, navbar renders | **CRITICAL** |
| ☐ | `anestheo.com/index.html` | Same page, no redirect | |
| ☐ | `/videos.html` | **The V1 videos page.** URL bar still reads `/videos.html` | **CRITICAL** |
| ☐ | `/videos.html` network panel | **Zero 404s** — no escaped relative paths | **CRITICAL** |
| ☐ | `/procedures.html` | Procedure index, links work | |
| ☐ | `/patients.html` | "For Patients" | |
| ☐ | `/preop-instructions.html` | Loads; `#fasting` anchor jumps | |
| ☐ | `/privacy.html`, `/terms.html`, `/cookies.html`, `/medical-disclaimer.html`, `/data-protection.html` | All load | |
| ☐ | `/robots.txt` | Serves; `Sitemap:` line present | |
| ☐ | `/sitemap.xml` | Serves as XML | |
| ☐ | `/this-does-not-exist` | **Anestheo 404 page**, not a Hostinger error page | |
| ☐ | `/deep/nested/nope.html` | Same 404 page, styled correctly | |

## B. Assets and versioning  (1 min)

| ☐ | Check | Expect | |
|---|---|---|---|
| ☐ | Network panel on `/` | **No 404 on any .js or .css** | **CRITICAL** |
| ☐ | Any asset URL | Ends `?v=2026.08.07-18` | **CRITICAL** |
| ☐ | Every asset on the page | **Same** `?v=` value — no mixed versions | **CRITICAL** |
| ☐ | `/styles.css` direct | Loads; `@import` of `point.css` also carries `?v=` | |
| ☐ | Hard reload (Ctrl/Cmd-Shift-R) on `/engine.html` | No console errors | |

> A mixed `?v=` across one page means a partial upload. Re-upload before going
> further — that is the exact failure the stamping system exists to prevent.

## C. Legacy `/v2` URLs  (2 min)

| ☐ | Check | Expect | |
|---|---|---|---|
| ☐ | `/v2/` | 301 → `/` , **one hop** | **CRITICAL** |
| ☐ | `/v2` (no slash) | 301 → `/` | |
| ☐ | `/v2/engine.html` | 301 → `/engine.html`, one hop | **CRITICAL** |
| ☐ | `/v2/dashboard.html` | 301 → `/dashboard.html` | |
| ☐ | `/v2/videos.html` | 301 → `/videos.html` → **V1 page** | |
| ☐ | `/v2/q.html?t=REALTOKEN` | 301 → `/q.html?t=REALTOKEN` — **token intact** | **CRITICAL** |
| ☐ | Any of the above in the network panel | Never more than **2 hops**, never a loop | **CRITICAL** |

> Use a real token from a real patient row. A made-up token proves the redirect
> but not that the questionnaire opens.

## D. Legacy V1 URLs  (2 min)

| ☐ | Old URL | Expect |
|---|---|---|
| ☐ | `/auth.html` | 301 → `/index.html` |
| ☐ | `/register.html` | 301 → `/index.html` |
| ☐ | `/doctor.html` | 301 → `/dashboard.html` |
| ☐ | `/patient.html` | 301 → `/patient-dashboard.html` |
| ☐ | `/calculator.html` | 301 → `/engine.html` |
| ☐ | `/calculators.html` | 301 → `/engine.html` |
| ☐ | `/clinical.html` | 301 → `/references.html` |
| ☐ | `/legal.html` | 301 → `/terms.html` |
| ☐ | `/_nav.html` | 301 → `/` |
| ☐ | `/contact.html` | 404 page — **expected until decided** |
| ☐ | `/supabase_migration_final.sql` | **403 or 404 — must NOT download** |
| ☐ | `/build_pages.py` | **403 or 404** |
| ☐ | `/ROOT_CUTOVER.md` | **403 or 404** |

## E. Authentication  (3 min)  — all CRITICAL

| ☐ | Check | Expect |
|---|---|---|
| ☐ | Guarded page signed out, e.g. `/dashboard.html` | Redirects to `/index.html`, **not** `/v2/index.html` |
| ☐ | Sign in as a doctor | Lands on the doctor workspace |
| ☐ | Reload the page | **Still signed in** — session persisted |
| ☐ | Open a second tab at `/engine.html` | Still signed in |
| ☐ | Navbar auth state | Shows the account, not "Sign in" |
| ☐ | Sign out | Lands on `/index.html`; guarded pages bounce again |
| ☐ | Register a throwaway account | Confirmation email arrives |
| ☐ | **The link in that email** | Points at `https://anestheo.com/…` with **no `/v2/`** |
| ☐ | Password reset for that account | Reset email also has **no `/v2/`** |
| ☐ | Role routing | Patient → `/patient-dashboard.html`; doctor/admin → `/dashboard.html` |

> The two email checks only pass **after** Supabase Site URL is updated
> (sequence step 12). If you are running section E before step 12, expect `/v2/`
> in the links and re-check afterwards.

## F. Doctor  (3 min)

| ☐ | Check | Expect | |
|---|---|---|---|
| ☐ | `/dashboard.html` | Patient list loads, real data | **CRITICAL** |
| ☐ | `/engine.html` Live Tools | All panels render | **CRITICAL** |
| ☐ | Enter age/sex/height/weight | Values compute | **CRITICAL** |
| ☐ | **New Case** | Clears inputs and stops timers | **CRITICAL** |
| ☐ | Start a timer, navigate away, come back | Timer still running, elapsed correct | **CRITICAL** |
| ☐ | Search "propofol" | Drug result with correct dose and colour | **CRITICAL** |
| ☐ | Search "massive haemorrhage" | Routes to Fluids and blood | |
| ☐ | **Crisis Center** | Opens, content correct | **CRITICAL** |
| ☐ | `/references.html`, `/airway.html`, `/regional.html` | Load, no 404s | |
| ☐ | Generate a questionnaire link for a test patient | URL is `https://anestheo.com/q.html?t=…` — **no `/v2/`** | **CRITICAL** |
| ☐ | WhatsApp / Copy link / Email buttons | Message body contains the root URL | |

## G. Patient  (2 min)

| ☐ | Check | Expect | |
|---|---|---|---|
| ☐ | `/patient-dashboard.html` | "My Space" loads | **CRITICAL** |
| ☐ | Open the **new** link `/q.html?t=REALTOKEN` | Correct patient's questionnaire | **CRITICAL** |
| ☐ | Open the **old** link `/v2/q.html?t=REALTOKEN` | Same questionnaire, one redirect | **CRITICAL** |
| ☐ | Answer one question and save | Persists | |
| ☐ | `/questionnaire.html` signed in | Loads | |
| ☐ | `/ask.html` | Loads | |

## H. Admin  (2 min)

| ☐ | Check | Expect | |
|---|---|---|---|
| ☐ | `/admin.html` as admin | Admin Center loads | **CRITICAL** |
| ☐ | `/admin.html` as doctor | Redirects to `/dashboard.html` | **CRITICAL** |
| ☐ | Global search for a known patient | Results appear | |
| ☐ | **Open a search result** | Navigates correctly | **CRITICAL** |
| ☐ | Before the SQL step | Destination goes via `/v2/…` and redirects — **expected** | |
| ☐ | After the SQL step (step 14) | Destination is `/admin.html` or `/dashboard.html` directly, **no redirect hop** | |
| ☐ | `/users.html`, `/doctor-approvals.html`, `/questions.html` | Load | |

## I. Mobile  (1 min)

On a real phone, not a resized desktop window.

| ☐ | Check | Expect |
|---|---|---|
| ☐ | `anestheo.com/` | Renders, navbar usable |
| ☐ | `/engine.html` | Command strip and timer strip present |
| ☐ | `/videos.html` | V1 page renders |
| ☐ | An old `/v2/q.html?t=…` link tapped from WhatsApp | Opens the questionnaire |

---

## Result

```
Date/time  ______________________   Performed by  ______________________

CRITICAL failures: ______     Non-critical failures: ______

☐ PASS  — proceed to Supabase settings (step 12)
☐ FAIL  — ROLL BACK NOW (ROOT_CUTOVER.md §10)
```

Record every failure with the exact URL and what you saw. A failure list is what
makes the second attempt quick.
