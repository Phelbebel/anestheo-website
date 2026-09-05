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
      { key:'premedication', label:'Premedication', role:'induction',
        members:[
          { key:'midazolam',      canonicalId:'drug.midazolam' },
          { key:'lidocaine-iv',   canonicalId:'drug.lidocaine-iv' },
          { key:'atropine',       canonicalId:null, name:'Atropine',
            visualClass:'anticholinergic' },
          { key:'glycopyrrolate', canonicalId:null, name:'Glycopyrrolate',
            visualClass:'anticholinergic' }
        ] },

      { key:'analgesia', label:'Analgesia', role:'analgesia',
        members:[
          { key:'fentanyl',     canonicalId:'drug.fentanyl' },
          { key:'morphine',     canonicalId:'drug.morphine' },
          { key:'remifentanil', canonicalId:'drug.remifentanil' },
          { key:'alfentanil',   canonicalId:null, name:'Alfentanil',
            visualClass:'opioid' }
        ] },

      { key:'hypnosis', label:'Hypnosis', role:'induction',
        members:[
          { key:'propofol',   canonicalId:'drug.propofol' },
          { key:'etomidate',  canonicalId:null, name:'Etomidate',
            visualClass:'induction' },
          { key:'ketamine',   canonicalId:'drug.ketamine' },
          { key:'thiopental', canonicalId:null, name:'Thiopental',
            visualClass:'induction' }
        ] },

      { key:'nmb', label:'Neuromuscular blockade', role:'nmb', nmb:true,
        members:[
          { key:'rocuronium',    canonicalId:'drug.rocuronium' },
          { key:'atracurium',    canonicalId:null, name:'Atracurium',
            visualClass:'nmb' },
          { key:'mivacurium',    canonicalId:null, name:'Mivacurium',
            visualClass:'nmb' },
          { key:'suxamethonium', canonicalId:'drug.suxamethonium' }
        ] }
    ]
  };

  root.InductionCatalog = INDUCTION_CATALOG;
  if (typeof module !== 'undefined' && module.exports) module.exports = INDUCTION_CATALOG;
})(typeof window !== 'undefined' ? window : this);
