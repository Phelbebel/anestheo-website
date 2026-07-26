/* ============================================================================
   EvidenceDrawer — the ONE reusable "Check our work" component  (Phase 1)

   EvidenceDrawer.attach(container, evidenceId, opts?)
     Appends a "Check our work" trigger + an accessible disclosure region to
     `container`. On first open it fetches getEvidence(evidenceId) and renders.
     opts.fixture  : render this object instead of fetching (used by tests)
     opts.label    : custom trigger label (default "Check our work")

   Rules honoured:
     - Rows render ONLY when the data exists. No "N/A", no placeholder, no
       fabricated value. Absent field => absent row.
     - Not-published / unknown => the approved Draft state.
     - Accessible: <button aria-expanded aria-controls>, Esc closes, focus
       returns to the trigger, region is labelled. Reduced-motion respected.
     - review_type / evidence_basis render as PLAIN TEXT, never coloured
       achievement badges (Anti-marketing rule).
   ========================================================================== */
(function (global) {
  var seq = 0;

  var REVIEW_LABEL = {
    founder: 'Founder-reviewed',
    internal_clinical: 'Internal clinical review',
    external_clinical: 'External clinical review'
  };
  var BASIS_LABEL = {
    source_based: 'Source based',
    guideline_based: 'Guideline based',
    consensus_based: 'Consensus based',
    calculation_based: 'Calculation based'
  };
  var DRAFT_TEXT = 'Source and review information is not yet published for this tool.';
  var DISCLAIMER = 'Reference tool. Verify against current guidelines and product labeling before use. You remain responsible for the clinical decision.';

  function esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function has(v) {
    return v != null && !(typeof v === 'string' && v.trim() === '') &&
           !(Array.isArray(v) && v.length === 0);
  }
  function row(k, vHtml) { return '<div class="cow-row"><div class="cow-k">' + esc(k) + '</div><div class="cow-v">' + vHtml + '</div></div>'; }
  function list(items) { return '<ul>' + items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'; }

  function injectCss() {
    if (document.getElementById('cow-css')) return;
    var css = document.createElement('style');
    css.id = 'cow-css';
    css.textContent =
      '.cow-wrap{margin-top:12px;}' +
      '.cow-trigger{display:inline-flex;align-items:center;gap:7px;font-family:inherit;font-size:12.5px;font-weight:700;color:#7ECFC0;background:rgba(126,207,192,.08);border:1px solid rgba(126,207,192,.28);border-radius:8px;padding:8px 13px;cursor:pointer;min-height:40px;-webkit-tap-highlight-color:transparent;}' +
      '.cow-trigger:hover{background:rgba(126,207,192,.14);}' +
      '.cow-trigger:focus-visible{outline:2px solid #7ECFC0;outline-offset:2px;}' +
      '.cow-trigger .cow-chev{font-size:10px;transition:transform .2s ease;}' +
      '.cow-trigger[aria-expanded="true"] .cow-chev{transform:rotate(180deg);}' +
      '.cow-region{margin-top:10px;border:1px solid rgba(126,207,192,.22);border-radius:12px;background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.012));padding:16px 18px;color:#EAF1EE;}' +
      '.cow-region:focus{outline:none;}' +
      '.cow-title{font-size:13px;font-weight:800;color:#fff;margin:0 0 12px;display:flex;justify-content:space-between;align-items:center;gap:12px;}' +
      '.cow-close{background:none;border:none;color:rgba(255,255,255,.6);font-size:18px;line-height:1;cursor:pointer;padding:4px;min-width:32px;min-height:32px;border-radius:6px;}' +
      '.cow-close:hover{color:#fff;}.cow-close:focus-visible{outline:2px solid #7ECFC0;outline-offset:2px;}' +
      '.cow-row{display:grid;grid-template-columns:136px 1fr;gap:14px;padding:7px 0;border-top:1px solid rgba(255,255,255,.06);font-size:13px;line-height:1.5;}' +
      '.cow-row:first-child{border-top:none;}' +
      '.cow-k{color:rgba(255,255,255,.5);font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding-top:2px;}' +
      '.cow-v{color:#EAF1EE;}.cow-v ul{margin:0;padding-left:16px;}.cow-v li{margin:2px 0;}' +
      '.cow-v .cow-sub{color:rgba(255,255,255,.5);font-size:12px;}' +
      '.cow-draft{font-size:13px;line-height:1.6;color:rgba(255,255,255,.7);margin:0;}' +
      '.cow-disc{margin-top:14px;font-size:11px;line-height:1.55;color:rgba(255,255,255,.45);}' +
      '.cow-ref{margin-top:10px;font-size:10.5px;letter-spacing:.06em;color:rgba(255,255,255,.35);font-variant-numeric:tabular-nums;}' +
      '.cow-hist{margin-top:2px;}.cow-hist summary{cursor:pointer;font-size:12px;color:#7ECFC0;}.cow-hist ul{margin:8px 0 0;padding-left:16px;}.cow-hist li{font-size:12px;color:rgba(255,255,255,.6);margin:4px 0;}' +
      '@media(prefers-reduced-motion:no-preference){.cow-region.cow-anim{animation:cowIn .22s ease;}@keyframes cowIn{from{opacity:0;transform:translateY(-4px);}to{opacity:1;transform:none;}}}' +
      '@media(max-width:560px){.cow-row{grid-template-columns:1fr;gap:2px;}}';
    document.head.appendChild(css);
  }

  // Build the inner HTML of the drawer body from an evidence object (or null).
  function bodyHtml(ev, titleId) {
    var published = ev && (ev.publication_status === 'published' ||
      (ev.publication_status === 'under_revision')) && ev.review_type && ev.review_type !== 'none';

    var head = '<div class="cow-title" id="' + titleId + '">Check our work' +
      (ev && ev.title ? ' &mdash; ' + esc(ev.title) : '') +
      '<button type="button" class="cow-close" aria-label="Close">&times;</button></div>';

    if (!published) {
      // Draft / not-published / unknown — approved honest state, no invented rows.
      var ref = ev && ev.evidence_id ? '<div class="cow-ref">Ref ' + esc(ev.evidence_id) + '</div>' : '';
      return head + '<p class="cow-draft">' + esc(DRAFT_TEXT) + '</p>' + ref;
    }

    var rows = '';
    if (ev.publication_status === 'under_revision') {
      rows += row('Status', 'Under revision. The previously reviewed version is shown.');
    }
    if (has(REVIEW_LABEL[ev.review_type])) rows += row('Review', esc(REVIEW_LABEL[ev.review_type]));
    if (has(BASIS_LABEL[ev.evidence_basis])) rows += row('Basis', esc(BASIS_LABEL[ev.evidence_basis]));

    if (has(ev.sources)) {
      var srcHtml = ev.sources.map(function (s) {
        var sub = [s.version, s.publication_date].filter(has).join(' · ');
        var nm = has(s.url) ? '<a href="' + esc(s.url) + '" rel="noopener" target="_blank">' + esc(s.name) + '</a>' : esc(s.name);
        return '<div>' + nm + (sub ? ' <span class="cow-sub">' + esc(sub) + '</span>' : '') +
               (has(s.citation) ? '<div class="cow-sub">' + esc(s.citation) + '</div>' : '') + '</div>';
      }).join('');
      rows += row('Source', srcHtml);
    }
    if (has(ev.calculation_basis)) rows += row('Calculation basis', esc(ev.calculation_basis));
    if (has(ev.scope)) rows += row('Scope', esc(ev.scope));
    if (has(ev.assumptions)) rows += row('Assumptions', list(ev.assumptions));
    if (has(ev.limitations)) rows += row('Limitations', list(ev.limitations));

    if (ev.reviewer && has(ev.reviewer.name)) {
      var who = esc(ev.reviewer.name) + (has(ev.reviewer.role) ? ', ' + esc(ev.reviewer.role) : '');
      if (has(ev.reviewed_at)) who += ' <span class="cow-sub">· ' + esc(ev.reviewed_at) + '</span>';
      rows += row('Reviewed', who);
      if (has(ev.reviewer.independent_of)) rows += row('Independent of', esc(ev.reviewer.independent_of));
    }
    if (has(ev.notes)) rows += row('Notes', esc(ev.notes));

    if (has(ev.change_history)) {
      var hist = '<details class="cow-hist"><summary>Change history</summary><ul>' +
        ev.change_history.map(function (h) {
          var d = has(h.changed_at) ? String(h.changed_at).slice(0, 10) + ' — ' : '';
          return '<li>' + esc(d) + esc(h.summary) + (has(h.changed_by) ? ' <span class="cow-sub">(' + esc(h.changed_by) + ')</span>' : '') + '</li>';
        }).join('') + '</ul></details>';
      rows += row('History', hist);
    }

    var ref2 = ev.evidence_id ? '<div class="cow-ref">Ref ' + esc(ev.evidence_id) + '</div>' : '';
    return head + rows + '<div class="cow-disc">' + esc(DISCLAIMER) + '</div>' + ref2;
  }

  function attach(container, evidenceId, opts) {
    opts = opts || {};
    injectCss();
    var id = 'cow-' + (++seq);
    var wrap = document.createElement('div');
    wrap.className = 'cow-wrap';

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cow-trigger';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', id);
    trigger.innerHTML = esc(opts.label || 'Check our work') + ' <span class="cow-chev" aria-hidden="true">&#9660;</span>';

    var region = document.createElement('div');
    region.className = 'cow-region';
    region.id = id;
    region.setAttribute('role', 'region');
    region.setAttribute('tabindex', '-1');
    region.hidden = true;

    wrap.appendChild(trigger);
    wrap.appendChild(region);
    container.appendChild(wrap);

    var loaded = false;

    async function ensureContent() {
      if (loaded) return;
      var ev = ('fixture' in opts) ? opts.fixture
             : (typeof global.getEvidence === 'function' ? await global.getEvidence(evidenceId) : null);
      if (ev == null) ev = { evidence_id: evidenceId };  // unknown -> Draft state, id preserved
      var titleId = id + '-title';
      region.innerHTML = bodyHtml(ev, titleId);
      region.setAttribute('aria-labelledby', titleId);
      var closeBtn = region.querySelector('.cow-close');
      if (closeBtn) closeBtn.addEventListener('click', close);
      loaded = true;
    }
    async function open() {
      await ensureContent();
      region.hidden = false;
      region.classList.add('cow-anim');
      trigger.setAttribute('aria-expanded', 'true');
      region.focus();
    }
    function close() {
      region.hidden = true;
      region.classList.remove('cow-anim');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus();
    }
    function toggle() { (trigger.getAttribute('aria-expanded') === 'true') ? close() : open(); }

    trigger.addEventListener('click', toggle);
    region.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } });

    return { open: open, close: close, trigger: trigger, region: region };
  }

  global.EvidenceDrawer = { attach: attach, _bodyHtml: bodyHtml };
})(typeof window !== 'undefined' ? window : this);
