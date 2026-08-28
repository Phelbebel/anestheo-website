/* patient-lifecycle.js — the one client-side view of a patient's lifecycle.

   A patient record lives in three dimensions that Anestheo keeps deliberately
   separate, and this module never conflates them:

     WORKFLOW      care_state / questionnaire_status / consultation_status.
                   Owned by the clinical flow. This file does not touch it.
     ORGANIZATION  is_starred. A personal marker; independent of everything.
     LIFECYCLE     active -> archived -> soft deleted -> purged.

   Every lifecycle decision is the server's. This module calls
   patient_lifecycle_eligibility / patient_lifecycle_action / patient_set_starred
   / patient_purge_eligibility / patient_purge / recycle_bin_list and translates
   their STRUCTURED CODES into UI states.

   What it deliberately does not do: collapse different refusals into one
   sentence. "You are not signed in", "this patient belongs to another doctor"
   and "there is a signed anesthesia record" are three different problems with
   three different remedies, and the production bug this replaces
   ("Could not check eligibility right now") was exactly the cost of pretending
   otherwise.

   THE ONE LINE THAT MOVED. This file used to report a transport failure with
   the server's real message too, on the same reasoning. That reasoning was
   right about refusals and wrong about transport: when a GRANT drifted in
   production the doctor's menu printed

       permission denied for function patient_lifecycle_eligibility

   which is not a remedy, it is a stack trace. So rpc_error — and nothing else —
   now resolves to one human sentence, and the server's words go to the console
   and to refusal().technical. Every genuine refusal still says exactly what the
   server said. See refusal() at the bottom of this file. */
