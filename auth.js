// auth.js — shared auth helpers
// Load order: CDN → supabase.js → auth.js → navbar.js → page script

// ── TIMEOUT GUARD ─────────────────────────────────────────────
// Wrap any promise so it can never hang forever. Rejects after `ms`.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise(function(_, reject){
      setTimeout(function(){ reject(new Error((label || 'Request') + ' timed out')); }, ms);
    })
  ]);
}

// ── SESSION CACHE ─────────────────────────────────────────────
var _sessionPromise = null;

function getSession() {
  if (!_sessionPromise) {
    _sessionPromise = withTimeout(window.sb.auth.getSession(), 8000, 'getSession')
      .then(function(r) {
        return (r.data && r.data.session) ? r.data.session : null;
      })
      .catch(function(e) { console.warn('getSession failed:', e.message); return null; });
  }
  return _sessionPromise;
}

// ── getProfile ────────────────────────────────────────────────
async function getProfile(userId) {
  try {
    var r = await withTimeout(
      window.sb
        .from('profiles')
        .select('id,email,full_name,role,verification_status,hospital,specialty,country,phone,is_admin')
        .eq('id', userId)
        .maybeSingle(),
      8000, 'getProfile'
    );
    if (r.error) { console.warn('getProfile error:', r.error.message); return null; }
    return r.data || null;
  } catch(e) {
    console.error('getProfile exception:', e.message);
    return null;
  }
}

// ── requireAuth ───────────────────────────────────────────────
// Call on every protected page. Returns { session, user, profile } or null.
// Redirects to /index.html if no session.
async function requireAuth(opts) {
  opts = opts || {};
  var session = await getSession();
  if (!session) {
    if (opts.noRedirect) { return null; }
    window.location.href = '/index.html';
    return null;
  }
  var user    = session.user;
  var profile = await getProfile(user.id);
  if (!profile) {
    // Never fail a protected page just because the profile row is missing.
    profile = await ensureProfile(user);
  }
  return { session: session, user: user, profile: profile };
}

// Alias
function initializeAuth() {
  return requireAuth();
}

// ── requireRole ───────────────────────────────────────────────
// UX guard for staff-only pages. Authorization is still enforced
// authoritatively by Supabase RLS + backend policies; this only avoids
// rendering a doctor page to the wrong role.
//   allowed: 'staff' (doctor or admin) | 'admin' | 'doctor' | array of roles
//   opts.deny: explicit redirect target for the wrong role (optional)
// Returns { session, user, profile } when permitted, or null after redirect.
async function requireRole(allowed, opts) {
  opts = opts || {};
  var auth = await requireAuth(opts);              // unauthenticated → /index.html
  if (!auth) return null;
  var p = auth.profile || {};
  var role = p.role || 'patient';
  var isAdmin = (p.is_admin === true || role === 'admin');
  if (isAdmin) role = 'admin';
  var isStaff = (role === 'doctor' || role === 'admin');
  var allow = Array.isArray(allowed) ? allowed : [allowed];
  var ok;
  if (allow.indexOf('staff') >= 0) ok = isStaff;
  else { ok = allow.indexOf(role) >= 0; if (isAdmin && allow.indexOf('admin') >= 0) ok = true; }
  if (ok) return auth;
  // Wrong role: non-staff (patients/other) go to their own space; a staff
  // member lacking a finer role (e.g. a doctor on an admin page) goes to the
  // staff dashboard. replace() so Back doesn't return to the blocked page.
  var dest = opts.deny || (isStaff ? '/dashboard.html' : '/patient-dashboard.html');
  window.location.replace(dest);
  return null;
}

// ── Protected profile fields ──────────────────────────────────
// role / is_admin / verification_status are privileged. The database is the
// real boundary (trg_guard_profiles_self_update rejects them for the API
// roles); stripping them here is defence in depth, and it keeps a stale
// payload from failing an otherwise-valid profile save.
var PROTECTED_PROFILE_FIELDS = ['role', 'is_admin', 'verification_status'];

