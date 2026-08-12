/* clinical-open.js — the one way Anestheo opens a clinical record.

   Anestheo stores a patient across three DIFFERENT id spaces, and every dead
   control we have shipped came from a screen quietly mixing them up:

     journey         -> patient_surgeries.id   (the clinical journey)
     clinic_patient  -> clinic_patients.id     (a doctor-created patient)
     patient_account -> auth.users.id          (a real patient login)

   All three are uuids, so they are INDISTINGUISHABLE by inspection. This module
   therefore never guesses. The kind is always passed in explicitly by the code
   that already knows which table the row came from.

   Deliberately NOT how this file decides anything:
     - not from the shape or format of the id
     - not by querying one table and falling back to another when it is empty
     - not from a display name, label, or badge
     - not from "the first query returned zero rows, so it must be the other kind"

   A caller either knows the kind or has no business opening the record.

   Outcomes are explicit and exhaustive — every call resolves to one of:
     opened        the record is open (lifecycle 'active' or 'archived')
     unavailable   missing, soft-deleted, or hidden by a deleted parent
     invalid_kind  the caller passed a kind this module does not serve
     missing_id    no identifier was supplied (no control should have existed)
     error         the read itself failed; the user may retry

   The host page supplies the presenters — this module owns WHICH record and
   WHETHER it may be shown; the page owns what that looks like on screen. */
