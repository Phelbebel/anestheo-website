// ============================================================
// ANESTHEO GLOBAL APP SHELL v1
// Include on every page. Handles:
//   - Supabase client (single instance)
//   - Session detection
//   - Navbar injection
//   - Profile dropdown
//   - Auth modal (login/signup without leaving the page)
//   - Protected page guard
// ============================================================

// ── CONFIG ───────────────────────────────────────────────────
// ── CONFIG ───────────────────────────────────────────────────
// Credentials live in supabase.js which must load before this file.
// anestheo-app.js uses window.sb — the single shared client.
var ADMIN_EMAIL = 'drgiga@anestheo.com';

// Alias: use window.sb created by supabase.js
var supa = window.sb;
console.log('ANESTHEO APP INIT - supa:', supa ? 'OK' : 'MISSING — check supabase.js loaded first');

// Expose globally so other page scripts can use the same instance
window.anestheoSupa = function(){ return supa; };
window.anestheoSession = null;   // set after auth check
window.anestheoProfile = null;   // set after profile fetch

// ── NAV CSS — injected once ───────────────────────────────────
var NAV_CSS = `
.an-nav{position:fixed;top:0;left:0;right:0;z-index:500;height:58px;
  background:rgba(10,26,21,0.97);backdrop-filter:blur(16px);
  border-bottom:1px solid rgba(27,107,90,0.2);font-family:'DM Sans',sans-serif;}
.an-nav-inner{max-width:1060px;margin:0 auto;padding:0 32px;height:100%;
  display:flex;align-items:center;justify-content:space-between;gap:16px;}
.an-logo{text-decoration:none;font-size:19px;font-weight:600;color:#fff;
  letter-spacing:.01em;flex-shrink:0;}
.an-logo span{color:#2A8A74;}
.an-links{display:flex;align-items:center;gap:4px;flex:1;justify-content:center;}
.an-links a{color:rgba(255,255,255,.55);text-decoration:none;font-size:14px;
  padding:6px 11px;border-radius:6px;transition:all .18s;white-space:nowrap;}
.an-links a:hover,.an-links a.active{color:#fff;background:rgba(255,255,255,.05);}
.an-right{display:flex;align-items:center;gap:8px;flex-shrink:0;}
/* Guest */
.an-login-btn{background:#1B6B5A;color:#fff;border:none;padding:7px 16px;
  border-radius:7px;font-size:13px;font-weight:500;cursor:pointer;
  font-family:inherit;transition:background .2s;white-space:nowrap;}
.an-login-btn:hover{background:#2A8A74;}
/* Auth links (logged in) */
.an-auth-links{display:flex;align-items:center;gap:2px;}
.an-auth-links a{color:rgba(255,255,255,.55);text-decoration:none;font-size:14px;
  padding:6px 11px;border-radius:6px;transition:all .18s;white-space:nowrap;}
.an-auth-links a:hover{color:#fff;background:rgba(255,255,255,.05);}
/* Profile button */
.an-profile-btn{display:flex;align-items:center;gap:7px;
  background:rgba(27,107,90,.15);border:1px solid rgba(27,107,90,.3);
  border-radius:8px;padding:5px 11px 5px 7px;cursor:pointer;
  color:#fff;font-size:13px;font-family:inherit;transition:all .2s;
  white-space:nowrap;position:relative;}
.an-profile-btn:hover{background:rgba(27,107,90,.28);border-color:rgba(42,138,116,.45);}
.an-avatar{width:24px;height:24px;border-radius:50%;background:#2A8A74;
  color:#fff;display:flex;align-items:center;justify-content:center;
  font-size:10px;font-weight:700;flex-shrink:0;}
.an-chevron{font-size:9px;color:rgba(255,255,255,.4);margin-left:1px;}
/* Dropdown */
.an-dropdown{display:none;position:absolute;top:calc(100% + 8px);right:0;
  background:rgba(9,22,15,.99);border:1px solid rgba(27,107,90,.3);
  border-radius:12px;min-width:210px;box-shadow:0 16px 48px rgba(0,0,0,.5);
  z-index:600;overflow:hidden;}
.an-dropdown.open{display:block;}
.an-dd-head{padding:13px 16px 11px;border-bottom:1px solid rgba(27,107,90,.16);}
.an-dd-email{font-size:12px;color:rgba(255,255,255,.4);word-break:break-all;}
.an-dd-role{font-size:11px;color:#7ECFC0;margin-top:3px;font-weight:500;}
.an-dd-item{display:flex;align-items:center;gap:9px;padding:10px 16px;
  font-size:13px;color:rgba(255,255,255,.55);text-decoration:none;
  cursor:pointer;transition:all .18s;font-family:inherit;
  background:none;border:none;width:100%;text-align:left;}
.an-dd-item:hover{background:rgba(27,107,90,.12);color:#fff;}
.an-dd-sep{height:1px;background:rgba(27,107,90,.14);margin:4px 0;}
.an-dd-danger{color:rgba(255,120,100,.7)!important;}
.an-dd-danger:hover{background:rgba(192,57,43,.08)!important;color:rgba(255,140,120,.9)!important;}
.an-dd-verif{font-size:11px;padding:6px 16px;color:#E8A838;pointer-events:none;}
/* Burger */
.an-burger{display:none;background:none;border:none;color:#fff;
  font-size:22px;cursor:pointer;padding:4px;line-height:1;}
/* Mobile menu */
.an-mob{display:none;position:fixed;top:58px;left:0;right:0;
  background:rgba(8,18,12,.99);border-bottom:1px solid rgba(27,107,90,.2);
  flex-direction:column;z-index:499;padding:10px 20px 18px;}
.an-mob.open{display:flex;}
.an-mob a,.an-mob button{color:rgba(255,255,255,.55);text-decoration:none;
  font-size:16px;padding:13px 0;border-bottom:1px solid rgba(27,107,90,.1);
  background:none;border-left:none;border-right:none;border-top:none;
  font-family:inherit;cursor:pointer;text-align:left;width:100%;transition:color .2s;}
.an-mob a:hover,.an-mob button:hover{color:#fff;}
.an-mob a:last-child,.an-mob button:last-child{border-bottom:none;}
/* Auth modal */
.an-modal-bd{display:none;position:fixed;inset:0;z-index:800;
  background:rgba(4,12,8,.85);backdrop-filter:blur(8px);
  align-items:center;justify-content:center;padding:20px;}
.an-modal-bd.open{display:flex;}
.an-modal{background:rgba(9,22,15,.99);border:1px solid rgba(27,107,90,.32);
  border-radius:18px;width:100%;max-width:390px;overflow:hidden;position:relative;
  box-shadow:0 40px 100px rgba(0,0,0,.6);}
.an-modal::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;
  background:linear-gradient(90deg,transparent,rgba(42,138,116,.6),transparent);}
.an-modal-top{padding:24px 24px 18px;text-align:center;
  border-bottom:1px solid rgba(27,107,90,.16);}
.an-modal-ico{width:40px;height:40px;border-radius:10px;
  background:rgba(27,107,90,.2);border:1px solid rgba(42,138,116,.3);
  display:flex;align-items:center;justify-content:center;margin:0 auto 11px;}
.an-modal-top h2{font-family:'Playfair Display',serif;font-size:19px;
  font-weight:700;margin-bottom:4px;color:#fff;}
.an-modal-top p{font-size:13px;color:rgba(255,255,255,.5);}
.an-modal-body{padding:18px 24px 22px;}
.an-social{display:flex;flex-direction:column;gap:8px;margin-bottom:13px;}
.an-soc-btn{width:100%;display:flex;align-items:center;justify-content:center;
  gap:9px;padding:11px;border-radius:9px;font-size:13px;font-weight:500;
  cursor:pointer;font-family:inherit;border:none;transition:all .18s;min-height:44px;
  -webkit-tap-highlight-color:transparent;}
.an-google{background:#fff;color:#1f1f1f;} .an-google:hover{background:#f0f0f0;}
.an-apple{background:#050505;color:#fff;border:1px solid rgba(255,255,255,.18)!important;}
.an-apple:hover{background:#111;}
.an-divider{display:flex;align-items:center;gap:9px;margin:13px 0;}
.an-dline{flex:1;height:1px;background:rgba(255,255,255,.08);}
.an-dtxt{font-size:11px;color:rgba(255,255,255,.3);}
.an-field{margin-bottom:9px;}
.an-field input{width:100%;background:rgba(255,255,255,.055);
  border:1px solid rgba(255,255,255,.11);border-radius:9px;padding:11px 13px;
  color:#fff;font-size:15px;font-family:inherit;outline:none;transition:all .2s;
  appearance:none;-webkit-appearance:none;min-height:44px;}
.an-field input:focus{border-color:#2A8A74;background:rgba(255,255,255,.09);}
.an-field input::placeholder{color:rgba(255,255,255,.3);}
.an-btn-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:11px;}
.an-btn{padding:11px;border-radius:9px;font-size:14px;font-weight:600;
  cursor:pointer;font-family:inherit;min-height:44px;transition:all .2s;
  -webkit-tap-highlight-color:transparent;border:none;}
.an-btn-primary{background:#1B6B5A;color:#fff;} .an-btn-primary:hover{background:#2A8A74;}
.an-btn-ghost{background:transparent;color:#fff;
  border:1px solid rgba(255,255,255,.15)!important;}
.an-btn-ghost:hover{background:rgba(255,255,255,.05);}
.an-btn:disabled{opacity:.45;cursor:default;}
.an-msg{display:none;border-radius:7px;padding:9px 12px;font-size:13px;
  margin-top:9px;line-height:1.5;}
.an-err{background:rgba(192,57,43,.12);border:1px solid rgba(192,57,43,.3);
  color:rgba(255,160,140,.93);}
.an-ok{background:rgba(27,107,90,.15);border:1px solid rgba(42,138,116,.32);
  color:#7ECFC0;}
.an-modal-links{display:flex;justify-content:center;gap:14px;margin-top:11px;flex-wrap:wrap;}
.an-modal-links button{background:none;border:none;color:rgba(255,255,255,.35);
  font-size:12px;cursor:pointer;font-family:inherit;padding:0;transition:color .2s;}
.an-modal-links button:hover{color:#fff;}
.an-modal-close{position:absolute;top:13px;right:13px;background:rgba(255,255,255,.07);
  border:none;color:rgba(255,255,255,.5);width:26px;height:26px;border-radius:50%;
  cursor:pointer;display:flex;align-items:center;justify-content:center;
  font-size:13px;transition:all .2s;}
.an-modal-close:hover{background:rgba(255,255,255,.15);color:#fff;}
/* Page loader */
.an-page-loader{position:fixed;inset:0;background:#0A1A15;z-index:9999;
  display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;
  transition:opacity .3s;}
.an-page-loader.done{opacity:0;pointer-events:none;}
.an-spinner{width:32px;height:32px;border:3px solid rgba(27,107,90,.3);
  border-top-color:#2A8A74;border-radius:50%;animation:an-spin .8s linear infinite;}
@keyframes an-spin{to{transform:rotate(360deg)}}
.an-loader-txt{font-size:12px;color:rgba(255,255,255,.35);font-family:'DM Sans',sans-serif;}
@media(max-width:860px){
  .an-nav-inner{padding:0 16px;}
  .an-links,.an-auth-links{display:none;}
  .an-burger{display:block;}
}
@media(max-width:480px){.an-btn-row{grid-template-columns:1fr;}}
`;

