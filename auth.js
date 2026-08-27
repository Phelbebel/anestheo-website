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


// ── isPlatformAdmin ───────────────────────────────────────────────
/* THE one answer to "is this person a platform administrator", and it comes
   from the server.
--
   Every page used to work this out for itself from the profile row —
   `p.is_admin === true || p.role === 'admin'` — in eight different places. The
   profile object is client-side state: it is whatever the last fetch returned,
   and it is trivially editable in a console. None of those checks was a
   security boundary (RLS is, and the Admin Center does its own server-side
   gate), but eight copies of a privilege rule is eight places to get it wrong,
   and "looks like an admin locally" and "is an admin" should not be separate
   ideas in this codebase.
--
   is_platform_admin() is the same predicate the RLS policies use, so the menu
   and the database now agree by construction.
--
   ANSWERS ONLY ABOUT THE CALLER. It takes no argument and reports on the
   current session, so it cannot be used to ask whether some OTHER user in a
   list is an administrator. Those places — the Accounts table badge, the admin
   filter chips — still read the profile field, because that is the only thing
   that can answer the question, and they are describing a row rather than
   granting anything.
--
   Cached for the life of the page: one round trip, not one per component.
   FAILS CLOSED. If the call errors the answer is false, so a transient network
   fault hides an admin link rather than showing one to the wrong person. It
   cannot lock a real administrator out: /admin.html gates itself on the same
   RPC, so the page still opens if reached directly, and a reload re-asks. */
var _adminAnswer = null;

function isPlatformAdmin() {
  if (!_adminAnswer) {
    _adminAnswer = (async function () {
      try {
        var session = await getSession();
        if (!session) return false;
        var r = await withTimeout(window.sb.rpc('is_platform_admin'), 8000, 'is_platform_admin');
        if (r.error) { console.warn('is_platform_admin:', r.error.message); return false; }
        return r.data === true;
      } catch (e) {
        console.warn('is_platform_admin failed:', e.message);
        return false;
      }
    })();
  }
  return _adminAnswer;
}

/* Signing out must not leave the next account holding the previous one's
   answer. */
function resetPlatformAdmin() { _adminAnswer = null; }

