/* ═════════════════════════════════════════════════════════════════════════
   INDUCTION BOARD CATALOG — COMPOSITION, NOT MEDICINE
   ─────────────────────────────────────────────────────────────────────────
   Which agents appear on the induction board, in which row, in which order.
   That is a formulary-composition decision. Whether an agent has a reviewed
   dose, route, population band or evidence is a CLINICAL decision, and it
   lives in clinical-index.js and nowhere else.

   These two were entangled: the board's membership list was a list of DRUGS
   ids, so an agent had to exist as a clinical record before it could appear
   on the board. Satisfying a 4 x 4 layout therefore meant writing seven
   canonical records that carried no dose and no evidence — fabricating
   clinical objects to fill cells. Those records have been removed and this
   file exists so the pressure that produced them cannot recur.

   WHAT MAY LIVE IN THIS FILE
     key           a stable identifier for the board slot
     canonicalId   the ClinicalContent record, when one exists
     name          the display name, ONLY when no canonical record exists
     visualClass   the colour bucket, ONLY when no canonical record exists
     row label, row role, row order

   WHAT MAY NEVER LIVE IN THIS FILE
     dose, dose range, route, concentration, preparation, warning, age band,
     population rule, RSI dose, recommendation, contraindication, clinical
     note — anything a clinician could read as a clinical claim.

   There is a test that reads this file and fails on any of those words.

   RESOLUTION
     canonicalId resolves and the record has an eligible reviewed dose
       -> the card prints canonical clinical content
     canonicalId resolves but no dose is eligible for this patient/context
       -> the card prints the canonical coverage state
          ("Pediatric dose not reviewed", "RSI dose not reviewed", ...)
     no canonical record at all
       -> the card prints its name and its colour and "Dose not reviewed",
          and invents no route, no dose, no preparation and no amount

   When drug.etomidate is created through the evidence process, its member
   here gains a canonicalId and the same card starts printing reviewed
   content. No layout changes, and nothing in this file becomes clinical.

   visualClass uses ClinicalContent's own PCLASS keys so the colour of a
   member without a record is the SAME colour its class already has on the
   board — 'induction' is the gold hypnotics carry, 'nmb' the coral, 'opioid'
   the blue, 'anticholinergic' the green. It is a colour name, not a claim
   about pharmacology.
   ═════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var INDUCTION_CATALOG = {
    rows: [
      /* The row holds a premedicant, a peri-induction adjunct and two
         anticholinergics used either preoperatively or intraoperatively. The
         title says so rather than forcing four agents into one indication. */
      { key:'premedication', label:'Premedication / adjuncts', role:'induction',
        members:[
          { key:'midazolam',      canonicalId:'drug.midazolam' },
          { key:'lidocaine-iv',   canonicalId:'drug.lidocaine-iv' },
          { key:'atropine',       canonicalId:'drug.atropine' },
          { key:'glycopyrrolate', canonicalId:'drug.glycopyrrolate' }
        ] },

      /* MORPHINE IS ON THIS ROW, AND THE COCKPIT IS FOUR WIDE.
         It was removed in e5e7c43 on the reasoning that its only canonical
         dose is POSTOPERATIVE analgesia, so the card sat here reading "Dose
         not reviewed for this context" — true, and a poor thing to show a
         clinician choosing an opioid at induction. The clinical owner has
         decided otherwise: the four-agent cockpit is the approved board, and
         an opioid a clinician may give is offered here whether or not this
         application holds a reviewed induction dose for it.

         THE CARD WILL READ A COVERAGE STATE, AND THAT IS THE ACCEPTED
         OUTCOME rather than an oversight. It is what the model honestly
         holds for this question, and the alternative — printing the
         postoperative 0.05-0.1 mg/kg under an induction heading — is the
         wrong-context-real-number failure this whole workspace is built to
         prevent. Availability and dose coverage are different facts and the
         card shows both.

         NOTHING CLINICAL CHANGED IN EITHER DIRECTION. The record was not
         touched when morphine left and is not touched now that it returns.
         This file decides which agents the BOARD offers; clinical-index.js
         decides what is known about them, and the two never trade. */
      { key:'analgesia', label:'Analgesia', role:'analgesia',
        members:[
          { key:'fentanyl',     canonicalId:'drug.fentanyl' },
          { key:'remifentanil', canonicalId:'drug.remifentanil' },
          { key:'alfentanil',   canonicalId:'drug.alfentanil' },
          { key:'morphine',     canonicalId:'drug.morphine' }
        ] },

      /* THE FOURTH HYPNOSIS SLOT IS DEXMEDETOMIDINE, AND THIOPENTAL HAS
         LEFT THE COCKPIT — not the formulary.

         81a19d7 made the opposite swap, on the reasoning that
         dexmedetomidine's only reviewed authority is a procedural and ICU
         sedation infusion (0.2-0.7 mcg/kg/h), which is not a rapid
         intravenous induction dose and could never be printed as one, while
         thiopental holds a reviewed adult induction dose. The clinical owner
         has decided that the approved cockpit is the four agents below, and
         that decision is this file's to hold.

         SO THIS CARD READS A COVERAGE STATE, for the same reason morphine's
         does above, and for the same accepted trade: the board offers the
         agent, and the model says plainly that it holds no induction dose
         for it rather than borrowing the sedation infusion rate.

         THIOPENTAL LOSES NOTHING CLINICAL. Its reviewed 4-6 mg/kg induction
         record is untouched, it keeps its drug-reference row and its search
         entry, and it stays selectable into the plan from the reference.
         What it loses is one of four cockpit cards, which is composition. */
      { key:'hypnosis', label:'Hypnosis', role:'induction',
        members:[
          { key:'propofol',        canonicalId:'drug.propofol' },
          { key:'etomidate',       canonicalId:'drug.etomidate' },
          { key:'ketamine',        canonicalId:'drug.ketamine' },
          { key:'dexmedetomidine', canonicalId:'drug.dexmedetomidine' }
        ] },

      { key:'nmb', label:'Neuromuscular blockade', role:'nmb', nmb:true,
        members:[
          { key:'rocuronium',    canonicalId:'drug.rocuronium' },
          { key:'atracurium',    canonicalId:'drug.atracurium' },
          { key:'mivacurium',    canonicalId:'drug.mivacurium' },
          { key:'suxamethonium', canonicalId:'drug.suxamethonium' }
        ] },
      /* ── THE VOLATILE ROW, AND WHY IT IS A ROW ─────────────────────────
         Sevoflurane is not an intravenous hypnotic and does not belong
         beside propofol: different route, different administration, and a
         different question about the dose. It gets its own row and its own
         role so that a plan managing hypnosis cannot empty it and a plan
         managing it cannot empty hypnosis.

         `strategy` IS COMPOSITION, NOT MEDICINE. It says which approach this
         row belongs to, the same kind of fact as which row a member sits in.
         It carries no dose, no concentration and no claim; the row is simply
         not drawn under a strategy it is not part of, because a volatile
         induction row under TIVA is a question nobody asked.

         THE MEMBERS ARE THE SAME RECORDS THE MAINTENANCE WORKSPACE USES.
         One drug.sevoflurane, holding an induction record and a maintenance
         record, and the context the board asks decides which one answers.
         Nothing is duplicated to get it here. */
      { key:'volatile', label:'Volatile induction', role:'volatile',
        strategy:'inhalational',
        members:[
          { key:'sevoflurane', canonicalId:'drug.sevoflurane' },
          { key:'desflurane',  canonicalId:'drug.desflurane' },
          { key:'isoflurane',  canonicalId:'drug.isoflurane' }
        ] }
    ]
  };

  root.InductionCatalog = INDUCTION_CATALOG;
  if (typeof module !== 'undefined' && module.exports) module.exports = INDUCTION_CATALOG;
})(typeof window !== 'undefined' ? window : this);
