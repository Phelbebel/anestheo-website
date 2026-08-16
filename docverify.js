/* docverify.js — the doctor verification document layer.
 *
 * One definition of what a document is, shared by the two doctor-facing pages
 * and the Admin Center, so "which types are required", "how big is too big"
 * and "where does the file live" cannot drift into three answers.
 *
 * NOTHING HERE IS A SECURITY BOUNDARY. The bucket enforces size and MIME, the
 * storage policies enforce that a doctor only writes inside their own uid, and
 * doctor_missing_documents() decides completeness inside the database where an
 * administrator's browser cannot argue with it. The checks in this file exist
 * so a refusal names the problem while the file picker is still fresh in mind.
 */
(function (global) {
'use strict';
var DV = {};

DV.BUCKET = 'doctor-verification';

/* The two the application cannot be complete without, and the three an
   administrator may ask for afterwards. Kept in the order they are shown. */
DV.TYPES = [
  { k:'passport_id',            label:'Government ID or passport', required:true,
    hint:'A photo page or ID card showing your name and date of birth.' },
  { k:'license',                label:'Medical licence',           required:true,
    hint:'Your registration certificate from your medical council.' },
  { k:'diploma',                label:'Medical diploma' },
  { k:'specialist_certificate', label:'Specialist certificate' },
  { k:'other',                  label:'Other document' }
];
DV.REQUIRED = ['passport_id', 'license'];

DV.label = function (k) {
  for (var i = 0; i < DV.TYPES.length; i++) if (DV.TYPES[i].k === k) return DV.TYPES[i].label;
  return k;
};
DV.hint = function (k) {
  for (var i = 0; i < DV.TYPES.length; i++) if (DV.TYPES[i].k === k) return DV.TYPES[i].hint || '';
  return '';
};

/* The same list the bucket allows. HEIC and HEIF are here because that is what
   an iPhone produces by default, and a doctor photographing their passport on
   a phone should not be told their own camera is unsupported. */
DV.MAX_BYTES = 10 * 1024 * 1024;
DV.MIME = {
  'application/pdf':'pdf', 'image/jpeg':'jpg', 'image/jpg':'jpg',
  'image/png':'png', 'image/heic':'heic', 'image/heif':'heif'
};
DV.EXT = {
  pdf:'application/pdf', jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png',
  heic:'image/heic', heif:'image/heif'
};
DV.ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif';

function sb() { return global.sb; }
async function uid() { var s = await global.getSession(); return s ? s.user.id : null; }

/* Extension and reported type must agree. A browser that reports nothing falls
   back to the extension; a contradiction is refused rather than guessed at. */
DV.checkFile = function (file) {
  if (!file) return 'Choose a file.';
  var ext = String(file.name || '').split('.').pop().toLowerCase();
  var byType = DV.MIME[String(file.type || '').toLowerCase()];
  var byExt  = DV.EXT[ext] ? (ext === 'jpeg' ? 'jpg' : ext) : null;
  if (!byType && !byExt) return 'Use a PDF, JPEG, PNG or HEIC file.';
  if (byType && byExt && byType !== byExt)
    return 'That file’s name and contents disagree. Re-save it and try again.';
  if (file.size > DV.MAX_BYTES) return 'That file is larger than 10 MB. Try a smaller scan.';
  if (file.size === 0) return 'That file is empty.';
  return null;
};

DV.contentType = function (file) {
  var ext = String(file.name || '').split('.').pop().toLowerCase();
  return DV.MIME[String(file.type || '').toLowerCase()] ? file.type
       : (DV.EXT[ext] || 'application/octet-stream');
};

/* <doctor_uid>/<doc_type>/<epoch>_<safe name>. The first segment is what the
   storage policy checks, so it is never anything but the caller's own id. */
DV.pathFor = function (userId, type, fileName) {
  var safe = String(fileName || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  return userId + '/' + type + '/' + Date.now() + '_' + safe;
};

/* ── reads ─────────────────────────────────────────────────────────────── */

/* The caller's own documents. RLS returns an administrator every doctor's, so
   pass a doctorId when reading somebody else's from the Admin Center. */
DV.list = async function (doctorId) {
  try {
    var q = sb().from('doctor_verification_documents').select('*').is('deleted_at', null);
    if (doctorId) q = q.eq('doctor_id', doctorId);
    var r = await q;
    if (r.error) return { error:r.error, docs:[] };
    var docs = (r.data || []).slice().sort(function (a, b) {
      return new Date(b.uploaded_at) - new Date(a.uploaded_at);
    });
    return { error:null, docs:docs };
  } catch (e) { return { error:{ message:e.message }, docs:[] }; }
};

/* What an administrator has asked for and not yet received. The doctor can
   read their own rows; this is the whole reason the table exists — the request
   used to live only in verification_notes, which the doctor cannot read. */
DV.openRequests = async function (doctorId) {
  try {
    var q = sb().from('doctor_verification_requests').select('*').eq('status', 'open');
    if (doctorId) q = q.eq('doctor_id', doctorId);
    var r = await q;
    if (r.error) return { error:r.error, requests:[] };
    return { error:null, requests:r.data || [] };
  } catch (e) { return { error:{ message:e.message }, requests:[] }; }
};

/* Which required types have nothing on file. Mirrors
   doctor_missing_documents() so the page and the database agree — but the
   database is the one that decides. */
DV.missing = function (docs) {
  var have = {};
  (docs || []).forEach(function (d) { if (!d.deleted_at) have[d.doc_type] = true; });
  return DV.REQUIRED.filter(function (t) { return !have[t]; });
};

/* Everything the two doctor pages need, in one call. */
DV.state = async function () {
  var me = await uid();
  if (!me) return { error:{ message:'You are not signed in.' } };
  var d = await DV.list();
  if (d.error) return { error:d.error };
  var q = await DV.openRequests();
  var reqTypes = {};
  (q.requests || []).forEach(function (r) {
    (r.requested_types || []).forEach(function (t) { reqTypes[t] = true; });
  });
  return {
    error:null, userId:me, docs:d.docs,
    missing: DV.missing(d.docs),
    requests: q.requests || [],
    requestedTypes: Object.keys(reqTypes)
  };
};

/* ── writes ────────────────────────────────────────────────────────────── */

/* The file first, then the row. If the object upload fails there is no row
   pointing at nothing; if the row insert fails the orphaned object is removed.
   The account simply stays where it was, which is why the pending page can
   always show an honest "still missing" state. */
DV.upload = async function (type, file) {
  var bad = DV.checkFile(file);
  if (bad) return { error:{ message:bad } };
  var me = await uid();
  if (!me) return { error:{ message:'You are not signed in.' } };

  var path = DV.pathFor(me, type, file.name);
  var ctype = DV.contentType(file);
  try {
    var up = await sb().storage.from(DV.BUCKET).upload(path, file, { upsert:false, contentType:ctype });
    if (up && up.error) return { error:{ message:DV.why(up.error.message) } };

    var ins = await sb().from('doctor_verification_documents').insert({
      doctor_id:me, doc_type:type, file_name:file.name, storage_path:path,
      mime_type:ctype, file_size:file.size, uploaded_by:me });
    if (ins && ins.error) {
      try { await sb().storage.from(DV.BUCKET).remove([path]); } catch (e) {}
      return { error:{ message:DV.why(ins.error.message) } };
    }
    return { error:null, path:path };
  } catch (e) { return { error:{ message:DV.why(e.message) } }; }
};

/* Withdraw a document that has not been reviewed. The row policy and the
   storage policy both refuse a reviewed one, so this can only ever remove
   something nobody has relied on. */
DV.remove = async function (doc) {
  if (!doc || doc.reviewed_at) return { error:{ message:'A reviewed document cannot be removed.' } };
  try {
    var del = await sb().from('doctor_verification_documents').delete().eq('id', doc.id);
    if (del && del.error) return { error:{ message:DV.why(del.error.message) } };
    try { await sb().storage.from(DV.BUCKET).remove([doc.storage_path]); } catch (e) {}
    return { error:null };
  } catch (e) { return { error:{ message:DV.why(e.message) } }; }
};

/* Back into the queue. The server refuses if anything required is missing and
   says which, so the page never has to guess. */
DV.submit = async function () {
  try {
    var r = await sb().rpc('doctor_submit_verification');
    if (r && r.error) return { error:{ message:DV.why(r.error.message) } };
    return { error:null, result:r.data || {} };
  } catch (e) { return { error:{ message:DV.why(e.message) } }; }
};

/* ── admin ─────────────────────────────────────────────────────────────── */

/* Five minutes, minted only when somebody clicks Open. The URL is never put in
   markup, never stored, and never logged: it is handed straight to the new tab
   and forgotten. A link that sits in the DOM is a link that ends up in a
   screenshot or a support ticket. */
DV.SIGNED_SECONDS = 300;
DV.openDocument = async function (storagePath) {
  try {
    var r = await sb().storage.from(DV.BUCKET).createSignedUrl(storagePath, DV.SIGNED_SECONDS);
    if (r && r.error) return { error:{ message:DV.why(r.error.message) } };
    if (!r || !r.data || !r.data.signedUrl) return { error:{ message:'Could not open that document.' } };
    return { error:null, url:r.data.signedUrl };
  } catch (e) { return { error:{ message:DV.why(e.message) } }; }
};

/* Storage and PostgREST each answer in their own vocabulary. Translate what we
   can actually predict; pass anything else through rather than inventing a
   reason for it. */
DV.why = function (m) {
  m = String(m || '');
  if (/Bucket not found/i.test(m))
    return 'Document storage is not switched on for this site yet.';
  if (/row-level security|violates row-level/i.test(m))
    return 'Your account cannot upload documents in its current state. Reload and try again.';
  if (/exceeded|maximum size|too large|Payload too large/i.test(m))
    return 'That file is larger than 10 MB. Try a smaller scan.';
  if (/mime|content type|invalid_mime/i.test(m))
    return 'Use a PDF, JPEG, PNG or HEIC file.';
  if (/already exists|Duplicate/i.test(m))
    return 'A file with that name was just uploaded. Try again.';
  if (/does not exist|42883|42P01/i.test(m))
    return 'Document storage is not switched on for this site yet.';
  return m || 'Something went wrong. Try again.';
};

DV.fsize = function (n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
};

global.DV = DV;
})(typeof window !== 'undefined' ? window : this);