(function (global) {
'use strict';

/* ── The two clinical record kinds, and their one source of truth each ────── */
var SOURCE = {
  journey: {
    table:   'patient_surgeries',
    visible: 'journey_visible',            // v4 lifecycle predicate (parent-aware)
    arg:     'p_surgery_id',
    label:   'journey'
  },
  clinic_patient: {
    table:   'clinic_patients',
    visible: 'clinic_patient_visible',
    arg:     'p_clinic_patient_id',
    label:   'clinic patient'
  }
};

/* patient_account is a THIRD id space and is handled by its own opener below.
   It is listed here only so a render helper can accept all three refs. */
var REF_KINDS = ['journey', 'clinic_patient', 'patient_account'];

/* One place for the words, so five screens cannot invent five phrasings. */
var COPY = {
  unavailable:  'This record is no longer available.',
  invalid_kind: 'Anestheo does not know how to open this record.',
  missing_id:   'This record has no identifier, so it cannot be opened.',
  error:        'Anestheo could not open this record. Please try again.',
  archived:     'This patient is archived. Nothing has been deleted — restore them to return to your active list.'
};

var handlers = {};   // kind -> function(ctx)
var onFailure = null;  // function(outcome)
var beforeOpen = null;  // function(ref) — host-side bookkeeping (e.g. mark seen)
var resolveAccount = null;  // function(authUserId) -> ref | Promise<ref>

function sb(){ return global.sb || null; }

function isClinicalKind(kind){ return Object.prototype.hasOwnProperty.call(SOURCE, kind); }

/* An id is present or it is not. There is no format test here on purpose: a
   uuid that "looks right" tells us nothing about which table it belongs to. */
function hasId(id){ return typeof id === 'string' && id.trim() !== ''; }

function result(outcome, kind, id, extra){
  var o = { ok: outcome === 'opened', outcome: outcome, kind: kind || null, id: id || null,
            message: outcome === 'opened' ? null : (COPY[outcome] || COPY.error) };
  if (extra) { for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) o[k] = extra[k]; }
  return o;
}

/* silent suppresses only the USER-facing notice, never the diagnostic. A nested
   open (a clinic patient following its journey) uses it so the doctor is not
   told "no longer available" a moment before a record does open. */
function fail(outcome, kind, id, cause, silent){
  var o = result(outcome, kind, id, cause ? { cause: cause } : null);
  if (outcome === 'invalid_kind' || outcome === 'missing_id' || outcome === 'error') {
    try { console.error('[clinical-open] ' + outcome, { kind: kind, id: id, cause: cause || null }); } catch (e) {}
  }
  if (!silent && typeof onFailure === 'function') { try { onFailure(o); } catch (e) {} }
  return o;
}

/* ── The canonical opener ──────────────────────────────────────────────────
   openClinicalRecord({ kind: 'journey', id: '…' })
   openClinicalRecord({ kind: 'clinic_patient', id: '…' })                   */
function openClinicalRecord(ref, opts){
  var kind = ref && ref.kind, id = ref && ref.id;
  var silent = !!(opts && opts.silent);

  if (!isClinicalKind(kind)) return Promise.resolve(fail('invalid_kind', kind, id, null, silent));
  if (!hasId(id))            return Promise.resolve(fail('missing_id', kind, id, null, silent));
  if (!sb())                 return Promise.resolve(fail('error', kind, id, 'no supabase client', silent));

  var src = SOURCE[kind];

  /* The read is RLS-scoped, so "no row" already means "not yours or not there".
     We never widen this with a second lookup in the other table. */
  return Promise.resolve(sb().from(src.table).select('*').eq('id', id).maybeSingle())
    .then(function (r) {
      if (r && r.error) throw r.error;
      return (r && r.data) || null;
    })
    .then(function (row) {
      if (!row) return fail('unavailable', kind, id, null, silent);
      // Soft-deleted records are never exposed in the ordinary workspace. They
      // are reachable only from the Recycle Bin, which uses its own RPC.
      if (row.deleted_at) return fail('unavailable', kind, id, null, silent);

      return visibleOnServer(src, id).then(function (visible) {
        // Parent-aware: a journey whose clinic patient was deleted is not
        // visible even though its own deleted_at is null.
        if (visible === false) return fail('unavailable', kind, id, null, silent);

        var lifecycle = row.archived_at ? 'archived' : 'active';
        var ctx = { kind: kind, id: id, row: row, lifecycle: lifecycle,
                    archived: lifecycle === 'archived',
                    archivedNotice: lifecycle === 'archived' ? COPY.archived : null };

        var present = handlers[kind];
        if (typeof present !== 'function') return fail('error', kind, id, 'no presenter for ' + kind, silent);

        return Promise.resolve(present(ctx)).then(function () {
          return result('opened', kind, id, { lifecycle: lifecycle, row: row });
        }, function (e) {
          return fail('error', kind, id, e, silent);
        });
      });
    }, function (e) {
      return fail('error', kind, id, e, silent);
    });
}

/* The v4 predicate is authoritative when it is installed. Before that migration
   is applied the function does not exist; we then fall back to the row's own
   deleted_at, which we have already tested. This can only ever be MORE
   permissive than the predicate — never less — so it cannot hide a record the
   server would show, and it cannot show one the row itself marks deleted. */
function visibleOnServer(src, id){
  var arg = {}; arg[src.arg] = id;
  return Promise.resolve(sb().rpc(src.visible, arg)).then(function (v) {
    if (v && v.error) throw v.error;
    return v && typeof v.data === 'boolean' ? v.data : null;
  }, function (e) {
    try { console.warn('[clinical-open] ' + src.visible + ' unavailable; using row deleted_at', e); } catch (x) {}
    return null;
  });
}

/* ── The patient-account opener (auth.users id space) ──────────────────────
   A patient login is NOT a clinical record and its id is NOT interchangeable
   with a journey id. This opener never queries patient_surgeries by that id.
   It asks the host to resolve the account to a clinical ref it already knows
   about, and then re-enters the canonical opener with an explicit kind. */
function openPatientAccount(ref){
  var id = ref && ref.id;
  if (!hasId(id)) return Promise.resolve(fail('missing_id', 'patient_account', id));
  if (typeof resolveAccount !== 'function') {
    return Promise.resolve(fail('error', 'patient_account', id, 'no account resolver registered'));
  }
  return Promise.resolve(resolveAccount(id)).then(function (target) {
    if (!target || !isClinicalKind(target.kind) || !hasId(target.id)) {
      return fail('unavailable', 'patient_account', id);
    }
    return openClinicalRecord(target);
  }, function (e) {
    return fail('error', 'patient_account', id, e);
  });
}

/* One dispatcher so a rendered row can carry a single {kind, id} pair without
   the render code re-deciding which identity space it is in. */
function openRecordRef(ref){
  var kind = ref && ref.kind;
  if (typeof beforeOpen === 'function') { try { beforeOpen(ref); } catch (e) {} }
  if (kind === 'patient_account') return openPatientAccount(ref);
  return openClinicalRecord(ref);
}

/* ── Rendering guard ───────────────────────────────────────────────────────
   A row with no usable {kind, id} must render NO interactive control at all.
   Silently rendering a button that does nothing is the exact defect this whole
   module exists to remove, so the check lives here and every screen shares it. */
function isOpenable(ref){
  var kind = ref && ref.kind, id = ref && ref.id;
  if (REF_KINDS.indexOf(kind) < 0) return false;
  if (!hasId(id)) return false;
  // Injection safety for inline handlers only. This is NOT a type test: both
  // clinical kinds and the account kind all use uuids and all pass identically.
  return /^[A-Za-z0-9_-]+$/.test(id);
}

/* Returns an onclick attribute, or '' when there is nothing safe to open. */
function refAttr(ref, extra){
  if (!isOpenable(ref)) return '';
  return ' onclick="' + (extra || '') + 'coOpen(\'' + ref.kind + '\',\'' + ref.id + '\')"';
}

function registerPresenters(map){
  map = map || {};
  ['journey', 'clinic_patient'].forEach(function (k) {
    if (typeof map[k] === 'function') handlers[k] = map[k];
  });
  if (typeof map.onFailure === 'function') onFailure = map.onFailure;
  if (typeof map.beforeOpen === 'function') beforeOpen = map.beforeOpen;
  if (typeof map.resolvePatientAccount === 'function') resolveAccount = map.resolvePatientAccount;
}

global.ClinicalOpen = {
  KINDS: REF_KINDS.slice(),
  CLINICAL_KINDS: ['journey', 'clinic_patient'],
  COPY: COPY,
  open: openRecordRef,
  openClinicalRecord: openClinicalRecord,
  openPatientAccount: openPatientAccount,
  isOpenable: isOpenable,
  refAttr: refAttr,
  registerPresenters: registerPresenters
};
global.openClinicalRecord = openClinicalRecord;
/* Short alias used by inline handlers in rendered rows. */
global.coOpen = function (kind, id) { return openRecordRef({ kind: kind, id: id }); };

})(typeof window !== 'undefined' ? window : this);