// ── INJECT CSS ────────────────────────────────────────────────
function injectCSS(){
  if(document.getElementById('an-css')) return;
  var s = document.createElement('style');
  s.id = 'an-css'; s.textContent = NAV_CSS;
  document.head.appendChild(s);
}

// ── BUILD NAV HTML ────────────────────────────────────────────
function buildNavHTML(activePage){
  var pages = [
    {href:'index.html', label:'Home'},
    {href:'patients.html', label:'For Patients'},
    {href:'ask.html', label:'Anesthesiologist'},
    {href:'videos.html', label:'Videos'}
  ];
  var links = pages.map(function(p){
    var active = activePage === p.href ? ' class="active"' : '';
    return '<a href="'+p.href+'"'+active+'>'+p.label+'</a>';
  }).join('');

  var mobLinks = pages.map(function(p){
    return '<a href="'+p.href+'">'+p.label+'</a>';
  }).join('');

  return (
    '<nav class="an-nav" id="an-nav">'+
      '<div class="an-nav-inner">'+
        '<a href="index.html" class="an-logo">Anest<span>heo</span></a>'+
        '<div class="an-links" id="an-links">'+links+'</div>'+
        '<div class="an-right" id="an-right">'+
          // Guest state (default until session loads)
          '<button class="an-login-btn" id="an-login-btn" onclick="window.anestheoOpenModal()">Login</button>'+
          // Auth links shown when logged in (hidden by default)
          '<div class="an-auth-links" id="an-auth-links" style="display:none">'+
            '<a href="#" id="an-dash-link">Dashboard</a>'+
            '<a href="patients.html">Patients</a>'+
          '</div>'+
          // Profile dropdown (hidden by default)
          '<div style="position:relative;" id="an-profile-wrap" style="display:none">'+
            '<button class="an-profile-btn" id="an-profile-btn" onclick="window.anestheoToggleDD()">'+
              '<div class="an-avatar" id="an-avatar">?</div>'+
              '<span id="an-profile-name" style="max-width:100px;overflow:hidden;text-overflow:ellipsis;"></span>'+
              '<span class="an-chevron">&#9660;</span>'+
            '</button>'+
            '<div class="an-dropdown" id="an-dropdown">'+
              '<div class="an-dd-head">'+
                '<div class="an-dd-email" id="an-dd-email"></div>'+
                '<div class="an-dd-role" id="an-dd-role"></div>'+
              '</div>'+
              '<a href="#" class="an-dd-item" id="an-dd-dash">&#128202; Dashboard</a>'+
              '<a href="auth.html" class="an-dd-item">&#9881; Account settings</a>'+
              '<div class="an-dd-sep"></div>'+
              '<div class="an-dd-verif" id="an-dd-verif" style="display:none"></div>'+
              '<div class="an-dd-sep" id="an-dd-sep2" style="display:none"></div>'+
              '<button class="an-dd-item an-dd-danger" onclick="window.anestheoSignOut()">&#8594; Sign out</button>'+
            '</div>'+
          '</div>'+
        '</div>'+
        '<button class="an-burger" id="an-burger" onclick="window.anestheoToggleMob()">&#9776;</button>'+
      '</div>'+
    '</nav>'+
    // Mobile menu
    '<div class="an-mob" id="an-mob">'+
      mobLinks+
      '<button id="an-mob-login" onclick="window.anestheoOpenModal()">Login</button>'+
    '</div>'+
    // Auth modal
    '<div class="an-modal-bd" id="an-modal" onclick="if(event.target===this)window.anestheoCloseModal()">'+
      '<div class="an-modal">'+
        '<button class="an-modal-close" onclick="window.anestheoCloseModal()">&#10005;</button>'+
        '<div class="an-modal-top">'+
          '<div class="an-modal-ico">'+
            '<svg width="20" height="14" viewBox="0 0 44 28" fill="none">'+
              '<path d="M2 14 L8 14 L11 5 L16 22 L21 9 L25 18 L29 14 L42 14" stroke="#7ECFC0" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>'+
            '</svg>'+
          '</div>'+
          '<h2>Access Anestheo</h2>'+
          '<p>Sign in or create your account</p>'+
        '</div>'+
        '<div class="an-modal-body">'+
          '<div class="an-social">'+
            '<button class="an-soc-btn an-google" onclick="window.anestheoOAuth(\'google\')">'+
              '<svg width="16" height="16" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/><path d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z" fill="#EA4335"/></svg>'+
              'Continue with Google'+
            '</button>'+
            '<button class="an-soc-btn an-apple" onclick="window.anestheoOAuth(\'apple\')">'+
              '<svg width="14" height="16" viewBox="0 0 16 20"><path d="M13.44 10.55c-.02-2.1 1.72-3.12 1.8-3.17-.98-1.43-2.5-1.63-3.05-1.65-1.3-.13-2.54.76-3.2.76-.66 0-1.68-.74-2.76-.72C4.6 5.8 3.05 6.67 2.2 8.08.5 10.93 1.77 15.12 3.41 17.4c.82 1.16 1.78 2.46 3.05 2.41 1.22-.05 1.68-.78 3.16-.78 1.48 0 1.88.78 3.17.76 1.32-.02 2.15-1.19 2.95-2.36.93-1.35 1.32-2.66 1.34-2.73-.03-.01-2.56-.98-2.58-3.15zm-2.41-5.8c.68-.82 1.14-1.96.01-3.1-1.01.04-2.24.67-2.94 1.5-.65.74-1.2 1.92-.02 2.96 1.07-.03 2.28-.67 2.95-1.36z" fill="#fff"/></svg>'+
              'Continue with Apple'+
            '</button>'+
          '</div>'+
          '<div class="an-divider"><div class="an-dline"></div><div class="an-dtxt">or continue with email</div><div class="an-dline"></div></div>'+
          '<div class="an-field"><input type="email" id="an-email" placeholder="Email address" autocomplete="email" inputmode="email" onkeydown="if(event.key===\'Enter\')document.getElementById(\'an-pass\').focus()"></div>'+
          '<div class="an-field"><input type="password" id="an-pass" placeholder="Password" autocomplete="current-password" onkeydown="if(event.key===\'Enter\')window.anestheoSignIn()"></div>'+
          '<div class="an-btn-row">'+
            '<button class="an-btn an-btn-primary" id="an-signin-btn" onclick="window.anestheoSignIn()">Sign in</button>'+
            '<button class="an-btn an-btn-ghost" id="an-signup-btn" onclick="window.anestheoSignUp()">Create account</button>'+
          '</div>'+
          '<div class="an-msg an-err" id="an-err"></div>'+
          '<div class="an-msg an-ok" id="an-ok"></div>'+
          '<div class="an-modal-links">'+
            '<button onclick="window.anestheoForgot()">Forgot password?</button>'+
            '<span style="color:rgba(255,255,255,.1)">·</span>'+
            '<button onclick="window.anestheoCloseModal()">Continue as guest</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
    '</div>'+
    // Page loader
    '<div class="an-page-loader" id="an-page-loader">'+
      '<div class="an-spinner"></div>'+
      '<div class="an-loader-txt" id="an-loader-txt">Loading…</div>'+
    '</div>'
  );
}

