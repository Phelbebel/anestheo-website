# Health Passport — how it actually works

What exists today, end to end. Nothing here is a proposal; every statement is a
description of code that is already merged. Where the design refuses to do
something, the reason is recorded, because a later change that quietly reverses
one of these decisions would look like a small improvement.

Rollout and verification live in `HEALTH_PASSPORT_ROLLOUT.md`. This document is
about the flow.

---

## 1. What it is

A patient can record the handful of facts that would matter if they arrived
unconscious — an allergy, a difficult airway, a blood thinner, an implanted
device, an emergency contact — and carry them as a QR code. A stranger with a
phone scans it and reads those facts, without an account and without asking
anyone's permission.

That last sentence is the whole risk. Everything below exists to bound it.

## 2. The pieces

| File | Role |
|---|---|
| `v6_health_passport.sql` | 6 tables, forced RLS, 7 functions. The only security boundary. |
| `passport.js` | `HP.*` data layer. Generates the token; otherwise a thin client. |
| `qr.js` + `vendor/qrcode-generator-2.0.4.js` | QR encoding (vendored, MIT). |
| `health-passport.html` | The patient's own page. `requireAuth()`. |
| `p.html` | The page a scanner lands on. No session, no navbar, `noindex`. |

Tables: `health_passports`, `health_passport_items`, `health_passport_contacts`,
`health_passport_tokens`, `health_passport_access_log`, `health_passport_consents`.

## 3. The patient's path

1. **Find it.** From `/patient-dashboard.html` (the Health Passport section), the
   account menu on any signed-in page, or the tile on the public
   `/patients.html`. See §7 — this used to be one entry point, on the page a
   signed-in patient never revisits.
2. **Create.** `HP.create()` inserts one `health_passports` row. One per patient,
   enforced by `patient_id uuid NOT NULL UNIQUE`.
3. **Add items.** Category from a fixed list of 16 (`HP.CATEGORIES`), a label
   (≤60 chars) and a value (≤120 chars). Both caps are database CHECK
   constraints (`hp_item_text_len_chk`) and re-checked client-side only so the
   refusal names the field while the patient is still looking at it.
4. **Choose what is public.** Every item and every contact carries its own
   `is_emergency_visible`. Nothing is public by default. An item can exist in
   the passport, be visible to the patient and their treating doctor, and never
   appear on the QR.
5. **Consent, then mint.** The consent screen shows exactly what a scanner will
   see, computed by `HP.previewOf()` from the same rows, the same filter and the
   same sort order the server uses — so it is a promise the server keeps, not a
   mock-up. The screen states that the code can be replaced or switched off at
   any time, and that replacing it disables previously printed cards.
6. **`HP.rotateToken()`.** 256 bits from `crypto.getRandomValues`, base64url, 43
   characters. Sent once to `hp_rotate_token`, which stores **only**
   `sha256(token)` — a dump of the entire schema opens nothing. In the same
   statement block it revokes the previous token and writes a
   `health_passport_consents` row whose contents are *computed server-side*
   (categories, item count, contact count, name shared). A consent record that
   repeated whatever the browser claimed would be evidence of nothing.
7. **Carry it.** The QR encodes `https://anestheo.com/p.html#<token>` and nothing
   else. No name, no category, no medical content of any kind.

## 4. The scanner's path

`p.html` reads the token from `location.hash`, calls `hp_resolve_passport`, and
renders the projection. It is the only passport function `anon` may execute.

The resolver returns a **projection**, not rows:

```json
{ "found": true, "projection": "emergency_passport_v1",
  "patient_name": null, "items": [...], "contacts": [...],
  "generated_at": "..." }
```

Each item carries `category`, `label`, `value_text`, `severity`, `source_type`
— and nothing else. The two internal sort keys (`ord`, `pri`) and
`is_verified` were removed before release: none was sensitive, all three were
more than the page needs, on a payload whose entire principle is the minimum.
The sort keys still order the result; they no longer travel with it.

`patient_name` is `null` unless the patient explicitly set `show_name_on_qr`.
Nothing else from the account is ever readable through this path — no email, no
account id, no role, no metadata.

Every resolve appends to `health_passport_access_log` and stamps
`last_used_at`. The log is keyed on the **passport**, not the token, so
replacing a QR does not erase the fact that the old one was used. The patient
reads it back through `hp_access_history`.