// ── requireAuth ───────────────────────────────────────────────
// Call on every protected page. Returns { session, user, profile } or null.
// Redirects to /index.html if no session, and to /role-select.html if the
// account has not chosen a role yet.
//
// TWO QUESTIONS, NOT ONE. This used to ask only "is somebody signed in?" and a
// brand-new account passed it, because role='pending' is a real row with a
// real session behind it. Being signed in is not the same as having an
// account that is finished, and every protected page called this expecting it
// to answer both.
//
// WHAT THAT COST. handle_new_user() creates every account at role='pending',
// and the chooser was only ever OFFERED — by auth-callback.html, which routes
// correctly, and by one inline check in index.html. Nothing required it. A
// Google or Facebook sign-in that landed on any other URL — a bookmark, a
// shared link, the browser restoring a tab — was let straight in with no role
// on file. Worse, requireRole() sent unapproved callers to
// /patient-dashboard.html, a page guarded by this function, so the clinical
// guards actively DELIVERED role-less accounts into the patient application.
//
// AND IT WAS NOT COSMETIC. Every patient-side RLS policy keys on ownership —
// auth.uid() = patient_id — with no role predicate anywhere. To the database a
// 'pending' account is a fully functional patient: it can create a
// questionnaire, a Health Passport, a surgery record. The role column said
// nobody had chosen; the data said otherwise.
//
// So the rule lives here, in the one function all of them already call, rather
// than in a copy on each page that can drift.
//
//   opts.allowPending  — for a page that legitimately serves an account with
//                        no role yet. Nothing ships with it today; it exists
//                        so that adding such a page is a deliberate act.
//   opts.noRedirect    — suppresses the UNAUTHENTICATED redirect only. A
//                        signed-in account with no role is a different
//                        situation with a different right answer, and sending
//                        it to the chooser is that answer.
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
  /* Resolved once here so every caller gets the server's answer without each
     page having to remember to ask for it. */
  var isAdmin = await isPlatformAdmin();

  /* THE ROLE GATE.
     Administrators are exempt, and deliberately so: is_admin is a platform
     privilege that only an audited admin action sets, it is orthogonal to the
     clinical role, and an administrator who has never picked one is still an
     administrator. Gating them here would lock the Admin Center behind a
     question that does not apply to them. Everyone else chooses first. */
  var role = (profile && profile.role) || 'pending';
  if (role === 'pending' && !isAdmin && !opts.allowPending) {
    window.location.replace('/role-select.html');
    return null;
  }

  return { session: session, user: user, profile: profile, isAdmin: isAdmin };
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
  /* Clinical role and platform privilege are orthogonal. Collapsing the role
     into 'admin' whenever is_admin was set meant an approved anesthesiologist
     who also administers the platform stopped counting as a doctor for
     routing — including on the pages where they do clinical work. */
  var role = p.role || 'patient';
  var isAdmin = auth.isAdmin === true;      // from is_platform_admin(), server-side

  /* IS THIS DOCTOR VERIFIED? — a question about trust surfaces, not access.

     This was `window.location.replace('/doctor-pending.html')`, which held an
     unapproved doctor out of every staff page. It was an honest presentation
     of the database at the time: thirty-three RESTRICTIVE policies really did
     deny them every clinical table, so the workspace would have rendered empty.

     v9_doctor_access_model.sql, deployed, removed those policies and
     re-pointed ten predicates from is_verified_doctor() to is_doctor_account().
     v9_5_verification_boundary.sql, deployed after it, put a narrower boundary
     back: twelve patient-management tables are RESTRICTIVE against
     is_pending_doctor() again, and the anesthesia family admits an unverified
     doctor only for a case linked to nobody.

     So the accurate statement is narrower than this comment used to make it.
     Being a doctor account opens the clinical workspace — the anesthesia
     record, the drug library, scores, crisis tools. Verification opens the
     rest: patient management, the public directory, the patient Questions
     inbox, verifying a Health Passport entry, and being named as a co-author
     on someone's chart.

     So this flag gates nothing here, and it must not. It exists so a page can
     offer the optional step, or explain one specific trust-gated action,
     without every page re-deriving the rule from the profile row.

     Administrators are excluded for the reason they always were: their trust
     surfaces come from the admin privilege, so telling them they are
     unverified would describe something that does not apply to them. */
  auth.unverifiedDoctor = (role === 'doctor' &&
                           (p.verification_status || '') !== 'approved' && !isAdmin);
  auth.pendingDoctor = auth.unverifiedDoctor;   // previous name; kept for one release

  var isStaff = (role === 'doctor' || role === 'admin' || isAdmin);
  var allow = Array.isArray(allowed) ? allowed : [allowed];
  var ok;
  if (allow.indexOf('staff') >= 0) ok = isStaff;
  else { ok = allow.indexOf(role) >= 0; if (isAdmin && allow.indexOf('admin') >= 0) ok = true; }
  if (ok) return auth;

  /* NO ROLE IS NOT THE WRONG ROLE.
     requireAuth() above already sends a roleless account to the chooser, so
     this is unreachable in ordinary use — it is here because the line below
     is what made the bypass reachable, and the rule belongs where somebody
     reading the deny path will look for it.

     What it replaces: `isStaff ? '/dashboard.html' : '/patient-dashboard.html'`
     with no third case. A brand-new account is not staff, so every clinical
     URL — the doctor workspace, Live Tools, Live Chart, the questionnaire
     library — handed it to /patient-dashboard.html and called that a denial.
     Being turned away from the doctor's door is not a reason to be shown into
     the patient's. */
  if (role === 'pending' && !isAdmin) {
    window.location.replace('/role-select.html');
    return null;
  }

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
//
// THERE IS DELIBERATELY NO FALLBACK. An earlier version dropped back to a
// direct profiles.update() when the RPC was missing, so that onboarding would
// survive deploying the client before the migration. That convenience was a
// privilege-escalation hole: with the hardening absent, `setOwnRole('admin')`
// typed into the browser console wrote role='admin' straight to the caller's
// own row, and is_platform_admin() keys off exactly that. Measured on a
// replica with the trigger dropped, that write succeeds.
//
// So the RPC is now the only path. If it is missing the call fails loudly and
// onboarding stops — which is the correct outcome, because a database without
// the hardening cannot safely accept a role write from a browser at all.
/* ── submitDoctorOnboarding ─────────────────────────────────────────────────
   HOTFIX. v9_1_doctor_onboarding.sql is applied in production and its
   set_own_role() now REFUSES 'doctor', pointing callers at this RPC instead.
   This page still called setOwnRole('doctor'), so doctor registration has been
   failing since that migration committed.

   This is deliberately the SMALLEST change that restores it: the same call the
   new frontend makes, wired into the page that is live today. It carries none
   of the access-model work — that ships with v9 and its own frontend.

   The RPC answers with { ok:false, code:'missing_fields', missing:[...] }
   rather than raising when a field is absent, because the caller is a form.
   Authorization failures still raise. */
