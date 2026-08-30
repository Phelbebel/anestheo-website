/* procedures.js — THE PROCEDURE CATALOGUE
   ═══════════════════════════════════════════════════════════════════════════
   Procedures are not drugs and do not live in the drug index. clinical-index.js
   remains the single source for drugs, pharmacologic classes, aliases, dose
   definitions and drug search; this file is the single source for procedures
   and for what a procedure implies about the patient in front of you.

   The two are searched with the same fuzzy matcher and presented with the same
   UX, and they share nothing else.

   ── WHAT A RULE MAY SAY ───────────────────────────────────────────────────
   Only structural facts about the procedure. `obstetricOnly` on a Caesarean
   section is not a clinical judgement — it is what the operation is. An age
   threshold is a clinical judgement, and none is written here, because none
   of them is available from a verified source in this repository. A procedure
   with no defensible rule simply carries no rule and stays compatible with
   everything; that is the honest default, and it is safer than a guess.

   NOT ENCODED, AND WHY:
     · minimum or maximum ages for any procedure — no verified source
     · weight or ASA thresholds — no verified source
     · specialty-wide applicability rules — a specialty is a filing category,
       not a contraindication

   ── OBSTETRIC CONTEXT ─────────────────────────────────────────────────────
   The single most important rule in this file: obstetric context is NEVER
   inferred from female sex, from age, or from the surgical field. A
   hysterectomy is gynaecological, not obstetric, and a patient having one
   must not be shown Caesarean spinal dosing, labour epidural mixes or
   uterotonics. Only a procedure marked obstetricOnly, or an explicit
   obstetric context recorded elsewhere, activates that content.

   ── FIELDS ────────────────────────────────────────────────────────────────
     id             stable key
     label          what the clinician sees
     aliases        search terms, including ward shorthand and spellings
     specialty      filing category only; carries no applicability meaning
     contextTags    what this procedure makes true about the case
     ageApplicability  { minYears, maxYears } — omitted unless sourced
     obstetricOnly  the procedure is performed on a pregnant/delivering patient
     pediatricOnly  the procedure is performed only on children
     adultOnly      the procedure is performed only on adults
*/
(function (root) {
  'use strict';

  var PROCEDURES = [
    /* ── OBSTETRIC ─────────────────────────────────────────────────────────
       These are the only entries in this file that change what clinical
       content the page loads, which is why they are the only ones written so
       far with a hard applicability flag. */
    { id: 'proc.caesarean',
      label: 'Caesarean section',
      aliases: ['caesarean section', 'cesarean section', 'c-section', 'c section',
                'caesarian', 'cesarian', 'lscs', 'lower segment caesarean', 'c/s'],
      specialty: 'obstetrics',
      contextTags: ['obstetric', 'neuraxial-common', 'uterotonic-relevant'],
      obstetricOnly: true },

    { id: 'proc.labour-epidural',
      label: 'Labour epidural',
      aliases: ['labour epidural', 'labor epidural', 'epidural for labour',
                'labour analgesia', 'labor analgesia'],
      specialty: 'obstetrics',
      contextTags: ['obstetric', 'neuraxial-common'],
      obstetricOnly: true },

    { id: 'proc.vaginal-delivery',
      label: 'Vaginal delivery',
      aliases: ['vaginal delivery', 'normal delivery', 'svd',
                'spontaneous vaginal delivery', 'delivery'],
      specialty: 'obstetrics',
      contextTags: ['obstetric', 'uterotonic-relevant'],
      obstetricOnly: true },

    { id: 'proc.erpc',
      label: 'Evacuation of retained products',
      aliases: ['erpc', 'evacuation of retained products', 'erpoc'],
      specialty: 'obstetrics',
      contextTags: ['obstetric', 'uterotonic-relevant'],
      obstetricOnly: true },

    /* ── GYNAECOLOGY — recognised, and deliberately NOT obstetric ──────────
       These exist in the catalogue precisely so that they resolve to
       themselves instead of being swept up by a regex looking for "gyn". A
       hysterectomy is a gynaecological operation on a patient who is not
       delivering, and it must not open obstetric references. */
    { id: 'proc.hysterectomy',
      label: 'Hysterectomy',
      aliases: ['hysterectomy', 'total abdominal hysterectomy', 'tah',
                'laparoscopic hysterectomy', 'vaginal hysterectomy'],
      specialty: 'gynaecology',
      contextTags: ['pelvic', 'abdominal'] },

    { id: 'proc.laparoscopic-gynae',
      label: 'Gynaecological laparoscopy',
      aliases: ['gynaecological laparoscopy', 'gynecological laparoscopy',
                'diagnostic laparoscopy gynae', 'laparoscopic ovarian cystectomy'],
      specialty: 'gynaecology',
      contextTags: ['pelvic', 'laparoscopic'] },

    /* ── GENERAL / OTHER ───────────────────────────────────────────────────
       Present so the selector can recognise ordinary work and say so. None of
       them changes what content loads; they carry contextTags only. */
    { id: 'proc.lap-chole',
      label: 'Laparoscopic cholecystectomy',
      aliases: ['laparoscopic cholecystectomy', 'lap chole', 'cholecystectomy'],
      specialty: 'general surgery',
      contextTags: ['laparoscopic', 'abdominal'] },

    { id: 'proc.appendicectomy',
      label: 'Appendicectomy',
      aliases: ['appendicectomy', 'appendectomy', 'lap appendicectomy'],
      specialty: 'general surgery',
      contextTags: ['abdominal'] },

    { id: 'proc.inguinal-hernia',
      label: 'Inguinal hernia repair',
      aliases: ['inguinal hernia', 'inguinal hernia repair', 'hernia repair',
                'herniotomy'],
      specialty: 'general surgery',
      contextTags: ['abdominal', 'regional-suitable'] },

    { id: 'proc.colectomy',
      label: 'Colectomy',
      aliases: ['colectomy', 'laparoscopic colectomy', 'hemicolectomy',
                'bowel resection'],
      specialty: 'general surgery',
      contextTags: ['abdominal', 'major'] },

    { id: 'proc.tonsillectomy',
      label: 'Tonsillectomy',
      aliases: ['tonsillectomy', 'adenotonsillectomy', 'tonsils'],
      specialty: 'ent',
      contextTags: ['shared-airway'] },

    { id: 'proc.knee-arthroscopy',
      label: 'Knee arthroscopy',
      aliases: ['knee arthroscopy', 'arthroscopy', 'knee scope'],
      specialty: 'orthopaedics',
      contextTags: ['regional-suitable'] },

    { id: 'proc.total-knee',
      label: 'Total knee replacement',
      aliases: ['total knee replacement', 'tkr', 'knee replacement',
                'total knee arthroplasty', 'tka'],
      specialty: 'orthopaedics',
      contextTags: ['regional-suitable', 'major'] },

    { id: 'proc.total-hip',
      label: 'Total hip replacement',
      aliases: ['total hip replacement', 'thr', 'hip replacement',
                'total hip arthroplasty', 'tha'],
      specialty: 'orthopaedics',
      contextTags: ['regional-suitable', 'major'] },

    { id: 'proc.cataract',
      label: 'Cataract surgery',
      aliases: ['cataract', 'cataract surgery', 'phacoemulsification', 'phaco'],
      specialty: 'ophthalmology',
      contextTags: ['sedation-common'] },

    { id: 'proc.turp',
      label: 'TURP',
      aliases: ['turp', 'transurethral resection of prostate',
                'prostate resection'],
      specialty: 'urology',
      contextTags: ['pelvic', 'regional-suitable'] }
  ];

  /* ── SEARCH ───────────────────────────────────────────────────────────────
     Normalised substring matching over label and aliases. The same shape the
     drug search uses, so the selector behaves the same way, but reading from
     this catalogue and no other. */
  function norm(s){
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[‐-―]/g, '-')
      .replace(/[^a-z0-9/+ -]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function search(q, limit){
    var n = norm(q);
    if (!n) return [];
    var out = [];
    for (var i = 0; i < PROCEDURES.length; i++){
      var p = PROCEDURES[i];
      var hay = [p.label].concat(p.aliases || []).map(norm);
      var best = -1;
      for (var j = 0; j < hay.length; j++){
        var at = hay[j].indexOf(n);
        if (at < 0) continue;
        /* a match at the start of a name beats one buried in the middle, and
           an exact name beats a prefix */
        var score = (hay[j] === n ? 0 : at === 0 ? 1 : 2) + (j === 0 ? 0 : 0.5);
        if (best < 0 || score < best) best = score;
      }
      if (best >= 0) out.push({ p: p, score: best });
    }
    out.sort(function (a, b){ return a.score - b.score || a.p.label.localeCompare(b.p.label); });
    return out.slice(0, limit || 8).map(function (x){ return x.p; });
  }

  /* An exact-enough match for free text typed straight into the field. Only a
     whole-string hit against a label or alias counts: a partial word must not
     silently promise that a procedure was recognised. */
  function match(text){
    var n = norm(text);
    if (!n) return null;
    for (var i = 0; i < PROCEDURES.length; i++){
      var p = PROCEDURES[i];
      var hay = [p.label].concat(p.aliases || []).map(norm);
      for (var j = 0; j < hay.length; j++) if (hay[j] === n) return p;
    }
    return null;
  }

  function byId(id){
    for (var i = 0; i < PROCEDURES.length; i++) if (PROCEDURES[i].id === id) return PROCEDURES[i];
    return null;
  }

  /* ── COMPATIBILITY ────────────────────────────────────────────────────────
     Four states, and only four:

       free-text        nothing recognised. Allowed. No procedure-specific
                        module activates, and nothing is claimed about it.
       valid            recognised, and nothing in the recorded context
                        contradicts it.
       requires-context recognised, but a field the rule needs has not been
                        recorded yet. Not an error — a gap.
       incompatible     recognised, and the recorded context contradicts it.

     `reasons` are written for a clinician to read, not for a log. */
  function compatibility(p, ctx){
    if (!p) return { state:'free-text', reasons:[] };
    ctx = ctx || {};
    var missing = [], conflicts = [];

    if (p.obstetricOnly){
      if (ctx.sex == null || ctx.sex === '') missing.push('sex has not been recorded');
      else if (ctx.sex !== 'F') conflicts.push('the recorded sex is male');
    }
    if (p.pediatricOnly){
      if (ctx.ageYears == null) missing.push('age has not been recorded');
      else if (ctx.ageYears >= 16) conflicts.push('the recorded age is adult');
    }
    if (p.adultOnly){
      if (ctx.ageYears == null) missing.push('age has not been recorded');
      else if (ctx.ageYears < 16) conflicts.push('the recorded age is paediatric');
    }
    /* ageApplicability is honoured if a catalogue entry ever carries one.
       None does today, deliberately — see the header. */
    var aa = p.ageApplicability;
    if (aa && ctx.ageYears != null){
      if (aa.minYears != null && ctx.ageYears < aa.minYears)
        conflicts.push('the recorded age is below the range for this procedure');
      if (aa.maxYears != null && ctx.ageYears > aa.maxYears)
        conflicts.push('the recorded age is above the range for this procedure');
    }

    if (conflicts.length) return { state:'incompatible', reasons:conflicts };
    if (missing.length)   return { state:'requires-context', reasons:missing };
    return { state:'valid', reasons:[] };
  }

  root.ProcedureIndex = {
    PROCEDURES: PROCEDURES,
    search: search,
    match: match,
    byId: byId,
    compatibility: compatibility,
    normalize: norm
  };
})(typeof window !== 'undefined' ? window : this);
