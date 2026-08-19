#!/usr/bin/env node
/* check-tokens.js — every var(--x) on every page must resolve to a definition.
 *
 * WHY THIS EXISTS
 * ---------------
 * An undefined custom property does not fail loudly. `color: var(--hint)` on a
 * page that never defines --hint is invalid at computed-value time: the
 * declaration is simply dropped and the element inherits instead. The page
 * still renders, still passes every functional test, and is quietly the wrong
 * colour. The navigation bar shipped exactly that bug — three rules reading a
 * token that only some pages defined.
 *
 * Now that colour, radius and spacing live in tokens.css instead of in each
 * page, that failure mode gets easier to hit: a page can reference the shared
 * vocabulary without loading it. This checks the whole site for it.
 *
 * A page "has" a token if it defines it in its own <style>, or if it links a
 * stylesheet that defines it (styles.css pulls in tokens.css and point.css).
 * Tokens injected by navbar.js are namespaced --nb-* and checked separately.
 *
 * USAGE
 *   node tools/check-tokens.js        exit 1 and list every unresolved token
 */

'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EXCLUDE = /^(v1-source|deploy)\//;

function defsIn(css) {
  const out = new Set();
  let m, re = /(--[A-Za-z0-9_-]+)\s*:/g;
  while ((m = re.exec(css))) out.add(m[1]);
  return out;
}
/* Only bare references are checked. `var(--mx, 82%)` states its own answer for
   the case where nothing defines --mx — that is a deliberate per-instance knob
   (this one is written by a pointer handler), not a missing definition. */
function refsIn(css) {
  const out = new Map();          // token -> first line number
  const lines = css.split('\n');
  lines.forEach((line, i) => {
    let m, re = /var\(\s*(--[A-Za-z0-9_-]+)\s*([,)])/g;
    while ((m = re.exec(line))) if (m[2] === ')' && !out.has(m[1])) out.set(m[1], i + 1);
  });
  return out;
}
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const styleOf = html => (html.match(/<style[\s\S]*?<\/style>/gi) || []).join('\n');

/* Stylesheets, resolved transitively through @import. */
const sheetCache = new Map();
function sheetDefs(name) {
  if (sheetCache.has(name)) return sheetCache.get(name);
  let css = '';
  try { css = read(name); } catch { sheetCache.set(name, new Set()); return new Set(); }
  const set = defsIn(css);
  sheetCache.set(name, set);                       // set before recursing: cycle-safe
  let m, re = /@import\s+url\(\s*["']?([A-Za-z0-9._-]+\.css)/g;
  while ((m = re.exec(css))) for (const t of sheetDefs(m[1])) set.add(t);
  return set;
}

/* navbar.js injects its own <style> into every page that loads it. */
const navSrc = read('navbar.js');
const navCss = navSrc.slice(navSrc.indexOf('var CSS = `') + 11,
                            navSrc.indexOf('\n`;', navSrc.indexOf('var CSS = `')));
const NAV_DEFS = defsIn(navCss);
const NAV_REFS = refsIn(navCss);

const files = cp.execSync('git ls-files "*.html"', { cwd: ROOT })
  .toString().trim().split('\n').filter(Boolean).filter(f => !EXCLUDE.test(f));

const problems = [];

for (const f of files) {
  const html = read(f);
  const css = styleOf(html);
  const have = defsIn(css);
  let m, lre = /<link[^>]+href="\/([A-Za-z0-9._-]+\.css)/g;
  while ((m = lre.exec(html))) for (const t of sheetDefs(m[1])) have.add(t);
  if (/navbar\.js/.test(html)) for (const t of NAV_DEFS) have.add(t);

  for (const [tok, line] of refsIn(css)) {
    /* A token may be set by a rule the page applies to itself at runtime, or
       be a deliberate per-instance knob written on the element. Only flag one
       that is nowhere in the page's own CSS, its sheets, or the bar. */
    if (!have.has(tok) && !new RegExp(tok.replace(/-/g, '\\-') + '\\s*:').test(html)) {
      problems.push(f + ':' + line + '  ' + tok);
    }
  }
}

/* GENERATED DOCUMENTS
   ------------------------------------------------------------------
   Three pages build a whole standalone HTML document in a string and hand it
   to a new window to print — the questionnaire summary a clinician takes into
   theatre, and the patient's own copy. That document gets none of this site's
   stylesheets, so a var() inside it resolves to nothing: the declaration is
   dropped and the printout silently loses a heading colour or a warning
   flag's border. It still prints, which is what makes it dangerous.

   A site-wide "replace this hex with the token that holds it" pass will walk
   straight into this, because the string contains a literal <style> block and
   looks exactly like page CSS. It did. This is the guard. */
for (const f of files) {
  const html = read(f);
  const re = /'<style>[\s\S]{0,4000}?<\/style>/g;
  let m;
  while ((m = re.exec(html))) {
    const bad = [...new Set(m[0].match(/var\(--[A-Za-z0-9_-]+/g) || [])];
    const line = html.slice(0, m.index).split('\n').length;
    for (const b of bad) {
      problems.push(f + ':' + line + '  ' + b + ') inside a generated standalone ' +
                    'document — it has no stylesheet, so this resolves to nothing');
    }
  }
}

/* The bar is injected last and must never read a page's palette. */
for (const [tok, line] of NAV_REFS) {
  if (!NAV_DEFS.has(tok)) {
    problems.push('navbar.js CSS:' + line + '  ' + tok +
                  ' — reads a token the bar does not define (the page decides its value)');
  }
}

if (problems.length) {
  console.error('UNRESOLVED CUSTOM PROPERTIES (' + problems.length + '):');
  problems.forEach(p => console.error('  ' + p));
  process.exit(1);
}
console.log('all custom properties resolve across ' + files.length + ' pages');
