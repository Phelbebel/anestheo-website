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
async function getQuestionnaire(patientId) {
  try {
    var r = await window.sb.from('preop_questionnaires')
      .select('*').eq('patient_id', patientId).maybeSingle();
    if (r.error) { console.warn('getQuestionnaire:', r.error.message); return null; }
    return r.data || null;
  } catch(e) { console.error('getQuestionnaire exc:', e.message); return null; }
}

async function saveQuestionnaire(patientId, fields) {
  try {
    fields.patient_id = patientId;
    fields.updated_at = new Date().toISOString();
    var r = await window.sb.from('preop_questionnaires')
      .upsert(fields, { onConflict: 'patient_id' });
    return { error: r.error || null };
  } catch(e) { return { error: { message: e.message } }; }
}

async function getChecklist(patientId) {
  try {
    var r = await window.sb.from('preop_checklist')
      .select('*').eq('patient_id', patientId).maybeSingle();
    if (r.error) { console.warn('getChecklist:', r.error.message); return null; }
    return r.data || null;
  } catch(e) { console.error('getChecklist exc:', e.message); return null; }
}

async function saveChecklist(patientId, items) {
  try {
    var r = await window.sb.from('preop_checklist')
      .upsert({ patient_id: patientId, items: items, updated_at: new Date().toISOString() },
              { onConflict: 'patient_id' });
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
window.getQuestionnaire  = getQuestionnaire;
window.saveQuestionnaire = saveQuestionnaire;
window.getChecklist      = getChecklist;
window.saveChecklist     = saveChecklist;
window.getAllQuestionnaires = getAllQuestionnaires;
