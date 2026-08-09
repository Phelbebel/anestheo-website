# Authentication — manual configuration

The application code for Apple, Google and Facebook sign-in is complete and
tested. **None of it works until the steps below are done**, because the
credentials live in provider consoles and in the Supabase dashboard, not in
this repository.

Nothing here was applied for you. No live Supabase setting was changed.

**Never put any value from this document into client-side JavaScript, and never
commit a `.p8` key or an app secret to this repository.** Provider secrets go
into the Supabase dashboard only.

`MANUAL VALUE REQUIRED` marks anything project-specific that only you can read
from your own console.

---

## 1. Supabase — URL configuration

*Authentication → URL Configuration*

**Site URL**
```
https://anestheo.com
```

**Redirect URLs** — exactly these four:
```
https://anestheo.com/auth-callback.html
https://anestheo.com/reset-password.html
https://anestheo.com/index.html
https://anestheo.com/
```

Why these and no wildcard: Supabase compares `redirectTo` against this list
**verbatim**. A value that does not match is not rejected loudly — it is
silently replaced with the Site URL. That is a safe failure but an invisible
one, and it is exactly how confirmation links ended up on `/v2/` before the
cutover. Four exact entries are enough because the application only ever asks
for two destinations; `index.html` and `/` are listed because the homepage is
where sign-out and fallbacks land.

The application builds these from `location.origin`, so on production they
resolve to precisely the URLs above.

---

## 2. Google

### Google Cloud Console
1. *APIs & Services → OAuth consent screen* — External, publish to production.
   Add `anestheo.com` under authorised domains.
2. *Credentials → Create credentials → OAuth client ID → **Web application***.
3. **Authorised redirect URI** — the Supabase callback:
   ```
   https://<PROJECT_REF>.supabase.co/auth/v1/callback
   ```
   `MANUAL VALUE REQUIRED` — your project ref. Supabase shows the exact URL on
   the Google provider page; copy it from there rather than typing it.
4. Authorised JavaScript origins: **not required**. The browser never talks to
   Google directly — Supabase performs the exchange.
5. Copy **Client ID** and **Client Secret** — `MANUAL VALUE REQUIRED`.

### Supabase
*Authentication → Sign In / Providers → Google* → Enable → paste Client ID and
Client Secret → Save.

---

## 3. Apple  ⚠️ the one that expires

Apple is the only provider here with a credential that **stops working on a
timer**. Treat the rotation date as a real operational commitment: when it
lapses, Apple sign-in simply begins failing for everyone, with no deploy and no
code change to explain it.

### Apple Developer
1. Paid Apple Developer Program membership. `MANUAL VALUE REQUIRED`
2. An **App ID** with the *Sign in with Apple* capability enabled.
3. A **Services ID** — this, not the App ID, is the client identifier for a
   **web** app. Associate it with the App ID above. `MANUAL VALUE REQUIRED`
4. On the Services ID, configure *Sign in with Apple*:
   - **Domain**: `anestheo.com`
   - **Return URL**: `https://<PROJECT_REF>.supabase.co/auth/v1/callback`
     `MANUAL VALUE REQUIRED`
5. Create a **Sign in with Apple key**, download the `.p8` **once** — Apple
   will not let you download it again. Record:
   - **Key ID** `MANUAL VALUE REQUIRED`
   - **Team ID** `MANUAL VALUE REQUIRED`
   - private key file — store in a password manager or secret store,
     **not in this repository**

### Supabase
*Authentication → Sign In / Providers → Apple* → Enable → provide the Services
ID as the client ID and the client secret. Depending on your dashboard version
Supabase may generate the secret JWT from Team ID / Key ID / `.p8`, or may ask
for a pre-generated JWT. Use whichever the page offers.

### ⚠️ Secret rotation — record this and set a reminder

The Apple client secret is a JWT with a **maximum lifetime of 6 months**. When
it expires, Apple sign-in fails for every user until a new secret is issued.

