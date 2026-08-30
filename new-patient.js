/* new-patient.js — THE SHARED NEW PATIENT WORKFLOW
   ═══════════════════════════════════════════════════════════════════════════
   ONE implementation, two hosts. The dashboard patients board and Live Tools
   both open this; neither has a New Patient dialog of its own. That is the
   whole point of the file — a second implementation would drift, and the half
   that drifted would be the half that records a delivery.

   WHAT IT OWNS
     the dialog markup, the form, the insert, the created state, and the three
     ways to hand the questionnaire over (email, WhatsApp, copy link).

   WHAT IT DOES NOT OWN
     re-sending to a patient who already exists. That is the patient card's
     job on the dashboard and it keeps its own path; this file is the CREATE
     workflow, opened from a button, and it ends when the dialog closes.

   WHAT THE HOST SUPPLIES
     NewPatient.open({
       host:     'dashboard' | 'livetools',   // decides the exits offered
       doctorId: uuid,                        // written to clinic_patients
       onCreated(row),                        // after a successful insert
       onUse(row),                            // 'Use this patient' pressed
       onOpen(row),                           // 'Open patient' pressed
       refresh()                              // host reloads its own lists
     })

   SEND SEMANTICS, WHICH ARE THE POINT OF THE CREATED SCREEN
     Creating a patient sends nothing. Opening the dialog sends nothing.
     Displaying the link sends nothing. Copying the link sends nothing.
     questionnaire_status becomes 'sent' only after a delivery actually
     launched: WhatsApp when the window really opened, email when the
     clinician says they sent it. A claim the product cannot observe is not a
     claim the product may make.
*/
(function (root) {
  'use strict';

  var S = null;            /* the open session's options, or null */
  var CREATED = null;      /* the row the insert returned */

  function $(id){ return document.getElementById(id); }
  function esc(s){
    return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c];
    });
  }
  function toast(msg){
    if (root.wsToast) return root.wsToast(msg);
    var n = document.createElement('div');
    n.className = 'np-toast'; n.textContent = msg;
    document.body.appendChild(n);
    setTimeout(function(){ n.classList.add('out'); }, 2200);
    setTimeout(function(){ if (n.parentNode) n.parentNode.removeChild(n); }, 2700);
  }
  function token(){
    var a = new Uint8Array(18);
    (root.crypto || root.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b){ return ('0'+b.toString(16)).slice(-2); }).join('');
  }
  function link(p){ return p && p.token ? (location.origin + '/q.html?t=' + p.token) : ''; }
  function message(p){
    var first = p && p.patient_name ? String(p.patient_name).split(' ')[0] : '';
    return 'Hello ' + first + ',\n\n' +
           'Please complete your pre-operative anesthesia questionnaire before your surgery.\n\n' +
           link(p) + '\n\nThank you.';
  }
  function validEmail(s){
    s = (s == null ? '' : String(s)).trim();
    return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(s) ? s : '';
  }
  function copyText(text, ok){
    function fallback(){
      var t = document.createElement('textarea'); t.value = text;
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); toast(ok); } catch(e){ toast('Copy failed'); }
      document.body.removeChild(t);
    }
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function(){ toast(ok); }, fallback);
    else fallback();
  }

  /* ── THE ONLY WRITE THAT RECORDS A DELIVERY ─────────────────────────────── */
  function markSent(id){
    if (!root.sb) return Promise.resolve();
    return root.sb.from('clinic_patients')
      .update({ questionnaire_status:'sent', sent_at:new Date().toISOString() })
      .eq('id', id)
      .then(null, function (e){ console.warn('mark sent failed:', e && e.message); });
  }

  /* ── THE DIALOG ─────────────────────────────────────────────────────────── */
  function ensureDom(){
    if ($('np-modal')) return;
    var d = document.createElement('div');
    d.id = 'np-modal';
    d.className = 'np-bg';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('aria-labelledby', 'np-title');
    d.innerHTML =
      '<div class="np-box">' +
        '<div class="np-head"><div class="np-title" id="np-title">&#10133; New Patient</div>' +
          '<button type="button" class="np-x" aria-label="Close">&times;</button></div>' +
        '<div class="np-body" id="np-body"></div>' +
      '</div>';
    document.body.appendChild(d);
    d.querySelector('.np-x').addEventListener('click', close);
    d.addEventListener('mousedown', function (e){ d._down = (e.target === d); });
    d.addEventListener('click', function (e){ if (e.target === d && d._down) close(); });
    document.addEventListener('keydown', function (e){
      if (e.key === 'Escape' && d.classList.contains('open')) close();
    });
  }

  function open(opts){
    S = opts || {};
    CREATED = null;
    ensureDom();
    renderForm();
    $('np-modal').classList.add('open');
    var f = $('np-fname'); if (f) f.focus();
  }
  function close(){
    var m = $('np-modal');
    if (m){ m.classList.remove('open'); }
    var b = $('np-body'); if (b) b.innerHTML = '';
    CREATED = null; S = null;
  }

  /* ── FORM ───────────────────────────────────────────────────────────────── */
  function renderForm(){
    var t = $('np-title'); if (t) t.innerHTML = '&#10133; New Patient';
    $('np-body').innerHTML =
      '<div class="np-form" id="np-form">' +
        '<div class="np-sec">Patient</div>' +
        '<div class="np-grid">' +
          '<div><label for="np-fname">First name</label><input id="np-fname" type="text" placeholder="First name"></div>' +
          '<div><label for="np-lname">Last name</label><input id="np-lname" type="text" placeholder="Last name"></div>' +
          /* Age and sex are not asked. clinic_patients has no column for
             either, so the fields would silently discard what was typed, and
             they are questions the questionnaire already puts to the patient,
             who is the one who knows the answers. */
          '<div class="np-full np-note">Age and sex come from the questionnaire the patient ' +
            'completes; they appear on the record once returned.</div>' +
        '</div>' +
        '<div class="np-sec">Surgery</div>' +
        '<div class="np-grid">' +
          '<div class="np-full"><label for="np-proc">Procedure</label><input id="np-proc" type="text" placeholder="e.g. Knee arthroscopy"></div>' +
          '<div><label for="np-date">Surgery date</label><input id="np-date" type="date"></div>' +
          '<div><label for="np-hospital">Hospital</label><input id="np-hospital" type="text" placeholder="Hospital / clinic"></div>' +
        '</div>' +
        '<div class="np-sec">Contact</div>' +
        '<div class="np-grid">' +
          '<div><label for="np-email">Email</label><input id="np-email" type="email" placeholder="patient@email.com">' +
            '<div class="np-hint">Enables the full patient portal. Optional.</div></div>' +
          '<div><label for="np-phone">Mobile / WhatsApp</label><input id="np-phone" type="tel" placeholder="e.g. +995 555 11 22 33">' +
            '<div class="np-hint">Needed to send by WhatsApp. Optional.</div></div>' +
          '<div class="np-full"><label for="np-notes">Notes</label><textarea id="np-notes" placeholder="Optional"></textarea></div>' +
        '</div>' +
      '</div>' +
      '<div class="np-foot">' +
        '<button type="button" class="np-btn" id="np-cancel">Cancel</button>' +
        '<button type="button" class="np-btn np-go" id="np-create">Create patient</button>' +
      '</div>';
    $('np-cancel').onclick = close;
    $('np-create').onclick = create;
  }

  function collect(){
    var v = function (id){ var e = $(id); return e ? e.value.trim() : ''; };
    var name = [v('np-fname'), v('np-lname')].filter(Boolean).join(' ');
    if (!name){ toast('A first or last name is required'); return null; }
    return {
      doctor_id: (S && S.doctorId) || root.__wsUserId || null,
      patient_name: name,
      phone_number: v('np-phone') || null,
      email: v('np-email') || null,
      procedure: v('np-proc') || null,
      hospital: v('np-hospital') || null,
      surgery_date: ($('np-date') && $('np-date').value) || null,
      notes: v('np-notes') || null
    };
  }

  async function create(){
    var rec = collect(); if (!rec) return;
    var btn = $('np-create');
    btn.disabled = true; var orig = btn.textContent; btn.textContent = 'Creating…';
    rec.token = token();
    rec.questionnaire_status = 'not_sent';
    rec.consultation_status  = 'not_arrived';
    rec.patient_status       = 'awaiting_questionnaire';
    try {
      var r = await root.sb.from('clinic_patients').insert(rec).select().maybeSingle();
      if (r.error){
        console.error('Creating the clinic patient failed.', r.error);
        toast('Could not create the patient. Nothing was saved.');
        btn.disabled = false; btn.textContent = orig; return;
      }
      if (r.data){
        /* The canonical record, back-linked, exactly as before. */
        try {
          await root.sb.from('patient_surgeries').insert({
            patient_id:null, assigned_doctor_id:rec.doctor_id, clinic_patient_id:r.data.id,
            patient_name:rec.patient_name, procedure_type:rec.procedure || null,
            surgery_date:rec.surgery_date || null, hospital:rec.hospital || null,
            contact_email:rec.email || null, care_state:'surgical' });
        } catch(e){ console.warn('record create:', e && e.message); }
        CREATED = r.data;
        if (S && S.refresh) { try { await S.refresh(); } catch(e){} }
        if (S && S.onCreated) { try { S.onCreated(r.data); } catch(e){} }
        renderCreated();
      } else {
        close();
      }
    } catch(e){
      console.error('Creating the clinic patient failed unexpectedly.', e);
      toast('Could not create the patient. Nothing was saved.');
    }
    btn.disabled = false; btn.textContent = orig;
  }

  /* ── CREATED ────────────────────────────────────────────────────────────── */
  function renderCreated(){
    var p = CREATED; if (!p) return;
    var host = S;
    var t = $('np-title'); if (t) t.innerHTML = '&#10004; Patient created';
    var mail  = validEmail(p.email);
    var phone = (p.phone_number || '').replace(/[^0-9]/g, '');
    var sent  = p.questionnaire_status === 'sent';
    var liveTools = host && host.host === 'livetools';

    function fact(l, v){
      return '<div class="np-fact"><b>' + l + '</b><span>' + esc(v || 'Not recorded') + '</span></div>';
    }
    $('np-body').innerHTML =
      '<div class="np-form">' +
        '<div class="np-done"><div class="np-tick" aria-hidden="true">&#10004;</div>' +
          '<div><div class="np-done-t">' + esc(p.patient_name) + ' is on your list</div>' +
          '<div class="np-done-s">The record exists and the questionnaire link is live. ' +
          'Nothing has been sent yet.</div></div></div>' +
        '<div class="np-facts">' + fact('Procedure', p.procedure) +
          fact('Surgery date', p.surgery_date) + fact('Hospital', p.hospital) + '</div>' +
        '<div class="np-sec np-sec-flat">Preparation questionnaire</div>' +
        '<div class="np-btns">' +
          (mail  ? '<button type="button" class="np-btn np-go" id="np-email">&#9993;&#65039; Send by Email</button>'
                 : '<button type="button" class="np-btn" id="np-email" disabled title="No valid email address is saved for this patient">&#9993;&#65039; Send by Email</button>') +
          (phone ? '<button type="button" class="np-btn np-go" id="np-wa">&#128241; Send by WhatsApp</button>'
                 : '<button type="button" class="np-btn" id="np-wa" disabled title="No phone number is saved for this patient">&#128241; Send by WhatsApp</button>') +
          '<button type="button" class="np-btn" id="np-copy">&#128279; Copy link</button>' +
        '</div>' +
        '<div class="np-status" id="np-status"><span class="np-dot' + (sent ? ' on' : '') + '"></span>' +
          (sent ? 'Invitation sent' : 'Invitation not sent yet') + '</div>' +
        '<div class="np-rule"></div>' +
        '<div class="np-btns">' +
          (liveTools ? '<button type="button" class="np-btn np-go" id="np-use">Use this patient</button>' : '') +
          '<button type="button" class="np-btn" id="np-open">Open patient</button>' +
          (liveTools ? '' : '<button type="button" class="np-btn" id="np-tools">Open in Live Tools</button>') +
          '<button type="button" class="np-btn" id="np-done">Done</button>' +
        '</div>' +
      '</div>';

    if (mail)  $('np-email').onclick = function (){ emailStep(p, mail); };
    if (phone) $('np-wa').onclick    = function (){ whatsapp(p); };
    $('np-copy').onclick = function (){
      copyText(link(p), 'Link copied');
      /* COPYING IS NOT SENDING. Nobody has received anything and the row is
         untouched; the line says exactly that. */
      var s = $('np-status');
      if (s) s.innerHTML = '<span class="np-dot"></span>Link copied &mdash; not sent yet. ' +
        'The invitation is recorded as sent only when you send it.';
    };
    /* close() clears S and CREATED, so every exit takes what it needs first. */
    if ($('np-use'))
      $('np-use').onclick = function (){ var row = CREATED, h = host; close(); if (h && h.onUse) h.onUse(row); };
    if ($('np-tools'))
      $('np-tools').onclick = function (){ var row = CREATED, h = host; close(); if (h && h.onTools) h.onTools(row); };
    $('np-open').onclick = function (){ var row = CREATED, h = host; close(); if (h && h.onOpen) h.onOpen(row); };
    $('np-done').onclick = close;
  }

  function setStatus(sent){
    var s = $('np-status'); if (!s) return;
    s.innerHTML = '<span class="np-dot' + (sent ? ' on' : '') + '"></span>' +
      (sent ? 'Invitation sent' : 'Invitation not sent yet');
  }

  /* WhatsApp marks sent ONLY if the window really opened. */
  async function whatsapp(p){
    var digits = (p.phone_number || '').replace(/[^0-9]/g, '');
    var url = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(message(p));
    var win = root.open(url, '_blank');
    if (win){
      await markSent(p.id);
      p.questionnaire_status = 'sent';
      setStatus(true);
      toast('WhatsApp opened — status set to Sent');
      if (S && S.refresh) { try { await S.refresh(); } catch(e){} }
    } else {
      toast('Pop-up blocked. Use Copy link, or allow pop-ups and try again.');
    }
  }

  /* Email cannot report back, so it is never assumed. The clinician is shown
     exactly what would be sent, offered their mail app, and only their own
     "I sent it" records the delivery. */
  function emailStep(p, to){
    var subject = 'Your pre-anaesthesia questionnaire';
    var body    = message(p);
    var mailto  = 'mailto:' + to + '?subject=' + encodeURIComponent(subject) +
                  '&body=' + encodeURIComponent(body);
    $('np-body').innerHTML =
      '<div class="np-form">' +
        '<div class="np-sec np-sec-flat">Send by email</div>' +
        '<div class="np-note">Anestheo does not send this for you. Open your mail app, or copy ' +
          'the text and send it however you prefer &mdash; then mark it sent.</div>' +
        '<label for="np-em-to">To</label><input id="np-em-to" readonly value="' + esc(to) + '">' +
        '<label for="np-em-sub">Subject</label><input id="np-em-sub" readonly value="' + esc(subject) + '">' +
        '<label for="np-em-body">Message</label><textarea id="np-em-body" readonly rows="7">' + esc(body) + '</textarea>' +
      '</div>' +
      '<div class="np-foot">' +
        '<a class="np-btn np-go" id="np-em-open" href="' + esc(mailto) + '">Open in email app</a>' +
        '<button type="button" class="np-btn" id="np-em-copy">Copy email text</button>' +
        '<button type="button" class="np-btn np-go" id="np-em-sent">I sent it</button>' +
        '<button type="button" class="np-btn" id="np-em-back">Back</button>' +
      '</div>';
    $('np-em-copy').onclick = function (){
      copyText('To: ' + to + '\nSubject: ' + subject + '\n\n' + body, 'Email text copied');
    };
    $('np-em-back').onclick = renderCreated;
    $('np-em-sent').onclick = async function (){
      await markSent(p.id);
      p.questionnaire_status = 'sent';
      renderCreated();
      toast('Marked as sent');
      if (S && S.refresh) { try { await S.refresh(); } catch(e){} }
    };
  }

  root.NewPatient = {
    open: open,
    close: close,
    /* exposed for tests and for hosts that need the same link/message text */
    _link: link, _message: message, _validEmail: validEmail,
    get created(){ return CREATED; }
  };
})(typeof window !== 'undefined' ? window : this);