### Why the token is in the fragment

A fragment is never sent to the server. It is not in the request line, so it
cannot land in a Hostinger or LiteSpeed access log, a proxy log, a CDN log, or
a `Referer` header. A path or query token would be written into an access log
the moment anyone scanned the card, and access logs are backed up, shipped and
read by people who have no business holding a key to someone's medical history.
`/p.html` is also a real file, so a printed card cannot be killed by an
`.htaccess` that goes missing in a migration.

### What is and is not true about the token

- It is **not** stored in any table. Only `sha256(token)` is.
- It **is** transmitted to the server twice in its life: once to
  `hp_rotate_token` to be hashed, once per scan to `hp_resolve_passport`. Both
  are POST bodies over TLS, not URLs. It necessarily exists in server memory for
  the duration of those calls.
- It is **not** in any page request URL, because it lives after the `#`.
- We do not control what Supabase logs about an RPC call. The honest claim is
  the three points above, not "the raw token is never logged anywhere".

An unknown, revoked, expired or disabled token returns the same
`{"found": false}` as a well-formed guess. The shape is rejected by regex
before the database is touched, and the answer is identical either way, so the
endpoint distinguishes nothing for an attacker.

## 5. The clinician's path

A doctor never gets a passport by scanning. `hp_clinician_may_read(passport)`
requires **both** `is_verified_doctor()` and `doctor_treats_patient(patient_id)`
— an approved doctor with an actual treatment relationship. There is no
"any doctor can read any passport" path, and no admin read path at all.

`hp_verify_item` lets a treating doctor mark an item clinician-verified.
Provenance is guarded by a trigger (`hp_guard_item_provenance`), not by trust:
a patient cannot write `clinician_verified` onto their own entry.

Provenance is shown on every public line, in words:
`Patient reported` · `Document supported` · `Clinician verified` ·
`From an Anestheo record`. "Patient reported" is not a criticism — it is most of
a passport, and it is the honest label.

## 6. Turning it off

- **`hp_disable_token()`** closes the door and destroys nothing. The medical
  record stays; the public view stops resolving.
- **Rotating** mints a new token and revokes the old one in the same block.
  Previously printed cards stop working immediately — the consent screen says so
  before the patient mints anything.
- Setting `emergency_view_enabled = false` or `status <> 'active'` makes the
  resolver return `{"found": false}` regardless of token validity.

Consent is therefore reversible in one action, and the reversal is the same
mechanism as the grant.

## 7. Entry points

| Surface | Before | Now |
|---|---|---|
| `patients.html` (public) | tile | tile (unchanged) |
| `patient-dashboard.html` | **none** | Health Passport section |
| Account menu (`navbar.js`, every signed-in page) | **none** | Health Passport item |
| `settings.html` | none | none — deliberate, see below |

The passport was reachable only from a public marketing page. A signed-in
patient has no reason to visit that page again, so the people the feature is
built for could not find it. The dashboard section and the account-menu item
close that gap.

The dashboard card states **no medical content of its own**. An entry point that
summarised the passport would be a second, unguarded copy of it on a page that
was never designed to hold one. `hpentry.js` asserts this.

`settings.html` is left alone on purpose: it is where an account is configured,
not where clinical content lives, and the passport is not an account setting.

## 8. Tests

| Suite | Covers |
|---|---|
| `passport.sql` | RLS, policies, provenance trigger, resolver, against real policies |
| `hp.js` | patient page and `p.html`: what is sent, what is shown, consent preview parity |
| `qr.js` | encoding, decoded by OpenCV and `segno` independently |
| `hpentry.js` | the entry points above, and that the card leaks nothing |
| `v6_health_passport_verify.sql` | 23 post-migration checks, read-only, one statement |

## 9. Decisions that must not be quietly reversed

1. The QR carries a link. It never carries medical content.
2. Only `sha256(token)` is stored.
3. The token lives in the fragment.
4. `is_emergency_visible` is per item and per contact, and defaults to off.
5. The resolver returns a named, versioned projection — not rows.
6. The consent record is computed server-side.
7. A doctor needs verification **and** a treatment relationship. Admins have no
   read path.
8. An entry point describes the feature; it never summarises the contents.