// ── HELPERS ───────────────────────────────────────────────────
function ge(id){ return document.getElementById(id); }
function setTxt(id, txt){ var e = ge(id); if(e) e.textContent = txt; }
function show(id){ var e = ge(id); if(e) e.style.display = ''; }
function hide(id){ var e = ge(id); if(e) e.style.display = 'none'; }
function showFlex(id){ var e = ge(id); if(e) e.style.display = 'flex'; }

function clearMsg(){ hide('an-err'); hide('an-ok'); }
function showErr(msg){ clearMsg(); var e=ge('an-err'); if(e){e.textContent=msg;e.style.display='block';} }
function showOk(msg){ clearMsg(); var e=ge('an-ok'); if(e){e.innerHTML=msg;e.style.display='block';} }
function setModalBtns(d){
  var si=ge('an-signin-btn'),su=ge('an-signup-btn');
  if(si)si.disabled=d; if(su)su.disabled=d;
}
function mval(id){ var e=ge(id); return e?e.value.trim():''; }

// ── NAV STATE: GUEST ──────────────────────────────────────────
function setNavGuest(){
  show('an-login-btn');
  hide('an-auth-links');
  var pw = ge('an-profile-wrap'); if(pw) pw.style.display='none';
  var mob = ge('an-mob-login'); if(mob){ mob.style.display=''; mob.textContent='Login'; }
}

