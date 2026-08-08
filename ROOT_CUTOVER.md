# Root cutover runbook

Moving the application from `anestheo.com/v2/` to `anestheo.com/`.

This document is the operational half of the cutover. The code half is done and
on this branch: every internal path is now root-absolute. **Nothing here has
been deployed and nothing has been merged.**

**Production state assumed** (as inspected in Hostinger File Manager):

```
public_html/          <- V1 site, live at anestheo.com/
public_html/v2/       <- V2 application, live at anestheo.com/v2/
```

**Target state:**

```
public_html/
    index.html, engine.html, dashboard.html, …   <- V2, now the root application
    videos-v1/                                   <- preserved V1 videos page, isolated
    robots.txt  sitemap.xml  404.html  .htaccess <- root infrastructure
    v2/                                          <- untouched, the fast rollback
backups/  (outside the document root)
    public_html-YYYY-MM-DD/                      <- full pre-cutover copy
    v1-archive-YYYY-MM-DD/                       <- retired V1 files
    videos-v1-original.html                      <- second, separate videos backup
```

---

## 1. Blocker status

| # | Blocker | Status |
|---|---|---|
| 1 | `videos.html` collision | **RESOLVED** — V1 preserved at `/videos.html`, isolated in `videos-v1/`. Section 3. |
| 2 | V1 pages loading V2 `auth.js` / `supabase.js` | **RESOLVED** — V1 functional pages are archived out of the live root and their URLs redirect. Section 4. |
| 3 | V1 videos page's own dependencies | **OPEN — awaiting the file.** Cannot be determined from here: the V1 `videos.html` is not in the repository and production is unreachable from this environment. The procedure is no longer manual — `tools/audit-v1-videos.js` performs the full audit and assembles `videos-v1/`. Section 3.2. |
| 4 | `/contact.html` has no V2 equivalent | **OPEN — product decision.** Section 4.3. |
| 5 | `/legal.html` maps five ways | **OPEN — low risk.** Provisionally mapped to `/terms.html`. Section 4.3. |

Blockers 1 and 2 are closed. Blocker 3 is a short pre-cutover task, not a
redesign. Blockers 4 and 5 do not stop the cutover.

---

## 2. What actually changes

| Layer | Before | After |
|---|---|---|
| Application URL | `anestheo.com/v2/engine.html` | `anestheo.com/engine.html` |
| Homepage | `anestheo.com/v2/` | `anestheo.com/` |
| Patient link | `anestheo.com/v2/q.html?t=TOKEN` | `anestheo.com/q.html?t=TOKEN` |
| Old `/v2` links | — | 301 to root equivalent, query string intact |
| Old V1 page URLs | live V1 pages | 301 to V2 equivalents (section 4) |
| `/videos.html` | V1 page | **still the V1 page** (section 3) |
| Sessions | localStorage on `anestheo.com` | unchanged — nobody is signed out |

That last row is worth internalising: `localStorage` is scoped to the **origin**,
never the path. `anestheo.com/v2/x` and `anestheo.com/x` are the same origin.
Signed-in users stay signed in, and a clinician with a case open in Live Tools
keeps the case and the running timers. Verified in a real browser with the app's
actual storage keys, not assumed.

---

## 3. Videos — the one deliberate exception

**Decision: the V1 videos page stays live at `/videos.html` until the dedicated
port task replaces it.** The rest of the root is the V2 application.

Nothing in this branch deletes or edits either videos page. The V2
implementation stays in the repository, intact, for the port task to work from.

### 3.1 How it is served

The V1 page cannot simply sit at the document root. V1 pages load V1
`auth.js` / `supabase.js` / `style.css`, and at the root those names either
belong to V2 now or are archived away. A V1 page reading V2 JavaScript is
exactly the hybrid to avoid.

So the V1 page and **every file it depends on** live together, isolated:

```
public_html/videos-v1/
    index.html          <- the V1 videos page
    style.css           <- its V1 stylesheet
    anestheo-app.js     <- its V1 script
    …                   <- whatever else section 3.2 finds
```