async function submitDoctorOnboarding(fields) {
  try {
    var r = await window.sb.rpc('submit_doctor_onboarding', {
      p_full_name:          fields.full_name || null,
      p_professional_level: fields.professional_level || null,
      p_country:            fields.country || null,
      p_phone:              fields.phone || null,
      p_license:            fields.medical_license_number || null,
      p_hospital:           fields.hospital || null,
      p_university:         fields.medical_university || null,
      p_specialty:          fields.specialty || null
    });
    if (r.error) {
      var m = r.error.message || '';
      /* If the RPC is absent this deployment has NOT had v9_1 applied, and
         set_own_role still accepts 'doctor'. Fall back to the old pair rather
         than blocking registration — this file has to work on both sides of
         that migration. */
      if (r.error.code === '42883' || r.error.code === 'PGRST202' ||
          /function .* does not exist|could not find the function|schema cache/i.test(m)) {
        return { legacy: true, error: null };
      }
      return { error: { message: m || 'We could not complete your registration.' } };
    }
    return { data: r.data || null, error: null };
  } catch (e) {
    return { error: { message: e.message || 'We could not reach the server.' } };
  }
}
window.submitDoctorOnboarding = submitDoctorOnboarding;

/* ── createDoctorAccount ────────────────────────────────────────────────────
   Registration and verification are two acts, and this is the first one: a
   doctor account from a name alone, at verification_status='pending'.

   The professional file — licence, hospital, university, specialty — is no
   longer collected here. It is collected on doctor-pending.html, through
   submit_doctor_onboarding(), which is unchanged and still insists on all
   eight fields. Nothing about what verification requires has moved; only when
   it is asked for has.

   WHEN THE RPC IS ABSENT this deployment has not had v9_3 applied, so the
   database still has no way to make a doctor without the full file. Answering
   { legacy:true } lets the caller fall back to asking for it, which is the
   current behaviour and is correct on that database. The alternative — failing
   — would take doctor registration down between deploying this file and
   applying the migration. */
async function createDoctorAccount(fullName) {
  try {
    var r = await window.sb.rpc('create_doctor_account', { p_full_name: fullName || null });
    if (r.error) {
      var m = r.error.message || '';
      if (r.error.code === '42883' || r.error.code === 'PGRST202' ||
          /function .* does not exist|could not find the function|schema cache/i.test(m)) {
        return { legacy: true, error: null };
      }
      return { error: { message: m || 'We could not open your account.' } };
    }
    return { data: r.data || null, error: null };
  } catch (e) {
    return { error: { message: e.message || 'We could not reach the server.' } };
  }
}
window.createDoctorAccount = createDoctorAccount;

