// ============================================================
// Anestheo /v2 — Journey derivation (WORKFLOW_REFERENCE.md §1 + §6)
//
// SINGLE SOURCE OF TRUTH: care_request.status + review_state + set-once
// milestones. journey_status, stage, pill and next-step are DERIVED here and
// nowhere else. This function is pure — no I/O, no globals — so it can be unit
// tested and reused by both patient and clinician surfaces.
// ============================================================
(function () {
  // §6 pill vocabulary
  var PILLS = {
    waiting:      { glyph: '🟡', label: 'Waiting for clinician' },          // 🟡
    under_review: { glyph: '🟢', label: 'Under review' },                   // 🟢
    reviewed:     { glyph: '✅',       label: 'Reviewed' },                        // ✅
    changes:      { glyph: '❌',       label: 'Requires additional information' }  // ❌
  };

  function out(journeyStatus, stage, pillKey, header, connectionLine, nextStep) {
    var p = PILLS[pillKey];
    return {
      journeyStatus: journeyStatus,
      stage: stage,            // 1..10
      pill: p.glyph,
      pillKey: pillKey,
      pillLabel: p.label,
      header: header,
      connectionLine: connectionLine,
      nextStep: nextStep
    };
  }

  // ctx (all optional):
  //   hasSurgery            bool
  //   questionnaireStatus   'none' | 'in_progress' | 'submitted'
  //   careRequestStatus     'none' | 'requested' | 'accepted' | 'declined' | 'revoked' | 'closed'
  //   doctorName            string
  //   reviewState           'not_submitted' | 'pending' | 'in_review' | 'changes_requested' | 'approved'
  //   readyAt, completedAt, recoveryStartedAt, archivedAt   truthy when reached
  //   reviewerNotes         string (shown on changes_requested)
  function deriveJourney(ctx) {
    ctx = ctx || {};
    var rs = ctx.reviewState || 'not_submitted';
    var cr = ctx.careRequestStatus || 'none';
    var dn = ctx.doctorName || 'your clinician';

    // ── Derived journey_status (§1 mapping, top-down, first match wins) ──
    var js;
    if (ctx.archivedAt)            js = 'archived';
    else if (ctx.recoveryStartedAt) js = 'in_recovery';
    else if (ctx.completedAt)      js = 'completed';
    else if (ctx.readyAt)          js = 'ready_for_surgery';
    else if (rs === 'approved')    js = 'plan_approved';
    else if (rs === 'changes_requested') js = 'changes_requested';
    else if (rs === 'in_review')   js = 'in_review';
    else if (rs === 'pending')     js = 'submitted_for_review';
    else                           js = 'preparing';

    // ── Connection line (derived from care_request.status) ──
    var connection;
    if (cr === 'requested')      connection = 'Request sent to ' + dn;
    else if (cr === 'accepted')  connection = 'Connected · ' + dn;
    else if (cr === 'declined')  connection = 'Request declined by ' + dn;
    else                         connection = 'Not connected';

    // ── Stage / pill / header / next-step (§6) ──
    if (js === 'preparing') {
      // 🟡 throughout; granularity comes from the next-step line.
      if (!ctx.hasSurgery)
        return out(js, 1, 'waiting', 'Start your surgery journey', connection,
                   'Add your surgery to begin.');
      if (ctx.questionnaireStatus !== 'submitted')
        return out(js, 2, 'waiting', 'Health questionnaire', connection,
                   'Complete your health questionnaire.');
      if (cr !== 'accepted')
        return out(js, 3, 'waiting', 'Connect with a clinician', connection,
                   cr === 'requested'
                     ? ('Waiting for ' + dn + ' to accept your request.')
                     : 'Connect with a clinician to begin your review.');
      // Both prerequisites met (Inv6) but not yet submitted.
      return out(js, 3, 'waiting', 'Ready to submit', connection,
                 'Submit your questionnaire for review.');
    }
    if (js === 'submitted_for_review')
      return out(js, 4, 'waiting', 'Awaiting review', connection,
                 dn + ' will review your questionnaire soon — nothing to do right now.');
    if (js === 'in_review')
      return out(js, 5, 'under_review', 'Under review', connection,
                 dn + ' is reviewing your questionnaire.');
    if (js === 'changes_requested')
      return out(js, 5, 'changes', 'Requires additional information', connection,
                 dn + ' needs more information.' +
                 (ctx.reviewerNotes ? (' ' + ctx.reviewerNotes) : '') +
                 ' Update your questionnaire and resubmit.');
    if (js === 'plan_approved')
      return out(js, 6, 'reviewed', 'Preparation plan ready', connection,
                 'Your reviewed plan is ready — review your approved plan.');
    if (js === 'ready_for_surgery')
      return out(js, 7, 'reviewed', 'Ready for surgery', connection,
                 "You're ready for surgery. Bring your plan on the day.");
    if (js === 'completed')
      return out(js, 8, 'reviewed', 'Surgery completed', connection,
                 'Start your recovery guide.');
    if (js === 'in_recovery')
      return out(js, 9, 'reviewed', 'Recovery', connection,
                 'Follow your recovery steps and report any concerns.');
    // archived
    return out(js, 10, 'reviewed', 'Lifetime anesthesia record', connection,
               'Your anesthesia record is saved and available anytime.');
  }

  window.deriveJourney = deriveJourney;
  window.JOURNEY_PILLS = PILLS;
  window.JOURNEY_TOTAL_STAGES = 10;
})();