and `.htaccess` maps the public URL onto it with an **internal rewrite**:

```apache
RewriteRule ^videos\.html$     videos-v1/index.html  [L]
RewriteRule ^videos-v1\.html$  videos-v1/index.html  [L]
```

No `[R]`, so the browser never sees `videos-v1/` and the visible URL stays
`/videos.html`. That matters: the URL is already indexed and is what the V2
navbar links to. `/videos-v1.html` is provided as the named archival URL you
asked for; both addresses return the same page and `robots.txt` excludes the
duplicate so only `/videos.html` is indexed.

**`<base href="/videos-v1/">` is mandatory in the preserved copy, as the first
tag in `<head>`.** Because the visible URL stays `/videos.html`, the browser
resolves relative references against `/`, not against `/videos-v1/`. Without the
`<base>` tag the page loads with 404s on its own stylesheet and script — this
was reproduced in a browser, not theorised. With it, everything resolves inside
the folder. Root-absolute references (`src="/auth.js"`) ignore `<base>` and must
be made relative by hand; 3.2 is what finds them.

### 3.2 REQUIRED before cutover — capture the V1 videos dependencies

**This is the one thing that could not be determined from this environment.**
The V1 `videos.html` is not in the repository and production is not reachable
from here, so the page's actual dependency list is unknown.

It is not a manual job. **`tools/audit-v1-videos.js`** does the whole
extraction and classification:

```bash
# 1. Download public_html/videos.html and everything beside it into ./v1src/
# 2. Audit — reads the real file, reports every reference
node tools/audit-v1-videos.js v1src/videos.html --v1-dir v1src

# 3. Build the isolated folder: copies dependencies, injects <base>,
#    rewrites root-absolute ASSET paths, leaves navigation alone
node tools/audit-v1-videos.js v1src/videos.html --v1-dir v1src --build videos-v1
```

It sweeps `<script>`, `<link>`, `<img>` (including `srcset`), `<source>`,
`<video>`/`<audio>`, `<iframe>`, `<embed>`/`<object>`, `<form action>`,
anchors, `<meta refresh>`, CSS `@import`, CSS `url()`, inline `style="…url()"`,
`fetch`/`XHR`, `location` assignments and ES `import` — then sorts every hit
into relative / root-absolute / protocol-relative / external / `data:` /
fragment, and tells you exactly which files to copy and which references to
edit.

Three distinctions it enforces, because conflating them is how this goes wrong:

* **Navigation** (`<a href="/index.html">`) — the page *leaves* for the V2
  site. Never copied, never rewritten. Rewriting would trap the visitor inside
  `videos-v1/`.
* **Assets** (`<script src="/app.js">`) — the page *loads* them. Must be copied
  in and rewritten, or the page silently pulls the V2 file of the same name.
* **Data/API** (`fetch('/api/x.json')`) — could be a static file that must come
  along, or a live endpoint that must stay at the root. **Flagged, never
  auto-rewritten.** Only you know which.

**Relative navigation links are a trap the tool calls out specifically:**
`<base>` resolves `<a href="patients.html">` into `/videos-v1/patients.html`,
which does not exist. Those must be made root-absolute.

If the page references `auth.js` or `supabase.js`, copy the **V1** versions
from the backup — never the V2 ones. That is the whole point of the isolation.

Then verify in a browser at `/videos.html`, not at `/videos-v1/index.html`:
**zero 404s, and no request escaping to a root path.**

The tool and this whole flow were exercised end to end against a synthetic V1
page carrying every reference type — relative CSS, a root-absolute script, a
root-absolute image and favicon, a `srcset`, a CSS `@import`, an inline
`url()`, a protocol-relative CDN script, a Google Font, a YouTube iframe, a
`data:` image, a `fetch()`, root-absolute anchors, a fragment and a `mailto:`.
Result: the page rendered at an unchanged `/videos.html`, both V1 scripts
executed, zero requests escaped the folder, zero 404s, zero JS errors, and all
three navigation links landed on real V2 pages. The `fetch()` was left
deliberately unresolved on the first pass, and it failed exactly as predicted —
404, then a `JSON.parse` error on the 404 page's HTML — which is why it is
flagged rather than guessed. The check was then shown able to fail, by removing
one stylesheet and watching it go red.

