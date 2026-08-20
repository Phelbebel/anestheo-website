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
  var _lastError = null;                     // why the feed is unavailable, for whoever must fix it

  function supaBase(){ return (typeof SUPA_URL  !== 'undefined' && SUPA_URL)  ? SUPA_URL  : (window.SUPA_URL  || ''); }
  function supaAnon(){ return (typeof SUPA_ANON !== 'undefined' && SUPA_ANON) ? SUPA_ANON : (window.SUPA_ANON || ''); }
  function channelUrl(){ return 'https://www.youtube.com/' + (CHANNEL.charAt(0)==='@' ? CHANNEL : '@'+CHANNEL); }
  function watchUrl(id){ return 'https://www.youtube.com/watch?v=' + encodeURIComponent(id); }
  function thumbUrl(v){ return v.thumb || ('https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg'); }
  function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function fmtDate(iso){ try{ return new Date(iso).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}); }catch(e){ return ''; } }
  function fmtViews(n){ n=+n||0; if(n<=0) return ''; if(n>=1e6) return (n/1e6).toFixed(n>=1e7?0:1).replace(/\.0$/,'')+'M views'; if(n>=1e3) return (n/1e3).toFixed(n>=1e4?0:1).replace(/\.0$/,'')+'K views'; return n+' views'; }

  /* Returns Promise<array|null>. null means the feed is unavailable and the
     caller shows the channel fallback.

     WHY THE REASON IS KEPT. This used to collapse every distinct failure into
     the same null: a missing YOUTUBE_API_KEY secret, a restricted key, an
     undeployed function, a channel handle that no longer resolves. The Edge
     Function deliberately answers 200 with { error: … } so it can never break
     a page, and this turned that answer into silence. The homepage then showed
     a generic 'available on YouTube' card and nobody could tell why.

     AhVideos.lastError now holds the real reason, it is logged once, and the
     fallback can say what happened. Nothing about it reaches a visitor as
     jargon; it is for whoever has to fix it. */
  function load(max){
    if(_cache) return Promise.resolve(_cache);
    var b = supaBase();
    if(!b){ return Promise.resolve(fail('no-supabase-url', 'SUPA_URL is not set on this page')); }
    var a = supaAnon();
    var url = b + PROXY + '?channel=' + encodeURIComponent(CHANNEL) + '&max=' + (max||6);
    return fetch(url, { headers: a ? { apikey:a, 'Authorization':'Bearer '+a } : {} })
      .then(function(r){
        if(!r.ok) return r.text().then(function(t){
          return fail('http-' + r.status, 'youtube-latest returned HTTP ' + r.status + ' ' + (t||'').slice(0,200)); });
        return r.json().then(function(data){
          /* The function's own error shape: 200 with { error }. Surface it. */
          if(data && !Array.isArray(data) && data.error)
            return fail('function-error', 'youtube-latest reported: ' + data.error);
          if(!Array.isArray(data))
            return fail('bad-shape', 'youtube-latest did not return an array');
          var vids = data.filter(function(v){ return v && v.id; });
          if(!vids.length)
            return fail('empty', 'youtube-latest returned an empty list (channel handle may not resolve)');
          _lastError = null; _cache = vids; return _cache;
        });
      })
      .catch(function(e){ return fail('network', String((e && e.message) || e)); });
  }

  function fail(code, detail){
    _lastError = { code: code, detail: detail, at: new Date().toISOString(), endpoint: PROXY };
    try { console.warn('[AhVideos] latest videos unavailable (' + code + '): ' + detail); } catch(_){}
    return null;
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


  /* ── EMBEDDED PLAYERS ────────────────────────────────────────────────────
     The homepage plays Anestheo's videos on Anestheo. A card that links out
     to YouTube is a link to somewhere else; this is the product showing its
     own work.

     youtube-nocookie.com is the privacy-enhanced host: it sets no tracking
     cookie until the visitor actually presses play. No autoplay, ever, on a
     page someone did not ask to make noise. loading="lazy" so three players
     below the fold cost nothing on a phone until they are scrolled to.

     IDs come from the feed and nowhere else. There is no placeholder video
     and no fabricated ID: if the feed is unavailable this renders the reason
     and a way to retry, not an invented card. */
  function embedUrl(id){
    return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) +
           '?rel=0&modestbranding=1&playsinline=1';
  }

  function embedCard(v){
    var meta = [ v.published ? fmtDate(v.published) : '', fmtViews(v.views) ].filter(Boolean).join(' · ');
    return '<div class="ahv-emb">' +
      '<div class="ahv-emb-frame">' +
        '<iframe src="' + esc(embedUrl(v.id)) + '" title="' + esc(v.title || 'Anestheo video') + '" ' +
          'loading="lazy" referrerpolicy="strict-origin-when-cross-origin" ' +
          'allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ' +
          'allowfullscreen></iframe>' +
      '</div>' +
      '<div class="ahv-emb-meta">' +
        '<div class="ahv-emb-title">' + esc(v.title || '') + '</div>' +
        (meta ? '<div class="ahv-emb-sub">' + esc(meta) + '</div>' : '') +
      '</div></div>';
  }

  function embedCSS(){
    if(document.getElementById('ahv-emb-css')) return;
    var s = document.createElement('style'); s.id = 'ahv-emb-css';
    s.textContent = ''
      /* Three across while each player is still wide enough to read a title
         under; two, then one, as it stops being. */
      + '.ahv-emb-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;}'
      + '@media(max-width:900px){.ahv-emb-grid{grid-template-columns:repeat(2,1fr);gap:14px;}}'
      + '@media(max-width:620px){.ahv-emb-grid{grid-template-columns:1fr;gap:16px;}}'
      + '.ahv-emb{display:flex;flex-direction:column;}'
      + '.ahv-emb-frame{position:relative;aspect-ratio:16/9;border-radius:14px;overflow:hidden;'
      +   'background:#08111A;border:1px solid rgba(255,255,255,.09);}'
      + '.ahv-emb-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block;}'
      + '.ahv-emb-meta{padding:11px 2px 0;}'
      + '.ahv-emb-title{font-size:14px;font-weight:650;line-height:1.35;color:#F2F6F8;'
      +   'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}'
      + '.ahv-emb-sub{font-size:12px;color:#93A6B4;margin-top:4px;}'
      + '.ahv-emb-skel{aspect-ratio:16/9;border-radius:14px;border:1px solid rgba(255,255,255,.09);'
      +   'background:linear-gradient(100deg,rgba(255,255,255,.03) 30%,rgba(255,255,255,.07) 50%,rgba(255,255,255,.03) 70%);'
      +   'background-size:220% 100%;animation:ahvskel 1.3s linear infinite;}'
      + '@media(prefers-reduced-motion:reduce){.ahv-emb-skel{animation:none;}}'
      /* Degradation, not disguise: it says the feed is unavailable, offers a
         retry, and keeps the channel as the last resort. */
      + '.ahv-down{border:1px solid rgba(255,255,255,.09);border-radius:14px;'
      +   'background:rgba(255,255,255,.03);padding:20px 22px;}'
      + '.ahv-down-t{font-size:14.5px;font-weight:650;color:#F2F6F8;}'
      + '.ahv-down-s{font-size:13px;color:#93A6B4;margin-top:6px;line-height:1.6;}'
      + '.ahv-down-a{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;}'
      + '.ahv-down-a button,.ahv-down-a a{font-size:13px;font-weight:650;border-radius:10px;'
      +   'padding:10px 16px;cursor:pointer;text-decoration:none;font-family:inherit;'
      +   'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.16);color:#F2F6F8;}'
      + '.ahv-down-a button:hover,.ahv-down-a a:hover{border-color:rgba(126,207,192,.55);}';
    document.head.appendChild(s);
  }

  /* Patient-facing copy. Whoever is reading this came for anesthesia
     education, not for an incident report: they get one plain sentence and a
     way to try again. The reason lives in the console and on the element, for
     whoever has to fix it. */
  function down(host, opts){
    var e = _lastError || {};
    var remount = (opts && opts.render) || mountEmbeds;
    host.innerHTML = '<div class="ahv-down">' +
      '<div class="ahv-down-t">We couldn\'t load the latest videos right now</div>' +
      '<div class="ahv-down-s">Please try again in a moment.</div>' +
      '<div class="ahv-down-a">' +
        '<button type="button" data-ahv-retry="1">Try again</button>' +
      '</div></div>';
    var btn = host.querySelector('[data-ahv-retry]');
    if(btn) btn.addEventListener('click', function(){
      _cache = null; _lastError = null; remount(host, opts);
    });
    if(e.code) host.firstChild.setAttribute('data-reason', e.code + ': ' + (e.detail||''));
  }

  /* Render real, playable videos into a host element.
       opts.max   how many to show
       opts.skip  how many of the newest to leave out, so a page can feature
                  the latest above and list the ones after it below without
                  printing the same video twice. */
  function mountEmbeds(host, opts){
    if(!host) return;
    opts = opts || {}; embedCSS();
    var n = opts.max || 3, skip = opts.skip || 0;
    var sk = ''; for(var i=0;i<n;i++){ sk += '<div class="ahv-emb-skel"></div>'; }
    host.innerHTML = '<div class="ahv-emb-grid">' + sk + '</div>';
    load(Math.max(n + skip, 6)).then(function(vids){
      var show = vids ? vids.slice(skip, skip + n) : [];
      if(!show.length){ down(host, Object.assign({ render: mountEmbeds }, opts)); return; }
      host.innerHTML = '<div class="ahv-emb-grid">' + show.map(embedCard).join('') + '</div>';
    }).catch(function(e){
      fail('render', String((e && e.message) || e));
      down(host, Object.assign({ render: mountEmbeds }, opts));
    });
  }

  /* ── ONE FEATURED VIDEO ──────────────────────────────────────────────────
     The newest upload, played large, with its title and the opening line of
     its own description underneath. Used in the homepage hero beneath the
     Health Passport, and at the top of the videos page.

     opts.index   which video to feature (0 = newest, the default)
     opts.compact tighter type, for the narrower hero column */
  function featuredCard(v, compact){
    var meta = [ v.published ? fmtDate(v.published) : '', fmtViews(v.views) ].filter(Boolean).join(' · ');
    return '<div class="ahv-feat' + (compact ? ' compact' : '') + '">' +
      '<div class="ahv-emb-frame">' +
        '<iframe src="' + esc(embedUrl(v.id)) + '" title="' + esc(v.title || 'Anestheo video') + '" ' +
          'loading="lazy" referrerpolicy="strict-origin-when-cross-origin" ' +
          'allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ' +
          'allowfullscreen></iframe>' +
      '</div>' +
      '<div class="ahv-feat-meta">' +
        '<div class="ahv-feat-title">' + esc(v.title || '') + '</div>' +
        (v.description ? '<p class="ahv-feat-desc">' + esc(v.description) + '</p>' : '') +
        (meta ? '<div class="ahv-emb-sub">' + esc(meta) + '</div>' : '') +
      '</div></div>';
  }

  function featCSS(){
    if(document.getElementById('ahv-feat-css')) return;
    var s = document.createElement('style'); s.id = 'ahv-feat-css';
    s.textContent = ''
      + '.ahv-feat{display:flex;flex-direction:column;}'
      + '.ahv-feat-meta{padding:14px 2px 0;}'
      + '.ahv-feat-title{font-size:19px;font-weight:650;line-height:1.3;letter-spacing:-.01em;color:#F2F6F8;}'
      + '.ahv-feat-desc{font-size:14.5px;line-height:1.65;color:#93A6B4;margin-top:8px;'
      +   'display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}'
      + '.ahv-feat.compact .ahv-feat-meta{padding-top:12px;}'
      + '.ahv-feat.compact .ahv-feat-title{font-size:15.5px;}'
      + '.ahv-feat.compact .ahv-feat-desc{font-size:13px;-webkit-line-clamp:2;margin-top:6px;}'
      + '.ahv-feat-skel{aspect-ratio:16/9;border-radius:14px;border:1px solid rgba(255,255,255,.09);'
      +   'background:linear-gradient(100deg,rgba(255,255,255,.03) 30%,rgba(255,255,255,.07) 50%,rgba(255,255,255,.03) 70%);'
      +   'background-size:220% 100%;animation:ahvskel 1.3s linear infinite;}'
      + '@media(prefers-reduced-motion:reduce){.ahv-feat-skel{animation:none;}}'
      + '@media(max-width:620px){.ahv-feat-title{font-size:17px;}.ahv-feat-desc{font-size:14px;}}';
    document.head.appendChild(s);
  }

  function mountFeatured(host, opts){
    if(!host) return;
    opts = opts || {}; embedCSS(); featCSS();
    var idx = opts.index || 0;
    host.innerHTML = '<div class="ahv-feat-skel"></div>';
    load(Math.max(idx + 1, 6)).then(function(vids){
      var v = vids && vids[idx];
      if(!v){ down(host, Object.assign({ render: mountFeatured }, opts)); return; }
      host.innerHTML = featuredCard(v, !!opts.compact);
    }).catch(function(e){
      fail('render', String((e && e.message) || e));
      down(host, Object.assign({ render: mountFeatured }, opts));
    });
  }

  window.AhVideos = { load:load, mount:mount, mountEmbeds:mountEmbeds,
                     mountFeatured:mountFeatured, embedUrl:embedUrl,
                     channelUrl:channelUrl, watchUrl:watchUrl, thumbUrl:thumbUrl, fmtDate:fmtDate,
                     CHANNEL:CHANNEL,
                     get lastError(){ return _lastError; } };
})();
