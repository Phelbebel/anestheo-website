// ============================================================
// videos-data.js — ONE client source of truth for the official Anestheo
// YouTube videos. Data is served by the existing Supabase Edge Function
// `youtube-latest` (the YouTube Data API key stays server-side in Supabase
// secrets; nothing sensitive is exposed here). Both the Doctor Home and the
// Videos page use this file so thumbnails, titles, URLs and dates come from a
// single place and update automatically when new videos are published.
//
// The function returns the channel's latest UPLOADS as one feed. It does NOT
// classify videos by audience (clinician vs patient) — see the report. We do
// not fabricate an audience label; a real "Latest videos" feed is shown.
// ============================================================
(function(){
  var CHANNEL = '@anestheo';                 // resolved from the site's existing channel link
  var PROXY   = '/functions/v1/youtube-latest';
  var _cache  = null;                        // per-page-session cache (avoid refetch)

  function supaBase(){ return (typeof SUPA_URL  !== 'undefined' && SUPA_URL)  ? SUPA_URL  : (window.SUPA_URL  || ''); }
  function supaAnon(){ return (typeof SUPA_ANON !== 'undefined' && SUPA_ANON) ? SUPA_ANON : (window.SUPA_ANON || ''); }
  function channelUrl(){ return 'https://www.youtube.com/' + (CHANNEL.charAt(0)==='@' ? CHANNEL : '@'+CHANNEL); }
  function watchUrl(id){ return 'https://www.youtube.com/watch?v=' + encodeURIComponent(id); }
  function thumbUrl(v){ return v.thumb || ('https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg'); }
  function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function fmtDate(iso){ try{ return new Date(iso).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}); }catch(e){ return ''; } }
  function fmtViews(n){ n=+n||0; if(n<=0) return ''; if(n>=1e6) return (n/1e6).toFixed(n>=1e7?0:1).replace(/\.0$/,'')+'M views'; if(n>=1e3) return (n/1e3).toFixed(n>=1e4?0:1).replace(/\.0$/,'')+'K views'; return n+' views'; }

  // Returns Promise<array|null>. null = not configured / unavailable -> caller shows the channel fallback.
  function load(max){
    if(_cache) return Promise.resolve(_cache);
    var b = supaBase(); if(!b) return Promise.resolve(null);
    var a = supaAnon();
    return fetch(b + PROXY + '?channel=' + encodeURIComponent(CHANNEL) + '&max=' + (max||6),
        { headers: a ? { apikey:a, 'Authorization':'Bearer '+a } : {} })
      .then(function(r){ if(!r.ok) return null; return r.json(); })
      .then(function(data){ if(!Array.isArray(data)) return null; _cache = data.filter(function(v){ return v && v.id; }); return _cache; })
      .catch(function(){ return null; });
  }

  function injectCSS(){
    if(document.getElementById('ahv-css')) return;
    var s = document.createElement('style'); s.id='ahv-css';
    s.textContent = ''
      + '.ahv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;}'
      + '.ahv-card{display:flex;flex-direction:column;border:1px solid rgba(27,107,90,.22);border-radius:14px;overflow:hidden;'
      +   'background:rgba(255,255,255,.03);color:#fff;text-decoration:none;transition:transform .26s cubic-bezier(.2,.7,.2,1),border-color .26s;}'
      + '.ahv-card:hover{transform:translateY(-2px);border-color:rgba(126,207,192,.4);}'
      + '.ahv-thumb{position:relative;aspect-ratio:16/9;background:#0c1a15;overflow:hidden;}'
      + '.ahv-thumb img{width:100%;height:100%;object-fit:cover;display:block;}'
      + '.ahv-play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:26px;color:rgba(255,255,255,.92);text-shadow:0 2px 10px rgba(0,0,0,.55);}'
      + '.ahv-ext{position:absolute;top:7px;right:7px;display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;letter-spacing:.02em;'
      +   'background:rgba(0,0,0,.6);color:#fff;border-radius:6px;padding:2px 6px;}'
      + '.ahv-dur{position:absolute;bottom:7px;right:7px;font-size:11px;font-weight:700;background:rgba(0,0,0,.75);color:#fff;border-radius:5px;padding:1px 6px;}'
      + '.ahv-meta{padding:10px 12px 12px;}'
      + '.ahv-title{font-size:13px;font-weight:700;line-height:1.32;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}'
      + '.ahv-sub{font-size:11px;color:rgba(255,255,255,.5);margin-top:5px;}'
      + '.ahv-skel{aspect-ratio:16/9;border:1px solid rgba(27,107,90,.22);border-radius:14px;'
      +   'background:linear-gradient(100deg,rgba(255,255,255,.03) 30%,rgba(255,255,255,.07) 50%,rgba(255,255,255,.03) 70%);background-size:220% 100%;animation:ahvskel 1.3s linear infinite;}'
      + '@keyframes ahvskel{to{background-position:-220% 0;}}'
      + '@media(prefers-reduced-motion:reduce){.ahv-card{transition:none;}.ahv-skel{animation:none;}}'
      + '.ahv-fallback{display:flex;align-items:center;gap:13px;flex-wrap:wrap;border:1px solid rgba(27,107,90,.22);border-radius:14px;'
      +   'background:rgba(255,255,255,.03);padding:15px 17px;}'
      + '.ahv-fb-ic{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;'
      +   'background:rgba(126,207,192,.1);border:1px solid rgba(27,107,90,.22);flex:0 0 auto;}'
      + '.ahv-fb-tx{font-size:13px;color:rgba(255,255,255,.72);flex:1;min-width:180px;}'
      + '.ahv-fb-btn{margin-left:auto;font-size:12.5px;font-weight:700;color:#06140f;background:#7ECFC0;border-radius:9px;padding:9px 14px;text-decoration:none;white-space:nowrap;}'
      + '.ahv-fb-btn:hover{background:#9be0d3;}';
    document.head.appendChild(s);
  }

  function card(v){
    var meta = [ v.published ? fmtDate(v.published) : '', fmtViews(v.views) ].filter(Boolean).join(' · ');
    return '<a class="ahv-card" href="' + watchUrl(v.id) + '" target="_blank" rel="noopener">'
      + '<div class="ahv-thumb"><img src="' + esc(thumbUrl(v)) + '" alt="" loading="lazy">'
      +   '<span class="ahv-play">▶</span>'
      +   '<span class="ahv-ext">YouTube ↗</span>'
      +   (v.duration ? '<span class="ahv-dur">' + esc(v.duration) + '</span>' : '')
      + '</div>'
      + '<div class="ahv-meta"><div class="ahv-title">' + esc(v.title) + '</div>'
      +   (meta ? '<div class="ahv-sub">' + esc(meta) + '</div>' : '')
      + '</div></a>';
  }

  function fallback(){
    return '<div class="ahv-fallback"><span class="ahv-fb-ic">▶</span>'
      + '<span class="ahv-fb-tx">Latest videos are available on the Anestheo YouTube channel.</span>'
      + '<a class="ahv-fb-btn" href="' + channelUrl() + '" target="_blank" rel="noopener">Watch on YouTube ↗</a></div>';
  }

  // Render into a host element: subtle skeletons -> real cards, or a compact
  // channel fallback (never fabricated cards). opts.max caps how many show.
  function mount(host, opts){
    if(!host) return;
    opts = opts || {}; injectCSS();
    var n = opts.skeleton || 3;
    var sk = ''; for(var i=0;i<n;i++){ sk += '<div class="ahv-skel"></div>'; }
    host.innerHTML = '<div class="ahv-grid">' + sk + '</div>';
    load(opts.max || 6).then(function(vids){
      if(!vids || !vids.length){ host.innerHTML = fallback(); return; }
      if(opts.max) vids = vids.slice(0, opts.max);
      host.innerHTML = '<div class="ahv-grid">' + vids.map(card).join('') + '</div>';
    }).catch(function(){ host.innerHTML = fallback(); });
  }

  window.AhVideos = { load:load, mount:mount, channelUrl:channelUrl, watchUrl:watchUrl, thumbUrl:thumbUrl, fmtDate:fmtDate, CHANNEL:CHANNEL };
})();