| | |
|---|---|
| Services ID | `MANUAL VALUE REQUIRED` |
| Team ID | `MANUAL VALUE REQUIRED` |
| Key ID | `MANUAL VALUE REQUIRED` |
| `.p8` private key held by | `MANUAL VALUE REQUIRED` (person / vault) |
| Secret generated on | `MANUAL VALUE REQUIRED` |
| **Next rotation due** | `MANUAL VALUE REQUIRED` (≤ 6 months later) |

Put the rotation date in a shared calendar with an owner, not only in this file.

### Hide My Email

Apple lets a user hide their address, in which case Apple returns a relay such
as `something@privaterelay.appleid.com`. That is a different email from their
ordinary one, so Supabase treats it as a **different user** — which is correct
and must not be "fixed". Merging two accounts because a human says they are the
same person is account takeover with extra steps.

Practical consequence: someone with an existing password account who signs in
with Apple + Hide My Email gets a second Anestheo account. If you later want
them joined, the safe direction is a *Connect Apple* action inside an
already-authenticated session (Supabase Manual Linking + `linkIdentity()`).
That is deliberately **not** implemented here.

---

## 4. Facebook / Meta

### Meta for Developers
1. Create an app; add the **Facebook Login** product.
2. *Facebook Login → Settings → Valid OAuth Redirect URIs*:
   ```
   https://<PROJECT_REF>.supabase.co/auth/v1/callback
   ```
   `MANUAL VALUE REQUIRED`
3. Permissions: `public_profile` and **`email`**. Supabase needs `email` to
   populate the user; without it the account cannot be linked or identified.
4. **App ID** and **App Secret** — `MANUAL VALUE REQUIRED`
5. Switch the app from Development to **Live**. Live mode requires:
   - **Privacy Policy URL** — `https://anestheo.com/privacy.html` (exists)
   - **Data Deletion** instructions URL or callback — `MANUAL VALUE REQUIRED`;
     a short section on an existing page is usually accepted
6. App Review: `public_profile` + `email` are normally granted without review.
   Confirm on your app's dashboard — Meta changes this periodically.

### Supabase
*Authentication → Sign In / Providers → Facebook* → Enable → App ID + App
Secret → Save.

---

## 5. Email templates and SMTP

Not changed by this work. Today Anestheo almost certainly uses the default
Supabase sender, which is rate-limited and does not look like Anestheo mail.

### *Authentication → Email Templates*
For **Confirm signup** and **Reset password**, use:
```
{{ .ConfirmationURL }}
```
Do not hand-build links. `{{ .ConfirmationURL }}` honours the `redirectTo` the
application sends, which is what keeps these links on the root domain and off
`/v2/`. A hard-coded URL in a template silently ignores it.

### *Authentication → SMTP Settings*
| Setting | Value |
|---|---|
| Custom SMTP | enable |
| Provider | your choice — `MANUAL VALUE REQUIRED` |
| Host / port / user / pass | `MANUAL VALUE REQUIRED` |
| Sender name | `Anestheo` |
| Sender address | e.g. `no-reply@anestheo.com` — `MANUAL VALUE REQUIRED` |

Then add **SPF** and **DKIM** records for `anestheo.com` at your DNS provider,
per your SMTP provider's instructions. Without them, confirmation and reset
mail lands in spam, which looks identical to "email is broken".

---

## 6. Order to do this in

1. URL configuration (section 1) — **do this first**. It fixes email
   confirmation and password reset on its own, independently of any provider.
2. Google — the least involved; use it to prove the callback works end to end.
3. Facebook.
4. Apple last, and record the rotation date the moment you create the secret.
5. SMTP whenever convenient; it changes appearance, not function.

After each provider, run the checks in the implementation report: new account
lands on `role-select.html`, an existing account keeps its role, and a doctor
account is still `pending` until an admin approves it.