async function saveProfile(userId, data) {
  try {
    var stripped = [];
    PROTECTED_PROFILE_FIELDS.forEach(function(k){
      if (Object.prototype.hasOwnProperty.call(data, k)) { delete data[k]; stripped.push(k); }
    });
    if (stripped.length) {
      console.warn('saveProfile: ignoring protected field(s) ' + stripped.join(', ') +
        ' — role changes go through setOwnRole(); verification is an admin action.');
    }
    data.id         = userId;
    data.updated_at = new Date().toISOString();
    var r = await window.sb.from('profiles').upsert(data);
    return { error: r.error || null };
  } catch(e) {
    return { error: { message: e.message } };
  }
}

// ── setOwnRole ────────────────────────────────────────────────
// The ONE legitimate self-service role write. The server decides
// verification_status and refuses 'admin'; the caller supplies only the role.
// Falls back to the legacy direct write while v2_security_hardening.sql has not
// been applied yet, so onboarding keeps working across the deploy boundary.
var _roleRpc = null;                       // null unknown, true present, false absent
function _fnMissing(err) {
  if (!err) return false;
  return err.code === '42883' || err.code === 'PGRST202' ||
         /function .* does not exist|could not find the function|schema cache/i.test(err.message || '');
}
async function setOwnRole(role) {
  if (_roleRpc !== false) {
    try {
      var r = await window.sb.rpc('set_own_role', { p_role: role });
      if (!r.error) { _roleRpc = true; return { error: null }; }
      if (!_fnMissing(r.error)) { _roleRpc = true; return { error: r.error }; }
      _roleRpc = false;                    // not deployed yet
    } catch(e) { _roleRpc = false; }
  }
  // Pre-migration path only. Once the hardening migration is applied the RPC
  // exists and this branch is never reached; if it somehow is, the trigger
  // rejects it rather than letting a privileged field through.
  try {
    var s = await getSession();
    if (!s) return { error: { message: 'Not signed in' } };
    var verif = (role === 'doctor') ? 'pending' : 'not_required';
    var u = await window.sb.from('profiles')
      .update({ role: role, verification_status: verif, updated_at: new Date().toISOString() })
      .eq('id', s.user.id);
    return { error: u.error || null };
  } catch(e) {
    return { error: { message: e.message } };
  }
}

// ── ensureProfile ─────────────────────────────────────────────
// Guarantees a profiles row exists for this auth user. If the
// handle_new_user trigger didn't run (or row is missing), create it.
// NOTE: profiles primary key is `id` (FK → auth.users.id), not `user_id`.
async function ensureProfile(user) {
  if (!user) return null;
  var profile = await getProfile(user.id);
  if (profile) return profile;

  var meta = user.user_metadata || {};

  /* ROLE IS NOT TAKEN FROM ARBITRARY PROVIDER METADATA.
     user_metadata is writable by whoever created the user. For our own
     registration form that is us, and the role the person picked is carried
     there deliberately. For an OAuth sign-in it is whatever Apple, Google or
     Facebook chose to return, and a claim called "role" arriving from a third
     party must never seed an Anestheo role.

     So metadata is trusted only when it also carries the marker our own
     signUp() writes, and only for the roles that form can produce. Everything
     else — every social sign-in — starts at 'pending' and goes through
     role-select.html.

     verification_status is never read from metadata at all: it is derived,
     because "am I a verified doctor" is not something a client may assert.

     Defence in depth, not the boundary. trg_guard_profiles_self_update forces
     these same values on INSERT server-side — verified locally: role 'admin'
     becomes 'pending', is_admin becomes false, and doctor+approved becomes
     doctor+pending. This block simply stops the client asking for something
     the database would refuse. */
  var SELF_SIGNUP_ROLES = ['patient', 'doctor', 'other'];
  var claimed = (meta.anestheo_signup === true && typeof meta.role === 'string')
    ? meta.role : null;
  var role = (claimed && SELF_SIGNUP_ROLES.indexOf(claimed) >= 0) ? claimed : 'pending';

  var row = {
    id: user.id,
    email: user.email,
    role: role,
    verification_status: (role === 'doctor') ? 'pending' : 'not_required'
  };
  try {
    var r = await withTimeout(window.sb.from('profiles').upsert(row, { onConflict: 'id' }), 8000, 'ensureProfile');
    if (r.error) { console.warn('ensureProfile upsert error:', r.error.message); }
  } catch(e) {
    console.warn('ensureProfile exception:', e.message);
  }
  // Re-read (best effort); return the row we attempted even if read fails
  var fresh = await getProfile(user.id);
  return fresh || row;
}

