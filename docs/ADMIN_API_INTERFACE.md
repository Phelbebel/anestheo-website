# `admin-api` Edge Function — interface specification

**Status: DESIGN ONLY. Not implemented, not deployed in Phase 0.**
Documented now because `auth.users` (GoTrue) cannot be reached from the browser,
so these operations have no other possible home. Implementation requires a
separate, explicit approval (Phase 4).

---

## Why it must exist

`last_sign_in_at`, `app_metadata.provider`, active refresh sessions, ban/disable,
password-reset links and auth-account deletion live in `auth.users` / the GoTrue
admin API. They are **not** in `public.*`, so no RLS policy or SECURITY DEFINER
RPC can expose them. Only the service-role key can, and that key must never
leave the server.

## Non-negotiable security contract

Every request MUST pass all of these before any effect:

1. **Verify the caller's JWT** — read the `Authorization: Bearer <jwt>` header and
   resolve it with `auth.getUser(jwt)`. Reject if absent/invalid.
   Deploy with `verify_jwt = true` (unlike `convert_clinic_patient`, which is
   deliberately token-proved and unauthenticated).
2. **Independently verify admin role server-side** — re-read
   `public.profiles` for that uid and require `is_admin = true OR role = 'admin'`.
   Never trust a role claim from the client body or JWT metadata.
3. **Service-role key stays server-side** — read from
   `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`; never returned, logged or echoed.
4. **Action allowlist** — a fixed `switch` over known action names. No table
   names, column names, SQL or arbitrary filters accepted from the client.
5. **Reason required for destructive actions** — `ban`, `delete`, `revoke_sessions`.
6. **Audit every call** — write to `admin_audit_log` via `admin_log()` (or a
   direct service-role insert) **before returning**, including failures.
7. **Never return secrets** — no tokens, no password hashes, no magic links in
   list responses (a reset link is returned only to the initiating admin).
8. **Rate limit / bound** — pagination capped (e.g. `perPage <= 200`).
9. **Self-protection** — an admin may not ban or delete their own account, and
   the last remaining admin may not be demoted/deleted.

## Endpoint shape

`POST /functions/v1/admin-api`  →  `{ action: string, ...params }`

| Action | Params | Returns | Destructive | GoTrue call |
|---|---|---|---|---|
| `users.list` | `page`, `perPage<=200`, `q?` | `[{id,email,provider,created_at,last_sign_in_at,banned_until,email_confirmed_at}]` | no | `auth.admin.listUsers` |
| `users.get` | `user_id` | one user + provider/session summary | no | `auth.admin.getUserById` |
| `users.disable` | `user_id`, `reason`, `duration?` | `{banned_until}` | **yes** | `auth.admin.updateUserById({ban_duration})` |
| `users.enable` | `user_id`, `reason` | `{banned_until:null}` | no | `auth.admin.updateUserById({ban_duration:'none'})` |
| `users.revoke_sessions` | `user_id`, `reason` | `{revoked:true}` | **yes** | `auth.admin.signOut(user_id, 'global')` |
| `users.reset_password` | `user_id` | `{link}` (to the admin only) | no | `auth.admin.generateLink({type:'recovery'})` |
| `users.delete` | `user_id`, `reason`, `confirm:"DELETE <label>"` | `{deleted:true}` | **yes** | `auth.admin.deleteUser` |

All responses: `{ ok: boolean, data?: …, error?: string }`. CORS mirrors the
existing functions.

## Deployment (when approved)

```
supabase functions deploy admin-api          # verify_jwt = true (default)
# Secrets already present in the project: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
```

## Explicitly out of scope

Impersonation ("login as"), bulk operations, arbitrary SQL, schema changes, and
anything that mutates clinical records — those stay in audited `public.*` RPCs.