**None of that was your real page.** It proves the procedure and the tooling.
The real file still has to go through it.

### 3.3 When the port task lands

Delete the two `RewriteRule` lines and the `videos-v1/` folder. `/videos.html`
then falls through to the V2 file already sitting at the root. No other change
anywhere. That is why the exception was built as a rewrite and not as an edit to
the V2 site.

---

## 4. Legacy V1 URL map

Every V1 page is archived out of the live root at cutover. Without these rules,
each one would 404 for anyone holding a bookmark or arriving from a search
result. All redirects are **301**, so search engines transfer the old pages'
standing to the new ones.

### 4.1 Redirects

| Old V1 URL | New root URL | Action | Confidence |
|---|---|---|---|
| `/auth.html` | `/index.html` | REDIRECT | **Approximate — see 4.4** |
| `/register.html` | `/index.html` | REDIRECT | **Approximate — see 4.4** |
| `/doctor.html` | `/dashboard.html` | REDIRECT | Exact — the doctor workspace |
| `/patient.html` | `/patient-dashboard.html` | REDIRECT | Exact — "My Space" |
| `/calculator.html` | `/engine.html` | REDIRECT | Exact — Live Tools supersedes it |
| `/calculators.html` | `/engine.html` | REDIRECT | Exact |
| `/clinical.html` | `/references.html` | REDIRECT | Exact — clinical reference library |
| `/legal.html` | `/terms.html` | REDIRECT | **Ambiguous — see 4.3** |
| `/Pre-operative anesthesia questionnaire.html` | `/questionnaire.html` | REDIRECT | **Ambiguous — see 4.3** |
| `/_nav.html` | `/` | REDIRECT | Exact — a fragment, never a page |

### 4.2 No redirect needed — V2 occupies the same filename

These URLs keep working on their own because a V2 file of the same name lands at
the root. A redirect rule would be a no-op at best and a loop at worst.

`/index.html` · `/about.html` · `/admin.html` · `/ask.html` · `/patients.html`

> The V1 semantics of `/patients.html` and `/admin.html` are unverified — the V1
> files are not in the repository. If V1's `patients.html` was a doctor's patient
> **list** rather than the public "For Patients" page, then V2's public page now
> occupies that URL. Not a breakage; check it against the V1 page during the
> section 3.2 inspection, since you will be in File Manager anyway.

### 4.3 Flagged, not guessed

**`/contact.html` → no V2 equivalent.** There is no contact page in V2. It is
marked **ARCHIVE/REVIEW** and, as configured, will serve the 404 page. Three
options: point it at `/about.html`; point it at `/ask.html`; or build a contact
page. Deliberately left unrouted rather than silently aimed somewhere plausible —
add one line to `.htaccess` once decided.

**`/legal.html` → five candidates.** V2 splits legal content into `terms`,
`privacy`, `cookies`, `data-protection` and `medical-disclaimer`. Provisionally
mapped to `/terms.html` as the entry point. Confirm nothing in V1's combined
page is missing from the five before archiving it.

**`/Pre-operative anesthesia questionnaire.html` → two candidates.**
`/questionnaire.html` is the signed-in patient questionnaire; `/q.html` is the
tokenised one and is useless without a token. Mapped to `/questionnaire.html`.
The filename contains spaces, which arrive percent-encoded; the rule matches both
the encoded and decoded forms, and this was tested.

### 4.4 Why `/auth.html` and `/register.html` are approximate

V2 has **no standalone login page**. Sign-in and registration are a modal built
by `navbar.js`, opened from the navbar, with no URL that deep-links into it —
confirmed by searching the codebase for any `?auth=` or `#login` handler. There
is none.

