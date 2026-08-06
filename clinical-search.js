/* ============================================================================
   ANESTHEO — CLINICAL COMMAND PALETTE
   ----------------------------------------------------------------------------
   One search surface over the one clinical index (clinical-index.js). There is
   no second index and no hard-coded navigation list.

   Behaviour: instant results, arrow/Enter/Escape, grouped, match highlighting,
   recent searches, and a result that opens the exact row — not the top of a
   module. Staff only; the host page decides who may open it.

   Unpublished clinical content is never returned: ClinicalContent.search()
   filters it out unless explicitly asked, and this file never asks.
   ==========================================================================*/
(function (global) {
'use strict';

var RECENT_KEY = 'anestheo_clin_recent';
var ENGINE = '/v2/engine.html';
var open = false, sel = 0, hits = [], flat = [];

/* ── styles (injected once) ─────────────────────────────────────────── */
var CSS = [
'.cp-bg{position:fixed;inset:0;z-index:9998;background:rgba(4,12,9,.72);',
'  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);display:flex;',
'  align-items:flex-start;justify-content:center;padding:9vh 16px 16px;}',
'.cp{width:100%;max-width:660px;background:#0C1F18;border:1px solid rgba(126,207,192,.24);',
'  border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.6);overflow:hidden;',
'  display:flex;flex-direction:column;max-height:78vh;font-family:"DM Sans",system-ui,sans-serif;}',
'.cp-in{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.07);}',
'.cp-in span{color:#7ECFC0;font-size:15px;flex:0 0 auto;}',
'.cp-in input{flex:1;background:none;border:none;outline:none;color:#fff;font-size:17px;',
'  font-family:inherit;font-weight:500;min-width:0;}',
'.cp-in input::placeholder{color:rgba(255,255,255,.34);}',
'.cp-esc{font-size:10px;font-weight:700;letter-spacing:.06em;color:rgba(255,255,255,.3);',
'  border:1px solid rgba(255,255,255,.16);border-radius:5px;padding:3px 6px;flex:0 0 auto;}',
'.cp-list{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:6px 0 10px;}',
'.cp-g{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;',
'  color:rgba(255,255,255,.34);padding:12px 18px 6px;}',
'.cp-i{display:flex;align-items:baseline;gap:12px;padding:10px 18px;cursor:pointer;',
'  border-left:2px solid transparent;}',
'.cp-i:hover{background:rgba(255,255,255,.035);}',
'.cp-i.on{background:rgba(126,207,192,.13);border-left-color:#7ECFC0;}',
'.cp-n{font-size:15.5px;font-weight:600;color:#fff;line-height:1.3;flex:1 1 auto;min-width:0;}',
'.cp-n mark{background:none;color:#7ECFC0;font-weight:700;}',
'.cp-s{display:block;font-size:12.5px;font-weight:400;color:rgba(255,255,255,.46);margin-top:2px;line-height:1.4;}',
'.cp-k{font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;',
'  color:rgba(255,255,255,.3);flex:0 0 auto;white-space:nowrap;}',
'.cp-empty{padding:26px 18px;text-align:center;color:rgba(255,255,255,.42);font-size:13.5px;line-height:1.6;}',
'.cp-foot{display:flex;gap:16px;padding:9px 18px;border-top:1px solid rgba(255,255,255,.07);',
'  font-size:11px;color:rgba(255,255,255,.3);font-weight:600;flex-wrap:wrap;}',
'@media(max-width:640px){.cp-bg{padding:0;}.cp{max-width:100%;max-height:100vh;height:100vh;border-radius:0;border:none;}',
'  .cp-in{padding:16px;}.cp-in input{font-size:16px;}.cp-foot{display:none;}',
'  .cp-i{padding:13px 16px;min-height:52px;}}'
].join('');

function injectCss(){
  if (document.getElementById('cp-css')) return;
  var st = document.createElement('style'); st.id = 'cp-css'; st.textContent = CSS;
  document.head.appendChild(st);
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

/* highlight the matched span without letting user input reach the DOM raw */
function mark(text, q){
  var t = esc(text), nq = (window.ClinicalContent ? window.ClinicalContent.norm(q) : q.toLowerCase());
  if (!nq) return t;
  var i = t.toLowerCase().indexOf(nq);
  if (i < 0) return t;
  return t.slice(0,i) + '<mark>' + t.slice(i, i+nq.length) + '</mark>' + t.slice(i+nq.length);
}
function recents(){ try{ return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; }catch(e){ return []; } }
function pushRecent(q){
  try{
    var r = recents().filter(function(x){ return x !== q; });
    r.unshift(q); localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0,8)));
  }catch(e){}
}

var KIND_LABEL = { drug:'Drug', device:'Device', protocol:'Emergency', calculator:'Calculator',
                   block:'Regional', score:'Score', reference:'Reference', prophylaxis:'Prophylaxis' };

