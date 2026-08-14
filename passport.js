/* passport.js — the Health Passport data layer.
 *
 * Every write goes through the same RLS the database enforces; nothing here is
 * a security boundary. The one thing this file does that the database cannot
 * is generate the QR token, because the raw token must never be something the
 * server stored — it is made here, shown once, and only its sha256 is sent.
 */
(function(global){
'use strict';
var HP = {};

/* The URL a scanner opens. Kept in one place so the QR, the preview and the
   public page can never disagree about what a passport link looks like. */
HP.ORIGIN = 'https://anestheo.com';
HP.linkFor = function(token){ return HP.ORIGIN + '/p/' + token; };

/* 256 bits from the platform CSPRNG, base64url, 43 characters.
   Deliberately unrelated to the patient, the passport, the email or anything
   else: it is a key, not an identifier, and nothing about it should be
   derivable from something an attacker already knows. */
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
      is_emergency_visible: item.is_emergency_visible !== false
    };
    if(!row.label) return { error:{ message:'Give the entry a name.' } };
    /* source_type is deliberately not sent. The database decides it, and the
       only thing a patient may create is a patient-reported entry. */
    var r = await sb().from('health_passport_items').insert(row);
    return { error: (r && r.error) || null };
  } catch(e){ return { error:{ message:e.message } }; }
};

HP.updateItem = async function(id, patch){
  try {
    var row = {};
    ['category','label','value_text','severity','is_emergency_visible','priority']
      .forEach(function(k){ if(patch[k] !== undefined) row[k] = patch[k]; });
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
      is_primary: !!c.is_primary });
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

/* Mints a token, sends only its hash, and hands the raw value back to the
   caller ONCE. It is never stored, never logged, and cannot be recovered — if
   the patient loses the card they generate a new one, which is the same
   guarantee as a password nobody can read back to them. */
HP.rotateToken = async function(){
  var token = HP.newToken();
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

/* What the scanner would see, computed from the same rows and the same order
   the resolver uses — so "Preview emergency view" is a promise the server
   keeps, not a mock-up. */
HP.previewOf = function(items){
  return HP.sort((items || []).filter(function(i){ return i.is_emergency_visible; }));
};

global.HP = HP;
})(typeof window !== 'undefined' ? window : this);
