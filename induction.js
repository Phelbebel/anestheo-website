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
   block: a compact technique strip over a single dense grid of every agent
   the board carries, each with its dose for this patient, each selectable
   and removable where it stands. There is no Add-agent chooser to open —
   the agents are already on screen, and selecting one is pressing it.

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

   ── THE STRATEGY RECORDS THE APPROACH, AND MAY START THE PLAN ─────────────
   Choosing one does two things. It tells the dose selector which context to
   ask about, which is why a blocker's card changes number under a rapid
   sequence and nothing else does. And on an UNTOUCHED plan it selects the
   agents its preset names, so a strategy is a starting point rather than a
   caption.

   A PRESET HOLDS IDS. No dose, no weight, no concentration, no context and
   no duplicate record appears in it. A suggested agent lands in the same
   picked{} as one the clinician pressed, renders through the same card, and
   asks ClinicalContent the same question through the same canonical
   selector. Delete this layer and every number on the board is unchanged.

   The strategy may suggest rocuronium. It does not create, alter or hold
   rocuronium's dose: that comes from the reviewed record, through
   contextFor(), exactly as it does when the clinician selects the drug
   themselves.

   WHAT IT WILL NOT DO. It selects nothing on a fresh screen until a strategy
   is chosen, it names no agent it has no reviewed row for, it never
   substitutes an alternative when the suggested one cannot be offered, and
   it never overrules the clinician: the first manual edit transfers the plan
   to them, and from then on a strategy change offers to replace it rather
   than doing so.

   Classic and Modified RSI describe how the airway is secured. They may
   carry different preset metadata, and in v1 they carry the same; neither
   changes the dose question, because contextFor() returns the same rapid
   sequence context for both and no dose figure exists in a preset to
   override it with.

   There is no route control. It duplicated what the selected agents already
   express, and contradicted itself the moment a plan held both a volatile and
   an intravenous agent.
