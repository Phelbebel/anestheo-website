#!/usr/bin/env node
/* homepage-videos.test.js — the homepage plays Anestheo's videos on Anestheo.
 *
 * WHY THIS EXISTS
 * ---------------
 * The homepage shipped a "latest videos" section that, in production, rendered
 * "Latest videos are available on the Anestheo YouTube channel" — the AhVideos
 * fallback. It looked deliberate. It was the feed failing silently, because
 * load() collapsed every distinct failure into the same null and the caller had
 * no way to tell a missing API key from an undeployed function.
 *
 * These tests hold three things that were not held before:
 *   1. given a valid feed, the page produces REAL youtube-nocookie embed URLs
 *      built from the IDs the feed returned, and no others;
 *   2. no ID is ever invented — a broken feed produces no player at all;
 *   3. each distinct failure is reported as itself, not as silence.
 *
 * The feed is stubbed at the network boundary, so what is under test is the
 * page's own rendering, not the Edge Function. Whether PRODUCTION returns real
 * videos is a separate question these tests cannot answer and do not claim to.
 */
const { chromium } = require('/home/user/anestheo-website/node_modules/playwright');
const fs = require('fs');
const MOCK = fs.readFileSync(process.env.NB_MOCK || '/tmp/adm/mock.js', 'utf8');
const BASE = process.env.NB_BASE || 'http://127.0.0.1:8890';

let pass = 0, fail = 0;
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 150);
const t = (n, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(62) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(62) + ' ' + fmt(d)); }
};

/* Shaped exactly like youtube-latest's success response. */
const FEED = [
  { id: 'dQw4w9WgXcQ', title: 'What happens during general anesthesia', description: 'A clear walkthrough of what an anesthesiologist does from the moment you enter theatre.', published: '2026-07-02T10:00:00Z', views: 14200, duration: '6:12' },
  { id: 'kJQP7kiw5Fk', title: 'Spinal anesthesia for a caesarean, explained', description: 'How a spinal works, what you will feel, and why you stay awake.', published: '2026-06-18T10:00:00Z', views: 8300, duration: '8:41' },
  { id: '9bZkp7q19f0', title: 'Fasting before surgery: what and when', published: '2026-06-02T10:00:00Z', views: 22100, duration: '4:55' },
  { id: 'M7lc1UVf-VE', title: 'A fourth video the homepage must not show', published: '2026-05-02T10:00:00Z' }
];

async function open(b, width, feed) {
  const ctx = await b.newContext({ viewport: { width, height: width < 500 ? 844 : 1000 } });
  const logs = [];
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (/cdn\.jsdelivr|unpkg/.test(u)) return r.fulfill({ status: 200, contentType: 'text/javascript', body: MOCK });
    if (/googleapis|gstatic/.test(u))  return r.fulfill({ status: 200, contentType: 'text/css', body: '' });
    /* A player must never actually be fetched in a test run. */
    if (/youtube-nocookie|youtube\.com|ytimg/.test(u))
      return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' });
    if (/youtube-latest/.test(u)) return feed(r);
    return r.continue();
  });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => { const m = (e && e.message) || String(e); if (m !== 'Object') errs.push(m.slice(0, 140)); });
  pg.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') logs.push(m.text()); });
  await pg.addInitScript('window.__TEST_PROFILE=null;window.__TEST_ROLE="anon";' +
                         'window.__TEST_HARDENED=true;window.__TEST_ONBOARD=true;');
  await pg.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1800);
  return { ctx, pg, errs, logs };
}

const ok = r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FEED) });

