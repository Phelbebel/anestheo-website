// navbar.js — shared navbar
// Requires: /supabase.js then /auth.js loaded first

(function(){

/* ── Navigation tokens ──────────────────────────────────────────────────────
   The bar is injected at runtime, so its <style> lands after every page's own
   inline block and after any stylesheet. That means it must not read the
   page's palette: a light composition such as the public homepage defines
   --muted and --hair as dark ink on paper, and the bar would quietly paint
   itself unreadable. These are private (--nb-*) for that reason — they can
   collide with nothing, and the bar renders identically whether the page
   loaded tokens.css, its own palette, or no stylesheet at all.

   Their VALUES are the canonical ones from tokens.css. Keep the two in step:
   the bar is the only chrome shared by all 58 pages, so drift here is drift
   everywhere.                                                              */
var CSS = `
:root{
  /* Graphite, from the homepage masthead: a translucent bar over the page's
     own ground rather than a separate black strip above it. */
  --nb-bg:rgba(11,22,32,.72); --nb-bg-drawer:#0B1620; --nb-panel:#0E1C27;
  --nb-modal:#0E1C27; --nb-foot:#0A131C;

  --nb-teal:#1B6B5A; --nb-teal2:#2FA88C;
  --nb-accent:#7ECFC0; --nb-accent-2:#9FE0D2; --nb-accent-3:#CFF3EA;

  --nb-edge:rgba(255,255,255,.09); --nb-edge-2:rgba(47,168,140,.5);
  --nb-hair:rgba(255,255,255,.16);

  --nb-text:#F2F6F8;
  --nb-t2:#C7D3DB; --nb-t3:#93A6B4;
  --nb-t4:#6D8091; --nb-t5:#5A6B78;
  --nb-surface:rgba(255,255,255,.035); --nb-surface-2:rgba(255,255,255,.05);
  --nb-danger:#FF9B86;

  /* One radius scale, matching tokens.css. The bar previously used 3, 6, 7,
     8, 9, 10, 12, 13, 14 and 30px — nine radii on one 56px strip. */
  --nb-r-sm:8px; --nb-r-md:12px; --nb-r-lg:16px; --nb-r-pill:999px;
  --nb-dur:.18s;
}

/* The clinical surface sits one step deeper than the public one, so the bar
   goes with it — and there it is opaque, because a translucent strip over a
   dense table is legibility spent on an effect. */
html.theme-clinical{
  --nb-bg:#070F16; --nb-bg-drawer:#0A141C; --nb-panel:#0D1A24;
  --nb-modal:#0D1A24; --nb-foot:#08121A;
  --nb-edge:rgba(47,168,140,.24);
  --nb-text:#FFFFFF; --nb-t2:rgba(255,255,255,.78);
  --nb-t3:#9FB3C0; --nb-t4:#748795; --nb-t5:#5E6F7C;
}
html.theme-clinical .nb{ -webkit-backdrop-filter:none; backdrop-filter:none; }

/* The light counterpart, for public and patient-facing pages.

   Selector note: this must be html.theme-light rather than a bare
   .theme-light. Both :root and .theme-light have the same specificity, and
   this stylesheet is injected at runtime — so it lands after tokens.css and a
   bare class would lose the tie to the :root block six lines above. Adding
   the element makes it (0,1,1) and the intent wins outright.

   Only ground, ink and edge move. The teal, the radii and the timing are the
   same values the dark bar uses: it is the same bar in a different light. */
html.theme-light{
  --nb-bg:rgba(250,250,248,.86); --nb-bg-drawer:#FFFFFF; --nb-panel:#FFFFFF;
  --nb-modal:#FFFFFF; --nb-foot:#F3F3EF;

  --nb-edge:rgba(20,24,26,.10); --nb-edge-2:rgba(27,107,90,.45);
  --nb-hair:rgba(20,24,26,.12);

  --nb-text:#14181A;
  --nb-t2:#3A4144; --nb-t3:#5A6360; --nb-t4:#6B726E; --nb-t5:#8A918E;
  --nb-surface:rgba(20,24,26,.04); --nb-surface-2:rgba(20,24,26,.06);
  --nb-danger:#B3261E;

  /* On paper the brand reads at full strength; the lifted teal that carries
     the dark bar would wash out, so --nb-accent becomes the brand itself. */
  --nb-accent:#1B6B5A; --nb-accent-2:#155646; --nb-accent-3:#0F4437;
}
/* A translucent bar needs the blur, or scrolled content shows through it as
   noise rather than as depth. */
html.theme-light .nb{ -webkit-backdrop-filter:saturate(1.6) blur(10px); backdrop-filter:saturate(1.6) blur(10px); }
/* The dark bar separates its links from the ground with a white wash. On
   paper the same wash is invisible, so hover tints toward the ink instead. */
html.theme-light .nb-nav-links a:hover,
html.theme-light .nb-link:hover{ background:var(--nb-surface); }
html.theme-light .nb-menu,
html.theme-light .nb-search-results,
html.theme-light .nb-modal{ box-shadow:0 18px 44px rgba(20,24,26,.14); }
html.theme-light .nb-search,
html.theme-light .nb-modal input{ background:#fff; border-color:var(--nb-hair); }
html.theme-light .nb-sr-item:hover,
html.theme-light .nb-sr-item.sel,
html.theme-light .nb-menu-item:hover{ background:rgba(27,107,90,.07); color:var(--nb-text); }
html.theme-light .nb-signout{ border-color:var(--nb-hair); color:var(--nb-t3); }
html.theme-light .nb-signout:hover{ border-color:var(--nb-t4); color:var(--nb-text); }
html.theme-light .nb-modal-btn-ghost{ border-color:var(--nb-hair)!important; color:var(--nb-text); }
html.theme-light .nb-modal-btn-ghost:hover{ background:var(--nb-surface); }
html.theme-light .nb-soc{ background:#fff; border-color:var(--nb-hair); color:var(--nb-text); }
html.theme-light .nb-soc:hover{ background:var(--nb-surface); border-color:var(--nb-t5); }
html.theme-light .nb-soc-apple .nb-soc-i{ color:var(--nb-text); }
html.theme-light .nb-or{ color:var(--nb-t4); }
html.theme-light .nb-or::before,
html.theme-light .nb-or::after{ background:var(--nb-hair); }
html.theme-light .nb-modal-ok{ background:rgba(27,107,90,.08); border-color:rgba(27,107,90,.24); color:#155646; }
html.theme-light .nb-modal-err{ background:rgba(179,38,30,.06); border-color:rgba(179,38,30,.22); color:#B3261E; }
html.theme-light .nb-mob{ box-shadow:0 18px 40px -18px rgba(20,24,26,.35); }
html.theme-light .nb-mob-bg{ background:rgba(20,24,26,.28); }
html.theme-light .nb-mob-card{ background:#fff; border-color:var(--nb-edge); }
*{box-sizing:border-box;}
/* The homepage masthead: translucent graphite over the page's own ground,
   blurred, closed with a hairline. The bar is chrome, not a separate strip. */
.nb{position:fixed;top:0;left:0;right:0;height:56px;z-index:900;
  background:var(--nb-bg);border-bottom:1px solid var(--nb-edge);
  -webkit-backdrop-filter:blur(14px); backdrop-filter:blur(14px);
  font-family:var(--nb-font,'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif);}
.nb-inner{max-width:1100px;margin:0 auto;padding:0 24px;height:100%;
  display:flex;align-items:center;gap:0;}
.nb-logo{text-decoration:none;font-size:18px;font-weight:600;color:var(--nb-text);
  letter-spacing:.01em;flex-shrink:0;margin-right:16px;}
.nb-logo span{color:var(--nb-teal2);}
.nb-nav-links{display:flex;align-items:center;gap:2px;flex:1;}
.nb-nav-links a,.nb-link{color:var(--nb-t3);text-decoration:none;font-size:14px;
  padding:7px 11px;border-radius:var(--nb-r-sm);transition:color var(--nb-dur),background var(--nb-dur);white-space:nowrap;}
.nb-nav-links a:hover,.nb-link:hover{color:var(--nb-text);background:var(--nb-surface-2);}
.nb-nav-links a.nb-active,.nb-link.nb-active{color:var(--nb-text);}
.nb-right{display:flex;align-items:center;gap:6px;margin-left:auto;flex-shrink:0;}
#nb-auth-links{align-items:center;gap:6px;}
.nb-btn{background:var(--nb-teal);color:var(--nb-text);border:none;padding:7px 16px;
  border-radius:var(--nb-r-sm);font-size:13px;font-weight:500;cursor:pointer;
  font-family:inherit;transition:background .2s;white-space:nowrap;}
.nb-btn:hover{background:var(--nb-teal2);}
.nb-signout{background:transparent;border:1px solid var(--nb-hair);
  color:var(--nb-t3);padding:6px 13px;border-radius:var(--nb-r-sm);
  font-size:13px;cursor:pointer;font-family:inherit;transition:all .2s;}
.nb-signout:hover{border-color:var(--nb-t5);color:var(--nb-text);}
/* avatar menu */
.nb-avatar-wrap{position:relative;}
.nb-avatar-btn{display:flex;align-items:center;gap:5px;background:none;border:none;
  cursor:pointer;padding:2px;border-radius:var(--nb-r-pill);transition:background var(--nb-dur);}
.nb-avatar-btn:hover{background:var(--nb-surface-2);}
.nb-avatar{width:32px;height:32px;border-radius:50%;background:var(--nb-teal2);color:var(--nb-text);
  display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;
  letter-spacing:.02em;flex-shrink:0;font-family:inherit;overflow:hidden;}
/* Once a photo is in, the teal disc behind it would show as a rim. */
.nb-avatar[data-avatar]{background:var(--nb-surface-2);}
.nb-chev{font-size:10px;color:var(--nb-t4);padding-right:4px;}
.nb-menu{display:none;position:absolute;top:calc(100% + 10px);right:0;min-width:240px;
  background:var(--nb-panel);border:1px solid rgba(27,107,90,.3);border-radius:var(--nb-r-lg);
  box-shadow:0 18px 50px rgba(0,0,0,.55);overflow:hidden;z-index:1001;}
.nb-menu.open{display:block;animation:nbfade .16s ease;}
@keyframes nbfade{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.nb-menu-head{padding:14px 16px 12px;border-bottom:1px solid rgba(27,107,90,.18);}
.nb-menu-name{font-size:14px;font-weight:600;color:var(--nb-text);}
.nb-menu-role{font-size:11px;color:var(--nb-accent);font-weight:500;margin-top:1px;}
/* global search */
.nb-search-wrap{position:relative;}
.nb-search{background:var(--nb-surface-2);border:1px solid var(--nb-hair);border-radius:var(--nb-r-md);
  padding:8px 13px;color:var(--nb-text);font-size:13px;font-family:inherit;outline:none;width:210px;
  transition:border-color .2s,width .2s;min-height:38px;}
.nb-search:focus{border-color:var(--nb-teal2);width:250px;}
.nb-search::placeholder{color:var(--nb-t5);}
.nb-search-results{display:none;position:absolute;top:calc(100% + 8px);right:0;min-width:280px;max-width:340px;
  max-height:380px;overflow-y:auto;background:var(--nb-panel);border:1px solid rgba(27,107,90,.3);border-radius:var(--nb-r-lg);
  box-shadow:0 16px 44px rgba(0,0,0,.5);z-index:1002;padding:6px;}
.nb-search-results.open{display:block;animation:nbfade .15s ease;}
.nb-sr-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--nb-r-sm);
  color:var(--nb-t2);text-decoration:none;cursor:pointer;font-size:13px;transition:all .13s;}
.nb-sr-item:hover,.nb-sr-item.sel{background:rgba(27,107,90,.18);color:var(--nb-text);}
.nb-sr-ico{font-size:15px;flex-shrink:0;}
.nb-sr-main{flex:1;min-width:0;}
.nb-sr-title{font-weight:500;}
.nb-sr-cat{font-size:11px;color:var(--nb-t5);margin-top:1px;}
.nb-sr-empty{padding:16px 12px;text-align:center;color:var(--nb-t5);font-size:13px;}
@media(max-width:880px){.nb-search{width:150px;}.nb-search:focus{width:180px;}}
.nb-menu-email{font-size:12px;color:var(--nb-t4);margin-top:2px;word-break:break-all;}
.nb-menu-item{display:flex;align-items:center;gap:10px;padding:10px 16px;font-size:13px;
  color:var(--nb-t2);text-decoration:none;cursor:pointer;transition:all .15s;
  background:none;border:none;width:100%;text-align:left;font-family:inherit;}
.nb-menu-item:hover{background:rgba(27,107,90,.13);color:var(--nb-text);}
.nb-menu-sep{height:1px;background:rgba(27,107,90,.16);margin:4px 0;}
.nb-menu-danger{color:rgba(255,120,100,.75);}
.nb-menu-danger:hover{background:rgba(192,57,43,.1);color:rgba(255,140,120,.92);}
.nb-burger{display:none;background:none;border:none;color:var(--nb-text);font-size:20px;
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
  background:var(--nb-bg-drawer);border-bottom:1px solid var(--nb-edge);
  border-radius:0 0 16px 16px;box-shadow:0 18px 40px -18px rgba(0,0,0,.9);
  flex-direction:column;padding:14px 0 max(18px,env(safe-area-inset-bottom));
  max-height:calc(100vh - 56px);overflow-y:auto;overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch;}
@supports(height:100dvh){ .nb-mob{max-height:calc(100dvh - 56px);} }
.nb-mob.open{display:flex;}
.nb-mob-link,.nb-mob button{display:block;padding:12px 24px;font-size:15px;
  color:var(--nb-t3);text-decoration:none;transition:color .18s;
  border:none;background:none;width:100%;text-align:left;
  font-family:inherit;cursor:pointer;}
.nb-mob-link:hover,.nb-mob button:hover{color:var(--nb-text);}
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
  min-height:56px;padding:11px 14px;border-radius:var(--nb-r-lg);text-decoration:none;
  border:1px solid var(--nb-edge);background:var(--nb-surface);
  position:relative;overflow:hidden;transition:border-color var(--nb-dur),background var(--nb-dur);}
.nb-mob-card:active{background:rgba(27,107,90,.16);}
.nb-mob-ico{width:38px;height:38px;border-radius:var(--nb-r-md);display:flex;align-items:center;
  justify-content:center;font-size:17px;line-height:1;
  background:rgba(27,107,90,.18);border:1px solid rgba(27,107,90,.26);}
.nb-mob-tx{min-width:0;}
.nb-mob-lb{display:block;font-size:15px;font-weight:600;color:var(--nb-text);line-height:1.25;}
.nb-mob-ds{display:block;font-size:12px;color:var(--nb-t4);line-height:1.4;margin-top:2px;}
/* Active workspace — border + background + icon emphasis + accent bar. */
.nb-mob-card.on{border-color:rgba(42,138,116,.6);background:rgba(27,107,90,.22);}
.nb-mob-card.on::before{content:'';position:absolute;left:0;top:10px;bottom:10px;width:3px;
  border-radius:0 3px 3px 0;background:var(--nb-teal2);}
.nb-mob-card.on .nb-mob-ico{background:rgba(42,138,116,.34);border-color:rgba(126,207,192,.4);}
.nb-mob-card.on .nb-mob-lb{color:var(--nb-text);}

/* The Live Tools strip: which tool inside the workspace you are looking at. */
.nb-tools{display:flex;gap:6px;flex-wrap:wrap;padding:0;margin:0 0 16px;}
.nb-tool{display:inline-block;padding:7px 14px;border-radius:var(--nb-r-sm);font-size:13.5px;
  font-weight:600;text-decoration:none;color:var(--nb-t3);
  background:var(--nb-surface);border:1px solid var(--nb-hair);
  min-height:38px;line-height:22px;transition:all .16s;}
.nb-tool:hover{color:var(--nb-text);background:rgba(126,207,192,.1);border-color:rgba(126,207,192,.4);}
.nb-tool.on{color:var(--nb-text);background:rgba(27,107,90,.26);border-color:var(--nb-teal2);}
@media(max-width:520px){ .nb-tool{flex:1 1 auto;text-align:center;} }

/* Live Tools — the one elevated card. Teal only. */
.nb-mob-card.live{border-color:rgba(42,138,116,.5);
  background:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='30' viewBox='0 0 120 30'%3E%3Cpolyline points='0,15 22,15 30,6 38,24 46,15 68,15 76,11 84,19 92,15 120,15' fill='none' stroke='%237ECFC0' stroke-width='1.4' stroke-linejoin='round' stroke-linecap='round' opacity='.34'/%3E%3C/svg%3E") right -6px center/auto 26px no-repeat,
    linear-gradient(180deg,rgba(27,107,90,.24),rgba(27,107,90,.09));
  box-shadow:0 0 0 1px rgba(42,138,116,.16), 0 6px 18px -10px rgba(42,138,116,.75);}
.nb-mob-card.live .nb-mob-lb{color:var(--nb-accent-3);}
.nb-mob-card.live .nb-mob-ico{background:rgba(42,138,116,.3);border-color:rgba(126,207,192,.34);}
.nb-mob-card.live.on{border-color:rgba(126,207,192,.65);}
.nb-mob-card.live.on .nb-mob-lb{color:var(--nb-text);}
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
.nb-mob-acct .nb-mob-link{color:var(--nb-t2);}
.nb-mob-signout{min-height:48px;display:flex;align-items:center;padding:0 24px;
  color:var(--nb-danger)!important;font-size:15px;}
.nb-mob-signout:hover{color:rgba(255,150,130,1)!important;}
.nb-modal-bg{display:none;position:fixed;inset:0;z-index:1000;
  background:rgba(0,0,0,.7);align-items:center;justify-content:center;padding:20px;}
.nb-modal-bg.open{display:flex;}
.nb-modal{background:var(--nb-modal);border:1px solid rgba(27,107,90,.35);
  border-radius:var(--nb-r-lg);width:100%;max-width:370px;padding:28px 24px;position:relative;}
.nb-modal h2{font-size:19px;font-weight:700;margin-bottom:4px;color:var(--nb-text);
  font-weight:700;letter-spacing:-.02em;}
.nb-modal p{font-size:13px;color:var(--nb-t4);margin-bottom:18px;}
.nb-modal label{display:block;font-size:11px;color:var(--nb-t5);
  letter-spacing:.05em;text-transform:uppercase;font-weight:600;margin-bottom:5px;}
.nb-modal input{width:100%;background:var(--nb-surface-2);
  border:1px solid var(--nb-hair);border-radius:var(--nb-r-md);
  padding:11px 12px;color:var(--nb-text);font-size:15px;font-family:inherit;
  outline:none;margin-bottom:11px;min-height:44px;appearance:none;}
.nb-modal input:focus{border-color:var(--nb-teal2);}
.nb-modal-btns{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px;}
.nb-modal-btn{padding:11px;border-radius:var(--nb-r-md);font-size:14px;font-weight:600;
  cursor:pointer;font-family:inherit;border:none;min-height:44px;}
.nb-modal-btn-primary{background:var(--nb-teal);color:var(--nb-text);}
.nb-modal-btn-primary:hover{background:var(--nb-teal2);}
.nb-modal-btn-ghost{background:transparent;color:var(--nb-text);
  border:1px solid var(--nb-hair)!important;}
.nb-modal-btn-ghost:hover{background:var(--nb-surface);}
.nb-modal-btn:disabled{opacity:.4;cursor:default;}
.nb-modal-msg{font-size:13px;padding:9px 11px;border-radius:var(--nb-r-sm);margin-top:9px;display:none;}
.nb-modal-err{background:rgba(192,57,43,.12);border:1px solid rgba(192,57,43,.3);color:rgba(255,160,140,.93);}
.nb-modal-ok{background:rgba(27,107,90,.15);border:1px solid rgba(42,138,116,.3);color:var(--nb-accent);}
/* An action offered inside a message. A button because it does something,
   styled as a link because it sits mid-sentence. Inherits the message colour
   so it reads as part of the sentence in both the error and the ok box. */
.nb-linkbtn{background:none;border:0;padding:0;font:inherit;color:inherit;
  text-decoration:underline;cursor:pointer;}
.nb-linkbtn:hover{opacity:.8;}
.nb-linkbtn:focus-visible{outline:2px solid var(--nb-accent);outline-offset:2px;border-radius:3px;}
.nb-modal-close{position:absolute;top:12px;right:14px;background:none;border:none;
  color:var(--nb-t5);font-size:18px;cursor:pointer;line-height:1;padding:4px;}
.nb-modal-close:hover{color:var(--nb-text);}
.nb-modal-foot{text-align:center;margin-top:13px;font-size:13px;color:var(--nb-t4);}
.nb-link-btn{background:none;border:none;color:var(--nb-accent);font-size:13px;cursor:pointer;
  font-family:inherit;padding:0;text-decoration:none;}
.nb-link-btn:hover{text-decoration:underline;}
/* signup role chips */
/* ── Social sign-in buttons ──────────────────────────────────────────────
   Restrained on purpose. Three saturated brand blocks would out-shout the
   email form and the rest of the modal; these carry the recognisable mark on
   the workspace's own surface treatment, so the provider is identifiable
   without the modal turning into a logo wall. Full width and 44px min-height
   so they stay comfortable targets on a phone. */
.nb-soc{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:44px;
  margin-bottom:8px;padding:11px 14px;border-radius:var(--nb-r-md);cursor:pointer;font-family:inherit;
  font-size:14px;font-weight:600;color:var(--nb-text);background:var(--nb-surface);
  border:1px solid var(--nb-hair);transition:background .15s,border-color .15s;}
.nb-soc:hover{background:var(--nb-surface-2);border-color:var(--nb-hair);}
.nb-soc:focus-visible{outline:2px solid var(--nb-accent);outline-offset:2px;}
.nb-soc:disabled{opacity:.55;cursor:default;}
.nb-soc-i{display:inline-flex;align-items:center;justify-content:center;width:18px;flex:0 0 18px;}
/* Apple's mark is monochrome and sits directly on the dark surface. */
.nb-soc-apple .nb-soc-i{color:#fff;}
/* Google requires its four-colour mark on a light chip, so it gets one. */
.nb-soc-google .nb-soc-i{background:#fff;border-radius:3px;width:20px;height:20px;flex:0 0 20px;}
.nb-or{display:flex;align-items:center;gap:12px;margin:14px 0 12px;
  color:var(--nb-t4);font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;}
.nb-or::before,.nb-or::after{content:'';flex:1;height:1px;background:var(--nb-hair);}
@media(max-width:430px){
  .nb-soc{font-size:13.5px;padding:11px 12px;gap:9px;}
}
/* ── Role-aware workspace switcher (staff only) ─────────────────────────────
   One home for workspace destinations, so no destination is listed twice.
   Doctor : Dashboard | Live Tools
   Admin  : Admin Center | Doctor Workspace | Live Tools                      */
.nb-ws{display:none;align-items:center;gap:3px;flex-shrink:0;margin-left:6px;
  padding:3px;border:1px solid rgba(27,107,90,.3);border-radius:var(--nb-r-md);background:var(--nb-surface);}
.nb-ws.on{display:flex;}
.nb-ws-seg{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;text-decoration:none;
  color:var(--nb-t3);font-size:13px;font-weight:500;padding:6px 12px;border-radius:var(--nb-r-sm);
  border:1px solid transparent;transition:color var(--nb-dur),background var(--nb-dur),border-color var(--nb-dur);}
.nb-ws-seg:hover{color:var(--nb-text);background:var(--nb-surface-2);}
.nb-ws-seg:focus-visible{outline:2px solid var(--nb-accent);outline-offset:2px;}
.nb-ws-seg .nb-ws-ico{font-size:13px;line-height:1;opacity:.9;}
/* Active workspace — restrained, no glow competition with Live Tools. */
.nb-ws-seg.on{color:var(--nb-text);background:rgba(27,107,90,.26);border-color:var(--nb-edge-2);
  box-shadow:inset 0 0 0 1px rgba(126,207,192,.12);}

/* Live Tools — the one elevated entry. Teal only; red and amber stay reserved
   for real risk states elsewhere in the product. */
.nb-ws-seg.live{color:var(--nb-accent-2);border-color:rgba(42,138,116,.45);
  background:linear-gradient(180deg,rgba(27,107,90,.20),rgba(27,107,90,.08));
  box-shadow:0 0 0 1px rgba(42,138,116,.18), 0 2px 10px -4px rgba(42,138,116,.55);
  background-image:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='58' height='18' viewBox='0 0 58 18'%3E%3Cpolyline points='0,9 11,9 15,3.5 19,14.5 23,9 33,9 37,6 41,12 45,9 58,9' fill='none' stroke='%237ECFC0' stroke-width='1.1' stroke-linejoin='round' stroke-linecap='round' opacity='.5'/%3E%3C/svg%3E"),
    linear-gradient(180deg,rgba(27,107,90,.20),rgba(27,107,90,.08));
  background-repeat:no-repeat,no-repeat;
  background-position:right 8px center,0 0;
  background-size:auto 14px,auto;
  padding-right:56px;}
.nb-ws-seg.live:hover{color:var(--nb-accent-3);border-color:rgba(42,138,116,.7);
  box-shadow:0 0 0 1px rgba(42,138,116,.3), 0 3px 14px -4px rgba(42,138,116,.8);}
.nb-ws-seg.live.on{color:var(--nb-text);border-color:rgba(126,207,192,.6);
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
  border:1px solid rgba(27,107,90,.3);border-radius:var(--nb-r-md);background:var(--nb-surface);
  color:var(--nb-t2);text-decoration:none;font-size:14px;}
.nb-mob-ws a.on{color:var(--nb-text);background:rgba(27,107,90,.26);border-color:var(--nb-edge-2);}
.nb-mob-ws a.live{color:var(--nb-accent-2);border-color:rgba(42,138,116,.45);
  background:linear-gradient(180deg,rgba(27,107,90,.20),rgba(27,107,90,.08));
  box-shadow:0 0 0 1px rgba(42,138,116,.16), 0 2px 10px -4px rgba(42,138,116,.5);}
.nb-mob-ws a.live.on{color:var(--nb-text);border-color:rgba(126,207,192,.55);}

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
.nb-foot{background:var(--nb-foot);border-top:1px solid var(--nb-hair);
  font-family:inherit;color:var(--nb-t3);margin-top:44px;}
.nb-foot-in{max-width:1160px;margin:0 auto;padding:30px 24px 24px;}
.nb-foot-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:22px 20px;}
.nb-foot-h{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--nb-t4);margin-bottom:11px;}
.nb-foot-col a{display:block;font-size:13px;color:var(--nb-t2);text-decoration:none;padding:4px 0;line-height:1.4;}
.nb-foot-col a:hover{color:var(--nb-accent);}
.nb-foot-bot{display:flex;align-items:center;justify-content:space-between;gap:10px 16px;flex-wrap:wrap;
  margin-top:22px;padding-top:16px;border-top:1px solid var(--nb-hair);}
.nb-foot-brand{font-size:15px;font-weight:700;color:var(--nb-text);letter-spacing:-.01em;}
.nb-foot-brand span{color:var(--nb-teal2);}
.nb-foot-copy{font-size:12px;color:var(--nb-t4);}
@media(max-width:720px){ .nb-foot-cols{grid-template-columns:repeat(2,1fr);} }
@media(max-width:420px){ .nb-foot-cols{grid-template-columns:1fr;} }
/* ══════════════════════════════════════════════════════════════════════════
   MOBILE APPLICATION SHELL — the bottom tab bar
   --------------------------------------------------------------------------
   Everything here is inert above the phone breakpoint. The bar is display:none
   until a media query turns it on, and the class that reserves room for it at
   the foot of the page is applied by the same query, so desktop and iPad keep
   the approved header and workspace switcher untouched.

   THE BREAKPOINT is 740px — the same one that already hides .nb-nav-links and
   .nb-ws. One breakpoint, so the header and the shell can never disagree about
   which layout the page is in. iPad portrait is 768/834 and therefore keeps
   the inline switcher, which at that width has larger targets than a five-up
   bar and is the better touch surface.
   ══════════════════════════════════════════════════════════════════════════ */
.nb-tabbar{display:none;}
.nb-ic{width:22px;height:22px;display:block;}

@media(max-width:740px){
  /* An authenticated phone has the bar, so the hamburger is no longer the only
     way in — More is a tab. Guests keep it, because they have no bar. */
  html.nb-has-tabs .nb-burger{display:none;}

  .nb-tabbar.on{
    display:grid; grid-auto-flow:column; grid-auto-columns:1fr;
    /* One height, used by the bar, by the page's bottom padding and by the
       sheet that stops above it, so the three can never disagree. */
    --nb-tab-h:57px;
    position:fixed; left:0; right:0; bottom:0; z-index:880;
    background:var(--nb-bg); border-top:1px solid var(--nb-edge);
    -webkit-backdrop-filter:blur(14px); backdrop-filter:blur(14px);
    /* The home indicator on a notched iPhone, and Safari's own bottom chrome,
       both live inside this inset. Padding rather than margin, so the bar's
       background still reaches the physical bottom of the screen instead of
       leaving a strip of page showing under it. */
    padding-bottom:env(safe-area-inset-bottom);
    font-family:inherit;
  }
  .nb-tab{
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    gap:3px; min-height:56px; padding:7px 2px 8px; box-sizing:border-box;
    background:none; border:0; cursor:pointer; font-family:inherit;
    text-decoration:none; color:var(--nb-t3); font-size:10.5px; font-weight:600;
    letter-spacing:.01em; -webkit-tap-highlight-color:transparent;
    transition:color var(--nb-dur);
  }
  .nb-tab-lb{line-height:1;white-space:nowrap;}
  .nb-tab-ic{display:flex;align-items:center;justify-content:center;height:22px;}
  .nb-tab:active{color:var(--nb-text);}
  .nb-tab.on{color:var(--nb-accent);}
  /* The active mark is a short rule at the top edge of the tab, in line with
     the bar's own border — the same device the desktop rail uses down its
     left edge. It is drawn, not animated: a persistent bar that moves every
     time you navigate is noise. */
  .nb-tab.on::before{
    content:''; position:absolute; top:0; width:26px; height:2px;
    border-radius:0 0 2px 2px; background:var(--nb-accent);
  }
  .nb-tab{position:relative;}
  .nb-tab:focus-visible{outline:2px solid var(--nb-accent);outline-offset:-3px;}

  /* Live Tools is the signature instrument, so it reads as one: the icon sits
     in a teal-tinted well rather than on the bar. No floating button, no glow,
     no pulse — the tint and the monitor mark are enough, and a flashing
     control in a theatre is a status claim this is not entitled to make. */
  .nb-tab.sig .nb-tab-ic{
    width:40px; border-radius:var(--nb-r-md);
    background:linear-gradient(180deg,rgba(47,168,140,.22),rgba(47,168,140,.10));
    border:1px solid rgba(47,168,140,.42);
    color:var(--nb-accent);
  }
  .nb-tab.sig.on .nb-tab-ic{
    background:linear-gradient(180deg,rgba(47,168,140,.38),rgba(47,168,140,.18));
    border-color:rgba(126,207,192,.7);
  }

  /* Room at the foot of every page for the bar, so it never covers the last
     row of a table, the last field of a form, or a save button. */
  html.nb-has-tabs body{
    padding-bottom:calc(57px + env(safe-area-inset-bottom)) !important;
  }
  /* iOS pins a fixed element above the keyboard, which would put the bar on
     top of the field being typed into. See nbBindKeyboardDodge. */
  html.nb-typing .nb-tabbar.on{display:none;}
  html.nb-typing body{padding-bottom:0 !important;}

  /* The drawer becomes a bottom sheet, because it is now opened from the
     bottom of the screen. Same element, same focus trap, same backdrop — only
     where it comes from changes. It stops above the bar so both stay usable. */
  html.nb-has-tabs .nb-mob{
    top:auto; bottom:calc(57px + env(safe-area-inset-bottom));
    border-radius:16px 16px 0 0;
    box-shadow:0 -18px 40px -18px rgba(0,0,0,.75);
    max-height:calc(100vh - 57px - 90px);
    padding:14px 0 18px;
  }
  html.nb-has-tabs .nb-mob-bg{top:0;}
  /* On a phone the bar owns primary navigation and this group owns the rest,
     so the legacy link lists would be a second copy of both. Guests keep them:
     renderShell leaves nb-has-tabs off, and these rules never apply. */
  html.nb-has-tabs #nb-mob-navgrp,
  html.nb-has-tabs #nb-mob-wsgrp{display:none !important;}
  /* The More list owns these two now, and it draws them with an icon and the
     duplicate filter applied. Left visible, Account printed Profile & settings
     a second time three rows below the first. */
  html.nb-has-tabs #nb-mob-settings,
  html.nb-has-tabs #nb-mob-workspace{display:none !important;}
  html:not(.nb-has-tabs) .nb-more-grp{display:none;}

  .nb-more-list{display:flex;flex-direction:column;padding:0 8px;}
  .nb-more-item{
    display:flex; align-items:center; gap:13px;
    min-height:48px; padding:0 14px; border-radius:var(--nb-r-md);
    color:var(--nb-t2); text-decoration:none; font-size:15px;
    -webkit-tap-highlight-color:transparent;
  }
  .nb-more-item .nb-more-ic{display:flex;color:var(--nb-t4);flex:0 0 auto;}
  .nb-more-item:active{background:var(--nb-surface-2);}
  .nb-more-item.on{color:var(--nb-text);background:var(--nb-surface);}
  .nb-more-item.on .nb-more-ic{color:var(--nb-accent);}
}
@supports(height:100dvh){
  @media(max-width:740px){
    html.nb-has-tabs .nb-mob{max-height:calc(100dvh - 57px - 90px);}
  }
}
/* Landscape phone: the bar would eat a third of the height, and the header
   already carries the account. Stand it down and give the drawer back. */
@media(max-width:900px) and (max-height:460px){
  .nb-tabbar.on{display:none;}
  html.nb-has-tabs body{padding-bottom:0 !important;}
  html.nb-has-tabs .nb-burger{display:block;}
  html.nb-has-tabs .nb-mob{top:56px;bottom:auto;border-radius:0 0 16px 16px;}
  html.nb-has-tabs #nb-mob-navgrp{display:block !important;}
}
@media(prefers-reduced-motion:reduce){
  .nb-tab{transition:none;}
}

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

/* ── Social sign-in providers ──────────────────────────────────────────────
   ENABLED is the whole switch. Apple's mark and label stay defined below,
   deliberately: the generic OAuth path in auth.js still accepts 'apple', and
   Apple is expected back once its Developer Program membership and the
   six-monthly client-secret rotation are in place. Deleting the definition
   would mean rebuilding it — and re-deriving the SVG — for no benefit.

   Rendering from a list rather than hand-written markup also means the button
   order, the count, and what the tests see all come from one place. */
var NB_PROVIDER_MARKS = {
  apple:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">' +
    '<path d="M11.18 8.5c.02-1.6 1.31-2.37 1.37-2.41-.75-1.09-1.91-1.24-2.32-1.26-.99-.1-1.93.58-2.43.58-.5 0-1.27-.57-2.09-.55-1.07.02-2.06.62-2.61 1.58-1.11 1.93-.28 4.79.8 6.35.53.77 1.16 1.63 1.98 1.6.79-.03 1.09-.51 2.05-.51.95 0 1.23.51 2.07.5.86-.02 1.4-.78 1.92-1.55.61-.89.86-1.75.87-1.79-.02-.01-1.67-.64-1.69-2.54zM9.63 3.8c.44-.53.73-1.27.65-2.01-.63.03-1.39.42-1.84.95-.4.47-.75 1.22-.66 1.94.7.05 1.42-.36 1.85-.88z"/>' +
    '</svg>',
  google:
    '<svg viewBox="0 0 18 18" width="16" height="16">' +
    '<path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>' +
    '<path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>' +
    '<path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/>' +
    '<path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>' +
    '</svg>',
  facebook:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="#1877F2">' +
    '<path d="M16 8.05C16 3.6 12.42 0 8 0S0 3.6 0 8.05C0 12.07 2.93 15.4 6.75 16v-5.62H4.72V8.05h2.03V6.28c0-2.02 1.2-3.13 3.02-3.13.87 0 1.79.16 1.79.16v1.97h-1.01c-.99 0-1.3.62-1.3 1.26v1.51h2.22l-.36 2.33H9.25V16C13.07 15.4 16 12.07 16 8.05z"/>' +
    '</svg>'
};
var NB_PROVIDER_LABEL = { apple:'Apple', google:'Google', facebook:'Facebook' };
var NB_PROVIDER_CLASS = { apple:'nb-soc-apple', google:'nb-soc-google', facebook:'nb-soc-fb' };

// Apple is OFF. Add 'apple' back to this array to restore the button — no other
// change is required anywhere.
var NB_PROVIDERS_ENABLED = ['google', 'facebook'];

function nbSocialButtons(){
  return NB_PROVIDERS_ENABLED.map(function(id){
    return '<button type="button" class="nb-soc ' + NB_PROVIDER_CLASS[id] + '" ' +
             'onclick="window.nbSocial(\'' + id + '\')">' +
             '<span class="nb-soc-i" aria-hidden="true">' + NB_PROVIDER_MARKS[id] + '</span>' +
             'Continue with ' + NB_PROVIDER_LABEL[id] +
           '</button>';
  }).join('');
}

function buildHTML(page){
  var p = page || '';
  return (
    '<nav class="nb" id="nb-nav">' +
      '<div class="nb-inner">' +
        '<a href="/index.html" class="nb-logo">Anest<span>heo</span></a>' +
        /* The visitor bar. Five items, and the first thing a patient sees, so
           it names the two audiences and nothing else. Ask Anesthesiologist
           and Live Tools are not gone: Ask belongs inside the patient
           experience and Live Tools inside the clinician workspace, and both
           are reached from there. A first-time visitor should not have to work
           out which of five destinations is meant for them. */
        '<div class="nb-nav-links" id="nb-nav-links">' +
          '<a href="/index.html"' + activeCls('/index.html', p) + '>Home</a>' +
          '<a href="/patients.html"' + activeCls('/patients.html', p) + '>For Patients</a>' +
          '<a href="/videos.html"' + activeCls('/videos.html', p) + '>Videos</a>' +
          '<a href="/index.html#clinicians">For Clinicians</a>' +
        '</div>' +
        // Role-aware patient navigation (shown only to logged-in patients).
        '<div class="nb-nav-links" id="nb-nav-patient" style="display:none">' +
          '<a href="/index.html"' + activeCls('/index.html', p) + '>Home</a>' +
          '<a href="/patient-dashboard.html"' + activeCls('/patient-dashboard.html', p) + '>My Space</a>' +
          '<a href="/ask.html"' + activeCls('/ask.html', p) + '>Ask Anesthesiologist</a>' +
          '<a href="/videos.html"' + activeCls('/videos.html', p) + '>Videos</a>' +
          '<a href="/settings.html"' + activeCls('/settings.html', p) + '>Profile</a>' +
        '</div>' +
        // Doctor navigation (shown only to logged-in doctors). Doctors are
        // anesthesiologists, so "Ask Anesthesiologist" is omitted; "For Patients"
        // stays so they can preview the patient-facing site.
        '<div class="nb-nav-links" id="nb-nav-doctor" style="display:none">' +
          '<a href="/index.html"' + activeCls('/index.html', p) + '>Home</a>' +
          '<a href="/patients.html"' + activeCls('/patients.html', p) + '>For Patients</a>' +
          '<a href="/videos.html"' + activeCls('/videos.html', p) + '>Videos</a>' +
        '</div>' +
        // Admin content navigation. Workspaces live in the switcher below, so
        // Admin Center / Doctor Workspace / Live Tools appear exactly once.
        '<div class="nb-nav-links" id="nb-nav-admin" style="display:none">' +
          '<a href="/index.html"' + activeCls('/index.html', p) + '>Home</a>' +
          '<a href="/videos.html"' + activeCls('/videos.html', p) + '>Videos</a>' +
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
                '<a href="/dashboard.html" class="nb-menu-item" id="nb-menu-workspace">&#129658; Doctor Workspace</a>' +
                '<button class="nb-menu-item" id="nb-menu-myjourney" style="display:none;background:none;border:none;width:100%;text-align:left;font-family:inherit;cursor:pointer;" onclick="window.nbStartPatientJourney()">&#129489; My Patient Journey</button>' +
                '<a href="/patient-dashboard.html" class="nb-menu-item" id="nb-menu-patient" style="display:none">&#10024; My Space</a>' +
                /* The passport is the patient's own record of what would matter
                   in an emergency, so it belongs beside their space, not buried
                   in a marketing page. Staff see it too — they may have one. */
                '<a href="/health-passport.html" class="nb-menu-item" id="nb-menu-passport">&#127973; Health Passport</a>' +
                '<a href="/settings.html" class="nb-menu-item">&#9881; Settings</a>' +
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
        '<a href="/index.html" class="nb-mob-link">Home</a>' +
        '<a href="/patients.html" class="nb-mob-link">For Patients</a>' +
        '<a href="/videos.html" class="nb-mob-link">Videos</a>' +
        '<a href="/index.html#clinicians" class="nb-mob-link">For Clinicians</a>' +
      '</div>' +
      // Patient mobile nav — logged-in patients only.
      '<div id="nb-mob-patient-nav" style="display:none">' +
        '<a href="/index.html" class="nb-mob-link">Home</a>' +
        '<a href="/patient-dashboard.html" class="nb-mob-link">&#10024; My Space</a>' +
        '<a href="/ask.html" class="nb-mob-link">Ask Anesthesiologist</a>' +
        '<a href="/videos.html" class="nb-mob-link">Videos</a>' +
        '<a href="/settings.html" class="nb-mob-link">Profile</a>' +
      '</div>' +
      // Doctor mobile nav — logged-in doctors only (no Ask Anesthesiologist;
      // Dashboard comes from the auth section below).
      '<div id="nb-mob-doctor-nav" style="display:none">' +
        '<a href="/index.html" class="nb-mob-link">Home</a>' +
        '<a href="/patients.html" class="nb-mob-link">For Patients</a>' +
        '<a href="/videos.html" class="nb-mob-link">Videos</a>' +
      '</div>' +
      // Admin mobile content nav.
      '<div id="nb-mob-admin-nav" style="display:none">' +
        '<a href="/index.html" class="nb-mob-link">Home</a>' +
        '<a href="/videos.html" class="nb-mob-link">Videos</a>' +
      '</div>' +
      '</div>' +                                   // end NAVIGATION group
      // 2b. MORE — the phone shell's secondary navigation. Built from NB_MORE
      //     minus whatever the tab bar is already showing, so nothing is
      //     listed twice. Replaces the groups above on a phone; they stay for
      //     guests, who have no tab bar.
      '<div class="nb-mob-grp nb-more-grp" id="nb-more-grp">' +
        '<div class="nb-mob-h">More</div>' +
        '<div class="nb-more-list" id="nb-more-list" role="navigation" aria-label="More"></div>' +
      '</div>' +
      // 3. ACCOUNT — always last, always separated from content links.
      '<div class="nb-mob-grp nb-mob-acct" id="nb-mob-acctgrp">' +
        '<div class="nb-mob-h">Account</div>' +
        '<div id="nb-mob-guest"><div style="padding:0 16px;"><button class="nb-btn" style="width:100%;min-height:48px" onclick="window.nbOpenModal();window.nbCloseMob()">Login</button></div></div>' +
        '<div id="nb-mob-auth" style="display:none">' +
          '<a href="/dashboard.html" class="nb-mob-link" id="nb-mob-workspace">Dashboard</a>' +
          '<a href="/settings.html" class="nb-mob-link" id="nb-mob-settings">Profile &amp; settings</a>' +
          '<button class="nb-mob-link nb-mob-signout" onclick="window.nbSignOut()">Sign out</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    /* The application shell. Rendered empty and filled by renderShell once the
       role is known, so a visitor never sees it flash. It is the last element
       in the chrome so its stacking is predictable without a z-index war. */
    '<nav class="nb-tabbar" id="nb-tabbar" role="navigation" aria-label="Primary"></nav>' +
    '<div class="nb-modal-bg" id="nb-modal" onclick="if(event.target===this)window.nbCloseModal()">' +
      '<div class="nb-modal">' +
        '<button class="nb-modal-close" onclick="window.nbCloseModal()">&#10005;</button>' +
        '<h2 id="nb-modal-title">Sign in</h2>' +
        '<p id="nb-modal-sub">Access Anestheo</p>' +
        /* There is no role step here any more. Registration used to ask for a
           role and carry it in user_metadata, which meant the answer arrived
           from the browser and had to be distrusted on the way back in. Now
           EVERY new account — email, Google, Facebook alike — reaches
           role-select.html after it is authenticated, and the role is written
           by set_own_role() against a real session. One path, one place. */
        // ── Social sign-in ───────────────────────────────────────────
        // Above the credentials because it is the faster path for most
        // people. Brand marks are inline SVG/text: no external request, so
        // they render before any network round-trip and cannot be blocked.
        '<div id="nb-social">' + nbSocialButtons() + '</div>' +
        '<div class="nb-or"><span>or</span></div>' +
        // ── Credentials step ──
        '<div id="nb-cred-step">' +
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

/* showMsg writes HTML, so anything interpolated into it must be escaped first.
   The email address is user input: the format check allows '<' and '>' — it
   only forbids spaces — so "a<img src=x onerror=…>@b.c" passes it. */
function escHtml(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

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

/* The address the last signup attempt concerned, so "send it again" needs no
   argument in an onclick attribute and the value is never re-parsed out of
   markup. */
var _pendingConfirmEmail = null;

/* The one way to get a confirmation link for an account that already exists.
   Signing up a second time cannot do it — GoTrue answers that with a
   sanitized user and sends nothing — so without this a person who lost the
   first email has no route back in at all.

   auth.resend() is rate-limited server-side and says so plainly when it
   refuses; that refusal is shown rather than swallowed, because "nothing
   happened" is what sent us looking at SMTP in the first place. */
window.nbResendConfirm = async function(){
  var email = _pendingConfirmEmail;
  if(!email){ showMsg('err', 'Enter your email address and try again.'); return; }
  showMsg('ok', 'Sending&hellip;');
  try {
    var r = await window.sb.auth.resend({
      type: 'signup',
      email: email,
      options: { emailRedirectTo: window.authRedirectTo('auth-callback.html') }
    });
    if(r && r.error){ showMsg('err', r.error.message); return; }
    showMsg('ok', '&#10003; Sent again to <strong>' + escHtml(email) +
      '</strong>. Check your spam folder too.');
  } catch(e){
    showMsg('err', 'Could not reach the server. Check your connection and try again.');
  }
};
// Current auth state (UI only) so the login modal is never shown to an
// already-authenticated user. Set by setAuth/populateMenu, cleared by setGuest.
var _nbAuthed = false;
/* THE CLINICAL ROLE, VERBATIM. Never overwritten by platform privilege — see
   populateMenu(). _nbIsAdmin carries that second, independent fact. */
var _nbRole = null;
var _nbIsAdmin = false;

function setBtns(disabled){
  var b = ge('nb-submit-btn');
  if(b){
    b.disabled = disabled;
    if(!disabled) b.textContent = (_authMode === 'register') ? 'Create account' : 'Sign in';
  }
}

function setGuest(){
  _nbAuthed = false; _nbRole = null; _nbIsAdmin = false;
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
  renderShell(null);                      // ...and no application shell
}

/* ── Icons ─────────────────────────────────────────────────────────────────
   Lucide, inline, stroke-based — the same system and the same 24×24 grid the
   doctor workspace already draws its rail with. Emoji were fine for a drawer
   row read once; they are wrong for a primary navigation that is on screen
   the whole time, because they carry a different colour, weight and vertical
   centre on every platform and cannot take the active state's tint.

   Paths only. The wrapper below supplies the shared stroke attributes, so a
   new icon is one line and cannot disagree with the others.               */
var NB_ICONS = {
  home:     '<path d="M3 9.5 12 3l9 6.5"/><path d="M5 10v10h14V10"/><path d="M9.5 20v-6h5v6"/>',
  users:    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>' +
            '<path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  pulse:    '<path d="M3 12h4l2.5-7 5 14L17.5 12H21"/>',
  chart:    '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 15l3.5-4 3 2.5L20 7"/>',
  compass:  '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  shield:   '<path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.3-7-9.5V6z"/><path d="m9.5 12 1.8 1.8 3.4-3.6"/>',
  message:  '<path d="M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z"/>',
  admin:    '<path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.3-7-9.5V6z"/><circle cx="12" cy="11" r="2"/>' +
            '<path d="M12 13v3"/>',
  more:     '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  book:     '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  folder:   '<path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4.5l2 3H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z"/>',
  play:     '<circle cx="12" cy="12" r="9"/><path d="m10 8.5 6 3.5-6 3.5z"/>',
  cog:      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  info:     '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  badge:    '<path d="M12 2 9.5 5H6v3.5L3 12l3 3.5V19h3.5L12 22l2.5-3H18v-3.5L21 12l-3-3.5V5h-3.5z"/>' +
            '<path d="m9.5 12 1.8 1.8 3.4-3.6"/>',
  logout:   '<path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  search:   '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'
};
function nbIcon(name){
  var d = NB_ICONS[name];
  if(!d) return '';
  return '<svg class="nb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
         'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ' +
         'aria-hidden="true" focusable="false">' + d + '</svg>';
}

/* ── Mobile application shell: the bottom tab bar ──────────────────────────
   WHAT THIS IS

   On a phone the application used to have exactly one way in: a hamburger.
   Every destination — the workspace, Live Tools, Live Chart, a patient's own
   journey — sat behind a tap on a menu, which is a website's navigation, not
   an application's. This is the persistent bar that replaces it.

   WHERE THE ROLES COME FROM

   Nowhere new. populateMenu() already resolves the three facts this product
   separates — what someone is clinically (profiles.role), what they may
   administer (is_platform_admin()), and what they have been verified for —
   and it hands the answer here. This file adds no check of its own, reads no
   table, and grants nothing: it decides which five LABELS to draw, and every
   destination it can draw is one the account could already reach from the
   drawer. The server and RLS remain the only authority on what opens.

   WHY THESE FIVE

   A doctor's day is patients and the two clinical instruments. A patient's is
   their own journey. They are not the same product and must not get the same
   bar, so there are two sets, keyed on the same role facts the rest of the
   navigation already uses. Every href below is an existing route, taken from
   the workspace switcher and the drawer rather than invented.             */
var NB_TABS = {
  /* A doctor who also administers keeps the DOCTOR bar. Administration is a
     privilege on top of a clinician, not a replacement for one — the same
     rule populateMenu applies to the role label and the workspace switcher.
     Admin Center is in More. */
  doctor: [
    { href:'/index.html',            label:'Home',       ico:'home'  },
    { href:'/dashboard.html',        label:'Patients',   ico:'users' },
    { href:'/engine.html',           label:'Live Tools', ico:'pulse', signature:true },
    { href:'/anesthesia-cases.html', label:'Live Chart', ico:'chart' },
    { more:true,                     label:'More',       ico:'more'  }
  ],
  /* An administrator who is not a clinician. They keep both instruments —
     NB_WORKSPACES.admin already gives them Live Tools — and get the Admin
     Center in place of the patient list. Doctor Workspace is in More. */
  admin: [
    { href:'/index.html',            label:'Home',       ico:'home'  },
    { href:'/admin.html',            label:'Admin',      ico:'admin' },
    { href:'/engine.html',           label:'Live Tools', ico:'pulse', signature:true },
    { href:'/anesthesia-cases.html', label:'Live Chart', ico:'chart' },
    { more:true,                     label:'More',       ico:'more'  }
  ],
  /* Journey is /patient-dashboard.html — the existing patient workspace, the
     same destination the app Home's "Continue your surgery journey" button
     has always pointed at. No second journey system. */
  patient: [
    { href:'/index.html',            label:'Home',     ico:'home'    },
    { href:'/patient-dashboard.html',label:'Journey',  ico:'compass' },
    { href:'/health-passport.html',  label:'Passport', ico:'shield'  },
    { href:'/ask.html',              label:'Ask',      ico:'message' },
    { more:true,                     label:'More',     ico:'more'    }
  ]
};

/* The More sheet. Secondary destinations only — anything already in the bar
   above is filtered out by href before this renders, so a destination can
   never appear in both. `when` is read from the flags populateMenu computed;
   it is a display rule, never an access rule. */
var NB_MORE = [
  { href:'/dashboard.html',       label:'Doctor Workspace', ico:'users',  when:'staff'   },
  { href:'/admin.html',           label:'Admin Center',     ico:'admin',  when:'admin'   },
  { href:'/anesthesia-cases.html',label:'Live Chart',       ico:'chart',  when:'staff'   },
  { href:'/patient-dashboard.html',label:'My Space',        ico:'compass',when:'patient' },
  { href:'/health-passport.html', label:'Health Passport',  ico:'shield', when:'always'  },
  { href:'/references.html',      label:'References',       ico:'book',   when:'staff'   },
  { href:'/resources.html',       label:'Resources',        ico:'folder', when:'staff'   },
  { href:'/patients.html',        label:'For Patients',     ico:'users',  when:'staff'   },
  { href:'/ask.html',             label:'Ask Anesthesiologist', ico:'message', when:'patientish' },
  { href:'/videos.html',          label:'Videos',           ico:'play',   when:'always'  },
  { href:'/doctor-pending.html',  label:'Verification',     ico:'badge',  when:'unverified' },
  { href:'/settings.html',        label:'Profile & settings', ico:'cog',  when:'always'  },
  { href:'/about.html',           label:'About & help',     ico:'info',   when:'always'  }
];

// ── Workspace switcher ────────────────────────────────────────
// Every destination is an existing route. Nothing here is invented.
//   /admin.html      Admin Center        (admins only)
//   /dashboard.html  Doctor Workspace    (staff)
//   /engine.html     Live Tools          (staff)
var NB_WORKSPACES = {
  doctor: [
    { href:'/dashboard.html', label:'Dashboard',  ico:'🩺',
      desc:'Patients, reviews and clinical work' },
    { href:'/engine.html',    label:'Live Tools', ico:'⚡', live:true,
      desc:'Drugs, calculators and crisis tools' }
  ],
  admin: [
    { href:'/admin.html',     label:'Admin Center',     ico:'🛡',
      desc:'Platform operations and oversight' },
    { href:'/dashboard.html', label:'Doctor Workspace', ico:'🩺',
      desc:'Clinical patient management' },
    { href:'/engine.html',    label:'Live Tools',       ico:'⚡', live:true,
      desc:'Clinical tools and crisis workstation' }
  ]
};
/* ── Live Tools ───────────────────────────────────────────────────────────
   Live Tools is a workspace; the things inside it are tools. Live Chart is the
   first, and this strip is where the next one goes — which is why it is a list
   here rather than two hand-written links on two pages.

   Live Chart is the user-facing name for the anesthesia record. The files stay
   called anesthesia-* because renaming routes would break links people already
   have, and the internal name is accurate. */
var NB_LIVE_TOOLS = [
  { href:'/engine.html',           label:'Live Tools',
    desc:'Drugs, calculators and crisis tools' },
  { href:'/anesthesia-cases.html', label:'Live Chart',
    desc:'Start or continue an anesthesia record' }
];

/* Rendered by the tool pages themselves rather than injected into the navbar:
   it belongs to the workspace, not to the site chrome, and a page that is not
   part of Live Tools should not show it. */
window.nbToolsBar = function(activeHref){
  return '<nav class="nb-tools" aria-label="Live Tools">' +
    NB_LIVE_TOOLS.map(function(t){
      var on = (t.href === activeHref);
      return '<a href="' + t.href + '" class="nb-tool' + (on ? ' on' : '') + '"' +
             (on ? ' aria-current="page"' : '') + '>' + t.label + '</a>';
    }).join('') + '</nav>';
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

/* ── The mobile shell ──────────────────────────────────────────────────────
   renderShell is called once, from populateMenu, with the role facts that
   function has already resolved. It never computes them itself.

   `flags` is exactly what populateMenu knows:
     kind        'doctor' | 'admin' | 'patient' | null   which bar, if any
     isStaff     clinician or administrator
     isAdmin     is_platform_admin()
     isPatient   a patient account
     unverified  a doctor the platform has not yet checked                 */
function renderShell(flags){
  var bar   = ge('nb-tabbar');
  var sheet = ge('nb-more-list');
  var root  = document.documentElement;
  if(!bar) return;

  var tabs = flags && flags.kind ? NB_TABS[flags.kind] : null;

  /* No bar for a visitor, and none for an account that has not chosen a role
     yet: there is nothing to be persistently navigating. They keep the public
     header and the drawer, unchanged. */
  if(!tabs){
    bar.innerHTML = '';
    bar.classList.remove('on');
    root.classList.remove('nb-has-tabs');
    if(sheet) sheet.innerHTML = '';
    return;
  }

  var page = nbCurrentPage();
  bar.innerHTML = tabs.map(function(t){
    var on = !t.more && t.href.split('/').pop() === page;
    var cls = 'nb-tab' + (t.signature ? ' sig' : '') + (on ? ' on' : '');
    var inner = '<span class="nb-tab-ic">' + nbIcon(t.ico) + '</span>' +
                '<span class="nb-tab-lb">' + t.label + '</span>';
    if(t.more){
      return '<button type="button" class="' + cls + '" id="nb-tab-more" ' +
             'aria-haspopup="dialog" aria-controls="nb-mob" aria-expanded="false" ' +
             'onclick="window.nbToggleMob()">' + inner + '</button>';
    }
    return '<a href="' + t.href + '" class="' + cls + '"' +
           (on ? ' aria-current="page"' : '') + '>' + inner + '</a>';
  }).join('');
  bar.classList.add('on');

  /* The class is on <html> rather than <body> so the bottom padding that keeps
     the bar off the last row of a page applies even on the pages that set
     their own body background and overflow. */
  root.classList.add('nb-has-tabs');

  /* The More sheet, minus anything the bar already shows. This is the rule
     that stops a destination appearing twice — it is computed, not curated,
     so adding a tab automatically removes it from More. */
  if(sheet){
    var inBar = {};
    tabs.forEach(function(t){ if(t.href) inBar[t.href] = 1; });
    var show = {
      always:     true,
      staff:      !!flags.isStaff,
      admin:      !!flags.isAdmin,
      patient:    !!flags.isPatient,
      patientish: !flags.isStaff,          // Ask is for people asking, not answering
      unverified: !!flags.unverified
    };
    sheet.innerHTML = NB_MORE.filter(function(m){
      return show[m.when] && !inBar[m.href];
    }).map(function(m){
      var on = m.href.split('/').pop() === page;
      return '<a href="' + m.href + '" class="nb-more-item' + (on ? ' on' : '') + '"' +
             (on ? ' aria-current="page"' : '') + '>' +
             '<span class="nb-more-ic">' + nbIcon(m.ico) + '</span>' + m.label + '</a>';
    }).join('');
  }
}

/* iOS keeps a fixed element pinned above the keyboard, which is right for a
   toolbar and wrong for navigation: the bar would sit on top of the field
   being typed into. Stand it down while a text field has focus, and bring it
   back the moment focus leaves. Nothing is unmounted, so no layout is lost. */
function nbBindKeyboardDodge(){
  var TEXTY = /^(input|textarea|select)$/i;
  function texty(el){
    if(!el || !TEXTY.test(el.tagName)) return false;
    if(el.tagName.toLowerCase() !== 'input') return true;
    return !/^(checkbox|radio|button|submit|range|file|color)$/i.test(el.type || 'text');
  }
  document.addEventListener('focusin',  function(e){
    if(texty(e.target)) document.documentElement.classList.add('nb-typing');
  });
  document.addEventListener('focusout', function(){
    document.documentElement.classList.remove('nb-typing');
  });
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

/* Repaint the navbar avatar. Exported so Settings can call it the moment a
   photo changes — otherwise the picture in the corner disagrees with the one
   the person is looking at until they reload. */
window.nbRefreshAvatar = function(profile, user){
  var el = ge('nb-avatar');
  if(!el || !window.resolveAvatar) return;
  window.resolveAvatar(profile, user).then(function(a){ window.setAvatarEl(el, a); });
};

// Fill avatar + dropdown from profile
async function populateMenu(user, profile){
  /* Clinical role and platform privilege are two different facts about a
     person. Overwriting the first with the second used to erase the doctor in
     an anesthesiologist who also administers the platform: they were labelled
     "Administrator", lost the doctor navigation, and were shown an admin-only
     identity that their own database row contradicted.

     So isAdmin no longer touches role. It adds a privilege on top of whatever
     the person clinically is. */
  var role    = profile ? (profile.role || 'patient') : 'patient';
  /* From is_platform_admin(), not from the profile row — one server-side
     answer, shared with every other page. */
  var isAdmin = await window.isPlatformAdmin();
  /* The role is stored AS IT IS. The previous line was `isAdmin ? 'admin' :
     role`, which is the same collapse the comment above warns against, made
     one variable later: an anesthesiologist who administers the platform was
     remembered as 'admin' and nothing downstream could tell they were a
     doctor. Privilege is now a second field, so both facts survive. */
  _nbAuthed = true; _nbRole = role; _nbIsAdmin = isAdmin;

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

  /* Initials first, so the circle is never empty while the picture resolves,
     then swapped for the image if there is one. window.setAvatarEl is the one
     renderer — see auth.js resolveAvatar for the precedence. */
  var avEl = ge('nb-avatar');
  if(avEl){
    avEl.textContent = initials;
    window.nbRefreshAvatar(profile, user);
  }
  var nmEl = ge('nb-menu-name');  if(nmEl) nmEl.textContent = displayName;
  var emEl = ge('nb-menu-email'); if(emEl) emEl.textContent = user.email;

  // Role line in menu head. Someone who is both is described as both, in that
  // order: what they do clinically, then what they may administer.
  var roleLabels = {doctor:'Anesthesiologist', admin:'Administrator', patient:'Patient', other:'Healthcare Professional'};
  var roleText = roleLabels[role] || '';
  if(isAdmin && role !== 'admin') roleText = roleText ? roleText + ' · Administrator' : 'Administrator';
  var rlEl = ge('nb-menu-role'); if(rlEl) rlEl.textContent = roleText;

  /* 'pending' means NO ROLE HAS BEEN CHOSEN YET, and it used to fall through
     `role !== 'patient'` into isStaff — so a brand-new social sign-in was
     shown the clinical global search and the staff workspace switcher before
     they had told us who they are. Absence of a role is now its own case:
     neither staff nor patient, so the public navigation is what they get. */
  var hasRole   = !!role && role !== 'pending';
  var isStaff   = (hasRole && role !== 'patient') || isAdmin;
  var isPatient = hasRole && role === 'patient' && !isAdmin;
  var isDoctor  = (role === 'doctor');
  // Admin surfaces are keyed on the PRIVILEGE, not on the role column.
  var isAdminRole = !!isAdmin;
  // Which workspace set this account gets. The admin set already contains
  // Doctor Workspace and Live Tools, so a doctor who administers keeps every
  // clinical destination and gains the Admin Center.
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
  // A doctor keeps the doctor content nav; the admin one is for administrators
  // who are not clinicians. Showing both would print Home and Videos twice.
  var navAdmin   = ge('nb-nav-admin');   if(navAdmin)   navAdmin.style.display   = (isAdminRole && !isDoctor) ? '' : 'none';
  var navPatient = ge('nb-nav-patient'); if(navPatient) navPatient.style.display = isPatient ? '' : 'none';
  var mobPublic  = ge('nb-mob-public');      if(mobPublic)  mobPublic.style.display  = isPublicNav ? 'block' : 'none';
  var mobDoctor  = ge('nb-mob-doctor-nav');  if(mobDoctor)  mobDoctor.style.display  = isDoctor ? 'block' : 'none';
  var mobAdmin   = ge('nb-mob-admin-nav');   if(mobAdmin)   mobAdmin.style.display   = (isAdminRole && !isDoctor) ? 'block' : 'none';
  var mobPatient = ge('nb-mob-patient-nav'); if(mobPatient) mobPatient.style.display = isPatient ? 'block' : 'none';
  // Same rule on mobile: the switcher owns Dashboard for doctors and admins.
  var mobWs  = ge('nb-mob-workspace'); if(mobWs)  mobWs.style.display  = (isStaff && !wsRole) ? 'block' : 'none';
  var mobSet = ge('nb-mob-settings');  if(mobSet) mobSet.style.display = isPatient ? 'none' : 'block';
  renderWorkspaceSwitcher(wsRole);
  /* The phone shell, from the facts already resolved above. A doctor who
     administers keeps the doctor bar — same rule as the role label and the
     workspace switcher, one line up. */
  renderShell({
    kind:       isDoctor ? 'doctor' : (isAdminRole ? 'admin' : (isPatient ? 'patient' : null)),
    isStaff:    isStaff,
    isAdmin:    isAdminRole,
    isPatient:  isPatient,
    unverified: isDoctor && !isAdminRole &&
                !!(profile && (profile.verification_status || '') !== 'approved')
  });
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
  {title:'Live Chart', cat:'Tools', ico:'\uD83D\uDCC8', url:'/anesthesia-cases.html',
   desc:'Digital anesthesia record — start or continue a case', staff:true},
  {title:'Anesthesiology Live Tools', cat:'Tools', ico:'\uD83E\uDE7A', url:'/engine.html',
   kw:'anesthesiology live tools engine calculator dosing airway ventilation neuraxial fluids scores tiva tci vasopressor inotrope mabl blood volume drug reference perioperative'},
  {title:'Clinical References', cat:'Library', ico:'\uD83D\uDCD6', url:'/references.html',
   kw:'clinical references library guides knowledge'},
  {title:'Airway', cat:'Reference', ico:'\uD83D\uDCA8', url:'/airway.html',
   kw:'airway ett tube intubation lma mallampati lemon laryngoscopy sizing depth preoxygenation rsi'},
  {title:'Difficult Airway', cat:'Reference', ico:'\uD83D\uDEA8', url:'/difficult-airway.html',
   kw:'difficult airway cico cant intubate oxygenate cricothyroidotomy plan das rescue front of neck'},
  {title:'Anticoagulation', cat:'Reference', ico:'\uD83E\uDE78', url:'/anticoagulation.html',
   kw:'anticoagulation anticoagulant blood thinner heparin lmwh warfarin rivaroxaban apixaban dabigatran clopidogrel aspirin neuraxial timing asra bridging'},
  {title:'Regional Anesthesia', cat:'Reference', ico:'\uD83E\uDDE0', url:'/regional.html',
   kw:'regional anesthesia block nerve interscalene supraclavicular axillary femoral adductor popliteal tap local anesthetic lidocaine bupivacaine ropivacaine maximum dose'},
  {title:'Neuraxial', cat:'Reference', ico:'\uD83E\uDDE0', url:'/regional.html',
   kw:'neuraxial spinal epidural intrathecal labor cesarean caudal'},
  {title:'ICU', cat:'Reference', ico:'\uD83C\uDFE5', url:'/icu.html',
   kw:'icu intensive critical care ards ardsnet ventilation tidal volume sedation rass vasoactive noradrenaline sepsis'},
  {title:'Obstetric', cat:'Reference', ico:'\uD83E\uDD30', url:'/obstetric.html',
   kw:'obstetric obstetrics pregnancy labor cesarean spinal epidural aortocaval phenylephrine hypotension'},
  {title:'Pediatric', cat:'Reference', ico:'\uD83E\uDDD2', url:'/pediatric.html',
   kw:'pediatric paediatric child children neonate infant ett formula weight 421 fluids atropine'},
  {title:'LAST', cat:'Reference', ico:'\u26A0', url:'/last.html',
   kw:'last local anesthetic systemic toxicity lipid emulsion intralipid seizure cardiac arrest'},
  {title:'Anaphylaxis', cat:'Reference', ico:'\uD83D\uDC89', url:'/anaphylaxis.html',
   kw:'anaphylaxis allergic reaction adrenaline epinephrine tryptase bronchospasm hypotension'},
  {title:'Resources', cat:'Library', ico:'\uD83D\uDCDA', url:'/resources.html',
   kw:'resources books pdf checklists icu survival guide patient education downloads brochures material'},
  {title:'Ask Anesthesiologist', cat:'Communication', ico:'\uD83D\uDCAC', url:'/ask.html',
   kw:'ask anesthesiologist question patient communication query'},
  {title:'Settings', cat:'Account', ico:'\u2699', url:'/settings.html',
   kw:'settings account profile password preferences'},
  {title:'Epidural', cat:'Reference', ico:'\uD83E\uDDE0', url:'/regional.html',
   kw:'epidural epi labor infusion topup'},
  {title:'Epinephrine / Adrenaline', cat:'Reference', ico:'\uD83D\uDC89', url:'/anaphylaxis.html',
   kw:'epinephrine adrenaline epi pressor vasopressor anaphylaxis'},
  {title:'Apixaban', cat:'Reference', ico:'\uD83E\uDE78', url:'/anticoagulation.html',
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
/* Where a returning session belongs. Takes both facts, because they are two
   different questions and answering with only one of them is how a doctor-
   administrator lost their clinical home.

   'pending' is not a role, it is the ABSENCE of one — a brand-new social
   sign-in, or an account that never finished onboarding. Sending it to
   /dashboard.html used to bounce off requireRole('staff') and land the person
   back where they started with no explanation. It goes to the chooser. */
function nbGoWorkspace(role, isAdmin){
  if(!role || role === 'pending'){ location.href = '/role-select.html'; return; }
  if(role === 'patient' && !isAdmin){ location.href = '/index.html'; return; }
  location.href = '/dashboard.html';
}
// The sign-in modal must ONLY appear when there is no authenticated session.
// If a valid Supabase session already exists, reuse it and send the user to
// their own workspace instead of ever asking them to sign in again.
window.nbOpenModal = function(){
  if(_nbAuthed){ nbGoWorkspace(_nbRole, _nbIsAdmin); return; }
  // Navbar state not populated yet — double-check the persisted session before
  // ever showing the modal (handles a click during auth initialisation).
  if(typeof window.getSession === 'function'){
    Promise.resolve(window.getSession()).then(function(s){
      if(!s){ nbShowAuthModal(); return; }
      if(_nbRole){ nbGoWorkspace(_nbRole, _nbIsAdmin); return; }
      if(typeof window.getProfile === 'function'){
        Promise.resolve(window.getProfile(s.user.id))
          .then(function(p){ nbGoWorkspace(p && p.role, false); })
          .catch(function(){ nbGoWorkspace(null, false); });
      } else { nbGoWorkspace(null, false); }
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
  // A deleted journey is not "patient data the person still has".
  try { var r = await window.sb.from('patient_surgeries').select('id').eq('patient_id', uid).is('deleted_at', null).limit(1);
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
    window.location.href = '/patient-dashboard.html';
  };
}
// "Start my surgery journey" / "My Patient Journey" entry point.
window.nbStartPatientJourney = async function(){
  var sess = null;
  try { sess = (typeof window.getSession === 'function') ? await window.getSession() : null; } catch(e){}
  if (!sess){ nbShowAuthModal(); return; }                 // not signed in → sign in / sign up
  if (_nbRole === 'patient'){ window.location.href = '/patient-dashboard.html'; return; }
  var uid = sess.user.id;
  var optedIn = false;
  try { optedIn = localStorage.getItem(_nbPatientOptKey(uid)) === '1'; } catch(e){}
  if (optedIn || await _nbHasPatientData(uid)){ window.location.href = '/patient-dashboard.html'; return; }
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
  var credStep = ge('nb-cred-step');
  if(title) title.textContent = isReg ? 'Create account' : 'Sign in';
  if(ttext) ttext.textContent = isReg ? 'Already have an account?' : 'New to Anestheo?';
  if(tbtn)  tbtn.textContent  = isReg ? 'Sign in' : 'Create an account';
  if(forgot) forgot.style.display = isReg ? 'none' : 'block';
  if(btn)   btn.textContent   = isReg ? 'Create account' : 'Sign in';
  var passEl = ge('nb-pass');
  if(passEl) passEl.setAttribute('autocomplete', isReg ? 'new-password' : 'current-password');

  // Credentials are the only step now, in both modes: what kind of account
  // this is gets decided after authentication, on role-select.html.
  if(sub) sub.textContent = isReg ? 'Create your Anestheo account' : 'Access Anestheo';
  if(credStep) credStep.style.display = 'block';
  showMsg(null);
}

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
/* The More tab replaces the burger on an authenticated phone, so the trigger
   is whichever of the two is actually on screen. */
function nbMobTrigger(){
  /* getClientRects(), not offsetParent: the More tab lives inside a fixed bar
     and offsetParent is null for anything inside one, so an offsetParent test
     would never see it and the drawer would credit a burger that is not on
     screen — leaving aria-expanded on the wrong control and returning focus
     to a hidden button on close. */
  var more = ge('nb-tab-more');
  if(more && more.getClientRects().length) return more;
  return ge('nb-burger');
}
window.nbOpenMob = function(){
  /* Whichever control opened it owns the aria state and the focus that comes
     back on close. On a phone that is now the More tab, not the burger. */
  var m = ge('nb-mob'), bg = ge('nb-mob-bg'), btn = nbMobTrigger();
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
  var m = ge('nb-mob'), bg = ge('nb-mob-bg'), btn = nbMobTrigger();
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
  /* #nb-tabbar belongs in this list for the same reason #nb-nav does: the More
     tab is the control that OPENS the drawer, and its click bubbles here. Left
     out, the sheet opened and closed again on the same tap — it never appeared. */
  if(mob && mob.classList.contains('open') && !e.target.closest('#nb-nav') &&
     !e.target.closest('#nb-mob') && !e.target.closest('#nb-tabbar')){
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

  // Correct email check: non-space local part, @, then a domain with a dot.
  var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if(!emailOk){
    showMsg('err', 'Enter a valid email address.'); return;
  }
  if(_authMode === 'register'){
    if(pass.length < 6){ showMsg('err', 'Password must be at least 6 characters.'); return; }
  } else {
    if(!pass){ showMsg('err', 'Enter your password.'); return; }
  }

  setBtns(true);
  ge('nb-submit-btn').textContent = (_authMode === 'register') ? 'Creating\u2026' : 'Signing in\u2026';

  try {
    if(_authMode === 'register'){
      var rs = await window.sb.auth.signUp({
        email: email, password: pass,
        options: {
          /* Explicit root-domain landing. Without this the confirmation link
             falls back to the Supabase Site URL, which is exactly how these
             links ended up pointing at /v2/ before the cutover. The value must
             match a Supabase Redirect URLs entry verbatim. */
          emailRedirectTo: window.authRedirectTo('auth-callback.html')
          /* No `data` payload. Registration deliberately sends NO role: it
             would travel as user_metadata, which is client-supplied, and the
             server would have to decide whether to believe it. The account is
             created with no role at all and picks one on role-select.html
             against a real session. Nothing to distrust means nothing to
             get wrong. */
        }
      });
      setBtns(false);
      if(rs.error){ showMsg('err', rs.error.message); return; }

      /* AN ADDRESS THAT IS ALREADY REGISTERED LOOKS EXACTLY LIKE SUCCESS.
         GoTrue answers a signup for an existing address with HTTP 200 and a
         SANITIZED user — a random id, no identities — and it sends no email.
         The obfuscation is deliberate: it stops this endpoint being used to
         test whether somebody has an account here.

         It also means rs.data.user proves nothing. The only signal we get is
         the empty identities array. Without this check the modal announced
         "we just sent you a link" on every repeat attempt, no link was ever
         sent, and an account that simply already existed was indistinguishable
         from broken email delivery. */
      var ids = rs.data && rs.data.user && rs.data.user.identities;
      if(rs.data.user && !rs.data.session && ids && ids.length === 0){
        _pendingConfirmEmail = email;
        showMsg('err', 'An account already exists for <strong>' + escHtml(email) + '</strong>. ' +
          'Sign in with your password &mdash; or, if the confirmation link never arrived, ' +
          '<button type="button" class="nb-linkbtn" onclick="window.nbResendConfirm()">send it again</button>.');
        return;
      }

      if(rs.data.user && rs.data.session){
        /* Confirmation is switched off in this project, so the account is live
           immediately. Send them to choose a role exactly like a confirmed or
           social user — same destination, one flow. */
        window.nbCloseModal();
        window.location.href = '/role-select.html';
      } else {
        /* The normal path with confirmation ON: no session until the link is
           clicked. Say what happens next rather than "check your email", which
           leaves people wondering whether they are signed up or not. */
        _pendingConfirmEmail = email;
        showMsg('ok', '&#10003; Account created. Confirm <strong>' + escHtml(email) +
          '</strong> using the link we just sent, and you will land back here to finish setting up. ' +
          'Nothing after a few minutes? ' +
          '<button type="button" class="nb-linkbtn" onclick="window.nbResendConfirm()">Send it again</button>.');
      }
    } else {
      // ── Sign in ─────────────────────────────────────────────
      var ri;
      try {
        ri = await window.sb.auth.signInWithPassword({ email: email, password: pass });
      } catch(connErr){
        console.error('Sign-in could not reach the server.');
        setBtns(false);
        showMsg('err', 'Connection error reaching the server. Check your network and try again.');
        return;
      }

      // STEP 2 — error branches
      if(ri.error){
        var m = ri.error.message || '';
        setBtns(false);
        if(/email not confirmed/i.test(m)){
          showMsg('err', 'Please confirm your email before signing in. Check your inbox for the confirmation link.');
        } else if(/invalid login credentials/i.test(m) || /invalid/i.test(m)){
          showMsg('err', 'Invalid login credentials. Check your email and password.');
        } else if(/network|fetch|failed to fetch/i.test(m)){
          showMsg('err', m);
        } else {
          showMsg('err', m);
        }
        return;
      }

      // STEP 3 — verify session is saved
      var sessRes = await window.sb.auth.getSession();
      var session = sessRes.data && sessRes.data.session;
      if(!session){
        setBtns(false);
        showMsg('err', 'Login succeeded but the session was not saved. Storage may be blocked in this browser context.');
        return;
      }

      // STEP 4 — profile lookup
      var prof = null;
      try {
        var pr = await window.sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
        prof = pr.data;
      } catch(e){ prof = null; }

      // STEP 5 — auto-create profile if missing, do not fail login
      if(!prof){
        try {
          prof = await window.ensureProfile(session.user);
        } catch(e){ prof = null; }
        if(!prof){
          setBtns(false);
          showMsg('err', 'Signed in, but your profile could not be created. Please contact support.');
          return;
        }
      }

      /* STEP 6 — redirect, via the SAME resolver the OAuth callback and the
         password-reset page use. This used to re-derive the destination from
         `prof` inline, which is how sign-in ended up as the one entry point
         that knew nothing about role='pending' or an unapproved doctor: a new
         email user landed on a dashboard instead of role selection. One
         resolver, one answer, every door. */
      if(window.resetSessionCache) window.resetSessionCache();
      var dest = '/index.html';
      try {
        var res = await window.resolveAuthDestination();
        if(res && res.ok) dest = res.dest;
      } catch(e){ /* fall back to the homepage rather than trap them here */ }
      window.nbCloseModal();
      window.location.href = dest;
    }
  } catch(e){
    setBtns(false);
    console.error('Sign-in failed unexpectedly.');
    showMsg('err', e && e.message ? e.message : 'Network error. Please try again.');
  }
};

// Back-compat aliases
window.nbSignIn = function(){ _authMode = 'signin';   applyMode(); window.nbSubmitAuth(); };
window.nbSignUp = function(){ _authMode = 'register';  applyMode(); window.nbSubmitAuth(); };

/* Social sign-in from the modal. A successful call navigates away to the
   provider, so the only code that runs after it is the failure path. */
window.nbSocial = async function(provider){
  var names = { apple:'Apple', google:'Google', facebook:'Facebook' };
  try{
    showMsg('ok', 'Opening ' + (names[provider]||provider) + '\u2026');
    var r = await window.signInWithProvider(provider);
    if(r && r.error){
      showMsg('err', r.error.message ||
        ('Could not continue with ' + (names[provider]||provider) + '. Try again, or use your email and password below.'));
    }
  }catch(e){
    showMsg('err', 'Could not continue with ' + (names[provider]||provider) +
      '. Try again, or use your email and password below.');
  }
};

window.nbForgot = async function(){
  var email = (ge('nb-email').value || '').trim().toLowerCase();
  if(!email || !email.includes('@')){ showMsg('err', 'Enter your email above first.'); return; }
  /* Explicit recovery destination. Previously this had no redirectTo, so the
     link landed on the Site URL: the visitor was silently signed in on the
     homepage with no way to set a new password. */
  var r = await window.sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.authRedirectTo('reset-password.html')
  });
  if(r.error){ showMsg('err', r.error.message); return; }
  showMsg('ok', '&#10003; Reset email sent to <strong>' + email + '</strong>.');
};

window.nbSignOut = async function(){
  try { await window.sb.auth.signOut(); } catch(e){}
  window.location.href = '/index.html';
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
    col('Company', [['About','/about.html'],['Support','mailto:support@anestheo.com']])+
    col('Legal &amp; Trust', [['Privacy','/privacy.html'],['Terms','/terms.html'],['Medical Disclaimer','/medical-disclaimer.html'],['Security','/security.html']])+
    col('Product', [['Release Notes','/release-notes.html'],['Report a Bug','mailto:support@anestheo.com?subject=Bug%20report']])+
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
  if(_nbInitDone){ return; }
  _nbInitDone = true;
  injectCSS();
  nbBindKeyboardDodge();
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
