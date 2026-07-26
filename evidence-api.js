/* ============================================================================
   Evidence Transparency — client API wrapper  (Phase 1, refined in 1.1)
   Calls the SECURITY DEFINER get_evidence(tool_slug) function.

   Evidence is resolved by tool_slug (the PUBLIC ROUTING identifier). The
   returned payload still carries evidence_id (the permanent AUDIT identifier),
   which the drawer shows. Routing identity and audit identity are separate.

   Returns, for a given tool_slug:
     - a published payload object with ONLY the fields that exist, or
     - a minimal lifecycle object { evidence_id, publication_status, review_type:'none', ... }
       for anything not published (the UI shows the Draft state), or
     - null if the slug is unknown or the backend is unreachable.

   review_version is NOT returned here — it is an internal audit field.
   It never fabricates data; it only forwards what the database returns.
   ========================================================================== */
(function (global) {
  async function getEvidence(toolSlug) {
    if (!toolSlug) return null;
    var sb = global.sb || (global.window && global.window.sb);
    if (!sb || typeof sb.rpc !== 'function') return null;
    try {
      var res = await sb.rpc('get_evidence', { p_tool_slug: toolSlug });
      if (res && res.error) { console.warn('getEvidence:', res.error.message); return null; }
      return (res && res.data) ? res.data : null;   // jsonb -> object | null
    } catch (e) {
      console.warn('getEvidence:', e && e.message ? e.message : e);
      return null;
    }
  }
  global.getEvidence = getEvidence;
})(typeof window !== 'undefined' ? window : this);