async function setOwnRole(role) {
  try {
    var r = await window.sb.rpc('set_own_role', { p_role: role });
    if (!r.error) return { error: null };
    if (r.error.code === '42883' || r.error.code === 'PGRST202' ||
        /function .* does not exist|could not find the function|schema cache/i.test(r.error.message || '')) {
      console.error('set_own_role() is missing — apply v2_security_hardening.sql.');
      return { error: { message:
        'Account setup is temporarily unavailable. Please try again shortly.' } };
    }
    return { error: r.error };
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

  /* NO ROLE IS EVER READ FROM user_metadata.

     Metadata is client-supplied — for a social sign-in it is whatever Google
     or Facebook returned, and for our own form it used to be whatever the
     browser posted. The previous version tried to tell those apart with an
     `anestheo_signup` marker. That worked, but it meant the codebase still
     contained a path where a role arrived from outside the database and had
     to be judged. Registration no longer sends one at all, so the judgement
     is gone with it: EVERY new profile starts at 'pending' and every new user
     chooses on role-select.html, against a real session, through
     set_own_role().

     verification_status is derived, never asserted: "am I a verified doctor"
     is not a claim a client gets to make.

     Defence in depth, not the boundary — trg_guard_profiles_self_update
     forces exactly these values on INSERT server-side. Measured on a replica:
     a forged INSERT of role=admin/is_admin=true/verification=approved lands as
     pending / false / not_required. */
  var row = {
    id: user.id,
    email: user.email,
    role: 'pending',
    verification_status: 'not_required'
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
function resetSessionCache() {
  _sessionPromise = null;
  /* The admin answer belongs to the session that produced it. Clearing one
     without the other would let a newly signed-in account inherit the previous
     holder's privileges in the navigation. */
  _adminAnswer = null;
  /* Signed avatar URLs are minted against a session too, and one person's
     face must never survive into the next person's navbar. */
  _avatarSignedCache = {};
  _avatarPathCache = {};
}
window.resetSessionCache = resetSessionCache;
window.ensureProfile = ensureProfile;

// ── signOut ───────────────────────────────────────────────────
async function signOut() {
  _sessionPromise = null;
  _adminAnswer = null;
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
      .is('deleted_at', null).is('archived_at', null).is('completed_at', null)
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
      var lg = await window.sb.from(table).select('*').eq('patient_id', patientId).is('deleted_at', null).limit(1);
      if (lg.error) { console.warn(table + ' legacy read:', lg.error.message); return null; }
      return (lg.data && lg.data[0]) || null;
    }
    if (surgeryId) {
      var s = await window.sb.from(table).select('*').eq('surgery_id', surgeryId).is('deleted_at', null).limit(1);
      if (!s.error && s.data && s.data.length) return s.data[0];
    }
    // legacy / not-yet-scoped row for this patient
    // Soft-deleted questionnaires and checklists are Recycle Bin content, not
    // the row a patient is still filling in.
    var r = await window.sb.from(table).select('*')
      .eq('patient_id', patientId).is('deleted_at', null).is('surgery_id', null)
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

/* ── THE AVATAR RESOLVER ────────────────────────────────────────────────────
   ONE answer to "what picture goes here", used by the navbar, both dashboards
   and settings. Duplicating this is how three surfaces end up disagreeing
   about who you are.

   Precedence, highest first:
     1. an image the person uploaded to Anestheo   (profiles.avatar_url)
     2. the picture their sign-in provider supplies (Google / Facebook)
     3. their initials

   WHY THE PROVIDER PICTURE IS READ FROM THE SESSION AND NEVER COPIED INTO THE
   DATABASE. It is not ours: Facebook's URLs expire, Google's change when the
   person changes their photo, and a stored copy would go stale while looking
   authoritative. Reading it live means the fallback is always current and we
   hold no third-party PII we were not asked to hold.

   WHY IT IS NEVER TRUSTED FOR ANYTHING BUT A PICTURE. user_metadata is
   writable by the account holder through auth.updateUser, so it is a claim,
   not a fact. It decides no role, no permission and no identity here — and it
   is only ever used to draw YOUR OWN avatar, never another person's, so the
   worst a determined user achieves is choosing their own picture, which is
   the feature. Anything shown about somebody else must come from the
   database. */

var AVATAR_META_KEYS = ['avatar_url', 'picture', 'photoURL', 'profile_image_url'];

/* Only an https image URL from the provider is usable. http would be mixed
   content on an https page, and a data: or javascript: value has no business
   arriving from a third party. */
function providerAvatarUrl(user) {
  if (!user) return null;
  var sources = [user.user_metadata || {}];
  var ids = user.identities || [];
  for (var i = 0; i < ids.length; i++) {
    if (ids[i] && ids[i].identity_data) sources.push(ids[i].identity_data);
  }
  for (var s = 0; s < sources.length; s++) {
    for (var k = 0; k < AVATAR_META_KEYS.length; k++) {
      var v = sources[s][AVATAR_META_KEYS[k]];
      if (typeof v === 'string' && /^https:\/\//i.test(v.trim())) return v.trim();
    }
  }
  return null;                       // plenty of accounts have no picture
}

/* Two letters, from whatever we actually know. Never blank: a circle with
   nothing in it reads as a broken image. */
function avatarInitials(profile, user) {
  var name = (profile && profile.full_name) || '';
  var parts = String(name).trim().split(/\s+/).filter(Boolean);
  var out = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0]
          : parts[0]          ? parts[0].slice(0, 2)
          : (user && user.email) ? user.email.slice(0, 2)
          : '?';
  return out.toUpperCase();
}

/* profiles.avatar_url holds a STORAGE PATH, not a URL — the bucket is private,
   so the displayable form is a signed URL minted per session. The column may
   not exist yet on a database that has not had the avatars migration applied;
   a missing column simply means nobody has uploaded anything, which is the
   correct reading, so it degrades to the provider picture rather than
   erroring. */
var _avatarSignedCache = {};
var _avatarPathCache = {};

/* WHY avatar_url IS READ SEPARATELY AND NOT ADDED TO getProfile()'s SELECT.
   getProfile names its columns explicitly, and naming a column that does not
   exist makes PostgREST fail the whole request with 42703 — which would take
   out the profile read on EVERY page, for every user, the moment this shipped
   ahead of the migration. The avatar is not worth that risk.

   So it is fetched on its own and every failure is swallowed: no column, no
   row, no network — all mean "no uploaded photo", which is the correct
   reading. The frontend therefore works before the migration is applied and
   gains uploads the moment it is, in either deployment order. */
async function ownAvatarPath(userId) {
  if (!userId) return null;
  if (userId in _avatarPathCache) return _avatarPathCache[userId];
  var val = null;
  try {
    var r = await withTimeout(
      window.sb.from('profiles').select('avatar_url').eq('id', userId).maybeSingle(),
      8000, 'avatarPath');
    if (!r.error && r.data) val = r.data.avatar_url || null;
  } catch (e) { /* treated as "no photo", deliberately */ }
  _avatarPathCache[userId] = val;
  return val;
}

async function signedAvatarUrl(path) {
  if (!path) return null;
  if (_avatarSignedCache[path]) return _avatarSignedCache[path];
  try {
    var r = await withTimeout(
      window.sb.storage.from('avatars').createSignedUrl(path, 3600), 8000, 'avatar');
    if (r && r.data && r.data.signedUrl) {
      _avatarSignedCache[path] = r.data.signedUrl;
      return r.data.signedUrl;
    }
  } catch (e) { console.warn('avatar url:', e.message); }
  return null;
}
function resetAvatarCache() { _avatarSignedCache = {}; _avatarPathCache = {}; }

/* The one call every surface makes. Always resolves — never throws, never
   leaves a caller without something to draw. */
async function resolveAvatar(profile, user) {
  var initials = avatarInitials(profile, user);
  /* A caller that manages the row itself — Settings, right after an upload —
     passes the key and is believed. Everyone else gets the tolerant lookup. */
  var uploaded = (profile && 'avatar_url' in profile)
    ? profile.avatar_url
    : await ownAvatarPath(user && user.id);
  if (uploaded) {
    var url = await signedAvatarUrl(uploaded);
    if (url) return { kind: 'upload', url: url, initials: initials };
  }
  var prov = providerAvatarUrl(user);
  if (prov) return { kind: 'provider', url: prov, initials: initials };
  return { kind: 'initials', url: null, initials: initials };
}

/* Paint a resolved avatar into an element. Every surface uses this so the
   fallback behaves identically everywhere: if the image fails to load — an
   expired Facebook URL, a blocked third-party host, an offline moment — the
   initials come back rather than leaving an empty circle. */
function setAvatarEl(el, a) {
  if (!el || !a) return;
  if (!a.url) { el.textContent = a.initials; el.removeAttribute('data-avatar'); return; }
  var img = document.createElement('img');
  img.alt = '';                          // decorative: the name is beside it
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';    // do not tell the provider where we are
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;';
  img.onerror = function () { el.textContent = a.initials; el.removeAttribute('data-avatar'); };
  img.onload = function () {
    el.textContent = '';
    el.setAttribute('data-avatar', a.kind);
    el.appendChild(img);
  };
  img.src = a.url;
}

window.setAvatarEl        = setAvatarEl;
window.resolveAvatar      = resolveAvatar;
window.avatarInitials     = avatarInitials;
window.providerAvatarUrl  = providerAvatarUrl;
window.resetAvatarCache   = resetAvatarCache;

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

/* ── RETURN-TO ──────────────────────────────────────────────────────────────
   A NARROW BREADCRUMB, NOT A SECOND AUTH SYSTEM.

   Sign-in had no memory of where it started. Every door — the navbar modal,
   the OAuth callback, the role chooser, the recovery page — asks
   resolveAuthDestination() and goes where it says, and that answer was derived
   from the role alone. So a visitor who opened the sign-in modal from
   /ask.html was returned to their patient home instead, having lost the thing
   they came to do.

   The fix is one key and one validator, read by the one resolver every door
   already calls. Nothing new authenticates anything.

   THE VALIDATION IS THE WHOLE SAFETY ARGUMENT. A stored path is attacker-
   influenceable — anything that can run script in this origin can write
   sessionStorage — so it is never used as given. It must be an exact member of
   an allowlist of internal pages. Not "starts with /", which admits
   //evil.example and /\evil.example, both of which browsers treat as
   protocol-relative and would send a freshly-authenticated user off-site. An
   allowlist cannot be talked around.

   sessionStorage, not localStorage: the intent belongs to this tab and this
   visit. An email-confirmation link opened in a NEW tab has no breadcrumb and
   falls back to the role-based destination, which is correct rather than
   surprising. */
var AUTH_RETURN_KEY = 'anestheo.auth.returnTo';
/* ONE ENTRY, because one page calls setAuthReturnTo(). The first draft listed
   seven plausible public pages; none of the other six has a caller, and an
   allowlist entry with no caller is reachable only by something that should
   not be writing this key. It grows when a page actually needs it. */
var AUTH_RETURN_ALLOW = ['/ask.html'];

function setAuthReturnTo(path) {
  if (AUTH_RETURN_ALLOW.indexOf(path) === -1) return false;
  try { sessionStorage.setItem(AUTH_RETURN_KEY, path); return true; } catch (e) { return false; }
}
/* Read WITHOUT consuming. The chooser needs the breadcrumb to survive one
   extra hop: a brand-new account goes /ask.html → modal → role-select →
   Patient → /ask.html, and role-select asks the resolver a second time. */
function peekAuthReturnTo() {
  try {
    var v = sessionStorage.getItem(AUTH_RETURN_KEY);
    return (v && AUTH_RETURN_ALLOW.indexOf(v) !== -1) ? v : null;
  } catch (e) { return null; }
}
function clearAuthReturnTo() {
  try { sessionStorage.removeItem(AUTH_RETURN_KEY); } catch (e) {}
}
window.setAuthReturnTo   = setAuthReturnTo;
window.peekAuthReturnTo  = peekAuthReturnTo;
window.clearAuthReturnTo = clearAuthReturnTo;
window.AUTH_RETURN_ALLOW = AUTH_RETURN_ALLOW;

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
  var admin  = await isPlatformAdmin();

  // No role yet — a brand-new social user, or a confirmation for an account
  // that never finished onboarding. Send them to the existing chooser.
  if (!role || role === 'pending') {
    /* The breadcrumb is deliberately NOT consumed here. Onboarding is not the
       destination, it is a detour on the way to one — role-select.html asks
       this resolver again once a role exists, and the return target has to
       still be there when it does. */
    return { ok: true, dest: '/role-select.html', role: 'pending', verification: verif };
  }

  /* A FINISHED ACCOUNT MAY GO BACK WHERE IT CAME FROM. Consumed on use, so a
     return target survives exactly one authentication and cannot redirect a
     later, unrelated sign-in. */
  var back = peekAuthReturnTo();
  if (back) {
    clearAuthReturnTo();
    return { ok: true, dest: back, role: role, verification: verif, returned: true };
  }

  if (admin) return { ok: true, dest: '/dashboard.html', role: 'admin', verification: verif };

  /* Patient Home is /index.html in its authenticated state — that is the
     established patient landing, used by role-select.html and by sign-in
     before this change. /patient-dashboard.html ("My Space") stays reachable
     from the navbar; it is a destination within the patient area, not its
     front door. This resolver previously sent patients to My Space, which
     made the OAuth callback disagree with every other entry point. */
  if (role === 'patient') return { ok: true, dest: '/index.html', role: 'patient', verification: verif };

/* An unapproved doctor lands in the workspace like any other clinician.
     They used to be routed to /doctor-pending.html — a page with no way
     onward, reached again on every sign-in. That page still exists, linked
     from the Verified Clinician prompt, as the place that explains what
     verification adds. It is an offer now, not a gate. */

  return { ok: true, dest: '/dashboard.html', role: role, verification: verif };
}
window.resolveAuthDestination = resolveAuthDestination;

// ── EXPORTS ───────────────────────────────────────────────────
window.getSession        = getSession;
window.isPlatformAdmin   = isPlatformAdmin;
window.resetPlatformAdmin= resetPlatformAdmin;
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
