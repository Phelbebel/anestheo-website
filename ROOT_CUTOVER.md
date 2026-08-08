# Root cutover runbook

Moving the application from `anestheo.com/v2/` to `anestheo.com/`.

This document is the operational half of the cutover. The code half is already
done and on this branch: every internal path is now root-absolute. Nothing here
has been deployed, and nothing here should be run until the decisions in
section 2 are settled.

**Production state assumed** (as inspected in Hostinger File Manager):

```
public_html/          <- V1 site, live at anestheo.com/
public_html/v2/       <- V2 application, live at anestheo.com/v2/
```

---

## 1. What actually changes

| Layer | Before | After |
|---|---|---|
| Application URL | `anestheo.com/v2/engine.html` | `anestheo.com/engine.html` |
| Homepage | `anestheo.com/v2/` | `anestheo.com/` |
| Patient link | `anestheo.com/v2/q.html?t=TOKEN` | `anestheo.com/q.html?t=TOKEN` |
| Old links | — | 301 to the root equivalent, query string intact |
| Sessions | localStorage on `anestheo.com` | unchanged — same origin, nobody is signed out |

The last row is the one worth internalising: `localStorage` is scoped to the
**origin**, never to the path. `anestheo.com/v2/x` and `anestheo.com/x` are the
same origin. Signed-in users stay signed in, and a clinician with a case open in
Live Tools keeps the case and the running timers. This was verified in a real
browser, not assumed.

---

## 2. DECISIONS REQUIRED BEFORE ANY UPLOAD

Two of these block the cutover. They are product decisions, not engineering
ones, and nothing should be uploaded until they are answered.

### 2a. BLOCKING — `videos.html` collides, and the wrong one wins

You said you prefer the **V1** videos page. V1 and V2 both have a file called
`videos.html` at the document root. Uploading the V2 site over `public_html/`
**overwrites the V1 videos page with the V2 one**. The preference is lost
silently — no error, the page just becomes the other page.

The V2 `videos.html` is not dead weight either: it is wired into the shared
navigation, into `videos-data.js`, and into the patient dashboard's video cards.
Simply keeping the V1 file at `/videos.html` means the site's own navigation
points clinicians and patients at a page built on a different stylesheet
(`style.css`) and a different auth model (`anestheo-app.js`), with no navbar.

Pick one before the cutover:

| Option | What happens | Cost |
|---|---|---|
| **A. Keep V2** | Upload as normal. V1 videos page is gone. | Loses the page you prefer. |
| **B. Keep V1 at `/videos.html`** | Exclude `videos.html` from the upload. | A V1 page inside a V2 site: no navbar, different CSS, different auth. This is the hybrid you said you did not want. |
| **C. Park V1, keep V2 live** | Upload V2; keep the V1 file as `/videos-v1.html`, unlinked. | Nothing breaks, nothing is lost, and the V1 page stays available to port from. |
| **D. Port V1 into V2** | Rebuild the V2 page to match the V1 one, then upload. | The only option that ends with both the page you want *and* a coherent site. Needs the screenshots you mentioned; a separate task, not part of the cutover. |

**Recommendation: C now, D later.** C is reversible, costs nothing, and does not
block the cutover. D is the real answer but it is a design task and should not
be attempted inside a migration.

Nothing in this branch deletes or alters either videos page. `/videos.html`
is flagged **PRESERVE / REVIEW** and left exactly as it is.

### 2b. BLOCKING — V1 and V2 share `auth.js` and `supabase.js`

Both sites have files with these names at the root. They are **completely
different files**. Uploading V2 replaces V1's copies.

Every surviving V1 page that loads `auth.js` or `supabase.js` — `auth.html`,
`register.html`, `doctor.html`, `patient.html`, `clinical.html`,
`calculator.html` — would then be running **V1 HTML against V2 JavaScript**.
That does not fail loudly. It fails as a login form that silently does nothing,
or a page that half-initialises. This is precisely the unexplained hybrid to
avoid.

The fix is not to preserve V1's `auth.js` — that would break the V2 app instead.
The fix is that the V1 pages that depend on it must not remain reachable. See
section 3.

---

## 3. V1 root inventory — classification