// ── resetSessionCache ─────────────────────────────────────────
// Call right after a successful sign-in so the next getSession() is fresh.
function resetSessionCache() { _sessionPromise = null; }
window.resetSessionCache = resetSessionCache;
window.ensureProfile = ensureProfile;

// ── signOut ───────────────────────────────────────────────────
async function signOut() {
  _sessionPromise = null;
  try { await window.sb.auth.signOut(); } catch(e) {}
  window.location.href = '/index.html';
}

// ── ONE auth state listener — bust session cache on sign-out only ──
// Do NOT reset on SIGNED_IN — that fires on every page load with a
// valid session and would bust the cache we just built.
window.sb.auth.onAuthStateChange(function(event) {
  if (event === 'SIGNED_OUT') {
    _sessionPromise = null;
  }
});

// ── PRE-OP QUESTIONNAIRE HELPERS ──────────────────────────────
// Journey-aware. A patient may now hold several surgery journeys (one active,
// any number archived), so questionnaires and checklists are scoped by
// surgery_id. Signatures are unchanged, so every existing caller keeps working:
// when no surgery is passed we resolve the patient's ACTIVE journey. Rows that
// pre-date journey scoping (surgery_id IS NULL) are still found and are then
// adopted into the active journey on the next save.
//
// The previous upsert(onConflict:'patient_id') calls are gone: that constraint
// no longer exists, and an upsert keyed on patient_id would overwrite a
// historical journey's row. Reads never use bare .maybeSingle() on patient_id
// either, because that now throws when a patient has more than one row.

// ── Journey-column feature detection (deployment compatibility) ──────────────
// The frontend ships BEFORE v2_patient_journeys_phase1.sql is applied, so the
// surgery_id columns may not exist yet. We probe once per page-load and cache
// the answer; every journey-aware query degrades to the legacy patient-level
// behaviour while the column is missing. The single probe request is expected
// to 400 on the old schema and is fully caught.
var _journeyCols = null;                       // null = unknown, true/false = known
function _isMissingColumn(err) {
  if (!err) return false;
  return err.code === '42703' || /surgery_id/.test(err.message || '');
}
async function supportsJourneys() {
  if (_journeyCols !== null) return _journeyCols;
  try {
    var r = await window.sb.from('preop_questionnaires').select('surgery_id').limit(1);
    _journeyCols = !(r && r.error && _isMissingColumn(r.error));
  } catch(e) { _journeyCols = false; }
  return _journeyCols;
}

// Resolve the patient's active journey id (null when they have none yet).
async function getActiveSurgeryId(patientId) {
  try {
    var r = await window.sb.from('patient_surgeries')
      .select('id,created_at')
      .eq('patient_id', patientId)
      .is('archived_at', null).is('completed_at', null)
      .order('created_at', { ascending: false }).limit(1);
    if (r.error || !r.data || !r.data.length) return null;
    return r.data[0].id;
  } catch(e) { return null; }
}

