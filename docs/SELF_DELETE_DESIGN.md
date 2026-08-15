# Deleting your own account — design

**Status: design only. Nothing in this document is implemented.**

It cannot be implemented as written without one new database function, and the
standing instruction is to stop and report before writing a migration. §5 is
that report. §7 lists what must be decided before anything is built.

---

## 1. What was found

Three findings shape the whole design. All three were verified against the
merged migrations and the shipped client, not inferred.

### 1.1 There is no server path for a user to delete their own account

`admin_soft_delete_account(p_target, p_reason)` is the only soft-delete
function. It begins with `admin_assert_target(p_target)`, which:

- calls `assert_admin()` — the caller must be a platform admin, and
- raises `42501` when `p_target = auth.uid()` — *"You cannot perform this
  action on your own account."*

So the one function that could do this refuses precisely the case we need, by
design. It was written to stop an admin locking themselves out, and that
reasoning still holds; it should not be relaxed.

Nor can the client do it directly. `guard_profiles_self_update()` is an
**allowlist** of self-editable columns — `full_name`, `phone`, `country`,
`hospital`, `specialty`, `email`, `accepting_patients`,
`medical_license_number`, `avatar_url`, `bio`, `city`, `languages`, `timezone`,
`created_at`, `updated_at`. `deleted_at`, `account_status` and `delete_reason`
are not on it and are therefore protected. A `PATCH /profiles` setting
`deleted_at` is refused by the database.

**A new SECURITY DEFINER RPC is required. There is no client-only version of
this feature.**

### 1.2 `account_status` is not enforced anywhere

Searched the whole repository:

- No RLS policy in any migration references `account_status` or the profile's
  `deleted_at`.
- No page outside `admin.html` reads `account_status` at all — `auth.js`,
  `navbar.js` and every dashboard ignore it.
- `profiles_select_own` is `auth.uid() = id`, with no status condition.

So today, `suspended`, `banned` and `deleted` are **admin bookkeeping states,
not access states**. A soft-deleted user can still sign in and use the product
normally.

That is tolerable for an admin action, where the admin can also act again. It
is **not** tolerable for a self-delete: a person who presses "Delete my
account" and remains signed in and functional has been lied to.

### 1.3 A deleted account's Health Passport QR keeps resolving

`hp_resolve_passport` checks the token, then `health_passports.status` and
`emergency_view_enabled`. **It never reads `profiles`.** A soft-deleted
patient's printed QR card therefore continues to serve their allergies and
emergency contact to anyone who scans it, indefinitely.

Any account-deletion flow — self-service or admin — must revoke passport
tokens as part of the same transaction. This is the single most important item
in this document.

## 2. What "delete" should mean here

Soft delete first, as instructed. Concretely, the promise made to the user:

> Your account is closed. You cannot sign in. Your Health Passport QR stops
> working immediately. Your records are kept for a limited period so the
> closure can be reversed, and then removed.

Everything in that promise except the last clause is designable today. The last
clause depends on retention rules that have not been confirmed, so the flow
must not state a period it cannot keep. See §7.

## 3. The flow

### 3.1 Where it lives

`settings.html`, a new **Close account** block at the very bottom — below
Advanced account information, visually separated, using the existing
`.btn-danger` treatment already used by Sign out. Not in the account menu, not
on any dashboard. A destructive action should take a deliberate trip to find.

### 3.2 Steps

1. **Open.** "Close my account" — a button, not a link, and not pre-expanded.
2. **Show the blast radius before asking anything.** Read and display, from the
   user's own rows:
   - number of journeys, questionnaires, checklists, documents;
   - whether a Health Passport exists and whether its QR is currently live;
   - for a doctor: how many patients are assigned to them.
   This is the same principle `admin_restore_account` already uses when it
   reports what comes back — the person deciding sees the real scope.
3. **Say plainly what happens.** Signed out everywhere. Cannot sign in. QR stops
   working. Records retained for the reversal window, then removed. Anything
   that will *not* be deleted is named here (see §4).
4. **Type to confirm.** The Danger Zone already uses a typed confirmation
   (`PERMANENTLY DELETE`) for purge; reuse the pattern with a different phrase
   — `CLOSE MY ACCOUNT` — so muscle memory from one cannot trigger the other.
