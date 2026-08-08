#!/usr/bin/env node
/* stamp-assets.js — release cache-busting for the Anestheo static site.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every page loads its shared JavaScript and CSS from stable, absolute URLs
 * (/clinical-index.js, /navbar.js, /styles.css …). A browser or CDN
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

/* Local application assets only: a root-absolute path ending in .js or .css.
   The site is served from the document root, so a local asset is "/name.js".
   Anything with a scheme is excluded by construction: "https://…" does not
   start with a single slash, and a protocol-relative "//host/x.js" is rejected
   because the character after the leading slash may not itself be a slash. */
const REF = /((?:src|href)\s*=\s*")(\/[A-Za-z0-9._-]+\.(?:js|css))(?:\?[^"]*)?(")/g;

/* A stylesheet can pull in another stylesheet without ever appearing in the
   HTML — styles.css does exactly that with point.css. Those imports are just
   as release-sensitive as a <link>, and an HTML-only sweep cannot see them. */
const CSS_IMPORT = /(@import\s+url\(\s*["']?)([A-Za-z0-9._-]+\.css)(?:\?[^"')]*)?(["']?\s*\))/g;

const files = cp.execSync('git ls-files "*.html" "*.css"', { cwd: ROOT })
  .toString().trim().split('\n').filter(Boolean);

let changed = 0, stale = [], total = 0, matchedFiles = 0;

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
  if (count > 0) matchedFiles++;
  if (out !== src) {
    stale.push(rel);
    if (!CHECK) { fs.writeFileSync(file, out); changed++; }
  }
}
const pages = files;

/* SANITY FLOOR — the reason this exists.
 *
 * The matcher is a regular expression tied to the shape of a local asset URL.
 * When the site moved from /v2/ to the document root, that shape changed. A
 * matcher that no longer matches anything does not fail: it rewrites nothing,
 * finds nothing stale, and --check exits 0 with a cheerful message. The tool
 * would report success precisely when it had stopped protecting anything.
 *
 * So a run that matched nothing, or noticeably less than the site is known to
 * contain, is treated as a broken tool rather than a clean release. These
 * numbers are the floor observed at the root cutover; raise them when the site
 * genuinely grows, and investigate before ever lowering them.
 */
const MIN_FILES = 50;   // HTML pages + CSS carrying at least one local asset
const MIN_REFS  = 280;  // local asset references across those files

if (total < MIN_REFS || matchedFiles < MIN_FILES) {
  console.error('SANITY CHECK FAILED — the asset matcher is not seeing the site.');
  console.error('  matched references:   ' + total + ' (expected at least ' + MIN_REFS + ')');
  console.error('  files with a match:   ' + matchedFiles + ' (expected at least ' + MIN_FILES + ')');
  console.error('  files scanned:        ' + pages.length);
  console.error('This normally means the asset URL shape changed and REF/CSS_IMPORT');
  console.error('no longer match it. Cache-busting is NOT in effect. Fix the matcher.');
  process.exit(3);
}

if (CHECK) {
  if (stale.length) {
    console.error('OUT OF SYNC with VERSION=' + version + ' (' + stale.length + ' page(s)):');
    stale.forEach(f => console.error('  ' + f));
    console.error('Run: node tools/stamp-assets.js');
    process.exit(1);
  }
  console.log('all ' + matchedFiles + ' asset-carrying files stamped at v=' + version +
              ' (' + total + ' local asset references, ' + pages.length + ' files scanned)');
} else {
  console.log('stamped v=' + version + ' across ' + matchedFiles + ' asset-carrying files, ' +
              total + ' local asset references, ' + changed + ' file(s) rewritten');
}