*/
(function (root) {
  'use strict';

  /* NO ROUTE CONTROL. It duplicated what the selected agents already express,
     and it became a contradiction the moment a plan held both a volatile and
     an intravenous agent — which is an ordinary plan. The state it used is
     gone with it rather than left dangling; nothing derives a route from the
     selection, because that would be a recommendation in disguise. */

  /* RSI TECHNIQUE IS NOT A DOSE RECORD. This application holds no
     technique-specific dose, no preoxygenation time, no cricoid-pressure
     guidance and no apnoeic-oxygenation protocol.

     Its preset may SUGGEST a blocker — rocuronium, by id. That is a starting
     selection, not a number: the dose stays defined once, by the drug, for
     the indication the drug's reviewed record names, and reaches the card
     through contextFor() whether the clinician chose the agent or a preset
     did. Neither variant hardcodes, overrides or scales it, and "Classic
     RSI" is still not the name of a drug.

     NO DOSE FIGURE BELONGS IN STRATEGY_PLANS. A preset that carried one
     would be a second source for a number that already has an owner, and
     the two would drift. */
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

  /* WHICH RSI, recorded only once RSI itself is the approach. It chooses
     which preset is applied — rsi/classic or rsi/modified — and in v1 the
     two suggest the same agents, so the choice is recorded rather than
     acted on differently.

     WHAT IT DOES NOT CHOOSE IS THE DOSE. Both variants are a rapid sequence
     and the selector is asked for the same context either way; no dose or
     phase record is duplicated per variant, and there is nothing in a
     preset that could answer the question differently if it were. */
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
    { key:'nmb',       group:'nmb',       label:'Neuromuscular blockade' },
    /* A VOLATILE IS NOT AN IV HYPNOTIC. It has its own role rather than
       sharing 'induction', because sharing would put sevoflurane in the same
       bucket as propofol: selecting one would sit beside the other under the
       same heading, and a preset managing the hypnosis row would empty the
       volatile with it. Different agent, different route, different dose
       question, different row. */
    { key:'volatile',  group:'volatile',  label:'Volatile induction' }
  ];
  /* role -> ARRAY of explicitly selected drug ids.

     A ROLE MAY HOLD MORE THAN ONE AGENT. An earlier revision made selection a
     replace, so choosing a second opioid silently removed the first. That is
     not a clinical model, it is a widget: a plan legitimately carries
     midazolam and propofol, or fentanyl and remifentanil, and a workstation
     that forbids it is wrong about anaesthesia rather than opinionated about
     UI. Adding is adding; removal is always explicit and per agent. */
  var picked = {};        /* role -> [drug id, ...] */

  /* ── STRATEGY PLANS: A COMPLETE STARTING REGIMEN, AND NOTHING BELOW IT ─
     A strategy proposes a whole anaesthetic, not one agent. It proposes IDS
     ONLY. There is no dose here, no weight, no context, no prose and no
     duplicate record: a suggested drug lands in the same picked{} as a drug
     the clinician pressed, renders through the same card, and asks the same
     canonical selector the same question. If this layer disappeared, every
     number on the board would be unchanged.

     KEYED BY ROW, NOT BY ROLE. picked{} is keyed by role, and two catalog
     rows share the role 'induction' — premedication and hypnosis. A plan
     keyed by role could not tell them apart and would empty one while
     filling the other. So plans name the ROW, which is also what decides the
     dose context, and applyPreset() resolves row to role on the way in.

     SELECTED IS THE PLAN; ALTERNATIVES ARE NOT. Everything in `selected`
     becomes active on an untouched plan. `alternatives` is the rest of the
     row this approach commonly reaches for, and nothing auto-selects from
     it — it is never a substitute when a selected agent cannot be offered,
     because choosing a different drug because the first was unavailable is a
     clinical decision this layer must not make.

     AND SELECTED DOES NOT MEAN A NUMBER WILL APPEAR. Naming an agent here
     puts it in the starting regimen; whether a dose is printed beside it is
     a separate question, answered by the strategy's context and the record,
     not by this object. An agent stays ACTIVE even when no reviewed row
     answers the current context, and its card shows the coverage state
     where the figures would be.

     WAS: "resolvePreset() will not activate an agent whose strategy context
     resolves to an unreviewed row." That coupled the two decisions, and the
     coupling said something clinical it had no business saying — an agent
     silently missing from a regimen reads as "this drug is not part of this
     technique", when the truth is that we hold no reviewed row for that
     question yet.

     FENTANYL IS THE CASE TO READ THIS AGAINST. It is named in the IV and
     both RSI plans. Its reviewed adult row is the SmPC's spontaneous-
     respiration regimen and those plans select a blocker, so no reviewed row
     answers them: the agent is selected, in the plan, and its card reports
     that its dose for this technique is not reviewed. That is the intended
     end state, not a gap waiting to be filled by a substitute. */
  var STRATEGY_PLANS = {
    iv: { rows:{
      premedication:{ selected:[], alternatives:[] },
      analgesia:    { selected:['drug.fentanyl'],
                      alternatives:['drug.alfentanil','drug.remifentanil','drug.morphine'] },
      hypnosis:     { selected:['drug.propofol'],
                      alternatives:['drug.etomidate','drug.ketamine','drug.thiopental'] },
      /* A STARTING PLAN, NOT A CLAIM THAT EVERY IV ANAESTHETIC IS PARALYSED.
         This regimen is the intubation-oriented default; the blocker asks
         the ROUTINE intubating context, never the rapid sequence one, and it
         is removed in one press for an LMA or a spontaneously breathing
         technique. Nothing on the card says a blocker is required. */
      nmb:          { selected:['drug.rocuronium'],
                      alternatives:['drug.atracurium','drug.mivacurium','drug.suxamethonium'] } } },

    /* CLASSIC AND MODIFIED ARE TWO OBJECTS, NOT ONE OBJECT NAMED TWICE. They
       hold the same agents in v1 and they may not tomorrow; aliasing them
       would make a future divergence a refactor instead of an edit. Neither
       invents a pharmacological difference to justify two buttons, and both
       ask the same RSI dose context, because contextFor() returns the same
       rapid sequence tier for both and no dose lives in this object. */
    rsi: { variants:{
      classic: { rows:{
        premedication:{ selected:[], alternatives:[] },
        analgesia:    { selected:['drug.fentanyl'],
                        alternatives:['drug.alfentanil','drug.remifentanil'] },
        hypnosis:     { selected:['drug.propofol'],
                        alternatives:['drug.etomidate','drug.ketamine','drug.thiopental'] },
        nmb:          { selected:['drug.rocuronium'],
                        alternatives:['drug.suxamethonium'] } } },
      modified:{ rows:{
        premedication:{ selected:[], alternatives:[] },
        analgesia:    { selected:['drug.fentanyl'],
                        alternatives:['drug.alfentanil','drug.remifentanil'] },
        hypnosis:     { selected:['drug.propofol'],
                        alternatives:['drug.etomidate','drug.ketamine','drug.thiopental'] },
        nmb:          { selected:['drug.rocuronium'],
                        alternatives:['drug.suxamethonium'] } } } } },

    /* MASK INDUCTION STARTS WITH THE VAPOUR AND NOTHING ELSE. No opioid and
       no blocker are selected: an inhalational induction is commonly chosen
       exactly where intravenous access and paralysis are not yet part of the
       first step. The clinician adds them when the case does. */
    inhalational:{ rows:{
      volatile:     { selected:['drug.sevoflurane'],
                      alternatives:['drug.desflurane','drug.isoflurane'] },
      premedication:{ selected:[], alternatives:[] },
      analgesia:    { selected:[], alternatives:['drug.fentanyl','drug.alfentanil'] },
      hypnosis:     { selected:[], alternatives:['drug.propofol','drug.ketamine'] },
      nmb:          { selected:[], alternatives:['drug.rocuronium','drug.suxamethonium'] } } },

    /* PROPOFOL AND REMIFENTANIL ARE BOTH THE PLAN. The opioid is not an
       optional extra here the way it is elsewhere: remifentanil is the
       analgesic component of a total intravenous anaesthetic and it is
       selected, not offered.

       THIS OBJECT NAMES NO MODEL AND NO TARGET. Marsh, Schnider, Eleveld,
       Minto, a plasma target, an effect-site target and an infusion rate are
       all absent, because no reviewed record holds any of them. The agents
       render their reviewed induction records until that changes. */
    tiva: { rows:{
      premedication:{ selected:[], alternatives:[] },
      analgesia:    { selected:['drug.remifentanil'],
                      alternatives:['drug.fentanyl','drug.alfentanil'] },
      hypnosis:     { selected:['drug.propofol'], alternatives:['drug.ketamine'] },
      nmb:          { selected:[], alternatives:['drug.rocuronium','drug.atracurium'] } } }
  };

  /* ── WHO OWNS THE PLAN ─────────────────────────────────────────────────
     Not "is picked{} empty". A clinician who deliberately emptied a plan has
     customized it, and re-filling it from a strategy would overrule a
     decision they made on purpose. Emptiness is a state of the plan;
     ownership is a fact about who last changed it, and they are different. */
  var planCustomized = false;
  var appliedPresetKey = null;

  function presetKeyFor(t, v){
    if (!t) return null;
    var p = STRATEGY_PLANS[t];
    if (!p) return null;
    if (p.variants) return v ? (t + '/' + v) : null;   /* RSI needs its variant */
    return t;
  }
  function presetFor(t, v){
    var p = STRATEGY_PLANS[t];
    if (!p) return null;
    if (p.variants) return v ? (p.variants[v] || null) : null;
    return p;
  }
  /* rowKey -> { roleKey, memberKeys } straight from the catalog, so the
     preset layer cannot disagree with the board about what a row contains. */
  function rowIndex(){
    var cat = root.InductionCatalog, out = {};
    (cat && cat.rows || []).forEach(function (row){
      out[row.key] = { roleKey:row.role, rowKey:row.key,
        memberKeys:(row.members || []).map(function (m){
          return m.canonicalId || (CATALOG_PREFIX + m.key); }) };
    });
    return out;
  }

  /* ── ONE MUTATION PATH, TWO SOURCES ───────────────────────────────────
     Manual and preset selections land in the same picked{} through the same
     function. The ONLY thing `source` decides is whether the plan becomes
     customized; it never changes what is stored, so there is no second class
     of selection and no parallel "recommended" state to drift out of sync.

     Keyed by ROLE because that is what picked{} is keyed by and what both
     callers hold: a card's onclick passes its role, and the drug reference
     passes a role from DREF_ROLE_GROUP. A role cannot be inverted to a row —
     'induction' is two rows — so the row-to-role resolution happens in
     applyPreset(), which is the only caller that starts from a row. */
  function setPlanSelection(roleKey, pk, selected, source){
    var ids = idsFor(roleKey).slice();
    var at = ids.indexOf(pk);
    if (selected && at < 0) ids.push(pk);
    else if (!selected && at >= 0) ids.splice(at, 1);
    else return false;                       /* already in the wanted state */
    if (ids.length) picked[roleKey] = ids; else delete picked[roleKey];
    if (source === 'manual') planCustomized = true;
    return true;
  }

  /* ── TWO ELIGIBILITY QUESTIONS, ASKED SEPARATELY ──────────────────────
     WAS: "a preset can only select what the card beside it would show a
     number for", and beside it the claim that a withheld row or an RSI
     blocker with no rapid sequence dose "resolve to nothing". Neither is
     true of the code below, and the difference is the whole architecture.

     SELECTION ELIGIBILITY — what this function decides:
       the id is a real member of the catalog row it is named under;
       a canonical record exists for it;
       that record is publishable.
     That is enough for a card the clinician can see, press and unpress.

     DOSE ELIGIBILITY — what this function does NOT decide:
       whether a figure appears is settled by the strategy's context list
       and the record it reaches, in doseRowForContext, exactly as it is for
       a drug the clinician pressed themselves. Where no compatible reviewed
       row exists the agent stays selected and its card prints the coverage
       state instead of a number. Those agents are reported in `withheld` so
       a caller can read the resolution, and reporting is all that is: the
       plan carries them either way.

     NOTHING IS SUBSTITUTED TO CLOSE THAT GAP. `alternatives` are never
     auto-selected. Silently swapping in another drug because the first has
     no reviewed dose for this technique is a clinical decision this layer
     must not make, and it is the reason a coverage state is the right
     answer rather than a second-choice agent.

     A preset id that is not a catalog member still resolves to nothing, and
     is reported unresolved. It would land in picked{} with no card to show
     it or unselect it. */
  function resolvePreset(t, v){
    var key = presetKeyFor(t, v), p = presetFor(t, v);
    var out = { key:key, select:[], unresolved:[], withheld:[], rows:[] };
    if (!p || !p.rows) return out;
    var idx = rowIndex();
    Object.keys(p.rows).forEach(function (rowKey){
      var meta = idx[rowKey];
      var spec = p.rows[rowKey] || {};
      if (!meta) {                                   /* row not on the board */
        (spec.preferred || []).forEach(function (id){
          out.unresolved.push({ rowKey:rowKey, id:id, reason:'row not in catalog' }); });
        return;
      }
      out.rows.push(rowKey);
      (spec.selected || []).forEach(function (id){
        if (meta.memberKeys.indexOf(id) < 0) {
          out.unresolved.push({ rowKey:rowKey, id:id, reason:'not a board member' }); return; }
        /* ── SELECTING A DRUG AND SHOWING A DOSE ARE TWO DECISIONS ──────
           They used to be one: an agent was activated only where the
           strategy's context already resolved to a reviewed row, so an agent
           whose dose for THIS technique had not been reviewed silently fell
           out of the regimen. That reads as a clinical statement it is not —
           "fentanyl is not part of a rapid sequence" — when the truth is
           narrower and duller: we hold no reviewed row for that question yet.

           So the strategy declares the PLAN and the model answers the DOSE.
           What this layer checks is that the id is a real member of the row
           and resolves to a canonical, publishable record — enough for a card
           that can be shown, pressed and unpressed. What it does not check is
           whether that record has an answer for this context, because the
           card says so itself: a withheld row prints its coverage line where
           the numbers would be, and the clinician sees both that the agent is
           in the plan and that its dose for this technique is not reviewed.

           NOTHING IS SUBSTITUTED TO FILL THAT GAP. The context list decides
           what may answer, and a row written for another question is not
           reachable from here however publishable it is. */
        var CCx = root.ClinicalContent;
        var d = CCx && CCx.byId ? CCx.byId(id) : null;
        if (!d || !CCx.isPublishable(d)) {
          out.unresolved.push({ rowKey:rowKey, id:id,
            reason:'no publishable canonical record' }); return; }
        out.select.push({ roleKey:meta.roleKey, rowKey:rowKey, id:id });
        /* Reported, not acted on: the plan carries the agent either way, and
           this is what a caller inspecting the resolution can read. */
        var row = contextRow(meta.roleKey, id, meta.rowKey);
        if (!row || row.withheld) out.withheld.push({ rowKey:rowKey, id:id,
          reason:(row && row.coverage) ? row.coverage : 'no row for this context' });
      });
    });
    return out;
  }

  /* Which rows a preset key declares, read back out of the same object the
     preset came from. Takes the key rather than the pair because that is
     what appliedPresetKey holds. */
  function presetRowsForKey(key){
    if (!key) return [];
    var parts = String(key).split('/');
    var p = presetFor(parts[0], parts.length > 1 ? parts[1] : null);
    return (p && p.rows) ? Object.keys(p.rows) : [];
  }

  /* Applies the resolved preset. Only rows the preset DEFINES are replaced;
     a row it says nothing about keeps whatever is in it. Guarded by
     ownership unless force is passed, which is what "Apply suggested plan"
     and any future reset control use.

     ── A PRESET-OWNED PLAN SHOWS THE CURRENT PRESET, NOT THE SUM OF THEM ──
     The rows cleared are the union of what the INCOMING preset declares and
     what the OUTGOING one declared. Clearing only the incoming preset's rows
     is right for a plan the clinician built, and wrong for one a previous
     preset built: switching from IV to RSI would have left propofol standing
     because RSI's hypnosis row prefers nothing, and the board would have
     shown a rapid sequence carrying the last strategy's induction agent.
     Switching to Inhalational, which declares no rows at all, would have
     left the whole previous plan in place under a strategy that selects
     nothing.

     It reads appliedPresetKey and nothing else. There is no list of drugs
     here, no "if the last strategy was IV" and no per-agent special case:
     a preset's rows are cleared because a preset owned them, and a plan the
     clinician owns is not reached at all — the ownership guard above returns
     first. */
  function applyPreset(t, v, opts){
    opts = opts || {};
    var r = resolvePreset(t, v);
    if (!r.key) return r;
    if (planCustomized && !opts.force) { r.skipped = 'plan is customized'; return r; }
    var idx = rowIndex();
    var clear = {};
    r.rows.forEach(function (rowKey){ clear[rowKey] = 1; });
    presetRowsForKey(appliedPresetKey).forEach(function (rowKey){ clear[rowKey] = 1; });
    /* A FORCED APPLY REPLACES THE WHOLE BOARD, not the union of two presets.
       The union is right when one preset succeeds another; it is not right
       when a customized plan is being replaced, because the clinician may
       have selected in a row neither preset names — a volatile chosen by
       hand, say, which would survive into an intravenous strategy whose
       board does not even draw that row, selected and invisible. */
    if (opts.force) Object.keys(idx).forEach(function (rowKey){ clear[rowKey] = 1; });
    r.cleared = Object.keys(clear);
    r.cleared.forEach(function (rowKey){
      var meta = idx[rowKey]; if (!meta) return;
      meta.memberKeys.forEach(function (pk){
        setPlanSelection(meta.roleKey, pk, false, 'preset'); });
    });
    r.select.forEach(function (sel){
      setPlanSelection(sel.roleKey, sel.id, true, 'preset'); });
    planCustomized = false;
    appliedPresetKey = r.key;
    return r;
  }

  /* ── RETIRING A PRESET-OWNED PLAN ─────────────────────────────────────
     There is one valid strategy state that has no concrete preset: RSI
     before Classic or Modified has been chosen. Entering it used to leave
     the previous preset's agents standing, so the board read "Active
     strategy: rapid sequence induction" over an induction agent the IV
     preset had chosen — a strategy and a plan that disagree, with nothing
     on screen to say which one the clinician meant.

     This retires what a preset owns, and only that. It reads
     appliedPresetKey to find the rows, removes through the same
     setPlanSelection path every other change uses, and names no drug: the
     rows come from the preset object, so a preset that changes tomorrow
     retires correctly tomorrow.

     UNFORCED, IT DOES NOT TOUCH A PLAN THE CLINICIAN BUILT. planCustomized
     is the first thing it asks and a customized plan is returned untouched.
     Nor does an unforced retirement MAKE the plan customized: nothing the
     clinician did changed, so the ownership flag does not move.

     FORCED, IT OUTRANKS THE FLAG, because the only caller that forces is an
     explicit strategy press — the clinician asking for a different approach,
     which is a decision and not an accident. See setTechnique below. */
  function retireAppliedPresetPlan(opts){
    opts = opts || {};
    /* Forced by an explicit strategy change, which outranks a customized
       plan; unforced everywhere else, where it must not. */
    if (planCustomized && !opts.force) return { skipped:'plan is customized' };
    var rows = presetRowsForKey(appliedPresetKey);
    if (!rows.length) { appliedPresetKey = null; return { cleared:[] }; }
    var idx = rowIndex(), cleared = [];
    rows.forEach(function (rowKey){
      var meta = idx[rowKey]; if (!meta) return;
      cleared.push(rowKey);
      meta.memberKeys.forEach(function (pk){
        setPlanSelection(meta.roleKey, pk, false, 'preset'); });
    });
    appliedPresetKey = null;
    /* The clinician's edits were discarded by their own explicit choice, so
       the plan is nobody's again rather than still theirs. */
    if (opts.force) planCustomized = false;
    return { cleared:cleared };
  }

  function idsFor(key){ return picked[key] || []; }
  function hasDrug(key, id){ return idsFor(key).indexOf(id) >= 0; }

  /* ── A PLAN KEY IS INTENT, NOT EVIDENCE ───────────────────────────────
     "The clinician selected Etomidate" and "we hold a reviewed etomidate
     dose for this patient" are different facts, and requiring the second to
     record the first is the same mistake that put seven invented records in
     the clinical dataset. A board member is selected by a STABLE KEY: its
     canonical id when it has one, and 'catalog:<key>' when it does not.

     Nothing downstream can mistake the second form for a record. It is not a
     drug id, byId() does not know it, and Induction.plan — which the drug
     reference reads to light its own buttons — returns canonical ids only.
     Selecting a display member creates no clinical claim of any kind. */
  var CATALOG_PREFIX = 'catalog:';
  function planKey(member){
    return member.id || (CATALOG_PREFIX + member.key);
  }
  function isCatalogKey(k){ return String(k).indexOf(CATALOG_PREFIX) === 0; }

  function pickedList(){
    var out = [];
    ROLES.forEach(function (r){
      var ids = idsFor(r.key); if (!ids.length) return;
      /* A catalog key names no drug, so it appears in no list of drugs. */
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
  /* ── STRATEGY x ROW -> THE QUESTION THE BOARD ASKS ────────────────────
     One table, read once, instead of a chain of conditions that grew an
     `if` every time a strategy was added. Each cell is a list of dose
     PHASES in priority order; doseRowForContext walks them and returns the
     first publishable, eligible row it finds.

     THIS TABLE CONTAINS NO DOSE. It contains the names of questions. Every
     number comes from the record the question finds, which is why a blocker
     changes value under a rapid sequence and propofol does not.

     A BLOCKER'S LIST NEVER GROWS. Both entries are single, so an RSI
     question has nothing to fall back to and a routine question cannot
     reach an RSI record.

     THE ANALGESIA ROW LOST ITS LEGACY TIER, and that is the second half of
     the fentanyl correction. Scoping the reviewed adult row to a
     spontaneous-respiration phase stopped it answering a controlled-airway
     plan — and left the tier below it to answer instead, with the very
     unreviewed 1-3 mcg/kg row the scoping was protecting the board from.

     Two agents lose a number here and both are right to. Fentanyl's adult
     card now reports that no reviewed row answers this context, which is
     true. Morphine's only row is POSTOPERATIVE analgesia, and an induction
     board printing a postoperative dose is the same failure the hypnosis row
     removed when it dropped dexmedetomidine's sedation infusion. Both drugs
     keep their card, their place in the row and their entry in the drug
     reference, where the record is shown in its own context.

     THE HYPNOSIS ROW HAS NO LEGACY TIER. That tier exists so records
     predating the reviewed migration still render, and it matches ANY
     record declaring no phase — which for dexmedetomidine is a sedation
     infusion, a maintenance rate for a sedated patient. Printed in the
     hypnosis slot of an induction board it reads as the dose that induces
     this patient, which it is not.

     THE VOLATILE ROW ASKS FOR INDUCTION AND ONLY INDUCTION. Sevoflurane
     holds a maintenance record and an induction record; this is the line
     that keeps them apart. There is no tier here that a maintenance row
     could answer, under any strategy, ever.

     TIVA ASKS FOR INFUSION CONTENT FIRST AND FINDS NONE TODAY. 'tiva' and
     'infusion' are real phases in the model that no record uses yet, so the
     lookup falls through to 'induction' and the agents render their
     reviewed induction records. When a reviewed infusion record is written
     it is answered here without a code change — and until then nothing
     invents one. */
  var LEGACY = function (){ var CC = root.ClinicalContent;
    return CC ? CC.LEGACY_CONTEXT : '(unphased)'; };
  function strategyContexts(){
    var L = LEGACY();
    return {
      iv: {
        premedication:['induction', L], analgesia:['induction'],
        hypnosis:['induction'], nmb:['intubation'], volatile:['induction'] },
      rsi: {
        premedication:['rsi', 'induction', L], analgesia:['rsi', 'induction'],
        hypnosis:['rsi', 'induction'], nmb:['rsi'], volatile:['induction'] },
      inhalational: {
        premedication:['induction', L], analgesia:['induction'],
        hypnosis:['induction'], nmb:['intubation'], volatile:['induction'] },
      tiva: {
        premedication:['induction', L], analgesia:['tiva', 'infusion', 'induction'],
        hypnosis:['tiva', 'infusion', 'induction'], nmb:['intubation'],
        volatile:['induction'] }
    };
  }
  function contextFor(roleKey, rowKey){
    var map = strategyContexts();
    /* No strategy chosen is not a fifth strategy. The board still has to ask
       something, and what it asks is the ordinary intravenous question. */
    var table = map[technique] || map.iv;
    var key = rowKey || roleKey;
    return table[key] || table[roleKey] || ['induction', LEGACY()];
  }
  function contextRow(roleKey, id, rowKey){
    var CC = root.ClinicalContent;
    if (!CC || !CC.doseRowForContext) return null;
    try { return CC.doseRowForContext(CC.byId(id), weight(), population(),
                                      contextFor(roleKey, rowKey)); }
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
     loads, and every one of them stays present whatever is selected:
     choosing an agent moves nothing and hides nothing. There is no chooser,
     no empty plan container and no "+ Add" anywhere in this workflow — USE
     and ✓ USING happen in the row the drug already occupies.

     A FRESH CASE SHOWS NOTHING IN USE. Choosing a strategy may light the
     agents its preset prefers, and the clinician adds and removes in place
     from there; the first of those edits makes the plan theirs and the
     strategy stops changing it on its own.

     THE GROUPS COME FROM THE RECORDS, NOT A CURATED LIST. A drug is a
     primary induction agent when its own canonical dose label says
     Induction; the rest of that group is an adjunct, which is exactly what
     Premedication and Sedation already say about midazolam and
     dexmedetomidine.

     WAS: "Etomidate and thiopental are not in the canonical model and so are
     absent." Both carry canonical records now and both are on the board, in
     the hypnosis row, where the IV and RSI presets name them among their
     alternatives. The rule the sentence was illustrating is unchanged: a
     drug is here because a record answers for it, and a row with no dose is
     a drug the clinician has to look up somewhere else. */
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
  /* ── THE BOARD SAYS THE NAME, NOT THE SENTENCE ───────────────────────
     "Lidocaine — intravenous" is how the canonical record distinguishes the
     intravenous entry from the local-anaesthetic one, and it stays that way
     everywhere the record is read. On a 165px card it is prose where a name
     belongs, and it wraps to a second line that pushes the dose down.

     This shortens the BOARD LABEL ONLY. It does not touch the record, the
     drug reference, search, or anything a dose is looked up by — and it is
     deliberately incapable of touching a number: it only rewrites an em-dash
     route suffix into the abbreviation the card already uses. The en dash
     inside a dose range is a different character in a different field and is
     never seen by this function. */
  var ROUTE_WORD = { 'intravenous':'IV', 'intramuscular':'IM',
                     'subcutaneous':'SC', 'oral':'PO', 'topical':'topical' };
  function boardName(name){
    var m = /^(.+?)\s+[—–-]\s+(.+)$/.exec(name || '');
    if (!m) return name;
    var tail = ROUTE_WORD[m[2].toLowerCase().trim()];
    return tail ? (m[1].trim() + ' ' + tail) : name;
  }

  var PLAN_SLOTS = 4;
  function planRows(){
    var CC = root.ClinicalContent;
    var cat = root.InductionCatalog;
    if (!CC || !cat) return [];
    return (cat.rows || []).filter(function (row){
      /* A ROW SCOPED TO A STRATEGY IS DRAWN ONLY UNDER IT. The volatile row
         is the first of these: under IV, RSI or TIVA it would be a heading
         over three cards that the strategy did not ask about and cannot
         answer, every one of them reporting that an induction concentration
         is not reviewed for the question being asked. */
      return !row.strategy || row.strategy === technique;
    }).map(function (row){
      /* THE ROW'S OWN KEY TRAVELS WITH IT. `key` is the plan bucket a
         selection lands in and two rows share it; `rowKey` is which row this
         is, and it is what decides the dose context the row asks about. */
      return { key:row.role, rowKey:row.key, label:row.label, nmb:!!row.nmb,
        rows:(row.members || []).map(function (m){
          var d = m.canonicalId ? CC.byId(m.canonicalId) : null;
          if (d) return { id:d.id, name:boardName(d.name), pclass:d.pclass, canonical:true };
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

  /* ONE CARD, AND THE DOSE IS THE LOUDEST THING ON IT. The clinician scans
     for a number, so the per-kg rule is set in the card's own ink weight and
     the amount for THIS patient is the largest type in it — not a grey line
     under a name. The route and context sit above them in caption size.

     A withheld dose keeps the card, its name and its class colour and says
     what is missing where the numbers would be. No warning paragraph lives
     inside a card; a warning belongs to the reference row's disclosure. */
  function tbCard(roleKey, base, rowKey){
    var CC = root.ClinicalContent;
    /* A DISPLAY MEMBER HAS NO RECORD TO ASK. It is not a withheld dose, it is
       an agent the board names and the evidence process has not reached: no
       selector runs for it, no context is consulted, and the card prints its
       name, its colour and the coverage state. It is not a control either —
       there is nothing canonical to put in a plan. */
    var noRecord = base.canonical === false;
    var d = noRecord ? null : contextRow(roleKey, base.id, rowKey);
    if (!d) d = { withheld:true, use:'', val:'', unit:'',
                  coverage:(CC && CC.COVERAGE) ? CC.COVERAGE[CC.WITHHELD.UNPUBLISHED]
                                               : 'Dose not reviewed' };
    var pk = planKey(base);
    var on = hasDrug(roleKey, pk);
    /* ── PER-KG IS A RULE; AN ABSOLUTE DOSE IS AN AMOUNT ───────────────
       A weight-based record has both: the rule the clinician checks
       ("2-2.5 mg/kg TBW") and the amount it comes to for this patient
       ("150-188 mg"). A record the label states in absolute units has only
       the second — 50-200 mcg is already the amount, and no weight makes it
       anything else.

       It used to print in the RULE slot with the amount blank, which put the
       same figure in a different column from the one the drug reference uses
       for it. Two surfaces, one dose, two positions: a clinician comparing
       them has to work out that nothing differs. The amount goes where every
       other amount goes, and the rule stays empty because there is not one.

       THE TITRATION PROTOCOL IS THE EXCEPTION AND STAYS IN THE RULE SLOT.
       "Start 0.5-1% · up 0.5-1% · max 8%" is a procedure, not an amount, and
       it is not a figure for this patient's weight either. */
    /* A RATE IS A RULE, NOT AN AMOUNT. 0.5-1 mcg/kg/min is set on a pump and
       stays per-kg however much the patient weighs, so it belongs in the
       rule slot beside 2-2.5 mg/kg. Only a dose the source states in
       absolute units — 50-200 mcg — is an amount that needs no weight. */
    var perKg = /\/kg/.test(String(d.unit || ''));
    var isTitration = /^Start /.test(String(d.val || ''));
    var absolute = !d.doseNum && d.val && !d.withheld && !perKg && !isTitration;
    var rule = d.doseNum
      ? '<b>' + d.doseNum + '</b> <i>' + esc(d.doseUnit || '') + '</i>'
      : ((d.val && !absolute && !d.withheld)
           ? '<b>' + esc(d.val) + '</b> <i>' + esc(d.unit || '') + '</i>' : '');
    var amount = (d.doseNum && d.val)
      ? esc(d.val) + '<i>' + esc(d.unit || '') + '</i>'
      : (absolute ? esc(d.val) + '<i>' + esc(d.unit || '') + '</i>' : '');
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
    /* EVERY CARD IS A CONTROL. A member without a canonical record is still
       an agent the clinician can declare they are using; what it cannot do is
       print a dose. data-drug is present only when there IS a record behind
       the card, so nothing can read a display member as a canonical one. */
    return '<button type="button" class="tb-c' + (on ? ' on' : '') +
        (d.withheld ? ' cov' : '') + '" ' +
        'style="--pc:' + classColour(base.pclass) + '" ' +
        (noRecord ? 'data-member="' + esc(base.key || '') + '" '
                  : 'data-drug="' + esc(base.id) + '" ') +
        'data-plan-for="' + esc(pk) + '" ' +
        'aria-pressed="' + (on ? 'true' : 'false') + '" ' +
        'aria-label="' + (on ? 'Stop using ' : 'Use ') + esc(base.name) + ' in this plan" ' +
        'onclick="Induction.toggle(\'' + roleKey + '\',\'' + esc(pk) + '\')">' +
      body + '</button>';
  }

  /* ── 1 · INDUCTION STRATEGY ──────────────────────────────────────────
     The approach, and the starting plan that follows from it. Choosing one
     does two things: it tells the dose selector which context to ask about,
     which is why a blocker's card changes number when a rapid sequence is
     chosen and nothing else does, and on an UNTOUCHED plan it selects the
     agents its preset names.

     IT STILL CHANGES NO DOSE AND INVENTS NO AGENT. A preset holds ids; the
     number under a suggested drug comes from the same canonical record, the
     same context and the same card as one the clinician pressed. And it
     never overrules them: a plan that has been edited by hand is the
     clinician's, and the strategy offers to replace it rather than doing
     so. */
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
    return section(NUM, 'Induction strategy', 'Sets the approach · loads a suggested plan when available',
      '<div class="st">' + tiles + '</div>' + strategyContext());
  }

  /* ── THE STRATEGY HAS TO BE VISIBLE IN THE WORKSTATION ────────────────
     Three of the four tiles changed nothing at all. Pressing Inhalational or
     TIVA produced a board byte-identical to IV, so the only evidence the
     press had registered was a tick on the tile itself — a control that
     reads as decorative, in a workstation where every other control does
     something.

     This strip is what the strategy DOES say, and it is careful about the
     difference between a context and a recommendation. It states which
     question the board is now asking, and where this application holds no
     reviewed answer it says that instead of implying one.

     IT PRINTS NO NUMBER. Not a concentration, not a MAC, not a target, not a
     model, not a rate. Sevoflurane is proposed-unverified with an empty dose
     list and stays that way; a strip that filled the gap with a plausible
     figure would be the exact failure this file exists to prevent.

     THE STRIP ITSELF SELECTS NOTHING. It is a caption on the board: what
     the chosen strategy means for the doses being asked for. The agents an
     untouched plan starts with come from that strategy's preset, and they
     are visible where every other selection is — on the board — rather than
     being narrated here a second time. */
  var STRATEGY_CONTEXT = {
    iv: { label:'Intravenous induction',
          note:'The board asks for reviewed induction doses. Blockers ask for the ' +
               'routine intubating context.' },
    rsi:{ label:'Rapid sequence induction', cls:'stx-rsi',
          note:'Neuromuscular blockade now asks for the rapid sequence context only, ' +
               'with no fall back to a routine intubating dose. An agent without a ' +
               'reviewed rapid sequence record says so rather than showing another number.' },
    /* NARROWED, BECAUSE HALF OF IT STOPPED BEING TRUE. Volatile MAINTENANCE
       concentrations are reviewed now and the Maintenance workspace prints
       them from the canonical records. Volatile INDUCTION concentrations are
       not, and this board asks the induction question, so the statement is
       made specific rather than left standing as a claim about the whole
       dataset that the dataset no longer supports. */
    /* WAS: "Volatile induction dosing is not reviewed in the current clinical
       dataset, so no induction concentration is shown here." True when it was
       written and false the moment sevoflurane's induction record landed —
       and it would have stood directly above a card showing that record. What
       replaces it says which agent holds one, because the answer for the
       other two is still no. */
    inhalational:{ label:'Inhalational induction', cls:'stx-inh',
          note:'The volatile row asks for a reviewed INDUCTION record and takes no ' +
               'answer from a maintenance one. Sevoflurane holds a reviewed induction ' +
               'titration; desflurane and isoflurane do not, and say so. Maintenance ' +
               'concentrations for all three remain in Maintenance.' },
    tiva:{ label:'TIVA / TCI', cls:'stx-tiva',
          note:'Propofol and remifentanil are the declared plan. No target-controlled ' +
               'infusion content is reviewed in this application — no target ' +
               'concentration, model or infusion rate — so none is shown anywhere. ' +
               'Both agents render the reviewed records the drug reference holds.' }
  };
  function strategyContext(){
    if (!technique) return '';
    var s = STRATEGY_CONTEXT[technique];
    if (!s) return '';
    var vlabel = (technique === 'rsi' && rsiVariant)
      ? ' &middot; ' + (rsiVariant === 'classic' ? 'Classic' : 'Modified') : '';
    /* ── THE OFFER, AND ONLY WHEN THERE IS SOMETHING TO OFFER ───────────
       Rendered when the plan is the clinician's AND the current strategy
       resolves to at least one selectable agent. Hidden rather than
       disabled: a greyed control asks the clinician to wonder what it would
       have done, and with no configured preset the honest answer is nothing.

       It renders only where the preset would actually change something:
       Inhalational names no agent, so no button appears under it however the
       plan was built. */
    var offer = '';
    if (planCustomized && technique) {
      var r = resolvePreset(technique, rsiVariant);
      if (r.select.length) offer =
        '<button type="button" class="stx-apply" ' +
          'onclick="Induction.applySuggestedPlan()">Apply suggested plan</button>';
    }
    return '<div class="stx ' + (s.cls || '') + '" role="status">' +
      '<span class="stx-b">Active strategy</span>' +
      '<span class="stx-n">' + esc(s.label) + vlabel + '</span>' +
      '<span class="stx-t">' + s.note + '</span>' + offer +
    '</div>';
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
      g.rows.forEach(function (d){ if (hasDrug(g.key, planKey(d))) used++; });
    });

    /* LABEL · FOUR CARDS, AND NOTHING AFTER THEM. There was a plus here,
       outside the card grid, that filtered the drug reference to this row's
       class. It is gone: the reference is on the same page and every row of
       it carries its own USE control, so the plus bought a shortcut at the
       price of a 34px track in every role. The four cards have that width
       now. */
    var board = '<div class="tb">' + groups.map(function (g){
      var cells = g.rows.slice(0, PLAN_SLOTS)
        .map(function (d){ return tbCard(g.key, d, g.rowKey); });
      return '<div class="tb-grp">' +
        /* The RSI row said so in a class name and nowhere a clinician could
           read. The chip is the row stating which context its cards answered,
           beside the cards that answered it. */
        '<div class="tb-g' + (g.nmb && isRSI() ? ' rsi' : '') + '">' +
          '<b>' + esc(g.label) + '</b>' +
          (g.nmb && isRSI() ? '<span class="tb-g-x">RSI context</span>' : '') + '</div>' +
        '<div class="tb-row">' + cells.join('') + '</div>' +
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
    /* ── THE WORKSTATION WAITS FOR AGE AND WEIGHT, NOT FOR FOUR FIELDS ────
       This asked for `complete`, which means full anthropometrics, and so a
       clinician with an age and a weight — everything a dose on this board is
       actually a function of — got a sentence instead of a workstation.
       Height and sex are needed by BMI, IBW, LBW, BSA and adult airway sizing,
       and those withhold themselves; they were never needed by any dose here.

       `complete` is unchanged and still means what it meant. This reads the
       weaker state deliberately. */
    if (!c || !c.caseReady){
      host.innerHTML = '<div class="wf-empty">Enter age and weight and the ' +
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

  /* Records the approach, and loads that approach's regimen with it: the
     new strategy's preset, or a retirement of the old one where the new
     strategy has no preset yet.

     It changes no dose and invents no drug: what it writes are ids, and the
     numbers under them come from the same records they always did.

     ── CHOOSING A STRATEGY IS A CLINICIAN DECISION, AND IT WINS ─────────
     WAS: setTechnique toggled the tile and then called applyPreset, which
     refuses to write to a customized plan. The two together produced the
     state this was written to fix — TIVA lit, "Propofol and remifentanil
     are the declared plan" on the strip, and a board reading NONE SELECTED
     with an Apply control beside it. Three surfaces disagreeing about the
     same plan, and the clinician left to notice and press a button.

     The mistake was treating every write as the same kind of event.

       a re-render, a weight change, a patient edit
         may never touch what the clinician selected;

       a manual edit inside the current strategy
         makes the plan theirs and keeps it;

       PRESSING A DIFFERENT STRATEGY IS ITSELF AN EXPLICIT DECISION
         and replaces the regimen, customized or not.

     Only the last one reaches this function, so this function forces. What
     protects a customized plan is that nothing else here writes: render()
     calls no preset path, and neither does compute().

     RADIO, NOT TOGGLE. Pressing the active tile used to clear the strategy
     and keep its drugs — a second ambiguous state, an anaesthetic with no
     declared approach. An already-active tile is now a no-op; resetting a
     modified regimen is what "Apply suggested plan" is for. */
  function setTechnique(id){
    if (technique === id) return;              /* radio, not toggle */
    technique = id;
    /* Leaving RSI leaves its variant behind with it. */
    if (technique !== 'rsi') rsiVariant = null;
    /* RSI BEFORE ITS VARIANT IS A STRATEGY WITH NO REGIMEN. It resolves to
       no preset key, so there is nothing to apply and the previous regimen
       has to go — otherwise the board shows IV's or TIVA's agents under a
       rapid sequence heading. Asked generally, not by naming RSI. */
    if (presetKeyFor(technique, rsiVariant))
      applyPreset(technique, rsiVariant, { force:true });
    else
      retireAppliedPresetPlan({ force:true });
    render();
  }
  /* Records which rapid sequence, and loads that variant's regimen —
     rsi/classic or rsi/modified. In v1 the two select the same agents.

     Choosing a variant is the same kind of event as choosing a strategy, so
     it forces for the same reason, and pressing the active variant is the
     same no-op.

     NEITHER VARIANT CARRIES A DOSE. contextFor() returns the same rapid
     sequence context for both, nothing here touches it, and no dose or
     phase record is duplicated per variant. */
  function setRsiVariant(id){
    if (technique !== 'rsi') return;
    if (rsiVariant === id) return;             /* radio, not toggle */
    rsiVariant = id;
    applyPreset(technique, rsiVariant, { force:true });
    render();
  }

  /* "Apply suggested plan", and any future reset control, are this call. */
  function applySuggestedPlan(){
    if (!technique) return;
    applyPreset(technique, rsiVariant, { force:true });
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
  /* SELECTION IS A TOGGLE, IN PLACE. Adding is adding and removing is
     removing; a role may hold more than one agent. Focus returns to the row's
     own button after the re-render, so pressing USE on the eleventh drug does
     not throw the keyboard back to the first. */
  /* THE MANUAL PATH. Goes through setPlanSelection with source 'manual', so
     pressing a card, or USE in the drug reference which calls this same
     function, is what marks the plan as the clinician's. */
  function toggle(key, id){
    setPlanSelection(key, id, idsFor(key).indexOf(id) < 0, 'manual');
    render();
    var el = document.querySelector('#induction-host [data-plan-for="' + id + '"]');
    if (el) el.focus({ preventScroll:true });
  }

  /* Removal is always explicit, and always of ONE agent. */
  function remove(key, id){
    setPlanSelection(key, id, false, 'manual');
    render();
  }

  function clearPlan(){
    picked = {}; planCustomized = false; appliedPresetKey = null; render();
  }

  /* New Case ends a case, and a plan belongs to the case that was ended.
     rsiVariant WAS LEFT BEHIND HERE. setTechnique() clears it when the
     technique changes, but clear() assigns technique directly and so never
     ran that line: a case begun after New Case could still be carrying
     'modified' from the case before it. Nothing rendered it once technique
     was null, which is why it went unnoticed, and it would have surfaced the
     moment rsiVariant started choosing a preset. */
  function clear(){
    picked = {}; technique = null; rsiVariant = null;
    planCustomized = false; appliedPresetKey = null;
    render();
  }

  /* Opens the crisis protocol IN PLACE — the induction plan stays on screen
     behind it. The keys are the protocol's own keys in CRISIS, so this names
     the protocol it means rather than its position in a list. */
  function protocol(key){
    if (root.crisisPreviewByKey) root.crisisPreviewByKey(key);
  }

  root.Induction = { render:render, protocol:protocol,
                     toggle:toggle, remove:remove, openRole:openRoleFn,
                     clearPlan:clearPlan, clear:clear,
                     setTechnique:setTechnique, setRsiVariant:setRsiVariant,
                     applySuggestedPlan:applySuggestedPlan,
                     /* READ ONLY. Ownership is reported, never assigned from
                        outside: the only things that may change it are a
                        clinician's action and a preset application. */
                     get planCustomized(){ return planCustomized; },
                     get appliedPresetKey(){ return appliedPresetKey; },
                     /* TEST SEAM. The shipped presets are empty, so the
                        eligibility and substitution rules have nothing real
                        to be proved against. This lets a suite install a
                        synthetic preset and assert what the engine does with
                        it. It is the only writable hook and it touches no
                        clinical content: a preset is ids. */
                     __presetsForTest:function (p){
                       if (p === undefined) return STRATEGY_PLANS;
                       STRATEGY_PLANS = p; return STRATEGY_PLANS; },
                     __resolvePresetForTest:function (t, v){ return resolvePreset(t, v); },
                     get roles(){ return ROLES.map(function (r){ return r.key; }); },
                     get technique(){ return technique; },
                     /* CANONICAL IDS ONLY. The drug reference reads this to
                        light its own buttons, and a catalog key is not a drug. */
                     get plan(){ return pickedList().map(function (d){ return d.id; }); },
                     /* Everything the clinician has declared, both kinds. */
                     get planKeys(){ var out = [];
                       Object.keys(picked).forEach(function (r){
                         idsFor(r).forEach(function (k){ out.push(r + '/' + k); }); });
                       return out; },
                     get displayPlanKeys(){ var out = [];
                       Object.keys(picked).forEach(function (r){
                         idsFor(r).forEach(function (k){
                           if (isCatalogKey(k)) out.push(k); }); });
                       return out; } };
})(typeof window !== 'undefined' ? window : this);