// Internal: newest row for this patient, preferring the given journey.
async function _journeyRow(table, patientId, surgeryId) {
  try {
    // Pre-migration: surgery_id does not exist -> legacy one-row-per-patient.
    if (!(await supportsJourneys())) {
      var lg = await window.sb.from(table).select('*').eq('patient_id', patientId).limit(1);
      if (lg.error) { console.warn(table + ' legacy read:', lg.error.message); return null; }
      return (lg.data && lg.data[0]) || null;
    }
    if (surgeryId) {
      var s = await window.sb.from(table).select('*').eq('surgery_id', surgeryId).limit(1);
      if (!s.error && s.data && s.data.length) return s.data[0];
    }
    // legacy / not-yet-scoped row for this patient
    var r = await window.sb.from(table).select('*')
      .eq('patient_id', patientId).is('surgery_id', null)
      .order('updated_at', { ascending: false, nullsFirst: false }).limit(1);
    if (!r.error && r.data && r.data.length) return r.data[0];
    return null;
  } catch(e) { console.error(table + ' read exc:', e.message); return null; }
}

async function getQuestionnaire(patientId, surgeryId) {
  var sid = (await supportsJourneys()) ? (surgeryId || await getActiveSurgeryId(patientId)) : null;
  return await _journeyRow('preop_questionnaires', patientId, sid);
}

// Explicit read-then-update/insert: no ambiguous upsert, never overwrites another
// journey's row.
async function saveQuestionnaire(patientId, fields, surgeryId) {
  try {
    var journeys = await supportsJourneys();
    var sid = journeys ? (surgeryId || await getActiveSurgeryId(patientId)) : null;
    var existing = await _journeyRow('preop_questionnaires', patientId, sid);
    fields.patient_id = patientId;
    fields.updated_at = new Date().toISOString();
    if (journeys && sid) fields.surgery_id = sid;
    var r = existing
      ? await window.sb.from('preop_questionnaires').update(fields).eq('id', existing.id)
      : await window.sb.from('preop_questionnaires').insert(fields);
    return { error: r.error || null };
  } catch(e) { return { error: { message: e.message } }; }
}

async function getChecklist(patientId, surgeryId) {
  var sid = (await supportsJourneys()) ? (surgeryId || await getActiveSurgeryId(patientId)) : null;
  return await _journeyRow('preop_checklist', patientId, sid);
}

async function saveChecklist(patientId, items, surgeryId) {
  try {
    var journeys = await supportsJourneys();
    var sid = journeys ? (surgeryId || await getActiveSurgeryId(patientId)) : null;
    var existing = await _journeyRow('preop_checklist', patientId, sid);
    var row = { patient_id: patientId, items: items, updated_at: new Date().toISOString() };
    if (journeys && sid) row.surgery_id = sid;
    var r = existing
      ? await window.sb.from('preop_checklist').update(row).eq('id', existing.id)
      : await window.sb.from('preop_checklist').insert(row);
    return { error: r.error || null };
  } catch(e) { return { error: { message: e.message } }; }
}

// Doctors/admins: read all submitted questionnaires
async function getAllQuestionnaires() {
  try {
    var r = await window.sb.from('preop_questionnaires')
      .select('*').order('updated_at', { ascending: false });
    if (r.error) { console.warn('getAllQuestionnaires:', r.error.message); return []; }
    return r.data || [];
  } catch(e) { console.error('getAllQuestionnaires exc:', e.message); return []; }
}

/* ══════════════════════════════════════════════════════════════════════════
   SOCIAL SIGN-IN  (Apple / Google / Facebook)

   One function for all three providers, on the same Supabase client and the
   same session as email/password. There is no second auth system: a social
   login produces an ordinary Supabase session in the same localStorage key,
   so every existing guard, RLS policy and RPC keeps working untouched.

   AUTHENTICATION ONLY. Signing in with Apple proves the caller controls an
   Apple ID — nothing more. Role and doctor verification come from the
   database, never from provider metadata. See resolveAndRoute() below.
   ══════════════════════════════════════════════════════════════════════════ */

var AUTH_PROVIDERS = ['apple', 'google', 'facebook'];

/* Where the provider sends the browser back to.

   Built from location.origin rather than hard-coded, so the same code works
   on production and on a staging origin. In production this resolves to
   exactly https://anestheo.com/auth-callback.html, which is what must appear
   in the Supabase Redirect URLs allowlist — Supabase compares it verbatim and
   silently falls back to Site URL when it does not match. That fallback is
   the safe direction, but it is also how a typo hides, so the allowlist entry
   and this value must be kept identical. */