// ── NAV STATE: AUTHENTICATED ──────────────────────────────────
function setNavAuth(user, profile){
  console.log('NAVBAR RENDERED - role:', profile ? profile.role : 'unknown');
  var role     = profile ? (profile.role || 'doctor')  : 'doctor';
  var fullname = profile ? (profile.full_name || '')   : '';
  var verif    = profile ? (profile.verification_status || '') : '';
  var isAdmin  = profile ? !!profile.is_admin           : false;

  var parts    = fullname.trim().split(' ').filter(Boolean);
  var initials = (parts.length >= 2) ? parts[0][0]+parts[parts.length-1][0] : parts[0] ? parts[0].slice(0,2) : (user.email[0]||'?');
  initials = initials.toUpperCase();

  var displayName = '';
  if(role === 'doctor' || role === 'admin'){
    displayName = parts.length >= 2 ? 'Dr. '+parts[parts.length-1] : (fullname || user.email.split('@')[0]);
  } else {
    displayName = parts[0] || user.email.split('@')[0];
  }

  var dashHref = isAdmin ? 'admin.html' : (role === 'patient') ? 'patients.html' : 'doctor.html';

  var roleLabels = {doctor:'Anesthesiologist',patient:'Patient',admin:'Administrator',nurse:'Nurse',student:'Medical Student',other:'Healthcare Professional'};
  var roleLabel  = roleLabels[role] || role;

  // Set elements
  setTxt('an-avatar', initials);
  setTxt('an-profile-name', displayName);
  setTxt('an-dd-email', user.email);
  setTxt('an-dd-role', roleLabel);

  var dashLink = ge('an-dash-link'); if(dashLink) dashLink.href = dashHref;
  var ddDash   = ge('an-dd-dash');   if(ddDash)   ddDash.href  = dashHref;

  // Verification badge
  var verifEl = ge('an-dd-verif'), sep2 = ge('an-dd-sep2');
  if(verif === 'pending'){
    if(verifEl){ verifEl.textContent='⏳ Verification pending'; verifEl.style.display='block'; }
    if(sep2) sep2.style.display='block';
  } else if(verif === 'rejected'){
    if(verifEl){ verifEl.textContent='✗ Not approved — contact support'; verifEl.style.display='block'; verifEl.style.color='rgba(255,130,110,.8)'; }
    if(sep2) sep2.style.display='block';
  } else {
    if(verifEl) verifEl.style.display='none';
    if(sep2) sep2.style.display='none';
  }

  // Show auth links, hide login button
  hide('an-login-btn');
  showFlex('an-auth-links');
  var pw = ge('an-profile-wrap'); if(pw){ pw.style.display='flex'; pw.style.alignItems='center'; }

  // Mobile menu
  var mob = ge('an-mob-login'); if(mob) mob.style.display='none';
}

