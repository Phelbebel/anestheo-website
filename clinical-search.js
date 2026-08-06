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
'.cp-bg{position:fixed;inset:0;z-index:9998;background:rgba(4,11,9,.66);',
'  -webkit-backdrop-filter:blur(10px) saturate(120%);backdrop-filter:blur(10px) saturate(120%);',
'  display:flex;align-items:flex-start;justify-content:center;padding:11vh 16px 16px;',
'  animation:cpIn .14s cubic-bezier(.22,.61,.36,1);}',
'@keyframes cpIn{from{opacity:0}to{opacity:1}}',
'.cp{width:100%;max-width:620px;background:#0B1C16;border:1px solid rgba(255,255,255,.09);',
'  border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.4);',
'  overflow:hidden;display:flex;flex-direction:column;max-height:70vh;',
'  font-family:"DM Sans",system-ui,sans-serif;font-feature-settings:"tnum" 1,"lnum" 1;',
'  animation:cpUp .16s cubic-bezier(.22,.61,.36,1);}',
'@keyframes cpUp{from{opacity:0;transform:translateY(-6px) scale(.985)}to{opacity:1;transform:none}}',
'.cp-in{display:flex;align-items:center;gap:11px;padding:13px 16px;',
'  border-bottom:1px solid rgba(255,255,255,.07);}',
'.cp-in span{color:rgba(255,255,255,.32);font-size:14px;flex:0 0 auto;line-height:1;}',
'.cp-in input{flex:1;background:none;border:none;outline:none;color:#fff;font-size:16px;',
'  font-family:inherit;font-weight:500;letter-spacing:-.005em;min-width:0;padding:0;}',
'.cp-in input::placeholder{color:rgba(255,255,255,.3);font-weight:400;}',
'.cp-in input::-webkit-search-cancel-button{display:none;}',
'.cp-list{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:4px 0 6px;scrollbar-width:thin;}',
'.cp-list::-webkit-scrollbar{width:8px;}',
'.cp-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.09);border-radius:4px;}',
'.cp-g{font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;',
'  color:rgba(255,255,255,.3);padding:11px 16px 5px;}',
'.cp-i{display:flex;align-items:center;gap:12px;padding:7px 16px;cursor:pointer;',
'  border-left:2px solid transparent;transition:background .1s cubic-bezier(.22,.61,.36,1);}',
'.cp-i:hover{background:rgba(255,255,255,.03);}',
'.cp-i.on{background:rgba(126,207,192,.11);border-left-color:#7ECFC0;}',
'.cp-i[data-pc]{border-left-width:3px;}',
'.cp-s{display:flex;align-items:center;flex-wrap:wrap;}',
'.cp .pc{font-size:9px;padding:3px 6px 3px 4px;margin-right:8px;border-radius:3px;',
'  letter-spacing:.11em;font-weight:700;text-transform:uppercase;line-height:1;',
'  display:inline-flex;align-items:center;border-left:3px solid var(--pc);',
'  background:color-mix(in srgb, var(--pc) 15%, transparent);color:var(--pc);flex:0 0 auto;}',
'.cp-n{font-size:15px;font-weight:600;color:#fff;line-height:1.3;flex:1 1 auto;min-width:0;',
'  letter-spacing:-.005em;}',
'.cp-n mark{background:none;color:#7ECFC0;font-weight:700;}',
'.cp-s{display:block;font-size:12px;font-weight:400;color:rgba(255,255,255,.42);',
'  margin-top:1px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
'.cp-k{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;',
'  color:rgba(255,255,255,.26);flex:0 0 auto;white-space:nowrap;}',
'.cp-empty{padding:30px 18px;text-align:center;color:rgba(255,255,255,.4);',
'  font-size:13px;font-weight:400;line-height:1.65;}',
'.cp-foot{display:flex;align-items:center;gap:14px;padding:8px 16px;',
'  border-top:1px solid rgba(255,255,255,.07);font-size:11px;font-weight:500;',
'  color:rgba(255,255,255,.3);flex-wrap:wrap;}',
'.cp-foot b{display:inline-flex;align-items:center;justify-content:center;min-width:17px;',
'  height:17px;padding:0 4px;margin-right:5px;border:1px solid rgba(255,255,255,.14);',
'  border-radius:4px;font-size:10px;font-weight:600;color:rgba(255,255,255,.45);}',
'.cp-i:focus-visible,.cp-foot *:focus-visible{outline:2px solid rgba(126,207,192,.85);outline-offset:-2px;}',
'.cp-in input:focus,.cp-in input:focus-visible{outline:none;box-shadow:none;}',
'@media(prefers-reduced-motion:reduce){.cp,.cp-bg{animation:none;}}',
'@media(max-width:640px){.cp-bg{padding:0;}',
'  .cp{max-width:100%;max-height:100dvh;height:100dvh;border-radius:0;border:none;box-shadow:none;',
'      animation:none;}',
'  .cp-in{padding:15px 16px;}.cp-in input{font-size:16px;}.cp-foot{display:none;}',
'  .cp-i{padding:11px 16px;min-height:50px;}.cp-n{font-size:15.5px;}}'
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

/* Paint each result's left edge in its class colour, from the shared model. */
function paintClasses(){
  var CC = window.ClinicalContent; if (!CC) return;
  [].forEach.call(document.querySelectorAll('.cp-i[data-pc]'), function(el){
    var m = CC.classMeta(el.getAttribute('data-pc'));
    if (m){ el.style.setProperty('--pc', m.color);
            if (!el.classList.contains('on')) el.style.borderLeftColor = m.color; }
  });
  [].forEach.call(document.querySelectorAll('.cp .pc'), function(el){
    var m = CC.classMeta(el.getAttribute('data-pc'));
    if (m) el.style.setProperty('--pc', m.color);
  });
}

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
      /* the class badge comes from the shared model, so a drug looks the
         same here as it does in its module */
      var badge = (h.item.pclass && window.ClinicalContent.classBadge)
                    ? window.ClinicalContent.classBadge(h.item.pclass) : '';
      html += '<div class="cp-i'+(i===sel?' on':'')+'" data-i="'+i+'"'+
          (h.item.pclass?(' data-pc="'+h.item.pclass+'"'):'')+'>'+
        '<span class="cp-n">'+mark(h.item.name, q)+
        (h.item.summary ? '<span class="cp-s">'+badge+esc(h.item.summary)+'</span>' : '')+'</span>'+
        '<span class="cp-k">'+esc(KIND_LABEL[h.item.kind] || '')+'</span></div>';
      i++;
    });
  });
  list.innerHTML = html;
  paintClasses();
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
  paintClasses();
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
        '</div>'+
      '<div class="cp-list" id="cp-list" role="listbox"></div>'+
      '<div class="cp-foot"><span><b>&uarr;</b><b>&darr;</b>navigate</span>'+
        '<span><b>&crarr;</b>open</span><span><b>esc</b>close</span></div>'+
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