(function (global) {
'use strict';

var KINDS = ['journey', 'clinic_patient'];
var CONFIRM_WORD = 'PERMANENTLY DELETE';

/* Lifecycle actions, named as the server names them. */
var ACT = {
  ARCHIVE:         'archive',
  RESTORE_ARCHIVE: 'restore_archive',
  DELETE:          'delete',
  RESTORE_DELETE:  'restore_delete'
};

/* ── Structured code -> what the user is told ──────────────────────────────
   tone: 'ok'     the action may proceed
         'block'  a real rule refuses it; the reason is worth reading
         'state'  it is simply already true; not an error
         'auth'   an authorization answer, never disguised as a workflow rule
         'gone'   the record moved or vanished; the list is stale
         'bug'    the client asked something impossible; log it            */
var CODES = {
  eligible:                 { tone:'ok'    },
  clinical_blocker:         { tone:'block' },
  retained_clinical_record: { tone:'block' },
  active_clinical_record:   { tone:'block' },
  clinical_dependencies:    { tone:'block' },
  already_archived:         { tone:'state', short:'Already archived' },
  already_deleted:          { tone:'state', short:'Already in the Recycle Bin' },
  not_archived:             { tone:'state', short:'Not archived' },
  not_deleted:              { tone:'state', short:'Not in the Recycle Bin' },
  not_authorized:           { tone:'auth'  },
  record_not_found:         { tone:'gone',  short:'No longer available' },
  unsupported_record:       { tone:'bug'   },
  invalid_input:            { tone:'bug'   },
  confirmation_required:    { tone:'block' },
  rpc_error:                { tone:'block' }
};

function toneOf(code){ return (CODES[code] && CODES[code].tone) || 'block'; }
function shortOf(code){ return (CODES[code] && CODES[code].short) || null; }

function sb(){ return global.sb || null; }

/* Every RPC returns the same shape, including when the call itself fails.
   A failed call is 'rpc_error' with the server's own message — never a
   reassuring sentence that hides what went wrong. */
function rpc(name, args){
  var client = sb();
  if (!client) {
    return Promise.resolve({ eligible:false, ok:false, code:'rpc_error',
                             reason:'Not connected. Reload the page and try again.' });
  }
  /* .catch(), NOT .then(onFulfilled, onRejected).
     The second argument of .then() only handles a rejection of the PREVIOUS
     promise — it does not catch a throw from the fulfilment handler beside it.
     This function threw r.error there, so every RPC that answered with an
     error object (a missing GRANT, a dropped function, RLS refusing) escaped
     as an unhandled rejection instead of becoming {code:'rpc_error'}.
     Callers awaiting it never resumed, which is why the Doctor Dashboard's
     Archive and Delete sat on "Checking…" for ever rather than reporting the
     refusal. .catch() sits after the fulfilment handler and catches both. */
  var call;
  try { call = Promise.resolve(client.rpc(name, args)); }
  catch (e) { call = Promise.reject(e); }      // a synchronous throw counts too
  return call.then(function (r) {
    if (r && r.error) throw r.error;
    var d = r && r.data;
    if (d == null) {
      return { eligible:false, ok:false, code:'rpc_error',
               reason:name + ' returned nothing.' };
    }
    return d;
  }).catch(function (e) {
    var msg = (e && (e.message || e.hint || e.details)) || String(e);
    try { console.error('[patient-lifecycle] ' + name + ' failed', args, e); } catch (x) {}
    return { eligible:false, ok:false, code:'rpc_error', reason:msg };
  });
}

function badKind(kind){
  return { eligible:false, ok:false, code:'invalid_input',
           reason:'Unknown record type "' + kind + '".' };
}
function badId(){
  return { eligible:false, ok:false, code:'invalid_input',
           reason:'No record was identified.' };
}
function guard(kind, id){
  if (KINDS.indexOf(kind) < 0) { try { console.error('[patient-lifecycle] bad kind', kind); } catch(e){} return badKind(kind); }
  if (typeof id !== 'string' || !id.trim()) { try { console.error('[patient-lifecycle] missing id', kind); } catch(e){} return badId(); }
  return null;
}

/* ── Reads ─────────────────────────────────────────────────────────────── */
function eligibility(kind, id, action){
  var bad = guard(kind, id); if (bad) return Promise.resolve(bad);
  return rpc('patient_lifecycle_eligibility', { p_kind:kind, p_id:id, p_action:action });
}

/* One round trip per action, in parallel, so opening a menu costs one wait
   rather than three. */
function eligibilityFor(kind, id, actions){
  return Promise.all(actions.map(function (a) {
    return eligibility(kind, id, a).then(function (e) { return { action:a, elig:e }; });
  })).then(function (list) {
    var map = {};
    list.forEach(function (x) { map[x.action] = x.elig; });
    return map;
  });
}

function purgeEligibility(kind, id){
  var bad = guard(kind, id); if (bad) return Promise.resolve(bad);
  return rpc('patient_purge_eligibility', { p_kind:kind, p_id:id });
}
/* There is deliberately no purgeDependencies() wrapper. The dependency preview
   arrives inside patient_purge_eligibility()'s answer, and the underlying RPC is
   administrator-only and revoked from authenticated — a wrapper here could only
   ever fail, which is a trap rather than an API. */

/* recycle_bin_list() is authorization-positive: a patient or a pending doctor
   receives an empty set rather than an error, so an empty bin is a normal
   answer and never needs a special case here. */
function recycleBin(){
  var client = sb();
  if (!client) return Promise.resolve({ ok:false, code:'rpc_error', rows:[],
                                        reason:'Not connected. Reload the page and try again.' });
  /* Same fault as rpc() above: the throw belongs to the fulfilment handler,
     so it needs .catch() rather than a sibling rejection handler. */
  var call;
  try { call = Promise.resolve(client.rpc('recycle_bin_list')); }
  catch (e) { call = Promise.reject(e); }
  return call.then(function (r) {
    if (r && r.error) throw r.error;
    return { ok:true, code:'eligible', rows:(r && r.data) || [] };
  }).catch(function (e) {
    var msg = (e && e.message) || String(e);
    try { console.error('[patient-lifecycle] recycle_bin_list failed', e); } catch (x) {}
    return { ok:false, code:'rpc_error', rows:[], reason:msg };
  });
}

/* ── Writes ────────────────────────────────────────────────────────────── */
function act(kind, id, action, reason){
  var bad = guard(kind, id); if (bad) return Promise.resolve(bad);
  return rpc('patient_lifecycle_action',
             { p_kind:kind, p_id:id, p_action:action, p_reason:reason || null });
}

function setStarred(kind, id, starred){
  var bad = guard(kind, id); if (bad) return Promise.resolve(bad);
  return rpc('patient_set_starred', { p_kind:kind, p_id:id, p_starred:!!starred });
}

/* The confirmation word is checked here as well as on the server. Not as
   security — the server decides — but so a mistyped confirmation is answered
   instantly instead of by a round trip that reads like a failure. */
function purge(kind, id, confirm){
  var bad = guard(kind, id); if (bad) return Promise.resolve(bad);
  if (confirm !== CONFIRM_WORD) {
    return Promise.resolve({ ok:false, code:'confirmation_required',
                             reason:'Type ' + CONFIRM_WORD + ' to confirm.' });
  }
  return rpc('patient_purge', { p_kind:kind, p_id:id, p_confirm:confirm });
}

/* ── State ─────────────────────────────────────────────────────────────── */
/* Mirrors lifecycle_state(archived_at, deleted_at). Deleted wins over
   archived, because a record can be both and the Recycle Bin is where it is. */
function stateOf(row){
  if (!row) return 'active';
  if (row.deleted_at)  return 'deleted';
  if (row.archived_at) return 'archived';
  return 'active';
}

/* ── The menu, described once ──────────────────────────────────────────────
   Every surface that offers lifecycle actions renders THIS list, so a card, a
   row and the opened patient detail can never drift into offering different
   things. Rendering is the page's job; deciding what exists is not.

   'deleted' returns no ordinary actions at all: a soft-deleted record is not
   reachable from the ordinary workspace, only from the Recycle Bin, which has
   its own list below. */
function menuFor(opts){
  opts = opts || {};
  var state   = opts.state || 'active';
  var starred = !!opts.starred;
  var items   = [];

  if (opts.canOpen !== false) {
    items.push({ key:'open', label:'Open patient', icon:'↗', kind:'open' });
  }
  items.push({ key:'star', label: starred ? 'Remove from Important' : 'Mark as Important',
               icon: starred ? '☆' : '★', kind:'star', starred:starred });

  if (state === 'active') {
    items.push({ key:'archive', label:'Archive', icon:'🗃', kind:'lifecycle',
                 action:ACT.ARCHIVE, needsEligibility:true });
    items.push({ key:'delete', label:'Delete', icon:'🗑', kind:'lifecycle',
                 action:ACT.DELETE, needsEligibility:true, danger:true, needsConfirm:true });
  } else if (state === 'archived') {
    items.push({ key:'restore_archive', label:'Restore from archive', icon:'↺', kind:'lifecycle',
                 action:ACT.RESTORE_ARCHIVE, needsEligibility:true });
    items.push({ key:'delete', label:'Delete', icon:'🗑', kind:'lifecycle',
                 action:ACT.DELETE, needsEligibility:true, danger:true, needsConfirm:true });
  }
  return items;
}

/* The Recycle Bin offers a different pair, and permanent deletion is only ever
   offered when the server has already said it is eligible. */
function binMenuFor(row){
  var items = [{ key:'restore_delete', label:'Restore', icon:'↺', kind:'lifecycle',
                 action:ACT.RESTORE_DELETE, needsEligibility:true }];
  if (row && row.purge_eligible) {
    items.push({ key:'purge', label:'Permanently delete…', icon:'⚠', kind:'purge',
                 danger:true, needsConfirm:true });
  }
  return items;
}

/* The actions a given state needs eligibility for — used to prefetch. */
function actionsForState(state){
  if (state === 'active')   return [ACT.ARCHIVE, ACT.DELETE];
  if (state === 'archived') return [ACT.RESTORE_ARCHIVE, ACT.DELETE];
  if (state === 'deleted')  return [ACT.RESTORE_DELETE];
  return [];
}

/* ── Copy ──────────────────────────────────────────────────────────────────
   The server writes the reason; this only supplies the framing when it has
   nothing better, and never replaces a specific reason with a vague one. */
var TITLES = {
  archive:         'Archive this patient?',
  restore_archive: 'Restore this patient from the archive?',
  'delete':        'Move this patient to the Recycle Bin?',
  restore_delete:  'Restore this patient from the Recycle Bin?'
};
var BODIES = {
  archive:         'The record moves to Archived and leaves your active lists. Every consultation, question, questionnaire, document and note is preserved, and the workflow stage is untouched. You can restore it at any time.',
  restore_archive: 'The patient returns to the active list in the same workflow stage they were in before. Nothing about their clinical status changes.',
  'delete':        'The record leaves your active and archived lists, your counters and your search. Nothing is destroyed — it moves to the Recycle Bin, and it can be restored from there.',
  restore_delete:  'The record leaves the Recycle Bin and returns to the state it was in when it was deleted — active, or archived if it was archived at the time.'
};
var VERBS = {
  archive:'Archive', restore_archive:'Restore', 'delete':'Move to Recycle Bin', restore_delete:'Restore'
};
var DONE = {
  archive:'Patient archived.', restore_archive:'Patient restored.',
  'delete':'Moved to the Recycle Bin.', restore_delete:'Restored from the Recycle Bin.'
};

function confirmCopy(action){
  return { title: TITLES[action] || 'Confirm', body: BODIES[action] || '',
           verb: VERBS[action] || 'Continue', done: DONE[action] || 'Done.',
           danger: action === 'delete' };
}

/* A refusal, phrased for a human, keeping the server's own words when it has
   them. The tone tells the page whether to style it as a block or as a
   neutral "already true".

   ONE CODE IS DIFFERENT, AND THE DISTINCTION IS THE WHOLE POINT.

   Every code except rpc_error carries a sentence an anesthesiologist wrote for
   a clinician: "A consultation request is still open for this patient",
   "This record is already archived", "You are not signed in". Those are the
   answer, and replacing any of them with something vaguer is the bug this
   module was built to end — see the header.

   rpc_error is not that. It is whatever the transport said, and the transport
   says things like

       permission denied for function patient_lifecycle_eligibility

   which is what production showed a doctor when a GRANT drifted. That sentence
   names an internal function, tells the reader nothing they can act on, and
   reads like the product is broken rather than momentarily unreachable. So
   rpc_error — and ONLY rpc_error — gets a human sentence here, while the real
   message travels on as .technical for console.error and stays in the object
   the caller already logged. A missing grant, a dropped function, a network
   failure and RLS refusing at the transport layer are one thing to a doctor:
   try again, and if it persists it is ours to fix. */
var TECHNICAL_FAILURE = 'Could not check this action right now. Please try again.';

function refusal(res, fallback){
  var code = (res && res.code) || 'rpc_error';
  var tone = toneOf(code);
  var raw  = (res && res.reason) || null;

  if (code === 'rpc_error') {
    /* The caller's `fallback` is deliberately IGNORED here. Those strings are
       written for a refusal — "That action was refused.", "Could not change
       this." — and a transport failure is not a refusal. Saying "refused"
       about a missing GRANT tells the doctor a rule stopped them when nothing
       did, which sends them looking for a clinical reason that does not exist. */
    try { if (raw) console.error('[patient-lifecycle] technical failure: ' + raw); } catch (e) {}
    return { code:code, tone:tone, text:TECHNICAL_FAILURE,
             short:TECHNICAL_FAILURE, technical:raw };
  }

  var text = raw || shortOf(code) || fallback || 'That action is not available.';
  return { code:code, tone:tone, text:text, short:shortOf(code) || text, technical:null };
}

/* Turn the purge dependency preview into plain lines. Two lists, because they
   are two different fates: destroyed, and orphaned. */
function dependencyLines(deps){
  var out = [];
  if (!deps) return out;
  (deps.records_to_delete || []).forEach(function (d) {
    out.push({ fate:'destroyed', table:String(d.table).replace('public.',''), rows:d.rows });
  });
  (deps.records_to_detach || []).forEach(function (d) {
    out.push({ fate:'detached', table:String(d.table).replace('public.',''), rows:d.rows });
  });
  return out;
}

global.PatientLifecycle = {
  KINDS: KINDS.slice(),
  ACT: ACT,
  CODES: CODES,
  CONFIRM_WORD: CONFIRM_WORD,
  eligibility: eligibility,
  eligibilityFor: eligibilityFor,
  act: act,
  setStarred: setStarred,
  purgeEligibility: purgeEligibility,
  purge: purge,
  recycleBin: recycleBin,
  stateOf: stateOf,
  menuFor: menuFor,
  binMenuFor: binMenuFor,
  actionsForState: actionsForState,
  confirmCopy: confirmCopy,
  refusal: refusal,
  toneOf: toneOf,
  dependencyLines: dependencyLines
};

})(typeof window !== 'undefined' ? window : this);