5. **Optional reason.** Free text, ≤200 chars, stored in `delete_reason`.
   Optional: a person closing an account owes no explanation.
6. **Call the RPC** (§5), then **sign out** and land on `/` with a short,
   non-celebratory confirmation.

### 3.3 Reversal

Within the retention window, the account is restored by contacting support,
who use the existing `admin_restore_account` — which already clears every
marker and reports what comes back. **Restoring must not silently re-enable the
QR**: `emergency_view_enabled` stays false, and the patient mints a new code if
they want one. A card that starts working again without the patient deciding it
should is the same failure as 1.3, arriving late.

Self-service reversal (signing in during the window to cancel) is deliberately
**not** proposed: it requires the account to remain signable-in, which
contradicts the promise in §2.

## 4. Cases that need an explicit answer

| Case | Position |
|---|---|
| **Doctor with assigned patients** | Refuse, and say why: patients must be reassigned first. Silently orphaning a treatment relationship is worse than refusing. Admin purge already handles this by clearing `assigned_doctor_id`; a self-service action should not make that decision for other people's records. |
| **Admin closing their own account** | Refuse. Same reasoning as `admin_assert_target` — the platform must not be left without an administrator by one button press. |
| **Signed anesthesia records** | Not deletable. `patient_purge_eligibility` already refuses to purge a patient with `finalized` anesthesia records, and that rule is clinical, not technical. The closure screen must say so rather than implying total erasure. |
| **Health Passport** | Tokens revoked, `emergency_view_enabled` set false, in the same transaction as the closure. Non-negotiable — see 1.3. |
| **Clinic patients created by a doctor** | Belong to the clinic record, not the doctor's identity. Untouched. |
| **Audit log** | Untouched. An audit trail that a user can erase is not an audit trail. |

## 5. What the database would need — STOPPING POINT

This is the migration that would be required. **It is not written and must not
be written without approval.** It is described so the decision can be made
before any code exists.

One new function, `public.account_self_close(p_reason text)`:

- `SECURITY DEFINER`, `SET search_path = public, pg_temp`, granted to
  `authenticated` only, `REVOKE ALL … FROM PUBLIC, anon`.
- Operates on `auth.uid()` and nothing else. **It takes no target parameter**,
  so it cannot be aimed at another account — the property that makes it safe
  to grant to every signed-in user.
- Refuses when the caller is a platform admin.
- Refuses when the caller is a doctor with active assigned patients, returning
  the count so the page can say what to do about it.
- Sets `account_status = 'deleted'`, `deleted_at = now()`,
  `deleted_by = auth.uid()`, `delete_reason = p_reason`.
- Revokes every `health_passport_tokens` row for the caller's passport and sets
  `emergency_view_enabled = false`.
- Writes one `admin_audit_log` row with a distinct action —
  `account.self_close` — so a user-initiated closure is never confused with an
  administrator's.
- Returns `jsonb` in the shape the other lifecycle functions use:
  `{ok, code, reason}` on refusal, `{ok:true, …}` with the counts on success.

**And separately, the enforcement gap in 1.2.** A self-close is not real until
`deleted_at` actually blocks the account. That is a change to the access model,
which the standing instruction excludes from this work. It needs its own
decision: whether closure is enforced by RLS (a condition on the policies), by
GoTrue (banning the auth user), or by the client (weakest — trivially bypassed).
Until that is decided, **this flow should not ship**, because it would present a
closure it does not perform.

## 6. What is deliberately not designed

Permanent deletion. Retention rules are unconfirmed, and a permanent-delete
button whose retention story is "we'll decide later" is the one thing that
cannot be walked back. `admin_purge_account` exists for the admin path and
already refuses to destroy retained clinical records; nothing here changes it.

## 7. Decisions needed before implementation

1. **Retention period** for a closed account before records are removed. The
   screen cannot state a number until this exists.
2. **How closure is enforced** (RLS / GoTrue ban / client) — see §5. This is an
   access-model change and needs explicit approval.
3. **Whether the doctor-with-patients case refuses or reassigns.** This design
   refuses; reassignment is a defensible alternative but makes decisions about
   other people's care.
4. **Whether reversal is support-mediated or self-service.** This design says
   support-mediated, because self-service contradicts the promise.

Item 2 is the blocker. Items 1, 3 and 4 shape the wording and the refusals.