// ── MODAL ─────────────────────────────────────────────────────
window.anestheoOpenModal = function(){
  var m = ge('an-modal'); if(m) m.classList.add('open');
  document.body.style.overflow='hidden';
  setTimeout(function(){ var e=ge('an-email'); if(e) e.focus(); },100);
};
window.anestheoCloseModal = function(){
  var m = ge('an-modal'); if(m) m.classList.remove('open');
  document.body.style.overflow='';
  clearMsg();
};
document.addEventListener('keydown', function(e){ if(e.key==='Escape') window.anestheoCloseModal(); });

// ── PROFILE DROPDOWN ──────────────────────────────────────────
window.anestheoToggleDD = function(){
  var dd = ge('an-dropdown'); if(dd) dd.classList.toggle('open');
};
window.anestheoToggleMob = function(){
  var m = ge('an-mob'); if(m) m.classList.toggle('open');
};
document.addEventListener('click', function(e){
  var wrap = ge('an-profile-wrap');
  var dd   = ge('an-dropdown');
  if(wrap && dd && !wrap.contains(e.target)) dd.classList.remove('open');
  var mob = ge('an-mob'), burger = ge('an-burger');
  if(mob && burger && !mob.contains(e.target) && !burger.contains(e.target)) mob.classList.remove('open');
});

