# Health Passport V1 — controlled rollout

Three steps, in this order. Do not start step 3 until step 2 says `ALL PASS`.

| # | Step | File |
|---|---|---|
| 1 | Apply the schema in the Supabase SQL Editor | `v6_health_passport.sql` |
| 2 | Verify it, read-only | `v6_health_passport_verify.sql` |
| 3 | Deploy the frontend, then run the smoke test below | — |

The migration is safe to re-run, safe on a database that has never seen the
Health Passport, and safe on one that has an earlier version. All three were
proved on separate databases before this was written.

The verifier is read-only. It contains no `INSERT`, `UPDATE`, `DELETE`,
`CREATE`, `ALTER`, `GRANT` or `REVOKE`, creates no temporary object, and reads
only system catalogues. Run it as often as you like.

---

## Smoke test — after the frontend is live

**Zero real patient data.** Use a dedicated test account you are willing to
delete afterwards. Nothing below asks you to touch a real person's record, and
the whole exercise is undone in the last step.

### What you need

* A test **patient** account, signed in on device A.
* Device B — a phone — **signed out**, or a private window. It must be signed
  out, because the whole point is what a stranger sees.
* Somewhere to note the two QR images. You will need to scan the first one
  *after* replacing it, so photograph the screen before you replace it.

### The sequence

**1. Create the passport**
Device A → For Patients → **Health Passport** → *Create my Health Passport*.
✓ The page opens on "My information" with an *Add health information* button.

**2. Add a visible allergy**
*Add health information* → kind **Allergy**, name `SMOKETEST penicillin`,
detail `SMOKETEST — not a real allergy`, seriousness **critical**.
Leave **Show this on my emergency QR** ticked. → *Add to passport*.
✓ It appears under **Critical**, badged `Patient reported`, with no "Hidden
from QR" tag.

**3. Add a hidden item**
*Add health information* → kind **Hormones / diabetes**, name
`SMOKETEST hidden condition`. **Untick** *Show this on my emergency QR*.
✓ It appears under **Other information**, badged `Hidden from QR`.

**4. Add a visible contact**
Under **Emergency contact**: name `SMOKETEST contact`, relationship `test`,
phone a number you control. **Tick** *Show this person on my emergency QR*.
✓ It appears badged `Shown on QR`.

*(Optional but worth doing once: add a second contact and leave the box
unticked. Step 7 then proves it never leaves the database.)*

**5. Generate the QR**
Tab **Emergency QR** → *Generate a QR*.
✓ You land on **What this QR will show** before anything is created. Read it:

* **Your name** — says either your name or *Not shared*. Default is **not
  shared**; use *Share my name* if you want it on the card, and note which you
  chose.
* **Health information (1)** — the allergy only. The hidden condition must
  **not** be listed.
* **Emergency contacts (1)** — the ticked contact only.
* **Staying private: 1 health entry** (and 1 contact, if you added the second).

✓ No QR image exists yet at this point.
Then *Create my QR with this*.
✓ A card appears: **Anestheo Health Passport**, the patient name, *Scan for
emergency health information*, the QR, and *No medical information is stored in
this code*.

**Photograph this QR now.** It is the only chance — the code is not stored on
our servers and cannot be shown again after you leave the page.

**6. Scan from the signed-out device**
Device B → scan the QR with the camera.
✓ The address bar reads `anestheo.com/p.html` — **no token visible after the
page loads**. The token was in the fragment and is cleared once read.
✓ The page shows: the name (or *Name not shared*, matching your choice in step
5), the amber banner *This Health Passport may contain patient-reported
information — verify clinically before making treatment decisions*, then
**Critical alerts** with `SMOKETEST penicillin` badged `Patient reported`, then
the emergency contact with a **Call** button.

**7. Prove the hidden item is absent**
On device B, use *View source* / *Find on page* for `hidden condition`.
✓ **Not present** — not on screen and not in the page source. It is not
filtered in the browser; the server never sent it.
✓ If you added the unticked second contact, search for its name too. Also
absent.

**8. Replace the QR**
Device A → **Emergency QR** → *Replace QR* → read the consent screen again →
*Replace my QR with this* → confirm the warning.
✓ A different QR appears. Photograph it.

**9. Prove the old QR is dead**
Device B → scan the **first** photograph.
✓ *This Health Passport is not available.*
✓ It says nothing about whether a patient exists, whether the code was ever
valid, or who it belonged to. A revoked code and a code that never existed give
byte-identical answers.

**10. Prove the new QR works**
Device B → scan the **second** photograph.
✓ The passport opens exactly as in step 6.

**11. Optional — prove the off switch**
Device A → *Switch QR off* → confirm.
Device B → scan the second QR. ✓ *not available*.
Device A → the passport still lists every entry. ✓ Turning the QR off closes
the door; it does not delete the record.

### Clean up

Device A → delete both SMOKETEST entries and the SMOKETEST contact, then
*Switch QR off*. If the account was created only for this, delete the account.

---

## If something fails

| Symptom | Where to look |
|---|---|
| *Health Passport* tile missing on For Patients | Frontend not deployed, or browser cache. Hard-reload. |
| *Create my Health Passport* returns a permission error | Migration not applied, or applied to the wrong project. Re-run the verifier. |
| The consent screen lists an entry you hid | Stop. Do not continue. This is the one failure that matters most — capture a screenshot and report it. |
| Scanning shows *not available* for a fresh QR | Check the QR is switched on, and that `p.html` deployed. |
| The address bar shows the token after loading | `p.html` is an older copy — the fragment is meant to be cleared. Re-deploy. |
| The old QR still resolves after replacing | Stop. Revocation is not working. Report it. |

## Notes for whoever runs this

* **The QR contains no medical information.** It contains one opaque token and
  nothing else. Photographing the card gives away access to the projection, not
  to the database — which is exactly why steps 9 and 10 matter.
* **The token is never in a URL the server sees.** It travels after the `#`, so
  it is not in the request line and cannot appear in an access log. That is the
  reason you cannot recover a lost QR from server logs either.
* **The name is off by default.** If step 6 shows *Name not shared* and you
  expected a name, that is the default working, not a bug — turn it on
  deliberately from the consent screen.
