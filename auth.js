// auth.js — /v2 shared auth helpers
// Load order: CDN → supabase.js → auth.js → navbar.js → page script
console.log('AUTH JS LOADED');

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
    console.log('PROFILE LOOKUP START:', userId);
    var r = await withTimeout(
      window.sb
        .from('profiles')
        .select('id,email,full_name,role,verification_status,hospital,specialty,country,phone,is_admin')
        .eq('id', userId)
        .maybeSingle(),
      8000, 'getProfile'
    );
    if (r.error) { console.warn('getProfile error:', r.error.message); return null; }
    console.log('PROFILE LOOKUP COMPLETE:', r.data ? r.data.role : 'no row');
    return r.data || null;
  } catch(e) {
    console.error('getProfile exception:', e.message);
    return null;
  }
}

// ── requireAuth ───────────────────────────────────────────────
// Call on every protected page. Returns { session, user, profile } or null.
// Redirects to /v2/index.html if no session.
async function requireAuth(opts) {
  opts = opts || {};
  var session = await getSession();
  if (!session) {
    if (opts.noRedirect) { console.log('NO SESSION — caller handling'); return null; }
    console.log('NO SESSION — redirecting to index');
    window.location.href = '/v2/index.html';
    return null;
  }
  var user    = session.user;
  console.log('AUTH SUCCESS', user.id);
  var profile = await getProfile(user.id);
  if (!profile) {
    // Never fail a protected page just because the profile row is missing.
    profile = await ensureProfile(user);
  }
  console.log('PROFILE', profile);
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
  var auth = await requireAuth(opts);              // unauthenticated → /v2/index.html
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
  var dest = opts.deny || (isStaff ? '/v2/dashboard.html' : '/v2/patient-dashboard.html');
  console.log('ROLE GUARD: role "' + role + '" not permitted here — redirecting to ' + dest);
  window.location.replace(dest);
  return null;
}

// ── saveProfile ───────────────────────────────────────────────
async function saveProfile(userId, data) {
  try {
    data.id         = userId;
    data.updated_at = new Date().toISOString();
    var r = await window.sb.from('profiles').upsert(data);
    return { error: r.error || null };
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

  console.log('PROFILE MISSING — auto-creating for', user.id);
  var meta = user.user_metadata || {};
  var row = {
    id: user.id,
    email: user.email,
    role: meta.role || 'pending',
    verification_status: meta.verification_status || (meta.role === 'doctor' ? 'pending' : 'not_required')
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
  window.location.href = '/v2/index.html';
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
  var sid = surgeryId || await getActiveSurgeryId(patientId);
  return await _journeyRow('preop_questionnaires', patientId, sid);
}

// Explicit read-then-update/insert: no ambiguous upsert, never overwrites another
// journey's row.
async function saveQuestionnaire(patientId, fields, surgeryId) {
  try {
    var sid = surgeryId || await getActiveSurgeryId(patientId);
    var existing = await _journeyRow('preop_questionnaires', patientId, sid);
    fields.patient_id = patientId;
    fields.updated_at = new Date().toISOString();
    if (sid) fields.surgery_id = sid;
    var r = existing
      ? await window.sb.from('preop_questionnaires').update(fields).eq('id', existing.id)
      : await window.sb.from('preop_questionnaires').insert(fields);
    return { error: r.error || null };
  } catch(e) { return { error: { message: e.message } }; }
}

async function getChecklist(patientId, surgeryId) {
  var sid = surgeryId || await getActiveSurgeryId(patientId);
  return await _journeyRow('preop_checklist', patientId, sid);
}

async function saveChecklist(patientId, items, surgeryId) {
  try {
    var sid = surgeryId || await getActiveSurgeryId(patientId);
    var existing = await _journeyRow('preop_checklist', patientId, sid);
    var row = { patient_id: patientId, items: items, updated_at: new Date().toISOString() };
    if (sid) row.surgery_id = sid;
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

// ── EXPORTS ───────────────────────────────────────────────────
window.getSession        = getSession;
window.getProfile        = getProfile;
window.requireAuth       = requireAuth;
window.requireRole       = requireRole;
window.initializeAuth    = initializeAuth;
window.saveProfile       = saveProfile;
window.signOut           = signOut;
window.getActiveSurgeryId = getActiveSurgeryId;
window.getQuestionnaire  = getQuestionnaire;
window.saveQuestionnaire = saveQuestionnaire;
window.getChecklist      = getChecklist;
window.saveChecklist     = saveChecklist;
window.getAllQuestionnaires = getAllQuestionnaires;