// ── OAUTH ─────────────────────────────────────────────────────
window.anestheoOAuth = async function(provider){
  if(!supa){ showErr('Authentication not available. Please refresh.'); return; }
  window.anestheoCloseModal();
  var redirect = location.hostname.includes('anestheo.com')
    ? 'https://anestheo.com/auth.html'
    : location.origin + '/auth.html';
  var { error } = await supa.auth.signInWithOAuth({ provider, options:{ redirectTo: redirect } });
  if(error){ window.anestheoOpenModal(); showErr(error.message); }
};

// ── SIGN IN ───────────────────────────────────────────────────
window.anestheoSignIn = async function(){
  // ── STEP 1: Immediate visible feedback ──────────────────────
  console.log('LOGIN BUTTON CLICKED');
  clearMsg();
  showErr('Connecting…');  // visible immediately, replaced below

  var email = mval('an-email');
  var pass  = mval('an-pass');
  email = email ? email.toLowerCase().trim() : '';
  pass  = pass  ? pass.trim() : '';

  if(!email || !email.includes('@')){
    showErr('Please enter a valid email address.');
    return;
  }
  if(!pass){
    showErr('Please enter your password.');
    return;
  }

  // ── STEP 2: Verify Supabase client exists ────────────────────
  if(!supa){
    console.error('LOGIN ERROR: supa is null - Supabase not initialized');
    showErr('Authentication not available. Please refresh the page.');
    return;
  }

  setModalBtns(true);
  setTxt('an-signin-btn', 'Signing in…');
  showErr('Trying Supabase login…');
  console.log('LOGIN START:', email);

  // ── STEP 3: Call Supabase Auth ───────────────────────────────
  var data, error;
  try {
    var result = await supa.auth.signInWithPassword({ email: email, password: pass });
    data  = result.data;
    error = result.error;
  } catch(e) {
    console.error('LOGIN EXCEPTION:', e);
    setModalBtns(false);
    setTxt('an-signin-btn', 'Sign in');
    showErr('Network error: ' + (e.message || 'unknown'));
    return;
  }

  setModalBtns(false);
  setTxt('an-signin-btn', 'Sign in');

  // ── STEP 4: Handle error ─────────────────────────────────────
  if(error){
    console.error('LOGIN ERROR:', error);
    var msg = error.message || 'Login failed';
    showErr(msg.toLowerCase().includes('invalid') ? 'Email or password incorrect.' : msg);
    return;
  }

  // ── STEP 5: Verify session ───────────────────────────────────
  console.log('LOGIN SUCCESS:', data.user.email);
  var sessionCheck = await supa.auth.getSession();
  console.log('SESSION AFTER LOGIN:', sessionCheck.data.session ? 'EXISTS' : 'NULL');

  // ── STEP 6: Redirect ─────────────────────────────────────────
  clearMsg();
  window.anestheoCloseModal();

  // Load profile then update nav — but redirect is guaranteed regardless
  try {
    await loadAndApplyAuth(data.user, false);
  } catch(e) {
    console.error('POST-LOGIN PROFILE ERROR:', e);
    // Profile failed but auth succeeded — still redirect
    window.location.href = 'index.html';
  }
};