Every file you listed, and what should happen to it. **Nothing in this branch
deletes any of them.** This is the decision record for a human to execute.

### Collides with V2 — V2 overwrites on upload (8 files)

| File | Class | Note |
|---|---|---|
| `index.html` | **REPLACE WITH V2** | Intended. This is the cutover. |
| `about.html` | **REPLACE WITH V2** | V2 version is current. |
| `admin.html` | **REPLACE WITH V2** | V2 Admin Center supersedes it entirely. |
| `ask.html` | **REPLACE WITH V2** | V2 version is wired to `question_replies`. |
| `patients.html` | **REPLACE WITH V2** | V2 version is current. |
| `auth.js` | **REPLACE WITH V2** | See 2b — breaks surviving V1 pages. |
| `supabase.js` | **REPLACE WITH V2** | See 2b — same. |
| `videos.html` | **PRESERVE / REVIEW — BLOCKING** | See 2a. Do not upload until decided. |

### Survives the upload — V1-only (22 files)

| File | Class | Action |
|---|---|---|
| `favicon.ico` | **KEEP V1** | Browsers request `/favicon.ico` by convention. V2 declares no favicon, so this V1 asset is what gives the site its icon. Keeping it is not an accident — it is the only favicon there is. |
| `favicon-16x16.png`, `favicon-32x32.png` | **KEEP V1** | Same. |
| `apple-touch-icon.png` | **KEEP V1** | iOS requests `/apple-touch-icon.png` by convention. Same reasoning. |
| `logo.png` | **KEEP V1** | Brand asset. Unreferenced by V2 but harmless and likely wanted. |
| `sitemap.xml` | **REPLACE WITH V2** | The V1 sitemap lists `calculator.html`, `clinical.html`, `doctor.html`, `patient.html`, `register.html` — pages that will not exist. Leaving it advertises a set of URLs that all 404. A replacement is on this branch. |
| `style.css` | **OBSOLETE** | V2 uses `styles.css` + `point.css`. No collision, but nothing in V2 loads it. Orphan once V1 pages are gone. |
| `_nav.html` | **OBSOLETE** | V1 nav include. Superseded by `navbar.js`. |
| `anestheo-app.js` | **OBSOLETE** | V1 application script. |
| `auth.html` | **OBSOLETE — see 2b** | V1 login. Broken the moment `auth.js` is replaced. |
| `register.html` | **OBSOLETE — see 2b** | V1 registration. Same. |
| `doctor.html` | **OBSOLETE — see 2b** | Superseded by `dashboard.html`. |
| `patient.html` | **OBSOLETE — see 2b** | Superseded by `patient-dashboard.html`. |
| `clinical.html` | **OBSOLETE — see 2b** | Superseded by `references.html`. |
| `calculator.html`, `calculators.html` | **OBSOLETE — see 2b** | Superseded by `engine.html`. |
| `contact.html` | **REVIEW** | No V2 equivalent. If a contact route is still wanted, it needs a V2 page; if not, retire it. Decide, don't drift. |
| `legal.html` | **REVIEW** | V2 splits this into `terms`, `privacy`, `cookies`, `data-protection`, `medical-disclaimer`. Confirm nothing legal is lost, then retire. |
| `doctor.jpg` | **OBSOLETE** | Used only by V1 pages. |
| `Pre-operative anesthesia questionnaire.html` | **OBSOLETE** | Superseded by `q.html` / `questionnaire.html`. The space-containing filename is also a URL-encoding hazard. |
| `build_pages.py` | **OBSOLETE — SECURITY** | A build script has no reason to be web-readable. |
| `supabase_migration_final.sql` | **OBSOLETE — SECURITY, see below** | |

### `supabase_migration_final.sql` — production security cleanup item

This file is currently **downloadable by anyone** at
`https://anestheo.com/supabase_migration_final.sql`. It is a full schema dump.

This is not a breach on its own. The real boundary is Supabase RLS, and the anon
key is a published-by-design `role:anon` JWT. But a schema dump hands an
attacker the complete table, column and policy map for free, which turns
guesswork into targeted probing. It should not be there.

**Not deleted in this task**, as instructed. Two things reduce it now:

