/* induction.js — THE INDUCTION WORKSTATION
   ═══════════════════════════════════════════════════════════════════════════
   The first screen: what a clinician needs in the minutes before they induce
   and intubate. It answers, in order —

     who is my patient        (the case bar above this)
     what am I giving         (the induction plan — route, technique, agents)
     what airway am I planning
     what is my backup
     what if it goes wrong    (the Crisis rail beside this)

   ── THE PLAN IS THE PAGE ──────────────────────────────────────────────────
   An earlier revision asked for a strategy, then a scroll past a catalogue of
   every agent, then a technique, then a blocker — five numbered sections in
   the implementation's order rather than the case's. The question this screen
   exists to answer is "what am I actually giving", and it is answered in one
   block: a compact technique control, then one row per clinical role, each
   holding the agents the clinician put in it with their doses for this
   patient, each editable where it stands.

   A ROLE MAY HOLD MORE THAN ONE AGENT. Midazolam and propofol, or fentanyl
   and remifentanil, are an ordinary plan; a workstation that forbids them is
   wrong about anaesthesia rather than opinionated about UI.

   ── THIS FILE COMPOSES. IT DOES NOT DECIDE. ───────────────────────────────
   Every drug, dose, unit, weight basis, preparation and warning comes from
   ClinicalContent.visibleDrugsInGroup(), which is the same call the drug
   table makes, through the same renderDose() weight scaling. Every airway
   value comes from window.airwayPlan, which compute() fills from the same
   variables it renders the Airway panel with.

   There is no second dose table here, and there is no arithmetic. If a number
   on this screen is wrong, it is wrong in clinical-index.js or in compute(),
   and it is wrong identically everywhere else it appears.

   ── TECHNIQUE RECORDS; IT DOES NOT PRESCRIBE ──────────────────────────────
   It adds no drug, removes none, and alters no dose by any amount. Nothing is
   selected by default and nothing is labelled recommended or preferred,
   because this application holds no data supporting such a recommendation —
   the clinician chooses.

   There is no route control. It duplicated what the selected agents already
   express, and contradicted itself the moment a plan held both a volatile and
   an intravenous agent.

   Technique is never bound to a blocker. Classic and Modified RSI describe
   how the airway is secured; either can be performed with either blocker, and
   this application holds no technique-specific dose to say otherwise.
*/
(function (root) {
  'use strict';

  /* NO ROUTE CONTROL. It duplicated what the selected agents already express,
     and it became a contradiction the moment a plan held both a volatile and
     an intravenous agent — which is an ordinary plan. The state it used is
     gone with it rather than left dangling; nothing derives a route from the
     selection, because that would be a recommendation in disguise. */

  /* RSI TECHNIQUE IS NOT A DRUG. This application holds no technique-specific
     dose, no preoxygenation time, no cricoid-pressure guidance and no
     apnoeic-oxygenation protocol, so this records what the clinician is doing
     and asserts nothing about it. It must never be wired to a blocker: a
     blocker's dose is defined once, by the drug, for the indication the drug
     data names — and "Classic RSI" is not the name of a drug. */
  var TECHNIQUES = [
    { id:'standard', label:'Standard induction / intubation', short:'Standard' },
    { id:'classic',  label:'Classic RSI',                     short:'Classic RSI' },
    { id:'modified', label:'Modified RSI',                    short:'Modified RSI' }
  ];

  /* null until the clinician picks one. Not a default: an unrecorded
     technique is a real state, and this application has no basis for
     guessing which one is in use. */
  var technique = null;

  /* THE PLAN IS WHAT WAS CHOSEN, AND NOTHING ELSE.
     Keyed by ROLE now rather than by drug: an induction plan has an induction
     agent, an opioid and a blocker, and choosing a second induction agent
     means changing the first rather than giving both. That is what the
     "Change" affordance means, and it is why selecting is a replace and not a
     toggle. Removing is explicit and has its own control.

     The plan survives a weight change — the doses re-render, the choices do
     not — and New Case clears it with the case it belonged to. */
  /* ROLES COME FROM THE CANONICAL GROUPS, in the data's own words. There is
     no "adjuncts" row because no adjunct group carries a published dose;
     inventing one to match a picture is exactly what this file does not do. */
  var ROLES = [
    { key:'induction', group:'induction', label:'Induction and sedation' },
    { key:'analgesia', group:'analgesia', label:'Opioids and analgesia' },
    { key:'nmb',       group:'nmb',       label:'Neuromuscular blockade' }
  ];
  /* role -> ARRAY of explicitly selected drug ids.

     A ROLE MAY HOLD MORE THAN ONE AGENT. An earlier revision made selection a
     replace, so choosing a second opioid silently removed the first. That is
     not a clinical model, it is a widget: a plan legitimately carries
     midazolam and propofol, or fentanyl and remifentanil, and a workstation
     that forbids it is wrong about anaesthesia rather than opinionated about
     UI. Adding is adding; removal is always explicit and per agent. */
  var picked = {};        /* role -> [drug id, ...] */
  var openRole = null;    /* which role's alternatives are revealed */

  function idsFor(key){ return picked[key] || []; }
  function hasDrug(key, id){ return idsFor(key).indexOf(id) >= 0; }

  function pickedList(){
    var out = [];
    ROLES.forEach(function (r){
      var ids = idsFor(r.key); if (!ids.length) return;
      drugs(r.group).forEach(function (d){ if (ids.indexOf(d.id) >= 0) out.push(d); });
    });
    return out;
  }

  function $(id){ return document.getElementById(id); }
  function esc(s){
    return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c];
    });
  }
  function ctx(){ return root.patientContext || null; }
  function weight(){ var c = ctx(); return c && c.anthropometrics ? c.anthropometrics.weight : null; }

  function drugs(groupId){
    var CC = root.ClinicalContent;
    if (!CC || !CC.visibleDrugsInGroup) return [];
    try { return CC.visibleDrugsInGroup(groupId, weight()) || []; }
    catch(e){ console.warn('[induction] group ' + groupId + ' unavailable', e); return []; }
  }
  function classColour(pclass){
    var CC = root.ClinicalContent;
    var m = (CC && CC.classMeta) ? CC.classMeta(pclass) : null;
    return m ? m.color : 'transparent';
  }

  /* THE PLAN'S CARDS ARE THE PLAN'S OWN. The general-purpose selectable card
     that fed the old "Available agents" catalogue is gone with it: the plan
     builds its role rows and the reference builds its rows, and neither is a
     variant of the other. Two card builders where one is unreachable is how a
     dose ends up rendered by the wrong one.
     ------------------------------------------------------------------- */
  /* The reference section is a reference: it lists, it does not build a plan.
     Rendering the same interactive card there would offer two places to
     select the same drug and no reason to prefer either. */
  function refCard(d){
    var col = classColour(d.pclass);
    var amount = (d.val != null && d.val !== '')
      ? d.val + (d.unit ? '<span class="idc-u">' + d.unit + '</span>' : '') : '';
    var rule = d.doseNum
      ? d.doseNum + (d.doseUnit ? ' <span class="idc-u">' + d.doseUnit + '</span>' : '')
      : (d.doseRule || '');
    var same = amount && d.doseRule && d.doseRule.indexOf(String(d.val)) === 0;
    return '<div class="idc idc-ref" style="--pc:' + col + '">' +
      '<div class="idc-top">' + (d.badge || '') +
        (d.use ? '<span class="idc-route">' + esc(d.use) + '</span>' : '') + '</div>' +
      '<div class="idc-name">' + esc(d.name) + '</div>' +
      (d.aliasLine ? '<div class="idc-alias">' + esc(d.aliasLine) + '</div>' : '') +
      '<div class="idc-dose">' +
        (rule ? '<div class="idc-rule">' + rule + '</div>' : '') +
        ((amount && !same) ? '<div class="idc-amt">' + amount + '</div>' : '') +
      '</div>' +
      (d.prepMain ? '<div class="idc-prep">' + d.prepMain + '</div>' : '') +
      (d.warn ? '<div class="idc-warn' + (d.severity === 'critical' ? ' crit' : '') + '">' +
                '<span aria-hidden="true">&#9888;</span> ' + d.warn + '</div>' : '') +
    '</div>';
  }

  function section(n, title, sub, body, extraClass){
    return '<section class="wf-sec ' + (extraClass || '') + '">' +
      '<div class="wf-h">' + (n === '' ? '' : '<span class="wf-n">' + n + '</span>') +
      '<span class="wf-t">' + title + '</span>' +
      (sub ? '<span class="wf-sub">' + sub + '</span>' : '') + '</div>' +
      body + '</section>';
  }

  /* ── 1 · THE INDUCTION PLAN ──────────────────────────────────────────
     THE COCKPIT. Nine numbered sections asked the clinician to choose a
     strategy, scroll past a catalogue, build a plan, then scroll further to
     choose a technique and a blocker — the implementation's order, not the
     case's. The question this screen exists to answer is "what am I actually
     giving", and it is now answered in one block, at the top, editable in
     place.

     Route and technique are compact controls on the plan, not sections of
     their own: a control whose only effect is emphasis must not look like a
     major decision, and a control that records a technique must not look
     like it changed a dose.

     ROLES COME FROM THE CANONICAL GROUPS, in the data's own words. There is
     no "adjuncts" row because there is no adjunct group carrying a published
     dose; inventing one to match a picture is exactly what this file does
     not do. */
  /* declared above, beside the state it keys */
  /* Shown only on the inhalational route, and only ever to say the truth
     about it: no volatile agent in this application carries a reviewed dose. */
  var VOLATILE = { key:'volatile', group:'volatile', label:'Volatile agent' };

  /* Every agent the clinician put in this role, in the group's own order. */
  function roleDrugs(r){
    var ids = idsFor(r.key);
    if (!ids.length) return [];
    return drugs(r.group).filter(function (d){ return ids.indexOf(d.id) >= 0; });
  }

  /* ── the compact plan controls ─────────────────────────────────────── */
  function seg(name, opts, current, fn){
    return '<div class="pl-seg"><span class="pl-seg-l">' + name + '</span>' +
      '<div class="pl-seg-r" role="group" aria-label="' + name + '">' +
      opts.map(function (o){
        var on = current === o.id;
        return '<button type="button" class="pl-sg' + (on ? ' on' : '') + '" ' +
          'aria-pressed="' + (on ? 'true' : 'false') + '" ' +
          'onclick="' + fn + '(\'' + o.id + '\')">' + o.label + '</button>';
      }).join('') + '</div></div>';
  }

  /* ── one role row ──────────────────────────────────────────────────
     A DENSE GRID OF SELECTED AGENTS, not a stack of full-width rows. Three
     agents in a plan filled three screens' worth of vertical space and pushed
     the airway plan off the page; they sit side by side now, each card
     carrying only what is scanned: what it is, the rule it comes from, the
     amount for this patient, how it is presented, and what will hurt. */
  function agentCard(r, d){
    var col = classColour(d.pclass);
    var amount = (d.val != null && d.val !== '')
      ? d.val + (d.unit ? '<span class="idc-u">' + d.unit + '</span>' : '') : '';
    var rule = d.doseNum
      ? d.doseNum + (d.doseUnit ? ' <span class="idc-u">' + d.doseUnit + '</span>' : '')
      : (d.doseRule || '');
    var same = amount && d.doseRule && d.doseRule.indexOf(String(d.val)) === 0;
    return '<div class="pl-sel" style="--pc:' + col + '" data-role="' + r.key + '" ' +
        'data-drug="' + esc(d.id) + '">' +
      '<div class="pl-sel-top">' + (d.badge || '') +
        (d.use ? '<span class="pl-sel-use">' + esc(d.use) + '</span>' : '') +
        '<button type="button" class="pl-x" aria-label="Remove ' + esc(d.name) +
        ' from the plan" onclick="Induction.remove(\'' + r.key + '\',\'' + esc(d.id) + '\')">' +
        '&times;</button>' +
      '</div>' +
      '<div class="pl-sel-n">' + esc(d.name) + '</div>' +
      '<div class="pl-sel-d">' +
        (rule ? '<span class="pl-rule">' + rule + '</span>' : '') +
        ((amount && !same) ? '<span class="pl-amt">' + amount + '</span>' : '') +
      '</div>' +
      (d.prepMain ? '<div class="pl-prep">' + d.prepMain + '</div>' : '') +
      (d.warn ? '<div class="idc-warn' + (d.severity === 'critical' ? ' crit' : '') + '">' +
                '<span aria-hidden="true">&#9888;</span> ' + d.warn + '</div>' : '') +
    '</div>';
  }

  function roleRow(r){
    var sel = roleDrugs(r);
    var open = openRole === r.key;
    var list = drugs(r.group);

    var head =
      '<div class="pl-rh">' +
        '<span class="pl-rl">' + esc(r.label) + '</span>' +
        (sel.length ? '<span class="pl-rn">' + sel.length + '</span>'
                    : (list.length ? '<span class="pl-rs">None selected</span>' : '')) +
        (list.length
          ? '<button type="button" class="pl-rb' + (open ? ' on' : '') + '" ' +
            'aria-expanded="' + (open ? 'true' : 'false') + '" ' +
            'onclick="Induction.openRole(\'' + r.key + '\')">' +
            (open ? 'Close' : '+ Add agent') + '</button>'
          : '') +
      '</div>';

    var body = sel.length
      ? '<div class="pl-cards">' + sel.map(function (d){ return agentCard(r, d); }).join('') + '</div>'
      : (list.length ? '' : '<div class="pl-none">No agent in this group carries a ' +
                            'reviewed dose yet.</div>');

    /* THE ALTERNATIVES OPEN UNDER THE ROLE THEY BELONG TO. Adding one does
       not remove another: every agent already in the plan is marked, and
       pressing a marked one takes it out again. */
    var alts = '';
    if (open && list.length){
      alts = '<div class="pl-alts" role="group" aria-label="' + esc(r.label) + ' agents">' +
        list.map(function (a){
          var on = hasDrug(r.key, a.id);
          var av = (a.val != null && a.val !== '')
            ? a.val + (a.unit ? '<span class="idc-u">' + a.unit + '</span>' : '') : '';
          return '<button type="button" class="pl-alt' + (on ? ' on' : '') + '" ' +
            'aria-pressed="' + (on ? 'true' : 'false') + '" data-alt="' + esc(a.id) + '" ' +
            'onclick="Induction.toggle(\'' + r.key + '\',\'' + esc(a.id) + '\')">' +
            '<span class="pl-alt-top">' + (a.badge || '') +
              '<span class="pl-alt-tick" aria-hidden="true">' + (on ? '&#10003;' : '+') +
              '</span></span>' +
            '<span class="pl-alt-n">' + esc(a.name) + '</span>' +
            '<span class="pl-alt-d">' + (a.doseNum ? a.doseNum + ' ' + (a.doseUnit || '') : (a.doseRule || '')) +
              (av ? '<b>' + av + '</b>' : '') + '</span>' +
          '</button>';
        }).join('') + '</div>';
    }
    /* PLAN FIRST, THEN THE MENU. The alternatives rendered above the chosen
       agents, so opening the list pushed the plan down and the thing being
       built appeared below the things not chosen. */
    return '<div class="pl-role' + (sel.length ? ' has' : '') + (open ? ' open' : '') +
           '" data-role="' + r.key + '">' + head + body + alts + '</div>';
  }

  /* ── THE PLAN ────────────────────────────────────────────────────────
     NO PRIMARY ROUTE CONTROL. It duplicated what the selected agents already
     say and became a contradiction the moment a plan held both a volatile and
     an intravenous agent — which is an ordinary plan. Technique stays,
     because it records something the agents cannot express, and it stays
     small, because it changes nothing on the screen. */
  function planSection(){
    var n = ROLES.reduce(function (a, r){ return a + roleDrugs(r).length; }, 0);
    var tq = TECHNIQUES.filter(function (x){ return x.id === technique; })[0];

    var tech = '<div class="pl-tech">' +
      '<span class="pl-tech-l">Technique</span>' +
      '<div class="pl-tech-r" role="group" aria-label="Technique">' +
      TECHNIQUES.map(function (t){
        var on = technique === t.id;
        return '<button type="button" class="pl-sg' + (on ? ' on' : '') + '" ' +
          'aria-pressed="' + (on ? 'true' : 'false') + '" ' +
          'onclick="Induction.setTechnique(\'' + t.id + '\')">' + t.short + '</button>';
      }).join('') + '</div>' +
      '<span class="pl-tech-n">Records the plan &middot; changes no dose</span>' +
      '</div>';

    return section(1, 'Induction plan',
      n ? (n + (n === 1 ? ' agent' : ' agents')) : 'Nothing selected',
      tech + '<div class="pl-roles">' + ROLES.map(roleRow).join('') + '</div>');
  }

  /* ── 2 · AIRWAY PLAN ─────────────────────────────────────────────────
     DEVICE ICONS, DRAWN. These were emoji: a surgical mask for the face
     mask, a microscope for the laryngoscope, a spool of thread for the ETT,
     a droplet for the LMA. They rendered differently on every platform and
     none of them was the object it stood for.

     These are the devices, in outline, at 22px. They are decoration in the
     accessibility sense — every tile still states its device in text, and
     the icons carry aria-hidden — but the point of this section is to be
     read in a hurry, and a shape is read faster than a word. */
  var SVG = {};
  (function(){
    function ic(d, extra){
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
        'aria-hidden="true">' + d + (extra || '') + '</svg>';
    }
    /* an anatomical face mask: cushion outline with the connector on top */
    SVG.mask = ic('<path d="M5 10c0-3 3-5 7-5s7 2 7 5c0 4-3 8-7 8s-7-4-7-8z"/>' +
                  '<path d="M9.5 5.2V3.2h5v2"/><path d="M5.4 11.5 3 12.6M18.6 11.5 21 12.6"/>');
    /* a laryngoscope: handle plus a curved Macintosh blade */
    SVG.blade = ic('<path d="M6 3.2h3.6v7.2H6z"/><path d="M9.6 6.8h3.2c4 0 6.8 3 7 7.6"/>' +
                   '<path d="M12.8 9.4c2.6.3 4.4 2.3 4.8 5"/>');
    /* an endotracheal tube: curved shaft, pilot balloon, bevelled tip */
    SVG.ett = ic('<path d="M7 3v7c0 5 2.5 8.6 7.5 11"/><path d="M10.2 3v7c0 4 2 7 6.3 9.2"/>' +
                 '<circle cx="4.6" cy="13.4" r="1.9"/><path d="M6.2 12.4 8 10.4"/>');
    /* a supraglottic airway: shaft into an inflatable elliptical cuff */
    SVG.lma = ic('<path d="M8 3v5.5"/><ellipse cx="8" cy="14.5" rx="3.4" ry="6"/>' +
                 '<path d="M11.4 12.2h4.2c2.2 0 3.4 1.2 3.4 3"/>');
    /* an i-gel: the same family, solid non-inflating bowl — deliberately a
       different silhouette, because they are sized on different scales */
    SVG.igel = ic('<path d="M9 3v5"/><path d="M5.6 13.4c0-3 1.5-5.4 3.4-5.4s3.4 2.4 3.4 5.4' +
                  'c0 4-1.6 7-3.4 7s-3.4-3-3.4-7z"/><path d="M12.4 11h4c2 0 3.2 1.1 3.2 2.8"/>');
    /* an oropharyngeal airway: flange, bite block, curved body */
    SVG.opa = ic('<path d="M4 6.4v5.2"/><path d="M4 9h3.4"/>' +
                 '<path d="M7.4 6.6h2.8v4.8H7.4z"/><path d="M10.2 9h2.6c4 0 6.6 2.6 6.6 6.4"/>');
    /* a nasopharyngeal airway: soft tube with a flared trumpet */
    SVG.npa = ic('<path d="M4.4 7.2 7 9l-2.6 1.8z"/>' +
                 '<path d="M7 9h5.6c3.6 0 6 2.4 6 6.2"/><path d="M18.6 15.2v3"/>');
    /* a Yankauer: rigid angled tip and the suction line */
    SVG.suction = ic('<path d="M4 19.4c3.4 0 5.8-1.4 7.4-4"/>' +
                     '<path d="M11.4 15.4 15 9.2a2.6 2.6 0 0 1 4.5 2.6L16 18"/>' +
                     '<path d="M13.2 7.6 17.7 10"/>');
    /* a ruler: depth is a measurement, not a device */
    SVG.depth = ic('<rect x="2.6" y="8.4" width="18.8" height="7.2" rx="1.4"/>' +
                   '<path d="M7 8.4v3M11 8.4v4.4M15 8.4v3M19 8.4v4.4"/>');
  })();

  function airwaySection(){
    var A = root.airwayPlan;
    if (!A) return '';
    function item(icon, label, value, unit){
      if (value == null || value === '') return '';
      /* A phrase set at 21px tabular is a number that is not one. The adult
         uncuffed entry is a sentence, so it is marked and set as one. */
      var v = String(value);
      var phrase = v.length > 14 || /[a-z]{4}/.test(v);
      return '<div class="awp"><span class="awp-i" aria-hidden="true">' + icon + '</span>' +
        '<div class="awp-tx"><div class="awp-l">' + label + '</div>' +
        '<div class="awp-v' + (phrase ? ' awp-long' : '') + '">' + value +
        (unit ? '<span class="awp-u">' + unit + '</span>' : '') +
        '</div></div></div>';
    }
    return section(2, 'Airway plan', 'Primary plan with equipment',
      '<div class="awp-grid">' +
        item(SVG.mask,    'Face mask',      A.mask) +
        item(SVG.blade,   'Laryngoscope',   A.blade) +
        item(SVG.ett,     'ETT cuffed',     A.ettCuffed, A.ettUnit) +
        item(SVG.ett,     'ETT uncuffed',   A.ettUncuffed, A.ettUnit) +
        item(SVG.depth,   'ETT depth',      A.depth, A.depthUnit) +
        item(SVG.lma,     'LMA',            A.lma) +
        item(SVG.igel,    'i-gel',          A.igel) +
        item(SVG.opa,     'Oral airway',    A.opa) +
        item(SVG.npa,     'Nasopharyngeal', A.npa) +
        item(SVG.suction, 'Suction',        A.suction) +
      '</div>');
  }

  /* ── 3 · BACKUP DIFFICULT AIRWAY PLAN ────────────────────────────────── */
  function backupSection(){
    /* NO PATIENT-SPECIFIC PREDICTION. This application records no airway
       assessment — no Mallampati, no mouth opening, no neck movement, no
       history of difficult intubation — so it cannot say this patient will be
       difficult, and it does not pretend to. What it can do is put the
       equipment and the protocol one press away before they are needed. */
    /* NO NUMBER. It is not a step of its own: it is what the airway plan
       above it falls back to, and it sits directly under it. */
    return section('', 'Backup difficult airway', 'Reference, not a prediction',
      '<div class="bkp">' +
        '<div class="bkp-row">' +
          '<span class="bkp-i" aria-hidden="true">&#128680;</span>' +
          '<div><b>Have ready before induction</b>' +
          '<div class="bkp-list">Video laryngoscope &middot; Bougie &middot; ' +
          'Supraglottic airway (sizes above) &middot; Bag-valve-mask &middot; ' +
          'Working suction &middot; Capnography</div></div>' +
        '</div>' +
        '<div class="bkp-acts">' +
          '<button type="button" class="bkp-b" onclick="Induction.protocol(\'da\')">' +
            'Difficult Airway algorithm</button>' +
          '<button type="button" class="bkp-b" onclick="Induction.protocol(\'cico\')">' +
            'CICO — front of neck</button>' +
        '</div>' +
        '<p class="wf-note">Anestheo records no airway assessment, so it makes no claim about ' +
        'this patient\'s airway. Call for help early; the protocols above are the ones this ' +
        'application carries.</p>' +
      '</div>');
  }

  /* ── 4 · PAEDIATRIC CONTEXT — GATED ──────────────────────────────────── */
  function pedsSection(){
    var c = ctx();
    /* THE WHOLE SECTION, OR NOTHING. Not a hidden heading with values leaking
       into the sections above: an adult reaches this function and it returns
       an empty string. */
    if (!c || !c.context || !c.context.pediatric) return '';
    var P = c.pediatric || {}, S = c.dosingScalars || {};
    function v(label, val, unit){
      if (val == null || val === '') return '';
      return '<div class="pdx"><div class="pdx-l">' + label + '</div>' +
        '<div class="pdx-v">' + val + (unit ? '<span class="pdx-u">' + unit + '</span>' : '') +
        '</div></div>';
    }
    return section(3, 'Paediatric context', 'Paediatric patients only',
      '<div class="pdx-grid">' +
        v('BSA', S.bsa, 'm&sup2;') +
        v('EBV', P.ebv, 'mL') +
        v('Maintenance', P.maintenance421, 'mL/h') +
        v('ETT', P.ett, 'mm ID') +
        v('ETT depth', P.ettDepth, 'cm') +
        v('LMA', P.lma) +
        v('i-gel', P.igel) +
      '</div>' +
      '<p class="wf-note">Derived from the weight and age entered. LMA and i-gel are sized on ' +
      'different scales and are shown separately.</p>');
  }

  /* ── 5 · RELEVANT DRUG REFERENCE ─────────────────────────────────────── */
  function referenceSection(){
    var seen = {}, rows = '';
    ['induction','volatile','analgesia','nmb','reversal'].forEach(function (g){
      drugs(g).forEach(function (d){
        if (seen[d.id]) return; seen[d.id] = 1;
        rows += refCard(d);
      });
    });
    if (!rows) return '';
    /* Its own scroll, so the page does not grow without limit as the drug set
       does. The complete reference stays reachable from the navigation. */
    return section(4, 'Quick drug reference', 'Agents relevant to induction',
      '<div class="idref"><div class="idc-grid">' + rows + '</div></div>' +
      '<p class="wf-note">These are the agents relevant to induction and intubation. The ' +
      'complete drug reference is a tab of its own.</p>');
  }

  /* ── PUBLIC ──────────────────────────────────────────────────────────── */
  function render(){
    var host = $('induction-host');
    if (!host) return;
    var c = ctx();
    if (!c || !c.complete){
      host.innerHTML = '<div class="wf-empty">Enter age, sex, height and weight and the ' +
        'induction workstation activates.</div>';
      return;
    }
    /* THE WORKSTATION GEOMETRY. Not a single column: the plan and the airway
       are two halves of the same decision and belong beside each other. The
       reference spans beneath both, because it is consulted about either. */
    host.innerHTML =
      '<div class="wf-cols">' +
        '<div class="wf-col-main">' + planSection() + '</div>' +
        '<div class="wf-col-side">' + airwaySection() + backupSection() +
          pedsSection() + '</div>' +
      '</div>' +
      '<div class="wf-full">' + referenceSection() + '</div>';
  }

  /* Records the technique. Deliberately touches nothing else: no dose, no
     drug, no selection. Pressing the chosen one clears it. */
  function setTechnique(id){
    technique = (technique === id) ? null : id;
    render();
  }

  /* Reveal one role's alternatives, under that role. One at a time, because
     three open lists is the catalogue this replaced. */
  function openRoleFn(key){
    openRole = (openRole === key) ? null : key;
    render();
    var el = document.querySelector('#induction-host .pl-role[data-role="' + key + '"] .pl-rb');
    if (el) el.focus({ preventScroll:true });
  }

  /* THE ONE PLACE A DRUG ENTERS OR LEAVES THE PLAN. Selecting records a
     choice; it does not alter a dose, and no drug is ever selected by this
     application on the clinician's behalf.

     ADDING IS ADDING. A second agent in the same role joins the first rather
     than replacing it — a plan carrying midazolam and propofol, or fentanyl
     and remifentanil, is an ordinary plan. The list stays open so a second or
     third can be added without reopening it. */
  function toggle(key, id){
    var ids = idsFor(key).slice();
    var at = ids.indexOf(id);
    if (at >= 0) ids.splice(at, 1); else ids.push(id);
    if (ids.length) picked[key] = ids; else delete picked[key];
    render();
    var el = document.querySelector('#induction-host .pl-role[data-role="' + key +
                                    '"] [data-alt="' + id + '"]');
    if (el) el.focus({ preventScroll:true });
  }

  /* Removal is always explicit, and always of ONE agent. */
  function remove(key, id){
    var ids = idsFor(key).filter(function (x){ return x !== id; });
    if (ids.length) picked[key] = ids; else delete picked[key];
    render();
  }

  function clearPlan(){ picked = {}; openRole = null; render(); }

  /* New Case ends a case, and a plan belongs to the case that was ended. */
  function clear(){ picked = {}; openRole = null; technique = null; render(); }

  /* Opens the crisis protocol IN PLACE — the induction plan stays on screen
     behind it. The keys are the protocol's own keys in CRISIS, so this names
     the protocol it means rather than its position in a list. */
  function protocol(key){
    if (root.crisisPreviewByKey) root.crisisPreviewByKey(key);
  }

  root.Induction = { render:render, protocol:protocol,
                     toggle:toggle, remove:remove, openRole:openRoleFn,
                     clearPlan:clearPlan, clear:clear,
                     setTechnique:setTechnique,
                     get roles(){ return ROLES.map(function (r){ return r.key; }); },
                     get technique(){ return technique; },
                     get plan(){ return pickedList().map(function (d){ return d.id; }); } };
})(typeof window !== 'undefined' ? window : this);