// ── SIGN UP ───────────────────────────────────────────────────
window.anestheoSignUp = async function(){
  clearMsg();
  var email = mval('an-email').toLowerCase(), pass = mval('an-pass');
  if(!email||!email.includes('@')){ showErr('Please enter a valid email address.'); return; }
  if(!pass||pass.length<6){ showErr('Password must be at least 6 characters.'); return; }
  if(!supa){ showErr('Authentication not available. Please refresh.'); return; }

  setModalBtns(true); setTxt('an-signup-btn','Creating…');
  console.log('SIGNUP START:', email);

  var redirect = location.hostname.includes('anestheo.com')
    ? 'https://anestheo.com/auth.html'
    : location.origin + '/auth.html';

  var result;
  try { result = await supa.auth.signUp({ email, password:pass, options:{ emailRedirectTo:redirect } }); }
  catch(e){ setModalBtns(false); setTxt('an-signup-btn','Create account'); showErr('Network error. Please try again.'); return; }

  setModalBtns(false); setTxt('an-signup-btn','Create account');

  if(result.error){ showErr(result.error.message); return; }

  if(result.data.user && result.data.session){
    console.log('SIGNUP SUCCESS (immediate session):', result.data.user.email);
    window.anestheoCloseModal();
    await loadAndApplyAuth(result.data.user, true);
  } else if(result.data.user){
    showOk('&#10003; Check <strong>'+email+'</strong> for a confirmation email, then sign in.');
  } else {
    showErr('Something went wrong. Please try again.');
  }
};

// ── FORGOT PASSWORD ───────────────────────────────────────────
window.anestheoForgot = async function(){
  clearMsg();
  var email = mval('an-email').toLowerCase();
  if(!email||!email.includes('@')){ showErr('Enter your email address above first.'); return; }
  if(!supa){ showErr('Not available.'); return; }
  var { error } = await supa.auth.resetPasswordForEmail(email);
  if(error){ showErr(error.message); return; }
  showOk('&#10003; Password reset email sent to <strong>'+email+'</strong>.');
};

// ── SIGN OUT ──────────────────────────────────────────────────
window.anestheoSignOut = async function(){
  var dd = ge('an-dropdown'); if(dd) dd.classList.remove('open');
  if(supa) await supa.auth.signOut();
  localStorage.removeItem('anestheo_session');
  localStorage.removeItem('anestheo_patient_session');
  window.anestheoSession = null;
  window.anestheoProfile = null;
  setNavGuest();
  // If on a protected page, redirect home
  var page = location.pathname.split('/').pop() || 'index.html';
  var protectedPages = ['doctor.html','admin.html'];
  if(protectedPages.indexOf(page) >= 0) window.location.href = 'index.html';
};

// ── LOAD PROFILE AND APPLY AUTH STATE ─────────────────────────
async function loadAndApplyAuth(user, isNewUser){
  console.log('PROFILE FETCH START:', user.id);
  var profile = null;

  try {
    var r = await supa.from('profiles')
      .select('role,full_name,verification_status,is_admin,hospital,email')
      .eq('id', user.id)
      .maybeSingle();
    profile = r.data || null;
    console.log('PROFILE FOUND:', profile ? 'role='+profile.role : 'null');
  } catch(e){
    console.log('PROFILE FETCH FAILED:', e.message);
  }

  // Auto-create default profile for new users
  if(!profile && supa){
    try {
      var isAdmin = user.email.toLowerCase() === ADMIN_EMAIL;
      await supa.from('profiles').upsert({
        id: user.id, email: user.email,
        role: isAdmin ? 'admin' : 'pending',
        verification_status: isAdmin ? 'approved' : 'not_required',
        is_admin: isAdmin,
        updated_at: new Date().toISOString()
      });
      var r2 = await supa.from('profiles').select('role,full_name,verification_status,is_admin,hospital,email').eq('id',user.id).maybeSingle();
      profile = r2.data || null;
    } catch(e){ console.log('PROFILE CREATE FAILED:', e.message); }
  }

  window.anestheoSession = user;
  window.anestheoProfile = profile;

  setNavAuth(user, profile);

  // If new user with no profile, redirect to auth.html to choose role
  if(isNewUser && (!profile || !profile.role || profile.role === 'pending')){
    console.log('NEW USER - redirecting to auth.html for role selection');
    window.location.href = 'auth.html';
    return;
  }

  // Fire event so page-specific code can react
  document.dispatchEvent(new CustomEvent('anestheoReady', { detail:{ user, profile } }));
  renderDebugPanel(user ? {user} : null, profile);
}

