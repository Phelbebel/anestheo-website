#!/usr/bin/env node
/* stamp-assets.js — release cache-busting for the /v2 static site.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every page loads its shared JavaScript and CSS from stable, absolute URLs
 * (/v2/clinical-index.js, /v2/navbar.js, /v2/styles.css …). A browser or CDN
 * holding one of those files from a previous release will keep serving it
 * against newly deployed HTML. That produces a MIXED RELEASE: new HTML paired
 * with old JavaScript. It is silent — the page renders, throws nothing, and
 * simply loses whatever the new JavaScript provided.
 *
 * The fix is to make the URL itself change when we release. Every local asset
 * reference carries ?v=<release>, taken from the single VERSION file at the
 * repository root. A new release rewrites every reference at once, so the
 * browser must re-fetch the whole set together. A stale cache entry can never
 * satisfy the new release's request, because the new release asks for a
 * different URL.
 *
 * ONE version for the whole site, deliberately. Per-file hashes would cache
 * more efficiently but would let assets move independently, which is the exact
 * state we are trying to make impossible.
 *
 * USAGE
 *   node tools/stamp-assets.js           stamp every HTML page from VERSION
 *   node tools/stamp-assets.js --check   verify only; exit 1 if out of sync
 *
 * RELEASING
 *   1. edit VERSION
 *   2. node tools/stamp-assets.js
 *   3. commit the VERSION change together with the restamped HTML
 *
 * Third-party URLs (the Supabase CDN bundle, Google Fonts) are never touched:
 * they carry their own versioning and are not ours to invalidate.
 */

'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CHECK = process.argv.includes('--check');

const version = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
if (!version) { console.error('VERSION is empty'); process.exit(2); }
if (!/^[A-Za-z0-9._-]+$/.test(version)) {
  console.error('VERSION must be URL-safe ([A-Za-z0-9._-]): ' + version);
  process.exit(2);
}

/* Local application assets only: an absolute /v2/ path ending in .js or .css.
   Anything with a scheme (https:, //) is left alone by construction. */
const REF = /((?:src|href)\s*=\s*")(\/v2\/[A-Za-z0-9._-]+\.(?:js|css))(?:\?[^"]*)?(")/g;

/* A stylesheet can pull in another stylesheet without ever appearing in the
   HTML — styles.css does exactly that with point.css. Those imports are just
   as release-sensitive as a <link>, and an HTML-only sweep cannot see them. */
const CSS_IMPORT = /(@import\s+url\(\s*["']?)([A-Za-z0-9._-]+\.css)(?:\?[^"')]*)?(["']?\s*\))/g;

const files = cp.execSync('git ls-files "*.html" "*.css"', { cwd: ROOT })
  .toString().trim().split('\n').filter(Boolean);

let changed = 0, stale = [], total = 0;

for (const rel of files) {
  const file = path.join(ROOT, rel);
  const src = fs.readFileSync(file, 'utf8');
  let count = 0;
  let out = src;
  if (rel.endsWith('.html')) {
    out = out.replace(REF, (m, pre, url, post) => {
      count++;
      return pre + url + '?v=' + version + post;
    });
  } else {
    out = out.replace(CSS_IMPORT, (m, pre, url, post) => {
      count++;
      return pre + url + '?v=' + version + post;
    });
  }
  total += count;
  if (out !== src) {
    stale.push(rel);
    if (!CHECK) { fs.writeFileSync(file, out); changed++; }
  }
}
const pages = files;

if (CHECK) {
  if (stale.length) {
    console.error('OUT OF SYNC with VERSION=' + version + ' (' + stale.length + ' page(s)):');
    stale.forEach(f => console.error('  ' + f));
    console.error('Run: node tools/stamp-assets.js');
    process.exit(1);
  }
  console.log("all " + pages.length + " files stamped at v=" + version +
              ' (' + total + ' local asset references)');
} else {
  console.log('stamped v=' + version + ' across ' + pages.length + ' files, ' +
              total + ' local asset references, ' + changed + ' file(s) rewritten');
}
