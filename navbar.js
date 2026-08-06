// navbar.js — /v2 shared navbar
// Requires: /v2/supabase.js then /v2/auth.js loaded first
console.log('NAVBAR JS LOADED');

(function(){

var CSS = `
*{box-sizing:border-box;}
.nb{position:fixed;top:0;left:0;right:0;height:56px;z-index:900;
  background:#071210;border-bottom:1px solid rgba(27,107,90,.25);
  font-family:'DM Sans',sans-serif;}
.nb-inner{max-width:1100px;margin:0 auto;padding:0 24px;height:100%;
  display:flex;align-items:center;gap:0;}
.nb-logo{text-decoration:none;font-size:18px;font-weight:600;color:#fff;
  letter-spacing:.01em;flex-shrink:0;margin-right:16px;}
.nb-logo span{color:#2A8A74;}
.nb-nav-links{display:flex;align-items:center;gap:2px;flex:1;}
.nb-nav-links a,.nb-link{color:rgba(255,255,255,.5);text-decoration:none;font-size:14px;
  padding:7px 11px;border-radius:6px;transition:color .18s,background .18s;white-space:nowrap;}
.nb-nav-links a:hover,.nb-link:hover{color:#fff;background:rgba(255,255,255,.06);}
.nb-nav-links a.nb-active,.nb-link.nb-active{color:#fff;}
.nb-right{display:flex;align-items:center;gap:6px;margin-left:auto;flex-shrink:0;}
#nb-auth-links{align-items:center;gap:6px;}
.nb-btn{background:#1B6B5A;color:#fff;border:none;padding:7px 16px;
  border-radius:7px;font-size:13px;font-weight:500;cursor:pointer;
  font-family:inherit;transition:background .2s;white-space:nowrap;}
.nb-btn:hover{background:#2A8A74;}
.nb-signout{background:transparent;border:1px solid rgba(255,255,255,.15);
  color:rgba(255,255,255,.5);padding:6px 13px;border-radius:7px;
  font-size:13px;cursor:pointer;font-family:inherit;transition:all .2s;}
.nb-signout:hover{border-color:rgba(255,255,255,.35);color:#fff;}
/* avatar menu */
.nb-avatar-wrap{position:relative;}
.nb-avatar-btn{display:flex;align-items:center;gap:5px;background:none;border:none;
  cursor:pointer;padding:2px;border-radius:30px;transition:background .18s;}
.nb-avatar-btn:hover{background:rgba(255,255,255,.06);}
.nb-avatar{width:32px;height:32px;border-radius:50%;background:#2A8A74;color:#fff;
  display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;
  letter-spacing:.02em;flex-shrink:0;font-family:'DM Sans',sans-serif;}
.nb-chev{font-size:10px;color:rgba(255,255,255,.4);padding-right:4px;}
.nb-menu{display:none;position:absolute;top:calc(100% + 10px);right:0;min-width:240px;
  background:#0C1F18;border:1px solid rgba(27,107,90,.3);border-radius:13px;
  box-shadow:0 18px 50px rgba(0,0,0,.55);overflow:hidden;z-index:1001;}
.nb-menu.open{display:block;animation:nbfade .16s ease;}
@keyframes nbfade{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.nb-menu-head{padding:14px 16px 12px;border-bottom:1px solid rgba(27,107,90,.18);}
.nb-menu-name{font-size:14px;font-weight:600;color:#fff;}
.nb-menu-role{font-size:11px;color:#7ECFC0;font-weight:500;margin-top:1px;}
/* global search */
.nb-search-wrap{position:relative;}
.nb-search{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);border-radius:9px;
  padding:8px 13px;color:#fff;font-size:13px;font-family:inherit;outline:none;width:210px;
  transition:border-color .2s,width .2s;min-height:38px;}
.nb-search:focus{border-color:#2A8A74;width:250px;}
.nb-search::placeholder{color:var(--hint);}
.nb-search-results{display:none;position:absolute;top:calc(100% + 8px);right:0;min-width:280px;max-width:340px;
  max-height:380px;overflow-y:auto;background:#0C1F18;border:1px solid rgba(27,107,90,.3);border-radius:12px;
  box-shadow:0 16px 44px rgba(0,0,0,.5);z-index:1002;padding:6px;}
.nb-search-results.open{display:block;animation:nbfade .15s ease;}
.nb-sr-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;
  color:rgba(255,255,255,.75);text-decoration:none;cursor:pointer;font-size:13px;transition:all .13s;}
.nb-sr-item:hover,.nb-sr-item.sel{background:rgba(27,107,90,.18);color:#fff;}
.nb-sr-ico{font-size:15px;flex-shrink:0;}
.nb-sr-main{flex:1;min-width:0;}
.nb-sr-title{font-weight:500;}
.nb-sr-cat{font-size:11px;color:var(--hint);margin-top:1px;}
.nb-sr-empty{padding:16px 12px;text-align:center;color:var(--hint);font-size:13px;}
@media(max-width:880px){.nb-search{width:150px;}.nb-search:focus{width:180px;}}
.nb-menu-email{font-size:12px;color:rgba(255,255,255,.4);margin-top:2px;word-break:break-all;}
.nb-menu-item{display:flex;align-items:center;gap:10px;padding:10px 16px;font-size:13px;
  color:rgba(255,255,255,.62);text-decoration:none;cursor:pointer;transition:all .15s;
  background:none;border:none;width:100%;text-align:left;font-family:inherit;}
.nb-menu-item:hover{background:rgba(27,107,90,.13);color:#fff;}
.nb-menu-sep{height:1px;background:rgba(27,107,90,.16);margin:4px 0;}
.nb-menu-danger{color:rgba(255,120,100,.75);}
.nb-menu-danger:hover{background:rgba(192,57,43,.1);color:rgba(255,140,120,.92);}
.nb-burger{display:none;background:none;border:none;color:#fff;font-size:20px;
  cursor:pointer;padding:4px 8px;margin-left:8px;line-height:1;}
body{padding-top:56px;}
body.nb-lock{position:fixed;width:100%;overflow:hidden;}

/* ── Mobile application shell ───────────────────────────────────────────────
   A drawer, not a hamburger list: WORKSPACES / NAVIGATION / ACCOUNT, with a
   real backdrop, its own scroll, and safe-area padding.                      */
.nb-mob-bg{display:none;position:fixed;top:56px;left:0;right:0;bottom:0;z-index:898;
  background:rgba(3,8,6,.62);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);}
.nb-mob-bg.open{display:block;}
.nb-mob{display:none;position:fixed;top:56px;left:0;right:0;z-index:899;
  background:#07120F;border-bottom:1px solid rgba(27,107,90,.28);
  border-radius:0 0 16px 16px;box-shadow:0 18px 40px -18px rgba(0,0,0,.9);
  flex-direction:column;padding:14px 0 max(18px,env(safe-area-inset-bottom));
  max-height:calc(100vh - 56px);overflow-y:auto;overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch;}
@supports(height:100dvh){ .nb-mob{max-height:calc(100dvh - 56px);} }
.nb-mob.open{display:flex;}
.nb-mob-link,.nb-mob button{display:block;padding:12px 24px;font-size:15px;
  color:rgba(255,255,255,.6);text-decoration:none;transition:color .18s;
  border:none;background:none;width:100%;text-align:left;
  font-family:inherit;cursor:pointer;}
.nb-mob-link:hover,.nb-mob button:hover{color:#fff;}
.nb-mob-sep{height:1px;background:rgba(27,107,90,.18);margin:8px 0;}

/* Section labels — three clearly separated groups. */
.nb-mob-h{font-size:10px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;
  color:rgba(126,207,192,.5);padding:0 22px 8px;}
.nb-mob-grp{padding-bottom:6px;}
.nb-mob-grp + .nb-mob-grp{margin-top:18px;padding-top:16px;border-top:1px solid rgba(27,107,90,.16);}

/* Workspace cards — mode selector, not navigation rows. */
.nb-mob-ws{display:none;flex-direction:column;gap:9px;padding:0 16px;}
.nb-mob-ws.on{display:flex;}
.nb-mob-card{display:grid;grid-template-columns:38px 1fr;align-items:center;gap:12px;
  min-height:56px;padding:11px 14px;border-radius:13px;text-decoration:none;
  border:1px solid rgba(27,107,90,.28);background:rgba(255,255,255,.035);
  position:relative;overflow:hidden;transition:border-color .18s,background .18s;}
.nb-mob-card:active{background:rgba(27,107,90,.16);}
.nb-mob-ico{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;
  justify-content:center;font-size:17px;line-height:1;
  background:rgba(27,107,90,.18);border:1px solid rgba(27,107,90,.26);}
.nb-mob-tx{min-width:0;}
.nb-mob-lb{display:block;font-size:15px;font-weight:600;color:rgba(255,255,255,.9);line-height:1.25;}
.nb-mob-ds{display:block;font-size:12px;color:rgba(255,255,255,.42);line-height:1.4;margin-top:2px;}
/* Active workspace — border + background + icon emphasis + accent bar. */
.nb-mob-card.on{border-color:rgba(42,138,116,.6);background:rgba(27,107,90,.22);}
.nb-mob-card.on::before{content:'';position:absolute;left:0;top:10px;bottom:10px;width:3px;
  border-radius:0 3px 3px 0;background:#2A8A74;}
.nb-mob-card.on .nb-mob-ico{background:rgba(42,138,116,.34);border-color:rgba(126,207,192,.4);}
.nb-mob-card.on .nb-mob-lb{color:#fff;}

/* Live Tools — the one elevated card. Teal only. */
.nb-mob-card.live{border-color:rgba(42,138,116,.5);
  background:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='30' viewBox='0 0 120 30'%3E%3Cpolyline points='0,15 22,15 30,6 38,24 46,15 68,15 76,11 84,19 92,15 120,15' fill='none' stroke='%237ECFC0' stroke-width='1.4' stroke-linejoin='round' stroke-linecap='round' opacity='.34'/%3E%3C/svg%3E") right -6px center/auto 26px no-repeat,
    linear-gradient(180deg,rgba(27,107,90,.24),rgba(27,107,90,.09));
  box-shadow:0 0 0 1px rgba(42,138,116,.16), 0 6px 18px -10px rgba(42,138,116,.75);}
.nb-mob-card.live .nb-mob-lb{color:#CFF3EA;}
.nb-mob-card.live .nb-mob-ico{background:rgba(42,138,116,.3);border-color:rgba(126,207,192,.34);}
.nb-mob-card.live.on{border-color:rgba(126,207,192,.65);}
.nb-mob-card.live.on .nb-mob-lb{color:#fff;}
@media(prefers-reduced-motion:no-preference){
  .nb-mob-card.live{animation:nbLivePulseM 4s ease-in-out infinite;}
  @keyframes nbLivePulseM{
    0%,100%{box-shadow:0 0 0 1px rgba(42,138,116,.16), 0 6px 18px -10px rgba(42,138,116,.55);}
    50%    {box-shadow:0 0 0 1px rgba(42,138,116,.26), 0 6px 22px -10px rgba(42,138,116,.9);}
  }
}
@media(prefers-reduced-motion:reduce){ .nb-mob-card.live{animation:none;} }

/* Secondary navigation + account rows: comfortable, uniform rhythm. */
.nb-mob-grp .nb-mob-link{min-height:48px;display:flex;align-items:center;padding:0 24px;
  font-size:15px;border-radius:0;}
.nb-mob-acct .nb-mob-link{color:rgba(255,255,255,.7);}
.nb-mob-signout{min-height:48px;display:flex;align-items:center;padding:0 24px;
  color:rgba(255,120,100,.85)!important;font-size:15px;}
.nb-mob-signout:hover{color:rgba(255,150,130,1)!important;}
.nb-modal-bg{display:none;position:fixed;inset:0;z-index:1000;
  background:rgba(0,0,0,.7);align-items:center;justify-content:center;padding:20px;}
.nb-modal-bg.open{display:flex;}
.nb-modal{background:#0A1A15;border:1px solid rgba(27,107,90,.35);
  border-radius:14px;width:100%;max-width:370px;padding:28px 24px;position:relative;}
.nb-modal h2{font-size:19px;font-weight:700;margin-bottom:4px;color:#fff;
  font-family:'Playfair Display',serif;}
.nb-modal p{font-size:13px;color:rgba(255,255,255,.45);margin-bottom:18px;}
.nb-modal label{display:block;font-size:11px;color:rgba(255,255,255,.35);
  letter-spacing:.05em;text-transform:uppercase;font-weight:600;margin-bottom:5px;}
.nb-modal input{width:100%;background:rgba(255,255,255,.07);
  border:1px solid rgba(255,255,255,.12);border-radius:8px;
  padding:11px 12px;color:#fff;font-size:15px;font-family:inherit;
  outline:none;margin-bottom:11px;min-height:44px;appearance:none;}
.nb-modal input:focus{border-color:#2A8A74;}
.nb-modal-btns{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px;}
.nb-modal-btn{padding:11px;border-radius:8px;font-size:14px;font-weight:600;
  cursor:pointer;font-family:inherit;border:none;min-height:44px;}
.nb-modal-btn-primary{background:#1B6B5A;color:#fff;}
.nb-modal-btn-primary:hover{background:#2A8A74;}
.nb-modal-btn-ghost{background:transparent;color:#fff;
  border:1px solid rgba(255,255,255,.15)!important;}
.nb-modal-btn-ghost:hover{background:rgba(255,255,255,.05);}
.nb-modal-btn:disabled{opacity:.4;cursor:default;}
.nb-modal-msg{font-size:13px;padding:9px 11px;border-radius:7px;margin-top:9px;display:none;}
.nb-modal-err{background:rgba(192,57,43,.12);border:1px solid rgba(192,57,43,.3);color:rgba(255,160,140,.93);}
.nb-modal-ok{background:rgba(27,107,90,.15);border:1px solid rgba(42,138,116,.3);color:#7ECFC0;}
.nb-modal-close{position:absolute;top:12px;right:14px;background:none;border:none;
  color:rgba(255,255,255,.35);font-size:18px;cursor:pointer;line-height:1;padding:4px;}
.nb-modal-close:hover{color:#fff;}
.nb-modal-foot{text-align:center;margin-top:13px;font-size:13px;color:rgba(255,255,255,.4);}
.nb-link-btn{background:none;border:none;color:#7ECFC0;font-size:13px;cursor:pointer;
  font-family:inherit;padding:0;text-decoration:none;}
.nb-link-btn:hover{text-decoration:underline;}
/* signup role chips */
.nb-role-chip{display:flex;align-items:center;gap:13px;width:100%;text-align:left;background:rgba(255,255,255,.04);
  border:1px solid var(--border);border-radius:11px;padding:14px 16px;margin-bottom:10px;cursor:pointer;
  font-family:inherit;transition:all .18s;color:inherit;}
.nb-role-chip:hover{border-color:rgba(42,138,116,.5);background:rgba(27,107,90,.12);}
.nb-role-ico{font-size:24px;flex-shrink:0;}
.nb-role-chip b{display:block;font-size:14px;color:#fff;font-weight:600;}
.nb-role-chip small{display:block;font-size:12px;color:var(--muted);margin-top:2px;}
#nb-role-pill{display:flex;align-items:center;justify-content:space-between;background:rgba(27,107,90,.12);
  border:1px solid rgba(42,138,116,.3);border-radius:9px;padding:9px 13px;margin-bottom:14px;font-size:13px;color:#7ECFC0;}
#nb-role-pill button{background:none;border:none;color:var(--accent);font-size:12px;cursor:pointer;font-family:inherit;text-decoration:underline;}
/* ── Role-aware workspace switcher (staff only) ─────────────────────────────
   One home for workspace destinations, so no destination is listed twice.
   Doctor : Dashboard | Live Tools
   Admin  : Admin Center | Doctor Workspace | Live Tools                      */
.nb-ws{display:none;align-items:center;gap:3px;flex-shrink:0;margin-left:6px;
  padding:3px;border:1px solid rgba(27,107,90,.3);border-radius:9px;background:rgba(255,255,255,.03);}
.nb-ws.on{display:flex;}
.nb-ws-seg{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;text-decoration:none;
  color:rgba(255,255,255,.56);font-size:13px;font-weight:500;padding:6px 12px;border-radius:7px;
  border:1px solid transparent;transition:color .18s,background .18s,border-color .18s;}
.nb-ws-seg:hover{color:#fff;background:rgba(255,255,255,.06);}
.nb-ws-seg:focus-visible{outline:2px solid #7ECFC0;outline-offset:2px;}
.nb-ws-seg .nb-ws-ico{font-size:13px;line-height:1;opacity:.9;}
/* Active workspace — restrained, no glow competition with Live Tools. */
.nb-ws-seg.on{color:#fff;background:rgba(27,107,90,.26);border-color:rgba(42,138,116,.5);
  box-shadow:inset 0 0 0 1px rgba(126,207,192,.12);}

/* Live Tools — the one elevated entry. Teal only; red and amber stay reserved
   for real risk states elsewhere in the product. */
.nb-ws-seg.live{color:#9FE0D2;border-color:rgba(42,138,116,.45);
  background:linear-gradient(180deg,rgba(27,107,90,.20),rgba(27,107,90,.08));
  box-shadow:0 0 0 1px rgba(42,138,116,.18), 0 2px 10px -4px rgba(42,138,116,.55);
  background-image:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='58' height='18' viewBox='0 0 58 18'%3E%3Cpolyline points='0,9 11,9 15,3.5 19,14.5 23,9 33,9 37,6 41,12 45,9 58,9' fill='none' stroke='%237ECFC0' stroke-width='1.1' stroke-linejoin='round' stroke-linecap='round' opacity='.5'/%3E%3C/svg%3E"),
    linear-gradient(180deg,rgba(27,107,90,.20),rgba(27,107,90,.08));
  background-repeat:no-repeat,no-repeat;
  background-position:right 8px center,0 0;
  background-size:auto 14px,auto;
  padding-right:56px;}
.nb-ws-seg.live:hover{color:#CFF3EA;border-color:rgba(42,138,116,.7);
  box-shadow:0 0 0 1px rgba(42,138,116,.3), 0 3px 14px -4px rgba(42,138,116,.8);}
.nb-ws-seg.live.on{color:#fff;border-color:rgba(126,207,192,.6);
  background-color:rgba(27,107,90,.3);
  box-shadow:inset 0 0 0 1px rgba(126,207,192,.18), 0 0 16px -5px rgba(42,138,116,.9);}
/* Subtle depth pulse on the glow only — never a status claim, never flashing. */
@media(prefers-reduced-motion:no-preference){
  .nb-ws-seg.live{animation:nbLivePulse 3.6s ease-in-out infinite;}
  @keyframes nbLivePulse{
    0%,100%{box-shadow:0 0 0 1px rgba(42,138,116,.18), 0 2px 10px -4px rgba(42,138,116,.45);}
    50%    {box-shadow:0 0 0 1px rgba(42,138,116,.28), 0 2px 14px -4px rgba(42,138,116,.75);}
  }
}
@media(prefers-reduced-motion:reduce){ .nb-ws-seg.live{animation:none;} }

/* Mobile workspace switcher — same destinations, stacked, 44px targets. */
/* Inset to line up with the 24px text inset of .nb-mob-link below it. */
.nb-mob-ws{display:none;flex-direction:column;gap:6px;margin:0 16px 12px;}
.nb-mob-ws.on{display:flex;}
.nb-mob-ws-h{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
  color:rgba(126,207,192,.55);padding:2px 2px 4px;}
.nb-mob-ws a{display:flex;align-items:center;gap:9px;min-height:44px;padding:11px 13px;
  border:1px solid rgba(27,107,90,.3);border-radius:9px;background:rgba(255,255,255,.03);
  color:rgba(255,255,255,.72);text-decoration:none;font-size:14px;}
.nb-mob-ws a.on{color:#fff;background:rgba(27,107,90,.26);border-color:rgba(42,138,116,.5);}
.nb-mob-ws a.live{color:#9FE0D2;border-color:rgba(42,138,116,.45);
  background:linear-gradient(180deg,rgba(27,107,90,.20),rgba(27,107,90,.08));
  box-shadow:0 0 0 1px rgba(42,138,116,.16), 0 2px 10px -4px rgba(42,138,116,.5);}
.nb-mob-ws a.live.on{color:#fff;border-color:rgba(126,207,192,.55);}

@media(max-width:960px){
  .nb-ws-seg{font-size:12.5px;padding:6px 10px;}
  .nb-ws-seg.live{padding-right:46px;background-size:auto 12px;}
}
/* Touch devices above the burger breakpoint (iPad landscape and portrait) keep
   the inline switcher, so its segments need real touch targets. */
@media(pointer:coarse){
  .nb-ws-seg{min-height:44px;padding-top:0;padding-bottom:0;}
}
@media(max-width:740px){
  .nb-nav-links{display:none;}
  .nb-ws{display:none !important;}   /* moves into the drawer */
  .nb-burger{display:block;}
  .nb-modal-btns{grid-template-columns:1fr;}
  /* Phone header stays: logo + avatar + one menu button. The staff search box
     is the control that crowded it; it remains on iPad and desktop. */
  #nb-search-wrap{display:none !important;}
}
/* Landscape phones: keep the drawer usable when height is scarce. */
@media(max-width:900px) and (max-height:460px){
  .nb-mob{max-height:calc(100vh - 56px);}
  .nb-mob-card{min-height:50px;}
  .nb-mob-ds{display:none;}
}
/* ── Shared compact application footer (authenticated pages) ─────────────── */
.nb-foot{background:#0A1712;border-top:1px solid rgba(255,255,255,.08);
  font-family:'DM Sans',-apple-system,system-ui,sans-serif;color:rgba(255,255,255,.6);margin-top:44px;}
.nb-foot-in{max-width:1160px;margin:0 auto;padding:30px 24px 24px;}
.nb-foot-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:22px 20px;}
.nb-foot-h{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.4);margin-bottom:11px;}
.nb-foot-col a{display:block;font-size:13px;color:rgba(255,255,255,.62);text-decoration:none;padding:4px 0;line-height:1.4;}
.nb-foot-col a:hover{color:#7ECFC0;}
.nb-foot-bot{display:flex;align-items:center;justify-content:space-between;gap:10px 16px;flex-wrap:wrap;
  margin-top:22px;padding-top:16px;border-top:1px solid rgba(255,255,255,.07);}
.nb-foot-brand{font-size:15px;font-weight:700;color:#fff;letter-spacing:-.01em;}
.nb-foot-brand span{color:#2A8A74;}
.nb-foot-copy{font-size:12px;color:rgba(255,255,255,.4);}
@media(max-width:720px){ .nb-foot-cols{grid-template-columns:repeat(2,1fr);} }
@media(max-width:420px){ .nb-foot-cols{grid-template-columns:1fr;} }
`;

function injectCSS(){
  if(document.getElementById('nb-css')) return;
  var s = document.createElement('style');
  s.id = 'nb-css'; s.textContent = CSS;
  document.head.appendChild(s);
}

function activeCls(href, page){
  return (href.split('/').pop() === page) ? ' class="nb-link nb-active"' : ' class="nb-link"';
}

function buildHTML(page){
  var p = page || '';
  return (
    '<nav class="nb" id="nb-nav">' +
      '<div class="nb-inner">' +
        '<a href="/v2/index.html" class="nb-logo">Anest<span>heo</span></a>' +
        '<div class="nb-nav-links" id="nb-nav-links">' +
          '<a href="/v2/index.html"' + activeCls('/v2/index.html', p) + '>Home</a>' +
          '<a href="/v2/patients.html"' + activeCls('/v2/patients.html', p) + '>For Patients</a>' +
          '<a href="/v2/videos.html"' + activeCls('/v2/videos.html', p) + '>Videos</a>' +
          '<a href="/v2/ask.html"' + activeCls('/v2/ask.html', p) + '>Ask Anesthesiologist</a>' +
          '<a href="/v2/engine.html"' + activeCls('/v2/engine.html', p) + '>Live Tools</a>' +
        '</div>' +
        // Role-aware patient navigation (shown only to logged-in patients).
        '<div class="nb-nav-links" id="nb-nav-patient" style="display:none">' +
          '<a href="/v2/index.html"' + activeCls('/v2/index.html', p) + '>Home</a>' +
          '<a href="/v2/patient-dashboard.html"' + activeCls('/v2/patient-dashboard.html', p) + '>My Space</a>' +
          '<a href="/v2/ask.html"' + activeCls('/v2/ask.html', p) + '>Ask Anesthesiologist</a>' +
          '<a href="/v2/videos.html"' + activeCls('/v2/videos.html', p) + '>Videos</a>' +
          '<a href="/v2/settings.html"' + activeCls('/v2/settings.html', p) + '>Profile</a>' +
        '</div>' +
        // Doctor navigation (shown only to logged-in doctors). Doctors are
        // anesthesiologists, so "Ask Anesthesiologist" is omitted; "For Patients"
        // stays so they can preview the patient-facing site.
        '<div class="nb-nav-links" id="nb-nav-doctor" style="display:none">' +
          '<a href="/v2/index.html"' + activeCls('/v2/index.html', p) + '>Home</a>' +
          '<a href="/v2/patients.html"' + activeCls('/v2/patients.html', p) + '>For Patients</a>' +
          '<a href="/v2/videos.html"' + activeCls('/v2/videos.html', p) + '>Videos</a>' +
        '</div>' +
        // Admin content navigation. Workspaces live in the switcher below, so
        // Admin Center / Doctor Workspace / Live Tools appear exactly once.
        '<div class="nb-nav-links" id="nb-nav-admin" style="display:none">' +
          '<a href="/v2/index.html"' + activeCls('/v2/index.html', p) + '>Home</a>' +
          '<a href="/v2/videos.html"' + activeCls('/v2/videos.html', p) + '>Videos</a>' +
        '</div>' +
        // Role-aware workspace switcher (staff only; filled by populateMenu).
        '<div class="nb-ws" id="nb-ws" role="navigation" aria-label="Workspace"></div>' +
        '<div class="nb-right">' +
          '<div class="nb-search-wrap" id="nb-search-wrap" style="display:none">' +
            '<input type="text" class="nb-search" id="nb-search" placeholder="Search drugs, tubes, blocks…" autocomplete="off" ' +
              'readonly aria-haspopup="dialog" ' +
              'onfocus="window.nbSearchOpen(event)" onclick="window.nbSearchOpen(event)" ' +
              'onkeydown="window.nbSearchOpen(event)">' +
            '<div class="nb-search-results" id="nb-search-results"></div>' +
          '</div>' +
          '<div id="nb-guest-links">' +
            '<button class="nb-btn" onclick="window.nbOpenModal()">Login</button>' +
          '</div>' +
          '<div id="nb-auth-links" style="display:none;align-items:center;gap:8px;">' +
            '<div class="nb-avatar-wrap" id="nb-avatar-wrap">' +
              '<button class="nb-avatar-btn" id="nb-avatar-btn" onclick="window.nbToggleMenu()" aria-label="Account menu">' +
                '<span class="nb-avatar" id="nb-avatar">DG</span>' +
                '<span class="nb-chev">&#9662;</span>' +
              '</button>' +
              '<div class="nb-menu" id="nb-menu">' +
                '<div class="nb-menu-head">' +
                  '<div class="nb-menu-name" id="nb-menu-name">User</div>' +
                  '<div class="nb-menu-role" id="nb-menu-role"></div>' +
                  '<div class="nb-menu-email" id="nb-menu-email"></div>' +
                '</div>' +
                '<a href="/v2/dashboard.html" class="nb-menu-item" id="nb-menu-workspace">&#129658; Doctor Workspace</a>' +
                '<button class="nb-menu-item" id="nb-menu-myjourney" style="display:none;background:none;border:none;width:100%;text-align:left;font-family:inherit;cursor:pointer;" onclick="window.nbStartPatientJourney()">&#129489; My Patient Journey</button>' +
                '<a href="/v2/patient-dashboard.html" class="nb-menu-item" id="nb-menu-patient" style="display:none">&#10024; My Space</a>' +
                '<a href="/v2/settings.html" class="nb-menu-item">&#9881; Settings</a>' +
                '<div class="nb-menu-sep"></div>' +
                '<button class="nb-menu-item nb-menu-danger" onclick="window.nbSignOut()">&#8594; Sign out</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<button class="nb-burger" id="nb-burger" onclick="window.nbToggleMob()" aria-label="Menu" ' +
          'aria-expanded="false" aria-controls="nb-mob" aria-haspopup="dialog">&#9776;</button>' +
      '</div>' +
    '</nav>' +
    '<div class="nb-mob-bg" id="nb-mob-bg" onclick="window.nbCloseMob()"></div>' +
    '<div class="nb-mob" id="nb-mob" role="dialog" aria-modal="true" aria-label="Menu">' +
      // 1. WORKSPACES — the mode selector, first and visually dominant.
      // 0. CLINICAL SEARCH — the header box is hidden on a phone, so the
      //    palette needs a first-class entry point in the drawer.
      '<div class="nb-mob-grp" id="nb-mob-searchgrp" style="display:none">' +
        '<div class="nb-mob-h">Search</div>' +
        '<button type="button" class="nb-mob-link" id="nb-mob-search" onclick="window.nbMobSearch()">'+
          '&#9906;&nbsp; Search drugs, tubes, blocks…</button>' +
      '</div>' +
      '<div class="nb-mob-grp" id="nb-mob-wsgrp" style="display:none">' +
        '<div class="nb-mob-h">Workspaces</div>' +
        '<div class="nb-mob-ws" id="nb-mob-ws" role="navigation" aria-label="Workspace"></div>' +
      '</div>' +
      // 2. NAVIGATION — ordinary content links, never workspaces.
      '<div class="nb-mob-grp" id="nb-mob-navgrp">' +
      '<div class="nb-mob-h">Navigation</div>' +
      // Public mobile nav — guests (unchanged).
      '<div id="nb-mob-public">' +
        '<a href="/v2/index.html" class="nb-mob-link">Home</a>' +
        '<a href="/v2/patients.html" class="nb-mob-link">For Patients</a>' +
        '<a href="/v2/videos.html" class="nb-mob-link">Videos</a>' +
        '<a href="/v2/ask.html" class="nb-mob-link">Ask Anesthesiologist</a>' +
        '<a href="/v2/engine.html" class="nb-mob-link">Live Tools</a>' +
      '</div>' +
      // Patient mobile nav — logged-in patients only.
      '<div id="nb-mob-patient-nav" style="display:none">' +
        '<a href="/v2/index.html" class="nb-mob-link">Home</a>' +
        '<a href="/v2/patient-dashboard.html" class="nb-mob-link">&#10024; My Space</a>' +
        '<a href="/v2/ask.html" class="nb-mob-link">Ask Anesthesiologist</a>' +
        '<a href="/v2/videos.html" class="nb-mob-link">Videos</a>' +
        '<a href="/v2/settings.html" class="nb-mob-link">Profile</a>' +
      '</div>' +
      // Doctor mobile nav — logged-in doctors only (no Ask Anesthesiologist;
      // Dashboard comes from the auth section below).
      '<div id="nb-mob-doctor-nav" style="display:none">' +
        '<a href="/v2/index.html" class="nb-mob-link">Home</a>' +
        '<a href="/v2/patients.html" class="nb-mob-link">For Patients</a>' +
        '<a href="/v2/videos.html" class="nb-mob-link">Videos</a>' +
      '</div>' +
      // Admin mobile content nav.
      '<div id="nb-mob-admin-nav" style="display:none">' +
        '<a href="/v2/index.html" class="nb-mob-link">Home</a>' +
        '<a href="/v2/videos.html" class="nb-mob-link">Videos</a>' +
      '</div>' +
      '</div>' +                                   // end NAVIGATION group
      // 3. ACCOUNT — always last, always separated from content links.
      '<div class="nb-mob-grp nb-mob-acct" id="nb-mob-acctgrp">' +
        '<div class="nb-mob-h">Account</div>' +
        '<div id="nb-mob-guest"><div style="padding:0 16px;"><button class="nb-btn" style="width:100%;min-height:48px" onclick="window.nbOpenModal();window.nbCloseMob()">Login</button></div></div>' +
        '<div id="nb-mob-auth" style="display:none">' +
          '<a href="/v2/dashboard.html" class="nb-mob-link" id="nb-mob-workspace">Dashboard</a>' +
          '<a href="/v2/settings.html" class="nb-mob-link" id="nb-mob-settings">Profile &amp; settings</a>' +
          '<button class="nb-mob-link nb-mob-signout" onclick="window.nbSignOut()">Sign out</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="nb-modal-bg" id="nb-modal" onclick="if(event.target===this)window.nbCloseModal()">' +
      '<div class="nb-modal">' +
        '<button class="nb-modal-close" onclick="window.nbCloseModal()">&#10005;</button>' +
        '<h2 id="nb-modal-title">Sign in</h2>' +
        '<p id="nb-modal-sub">Access Anestheo</p>' +
        // ── Role step (register only) ──
        '<div id="nb-role-step" style="display:none">' +
          '<button class="nb-role-chip" onclick="window.nbPickRole(\'patient\')"><span class="nb-role-ico">&#129489;</span><span><b>Patient</b><small>Preparing for a procedure</small></span></button>' +
          '<button class="nb-role-chip" onclick="window.nbPickRole(\'doctor\')"><span class="nb-role-ico">&#129658;</span><span><b>Doctor</b><small>Anesthesiologist (verification required)</small></span></button>' +
          '<button class="nb-role-chip" onclick="window.nbPickRole(\'other\')"><span class="nb-role-ico">&#127973;</span><span><b>Nurse / Student / Other</b><small>Healthcare professional</small></span></button>' +
        '</div>' +
        // ── Credentials step ──
        '<div id="nb-cred-step">' +
          '<div id="nb-role-pill" style="display:none"></div>' +
          '<label>Email</label>' +
          '<input type="email" id="nb-email" placeholder="your@email.com" autocomplete="email" ' +
            'onkeydown="if(event.key===\'Enter\')document.getElementById(\'nb-pass\').focus()">' +
          '<label>Password</label>' +
          '<input type="password" id="nb-pass" placeholder="Password" autocomplete="current-password" ' +
            'onkeydown="if(event.key===\'Enter\')window.nbSubmitAuth()">' +
          '<button class="nb-modal-btn nb-modal-btn-primary" id="nb-submit-btn" style="width:100%;margin-top:6px;" onclick="window.nbSubmitAuth()">Sign in</button>' +
        '</div>' +
        '<div class="nb-modal-msg nb-modal-err" id="nb-err"></div>' +
        '<div class="nb-modal-msg nb-modal-ok"  id="nb-ok"></div>' +
        '<div class="nb-modal-foot">' +
          '<span id="nb-toggle-text">New to Anestheo?</span> ' +
          '<button class="nb-link-btn" id="nb-toggle-btn" onclick="window.nbToggleMode()">Create an account</button>' +
        '</div>' +
        '<div class="nb-modal-foot" id="nb-forgot-row">' +
          '<button class="nb-link-btn" onclick="window.nbForgot()">Forgot password?</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function ge(id){ return document.getElementById(id); }

function showMsg(type, text){
  var err = ge('nb-err'), ok = ge('nb-ok');
  if(err) err.style.display = 'none';
  if(ok)  ok.style.display  = 'none';
  if(!type) return;
  var el = ge('nb-' + type);
  if(el){ el.innerHTML = text; el.style.display = 'block'; }
}

// Auth modal mode: 'signin' or 'register'
var _authMode = 'signin';
var _regRole = null;
// Current auth state (UI only) so the login modal is never shown to an
// already-authenticated user. Set by setAuth/populateMenu, cleared by setGuest.
var _nbAuthed = false;
var _nbRole = null;

function setBtns(disabled){
  var b = ge('nb-submit-btn');
  if(b){
    b.disabled = disabled;
    if(!disabled) b.textContent = (_authMode === 'register') ? 'Create account' : 'Sign in';
  }
}

function setGuest(){
  _nbAuthed = false; _nbRole = null;
  var g = ge('nb-guest-links'), a = ge('nb-auth-links');
  if(g) g.style.display = '';
  if(a) a.style.display = 'none';
  var mg = ge('nb-mob-guest'), ma = ge('nb-mob-auth');
  if(mg) mg.style.display = '';
  if(ma) ma.style.display = 'none';
  // Restore the public navigation for guests (and after sign-out).
  var navPublic = ge('nb-nav-links'), navPatient = ge('nb-nav-patient'), navDoctor = ge('nb-nav-doctor');
  if(navPublic) navPublic.style.display = '';
  if(navPatient) navPatient.style.display = 'none';
  if(navDoctor) navDoctor.style.display = 'none';
  var mobPublic = ge('nb-mob-public'), mobPatient = ge('nb-mob-patient-nav'), mobDoctor = ge('nb-mob-doctor-nav');
  if(mobPublic) mobPublic.style.display = '';
  if(mobPatient) mobPatient.style.display = 'none';
  if(mobDoctor) mobDoctor.style.display = 'none';
  var navAdmin = ge('nb-nav-admin'); if(navAdmin) navAdmin.style.display = 'none';
  var mobAdmin = ge('nb-mob-admin-nav'); if(mobAdmin) mobAdmin.style.display = 'none';
  renderWorkspaceSwitcher(null);          // no workspace switcher for guests
}

// ── Workspace switcher ────────────────────────────────────────
// Every destination is an existing route. Nothing here is invented.
//   /v2/admin.html      Admin Center        (admins only)
//   /v2/dashboard.html  Doctor Workspace    (staff)
//   /v2/engine.html     Live Tools          (staff)
var NB_WORKSPACES = {
  doctor: [
    { href:'/v2/dashboard.html', label:'Dashboard',  ico:'🩺',
      desc:'Patients, reviews and clinical work' },
    { href:'/v2/engine.html',    label:'Live Tools', ico:'⚡', live:true,
      desc:'Drugs, calculators and crisis tools' }
  ],
  admin: [
    { href:'/v2/admin.html',     label:'Admin Center',     ico:'🛡',
      desc:'Platform operations and oversight' },
    { href:'/v2/dashboard.html', label:'Doctor Workspace', ico:'🩺',
      desc:'Clinical patient management' },
    { href:'/v2/engine.html',    label:'Live Tools',       ico:'⚡', live:true,
      desc:'Clinical tools and crisis workstation' }
  ]
};
function nbCurrentPage(){ return (location.pathname.split('/').pop() || 'index.html'); }

function renderWorkspaceSwitcher(role){
  var items = NB_WORKSPACES[role] || null;
  var desk = ge('nb-ws'), mob = ge('nb-mob-ws'), grp = ge('nb-mob-wsgrp');
  if(!items){
    if(desk){ desk.classList.remove('on'); desk.innerHTML = ''; }
    if(mob){ mob.classList.remove('on'); mob.innerHTML = ''; }
    if(grp) grp.style.display = 'none';
    return;
  }
  var page = nbCurrentPage();
  function isActive(it){ return it.href.split('/').pop() === page; }

  // Desktop / iPad: the approved inline segmented switcher. Unchanged.
  if(desk){
    desk.innerHTML = items.map(function(it){
      var on = isActive(it);
      return '<a href="' + it.href + '" class="nb-ws-seg' + (it.live?' live':'') + (on?' on':'') + '"' +
        (on ? ' aria-current="page"' : '') + '>' +
        '<span class="nb-ws-ico" aria-hidden="true">' + it.ico + '</span>' +
        '<span>' + it.label + '</span></a>';
    }).join('');
    desk.classList.add('on');
  }
  // Phone: full-width workspace cards with icon, label and a short description.
  if(mob){
    mob.innerHTML = items.map(function(it){
      var on = isActive(it);
      return '<a href="' + it.href + '" class="nb-mob-card' + (it.live?' live':'') + (on?' on':'') + '"' +
        (on ? ' aria-current="page"' : '') + '>' +
        '<span class="nb-mob-ico" aria-hidden="true">' + it.ico + '</span>' +
        '<span class="nb-mob-tx"><span class="nb-mob-lb">' + it.label + '</span>' +
        '<span class="nb-mob-ds">' + it.desc + '</span></span></a>';
    }).join('');
    mob.classList.add('on');
  }
  if(grp) grp.style.display = '';
}

function setAuth(){
  _nbAuthed = true;
  var g = ge('nb-guest-links'), a = ge('nb-auth-links');
  if(g) g.style.display = 'none';
  if(a) a.style.display = 'flex';
  var mg = ge('nb-mob-guest'), ma = ge('nb-mob-auth');
  if(mg) mg.style.display = 'none';
  if(ma) ma.style.display = 'block';
}

// Fill avatar + dropdown from profile
function populateMenu(user, profile){
  var role    = profile ? (profile.role || 'patient') : 'patient';
  var isAdmin = profile && (profile.is_admin === true || profile.role === 'admin');
  _nbAuthed = true; _nbRole = isAdmin ? 'admin' : role;
  if(isAdmin) role = 'admin';

  var fullName = (profile && profile.full_name) ? profile.full_name : '';
  var parts    = fullName.trim().split(' ').filter(Boolean);
  // Initials
  var initials = parts.length >= 2 ? parts[0][0] + parts[parts.length-1][0]
               : parts[0] ? parts[0].slice(0,2)
               : user.email.slice(0,2);
  initials = initials.toUpperCase();

  // Display name — doctors/admins get Dr. + last name; patients full name or first
  var displayName;
  if(role === 'doctor' || role === 'admin'){
    displayName = parts.length ? 'Dr. ' + parts[parts.length-1] : user.email.split('@')[0];
  } else {
    displayName = fullName || user.email.split('@')[0];
  }

  var avEl = ge('nb-avatar');     if(avEl) avEl.textContent = initials;
  var nmEl = ge('nb-menu-name');  if(nmEl) nmEl.textContent = displayName;
  var emEl = ge('nb-menu-email'); if(emEl) emEl.textContent = user.email;

  // Role line in menu head
  var roleLabels = {doctor:'Anesthesiologist', admin:'Administrator', patient:'Patient', other:'Healthcare Professional'};
  var rlEl = ge('nb-menu-role'); if(rlEl) rlEl.textContent = roleLabels[role] || '';

  var isStaff = (role !== 'patient');
  var isPatient = !isStaff;
  var isDoctor = (role === 'doctor');
  var isAdminRole = (role === 'admin');
  // Which workspace set this account gets. Only doctors and admins have one;
  // "other" staff (nurse/student) keep the public nav and no switcher.
  var wsRole = isAdminRole ? 'admin' : (isDoctor ? 'doctor' : null);

  // Dropdown: staff get a "My Patient Journey" switch (same account, no logout);
  // patients get My Space. The Doctor Workspace entry is now owned by the
  // workspace switcher, so it is hidden for anyone who has one — a destination
  // must not appear in two navigation surfaces.
  var ws  = ge('nb-menu-workspace'); if(ws)  ws.style.display  = (isStaff && !wsRole) ? 'flex' : 'none';
  var mj  = ge('nb-menu-myjourney'); if(mj)  mj.style.display  = isStaff ? 'flex' : 'none';
  var pt  = ge('nb-menu-patient');   if(pt)  pt.style.display  = isStaff ? 'none' : 'flex';
  // Role-aware primary navigation: patients get the patient nav, doctors and
  // admins get their own content nav, everyone else keeps the public nav.
  var isPublicNav = !isPatient && !isDoctor && !isAdminRole;
  var navPublic  = ge('nb-nav-links');   if(navPublic)  navPublic.style.display  = isPublicNav ? '' : 'none';
  var navDoctor  = ge('nb-nav-doctor');  if(navDoctor)  navDoctor.style.display  = isDoctor ? '' : 'none';
  var navAdmin   = ge('nb-nav-admin');   if(navAdmin)   navAdmin.style.display   = isAdminRole ? '' : 'none';
  var navPatient = ge('nb-nav-patient'); if(navPatient) navPatient.style.display = isPatient ? '' : 'none';
  var mobPublic  = ge('nb-mob-public');      if(mobPublic)  mobPublic.style.display  = isPublicNav ? 'block' : 'none';
  var mobDoctor  = ge('nb-mob-doctor-nav');  if(mobDoctor)  mobDoctor.style.display  = isDoctor ? 'block' : 'none';
  var mobAdmin   = ge('nb-mob-admin-nav');   if(mobAdmin)   mobAdmin.style.display   = isAdminRole ? 'block' : 'none';
  var mobPatient = ge('nb-mob-patient-nav'); if(mobPatient) mobPatient.style.display = isPatient ? 'block' : 'none';
  // Same rule on mobile: the switcher owns Dashboard for doctors and admins.
  var mobWs  = ge('nb-mob-workspace'); if(mobWs)  mobWs.style.display  = (isStaff && !wsRole) ? 'block' : 'none';
  var mobSet = ge('nb-mob-settings');  if(mobSet) mobSet.style.display = isPatient ? 'none' : 'block';
  renderWorkspaceSwitcher(wsRole);
  // Global search for staff only
  var search = ge('nb-search-wrap'); if(search) search.style.display = isStaff ? 'block' : 'none';
  var msg = ge('nb-mob-searchgrp'); if(msg) msg.style.display = isStaff ? 'block' : 'none';
  if(isStaff && window.ClinicalSearch) window.ClinicalSearch.enabled = true;
}

window.nbToggleMenu = function(){
  var m = ge('nb-menu');
  if(m) m.classList.toggle('open');
};

// ── GLOBAL SEARCH ─────────────────────────────────────────────
var NB_SEARCH_INDEX = [
  {title:'Anesthesiology Live Tools', cat:'Tools', ico:'\uD83E\uDE7A', url:'/v2/engine.html',
   kw:'anesthesiology live tools engine calculator dosing airway ventilation neuraxial fluids scores tiva tci vasopressor inotrope mabl blood volume drug reference perioperative'},
  {title:'Clinical References', cat:'Library', ico:'\uD83D\uDCD6', url:'/v2/references.html',
   kw:'clinical references library guides knowledge'},
  {title:'Airway', cat:'Reference', ico:'\uD83D\uDCA8', url:'/v2/airway.html',
   kw:'airway ett tube intubation lma mallampati lemon laryngoscopy sizing depth preoxygenation rsi'},
  {title:'Difficult Airway', cat:'Reference', ico:'\uD83D\uDEA8', url:'/v2/difficult-airway.html',
   kw:'difficult airway cico cant intubate oxygenate cricothyroidotomy plan das rescue front of neck'},
  {title:'Anticoagulation', cat:'Reference', ico:'\uD83E\uDE78', url:'/v2/anticoagulation.html',
   kw:'anticoagulation anticoagulant blood thinner heparin lmwh warfarin rivaroxaban apixaban dabigatran clopidogrel aspirin neuraxial timing asra bridging'},
  {title:'Regional Anesthesia', cat:'Reference', ico:'\uD83E\uDDE0', url:'/v2/regional.html',
   kw:'regional anesthesia block nerve interscalene supraclavicular axillary femoral adductor popliteal tap local anesthetic lidocaine bupivacaine ropivacaine maximum dose'},
  {title:'Neuraxial', cat:'Reference', ico:'\uD83E\uDDE0', url:'/v2/regional.html',
   kw:'neuraxial spinal epidural intrathecal labor cesarean caudal'},
  {title:'ICU', cat:'Reference', ico:'\uD83C\uDFE5', url:'/v2/icu.html',
   kw:'icu intensive critical care ards ardsnet ventilation tidal volume sedation rass vasoactive noradrenaline sepsis'},
  {title:'Obstetric', cat:'Reference', ico:'\uD83E\uDD30', url:'/v2/obstetric.html',
   kw:'obstetric obstetrics pregnancy labor cesarean spinal epidural aortocaval phenylephrine hypotension'},
  {title:'Pediatric', cat:'Reference', ico:'\uD83E\uDDD2', url:'/v2/pediatric.html',
   kw:'pediatric paediatric child children neonate infant ett formula weight 421 fluids atropine'},
  {title:'LAST', cat:'Reference', ico:'\u26A0', url:'/v2/last.html',
   kw:'last local anesthetic systemic toxicity lipid emulsion intralipid seizure cardiac arrest'},
  {title:'Anaphylaxis', cat:'Reference', ico:'\uD83D\uDC89', url:'/v2/anaphylaxis.html',
   kw:'anaphylaxis allergic reaction adrenaline epinephrine tryptase bronchospasm hypotension'},
  {title:'Resources', cat:'Library', ico:'\uD83D\uDCDA', url:'/v2/resources.html',
   kw:'resources books pdf checklists icu survival guide patient education downloads brochures material'},
  {title:'Ask Anesthesiologist', cat:'Communication', ico:'\uD83D\uDCAC', url:'/v2/ask.html',
   kw:'ask anesthesiologist question patient communication query'},
  {title:'Settings', cat:'Account', ico:'\u2699', url:'/v2/settings.html',
   kw:'settings account profile password preferences'},
  {title:'Epidural', cat:'Reference', ico:'\uD83E\uDDE0', url:'/v2/regional.html',
   kw:'epidural epi labor infusion topup'},
  {title:'Epinephrine / Adrenaline', cat:'Reference', ico:'\uD83D\uDC89', url:'/v2/anaphylaxis.html',
   kw:'epinephrine adrenaline epi pressor vasopressor anaphylaxis'},
  {title:'Apixaban', cat:'Reference', ico:'\uD83E\uDE78', url:'/v2/anticoagulation.html',
   kw:'apixaban apix doac noac anticoagulant'}
];

var _searchSel = -1, _searchHits = [];

/* The clinical command palette is the search surface. The navbar box hands off
   to it so there is one index, one ranking and one result behaviour everywhere.
   NB_SEARCH_INDEX below is retained only as the page-level fallback for the
   handful of destinations that are pages rather than clinical items. */
function nbOpenClinical(seed){
  if (window.ClinicalSearch && window.ClinicalContent){
    window.ClinicalSearch.enabled = true;
    window.ClinicalSearch.open(seed || '');
    return true;
  }
  return false;
}
window.nbOpenClinical = nbOpenClinical;

window.nbSearchOpen = function(e){
  if (e && e.type === 'keydown' && e.key === 'Tab') return;   // don't trap tabbing
  if (e && e.preventDefault) e.preventDefault();
  var el = ge('nb-search'); if (el) el.blur();
  if (!nbOpenClinical('')){
    // clinical index not loaded on this page — fall back to the page list
    if (el){ el.removeAttribute('readonly'); el.focus(); }
  }
};

/* Phone: a search action inside the drawer, so the palette is reachable on a
   handset where the header box is deliberately hidden. */
window.nbMobSearch = function(){
  if (window.nbCloseMob) window.nbCloseMob();
  setTimeout(function(){ nbOpenClinical(''); }, 120);
};

window.nbSearch = function(q){
  q = (q || '').trim().toLowerCase();
  var box = ge('nb-search-results');
  if(!box) return;
  _searchSel = -1;
  if(!q){ box.classList.remove('open'); box.innerHTML = ''; return; }

  var scored = NB_SEARCH_INDEX.map(function(it){
    var title = it.title.toLowerCase();
    var score = -1;
    if(title === q) score = 100;
    else if(title.indexOf(q) === 0) score = 80;
    else if(title.indexOf(q) > 0) score = 60;
    else {
      var toks = it.kw.split(' ');
      for(var i=0;i<toks.length;i++){
        if(toks[i].indexOf(q) === 0){ score = Math.max(score, 40); }
        else if(toks[i].indexOf(q) > 0){ score = Math.max(score, 20); }
      }
    }
    return {it:it, score:score};
  }).filter(function(x){ return x.score >= 0; })
    .sort(function(a,b){ return b.score - a.score; });

  var seen = {}, hits = [];
  scored.forEach(function(x){
    var k = x.it.title + x.it.url;
    if(!seen[k]){ seen[k] = 1; hits.push(x.it); }
  });
  _searchHits = hits.slice(0, 8);

  if(!_searchHits.length){
    box.innerHTML = '<div class="nb-sr-empty">No results for \u201C' + q.replace(/</g,'') + '\u201D</div>';
    box.classList.add('open');
    return;
  }
  box.innerHTML = _searchHits.map(function(it, i){
    return '<a href="' + it.url + '" class="nb-sr-item" data-i="' + i + '">' +
      '<span class="nb-sr-ico">' + it.ico + '</span>' +
      '<span class="nb-sr-main"><span class="nb-sr-title">' + it.title + '</span>' +
      '<span class="nb-sr-cat">' + it.cat + '</span></span></a>';
  }).join('');
  box.classList.add('open');
};

window.nbSearchKey = function(e){
  var box = ge('nb-search-results');
  if(!box || !box.classList.contains('open')) return;
  var items = box.querySelectorAll('.nb-sr-item');
  if(e.key === 'ArrowDown'){ e.preventDefault(); _searchSel = Math.min(_searchSel + 1, items.length - 1); }
  else if(e.key === 'ArrowUp'){ e.preventDefault(); _searchSel = Math.max(_searchSel - 1, 0); }
  else if(e.key === 'Enter'){
    e.preventDefault();
    if(_searchSel >= 0 && items[_searchSel]) window.location.href = items[_searchSel].getAttribute('href');
    else if(_searchHits.length) window.location.href = _searchHits[0].url;
    return;
  }
  else if(e.key === 'Escape'){ box.classList.remove('open'); return; }
  items.forEach(function(el, i){ el.classList.toggle('sel', i === _searchSel); });
};

// ── PUBLIC API ────────────────────────────────────────────────
function nbShowAuthModal(){
  _authMode = 'signin';
  applyMode();
  var m = ge('nb-modal'); if(m) m.classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(function(){ var e = ge('nb-email'); if(e) e.focus(); }, 80);
}
function nbGoWorkspace(role){
  // Returning session: patients land on the Patient Home; staff on the workspace.
  location.href = (role === 'patient') ? '/v2/index.html' : '/v2/dashboard.html';
}
// The sign-in modal must ONLY appear when there is no authenticated session.
// If a valid Supabase session already exists, reuse it and send the user to
// their own workspace instead of ever asking them to sign in again.
window.nbOpenModal = function(){
  if(_nbAuthed){ nbGoWorkspace(_nbRole); return; }
  // Navbar state not populated yet — double-check the persisted session before
  // ever showing the modal (handles a click during auth initialisation).
  if(typeof window.getSession === 'function'){
    Promise.resolve(window.getSession()).then(function(s){
      if(!s){ nbShowAuthModal(); return; }
      if(_nbRole){ nbGoWorkspace(_nbRole); return; }
      if(typeof window.getProfile === 'function'){
        Promise.resolve(window.getProfile(s.user.id))
          .then(function(p){ nbGoWorkspace(p && p.role); })
          .catch(function(){ nbGoWorkspace(null); });
      } else { nbGoWorkspace(null); }
    }).catch(function(){ nbShowAuthModal(); });
    return;
  }
  nbShowAuthModal();
};

// ── One account, multiple roles ───────────────────────────────
// A logged-in clinician can also be their own patient. We NEVER touch their
// auth account or profile role — the patient journey simply uses the same
// authenticated user (patient data is keyed by auth.uid()). No second login.
function _nbPatientOptKey(uid){ return 'anestheo-patient-optin-' + uid; }
async function _nbHasPatientData(uid){
  try { var r = await window.sb.from('patient_surgeries').select('id').eq('patient_id', uid).limit(1);
        if (r && r.data && r.data.length) return true; } catch(e){}
  try { if (typeof window.getQuestionnaire === 'function') { var q = await window.getQuestionnaire(uid); if (q) return true; } } catch(e){}
  return false;
}
function _nbShowPatientOptIn(uid){
  if (document.getElementById('nb-pj-modal')) return;
  var bg = document.createElement('div');
  bg.id = 'nb-pj-modal';
  bg.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(4,10,8,.8);display:flex;align-items:center;justify-content:center;padding:20px;';
  bg.innerHTML =
    '<div role="dialog" aria-modal="true" style="background:#0A1614;border:1px solid rgba(42,138,116,.4);border-radius:16px;max-width:420px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,.6);padding:24px;font-family:inherit;">' +
      '<div style="font-family:\'Playfair Display\',serif;font-size:21px;font-weight:700;color:#fff;margin-bottom:10px;">Start your own surgery journey</div>' +
      '<p style="font-size:13.5px;color:rgba(255,255,255,.62);line-height:1.65;margin-bottom:6px;">You are currently using your <b style="color:#9FF0CF;">Doctor workspace</b>.</p>' +
      '<p style="font-size:13.5px;color:rgba(255,255,255,.62);line-height:1.65;margin-bottom:20px;">Would you like to create your personal Patient profile? It stays on this same account &mdash; no new login &mdash; and you can switch back to your Doctor workspace any time.</p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
        '<button id="nb-pj-go" style="flex:1;min-width:170px;background:linear-gradient(135deg,#2A8A74,#1B6B5A);color:#fff;border:none;border-radius:11px;padding:12px 18px;font-family:inherit;font-weight:800;font-size:14px;cursor:pointer;">Start my patient journey</button>' +
        '<button id="nb-pj-cancel" style="flex:0 0 auto;background:rgba(255,255,255,.06);color:#fff;border:1px solid rgba(255,255,255,.14);border-radius:11px;padding:12px 18px;font-family:inherit;font-weight:700;font-size:14px;cursor:pointer;">Cancel</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(bg);
  document.body.style.overflow = 'hidden';
  function close(){ bg.remove(); document.body.style.overflow = ''; }
  bg.addEventListener('click', function(e){ if (e.target === bg) close(); });
  document.getElementById('nb-pj-cancel').onclick = close;
  document.getElementById('nb-pj-go').onclick = function(){
    // Mark the opt-in (same auth user) and open the patient journey. The journey
    // page (patient-dashboard.html) is open to any authenticated user and saves
    // data under this auth.uid(); the doctor role/profile is left untouched.
    try { localStorage.setItem(_nbPatientOptKey(uid), '1'); } catch(e){}
    window.location.href = '/v2/patient-dashboard.html';
  };
}
// "Start my surgery journey" / "My Patient Journey" entry point.
window.nbStartPatientJourney = async function(){
  var sess = null;
  try { sess = (typeof window.getSession === 'function') ? await window.getSession() : null; } catch(e){}
  if (!sess){ nbShowAuthModal(); return; }                 // not signed in → sign in / sign up
  if (_nbRole === 'patient'){ window.location.href = '/v2/patient-dashboard.html'; return; }
  var uid = sess.user.id;
  var optedIn = false;
  try { optedIn = localStorage.getItem(_nbPatientOptKey(uid)) === '1'; } catch(e){}
  if (optedIn || await _nbHasPatientData(uid)){ window.location.href = '/v2/patient-dashboard.html'; return; }
  _nbShowPatientOptIn(uid);                                  // clinician with no journey yet → ask first
};

window.nbCloseModal = function(){
  ge('nb-modal').classList.remove('open');
  document.body.style.overflow = '';
  showMsg(null);
};

function applyMode(){
  var isReg = _authMode === 'register';
  var title = ge('nb-modal-title'), sub = ge('nb-modal-sub'), btn = ge('nb-submit-btn');
  var ttext = ge('nb-toggle-text'), tbtn = ge('nb-toggle-btn'), forgot = ge('nb-forgot-row');
  var roleStep = ge('nb-role-step'), credStep = ge('nb-cred-step'), pill = ge('nb-role-pill');
  if(title) title.textContent = isReg ? 'Create account' : 'Sign in';
  if(ttext) ttext.textContent = isReg ? 'Already have an account?' : 'New to Anestheo?';
  if(tbtn)  tbtn.textContent  = isReg ? 'Sign in' : 'Create an account';
  if(forgot) forgot.style.display = isReg ? 'none' : 'block';
  if(btn)   btn.textContent   = isReg ? 'Create account' : 'Sign in';
  var passEl = ge('nb-pass');
  if(passEl) passEl.setAttribute('autocomplete', isReg ? 'new-password' : 'current-password');

  if(isReg){
    // Step 1: pick role. Hide credentials until a role is chosen.
    _regRole = null;
    if(sub) sub.textContent = 'Choose how you will use Anestheo';
    if(roleStep) roleStep.style.display = 'block';
    if(credStep) credStep.style.display = 'none';
    if(pill) pill.style.display = 'none';
  } else {
    if(sub) sub.textContent = 'Access Anestheo';
    if(roleStep) roleStep.style.display = 'none';
    if(credStep) credStep.style.display = 'block';
    if(pill) pill.style.display = 'none';
  }
  showMsg(null);
}

var _roleLabels = { patient:'Patient', doctor:'Doctor', other:'Nurse / Student / Other' };

window.nbPickRole = function(role){
  _regRole = role;
  var sub = ge('nb-modal-sub'), roleStep = ge('nb-role-step'), credStep = ge('nb-cred-step'), pill = ge('nb-role-pill');
  if(sub) sub.textContent = 'Create your account';
  if(roleStep) roleStep.style.display = 'none';
  if(credStep) credStep.style.display = 'block';
  if(pill){
    pill.style.display = 'flex';
    pill.innerHTML = '<span>Signing up as <strong>' + (_roleLabels[role] || role) + '</strong></span>' +
      '<button onclick="window.nbBackToRole()">Change</button>';
  }
  setTimeout(function(){ var e = ge('nb-email'); if(e) e.focus(); }, 60);
};

window.nbBackToRole = function(){
  _regRole = null;
  applyMode();
};

window.nbToggleMode = function(){
  _authMode = (_authMode === 'register') ? 'signin' : 'register';
  applyMode();
};

// ── Mobile drawer ─────────────────────────────────────────────
// Backdrop, scroll lock that preserves position, focus trap, Escape to close
// and focus restored to the menu button.
var _nbMobScrollY = 0;
function nbMobFocusables(){
  var m = ge('nb-mob'); if(!m) return [];
  return Array.prototype.filter.call(
    m.querySelectorAll('a[href],button:not([disabled])'),
    function(el){ return el.offsetParent !== null; });
}
function nbMobTrap(e){
  if(e.key !== 'Tab') return;
  var f = nbMobFocusables(); if(!f.length) return;
  var first = f[0], last = f[f.length - 1];
  if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
}
window.nbOpenMob = function(){
  var m = ge('nb-mob'), bg = ge('nb-mob-bg'), btn = ge('nb-burger');
  if(!m || m.classList.contains('open')) return;
  _nbMobScrollY = window.scrollY || window.pageYOffset || 0;
  m.classList.add('open');
  if(bg) bg.classList.add('open');
  if(btn) btn.setAttribute('aria-expanded', 'true');
  document.body.style.top = (-_nbMobScrollY) + 'px';
  document.body.classList.add('nb-lock');           // no background interaction
  document.addEventListener('keydown', nbMobTrap, true);
  var f = nbMobFocusables();
  if(f.length) setTimeout(function(){ f[0].focus(); }, 30);
};
window.nbCloseMob = function(){
  var m = ge('nb-mob'), bg = ge('nb-mob-bg'), btn = ge('nb-burger');
  if(!m || !m.classList.contains('open')) return;
  m.classList.remove('open');
  if(bg) bg.classList.remove('open');
  if(btn) btn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('keydown', nbMobTrap, true);
  document.body.classList.remove('nb-lock');
  document.body.style.top = '';
  window.scrollTo(0, _nbMobScrollY);                // restore scroll position
  if(btn) btn.focus();                              // restore focus
};
window.nbToggleMob = function(){
  var m = ge('nb-mob');
  if(m && m.classList.contains('open')) window.nbCloseMob();
  else window.nbOpenMob();
};
// Selecting a destination closes the drawer (and unlocks scroll before nav).
document.addEventListener('click', function(e){
  var m = ge('nb-mob');
  if(!m || !m.classList.contains('open')) return;
  if(e.target.closest && e.target.closest('#nb-mob a')) window.nbCloseMob();
});

document.addEventListener('click', function(e){
  var mob  = ge('nb-mob');
  if(mob && mob.classList.contains('open') && !e.target.closest('#nb-nav') && !e.target.closest('#nb-mob')){
    window.nbCloseMob();          // must go through the closer: unlocks scroll,
  }                               // hides the backdrop and restores focus
  var menu = ge('nb-menu');
  if(menu && menu.classList.contains('open') && !e.target.closest('#nb-avatar-wrap')){
    menu.classList.remove('open');
  }
  var sr = ge('nb-search-results');
  if(sr && sr.classList.contains('open') && !e.target.closest('#nb-search-wrap')){
    sr.classList.remove('open');
  }
});

// Single submit handler — routes by mode. Never confuses sign-in and register.
window.nbSubmitAuth = async function(){
  showMsg(null);
  var emailEl = ge('nb-email'), passEl = ge('nb-pass');
  var email = (emailEl && emailEl.value || '').trim().toLowerCase();
  var pass  = (passEl  && passEl.value  || '').trim();

  console.log('AUTH mode:', _authMode, '| email value:', JSON.stringify(email), '| field found:', !!emailEl);

  // Correct email check: non-space local part, @, then a domain with a dot.
  var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  console.log('AUTH validation — emailOk:', emailOk, '| passLen:', pass.length);

  if(!emailOk){
    showMsg('err', 'Enter a valid email address.'); return;
  }
  if(_authMode === 'register'){
    if(pass.length < 6){ showMsg('err', 'Password must be at least 6 characters.'); return; }
  } else {
    if(!pass){ showMsg('err', 'Enter your password.'); return; }
  }
  console.log('AUTH validation passed — calling Supabase', _authMode === 'register' ? 'signUp' : 'signInWithPassword');

  setBtns(true);
  ge('nb-submit-btn').textContent = (_authMode === 'register') ? 'Creating\u2026' : 'Signing in\u2026';

  try {
    if(_authMode === 'register'){
      if(!_regRole){ setBtns(false); showMsg('err', 'Please choose how you will use Anestheo.'); return; }
      var verif = (_regRole === 'doctor') ? 'pending' : 'not_required';
      var rs = await window.sb.auth.signUp({
        email: email, password: pass,
        options: { data: { role: _regRole, verification_status: verif } }
      });
      console.log('AUTH signUp result — data:', rs.data, '| error:', rs.error, '| role:', _regRole);
      setBtns(false);
      if(rs.error){ showMsg('err', rs.error.message); return; }

      if(rs.data.user && rs.data.session){
        // Active session — persist role to profiles now, then route.
        try {
          // Role is privileged: the server sets it (and decides verification).
          await window.setOwnRole(_regRole);
        } catch(e){ console.warn('profile role save deferred:', e.message); }
        window.nbCloseModal();
        routeByRole(_regRole);
      } else if(rs.data.user && !rs.data.session){
        // Email confirmation required — role saved in user metadata, applied on first login.
        showMsg('ok', '&#10003; Account created as <strong>' + (_roleLabels[_regRole]||_regRole) + '</strong>. Check <strong>' + email + '</strong> to confirm your email, then sign in.');
      } else {
        showMsg('ok', '&#10003; Check <strong>' + email + '</strong> to confirm your account.');
      }
    } else {
      // ════════════════════════════════════════════════════════
      //  LOGIN DIAGNOSTIC — prints exactly one verdict: A–F
      // ════════════════════════════════════════════════════════
      console.log('========== LOGIN DIAGNOSTIC START ==========');
      console.log('STEP 1 — calling signInWithPassword for', email);

      var ri;
      try {
        ri = await window.sb.auth.signInWithPassword({ email: email, password: pass });
      } catch(connErr){
        console.error('DIAGNOSIS: F) Supabase connection error —', connErr.message);
        setBtns(false);
        showMsg('err', 'Connection error reaching the server. Check your network and try again.');
        return;
      }
      console.log('STEP 1 RESULT — data:', ri.data, '| error:', ri.error);

      // STEP 2 — error branches (A / B / F)
      if(ri.error){
        var m = ri.error.message || '';
        console.log('STEP 2 — error message:', m, '| status:', ri.error.status);
        setBtns(false);
        if(/email not confirmed/i.test(m)){
          console.log('DIAGNOSIS: B) Email not confirmed');
          showMsg('err', 'Please confirm your email before signing in. Check your inbox for the confirmation link.');
        } else if(/invalid login credentials/i.test(m) || /invalid/i.test(m)){
          console.log('DIAGNOSIS: A) Invalid credentials');
          showMsg('err', 'Invalid login credentials. Check your email and password.');
        } else if(/network|fetch|failed to fetch/i.test(m)){
          console.log('DIAGNOSIS: F) Supabase connection error');
          showMsg('err', m);
        } else {
          console.log('DIAGNOSIS: (error) —', m);
          showMsg('err', m);
        }
        console.log('========== LOGIN DIAGNOSTIC END ==========');
        return;
      }

      console.log('LOGIN SUCCESS');

      // STEP 3 — verify session is saved (E)
      var sessRes = await window.sb.auth.getSession();
      var session = sessRes.data && sessRes.data.session;
      console.log('STEP 3 — getSession():', sessRes.data);
      console.log('STEP 3 — session exists:', !!session);
      if(!session){
        console.log('DIAGNOSIS: E) Session not being saved (signIn returned a user but getSession() is empty)');
        setBtns(false);
        showMsg('err', 'Login succeeded but the session was not saved. Storage may be blocked in this browser context.');
        console.log('========== LOGIN DIAGNOSTIC END ==========');
        return;
      }
      console.log('STEP 3 — user.id:', session.user.id, '| email:', session.user.email);

      // STEP 4 — profile lookup (C)
      console.log('STEP 4 — querying profiles for', session.user.id);
      var prof = null, profErr = null;
      try {
        var pr = await window.sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
        prof = pr.data; profErr = pr.error;
        console.log('STEP 4 — profiles query result — data:', pr.data, '| error:', pr.error);
      } catch(e){ profErr = e; console.log('STEP 4 — profiles query threw:', e.message); }

      // STEP 5 — auto-create profile if missing, do not fail login
      if(!prof){
        console.log('STEP 5 — profile missing, auto-creating…');
        try {
          prof = await window.ensureProfile(session.user);
          console.log('STEP 5 — after ensureProfile — profile:', prof);
        } catch(e){ console.log('STEP 5 — ensureProfile failed:', e.message); }
        if(!prof){
          console.log('DIAGNOSIS: C) User authenticated but profile missing (auto-create failed — check profiles RLS insert policy)');
          setBtns(false);
          showMsg('err', 'Signed in, but your profile could not be created. Please contact support.');
          console.log('========== LOGIN DIAGNOSTIC END ==========');
          return;
        }
      }
      console.log('ROLE:', prof.is_admin ? 'admin' : prof.role);

      // STEP 6 — redirect (D)
      // Default landing by role: patients land on the Patient Home (the
      // authenticated state of /v2/index.html); My Space stays reachable from
      // the navbar and the Home hero. Doctors/admins are unchanged.
      if(window.resetSessionCache) window.resetSessionCache();
      var _isAdmin = prof && (prof.is_admin === true || prof.role === 'admin');
      var dest = (!_isAdmin && prof && prof.role === 'patient') ? '/v2/index.html' : '/v2/dashboard.html';
      console.log('REDIRECTING TO —', dest);
      console.log('DIAGNOSIS: none — auth OK, redirect issued to', dest);
      console.log('========== LOGIN DIAGNOSTIC END ==========');
      window.nbCloseModal();
      window.location.href = dest;
      // If the page does not change after this line, the verdict is:
      // D) User authenticated but redirect broken
      setTimeout(function(){
        console.log('DIAGNOSIS CHECK: if you still see this page, verdict = D) redirect broken. Destination was', dest);
      }, 1500);
    }
  } catch(e){
    setBtns(false);
    console.error('AUTH exception:', e);
    showMsg('err', e && e.message ? e.message : 'Network error. Please try again.');
  }
};

// Route a freshly-created user to the right place by role
function routeByRole(role){
  if(role === 'patient'){ window.location.href = '/v2/index.html'; }   // Patient Home
  else { window.location.href = '/v2/dashboard.html'; }  // doctor/other/admin → workspace (verification banner shows for doctors)
}

// Back-compat aliases
window.nbSignIn = function(){ _authMode = 'signin';   applyMode(); window.nbSubmitAuth(); };
window.nbSignUp = function(){ _authMode = 'register';  applyMode(); window.nbSubmitAuth(); };

window.nbForgot = async function(){
  var email = (ge('nb-email').value || '').trim().toLowerCase();
  if(!email || !email.includes('@')){ showMsg('err', 'Enter your email above first.'); return; }
  var r = await window.sb.auth.resetPasswordForEmail(email);
  if(r.error){ showMsg('err', r.error.message); return; }
  showMsg('ok', '&#10003; Reset email sent to <strong>' + email + '</strong>.');
};

window.nbSignOut = async function(){
  try { await window.sb.auth.signOut(); } catch(e){}
  window.location.href = '/v2/index.html';
};

// ── INIT ──────────────────────────────────────────────────────
var _nbInitDone = false;
// ── Shared application footer ────────────────────────────────────────────
// One source of truth: every authenticated page gets the SAME compact footer.
// Rendered as a <div role="contentinfo"> (not <footer>) so pages that hide the
// marketing <footer> for logged-in users don't accidentally hide this one.
function nbAppFooter(){
  function col(h, links){
    return '<div class="nb-foot-col"><div class="nb-foot-h">'+h+'</div>'+
      links.map(function(l){
        var ext = /^https?:/.test(l[1]);
        return '<a href="'+l[1]+'"'+(ext?' target="_blank" rel="noopener"':'')+'>'+l[0]+'</a>';
      }).join('')+'</div>';
  }
  return '<div class="nb-foot" role="contentinfo" id="nb-app-foot"><div class="nb-foot-in"><div class="nb-foot-cols">'+
    col('Company', [['About','/v2/about.html'],['Support','mailto:support@anestheo.com']])+
    col('Legal &amp; Trust', [['Privacy','/v2/privacy.html'],['Terms','/v2/terms.html'],['Medical Disclaimer','/v2/medical-disclaimer.html'],['Security','/v2/security.html']])+
    col('Product', [['Release Notes','/v2/release-notes.html'],['Report a Bug','mailto:support@anestheo.com?subject=Bug%20report']])+
    '</div><div class="nb-foot-bot"><span class="nb-foot-brand">Anest<span>heo</span></span>'+
    '<span class="nb-foot-copy">&copy; 2026 Anestheo</span></div></div></div>';
}
window.nbAppFooter = nbAppFooter;

// Mount the shared footer once, on authenticated pages. Pages that render it
// themselves (e.g. the Home shell) set body[data-app-footer="self"] to opt out.
function nbMountFooter(){
  if(document.body.getAttribute('data-app-footer') === 'self') return;
  if(document.getElementById('nb-app-foot')) return;
  var tmp = document.createElement('div');
  tmp.innerHTML = nbAppFooter();
  document.body.appendChild(tmp.firstChild);
  // Replace any legacy marketing footer for signed-in users.
  Array.prototype.forEach.call(document.querySelectorAll('.site-footer'), function(f){ f.style.display = 'none'; });
}
window.nbMountFooter = nbMountFooter;

async function nbInit(){
  if(_nbInitDone){ console.log('nbInit already ran - skipping duplicate'); return; }
  _nbInitDone = true;
  injectCSS();
  var page = location.pathname.split('/').pop() || 'index.html';
  var ph = document.getElementById('nb-placeholder');
  var html = buildHTML(page);
  if(ph){
    ph.outerHTML = html;
  } else if(!document.getElementById('nb-nav')){
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    while(tmp.firstChild) document.body.insertBefore(tmp.firstChild, document.body.firstChild);
  }

  setGuest(); // default while session loads

  try {
    var session = await window.getSession();
    if(session){
      setAuth();
      nbMountFooter();                       // shared footer on authenticated pages
      var profile = await window.getProfile(session.user.id);
      populateMenu(session.user, profile);
    }
    window.sb.auth.onAuthStateChange(async function(event, sess){
      if(event === 'SIGNED_IN'  && sess){
        setAuth();
        nbMountFooter();
        var p = await window.getProfile(sess.user.id);
        populateMenu(sess.user, p);
      }
      if(event === 'SIGNED_OUT'){ setGuest(); }
    });
    console.log('NAVBAR READY');
  } catch(e){
    console.error('navbar init error:', e.message);
  }
}

document.addEventListener('DOMContentLoaded', function(){ nbInit(); });
document.addEventListener('keydown', function(e){
  if(e.key !== 'Escape') return;
  var m = ge('nb-mob');
  if(m && m.classList.contains('open')){ window.nbCloseMob(); return; }
  window.nbCloseModal();
});

})();
