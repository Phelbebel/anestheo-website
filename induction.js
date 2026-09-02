/* induction.js — THE INDUCTION WORKSTATION
   ═══════════════════════════════════════════════════════════════════════════
   The first screen: what a clinician needs in the minutes before they induce
   and intubate. It answers, in order —

     who is my patient        (the case bar above this)
     what strategy am I using
     which drugs and doses
     what airway am I planning
     what is my backup
     what if it goes wrong    (the Crisis rail beside this)

   ── THIS FILE COMPOSES. IT DOES NOT DECIDE. ───────────────────────────────
   Every drug, dose, unit, weight basis, preparation and warning comes from
   ClinicalContent.visibleDrugsInGroup(), which is the same call the drug
   table makes, through the same renderDose() weight scaling. Every airway
   value comes from window.airwayPlan, which compute() fills from the same
   variables it renders the Airway panel with.

   There is no second dose table here, and there is no arithmetic. If a number
   on this screen is wrong, it is wrong in clinical-index.js or in compute(),
   and it is wrong identically everywhere else it appears.

   ── STRATEGY CHANGES EMPHASIS, NEVER VALUES ───────────────────────────────
   Choosing a pathway re-orders and highlights. It does not add a drug, remove
   a drug, or alter a dose by any amount. Nothing is selected by default and
   nothing is labelled recommended or preferred, because this application
   holds no data supporting such a recommendation — the clinician chooses.

   Alternatives stay on screen throughout. A row of induction agents is a menu
   to choose from, and the copy says so, because a screen that shows five
   hypnotics must not read as a list of five things to give.
*/
(function (root) {
  'use strict';

  /* ROUTE OF INDUCTION. Not technique — that is a separate question with its
     own section, because Classic and Modified RSI describe how the airway is
     secured and say nothing about which hypnotic is used. Merging the two
     was the original mistake here. */
  var STRATEGIES = [
    { id:'inhalational', label:'Inhalational', sub:'Volatile induction',
      groups:['volatile','induction','analgesia','nmb'] },
    { id:'iv',           label:'IV hypnotic',  sub:'Intravenous induction',
      groups:['induction','analgesia','nmb','volatile'] }
  ];

  /* RSI TECHNIQUE IS NOT A DRUG. This application holds no technique-specific
     dose, no preoxygenation time, no cricoid-pressure guidance and no
     apnoeic-oxygenation protocol, so this records what the clinician is doing
     and asserts nothing about it. It must never be wired to a blocker: a
     blocker's dose is defined once, by the drug, for the indication the drug
     data names — and "Classic RSI" is not the name of a drug. */
  var TECHNIQUES = [
    { id:'standard', label:'Standard induction / intubation' },
    { id:'classic',  label:'Classic RSI' },
    { id:'modified', label:'Modified RSI' }
  ];

  /* null until the clinician picks one. Not a default, and not persisted as
     one: an unchosen strategy is a real state and it shows every pathway. */
  var chosen = null;
  var technique = null;

  /* THE PLAN IS WHAT WAS CHOSEN, AND NOTHING ELSE.
     Emphasising every drug in a strategy's groups and calling the result a
     "Selected drug plan" was the same error in a different place: it put five
     hypnotics, three opioids and two blockers under one heading that reads as
     a list of things to give. A plan has exactly the drugs a clinician put in
     it. Everything else is an alternative and is labelled as one.

     Keyed by the drug's own id, so the plan survives a weight change (the
     doses re-render, the choices do not) and is cleared by New Case. */
  var picked = {};
  function isPicked(id){ return picked[id] === true; }
  function pickedList(){
    var out = [];
    ['induction','volatile','analgesia','nmb','reversal','local'].forEach(function (g){
      drugs(g).forEach(function (d){ if (isPicked(d.id)) out.push(d); });
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

  /* ── A DRUG CARD ─────────────────────────────────────────────────────────
     Name, class, route/use, the weight-based rule, the amount for THIS
     patient, and the context line.

     The whole card is the control. `emphasis` no longer means "this strategy
     covers this class" — it means THIS DRUG IS IN THE PLAN, because the
     clinician put it there. A card that looks chosen without having been
     chosen is the defect this replaces. */
  function card(d, emphasis){
    var col = classColour(d.pclass);
    var on = isPicked(d.id);
    var amount = (d.val != null && d.val !== '')
      ? d.val + (d.unit ? '<span class="idc-u">' + d.unit + '</span>' : '') : '';
    var rule = d.doseNum
      ? d.doseNum + (d.doseUnit ? ' <span class="idc-u">' + d.doseUnit + '</span>' : '')
      : (d.doseRule || '');
    /* A rate is its own answer: renderDose() refuses to turn mcg/kg/min into
       a number of millilitres, so the rule stands alone rather than being
       repeated as if it had been converted. */
    var same = amount && d.doseRule && d.doseRule.indexOf(String(d.val)) === 0;
    return '<button type="button" class="idc' + (on ? ' on' : '') +
        (emphasis ? ' emph' : '') + '" style="--pc:' + col + '" ' +
        'aria-pressed="' + (on ? 'true' : 'false') + '" ' +
        'data-drug="' + esc(d.id) + '" ' +
        'onclick="Induction.pick(\'' + esc(d.id) + '\')">' +
      '<div class="idc-top">' +
        (d.badge || '') +
        (d.use ? '<span class="idc-route">' + esc(d.use) + '</span>' : '') +
        '<span class="idc-tick" aria-hidden="true">' + (on ? '&#10003;' : '+') + '</span>' +
      '</div>' +
      '<div class="idc-name">' + esc(d.name) + '</div>' +
      (d.aliasLine ? '<div class="idc-alias">' + esc(d.aliasLine) + '</div>' : '') +
      '<div class="idc-dose">' +
        (rule ? '<div class="idc-rule">' + rule + '</div>' : '') +
        ((amount && !same) ? '<div class="idc-amt">' + amount + '</div>' : '') +
      '</div>' +
      (d.prepMain ? '<div class="idc-prep">' + d.prepMain + '</div>' : '') +
      /* `ind` is deliberately not repeated here: supportLine() composes route,
         label, dose and maximum, and the card has already shown all four in
         their own fields. The table view needs the one-line form; a card does
         not, and printing it twice is how a card stops being readable. */
      /* `warn` is authored with HTML entities and the row builder renders it
         raw; escaping it here would print &gt; instead of >. Name, aliases,
         route and label carry no markup, so those stay escaped. */
      (d.warn ? '<div class="idc-warn' + (d.severity === 'critical' ? ' crit' : '') + '">' +
                '<span aria-hidden="true">&#9888;</span> ' + d.warn + '</div>' : '') +
    '</button>';
  }

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
      '<div class="wf-h"><span class="wf-n">' + n + '</span>' +
      '<span class="wf-t">' + title + '</span>' +
      (sub ? '<span class="wf-sub">' + sub + '</span>' : '') + '</div>' +
      body + '</section>';
  }

  /* ── 1 · STRATEGY ────────────────────────────────────────────────────── */
  function strategySection(){
    var opts = STRATEGIES.map(function (st){
      return '<button type="button" class="ist' + (chosen === st.id ? ' on' : '') + '" ' +
        'aria-pressed="' + (chosen === st.id ? 'true' : 'false') + '" ' +
        'onclick="Induction.choose(\'' + st.id + '\')">' +
        '<span class="ist-l">' + st.label + '</span>' +
        '<span class="ist-s">' + st.sub + '</span></button>';
    }).join('');
    return section(1, 'Induction strategy',
      chosen ? 'Emphasis only — no dose changes' : 'Choose a pathway',
      '<div class="ist-row">' + opts + '</div>' +
      '<p class="wf-note">Selecting a pathway changes what is emphasised below. It does not ' +
      'change any dose, and it does not add or remove a drug. Nothing is pre-selected: ' +
      'this application holds no data that would justify recommending one pathway over ' +
      'another for a given patient.</p>');
  }

  /* ── 2 · SELECTED DRUG PLAN ──────────────────────────────────────────
     ONLY WHAT WAS CHOSEN. Not "every drug in the classes this strategy
     touches" — that put five hypnotics, three opioids and two blockers under
     a heading reading "Selected drug plan", which is a list of things to give
     that nobody selected. An empty plan is a real and correct state and says
     so in words. */
  function planSection(){
    var list = pickedList();
    if (!list.length){
      return section(2, 'Selected drug plan', 'Nothing selected',
        '<div class="pln-empty">No drugs selected yet. Select agents below to build ' +
        'this induction plan.</div>');
    }
    return section(2, 'Selected drug plan',
      list.length + (list.length === 1 ? ' agent' : ' agents') + ' selected',
      '<div class="idc-grid">' + list.map(function (d){ return card(d, false); }).join('') +
      '</div>' +
      '<button type="button" class="pln-clear" onclick="Induction.clearPlan()">' +
      'Clear plan</button>' +
      '<p class="wf-note">Every dose here is the same value the drug reference shows for ' +
      'this patient\'s weight. Selecting a drug records a choice; it changes no dose.</p>');
  }

  /* ── 3 · AVAILABLE AGENTS ────────────────────────────────────────────
     The menu. A strategy re-orders and emphasises this list and selects
     nothing from it, which is the whole difference between the two sections.*/
  function availableSection(){
    var st = chosen ? STRATEGIES.filter(function (x){ return x.id === chosen; })[0] : null;
    var order = st ? st.groups : ['induction','volatile','analgesia','nmb'];
    var seen = {}, html = '';
    /* The emphasised classes come first, unselected. Everything else follows,
       still present and still legible: a drug you cannot read is a drug you
       cannot rule out. */
    order.forEach(function (g){
      drugs(g).forEach(function (d){
        if (seen[d.id] || isPicked(d.id)) return; seen[d.id] = 1;
        html += card(d, !!st && order.indexOf(g) === 0);
      });
    });
    var rest = '';
    ['induction','volatile','analgesia','nmb'].forEach(function (g){
      if (order.indexOf(g) >= 0) return;
      drugs(g).forEach(function (d){
        if (seen[d.id] || isPicked(d.id)) return; seen[d.id] = 1;
        rest += card(d, false);
      });
    });
    /* A pathway whose leading group holds nothing publishable must say so.
       Otherwise choosing "Inhalational" would show the intravenous list and
       read as though those were the inhalational agents. */
    var empty = st ? st.groups.filter(function (g){ return drugs(g).length === 0; }) : [];
    var gap = empty.length
      ? '<p class="wf-note wf-warn">This pathway\'s ' + esc(empty.join(' and ')) + ' agents ' +
        'are not published in Anestheo yet — those entries carry no reviewed dose, so none ' +
        'appear below. What is shown is the rest of the pathway, not a substitute for them.</p>'
      : '';
    if (!html && !rest){
      return section(3, 'Available agents', 'Everything else is in the plan',
        gap + '<div class="pln-empty">Every published induction agent is already in the ' +
        'plan above.</div>');
    }
    return section(3, 'Available agents',
      st ? ('Ordered for ' + st.label) : 'Alternatives — select to add to the plan',
      '<p class="wf-note wf-warn">These are the agents available for this patient at this ' +
      'weight. This is a menu, not a sequence: nothing here is selected, recommended or ' +
      'intended to be given together.</p>' + gap +
      '<div class="idc-grid">' + html + rest + '</div>');
  }

  /* ── 4 · RSI TECHNIQUE ───────────────────────────────────────────────
     A TECHNIQUE IS NOT A DRUG. The previous version of this screen bound
     Classic RSI to suxamethonium and Modified RSI to rocuronium, as though
     the technique and the blocker were the same choice. They are not: Classic
     and Modified RSI describe how the airway is secured — preoxygenation,
     cricoid pressure, whether the patient is ventilated before intubation —
     and either can be performed with either blocker.

     Anestheo holds no technique data at all: no preoxygenation time, no
     cricoid guidance, no apnoeic-oxygenation protocol, and no
     technique-specific dose. So this records the choice and asserts nothing
     about it, and it does not touch a single dose below. */
  function techniqueSection(){
    var opts = TECHNIQUES.map(function (tq){
      return '<button type="button" class="tec' + (technique === tq.id ? ' on' : '') + '" ' +
        'aria-pressed="' + (technique === tq.id ? 'true' : 'false') + '" ' +
        'onclick="Induction.setTechnique(\'' + tq.id + '\')">' + tq.label + '</button>';
    }).join('');
    return section(4, 'RSI technique', 'How the airway is secured',
      '<div class="tec-row">' + opts + '</div>' +
      '<p class="wf-note">The technique and the neuromuscular blocker are separate choices: ' +
      'either blocker below can be used with any of these. Anestheo carries no ' +
      'technique-specific dose, timing or manoeuvre, so this records what you are doing and ' +
      'changes nothing on this screen. Follow your local rapid-sequence protocol.</p>');
  }

  /* ── 5 · NEUROMUSCULAR BLOCKER CHOICE ────────────────────────────────
     Every blocker this application publishes, each with the dose its own
     record defines, under the indication its own record names. Suxamethonium
     carries an RSI dose; rocuronium carries an intubation dose and an RSI
     context in its preparation note. Neither is relabelled, and where no
     separate RSI figure exists none is invented. */
  function blockerSection(){
    var nmb = drugs('nmb');
    if (!nmb.length) return '';
    var cards = nmb.map(function (d){
      var col = classColour(d.pclass);
      var on = isPicked(d.id);
      /* SAME SHAPE AS A DRUG CARD, because it is one. The indication leads
         the band — it is short, it differs between the two blockers, and it
         is the thing that must not be relabelled to fit a technique. The
         record's own class wording goes under the name, where the drug cards
         put their aliases: "Aminosteroid non-depolarising neuromuscular
         blocker" is not a header, it is a sentence, and putting it in the
         band made one card's header two lines taller than the other's. */
      return '<button type="button" class="rsi' + (on ? ' on' : '') + '" ' +
        'style="--pc:' + col + '" aria-pressed="' + (on ? 'true' : 'false') + '" ' +
        'data-drug="' + esc(d.id) + '" onclick="Induction.pick(\'' + esc(d.id) + '\')">' +
        '<div class="rsi-h">' + (d.badge || '') +
          (d.use ? '<span class="rsi-ind">' + esc(d.use) + '</span>' : '') +
          '<span class="idc-tick" aria-hidden="true">' + (on ? '&#10003;' : '+') +
          '</span></div>' +
        '<div class="rsi-name">' + esc(d.name) + '</div>' +
        (d.klass ? '<div class="rsi-k">' + esc(d.klass) + '</div>' : '') +
        '<div class="rsi-dose">' +
          (d.doseNum ? '<b>' + d.doseNum + '</b> <span class="idc-u">' +
            (d.doseUnit || '') + '</span>' : '') +
          ((d.val != null && d.val !== '') ? '<span class="rsi-amt">' + d.val +
            (d.unit ? '<span class="idc-u">' + d.unit + '</span>' : '') + '</span>' : '') +
        '</div>' +
        (d.prepNote ? '<div class="rsi-note">' + d.prepNote + '</div>' : '') +
        (d.warn ? '<div class="idc-warn' + (d.severity === 'critical' ? ' crit' : '') + '">' +
                  '<span aria-hidden="true">&#9888;</span> ' + d.warn + '</div>' : '') +
      '</button>';
    }).join('');
    return section(5, 'Neuromuscular blocker choice', 'Doses as the drug data defines them',
      '<div class="rsi-row">' + cards + '</div>' +
      '<p class="wf-note">Each blocker is shown under the indication its own record names — ' +
      'suxamethonium\'s dose is defined for rapid sequence, rocuronium\'s for intubation with ' +
      'its rapid-sequence context in the preparation note. No blocker is labelled Classic or ' +
      'Modified, and where the data holds no separate rapid-sequence figure, none is ' +
      'asserted here.</p>');
  }

  /* ── 6 · AIRWAY PLAN ─────────────────────────────────────────────────
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
    return section(6, 'Airway plan', 'Primary plan with equipment',
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

  /* ── 7 · BACKUP DIFFICULT AIRWAY PLAN ────────────────────────────────── */
  function backupSection(){
    /* NO PATIENT-SPECIFIC PREDICTION. This application records no airway
       assessment — no Mallampati, no mouth opening, no neck movement, no
       history of difficult intubation — so it cannot say this patient will be
       difficult, and it does not pretend to. What it can do is put the
       equipment and the protocol one press away before they are needed. */
    return section(7, 'Backup difficult airway plan', 'Reference, not a prediction',
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

  /* ── 8 · PAEDIATRIC CONTEXT — GATED ──────────────────────────────────── */
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
    return section(8, 'Paediatric context', 'Shown for a paediatric patient only',
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

  /* ── 9 · RELEVANT DRUG REFERENCE ─────────────────────────────────────── */
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
    return section(9, 'Induction drug reference', 'Scrolls independently',
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
    host.innerHTML =
      strategySection() + planSection() + availableSection() +
      techniqueSection() + blockerSection() +
      airwaySection() + backupSection() + pedsSection() + referenceSection();
  }

  function choose(id){
    chosen = (chosen === id) ? null : id;   /* pressing the chosen one clears it */
    render();
  }

  /* Records the technique. Deliberately touches nothing else: no dose, no
     drug, no selection. Pressing the chosen one clears it. */
  function setTechnique(id){
    technique = (technique === id) ? null : id;
    render();
  }

  /* THE ONE PLACE A DRUG ENTERS OR LEAVES THE PLAN. Selecting records a
     choice; it does not alter a dose, and no drug is ever selected by this
     application on the clinician's behalf. */
  function pick(id){
    if (picked[id]) delete picked[id]; else picked[id] = true;
    render();
    /* Keep the pressed card under the thumb: the plan grows above the
       available list, so selecting from the bottom of a long list would
       otherwise walk the page away from where the press happened. */
    var el = document.querySelector('#induction-host [data-drug="' + id + '"]');
    if (el) el.focus({ preventScroll:true });
  }

  function clearPlan(){ picked = {}; render(); }

  /* New Case ends a case, and a plan belongs to the case that was ended. */
  function clear(){ picked = {}; chosen = null; technique = null; render(); }

  /* Opens the crisis protocol IN PLACE — the induction plan stays on screen
     behind it. The keys are the protocol's own keys in CRISIS, so this names
     the protocol it means rather than its position in a list. */
  function protocol(key){
    if (root.crisisPreviewByKey) root.crisisPreviewByKey(key);
  }

  root.Induction = { render:render, choose:choose, protocol:protocol,
                     pick:pick, clearPlan:clearPlan, clear:clear,
                     setTechnique:setTechnique,
                     get strategy(){ return chosen; },
                     get technique(){ return technique; },
                     get plan(){ return pickedList().map(function (d){ return d.id; }); } };
})(typeof window !== 'undefined' ? window : this);