So `/index.html` is the closest honest destination: the homepage, where the
sign-in control lives. A returning user lands somewhere sensible but must click
once more. Making this exact would mean adding a URL parameter to open the modal
— a product change, deliberately not made during a migration.

---

## 5. V1 archive / preserve list

Nothing in this branch deletes any of these. This is the decision record for a
human to execute during step 5 of the sequence.

### PRESERVE — stays live

| File | Where it goes | Why |
|---|---|---|
| `videos.html` | `videos-v1/index.html` | The preferred page. Section 3. |
| `favicon.ico` | stays at root | Browsers request `/favicon.ico` by convention. V2 declares no favicon, so this V1 asset is the only one there is. |
| `favicon-16x16.png`, `favicon-32x32.png` | stays at root | Same. |
| `apple-touch-icon.png` | stays at root | iOS requests `/apple-touch-icon.png` by convention. |
| `logo.png` | stays at root | Brand asset. Unreferenced by V2 but harmless and likely wanted. |

### REPLACE — V2 file of the same name takes the URL

`index.html` · `about.html` · `admin.html` · `ask.html` · `patients.html` ·
`auth.js` · `supabase.js` · `sitemap.xml`

`sitemap.xml` is a replacement, not an accident: the V1 sitemap lists
`calculator.html`, `clinical.html`, `doctor.html`, `patient.html` and
`register.html` — pages that will no longer exist. Leaving it would advertise a
set of URLs that all redirect or 404. The replacement is on this branch.

### ARCHIVE — move out of the live root, keep the backup

| File | Redirected to | Note |
|---|---|---|
| `auth.html` | `/index.html` | Would break on V2 `auth.js`. |
| `register.html` | `/index.html` | Same. |
| `doctor.html` | `/dashboard.html` | Same. |
| `patient.html` | `/patient-dashboard.html` | Same. |
| `clinical.html` | `/references.html` | Same. |
| `calculator.html`, `calculators.html` | `/engine.html` | Same. |
| `legal.html` | `/terms.html` | Ambiguous — 4.3. |
| `Pre-operative anesthesia questionnaire.html` | `/questionnaire.html` | Ambiguous — 4.3. Space-containing filename is also a URL-encoding hazard. |
| `_nav.html` | `/` | V1 nav include, superseded by `navbar.js`. |
| `anestheo-app.js` | — | V1 application script. Copy into `videos-v1/` first if 3.2 needs it. |
| `style.css` | — | V1 stylesheet. Same. |
| `doctor.jpg` | — | Used only by V1 pages. |
| `contact.html` | *unrouted* | **REVIEW — 4.3.** |

### ARCHIVE — security

| File | Note |
|---|---|
| `supabase_migration_final.sql` | Currently **downloadable by anyone** at `https://anestheo.com/supabase_migration_final.sql`. A full schema dump. |
| `build_pages.py` | A build script has no reason to be web-readable. |

The SQL dump is not a breach on its own — RLS is the boundary and the anon key
is a published-by-design `role:anon` JWT — but a schema dump hands an attacker
the complete table, column and policy map for free, turning guesswork into
targeted probing.

**Not deleted in this task, as instructed.** Two things reduce it:

1. The prepared `.htaccess` denies `.sql`, `.md`, `.py`, `.log` and dotfiles.
   That closes the hole without deleting anything, and is reversible.
2. Archiving it out of `public_html` at step 5 removes it entirely. Keep a copy
   in the backup first.

---

## 6. Redirect rules

The full annotated file is `deploy/htaccess-root-cutover`. It is deliberately
**not** named `.htaccess`, so uploading the repository cannot switch redirects on
by accident. Copy it to `public_html/.htaccess` as its own step.

Block order matters; the first `[L]` wins.

