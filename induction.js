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

  var STRATEGIES = [
    { id:'inhalational', label:'Inhalational',  sub:'Volatile induction',
      groups:['volatile','induction'] },
    { id:'iv',           label:'IV hypnotic',   sub:'Intravenous induction',
      groups:['induction','analgesia','nmb'] },
    { id:'classic-rsi',  label:'Classic RSI',   sub:'Rapid sequence',
      groups:['induction','nmb','analgesia'], rsi:'classic' },
    { id:'modified-rsi', label:'Modified RSI',  sub:'Rapid sequence',
      groups:['induction','nmb','analgesia'], rsi:'modified' }
  ];

  /* null until the clinician picks one. Not a default, and not persisted as
     one: an unchosen strategy is a real state and it shows every pathway. */
  var chosen = null;

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
     patient, and the context line. `emphasis` only changes weight on screen. */
  function card(d, emphasis){
    var col = classColour(d.pclass);
    var amount = (d.val != null && d.val !== '')
      ? d.val + (d.unit ? '<span class="idc-u">' + d.unit + '</span>' : '') : '';
    var rule = d.doseNum
      ? d.doseNum + (d.doseUnit ? ' <span class="idc-u">' + d.doseUnit + '</span>' : '')
      : (d.doseRule || '');
    /* A rate is its own answer: renderDose() refuses to turn mcg/kg/min into
       a number of millilitres, so the rule stands alone rather than being
       repeated as if it had been converted. */
    var same = amount && d.doseRule && d.doseRule.indexOf(String(d.val)) === 0;
    return '<div class="idc' + (emphasis ? ' on' : '') + '" style="--pc:' + col + '">' +
      '<div class="idc-top">' +
        (d.badge || '') +
        (d.use ? '<span class="idc-route">' + esc(d.use) + '</span>' : '') +
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

  /* ── 2 · SELECTED DRUG PLAN ──────────────────────────────────────────── */
  function planSection(){
    var st = chosen ? STRATEGIES.filter(function (x){ return x.id === chosen; })[0] : null;
    var order = st ? st.groups : ['induction','volatile','analgesia','nmb'];
    var seen = {}, html = '';
    order.forEach(function (g){
      drugs(g).forEach(function (d){
        if (seen[d.id]) return; seen[d.id] = 1;
        html += card(d, !!st);
      });
    });
    /* Everything the chosen pathway did not emphasise, still present. */
    var rest = '';
    ['induction','volatile','analgesia','nmb'].forEach(function (g){
      if (order.indexOf(g) >= 0) return;
      drugs(g).forEach(function (d){ if (!seen[d.id]) { seen[d.id] = 1; rest += card(d, false); } });
    });
    /* A pathway whose leading group holds nothing publishable must say so.
       Otherwise choosing "Inhalational" would show the intravenous list and
       read as though those were the inhalational plan. */
    var empty = st ? st.groups.filter(function (g){ return drugs(g).length === 0; }) : [];
    var gap = empty.length
      ? '<p class="wf-note wf-warn">This pathway\'s ' + esc(empty.join(' and ')) + ' agents ' +
        'are not published in Anestheo yet — those entries carry no reviewed dose, so none ' +
        'appear below. What is shown is the rest of the pathway, not a substitute for them.</p>'
      : '';
    return section(2, 'Selected drug plan',
      st ? st.label : 'All induction and intubation agents',
      '<p class="wf-note wf-warn">These are the agents available for this patient at this ' +
      'weight, not a list of drugs to give together. Choose what the case needs.</p>' + gap +
      '<div class="idc-grid">' + html + rest + '</div>');
  }

  /* ── 3 · RSI CHOICES ─────────────────────────────────────────────────── */
  function rsiSection(){
    var nmb = drugs('nmb');
    var sux = nmb.filter(function (d){ return /suxamethonium|succinyl/i.test(d.name); })[0];
    var roc = nmb.filter(function (d){ return /rocuronium/i.test(d.name); })[0];
    if (!sux && !roc) return '';

    /* THE CONTEXTS ARE NOT COLLAPSED. Suxamethonium's dose is defined for RSI;
       rocuronium's is defined for intubation, and its RSI context lives in its
       own preparation note. Both are shown in the data's own words rather than
       merged into one generic blocker card, and no RSI figure is invented. */
    function choice(kind, title, sub, d){
      if (!d) return '';
      var col = classColour(d.pclass);
      return '<div class="rsi' + (chosen === kind ? ' on' : '') + '" style="--pc:' + col + '">' +
        '<div class="rsi-h"><span class="rsi-k">' + title + '</span>' +
        '<span class="rsi-s">' + sub + '</span></div>' +
        '<div class="rsi-name">' + (d.badge || '') + ' ' + esc(d.name) + '</div>' +
        '<div class="rsi-dose">' +
          (d.doseNum ? '<b>' + d.doseNum + '</b> <span class="idc-u">' + (d.doseUnit || '') + '</span>' : '') +
          ((d.val != null && d.val !== '') ? '<span class="rsi-amt">' + d.val +
            (d.unit ? '<span class="idc-u">' + d.unit + '</span>' : '') + '</span>' : '') +
        '</div>' +
        (d.use ? '<div class="rsi-ind">' + esc(d.use) + '</div>' : '') +
        (d.prepNote ? '<div class="rsi-note">' + d.prepNote + '</div>' : '') +
        (d.warn ? '<div class="idc-warn' + (d.severity === 'critical' ? ' crit' : '') + '">' +
                  '<span aria-hidden="true">&#9888;</span> ' + d.warn + '</div>' : '') +
      '</div>';
    }
    return section(3, 'RSI choices', 'Doses as defined in the drug data',
      '<div class="rsi-row">' +
        choice('classic-rsi',  'Classic RSI',  'Depolarising blocker', sux) +
        choice('modified-rsi', 'Modified RSI', 'Non-depolarising, RSI context', roc) +
        choice('standard',     'Standard intubation', 'Non-depolarising', roc) +
      '</div>' +
      '<p class="wf-note">Rocuronium appears twice because its dose is defined once and used ' +
      'in two contexts; the preparation note carries the RSI context in the data\'s own ' +
      'words. No separate RSI figure is asserted here.</p>');
  }

  /* ── 4 · AIRWAY PLAN ─────────────────────────────────────────────────── */
  function airwaySection(){
    var A = root.airwayPlan;
    if (!A) return '';
    function item(icon, label, value, unit){
      if (value == null || value === '') return '';
      return '<div class="awp"><span class="awp-i" aria-hidden="true">' + icon + '</span>' +
        '<div class="awp-tx"><div class="awp-l">' + label + '</div>' +
        '<div class="awp-v">' + value + (unit ? '<span class="awp-u">' + unit + '</span>' : '') +
        '</div></div></div>';
    }
    return section(4, 'Airway plan', 'Primary plan with equipment',
      '<div class="awp-grid">' +
        item('&#128567;', 'Face mask',    A.mask) +
        item('&#128300;', 'Laryngoscope', A.blade) +
        item('&#129517;', 'ETT cuffed',   A.ettCuffed, A.ettUnit) +
        item('&#129517;', 'ETT uncuffed', A.ettUncuffed, A.ettUnit) +
        item('&#128207;', 'ETT depth',    A.depth, A.depthUnit) +
        item('&#128167;', 'LMA',          A.lma) +
        item('&#128167;', 'i-gel',        A.igel) +
        item('&#128191;', 'Oral airway',  A.opa) +
        item('&#128191;', 'Nasopharyngeal', A.npa) +
        item('&#127786;', 'Suction',      A.suction) +
      '</div>');
  }

  /* ── 5 · BACKUP DIFFICULT AIRWAY PLAN ────────────────────────────────── */
  function backupSection(){
    /* NO PATIENT-SPECIFIC PREDICTION. This application records no airway
       assessment — no Mallampati, no mouth opening, no neck movement, no
       history of difficult intubation — so it cannot say this patient will be
       difficult, and it does not pretend to. What it can do is put the
       equipment and the protocol one press away before they are needed. */
    return section(5, 'Backup difficult airway plan', 'Reference, not a prediction',
      '<div class="bkp">' +
        '<div class="bkp-row">' +
          '<span class="bkp-i" aria-hidden="true">&#128680;</span>' +
          '<div><b>Have ready before induction</b>' +
          '<div class="bkp-list">Video laryngoscope &middot; Bougie &middot; ' +
          'Supraglottic airway (sizes above) &middot; Bag-valve-mask &middot; ' +
          'Working suction &middot; Capnography</div></div>' +
        '</div>' +
        '<div class="bkp-acts">' +
          '<button type="button" class="bkp-b" onclick="Induction.protocol(\'airway\')">' +
            'Difficult Airway algorithm</button>' +
          '<button type="button" class="bkp-b" onclick="Induction.protocol(\'cico\')">' +
            'CICO — front of neck</button>' +
        '</div>' +
        '<p class="wf-note">Anestheo records no airway assessment, so it makes no claim about ' +
        'this patient\'s airway. Call for help early; the protocols above are the ones this ' +
        'application carries.</p>' +
      '</div>');
  }

  /* ── 6 · PAEDIATRIC CONTEXT — GATED ──────────────────────────────────── */
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
    return section(6, 'Paediatric context', 'Shown for a paediatric patient only',
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

  /* ── 7 · RELEVANT DRUG REFERENCE ─────────────────────────────────────── */
  function referenceSection(){
    var seen = {}, rows = '';
    ['induction','volatile','analgesia','nmb','reversal'].forEach(function (g){
      drugs(g).forEach(function (d){
        if (seen[d.id]) return; seen[d.id] = 1;
        rows += card(d, false);
      });
    });
    if (!rows) return '';
    /* Its own scroll, so the page does not grow without limit as the drug set
       does. The complete reference stays reachable from the navigation. */
    return section(7, 'Induction drug reference', 'Scrolls independently',
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
      strategySection() + planSection() + rsiSection() +
      airwaySection() + backupSection() + pedsSection() + referenceSection();
  }

  function choose(id){
    chosen = (chosen === id) ? null : id;   /* pressing the chosen one clears it */
    render();
  }

  /* Opens the crisis protocol by name, in place. Wired by engine.html. */
  function protocol(kind){
    if (root.crisisPreviewByKey) root.crisisPreviewByKey(kind);
  }

  root.Induction = { render:render, choose:choose, protocol:protocol,
                     get strategy(){ return chosen; } };
})(typeof window !== 'undefined' ? window : this);