const readVideos = pg => pg.evaluate(() => {
  const host = document.getElementById('home-videos');
  const frames = [...host.querySelectorAll('iframe')];
  return {
    players: frames.length,
    srcs:    frames.map(f => f.getAttribute('src')),
    lazy:    frames.every(f => f.getAttribute('loading') === 'lazy'),
    fs:      frames.every(f => f.hasAttribute('allowfullscreen')),
    titled:  frames.every(f => (f.getAttribute('title') || '').length > 3),
    autoplay: frames.some(f => /autoplay=1/.test(f.getAttribute('src') || '')),
    ratios:  frames.map(f => { const r = f.getBoundingClientRect();
                               return r.width > 0 ? +(r.width / r.height).toFixed(2) : 0; }),
    titles:  [...host.querySelectorAll('.ahv-emb-title')].map(e => e.textContent.trim()),
    down:    !!host.querySelector('.ahv-down'),
    reason:  (host.querySelector('.ahv-down') || {}).getAttribute
               ? host.querySelector('.ahv-down').getAttribute('data-reason') : null
  };
});

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  /* ── 1 · real IDs in, real embeds out ─────────────────────────────────── */
  console.log('\n── a working feed produces real embeds ──');
  {
    const { ctx, pg, errs } = await open(b, 1440, ok);
    const v = await readVideos(pg);
    t('three players, not four', v.players === 3, v.players);
    t('every src is a youtube-nocookie embed',
      v.srcs.every(s => s.startsWith('https://www.youtube-nocookie.com/embed/')), v.srcs[0]);
    /* Videos 2, 3 and 4. The newest is featured in the hero, so this section
       deliberately starts after it and the page never repeats a video. */
    t('the embed IDs are the feed\'s SECOND, third and fourth, in order',
      JSON.stringify(v.srcs.map(s => s.split('/embed/')[1].split('?')[0])) ===
      JSON.stringify(FEED.slice(1, 4).map(x => x.id)),
      v.srcs.map(s => s.split('/embed/')[1].split('?')[0]));
    t('the NEWEST video is not repeated here', !v.srcs.some(s => s.includes(FEED[0].id)));
    t('real titles are shown beside the players',
      JSON.stringify(v.titles) === JSON.stringify(FEED.slice(1, 4).map(x => x.title)), v.titles);
    t('every player is lazy', v.lazy === true);
    t('every player allows fullscreen', v.fs === true);
    t('every player carries its title for assistive tech', v.titled === true);
    t('nothing autoplays', v.autoplay === false);
    t('players are 16:9', v.ratios.every(r => Math.abs(r - 16 / 9) < 0.06), v.ratios);
    t('no fallback card is shown', v.down === false);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }

  /* ── 2 · one video per row on a phone ─────────────────────────────────── */
  console.log('\n── layout ──');
  for (const [label, width, cols] of [['iPhone 390', 390, 1], ['iPad portrait', 834, 2], ['desktop', 1440, 3]]) {
    const { ctx, pg } = await open(b, width, ok);
    const g = await pg.evaluate(() => {
      const grid = document.querySelector('#home-videos .ahv-emb-grid');
      return { cols: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
               doc: document.documentElement.scrollWidth, win: window.innerWidth };
    });
    t(label + ': ' + cols + ' per row', g.cols === cols, g.cols);
    t(label + ': no horizontal overflow', g.doc <= g.win, g);
    await ctx.close();
  }

  /* ── 3 · a broken feed never invents a video ──────────────────────────── */
  console.log('\n── failure is reported, never faked ──');
  const BROKEN = {
    'missing API key':   r => r.fulfill({ status:200, contentType:'application/json', body:'{"error":"not_configured"}' }),
    'YouTube API error': r => r.fulfill({ status:200, contentType:'application/json', body:'{"error":"youtube channels 403"}' }),
    'empty list':        r => r.fulfill({ status:200, contentType:'application/json', body:'[]' }),
    'function not deployed': r => r.fulfill({ status:404, contentType:'text/plain', body:'Function not found' }),
    'network failure':   r => r.abort('failed')
  };
  for (const [name, feed] of Object.entries(BROKEN)) {
    const { ctx, pg, logs } = await open(b, 1440, feed);
    const v = await readVideos(pg);
    t(name + ': no player rendered', v.players === 0, v.players);
    t(name + ': the page says the feed failed', v.down === true);
    t(name + ': a retry is offered',
      await pg.evaluate(() => !!document.querySelector('#home-videos [data-ahv-retry]')));
    t(name + ': the real reason is logged, not swallowed',
      logs.some(l => /\[AhVideos\]/.test(l)), logs.filter(l => /AhVideos/.test(l))[0]);
    t(name + ': the reason is on the element for a live page', !!v.reason, v.reason);
    await ctx.close();
  }

  /* ── 3b · the hero features the newest, the section starts at the second ─
     The two must never print the same video on one page. */
  console.log('\n── hero featured video ──');
  {
    const { ctx, pg } = await open(b, 1440, ok);
    const v = await pg.evaluate(() => {
      const id = el => [...el.querySelectorAll('iframe')]
        .map(f => (f.getAttribute('src')||'').split('/embed/')[1].split('?')[0]);
      return {
        hero:  id(document.getElementById('hero-video')),
        lower: id(document.getElementById('home-videos')),
        title: (document.querySelector('#hero-video .ahv-feat-title')||{}).textContent,
        desc:  !!document.querySelector('#hero-video .ahv-feat-desc'),
        passportStillThere: !!document.querySelector('.hero-art .pass')
      };
    });
    t('the hero features exactly one video', v.hero.length === 1, v.hero);
    t('...and it is the NEWEST', v.hero[0] === FEED[0].id, v.hero[0]);
    t('...with its real title', v.title === FEED[0].title, v.title);
    t('...and its description', v.desc === true);
    t('the section below starts at the SECOND video',
      v.lower[0] === FEED[1].id, v.lower[0]);
    t('nothing appears twice on the page',
      v.hero.concat(v.lower).length === new Set(v.hero.concat(v.lower)).size,
      v.hero.concat(v.lower));
    t('the Health Passport card is untouched', v.passportStillThere === true);
    await ctx.close();
  }

  /* ── 3c · mobile stacking: copy, passport, video ─────────────────────── */
  {
    const { ctx, pg } = await open(b, 390, ok);
    const o = await pg.evaluate(() => {
      const top = sel => Math.round(document.querySelector(sel).getBoundingClientRect().top + scrollY);
      return { copy: top('.hero-copy'), pass: top('.hero-art'), vid: top('.hero-vid') };
    });
    t('@390 the order is copy, then passport, then video',
      o.copy < o.pass && o.pass < o.vid, o);
    await ctx.close();
  }

  /* ── 3d · the public navigation ──────────────────────────────────────── */
  {
    const { ctx, pg } = await open(b, 1440, ok);
    const nav = await pg.evaluate(() =>
      [...document.querySelectorAll('.mast .nav-r a')].map(a => a.textContent.trim()));
    const login = await pg.evaluate(() => !!document.getElementById('nav-login'));
    t('visitor nav is Home, For Patients, Videos, For Clinicians',
      JSON.stringify(nav) === JSON.stringify(['Home','For Patients','Videos','For Clinicians']), nav);
    t('...with Login beside it', login === true);
    await ctx.close();
  }

  /* ── 4 · the hero cleanup, and prose dashes ───────────────────────────── */
  console.log('\n── hero and prose ──');
  {
    const { ctx, pg } = await open(b, 390, ok);
    const h = await pg.evaluate(() => {
      const eb = document.querySelector('.hero-eyebrow');
      const before = eb ? getComputedStyle(eb, '::before').content : 'none';
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let vis = '', node;
      while (node = w.nextNode()) {
        const p = node.parentElement;
        if (!p || p.closest('script,style,noscript')) continue;
        if (p.getClientRects().length) vis += node.nodeValue;
      }
      return {
        rule: before,
        marks: document.querySelectorAll('.hero-marks').length,
        pills: ['Personalized preparation', 'Health Passport', 'Patient education']
                 .filter(x => [...document.querySelectorAll('.hero li, .hero-marks li')]
                   .some(li => li.textContent.trim() === x)),
        emdash: (vis.match(/—/g) || []).length,
        heroH: Math.round(document.querySelector('.hero').getBoundingClientRect().height)
      };
    });
    t('no decorative rule before the eyebrow', h.rule === 'none' || h.rule === '', h.rule);
    t('the hero-marks group is gone', h.marks === 0, h.marks);
    t('none of the three pills remain', h.pills.length === 0, h.pills);
    t('no em dash in visible prose', h.emdash === 0, h.emdash);
    console.log('       hero height @390: ' + h.heroH + 'px');
    await ctx.close();
  }

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
