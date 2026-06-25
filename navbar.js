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
.nb-mob{display:none;position:fixed;top:56px;left:0;right:0;z-index:899;
  background:rgba(6,14,10,.99);border-bottom:1px solid rgba(27,107,90,.22);
  flex-direction:column;padding:10px 0 16px;}
.nb-mob.open{display:flex;}
.nb-mob-link,.nb-mob button{display:block;padding:12px 24px;font-size:15px;
  color:rgba(255,255,255,.6);text-decoration:none;transition:color .18s;
  border:none;background:none;width:100%;text-align:left;
  font-family:inherit;cursor:pointer;}
.nb-mob-link:hover,.nb-mob button:hover{color:#fff;}
.nb-mob-sep{height:1px;background:rgba(27,107,90,.18);margin:8px 0;}
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
/* Doctor Tools dropdown */
/* ── Live Monitor widget (brand identity, every page) ── */
.nb-monitor{position:relative;display:inline-flex;align-items:center;gap:8px;text-decoration:none;
  background:#06120D;border:1px solid rgba(126,207,192,.22);border-radius:9px;padding:5px 10px;margin-left:4px;
  transition:border-color .18s,box-shadow .18s;white-space:nowrap;}
.nb-monitor:hover{border-color:rgba(126,207,192,.5);box-shadow:0 0 0 1px rgba(126,207,192,.18),0 8px 22px rgba(0,0,0,.4);}
.nb-mon-pulse{width:7px;height:7px;border-radius:50%;background:#46d39a;box-shadow:0 0 7px #46d39a;animation:nbmonpulse 1.5s infinite;flex-shrink:0;}
@keyframes nbmonpulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.7)}}
.nb-mon-ecg{width:54px;height:20px;overflow:hidden;display:block;}
.nb-mon-ecg svg{width:200%;height:100%;display:block;}
.nb-mon-ecg path{fill:none;stroke:#46d39a;stroke-width:1.4;vector-effect:non-scaling-stroke;filter:drop-shadow(0 0 2px rgba(70,211,154,.5));}
.nb-ecg-scroll{animation:nbsweep 4.5s linear infinite;}
@keyframes nbsweep{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.nb-mon-vitals{display:inline-flex;align-items:center;gap:9px;}
.nbv{display:inline-flex;align-items:baseline;gap:3px;font-variant-numeric:tabular-nums;}
.nbv i{font-style:normal;font-size:9px;letter-spacing:.03em;color:rgba(255,255,255,.45);}
.nbv b{font-size:13px;font-weight:700;color:#46d39a;}
.nbv-co2 b{color:#e8c454;}
.nb-mon-vitals .nbv:nth-child(2) b{color:#5ad0e6;}
/* tooltip */
.nb-mon-tip{display:none;position:absolute;top:calc(100% + 9px);right:0;width:230px;
  background:#0C1F18;border:1px solid rgba(42,138,116,.4);border-radius:11px;padding:13px 15px;
  box-shadow:0 16px 44px rgba(0,0,0,.55);z-index:1100;font-size:12px;line-height:1.7;color:rgba(255,255,255,.7);white-space:normal;}
.nb-mon-tip strong{display:block;font-size:13px;color:#fff;margin-bottom:5px;}
.nb-mon-tip em{display:block;font-style:normal;color:#7ECFC0;font-weight:600;margin-top:8px;}
.nb-monitor:hover .nb-mon-tip{display:block;animation:nbfade .15s ease;}
@media(max-width:980px){.nbv-co2{display:none;}}
@media(max-width:860px){.nb-mon-vitals{display:none;}.nb-monitor{padding:5px 9px;}}
@media(max-width:740px){
  .nb-nav-links{display:none;}
  .nb-burger{display:block;}
  .nb-modal-btns{grid-template-columns:1fr;}
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
          '<a class="nb-monitor" id="nb-monitor" href="/v2/dashboard.html" aria-label="Anesthesia Live Tools">' +
            '<span class="nb-mon-pulse"></span>' +
            '<span class="nb-mon-ecg"><svg viewBox="0 0 120 24" preserveAspectRatio="none"><g class="nb-ecg-scroll">' +
              '<path d="M0,12 L14,12 18,5 22,19 26,12 40,12 54,12 58,5 62,19 66,12 80,12 94,12 98,5 102,19 106,12 120,12"/>' +
              '<path d="M120,12 L134,12 138,5 142,19 146,12 160,12 174,12 178,5 182,19 186,12 200,12 214,12 218,5 222,19 226,12 240,12"/>' +
            '</g></svg></span>' +
            '<span class="nb-mon-vitals">' +
              '<span class="nbv"><i>HR</i><b id="nbv-hr">78</b></span>' +
              '<span class="nbv"><i>SpO&#8322;</i><b id="nbv-spo2">99</b></span>' +
              '<span class="nbv nbv-co2"><i>ETCO&#8322;</i><b id="nbv-co2">36</b></span>' +
            '</span>' +
            '<span class="nb-mon-tip">' +
              '<strong>Anesthesia Live Tools</strong>' +
              'Airway &middot; Drug dosing &middot; Ventilation<br>TIVA / TCI &middot; Regional &middot; ICU tools' +
              '<em>Click to open</em>' +
            '</span>' +
          '</a>' +
        '</div>' +
        // Role-aware patient navigation (shown only to logged-in patients).
        '<div class="nb-nav-links" id="nb-nav-patient" style="display:none">' +
          '<a href="/v2/index.html"' + activeCls('/v2/index.html', p) + '>Home</a>' +
          '<a href="/v2/patient-dashboard.html"' + activeCls('/v2/patient-dashboard.html', p) + '>My Space</a>' +
          '<a href="/v2/ask.html"' + activeCls('/v2/ask.html', p) + '>Ask Anesthesiologist</a>' +
          '<a href="/v2/videos.html"' + activeCls('/v2/videos.html', p) + '>Videos</a>' +
          '<a href="/v2/settings.html"' + activeCls('/v2/settings.html', p) + '>Profile</a>' +
        '</div>' +
        '<div class="nb-right">' +
          '<div class="nb-search-wrap" id="nb-search-wrap" style="display:none">' +
            '<input type="text" class="nb-search" id="nb-search" placeholder="Search tools &amp; references…" autocomplete="off" ' +
              'oninput="window.nbSearch(this.value)" onfocus="window.nbSearch(this.value)" ' +
              'onkeydown="window.nbSearchKey(event)">' +
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
                '<a href="/v2/patient-dashboard.html" class="nb-menu-item" id="nb-menu-patient" style="display:none">&#10024; My Space</a>' +
                '<a href="/v2/settings.html" class="nb-menu-item">&#9881; Settings</a>' +
                '<div class="nb-menu-sep"></div>' +
                '<button class="nb-menu-item nb-menu-danger" onclick="window.nbSignOut()">&#8594; Sign out</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<button class="nb-burger" id="nb-burger" onclick="window.nbToggleMob()" aria-label="Menu">&#9776;</button>' +
      '</div>' +
    '</nav>' +
    '<div class="nb-mob" id="nb-mob">' +
      // Public mobile nav — guests & doctors (unchanged).
      '<div id="nb-mob-public">' +
        '<a href="/v2/index.html" class="nb-mob-link">Home</a>' +
        '<a href="/v2/patients.html" class="nb-mob-link">For Patients</a>' +
        '<a href="/v2/videos.html" class="nb-mob-link">Videos</a>' +
        '<a href="/v2/ask.html" class="nb-mob-link">Ask Anesthesiologist</a>' +
        '<a href="/v2/dashboard.html" class="nb-mob-link">&#129728; Anesthesia Live Tools</a>' +
      '</div>' +
      // Patient mobile nav — logged-in patients only.
      '<div id="nb-mob-patient-nav" style="display:none">' +
        '<a href="/v2/index.html" class="nb-mob-link">Home</a>' +
        '<a href="/v2/patient-dashboard.html" class="nb-mob-link">&#10024; My Space</a>' +
        '<a href="/v2/ask.html" class="nb-mob-link">Ask Anesthesiologist</a>' +
        '<a href="/v2/videos.html" class="nb-mob-link">Videos</a>' +
        '<a href="/v2/settings.html" class="nb-mob-link">Profile</a>' +
      '</div>' +
      '<div class="nb-mob-sep"></div>' +
      '<div id="nb-mob-guest"><button class="nb-btn" style="width:100%" onclick="window.nbOpenModal();window.nbCloseMob()">Login</button></div>' +
      '<div id="nb-mob-auth" style="display:none">' +
        '<a href="/v2/dashboard.html" class="nb-mob-link" id="nb-mob-workspace">Dashboard</a>' +
        '<a href="/v2/settings.html" class="nb-mob-link" id="nb-mob-settings">Settings</a>' +
        '<button class="nb-mob-link" style="background:none;border:none;text-align:left;cursor:pointer;font-family:inherit;color:rgba(255,100,80,.7)" onclick="window.nbSignOut()">Sign out</button>' +
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

function setBtns(disabled){
  var b = ge('nb-submit-btn');
  if(b){
    b.disabled = disabled;
    if(!disabled) b.textContent = (_authMode === 'register') ? 'Create account' : 'Sign in';
  }
}

function setGuest(){
  var g = ge('nb-guest-links'), a = ge('nb-auth-links');
  if(g) g.style.display = '';
  if(a) a.style.display = 'none';
  var mg = ge('nb-mob-guest'), ma = ge('nb-mob-auth');
  if(mg) mg.style.display = '';
  if(ma) ma.style.display = 'none';
  // Restore the public navigation for guests (and after sign-out).
  var navPublic = ge('nb-nav-links'), navPatient = ge('nb-nav-patient');
  if(navPublic) navPublic.style.display = '';
  if(navPatient) navPatient.style.display = 'none';
  var mobPublic = ge('nb-mob-public'), mobPatient = ge('nb-mob-patient-nav');
  if(mobPublic) mobPublic.style.display = '';
  if(mobPatient) mobPatient.style.display = 'none';
}

function setAuth(){
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
  // Dropdown: staff get the Doctor Workspace entry; patients get My Space.
  var ws  = ge('nb-menu-workspace'); if(ws)  ws.style.display  = isStaff ? 'flex' : 'none';
  var pt  = ge('nb-menu-patient');   if(pt)  pt.style.display  = isStaff ? 'none' : 'flex';
  // Role-aware primary navigation. Patients get a dedicated nav (Home, My Space,
  // Ask Anesthesiologist, Videos, Profile). The public nav — which carries the
  // Anesthesia Live monitor and other doctor-facing tools — is reserved for
  // guests and doctors and is left unchanged.
  var navPublic  = ge('nb-nav-links');   if(navPublic)  navPublic.style.display  = isPatient ? 'none' : '';
  var navPatient = ge('nb-nav-patient'); if(navPatient) navPatient.style.display = isPatient ? '' : 'none';
  var mobPublic  = ge('nb-mob-public');      if(mobPublic)  mobPublic.style.display  = isPatient ? 'none' : 'block';
  var mobPatient = ge('nb-mob-patient-nav'); if(mobPatient) mobPatient.style.display = isPatient ? 'block' : 'none';
  var mobWs  = ge('nb-mob-workspace'); if(mobWs)  mobWs.style.display  = isPatient ? 'none' : 'block';
  var mobSet = ge('nb-mob-settings');  if(mobSet) mobSet.style.display = isPatient ? 'none' : 'block';
  // Global search for staff only
  var search = ge('nb-search-wrap'); if(search) search.style.display = isStaff ? 'block' : 'none';
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
window.nbOpenModal = function(){
  _authMode = 'signin';
  applyMode();
  ge('nb-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(function(){ var e = ge('nb-email'); if(e) e.focus(); }, 80);
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

window.nbToggleMob = function(){
  var m = ge('nb-mob');
  if(m) m.classList.toggle('open');
};

window.nbCloseMob = function(){
  var m = ge('nb-mob');
  if(m) m.classList.remove('open');
};

document.addEventListener('click', function(e){
  var mob  = ge('nb-mob');
  if(mob && mob.classList.contains('open') && !e.target.closest('#nb-nav') && !e.target.closest('#nb-mob')){
    mob.classList.remove('open');
  }
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
          await window.saveProfile(rs.data.user.id, { role: _regRole, verification_status: verif });
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
      if(window.resetSessionCache) window.resetSessionCache();
      var dest = '/v2/dashboard.html';
      console.log('REDIRECTING TO DASHBOARD —', dest);
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
  if(role === 'patient'){ window.location.href = '/v2/patients.html'; }
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
function nbStartMonitor(){
  function rnd(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
  function tick(){
    var hr=document.getElementById('nbv-hr'), spo2=document.getElementById('nbv-spo2'), co2=document.getElementById('nbv-co2');
    if(hr) hr.textContent = rnd(70,80);
    if(spo2) spo2.textContent = rnd(97,100);
    if(co2) co2.textContent = rnd(34,40);
  }
  tick(); setInterval(tick, 3500);
}
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
  nbStartMonitor(); // animate the navbar live-monitor vitals

  try {
    var session = await window.getSession();
    if(session){
      setAuth();
      var profile = await window.getProfile(session.user.id);
      populateMenu(session.user, profile);
    }
    window.sb.auth.onAuthStateChange(async function(event, sess){
      if(event === 'SIGNED_IN'  && sess){
        setAuth();
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
document.addEventListener('keydown', function(e){ if(e.key === 'Escape') window.nbCloseModal(); });

})();