1. The prepared `.htaccess` denies `.sql`, `.md`, `.py`, `.log` and dotfiles.
   That closes the hole without deleting anything, and is reversible.
2. It should still be **removed from `public_html` entirely** in a separate,
   deliberate cleanup — keep a copy off the web root first.

Treat the same way: `build_pages.py`.

### Orphan pages left reachable

The V1 pages classed OBSOLETE above stay physically present and publicly
reachable at the root after the cutover unless removed. A search engine that
already indexed them will keep sending people to an old product wearing the same
domain — and after 2b, to an old product whose login no longer works.

**Recommendation:** after the cutover is verified, move all OBSOLETE files to a
dated folder outside `public_html` in one step. Not during the cutover — one
change at a time.

---

## 4. MANUAL CUTOVER STEPS — Supabase

**These cannot be done from the repository.** They are project settings in the
Supabase dashboard, and the cutover is not complete without them. Do them in the
window given in section 6.

Project: `zaptzjohvgwayvytntyb`

| # | Setting | Where | Change | Why |
|---|---|---|---|---|
| 1 | **Site URL** | Authentication → URL Configuration | `https://anestheo.com` | **The highest-risk item.** `signUp()` and `resetPasswordForEmail()` are both called with **no `redirectTo`**, so both fall back to Site URL. If it still points at `/v2/`, every confirmation and password-reset email sends users to the old path. |
| 2 | **Redirect URLs** allowlist | same page | add `https://anestheo.com/**` | Keep the `/v2/**` entry until the old links have aged out. Removing it early only breaks things. |
| 3 | **Email templates** | Authentication → Email Templates | check for any hard-coded `/v2/` | Templates using `{{ .SiteURL }}` follow #1 automatically. A hard-coded path does not. |
| 4 | **CORS / allowed origins** | API settings | confirm `https://anestheo.com` | Origin is unchanged by the cutover, so this should already be right. Confirm, don't assume. |
| 5 | **Edge Functions** | `youtube-latest`, `convert_clinic_patient` | no change needed | Verified: neither contains a `/v2/` URL. Only a comment mentions v2. |

### Recovery-link caveat, and a pre-existing gap