```apache
DirectoryIndex index.html

# 2. Videos — internal rewrite, URL unchanged
RewriteRule ^videos\.html$     videos-v1/index.html  [L]
RewriteRule ^videos-v1\.html$  videos-v1/index.html  [L]

# 3. Legacy V1 pages — 301
RewriteRule ^auth\.html$        /index.html             [R=301,L]
RewriteRule ^register\.html$    /index.html             [R=301,L]
RewriteRule ^doctor\.html$      /dashboard.html         [R=301,L]
RewriteRule ^patient\.html$     /patient-dashboard.html [R=301,L]
RewriteRule ^calculator\.html$  /engine.html            [R=301,L]
RewriteRule ^calculators\.html$ /engine.html            [R=301,L]
RewriteRule ^clinical\.html$    /references.html        [R=301,L]
RewriteRule ^legal\.html$       /terms.html             [R=301,L]
RewriteRule ^Pre-operative(%20|\s)anesthesia(%20|\s)questionnaire\.html$ /questionnaire.html [R=301,L,NC]
RewriteRule ^_nav\.html$        /                       [R=301,L]

# 4. Legacy /v2 — 301, query string preserved
RewriteRule ^v2/?$    /     [R=301,L]
RewriteRule ^v2/(.*)$ /$1   [R=301,L]

ErrorDocument 404 /404.html
<FilesMatch "\.(sql|md|py|log|bak|old|orig|ini|sh|yml|yaml)$">
  Require all denied
</FilesMatch>
```

**Query strings.** A substitution containing no `?` leaves the original query
untouched, so `/v2/q.html?t=TOKEN` → `/q.html?t=TOKEN` with the token intact.
`QSA` is deliberately not used — it is for merging a query the rule itself
introduces, and would risk duplicating parameters.

**No loops.** The `/v2` substitution never begins with `v2/` because the pattern
consumed the prefix, so the redirected request cannot re-match. Every legacy
destination is a real V2 file that appears on no rule's left-hand side. The
videos substitution matches neither videos pattern. Measured: maximum **2 hops**
anywhere (`/v2/auth.html` → `/auth.html` → `/index.html`), and the pathological
`/v2/v2/x.html` terminates in 2 hops at a 404 rather than recursing.

**Not included, deliberately:** HTTPS and `www` canonicalisation. Hostinger
already terminates both at the edge, and duplicating that here risks a loop with
that layer. Check what the panel is doing before adding either. Caching headers
are drafted and commented out at the foot of the file; turn them on only after
the cutover is verified.

---

## 7. Supabase — MANUAL CUTOVER STEPS

**These cannot be done from the repository.** Project `zaptzjohvgwayvytntyb`.

| # | Setting | Where | Change | Why |
|---|---|---|---|---|
| 1 | **Site URL** | Authentication → URL Configuration | `https://anestheo.com` | **Highest-risk item in the cutover.** `signUp()` and `resetPasswordForEmail()` are both called with **no `redirectTo`**, so both fall back to Site URL. If it still points at `/v2/`, every confirmation and password-reset email sends users to the old path. |
| 2 | **Redirect URLs** allowlist | same page | add `https://anestheo.com/**` | Keep the `/v2/**` entry until old links age out. Removing it early only breaks things. |
| 3 | **Email templates** | Authentication → Email Templates | check for hard-coded `/v2/` | Templates using `{{ .SiteURL }}` follow #1 automatically. A hard-coded path does not. |
| 4 | **CORS / allowed origins** | API settings | confirm `https://anestheo.com` | The origin does not change, so this should already be right. Confirm, don't assume. |
| 5 | **Edge Functions** | `youtube-latest`, `convert_clinic_patient` | no change needed | Verified: neither contains a `/v2/` URL. Only a comment mentions v2. |

### Recovery-link caveat, and a pre-existing gap

Supabase recovery and confirmation links carry their token in the **URL
fragment** (`#access_token=…`). Fragments are never sent to the server, so a 301
does not see one. Browsers do re-attach the original fragment when the `Location`
header has none, so a redirected recovery link will usually still work — but
"usually" is not the standard for password reset. Fixing Site URL means recovery
links never hit the redirect at all. Do item 1.

