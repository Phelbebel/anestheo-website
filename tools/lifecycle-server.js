/* lifecycle-server.js — an in-browser model of the lifecycle RPCs.
 *
 * WHY THIS EXISTS. Every previous suite asserted the lifecycle by reading
 * source strings, and source strings are exactly what did not catch this
 * outage: patient_lifecycle_eligibility LOOKED correct in v4_3 and raised
 * `column q.surgery_id does not exist` on every eligible record. A test that
 * greps for "patient_lifecycle_action" would have passed the whole time
 * Archive and Delete were dead.
 *
 * So this models the server instead. It mirrors, statement for statement:
 *
 *   v4_5_lifecycle_questions_schema_repair.sql   patient_lifecycle_eligibility
 *   v4_patient_lifecycle.sql section 6           patient_lifecycle_action,
 *                                                patient_set_starred
 *   v4_1_purge_safety.sql                        recycle_bin_list
 *   v4_3_function_hardening.sql                  patient_record_manageable
 *
 * including the order of the checks, because the order IS the security
 * property: authorization is answered before existence so a refusal cannot
 * describe what it refuses.
 *
 * MODE. `window.__LC_MODE = 'broken'` reproduces the pre-v4_5 server: the
 * eligible path raises 42703 exactly as production did. That is not decoration
 * — it is how the suite proves the frontend never renders the raw text, and
 * how it proves the repair is what makes Archive work rather than some other
 * change.
 *
 * This is a MODEL, not the database. It cannot prove the SQL is right; it
 * proves the client drives the contract correctly and reacts correctly to
 * every answer the contract allows. The SQL is asserted separately, as text.
 */