Supabase recovery and confirmation links carry their token in the **URL
fragment** (`#access_token=…`). Fragments are never sent to the server, so a
301 does not see one. Browsers do re-attach the original fragment when the
`Location` header has none, so a redirected recovery link will usually still
work — but "usually" is not a good enough standard for password reset. Fixing
Site URL (#1) means recovery links never hit the redirect at all. Do #1.

Separately, and **not caused by this cutover**: there is no password-reset
landing handler anywhere in the codebase. No `PASSWORD_RECOVERY` listener, no
`updateUser({password})`, no reset form. `resetPasswordForEmail()` sends the
email, the link signs the user in via `detectSessionInUrl`, and there is nowhere
to set a new password. This is a pre-existing product gap. It is recorded here
because the cutover is when Site URL gets touched, and it should be fixed in its
own task.

---

## 5. MANUAL CUTOVER STEP — the database

`admin_search()` returns six hard-coded destinations that `admin.html` uses as
the href when an admin opens a search result:

```
'/v2/admin.html'      x2
'/v2/dashboard.html'  x4
```

A forward migration is prepared: **`root_cutover_admin_search_destinations.sql`**.

* `v2_admin_phase0.sql` is **not modified** — it is applied history.
* The migration rewrites the installed function rather than re-declaring it, so
  whichever source branches this database actually compiled are preserved.
* It refuses to run unless it finds exactly six `/v2/` literals.
* It is idempotent and verifies itself inside a transaction.
* A reverse block is included at the foot of the file.

**Run it AFTER the site is live at the root and verified — not before.** Until
then `/v2/admin.html` is the correct answer and `/admin.html` is not.

This migration was executed against a real PostgreSQL 16 instance with
`v2_admin_phase0.sql` installed and all six search branches compiled: forward
rewrite, idempotent re-run, grant preservation, live `admin_search()` execution,
the drift guard, and the reverse block were all exercised.

---

## 6. Cutover sequence

Numbered so a step can be named when something goes wrong.

**Before you start:** do this at a low-traffic hour. Have the Hostinger File
Manager and the Supabase dashboard both open before step 1.

| # | Step | Notes |
|---|---|---|
| 1 | **Back up `public_html` in full.** Download or archive it, including `v2/`. | **The rollback depends entirely on this.** V1 root files are not in the repository and cannot be reconstructed. Do not proceed without it. |
| 2 | Verify the backup opens and contains the V1 root files. | A backup you have not opened is not a backup. |
| 3 | Resolve the two blocking decisions in section 2. | Do not start uploading with these open. |
| 4 | Upload the branch contents to `public_html/`, honouring the 2a decision. | Do **not** upload `deploy/`, `docs/`, `*.md`, or `*.sql`. Do not delete anything. |
| 5 | Confirm `public_html/v2/` is **untouched**. | This is the fast rollback. |
| 6 | Upload `deploy/htaccess-root-cutover` as `public_html/.htaccess`. | This is the moment the cutover goes live. Everything before it is inert. |
| 7 | Smoke test, signed out: `/`, `/index.html`, `/procedures.html`, `/patients.html`, `/videos.html`, `/404-does-not-exist`. | Expect the 404 page, not a Hostinger error page. |
| 8 | Test a legacy URL: `/v2/engine.html` → one 301 → `/engine.html`. | Check the network panel: **one** hop. |
| 9 | Test a legacy **token** link: `/v2/q.html?t=REAL_TOKEN`. | The token must survive. This is the clinically important one. |
| 10 | Sign in as a doctor. Open Live Tools, start a case, start a timer, run a search, open Crisis Center. | |
| 11 | Sign in as a patient. Open My Space, open a questionnaire. | |
| 12 | Sign in as admin. Open Admin Center, run a search, **open a result**. | It will still route via `/v2/…` and redirect — expected until step 15. |
| 13 | **Supabase settings** — section 4, items 1–3. | |
| 14 | Register a throwaway account and trigger a password reset. Confirm both emails point at `https://anestheo.com/…` with no `/v2/`. | Do not skip. This is the highest-risk item. |
| 15 | Run `root_cutover_admin_search_destinations.sql`. Re-test step 12; the hop should be gone. | |
| 16 | Submit `sitemap.xml` in Google Search Console. Leave the old `/v2` URLs crawlable. | The 301s are what move ranking to the new URLs. |
| 17 | Watch for 24–48h before removing anything. | |

## 7. Rollback

Choose by how far you got.

**Before step 6** — nothing is live. The new files are sitting at the root but
the site still serves whatever `index.html` it served before. Restore
`index.html` and the other seven collided files from the backup.

**After step 6, and the fastest path** — delete `public_html/.htaccess`.

That single deletion stops all `/v2/` redirects, and `anestheo.com/v2/` is
immediately live again, because step 5 left it untouched. The root will still
hold V2 files, so restore the eight collided V1 files from the step-1 backup to
finish. Seconds, not minutes.

**After step 15** — run the reverse block at the foot of
`root_cutover_admin_search_destinations.sql` before restoring, so `admin_search`
matches the site again.

**Supabase settings** — revert Site URL to its previous value. Note what it was
before changing it in step 13.

**Rollback anchors**

* Production commit before this work: `97937d1e709234cd17eddd5ca4f1a4d01b3771ed`
* This branch is not merged. `main` is untouched.

## 8. Deliberately not done

* **`/index.html` was not rewritten to `/`.** `/` is the advertised homepage and
  the sitemap's canonical entry, and `DirectoryIndex` serves it. Internal links
  still say `/index.html`. The reason is `navbar.js`, where active-state
  matching is `it.href.split('/').pop() === page`: an href of `/` yields `''`
  while the page key is `'index.html'`, so the home tab would silently lose its
  active state. Both URLs serve the same page; changing 36 links to gain a
  cosmetic URL, during a migration, is a bad trade. Revisit separately.
* **No per-page canonical, Open Graph or JSON-LD.** The site has none today
  (1 of 50 pages has even a meta description). That is a real gap and worth a
  task, but it is a content change across 50 files and does not belong in a
  cutover.
* **No caching headers.** Drafted and commented out in the `.htaccess`. Turn on
  only after the cutover is verified.
* **No V1 files deleted, moved or renamed.**
* **Nothing deployed.**