// ── HIDE LOADER ───────────────────────────────────────────────
function hideLoader(){
  var l = ge('an-page-loader');
  if(!l) return;
  l.classList.add('done');
  setTimeout(function(){ if(l.parentNode) l.parentNode.removeChild(l); }, 350);
}

// ── DEBUG PANEL (remove after testing) ───────────────────────
function renderDebugPanel(session, profile){
  var existing = document.getElementById('an-debug');
  if(existing) existing.parentNode.removeChild(existing);

  var page = location.pathname.split('/').pop() || 'index.html';
  var role  = profile ? profile.role : '—';
  var verif = profile ? (profile.verification_status || '—') : '—';
  var email = session ? session.user.email : '—';
  var hasSession = !!session;

  var div = document.createElement('div');
  div.id = 'an-debug';
  div.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:9998;' +
    'background:rgba(10,20,15,0.97);border:1px solid ' + (hasSession ? 'rgba(42,138,116,.5)' : 'rgba(192,57,43,.4)') + ';' +
    'border-radius:8px;padding:10px 13px;font-size:11px;font-family:DM Sans,sans-serif;' +
    'color:rgba(255,255,255,.55);line-height:1.7;max-width:220px;' +
    'box-shadow:0 8px 24px rgba(0,0,0,.4);';
  div.innerHTML =
    '<div style="font-weight:600;color:' + (hasSession ? '#7ECFC0' : 'rgba(255,130,110,.9)') + ';margin-bottom:3px;">' +
      (hasSession ? '&#10003; Session active' : '&#10007; No session') +
    '</div>' +
    '<div>Page: ' + page + '</div>' +
    '<div>User: ' + email + '</div>' +
    '<div>Role: ' + role + '</div>' +
    '<div>Status: ' + verif + '</div>' +
    '<button onclick="this.parentNode.remove()" style="margin-top:6px;background:none;border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.3);border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer;font-family:inherit;">dismiss</button>';
  document.body.appendChild(div);
}


// ── MAIN INIT ─────────────────────────────────────────────────
async function init(){
  console.log('GLOBAL APP INIT');

  // 1. Detect current page for active nav link
  var page = location.pathname.split('/').pop() || 'index.html';

  // 2. Inject CSS + nav HTML into placeholder or top of body
  injectCSS();
  var placeholder = document.getElementById('an-nav-placeholder');
  if(placeholder){
    placeholder.outerHTML = buildNavHTML(page);
  } else {
    // Insert nav before first child of body
    var container = document.createElement('div');
    container.innerHTML = buildNavHTML(page);
    while(container.firstChild) document.body.insertBefore(container.firstChild, document.body.firstChild);
  }

  // 3. Add top padding to body so content clears the fixed nav
  if(!document.body.style.paddingTop){
    document.body.style.paddingTop = '58px';
  }

  // 4. Default: guest nav while we check session
  setNavGuest();

  // 5. Check session (Supabase reads token from localStorage at createClient time)
  if(!supa){
    console.log('SUPABASE NOT AVAILABLE');
    hideLoader();
    return;
  }

  var sessionData;
  try { sessionData = await supa.auth.getSession(); }
  catch(e){ console.log('SESSION CHECK ERROR:', e.message); hideLoader(); return; }

  var session = sessionData.data ? sessionData.data.session : null;
  console.log('SESSION FOUND:', session ? session.user.email : 'none');

  if(session){
    await loadAndApplyAuth(session.user, false);
    // Notify page-specific protected page logic
    console.log('PROTECTED PAGE AUTHORIZED');
  } else {
    // No session
    var protectedPages = ['doctor.html','admin.html'];
    if(protectedPages.indexOf(page) >= 0){
      // Redirect protected pages to homepage
      window.location.href = 'index.html';
      return;
    }
  }

  renderDebugPanel(null, null);
  hideLoader();

  // 6. Listen for auth state changes
  supa.auth.onAuthStateChange(async function(event, sess){
    console.log('AUTH EVENT:', event);
    if(event === 'SIGNED_IN'  && sess){ await loadAndApplyAuth(sess.user, false); }
    if(event === 'SIGNED_OUT'){ setNavGuest(); window.anestheoSession=null; window.anestheoProfile=null; }
  });
}

// Run after DOM is ready
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