Separately, and **not caused by this cutover**: there is no password-reset
landing handler anywhere in the codebase. No `PASSWORD_RECOVERY` listener, no
`updateUser({password})`, no reset form. `resetPasswordForEmail()` sends the
email, the link signs the user in via `detectSessionInUrl`, and there is nowhere
to set a new password. A pre-existing product gap, recorded here because the
cutover is when Site URL gets touched. Fix in its own task.

---

## 8. The SQL step

`admin_search()` returns six hard-coded destinations that `admin.html` uses as
the href when an admin opens a search result:

```
'/v2/admin.html'      x2   (profile, patient_surgery)
'/v2/dashboard.html'  x4   (clinic_patient, care_request, questionnaire, question)
```

**File: `root_cutover_admin_search_destinations.sql`**

* `v2_admin_phase0.sql` is **not modified** — it is applied history.
* The migration rewrites the **installed** function and reinstalls exactly that,
  rather than re-declaring from fixed source. Phase 0 assembles `admin_search`
  at install time from whichever tables exist, so two databases can hold two
  different correct bodies; re-declaring would silently add or drop branches.
* Refuses to run unless it finds exactly six `/v2/` literals.
* Idempotent — a second run reports "nothing to do".
* Verifies itself inside a transaction; a failed assertion rolls back.
* Reverse block included at the foot of the file.

**Run it AFTER the site is live at the root and verified — not before.** Until
then `/v2/admin.html` is the correct answer and `/admin.html` is not. Running
early breaks admin search navigation; running late costs one redirect hop per
search. Late is the safe side.

Executed against a real PostgreSQL 16 with `v2_admin_phase0.sql` installed and
all six branches compiled: forward rewrite, idempotent re-run, grant
preservation, live `admin_search()` returning root destinations, the drift guard
refusing a 7-literal function, and the reverse block.

Post-check, as an admin user:

```sql
SELECT DISTINCT destination FROM public.admin_search('a', 100);
-- expect only '/admin.html' and '/dashboard.html'
```

---

## 9. Hostinger cutover sequence

Numbered so a step can be named when something goes wrong. Do this at a
low-traffic hour, with File Manager and the Supabase dashboard both open before
step 1.

| # | Step | Notes |
|---|---|---|
| 1 | **Back up all of `public_html`**, including `v2/`, to a location **outside the document root**. | **The rollback depends entirely on this.** V1 root files are not in the repository and cannot be reconstructed. Do not proceed without it. |
| 2 | **Second, separate backup of `videos.html`** as `videos-v1-original.html`. | Deliberately redundant. This is the file you said you want to keep; it should survive a mistake in the main backup. |
| 3 | Verify both backups open and contain what you expect. | A backup you have not opened is not a backup. |
| 4 | **Record the current root state**: file listing with sizes and dates, plus the current Supabase Site URL. | You need the old Site URL to roll back step 12. |
| 5 | **Run the videos dependency capture** (section 3.2) and assemble `videos-v1/` locally, including `<base href="/videos-v1/">`. | Do this before touching production. |
| 6 | **Archive the V1 files** listed in section 5 out of the live root into the backup area. Leave PRESERVE files in place. | Do not delete — move. `videos.html` moves into `videos-v1/index.html`. |
| 7 | **Upload the root-ready V2 package** to `public_html/`. | Do **not** upload `deploy/`, `docs/`, `*.md`, or `*.sql`. Do not delete `public_html/v2/`. |
| 8 | Upload the `videos-v1/` folder. | |
| 9 | Confirm `public_html/v2/` is **untouched**. | This is the fast rollback. |
| 10 | **Upload `deploy/htaccess-root-cutover` as `public_html/.htaccess`.** | This is the moment the cutover goes live. Everything before it is inert. |
| 11 | **Run the smoke tests** — `deploy/SMOKE_TEST.md`. | 10–15 minutes. Do not skip to step 12 with a red check. |
| 12 | **Supabase settings** — section 7, items 1–3. | |
| 13 | Register a throwaway account and trigger a password reset. Confirm both emails point at `https://anestheo.com/…` with no `/v2/`. | Do not skip. Highest-risk item. |
| 14 | **Run `root_cutover_admin_search_destinations.sql`.** Re-test admin search; the redirect hop should be gone. | |
| 15 | Submit `sitemap.xml` in Google Search Console. Leave old `/v2` and V1 URLs crawlable. | The 301s are what move ranking to the new URLs. |
| 16 | Watch for 24–48h. **Keep the backup and `public_html/v2/` until the new root is proven stable.** | |
| 17 | *(Later, separate task)* Port the preferred V1 Videos design into V2, then remove the videos exception per 3.3. | Not part of this cutover. |

