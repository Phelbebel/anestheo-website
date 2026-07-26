/* ============================================================================
   Evidence Transparency — client API wrapper  (Phase 1)
   Calls the SECURITY DEFINER get_evidence(evidence_id) function.

   Returns, for a given Evidence ID:
     - a published payload object with ONLY the fields that exist, or
     - a minimal lifecycle object { evidence_id, publication_status, review_type:'none', ... }
       for anything not published (the UI shows the Draft state), or
     - null if the id is unknown or the backend is unreachable.

   It never fabricates data; it only forwards what the database returns.
   ========================================================================== */
(function (global) {
  async function getEvidence(evidenceId) {
    if (!evidenceId) return null;
    var sb = global.sb || (global.window && global.window.sb);
    if (!sb || typeof sb.rpc !== 'function') return null;
    try {
      var res = await sb.rpc('get_evidence', { p_evidence_id: evidenceId });
      if (res && res.error) { console.warn('getEvidence:', res.error.message); return null; }
      return (res && res.data) ? res.data : null;   // jsonb -> object | null
    } catch (e) {
      console.warn('getEvidence:', e && e.message ? e.message : e);
      return null;
    }
  }
  global.getEvidence = getEvidence;
})(typeof window !== 'undefined' ? window : this);