(function (global) {
'use strict';

var UID = global.__LC_UID || '9e000000-0000-4000-8000-00000000cafe';
var DB  = global.__LC_DB  || { patient_surgeries: [], clinic_patients: [], care_requests: [], questions: [] };
var MODE = global.__LC_MODE || 'fixed';

global.__LC_CALLS = [];
function record(fn, args) { global.__LC_CALLS.push({ fn: fn, args: JSON.parse(JSON.stringify(args || {})) }); }

function rows(t) { return DB[t] || []; }
function byId(t, id) { return rows(t).filter(function (r) { return r.id === id; })[0] || null; }
function ok(d) { return Promise.resolve({ data: d, error: null }); }
function pgErr(code, message) { return Promise.resolve({ data: null, error: { code: code, message: message } }); }

/* patient_record_manageable(kind,id) — v4_3. A doctor manages a journey they
   are assigned to and a clinic patient they own. Nothing else, and never a
   pending doctor. */
function manageable(kind, id) {
  if (!UID) return false;
  if (global.__LC_PENDING_DOCTOR) return false;
  if (kind === 'journey') {
    var s = byId('patient_surgeries', id);
    return !!(s && (s.assigned_doctor_id === UID || s.patient_id === UID));
  }
  if (kind === 'clinic_patient') {
    var c = byId('clinic_patients', id);
    return !!(c && c.doctor_id === UID);
  }
  return false;
}

function J(o) { return o; }

/* patient_lifecycle_eligibility — v4_5. */
function eligibility(kind, id, action) {
  var k = String(kind || '').toLowerCase();
  var a = String(action || 'archive').toLowerCase();

  if (!UID) return ok(J({ eligible:false, code:'not_authorized', reason:'You are not signed in.' }));
  if (!id || ['journey','clinic_patient'].indexOf(k) < 0)
    return ok(J({ eligible:false, code:'invalid_input',
      reason:'A record type of journey or clinic_patient and an id are required.' }));
  if (['archive','restore_archive','delete','restore_delete'].indexOf(a) < 0)
    return ok(J({ eligible:false, code:'invalid_input', reason:'Unknown action.' }));

  // AUTHORIZATION BEFORE EXISTENCE. Same sentence for "not yours" and "gone".
  if (!manageable(k, id))
    return ok(J({ eligible:false, code:'not_authorized',
      reason:'This record is not available to you. It may belong to another clinician, or it may no longer exist.' }));

  var row = k === 'journey' ? byId('patient_surgeries', id) : byId('clinic_patients', id);
  if (!row) return ok(J({ eligible:false, code:'record_not_found', reason:'That record no longer exists.' }));

  var arch = row.archived_at || null, del = row.deleted_at || null;
  if (a === 'archive') {
    if (del)  return ok(J({ eligible:false, code:'already_deleted',  reason:'This record is in the Recycle Bin.' }));
    if (arch) return ok(J({ eligible:false, code:'already_archived', reason:'This record is already archived.' }));
  } else if (a === 'restore_archive') {
    if (del)   return ok(J({ eligible:false, code:'already_deleted', reason:'Restore it from the Recycle Bin first.' }));
    if (!arch) return ok(J({ eligible:false, code:'not_archived',    reason:'This record is not archived.' }));
  } else if (a === 'delete') {
    if (del)  return ok(J({ eligible:false, code:'already_deleted', reason:'This record is already in the Recycle Bin.' }));
  } else if (a === 'restore_delete') {
    if (!del) return ok(J({ eligible:false, code:'not_deleted', reason:'This record is not deleted.' }));
  }

  // The one clinical blocker.
  if (a === 'archive' && k === 'journey' &&
      rows('care_requests').some(function (cr) {
        return cr.surgery_id === id && cr.status === 'requested' && !cr.deleted_at; }))
    return ok(J({ eligible:false, code:'clinical_blocker',
      reason:'A consultation request is still open for this patient. Resolve it first.' }));

  /* THE LINE THIS WHOLE BRANCH IS ABOUT. In 'broken' mode the eligible path —
     and only the eligible path — raises, exactly as the deployed function did:
     the reference sat in the final RETURN, so every refusal above returned
     cleanly while every record a doctor could actually act on failed. */
  if (MODE === 'broken')
    return pgErr('42703', 'column q.surgery_id does not exist');

  var warnings = [];
  if (a === 'archive') {
    var patient = null;
    if (k === 'journey') {
      patient = row.patient_id || null;
    } else {
      // Only the explicit UNIQUE back-link. Never name or email.
      var links = rows('patient_surgeries').filter(function (s) {
        return s.clinic_patient_id === id && !s.deleted_at; });
      patient = links.length === 1 ? (links[0].patient_id || null) : null;
    }
    if (patient && rows('questions').some(function (q) {
          return q.patient_id === patient && q.status !== 'answered' && !q.deleted_at; }))
      warnings.push('This patient has an unanswered question.');
  }

  return ok(J({ eligible:true, code:'eligible',
    reason: a === 'archive'         ? 'Moves the patient to Archived. Nothing is deleted.'
          : a === 'restore_archive' ? 'Returns the patient to the active list.'
          : a === 'delete'          ? 'Moves the patient to the Recycle Bin. Recoverable.'
          :                           'Restores the patient from the Recycle Bin.',
    warnings: warnings }));
}

/* patient_lifecycle_action — v4_patient_lifecycle section 6. Re-checks
   eligibility server-side, then writes ONLY lifecycle columns. There is no
   DELETE statement here, on any path, deliberately. */
function action(kind, id, act, reason) {
  var k = String(kind || '').toLowerCase(), a = String(act || '').toLowerCase();
  return eligibility(k, id, a).then(function (r) {
    if (r.error) return r;                                   // the outage propagates
    var e = r.data;
    if (!e.eligible) return ok(J({ ok:false, code:e.code, reason:e.reason }));

    var row = k === 'journey' ? byId('patient_surgeries', id) : byId('clinic_patients', id);
    var now = new Date().toISOString();
    if (a === 'archive') {
      row.archived_at = now; row.archived_by = UID; row.archive_reason = reason || null;
    } else if (a === 'restore_archive') {
      row.archived_at = null; row.archived_by = null; row.archive_reason = null;
      row.restored_at = now; row.restored_by = UID;
    } else if (a === 'delete') {
      row.deleted_at = now; row.deleted_by = UID; row.delete_reason = reason || null;
    } else {
      row.deleted_at = null; row.deleted_by = null; row.delete_reason = null;
      row.restored_at = now; row.restored_by = UID;
    }
    row.updated_at = now;
    // No child row is touched on any path. Children are hidden by the
    // parent-aware predicates and reappear on restore for that reason.
    return ok(J({ ok:true, code:a, kind:k, id:id }));
  });
}

function setStarred(kind, id, starred) {
  var k = String(kind || '').toLowerCase();
  if (!manageable(k, id))
    return ok(J({ ok:false, code:'not_authorized', reason:'You cannot change this patient.' }));
  var row = k === 'journey' ? byId('patient_surgeries', id) : byId('clinic_patients', id);
  row.is_starred = !!starred;
  return ok(J({ ok:true, is_starred: !!starred }));
}

/* recycle_bin_list() — soft-deleted records the caller manages. Authorization
   positive: a caller with nothing gets an empty set, never an error. */
function recycleBinList() {
  var out = [];
  rows('patient_surgeries').forEach(function (s) {
    if (s.deleted_at && (s.assigned_doctor_id === UID) && !global.__LC_PENDING_DOCTOR)
      out.push({ kind:'journey', id:s.id, name:s.patient_name || 'Patient',
                 deleted_at:s.deleted_at, delete_reason:s.delete_reason || null,
                 was_archived: !!s.archived_at, purge_eligible:false });
  });
  rows('clinic_patients').forEach(function (c) {
    if (c.deleted_at && c.doctor_id === UID && !global.__LC_PENDING_DOCTOR)
      out.push({ kind:'clinic_patient', id:c.id, name:c.patient_name || 'Patient',
                 deleted_at:c.deleted_at, delete_reason:c.delete_reason || null,
                 was_archived: !!c.archived_at, purge_eligible:false });
  });
  return ok(out);
}

/* Wire into the mock client. The lifecycle RPCs are intercepted; everything
   else falls through to whatever was already there. */
function install() {
  var sb = global.sb;
  if (!sb) return false;
  var prior = sb.rpc.bind(sb);
  sb.rpc = function (fn, p) {
    p = p || {};
    if (fn === 'patient_lifecycle_eligibility') { record(fn, p); return eligibility(p.p_kind, p.p_id, p.p_action); }
    if (fn === 'patient_lifecycle_action')      { record(fn, p); return action(p.p_kind, p.p_id, p.p_action, p.p_reason); }
    if (fn === 'patient_set_starred')           { record(fn, p); return setStarred(p.p_kind, p.p_id, p.p_starred); }
    if (fn === 'recycle_bin_list')              { record(fn, p); return recycleBinList(); }
    if (fn === 'journey_visible')               { var s=byId('patient_surgeries', p.p_surgery_id); return ok(!!s && !s.deleted_at); }
    if (fn === 'clinic_patient_visible')        { var c=byId('clinic_patients', p.p_clinic_patient_id); return ok(!!c && !c.deleted_at); }
    return prior(fn, p);
  };

  /* Reads. The dashboard builds its cards from these four tables, so they must
     answer from the SAME rows the RPCs mutate — otherwise a test could show a
     card disappearing while the server never moved anything. */
  var priorFrom = sb.from.bind(sb);
  var OWNED = { patient_surgeries:1, clinic_patients:1, care_requests:1, preop_questionnaires:1 };
  sb.from = function (t) {
    if (!OWNED[t]) return priorFrom(t);
    var list = (t === 'preop_questionnaires') ? (DB.preop_questionnaires || []) : rows(t);
    var q = {
      _rows: list.slice(),
      select: function () { return q; },
      eq: function (c, v) { q._rows = q._rows.filter(function (r) { return r[c] === v; }); return q; },
      is: function (c, v) { q._rows = q._rows.filter(function (r) { return (r[c] || null) === v; }); return q; },
      in: function (c, vs) { q._rows = q._rows.filter(function (r) { return vs.indexOf(r[c]) >= 0; }); return q; },
      order: function () { return q; },
      maybeSingle: function () { return Promise.resolve({ data: q._rows[0] || null, error: null }); },
      then: function (res, rej) { return Promise.resolve({ data: q._rows, error: null }).then(res, rej); },
      update: function (patch) {
        q._patch = patch;
        var upd = {
          eq: function (c, v) {
            list.forEach(function (r) { if (r[c] === v) Object.keys(patch).forEach(function (k) { r[k] = patch[k]; }); });
            return Promise.resolve({ data: null, error: null });
          }
        };
        return upd;
      }
    };
    return q;
  };
  return true;
}

global.LifecycleServer = { install:install, DB:DB, eligibility:eligibility, action:action,
                           recycleBinList:recycleBinList, calls:function(){ return global.__LC_CALLS; } };
if (!install()) {
  // supabase.js may not have run yet; try again once it has.
  document.addEventListener('DOMContentLoaded', install);
}

})(typeof window !== 'undefined' ? window : this);
