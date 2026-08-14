/* passport.js — the Health Passport data layer.
 *
 * Every write goes through the same RLS the database enforces; nothing here is
 * a security boundary. The one thing this file does that the database cannot
 * is generate the QR token: it is made here from the platform CSPRNG, posted
 * once to be hashed, and only the hash is kept. See HP.newToken for exactly
 * what that does and does not guarantee — the raw value is necessarily seen by
 * the server during rotation and during every scan, and this file does not
 * pretend otherwise.
 */
(function(global){
'use strict';
var HP = {};

/* The URL a scanner opens. The token lives in the FRAGMENT, and that is the
   whole point of the shape.
--
   A fragment is never sent to the server. It is not in the request line, so it
   cannot appear in a Hostinger or LiteSpeed access log, in a proxy log, in a
   CDN log, or in a Referer header on the way to anywhere else. A path or query
   token would be written into an access log the moment anyone scanned the
   card, and access logs are backed up, shipped and read by people who have no
   business holding a key to someone's medical history.
--
   It also needs no server configuration. /p.html is a real file; there is no
   rewrite rule to lose, so a printed card cannot be killed by an .htaccess
   that goes missing in a migration.
--
   Kept in one place so the QR, the preview and the public page can never
   disagree about what a passport link looks like. */
HP.ORIGIN = 'https://anestheo.com';
HP.linkFor = function(token){ return HP.ORIGIN + '/p.html#' + token; };

/* 256 bits from the platform CSPRNG, base64url, exactly 43 characters.
   Deliberately unrelated to the patient, the passport, the email or anything
   else: it is a key, not an identifier, and nothing about it should be
   derivable from something an attacker already knows.
--
   WHAT IS AND IS NOT TRUE ABOUT THIS VALUE, precisely:
     * It is NOT stored in any passport table. Only sha256(token) is, so a dump
       of the whole schema opens nothing.
     * It IS transmitted to the server twice in its life: once to hp_rotate_token
       to be hashed, and once per scan to hp_resolve_passport to be looked up.
       Both are POST request BODIES over TLS, not URLs. It necessarily exists in
       server memory for the duration of those calls.
     * It is NOT in any page request URL, because it lives after the '#'.
     * We do not control what Supabase logs about an RPC call. The honest claim
       is the first three points, not "the raw token is never logged anywhere". */
HP.newToken = function(){
  var b = new Uint8Array(32);
  global.crypto.getRandomValues(b);
  var s = '';
  for(var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return global.btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};

HP.CATEGORIES = [
  { k:'allergy',                label:'Allergy',                critical:true },
  { k:'difficult_airway',       label:'Difficult airway',       critical:true },
  { k:'anticoagulation',        label:'Blood thinner',          critical:true },
  { k:'anesthesia_complication',label:'Anesthesia problem',     critical:true },
  { k:'implanted_device',       label:'Implanted device',       critical:true },
  { k:'medication',             label:'Regular medication' },
  { k:'cardiovascular',         label:'Heart / circulation' },
  { k:'respiratory',            label:'Lungs / breathing' },
  { k:'neurologic',             label:'Brain / nerves' },
  { k:'renal',                  label:'Kidneys' },
  { k:'hepatic',                label:'Liver' },
  { k:'endocrine',              label:'Hormones / diabetes' },
  { k:'hematologic',            label:'Blood' },
  { k:'previous_anesthesia',    label:'Previous anesthesia' },
  { k:'emergency_note',         label:'Note for emergencies',   critical:true },
  { k:'other',                  label:'Something else' }
];
HP.catLabel = function(k){
  var c = HP.CATEGORIES.filter(function(x){ return x.k === k; })[0];
  return c ? c.label : k;
};
HP.isCritical = function(k){
  var c = HP.CATEGORIES.filter(function(x){ return x.k === k; })[0];
  return !!(c && c.critical);
};

HP.SEVERITIES = ['critical','high','moderate','low','info'];

/* The same limits the database enforces. Checked here too so the refusal names
   the field while the patient is still looking at it, rather than arriving as
   a constraint violation. */
HP.MAX_LABEL = 60;
HP.MAX_VALUE = 120;
HP.PUBLIC_WARNING = 'Do not include unrelated medical or personal information. ' +
  'This information may be visible to anyone scanning your QR.';

/* Provenance, in words a person can act on. "Patient reported" is not a
   criticism — it is most of a passport, and it is the honest label. */
HP.PROVENANCE = {
  patient_reported:   { label:'Patient reported',   cls:'pv-pat' },
  document_supported: { label:'Document supported', cls:'pv-doc' },
  clinician_verified: { label:'Clinician verified', cls:'pv-ver' },
  system_derived:     { label:'From an Anestheo record', cls:'pv-sys' }
};
HP.provenance = function(k){
  return HP.PROVENANCE[k] || HP.PROVENANCE.patient_reported;
};

function sb(){ return global.sb; }
async function uid(){ var s = await global.getSession(); return s ? s.user.id : null; }

/* ── reads ─────────────────────────────────────────────────────────────── */
HP.load = async function(){
  var me = await uid();
  if(!me) return { error:{ message:'You are not signed in.' } };
  try {
    var p = await sb().from('health_passports').select('*').eq('patient_id', me).maybeSingle();
    if(p.error) return { error:p.error };
    if(!p.data) return { error:null, passport:null, items:[], contacts:[] };

    var i = await sb().from('health_passport_items').select('*')
              .eq('passport_id', p.data.id).is('deleted_at', null);
    if(i.error) return { error:i.error };
    var c = await sb().from('health_passport_contacts').select('*')
              .eq('passport_id', p.data.id).is('deleted_at', null);
    if(c.error) return { error:c.error };

    return { error:null, passport:p.data,
             items:HP.sort(i.data || []), contacts:c.data || [] };
  } catch(e){ return { error:{ message:e.message } }; }
};

/* Critical categories first, then severity, then what the patient ranked.
   The order the emergency view uses, so the preview cannot lie about it. */
var SEV_RANK = { critical:0, high:1, moderate:2, low:3, info:4 };
var CAT_RANK = { difficult_airway:0, allergy:1, anesthesia_complication:2,
                 anticoagulation:3, implanted_device:4, emergency_note:5 };
HP.sort = function(items){
  return (items || []).slice().sort(function(a, b){
    var ca = CAT_RANK[a.category] == null ? 9 : CAT_RANK[a.category];
    var cb = CAT_RANK[b.category] == null ? 9 : CAT_RANK[b.category];
    if(ca !== cb) return ca - cb;
    var sa = SEV_RANK[a.severity] == null ? 9 : SEV_RANK[a.severity];
    var sbk = SEV_RANK[b.severity] == null ? 9 : SEV_RANK[b.severity];
    if(sa !== sbk) return sa - sbk;
    if(a.priority !== b.priority) return (b.priority || 0) - (a.priority || 0);
    return String(a.label).localeCompare(String(b.label));
  });
};

/* ── writes ────────────────────────────────────────────────────────────── */
HP.create = async function(){
  var me = await uid();
  if(!me) return { error:{ message:'You are not signed in.' } };
  try {
    var r = await sb().from('health_passports').insert({ patient_id: me });
    if(r && r.error) return { error:r.error };
    return await HP.load();
  } catch(e){ return { error:{ message:e.message } }; }
};

HP.addItem = async function(passportId, item){
  try {
    var row = {
      passport_id: passportId,
      category: item.category, label: String(item.label || '').trim(),
      value_text: item.value_text || null, severity: item.severity || null,
      /* Only shared if the caller SAYS so. The add form always passes this
         explicitly — its checkbox is pre-ticked and says what it does — so a
         patient recording an allergy still shares it in one action. But a
         caller that says nothing gets the private default, matching the
         column default, so nothing can become public through a path that
         never asked the question. */
      is_emergency_visible: item.is_emergency_visible === true
    };
    if(!row.label) return { error:{ message:'Give the entry a name.' } };
    var bad = HP.lengthError(row);
    if(bad) return { error:{ message:bad } };
    /* source_type is deliberately not sent. The database decides it, and the
       only thing a patient may create is a patient-reported entry. */
    var r = await sb().from('health_passport_items').insert(row);
    return { error: (r && r.error) || null };
  } catch(e){ return { error:{ message:e.message } }; }
};

HP.lengthError = function(row){
  if(row.label && String(row.label).length > HP.MAX_LABEL)
    return 'Shorten the name to ' + HP.MAX_LABEL + ' characters or fewer.';
  if(row.value_text && String(row.value_text).length > HP.MAX_VALUE)
    return 'Shorten the detail to ' + HP.MAX_VALUE + ' characters or fewer. ' +
           HP.PUBLIC_WARNING;
  return null;
};

HP.updateItem = async function(id, patch){
  try {
    var row = {};
    ['category','label','value_text','severity','is_emergency_visible','priority']
      .forEach(function(k){ if(patch[k] !== undefined) row[k] = patch[k]; });
    var bad = HP.lengthError(row);
    if(bad) return { error:{ message:bad } };
    var r = await sb().from('health_passport_items').update(row).eq('id', id);
    return { error: (r && r.error) || null };
  } catch(e){ return { error:{ message:e.message } }; }
};

HP.removeItem = async function(id){
  try {
    var r = await sb().from('health_passport_items').delete().eq('id', id);
    return { error: (r && r.error) || null };
  } catch(e){ return { error:{ message:e.message } }; }
};

HP.addContact = async function(passportId, c){
  try {
    var r = await sb().from('health_passport_contacts').insert({
      passport_id: passportId, name: String(c.name || '').trim(),
      relationship: c.relationship || null, phone: c.phone || null,
      is_primary: !!c.is_primary,
      /* Default hidden, and never quietly true. A contact's name and phone
         number are somebody ELSE's personal data — the husband did not agree
         to be reachable by anyone who photographs a card. Sharing them is a
         separate, deliberate act. */
      is_emergency_visible: c.is_emergency_visible === true });
    return { error: (r && r.error) || null };
  } catch(e){ return { error:{ message:e.message } }; }
};
HP.updateContact = async function(id, patch){
  try {
    var row = {};
    ['name','relationship','phone','is_primary','is_emergency_visible']
      .forEach(function(k){ if(patch[k] !== undefined) row[k] = patch[k]; });
    var r = await sb().from('health_passport_contacts').update(row).eq('id', id);
    return { error: (r && r.error) || null };
  } catch(e){ return { error:{ message:e.message } }; }
};
HP.setShowName = async function(passportId, on){
  try {
    var r = await sb().from('health_passports')
              .update({ show_name_on_qr: !!on }).eq('id', passportId);
    return { error: (r && r.error) || null };
  } catch(e){ return { error:{ message:e.message } }; }
};
HP.removeContact = async function(id){
  try {
    var r = await sb().from('health_passport_contacts').delete().eq('id', id);
    return { error: (r && r.error) || null };
  } catch(e){ return { error:{ message:e.message } }; }
};

/* ── the QR ────────────────────────────────────────────────────────────── */

/* Mints a token, posts it once to be hashed, and hands the raw value back to
   the caller for as long as the tab is open. Only the hash is kept, so it
   cannot be shown again later or recovered by anyone — if the patient loses
   the card they generate a new one, which is the same guarantee as a password
   nobody can read back to them. */
HP.TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;   // exactly what newToken() produces

HP.rotateToken = async function(){
  var token = HP.newToken();
  if(!HP.TOKEN_RE.test(token))
    return { error:{ message:'Could not generate a secure code. Please try again.' } };
  try {
    var r = await sb().rpc('hp_rotate_token', { p_token: token });
    if(r && r.error) return { error:r.error };
    return { error:null, token:token, link:HP.linkFor(token) };
  } catch(e){ return { error:{ message:e.message } }; }
};

HP.disableToken = async function(){
  try {
    var r = await sb().rpc('hp_disable_token', {});
    return { error: (r && r.error) || null };
  } catch(e){ return { error:{ message:e.message } }; }
};

HP.tokenStatus = async function(){
  try {
    var r = await sb().rpc('hp_token_status', {});
    if(r && r.error) return { error:r.error };
    return { error:null, status: r.data || { active:false } };
  } catch(e){ return { error:{ message:e.message } }; }
};

HP.accessHistory = async function(limit){
  try {
    var r = await sb().rpc('hp_access_history', { p_limit: limit || 20 });
    if(r && r.error) return { error:r.error };
    return { error:null, rows: r.data || [] };
  } catch(e){ return { error:{ message:e.message } }; }
};

/* The public read. The only passport call a signed-out browser may make, and
   it returns a projection rather than rows. */
HP.resolve = async function(token){
  try {
    var r = await sb().rpc('hp_resolve_passport', { p_token: token });
    if(r && r.error) return { error:r.error };
    return { error:null, data: r.data || { found:false } };
  } catch(e){ return { error:{ message:e.message } }; }
};

/* What the scanner would see, computed from the same rows, the same filters
   and the same order the resolver uses — so the consent screen and "Preview"
   are promises the server keeps, not mock-ups. If this and
   hp_resolve_passport ever disagree, the tests fail. */
HP.previewOf = function(items){
  return HP.sort((items || []).filter(function(i){ return i.is_emergency_visible; }));
};
HP.projection = function(D, patientName){
  D = D || {};
  return {
    name: (D.passport && D.passport.show_name_on_qr) ? (patientName || null) : null,
    items: HP.previewOf(D.items),
    contacts: (D.contacts || []).filter(function(c){ return c.is_emergency_visible; })
  };
};

global.HP = HP;
})(typeof window !== 'undefined' ? window : this);