function authRedirectTo(page) {
  return window.location.origin + '/' + page;
}
window.authRedirectTo = authRedirectTo;

async function signInWithProvider(provider) {
  if (AUTH_PROVIDERS.indexOf(provider) < 0) {
    return { error: { message: 'Unsupported sign-in provider.' } };
  }
  try {
    var r = await window.sb.auth.signInWithOAuth({
      provider: provider,
      options: { redirectTo: authRedirectTo('auth-callback.html') }
    });
    /* A configured provider redirects the browser and this line never runs.
       Reaching here with an error almost always means the provider is not
       enabled in the Supabase dashboard, or its credentials are wrong. Say
       so plainly rather than showing a raw OAuth string. */
    if (r && r.error) {
      var m = String(r.error.message || '');
      if (/provider.*not enabled|unsupported provider/i.test(m)) {
        return { error: { message: 'That sign-in method is not available yet.' } };
      }
      return { error: { message: m || 'Could not start sign-in.' } };
    }
    return { error: null };
  } catch (e) {
    return { error: { message: 'Could not reach the sign-in service. Check your connection and try again.' } };
  }
}
window.signInWithProvider = signInWithProvider;

/* ── resolveAndRoute ────────────────────────────────────────────────────────
   The single decision point after ANY landing that carries a session: social
   callback, email confirmation, or a recovery link that has finished.

   Every branch reads public.profiles. Provider metadata is never consulted,
   so a Google account claiming to be a doctor is still routed as whatever the
   database says it is — which for a brand-new user is 'pending', i.e. the
   role chooser. Returns the destination rather than navigating, so callers
   can report failures instead of bouncing the user somewhere misleading. */
async function resolveAuthDestination() {
  var session = await getSession();
  if (!session || !session.user) {
    return { ok: false, reason: 'no-session' };
  }
  var user = session.user;

  var profile = await getProfile(user.id);
  if (!profile) {
    profile = await ensureProfile(user);      // upsert on id — never duplicates
    if (!profile) return { ok: false, reason: 'profile-failed', user: user };
  }

  var role   = profile.role || 'pending';
  var verif  = profile.verification_status || '';
  var admin  = (profile.is_admin === true) || role === 'admin';

  // No role yet — a brand-new social user, or a confirmation for an account
  // that never finished onboarding. Send them to the existing chooser.
  if (!role || role === 'pending') {
    return { ok: true, dest: '/role-select.html', role: 'pending', verification: verif };
  }
  if (admin)            return { ok: true, dest: '/dashboard.html',         role: 'admin',   verification: verif };
  if (role === 'patient') return { ok: true, dest: '/patient-dashboard.html', role: 'patient', verification: verif };

  /* Doctor and other staff both land on the workspace. A doctor whose
     verification_status is still 'pending' is NOT blocked here — dashboard.html
     already shows the verification banner and every verified-only capability is
     gated server-side by RLS. Inventing a separate pending page here would add
     a second, weaker gate in the client. */
  return { ok: true, dest: '/dashboard.html', role: role, verification: verif };
}
window.resolveAuthDestination = resolveAuthDestination;

// ── EXPORTS ───────────────────────────────────────────────────
window.getSession        = getSession;
window.getProfile        = getProfile;
window.requireAuth       = requireAuth;
window.requireRole       = requireRole;
window.initializeAuth    = initializeAuth;
window.saveProfile       = saveProfile;
window.setOwnRole        = setOwnRole;
window.signOut           = signOut;
window.supportsJourneys   = supportsJourneys;
window.getActiveSurgeryId = getActiveSurgeryId;
window.getQuestionnaire  = getQuestionnaire;
window.saveQuestionnaire = saveQuestionnaire;
window.getChecklist      = getChecklist;
window.saveChecklist     = saveChecklist;
window.getAllQuestionnaires = getAllQuestionnaires;