---

## 10. Rollback

Choose by how far you got. Assume you need the old site back within minutes.

### Fastest path — after step 10, one action

**Delete `public_html/.htaccess`.**

That single deletion stops every redirect and rewrite. `anestheo.com/v2/` is
immediately live again, because step 9 left it untouched. Seconds.

Then finish restoring the root:

1. Restore the eight REPLACE files from the step-1 backup:
   `index.html`, `about.html`, `admin.html`, `ask.html`, `patients.html`,
   `auth.js`, `supabase.js`, `sitemap.xml`.
2. Restore the ARCHIVE files from the backup back into `public_html/`.
3. Restore `videos.html` to the root from `videos-v1-original.html` (step 2).
   Remove `videos-v1/`.
4. Remove the V2 files uploaded in step 7 that have no V1 counterpart.

### If you got to step 12 — Supabase

Set **Site URL** back to the value recorded in step 4. Leave the Redirect URLs
allowlist alone; extra entries are harmless and removing them mid-rollback only
adds risk.

### If you got to step 14 — the database

Run the **reverse block** at the foot of
`root_cutover_admin_search_destinations.sql` before restoring the site, so
`admin_search` matches whatever the site is serving. It carries the same guards
as the forward direction and refuses if the function has drifted.

### Before step 10 — nothing is live

The new files are at the root but no redirect is active and V1's `index.html`
may already be replaced. Restore the eight REPLACE files from the backup. The
site is V1 again.

### Git state

* `main` is untouched at `97937d1e709234cd17eddd5ca4f1a4d01b3771ed` — the commit
  currently in production.
* This work is on `claude/root-cutover-preparation`, **not merged**.
* Rolling back production requires no git operation at all. If you want the repo
  to match a rolled-back production, simply do not merge the branch.

### Preserved V1 videos page

Two independent copies exist: `videos-v1-original.html` from step 2, and the
full `public_html` backup from step 1. The live copy in `videos-v1/` is a third.
Losing the preferred videos page requires all three to fail.

---

## 11. Deliberately not done

* **No product changes.** Live Tools, New Case, timers, clinical values,
  visuals, navbar, search ranking, patient workflows, admin functionality and
  the Videos design are untouched. Verified by diffing the pre- and post-cutover
  builds side by side in a browser: identical.
* **`/index.html` was not rewritten to `/`.** `/` is the advertised homepage and
  the sitemap's canonical entry, and `DirectoryIndex` serves it. Internal links
  still say `/index.html`. The reason is `navbar.js`, where active-state matching
  is `it.href.split('/').pop() === page`: an href of `/` yields `''` while the
  page key is `'index.html'`, so the home tab would silently lose its active
  state. Both URLs serve the same page; changing 36 links to gain a cosmetic URL
  during a migration is a bad trade.
* **No per-page canonical, Open Graph or JSON-LD.** The site has none today
  (1 of 50 pages has even a meta description). A real gap, worth its own task,
  but a content change across 50 files does not belong in a cutover.
* **No caching headers.** Drafted and commented out in the `.htaccess`.
* **No V1 files deleted.** Archived, never removed.
* **Nothing deployed. Nothing merged. No SQL applied.**
