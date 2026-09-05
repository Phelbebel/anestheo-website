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
   block: a compact technique strip, one Add agent control, and a single dense
   grid of exactly the agents the clinician chose, each with its dose for this
   patient and each removable where it stands.

   THE DISPLAY IS FLAT; THE STATE IS GROUPED. Agents are stored per canonical
   role, which is what the chooser groups by and what removal is keyed on —
   but three role containers each reserving an empty cell for an agent nobody
   selected is three headings and three blank rectangles of monitor for no
   information at all. The card's own badge and indication say which role it
   belongs to.

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
  /* FOUR APPROACHES, AND RSI IS ONE OF THEM — NOT TWO.
     Classic and Modified were top-level tiles beside IV Hypnotic and
     Inhalational, which made a rapid sequence look like two different
     approaches rather than one approach done two ways. RSI is a single
     option and its variants live inside it, revealed when it is chosen.

     NOT ONE TILE NAMES A DRUG. The schema captions Classic and Modified with
     a blocker; those captions are deliberately not reproduced, because
     either blocker can be used with either variant and a tile that names one
     is a recommendation wearing a label.

     Only one thing reaches the dose selector: whether the approach is a
     rapid sequence. Both variants answer yes and everything else answers no,
     which is exactly what the frozen phase rule already said. */
  var TECHNIQUES = [
    { id:'iv',           short:'IV Hypnotic',  sub:'Intravenous induction agent',
      icon:'M14.5 3.5 20.5 9.5M17.5 6.5 8 16l-3.4.9L5.5 13.5z' },
    { id:'rsi',          short:'RSI',          sub:'Rapid sequence induction',
      icon:'M13 2 4.5 13.5H11L9.5 22 19 10h-6.5z',
      variants:[{ id:'classic',  label:'Classic' },
                { id:'modified', label:'Modified' }] },
    { id:'inhalational', short:'Inhalational', sub:'Volatile induction',
      icon:'M4 12c2-3 5-3 7 0s5 3 7 0M4 17c2-3 5-3 7 0s5 3 7 0' },
    { id:'tiva',         short:'TIVA / TCI',   sub:'Target-controlled infusion',
      icon:'M6 3h12M8 3v5.5L4.6 19a2 2 0 0 0 1.9 2.6h11a2 2 0 0 0 1.9-2.6L16 8.5V3' }
  ];

  /* WHICH RSI, recorded only once RSI itself is the approach. It is metadata:
     no dose, no drug and no phase depends on it — both variants are a rapid
     sequence and the selector is asked for the same context either way. */
  var rsiVariant = null;

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

  function idsFor(key){ return picked[key] || []; }
  function hasDrug(key, id){ return idsFor(key).indexOf(id) >= 0; }

  function pickedList(){
    var out = [];
    ROLES.forEach(function (r){
      var ids = idsFor(r.key); if (!ids.length) return;
      drugsOnce(r.group).forEach(function (d){ if (ids.indexOf(d.id) >= 0) out.push(d); });
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
  /* WHO the patient is, not just how heavy. The workstation used to send the
     model a weight alone, which is why a child was shown adult doses scaled
     down. The threshold lives in patientContext and the eligibility rule
     lives in the model; this function carries the answer between them and
     holds neither. */
  function population(){
    var CC = root.ClinicalContent;
    return (CC && CC.patientPopulation) ? CC.patientPopulation(ctx()) : null;
  }

  function drugs(groupId){
    var CC = root.ClinicalContent;
    if (!CC || !CC.visibleDosesInGroup) return [];
    try { return CC.visibleDosesInGroup(groupId, weight(), population()) || []; }
    catch(e){ console.warn('[induction] group ' + groupId + ' unavailable', e); return []; }
  }
  /* ── THE PLAN IS A LIST OF DRUGS, THE REFERENCE IS A LIST OF DOSES ──────
     The selector enumerates one row per reviewed dose, which is right for a
     reference table and wrong for everything here: the plan stores its
     selection by DRUG id, so once rocuronium carried a routine intubating
     dose and an RSI dose, "rocuronium" matched twice and the plan drew the
     same agent twice in the same role. The chooser had the same problem —
     three remifentanil buttons that all toggled the same thing.

     So the plan and the chooser take the first eligible row per drug. That is
     a presentation decision, not a clinical one: no dose is discarded, and
     every reviewed record stays visible and complete in the drug reference
     below, which is the surface built to show them.

     A withheld row is still a row here. A drug whose dose is not reviewed for
     this patient stays offerable and stays in the plan carrying its coverage
     line — losing the tile is exactly what we spent the machinery avoiding. */
  function drugsOnce(groupId){
    var seen = {}, out = [];
    drugs(groupId).forEach(function (d){
      if (seen[d.id]) return; seen[d.id] = 1; out.push(d);
    });
    return out;
  }

  /* ── TECHNIQUE CHOOSES A CONTEXT, NOT A DRUG ───────────────────────────
     The plan took the first eligible row per drug, so a clinician who had
     selected rocuronium and set the technique to Classic RSI was shown
     0.6 mg/kg — the routine intubating dose — under a strip that said RSI.
     A real, reviewed number for the wrong context is the most convincing way
     to be wrong, and it is worse than no number at all.

     THIS CHANGES NO SELECTION. Technique switches the context the plan asks
     about; the drug the clinician chose stays chosen, in its role, in its
     place. Nothing is added, removed or swapped, and Classic and Modified
     RSI are not bound to a blocker — both are simply RSI for the purposes of
     looking up a dose, and the difference between them stays what it is,
     technique metadata this application holds no dose for.

     THE LIST IS THE CONTRACT. For a blocker under RSI it has ONE entry, so a
     drug with no reviewed RSI record has nothing to fall back to and the card
     says so. For a hypnotic or an opioid it is ['rsi','induction'] because
     the reviewed labels do not dose them differently for a rapid sequence —
     if one ever does, its record is found first and this code is unchanged.

     A technique that has not been recorded is not RSI. It reads as the
     routine context, which is what the screen showed before any of this. */
  /* ONE OPTION, TWO VARIANTS, ONE ANSWER. Both variants are a rapid
     sequence, so the context the selector is asked for is the same either
     way — which is the frozen rule, unchanged by the tiles above it. */
  function isRSI(){ return technique === 'rsi'; }
  function contextFor(roleKey){
    var CC = root.ClinicalContent;
    /* A BLOCKER'S LIST NEVER GROWS. Both entries are single, so an RSI
       question has nothing to fall back to and a routine question cannot
       reach an RSI record. There is no unphased blocker record and no tier
       here that could answer with one if there were. */
    if (roleKey === 'nmb') return isRSI() ? ['rsi'] : ['intubation'];
    /* Hypnotics and opioids end with the unphased tier, which matches only
       records that declare NO context — every record predating the reviewed
       migration. Without it the plan would print a coverage line for
       midazolam, morphine and the legacy fentanyl row while the reference
       beside it printed their dose. */
    var legacy = CC ? CC.LEGACY_CONTEXT : '(unphased)';
    return isRSI() ? ['rsi', 'induction', legacy] : ['induction', legacy];
  }
  /* THE MODEL DECIDES, NOT THIS FILE. doseRowForContext() applies the same
     publishability, population, age-band and applicability rules as every
     other surface; this passes it a context and renders what comes back. */
  function contextRow(roleKey, id){
    var CC = root.ClinicalContent;
    if (!CC || !CC.doseRowForContext) return null;
    try { return CC.doseRowForContext(CC.byId(id), weight(), population(), contextFor(roleKey)); }
    catch(e){ console.warn('[induction] context row for ' + id + ' unavailable', e); return null; }
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
     -------------------------------------------------------------------
     THE REFERENCE NO LONGER HAS A CARD BUILDER HERE AT ALL. refCard() was a
     third renderer of the same canonical rows — the Drug reference workspace
     already had a table and a card view over exactly this data — so the two
     could disagree about how a dose reads while agreeing about what it is.
     This section now mounts that one renderer, scoped to the induction
     groups. See referenceSection(). */

  /* `action` rides in the heading row. A control belonging to the section as
     a whole has no business taking a row of its own beneath it. */
  /* ── THE ORDINAL IS DERIVED, NOT DECLARED ─────────────────────────────
     Every section used to carry a hard-coded number: plan 1, airway 2,
     paediatric 3, reference 4. Two of those are conditional — the paediatric
     section does not exist for an adult and the airway section does not exist
     before compute() has published a plan — so the numbers described a
     workstation that is not always the one on the screen. Moving the
     reference to the end made it visible: an adult read 1, 2, then 4, and a
     4 with no 3 above it is a section the clinician goes looking for.

     A section asks for a number by passing NUM. It is answered in the order
     the sections are actually built, which is the order they appear, so the
     visible run is always 1..N with nothing missing and nothing skipped. A
     section that should not be numbered — the backup airway is part of the
     airway plan above it, not a step of its own — passes '' and is stepped
     over without consuming an ordinal.

     THIS CHANGES NO GATING. pedsSection() still returns '' for an adult and
     nothing renders a hidden section to keep a number company. */
  var NUM = '#';
  var ordinal = 0;
  function section(n, title, sub, body, extraClass, action){
    if (n === NUM) n = ++ordinal;
    return '<section class="wf-sec ' + (extraClass || '') + '">' +
      '<div class="wf-h">' + (n === '' ? '' : '<span class="wf-n">' + n + '</span>') +
      '<span class="wf-t">' + title + '</span>' +
      (sub ? '<span class="wf-sub">' + sub + '</span>' : '') +
      (action || '') + '</div>' +
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

  /* ── THE INDUCTION TOOLBOX IS THE COLUMN ──────────────────────────────
     This section used to render only what had been selected, behind an
     "+ Add agent" control. With nothing selected it was 131px of heading
     beside a 448px airway plan — a 317px rectangle of empty ground in the
     middle of the workspace, and the drugs themselves one click out of
     sight. The board is the answer to "what am I giving", so the board is
     what the column shows.

     Every eligible induction-relevant drug is present the moment the patient
     loads. Nothing is selected for the clinician; selecting one moves
     nothing and hides nothing. There is no chooser, no empty plan container
     and no "+ Add" anywhere in this workflow — USE and ✓ USING happen in the
     row the drug already occupies.

     THE GROUPS COME FROM THE RECORDS, NOT A CURATED LIST. A drug is a
     primary induction agent when its own canonical dose label says
     Induction; the rest of that group is an adjunct, which is exactly what
     Premedication and Sedation already say about midazolam and
     dexmedetomidine. Etomidate and thiopental are not in the canonical model
     and so are absent — a row with no dose is a drug the clinician has to
     look up somewhere else. */
  function isPrimaryInduction(id){
    var CC = root.ClinicalContent, d = (CC && CC.byId) ? CC.byId(id) : null;
    return !!(d && (d.doses || []).some(function (x){ return /^Induction/.test(x.label || ''); }));
  }

  /* ── THE PLAN'S FOUR ROWS ─────────────────────────────────────────────
     TWO SOURCES, AND THEY ANSWER DIFFERENT QUESTIONS. InductionCatalog says
     WHICH agents are on the board and in which row — composition, no
     medicine. ClinicalContent says what any of them may print — every dose,
     route, population rule and coverage state, unchanged.

     A member whose canonicalId resolves is the canonical record, exactly as
     before. A member with no canonical record at all is a display member: a
     name and a colour, and the card says "Dose not reviewed" where the
     numbers would be. It cannot acquire a dose here, because there is
     nothing here to acquire one from. */
  var PLAN_SLOTS = 4;
  function planRows(){
    var CC = root.ClinicalContent;
    var cat = root.InductionCatalog;
    if (!CC || !cat) return [];
    return (cat.rows || []).map(function (row){
      return { key:row.role, label:row.label, nmb:!!row.nmb,
        rows:(row.members || []).map(function (m){
          var d = m.canonicalId ? CC.byId(m.canonicalId) : null;
          if (d) return { id:d.id, name:d.name, pclass:d.pclass, canonical:true };
          /* No record — the catalog's own name and colour, and nothing else.
             A member that names a canonicalId which does not resolve and
             carries no display name is a broken entry, not a blank card. */
          if (!m.name) return null;
          return { id:null, key:m.key, name:m.name, pclass:m.visualClass,
                   canonical:false };
        }).filter(Boolean) };
    });
  }
  /* Kept for the suites and for any caller that wants the flat board. */
  function toolboxGroups(){ return planRows(); }

  /* A COMPACT CONTROL, NOT A FIFTH CARD. It sits outside the four-card grid
     at the width of a button, and it is a plus and nothing else. It opens
     the drug reference filtered to the row's class, which is where every
     other agent this application holds a dose for already is. */
  function tbSlot(roleKey){
    return '<button type="button" class="tb-s" data-slot-for="' + roleKey + '" ' +
      'aria-label="Add another agent from the drug reference" ' +
      'onclick="Induction.addSlot(\'' + roleKey + '\')">+</button>';
  }

  /* ONE CARD, AND THE DOSE IS THE LOUDEST THING ON IT. The clinician scans
     for a number, so the per-kg rule is set in the card's own ink weight and
     the amount for THIS patient is the largest type in it — not a grey line
     under a name. The route and context sit above them in caption size.

     A withheld dose keeps the card, its name and its class colour and says
     what is missing where the numbers would be. No warning paragraph lives
     inside a card; a warning belongs to the reference row's disclosure. */
  function tbCard(roleKey, base){
    var CC = root.ClinicalContent;
    /* A DISPLAY MEMBER HAS NO RECORD TO ASK. It is not a withheld dose, it is
       an agent the board names and the evidence process has not reached: no
       selector runs for it, no context is consulted, and the card prints its
       name, its colour and the coverage state. It is not a control either —
       there is nothing canonical to put in a plan. */
    var noRecord = base.canonical === false;
    var d = noRecord ? null : contextRow(roleKey, base.id);
    if (!d) d = { withheld:true, use:'', val:'', unit:'',
                  coverage:(CC && CC.COVERAGE) ? CC.COVERAGE[CC.WITHHELD.UNPUBLISHED]
                                               : 'Dose not reviewed' };
    var on = noRecord ? false : hasDrug(roleKey, base.id);
    var rule = d.doseNum
      ? '<b>' + d.doseNum + '</b> <i>' + esc(d.doseUnit || '') + '</i>'
      : (d.val ? '<b>' + esc(d.val) + '</b> <i>' + esc(d.unit || '') + '</i>' : '');
    var amount = (d.doseNum && d.val) ? esc(d.val) + '<i>' + esc(d.unit || '') + '</i>' : '';
    /* THE CARD IS THE CONTROL. A text button inside it spent a third of the
       last line — the line the patient's amount is on — saying what the card
       itself can say by lighting up. The card is a <button>, it carries
       aria-pressed, and the only mark of state inside it is a check in the
       corner. Every child is a <span>: flow content inside a button is a
       validity error, and this file has already been bitten once by a
       <button> that could not legally contain what was put in it. */
    var body =
      (on ? '<span class="tb-c-ck" aria-hidden="true">&#10003;</span>' : '') +
      '<span class="tb-c-n">' + esc(base.name) + '</span>' +
      '<span class="tb-c-u">' + esc(d.use || '\u00a0') + '</span>' +
      (d.withheld
        ? '<span class="tb-c-cov">' + esc(d.coverage) + '</span>'
        : '<span class="tb-c-r">' + rule + '</span>' +
          '<span class="tb-c-a">' + (amount || '') + '</span>');
    var colour = 'style="--pc:' + classColour(base.pclass) + '" ';
    if (noRecord)
      return '<div class="tb-c cov tb-c-x" ' + colour +
        'data-member="' + esc(base.key || '') + '">' + body + '</div>';
    return '<button type="button" class="tb-c' + (on ? ' on' : '') +
        (d.withheld ? ' cov' : '') + '" ' + colour +
        'data-drug="' + esc(base.id) + '" ' +
        'data-plan-for="' + esc(base.id) + '" ' +
        'aria-pressed="' + (on ? 'true' : 'false') + '" ' +
        'aria-label="' + (on ? 'Stop using ' : 'Use ') + esc(base.name) + ' in this plan" ' +
        'onclick="Induction.toggle(\'' + roleKey + '\',\'' + esc(base.id) + '\')">' +
      body + '</button>';
  }

  /* ── 1 · INDUCTION STRATEGY ──────────────────────────────────────────
     The approach, recorded and nothing more. It selects no drug, changes no
     dose and prefers nothing; the subtitle says so on the screen rather than
     leaving the clinician to find out. What it DOES do is tell the dose
     selector which context to ask about, which is why a blocker's card
     changes number when a rapid sequence is chosen and nothing else does. */
  function strategySection(){
    var tiles = TECHNIQUES.map(function (t){
      var on = technique === t.id;
      /* THE VARIANTS LIVE INSIDE THE TILE THEY BELONG TO, and only once it
         is chosen. Closed, they cost nothing; there is no second RSI section
         anywhere on this page. */
      var vars = (on && t.variants) ? ('<span class="st-v">' + t.variants.map(function (v){
        return '<button type="button" class="st-vb' + (rsiVariant === v.id ? ' on' : '') + '" ' +
          'aria-pressed="' + (rsiVariant === v.id ? 'true' : 'false') + '" ' +
          'onclick="event.stopPropagation();Induction.setRsiVariant(\'' + v.id + '\')">' +
          esc(v.label) + '</button>';
      }).join('') + '</span>') : '';
      /* A BUTTON MAY NOT CONTAIN A BUTTON. Nesting the two variant controls
         inside the tile's own <button> is invalid HTML: the parser closes the
         outer button before the inner one and the browser ejects Classic and
         Modified into the grid beside the tiles, which is exactly where they
         appeared. The cell is the bordered box; the tile is the control
         inside it, and the variants are its siblings within the same cell. */
      return '<div class="st-cell' + (on ? ' on' : '') + '">' +
        '<button type="button" class="st-t" ' +
          'aria-pressed="' + (on ? 'true' : 'false') + '" ' +
          'onclick="Induction.setTechnique(\'' + t.id + '\')">' +
          '<span class="st-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" ' +
            'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
            'stroke-linejoin="round"><path d="' + t.icon + '"/></svg></span>' +
          '<span class="st-tx"><span class="st-n">' + esc(t.short) + '</span>' +
          '<span class="st-s">' + esc(t.sub) + '</span></span>' +
          (on ? '<span class="st-ck" aria-hidden="true">&#10003;</span>' : '') +
        '</button>' + vars +
      '</div>';
    }).join('');
    return section(NUM, 'Induction strategy', 'Records the approach — selects no drug',
      '<div class="st">' + tiles + '</div>');
  }

  /* ── 2 · SELECTED DRUG PLAN ──────────────────────────────────────────
     Four rows, four slots each, dense and aligned. Nothing is selected for
     the clinician; USE lights the card where it stands and USING turns it
     off again. There is no chooser, no empty-plan container and no "+ Add". */
  function planSection(){
    var groups = planRows();
    var total = 0, used = 0;
    groups.forEach(function (g){
      total += g.rows.length;
      g.rows.forEach(function (d){ if (hasDrug(g.key, d.id)) used++; });
    });

    /* LABEL · FOUR CARDS · ONE PLUS. The four cards are a grid of four equal
       columns; the plus is outside it, so it is a control the size of a
       control rather than a fifth cell the size of a card. */
    var board = '<div class="tb">' + groups.map(function (g){
      var cells = g.rows.slice(0, PLAN_SLOTS).map(function (d){ return tbCard(g.key, d); });
      return '<div class="tb-grp">' +
        '<div class="tb-g' + (g.nmb && isRSI() ? ' rsi' : '') + '">' +
          '<b>' + esc(g.label) + '</b></div>' +
        '<div class="tb-row">' + cells.join('') + '</div>' +
        tbSlot(g.key) +
      '</div>';
    }).join('') + '</div>';

    return section(NUM, 'Selected drug plan',
      total + ' available · doses for ' + (weight() ? weight() + ' kg' : 'this patient') +
        ' · ' + (used ? used + ' in use' : 'none selected'),
      board);
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
    return section(NUM, 'Airway plan', 'Primary plan with equipment',
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
    return section(NUM, 'Paediatric context', 'Paediatric patients only',
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

  /* ── 4 · DRUG REFERENCE ──────────────────────────────────────────────────
     THE MOUNT, NOT A SECOND REFERENCE. Everything below the heading is built
     by the engine in engine.html — the same search, the same class filters,
     the same table and cards, the same inline detail and the same normalized
     rows out of ClinicalContent.visibleDrugsInGroup(). This function supplies
     three empty containers and a heading; it renders no drug, no dose and no
     warning of its own, which is why the reference here and the reference in
     the Drug reference workspace cannot disagree.

     The instance is 'iref' and its scope is the induction groups. The user
     can widen it with the search box, which searches the canonical index.

     Its own scroll, so the page does not grow without limit as the drug set
     does. The complete reference stays reachable from the navigation. */
  function referenceSection(){
    /* Nothing to mount if the canonical model published nothing for these
       groups — the same test the old card list applied. */
    var any = false;
    ['induction','volatile','analgesia','nmb','reversal'].forEach(function (g){
      if (drugs(g).length) any = true;
    });
    if (!any) return '';
    /* ONE BAND OF CHROME, NOT THREE. The title, the match count, the search
       box and the tools entry were a heading, then a search row, then a
       filter strip — 144px before the first drug. The count and the search
       ride in the heading; the filters are the only other band; the table
       header comes next. Clinical tools is a quiet control at the end of the
       heading rather than a second toolbar. */
    var action =
      '<span class="dref-ctl" id="iref-ctl"></span>' +
      '<button type="button" class="ctl-b" id="ctools-b" ' +
        'aria-expanded="false" aria-controls="ctools" ' +
        'aria-label="Clinical tools for this patient" ' +
        'onclick="ctoolsToggle()">Tools</button>';
    return section(NUM, 'Drug reference', '',
      '<div class="ctl-panel" id="ctools" hidden></div>' +
      '<div class="dref-cats" id="iref-cats"></div>' +
      '<div class="idref"><div id="iref-body"></div></div>', '', action);
  }

  /* ── PUBLIC ──────────────────────────────────────────────────────────── */
  /* THE REFERENCE'S OWN STATE SURVIVES A PLAN EDIT. Adding an agent rebuilds
     this host, and the mount is repainted from the engine's module state — so
     the query, the class filter, the view and the open detail come back by
     themselves. Scroll position does not: it belongs to a DOM node that no
     longer exists, so it is carried across by hand. Without this, pressing
     "+" on the eleventh row of the reference threw the clinician back to the
     first. */
  function refScroll(){
    var el = document.querySelector('#induction-host .idref');
    return el ? el.scrollTop : null;
  }
  function restoreRef(top){
    if (top == null) return;
    var el = document.querySelector('#induction-host .idref');
    if (el) el.scrollTop = top;
  }

  /* NO WRAPPER WITHOUT CONTENT. Returns '' — not an empty div — when the
     section renders nothing, so the slot consumes exactly 0px. */
  function strip(cls, html){
    return html ? ('<div class="' + cls + '">' + html + '</div>') : '';
  }

  /* ── ONE CONDITIONAL CASE-CONTEXT SLOT ────────────────────────────────
     Not a permanent PAEDIATRIC CONTEXT section. The slot asks the patient
     what context applies and renders that module; a routine adult matches
     none and the slot disappears entirely rather than standing empty.

     Only modules whose content already exists canonically may appear here.
     Obstetric and older-adult contexts are named in the comment and NOT
     implemented, because this application holds no reviewed content for
     either and a heading with nothing under it is worse than no heading. */
  function caseContextSection(){
    var c = ctx();
    if (c && c.context && c.context.pediatric) return pedsSection();
    /* obstetric / older adult: no canonical content yet, so no module */
    return '';
  }

  function render(){
    var host = $('induction-host');
    if (!host) return;
    var keepTop = refScroll();
    var c = ctx();
    if (!c || !c.complete){
      host.innerHTML = '<div class="wf-empty">Enter age, sex, height and weight and the ' +
        'induction workstation activates.</div>';
      return;
    }
    /* THE WORKSTATION GEOMETRY. Not a single column: the plan and the airway
       are two halves of the same decision and belong beside each other. The
       reference spans beneath both, because it is consulted about either. */
    /* The run restarts with the render. Sections are built in the order they
       appear below, so the ordinals are assigned in reading order. */
    ordinal = 0;
    host.innerHTML =
      /* TWO INDEPENDENT COLUMNS, not a grid with a spanning item. A grid
         grows the tracks a spanning item crosses, so the tall airway column
         pushed the reference 103px below the plan — a void created by the
         layout rather than by any content. Two flows cannot do that to each
         other: each column is exactly as tall as what is in it.

         THE REFERENCE IS A SIBLING OF THE PAIR, NOT A CHILD OF THE LEFT ONE.
         Inside .wf-col-main it inherited the plan column's 488px, and seven
         conceptual columns do not go into 488px — that is what forced the
         indication under the drug name, the preparation under the dose, and
         a 78px average row where a reference table wants 40-52. It spans the
         whole central workspace now, beneath both, which is where something
         consulted about either belongs. The timers stay left of this host and
         the Crisis rail stays right of it; neither is touched. */
      '<div class="wf-cols">' +
        '<div class="wf-col-main">' + strategySection() + planSection() + '</div>' +
        '<div class="wf-col-side">' + airwaySection() + '</div>' +
      '</div>' +
      /* THE BACKUP IS A STRIP, NOT THE BOTTOM OF THE AIRWAY COLUMN.
         Inside .wf-col-side it made that column 715px against the plan's 291,
         and the 424px of ground beside the plan was the difference. It is not
         a column's worth of content: it is one line of equipment and two
         protocol buttons, which composes horizontally across the centre in
         about a fifth of the height it took stacked.

         It still reads immediately after the airway plan it falls back from,
         and immediately before the reference — the same position in the
         reading order it already had. Nothing about what it says or what its
         buttons do has changed. */
      /* FULL-WIDTH STRIPS, AND NOT ONE OF THEM RESERVES A ROW IT DOES NOT
         NEED. Each is emitted ONLY when it has content: an adult with no
         case context gets no wrapper, no margin and no placeholder, so the
         drug reference moves up by exactly the height the missing section
         would have taken. An empty div with margin-top:12px is a reserved
         row, and this page had one. */
      strip('wf-bkp', backupSection()) +
      strip('wf-ctx', caseContextSection()) +
      '<div class="wf-full">' + referenceSection() + '</div>';
    /* The containers exist now, so the engine can fill them. It is the same
       call the Drug reference workspace makes, with this mount's id. */
    if (root.drefRender && document.getElementById('iref-body')) {
      try { root.drefRender('iref'); } catch(e){ console.warn('[induction] reference', e); }
    }
    restoreRef(keepTop);
  }

  /* Records the technique. Deliberately touches nothing else: no dose, no
     drug, no selection. Pressing the chosen one clears it. */
  function setTechnique(id){
    technique = (technique === id) ? null : id;
    /* Leaving RSI leaves its variant behind with it; nothing else is
       touched, and no drug is added, removed or swapped. */
    if (technique !== 'rsi') rsiVariant = null;
    render();
  }
  /* Records which rapid sequence. No dose, drug or phase reads this. */
  function setRsiVariant(id){
    if (technique !== 'rsi') return;
    rsiVariant = (rsiVariant === id) ? null : id;
    render();
  }

  /* THE CHOOSER IS GONE WITH THE EMPTY PLAN IT SERVED. Every drug is on the
     board, so there is nothing to open. The name is kept as a no-op because a
     page cached from before this change still calls it, and a stale handler
     is not a reason to throw. */
  function openRoleFn(){ /* no chooser to open */ }

  /* THE PLUS SENDS YOU TO THE REFERENCE, filtered to the row's own class.
     It adds no drug by itself — every agent this application holds a dose
     for is already in the reference below, and this is the route to it. */
  function addSlot(roleKey){
    var CLASS = { induction:'induction', analgesia:'opioid', nmb:'nmb' };
    try {
      if (root.drefSet) root.drefSet('iref', 'cat', CLASS[roleKey] || 'all');
      var host = document.querySelector('#induction-host .idref');
      if (host && host.scrollIntoView) host.scrollIntoView({ block:'nearest' });
    } catch(e){ console.warn('[induction] reference filter unavailable', e); }
  }

  /* SELECTION IS A TOGGLE, IN PLACE. Adding is adding and removing is
     removing; a role may hold more than one agent. Focus returns to the row's
     own button after the re-render, so pressing USE on the eleventh drug does
     not throw the keyboard back to the first. */
  function toggle(key, id){
    var ids = idsFor(key).slice();
    var at = ids.indexOf(id);
    if (at >= 0) ids.splice(at, 1); else ids.push(id);
    if (ids.length) picked[key] = ids; else delete picked[key];
    render();
    var el = document.querySelector('#induction-host [data-plan-for="' + id + '"]');
    if (el) el.focus({ preventScroll:true });
  }

  /* Removal is always explicit, and always of ONE agent. */
  function remove(key, id){
    var ids = idsFor(key).filter(function (x){ return x !== id; });
    if (ids.length) picked[key] = ids; else delete picked[key];
    render();
  }

  function clearPlan(){ picked = {}; render(); }

  /* New Case ends a case, and a plan belongs to the case that was ended. */
  function clear(){ picked = {}; technique = null; render(); }

  /* Opens the crisis protocol IN PLACE — the induction plan stays on screen
     behind it. The keys are the protocol's own keys in CRISIS, so this names
     the protocol it means rather than its position in a list. */
  function protocol(key){
    if (root.crisisPreviewByKey) root.crisisPreviewByKey(key);
  }

  root.Induction = { render:render, protocol:protocol,
                     toggle:toggle, remove:remove, openRole:openRoleFn,
                     addSlot:addSlot,
                     clearPlan:clearPlan, clear:clear,
                     setTechnique:setTechnique, setRsiVariant:setRsiVariant,
                     get roles(){ return ROLES.map(function (r){ return r.key; }); },
                     get technique(){ return technique; },
                     get plan(){ return pickedList().map(function (d){ return d.id; }); } };
})(typeof window !== 'undefined' ? window : this);