function render(q){
  var list = document.getElementById('cp-list'); if (!list) return;
  flat = [];
  if (!q || q.trim().length < 2){
    var r = recents();
    if (!r.length){
      list.innerHTML = '<div class="cp-empty">Search drugs, tubes, blocks, emergencies, calculators and scores.</div>';
      return;
    }
    list.innerHTML = '<div class="cp-g">Recent</div>' + r.map(function(x,i){
      flat.push({ recent:x });
      return '<div class="cp-i'+(i===sel?' on':'')+'" data-i="'+i+'"><span class="cp-n">'+esc(x)+'</span>'+
             '<span class="cp-k">Recent</span></div>';
    }).join('');
    return;
  }
  hits = window.ClinicalContent.grouped(q, { limit:40 });
  if (!hits.length){
    list.innerHTML = '<div class="cp-empty">No clinical match for &ldquo;'+esc(q)+'&rdquo;.<br>'+
      'Try a generic name, an abbreviation or an indication.</div>';
    return;
  }
  var html = '', i = 0;
  hits.forEach(function(g){
    html += '<div class="cp-g">'+esc(g.group)+'</div>';
    g.hits.forEach(function(h){
      flat.push(h.item);
      html += '<div class="cp-i'+(i===sel?' on':'')+'" data-i="'+i+'">'+
        '<span class="cp-n">'+mark(h.item.name, q)+
        (h.item.summary ? '<span class="cp-s">'+esc(h.item.summary)+'</span>' : '')+'</span>'+
        '<span class="cp-k">'+esc(KIND_LABEL[h.item.kind] || '')+'</span></div>';
      i++;
    });
  });
  list.innerHTML = html;
  var on = list.querySelector('.cp-i.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block:'nearest' });
}

function choose(idx){
  var it = flat[idx]; if (!it) return;
  if (it.recent){
    var inp = document.getElementById('cp-q');
    if (inp){ inp.value = it.recent; sel = 0; render(it.recent); inp.focus(); }
    return;
  }
  var q = (document.getElementById('cp-q')||{}).value || '';
  if (q.trim().length >= 2) pushRecent(q.trim());
  close();
  /* Same page → resolve in place. Different page → carry the target across. */
  if (global.ClinicalAnchors && global.ClinicalAnchors.reveal){
    global.ClinicalAnchors.reveal(it.id);
  } else {
    global.location.href = ENGINE + '#find=' + encodeURIComponent(it.id);
  }
}

function key(e){
  if (e.key === 'Escape'){ e.preventDefault(); close(); return; }
  if (e.key === 'ArrowDown'){ e.preventDefault(); sel = Math.min(sel+1, flat.length-1); paint(); return; }
  if (e.key === 'ArrowUp'){ e.preventDefault(); sel = Math.max(sel-1, 0); paint(); return; }
  if (e.key === 'Enter'){ e.preventDefault(); choose(sel); return; }
}
function paint(){
  var list = document.getElementById('cp-list'); if (!list) return;
  var items = list.querySelectorAll('.cp-i');
  items.forEach(function(el,i){ el.classList.toggle('on', i === sel); });
  var on = list.querySelector('.cp-i.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block:'nearest' });
}

function close(){
  var bg = document.getElementById('cp-bg');
  if (bg) bg.remove();
  document.removeEventListener('keydown', key, true);
  document.body.style.overflow = '';
  open = false;
}

function openPalette(seed){
  if (open) return; open = true; sel = 0;
  injectCss();
  var bg = document.createElement('div');
  bg.className = 'cp-bg'; bg.id = 'cp-bg';
  bg.innerHTML =
    '<div class="cp" role="dialog" aria-modal="true" aria-label="Clinical search">'+
      '<div class="cp-in"><span>&#9906;</span>'+
        '<input id="cp-q" type="search" autocomplete="off" autocorrect="off" spellcheck="false" '+
          'enterkeyhint="go" placeholder="Search drugs, tubes, blocks, emergencies…" aria-label="Clinical search">'+
        '<span class="cp-esc">ESC</span></div>'+
      '<div class="cp-list" id="cp-list" role="listbox"></div>'+
      '<div class="cp-foot"><span>&uarr;&darr; navigate</span><span>&crarr; open</span><span>esc close</span></div>'+
    '</div>';
  document.body.appendChild(bg);
  document.body.style.overflow = 'hidden';
  bg.addEventListener('click', function(e){ if (e.target === bg) close(); });
  var list = document.getElementById('cp-list');
  list.addEventListener('click', function(e){
    var it = e.target.closest && e.target.closest('.cp-i'); if (!it) return;
    choose(parseInt(it.getAttribute('data-i'), 10));
  });
  var inp = document.getElementById('cp-q');
  inp.addEventListener('input', function(){ sel = 0; render(inp.value); });
  document.addEventListener('keydown', key, true);
  if (seed) inp.value = seed;
  render(inp.value);
  setTimeout(function(){ inp.focus(); }, 40);
}

/* "/" and ⌘K / Ctrl-K open it anywhere a staff user is signed in. */
document.addEventListener('keydown', function(e){
  if (open) return;
  var tag = document.activeElement && document.activeElement.tagName;
  var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag||'') ||
               (document.activeElement && document.activeElement.isContentEditable);
  if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)){
    if (global.ClinicalSearch.enabled){ e.preventDefault(); openPalette(); }
    return;
  }
  if (e.key === '/' && !typing && global.ClinicalSearch.enabled){ e.preventDefault(); openPalette(); }
});

global.ClinicalSearch = { open:openPalette, close:close, enabled:false };
})(typeof window !== 'undefined' ? window : this);
