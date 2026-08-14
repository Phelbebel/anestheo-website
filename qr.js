/* qr.js — a QR encoder, written here on purpose.
 *
 * The alternative was an image API: POST the URL to someone's server, get a
 * PNG back. That URL is the key to a person's medical history. Handing it to a
 * third party — logged, cached, retained under terms nobody read — would
 * undo the entire point of hashing the token in the database. So the code is
 * generated in the browser, from bytes that never leave it.
 *
 * Byte mode, error correction level M (recovers ~15%), versions 1–10, which
 * carries up to 213 bytes — an Anestheo passport URL is about 66. Numeric and
 * alphanumeric modes are not implemented because a URL containing a base64url
 * token can use neither.
 *
 * QR Code is a registered trademark of DENSO WAVE INCORPORATED. This is an
 * independent implementation of the published ISO/IEC 18004 encoding.
 *
 *   QR.svg(text, opts) -> an <svg> string, ready to insert or print.
 *   QR.matrix(text)    -> [[bool]] if you want to draw it another way.
 */
(function(global){
'use strict';

/* ── GF(256) ──────────────────────────────────────────────────────────────
   Reed–Solomon lives in the field defined by x^8+x^4+x^3+x^2+1, so multiply
   becomes add-the-logs. Both tables are built once at load. */
var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(function(){
  var x = 1;
  for(var i = 0; i < 255; i++){
    EXP[i] = x; LOG[x] = i;
    x <<= 1;
    if(x & 0x100) x ^= 0x11D;
  }
  for(var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
})();
function mul(a, b){ return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

/* The generator polynomial for n check bytes: (x-a^0)(x-a^1)…(x-a^(n-1)).
   Coefficients are stored HIGHEST DEGREE FIRST, so g[0] is the leading 1 that
   the synthetic division below relies on. Storing it the other way round
   produces a polynomial that is correct read backwards and check bytes that
   are wrong in a way nothing catches until a scanner silently refuses the
   code — which is exactly what happened, and why this file is verified
   against an independent encoder and an independent decoder. */
function generator(n){
  var g = [1];
  for(var i = 0; i < n; i++){
    var ng = new Array(g.length + 1).fill(0);
    for(var j = 0; j < g.length; j++){
      ng[j]     ^= g[j];                    // multiply by x
      ng[j + 1] ^= mul(g[j], EXP[i]);       // multiply by a^i
    }
    g = ng;
  }
  return g;
}
function ecBytes(data, n){
  var g = generator(n), res = data.concat(new Array(n).fill(0));
  for(var i = 0; i < data.length; i++){
    var c = res[i];
    if(c === 0) continue;
    for(var j = 0; j < g.length; j++) res[i + j] ^= mul(g[j], c);
  }
  return res.slice(data.length);
}

/* ── version tables, EC level M only ─────────────────────────────────────
   [ total codewords, ec codewords per block, group1 blocks, group2 blocks ] */
var VER = {
  1:[26,10,1,0],   2:[44,16,1,0],   3:[70,26,1,0],   4:[100,18,2,0],
  5:[134,24,2,0],  6:[172,16,4,0],  7:[196,18,4,0],  8:[242,22,2,2],
  9:[292,22,3,2], 10:[346,26,4,1]
};
var ALIGN = {
  1:[], 2:[6,18], 3:[6,22], 4:[6,26], 5:[6,30],
  6:[6,34], 7:[6,22,38], 8:[6,24,42], 9:[6,26,46], 10:[6,28,50]
};
// Version information bit strings, needed from version 7 upward.
var VINFO = { 7:0x07C94, 8:0x085BC, 9:0x09A99, 10:0x0A4D3 };

function capacity(v){
  var t = VER[v], ec = t[1], g1 = t[2], g2 = t[3];
  return t[0] - ec * (g1 + g2);          // data codewords available
}
function sizeOf(v){ return v * 4 + 17; }

/* ── encoding ─────────────────────────────────────────────────────────── */
function toBytes(str){
  // UTF-8, because a name or a URL may not be ASCII.
  if(global.TextEncoder) return Array.from(new global.TextEncoder().encode(str));
  var out = [];
  for(var i = 0; i < str.length; i++){
    var c = str.charCodeAt(i);
    if(c < 0x80) out.push(c);
    else if(c < 0x800){ out.push(0xC0 | (c >> 6), 0x80 | (c & 63)); }
    else { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
  }
  return out;
}

function encode(text){
  /* Counted in bits, not rounded-up bytes: the header is a 4-bit mode
     indicator plus an 8- or 16-bit length, which is one and a half bytes, and
     rounding that up to two cost a byte of payload at every version. */
  var data = toBytes(text), v = 0;
  for(var i = 1; i <= 10; i++){
    var lenBits = (i < 10) ? 8 : 16;
    if(4 + lenBits + data.length * 8 <= capacity(i) * 8){ v = i; break; }
  }
  if(!v) throw new Error('QR: ' + data.length + ' bytes is more than this encoder carries');

  var bits = [];
  var push = function(val, n){ for(var k = n - 1; k >= 0; k--) bits.push((val >> k) & 1); };
  push(4, 4);                                   // byte mode
  push(data.length, v < 10 ? 8 : 16);
  data.forEach(function(b){ push(b, 8); });

  var cap = capacity(v) * 8;
  for(var t = 0; t < 4 && bits.length < cap; t++) bits.push(0);   // terminator
  while(bits.length % 8) bits.push(0);
  var pad = [0xEC, 0x11], p = 0;
  while(bits.length < cap){ push(pad[p++ % 2], 8); }

  var codewords = [];
  for(var b = 0; b < bits.length; b += 8){
    var n = 0;
    for(var q = 0; q < 8; q++) n = (n << 1) | bits[b + q];
    codewords.push(n);
  }

  /* Blocks, then interleave — a burst of damage should hit one byte of many
     blocks rather than destroying one block completely. */
  var tbl = VER[v], ecLen = tbl[1], g1 = tbl[2], g2 = tbl[3];
  var total = g1 + g2, shortLen = Math.floor(capacity(v) / total);
  var blocks = [], ecblocks = [], pos = 0;
  for(var bi = 0; bi < total; bi++){
    var len = shortLen + (bi >= g1 ? 1 : 0);
    var blk = codewords.slice(pos, pos + len); pos += len;
    blocks.push(blk);
    ecblocks.push(ecBytes(blk, ecLen));
  }
  var out = [], maxLen = Math.max.apply(null, blocks.map(function(x){ return x.length; }));
  for(var c = 0; c < maxLen; c++)
    for(var k2 = 0; k2 < blocks.length; k2++)
      if(c < blocks[k2].length) out.push(blocks[k2][c]);
  for(var e = 0; e < ecLen; e++)
    for(var k3 = 0; k3 < ecblocks.length; k3++) out.push(ecblocks[k3][e]);

  return { version: v, bytes: out };
}

/* ── the matrix ───────────────────────────────────────────────────────── */
function build(version, bytes){
  var n = sizeOf(version);
  var m = [], reserved = [];
  for(var i = 0; i < n; i++){
    m.push(new Array(n).fill(0));
    reserved.push(new Array(n).fill(false));
  }
  var set = function(r, c, v){ m[r][c] = v ? 1 : 0; reserved[r][c] = true; };

  function finder(r, c){
    for(var dr = -1; dr <= 7; dr++) for(var dc = -1; dc <= 7; dc++){
      var rr = r + dr, cc = c + dc;
      if(rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      var inRing = (dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6) &&
        (dr === 0 || dr === 6 || dc === 0 || dc === 6 ||
         (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
      set(rr, cc, inRing);
    }
  }
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);

  for(var t = 8; t < n - 8; t++){                       // timing
    set(6, t, t % 2 === 0);
    set(t, 6, t % 2 === 0);
  }

  /* An alignment pattern goes at every combination of the coordinates EXCEPT
     the three that would sit on a finder. The test is on those three corners
     specifically — not on "is this cell already spoken for", which also
     excludes the patterns that legitimately cross the timing line and quietly
     breaks every version from 7 upward. */
  var ac = ALIGN[version] || [];
  var lastA = ac[ac.length - 1];
  ac.forEach(function(r){
    ac.forEach(function(c){
      if((r === 6 && c === 6) || (r === 6 && c === lastA) || (r === lastA && c === 6)) return;
      for(var dr = -2; dr <= 2; dr++) for(var dc = -2; dc <= 2; dc++)
        set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    });
  });

  set(n - 8, 8, 1);                                     // the dark module

  // Format areas are reserved now and written after masking is chosen.
  for(var i2 = 0; i2 <= 8; i2++){
    if(!reserved[8][i2] || i2 === 6) reserved[8][i2] = true;
    if(!reserved[i2][8] || i2 === 6) reserved[i2][8] = true;
  }
  for(var i3 = 0; i3 < 8; i3++){ reserved[8][n - 1 - i3] = true; reserved[n - 1 - i3][8] = true; }
  if(version >= 7){
    for(var a = 0; a < 6; a++) for(var b = 0; b < 3; b++){
      reserved[n - 11 + b][a] = true; reserved[a][n - 11 + b] = true;
    }
  }

  /* Data snakes up and down in two-module columns, right to left, skipping
     column 6 which is the timing line. */
  var bits = [];
  bytes.forEach(function(byte){ for(var k = 7; k >= 0; k--) bits.push((byte >> k) & 1); });
  var idx = 0, up = true;
  for(var col = n - 1; col > 0; col -= 2){
    if(col === 6) col--;
    for(var step = 0; step < n; step++){
      var row = up ? (n - 1 - step) : step;
      for(var w = 0; w < 2; w++){
        var cc2 = col - w;
        if(reserved[row][cc2]) continue;
        m[row][cc2] = idx < bits.length ? bits[idx++] : 0;
      }
    }
    up = !up;
  }
  return { m: m, reserved: reserved, n: n };
}

var MASKS = [
  function(r,c){ return (r + c) % 2 === 0; },
  function(r){ return r % 2 === 0; },
  function(r,c){ return c % 3 === 0; },
  function(r,c){ return (r + c) % 3 === 0; },
  function(r,c){ return (Math.floor(r/2) + Math.floor(c/3)) % 2 === 0; },
  function(r,c){ return (r*c) % 2 + (r*c) % 3 === 0; },
  function(r,c){ return ((r*c) % 2 + (r*c) % 3) % 2 === 0; },
  function(r,c){ return ((r+c) % 2 + (r*c) % 3) % 2 === 0; }
];

/* The published penalty rules. A scanner reads a code more reliably when it
   has no long runs, no big blocks, and nothing resembling a finder pattern. */
function penalty(m, n){
  var score = 0, i, j, run, dark = 0;
  for(i = 0; i < n; i++){
    run = 1;
    for(j = 1; j < n; j++){
      if(m[i][j] === m[i][j-1]) run++; else { if(run >= 5) score += 3 + (run - 5); run = 1; }
    }
    if(run >= 5) score += 3 + (run - 5);
  }
  for(j = 0; j < n; j++){
    run = 1;
    for(i = 1; i < n; i++){
      if(m[i][j] === m[i-1][j]) run++; else { if(run >= 5) score += 3 + (run - 5); run = 1; }
    }
    if(run >= 5) score += 3 + (run - 5);
  }
  for(i = 0; i < n - 1; i++) for(j = 0; j < n - 1; j++){
    var s = m[i][j] + m[i][j+1] + m[i+1][j] + m[i+1][j+1];
    if(s === 0 || s === 4) score += 3;
  }
  var pat1 = [1,0,1,1,1,0,1,0,0,0,0], pat2 = [0,0,0,0,1,0,1,1,1,0,1];
  var matches = function(get, len, at){
    var ok1 = true, ok2 = true;
    for(var k = 0; k < 11; k++){
      if(at + k >= len){ ok1 = ok2 = false; break; }
      var v = get(at + k);
      if(v !== pat1[k]) ok1 = false;
      if(v !== pat2[k]) ok2 = false;
    }
    return ok1 || ok2;
  };
  for(i = 0; i < n; i++) for(j = 0; j < n; j++){
    if(matches(function(k){ return m[i][k]; }, n, j)) score += 40;
    if(matches(function(k){ return m[k][j]; }, n, i)) score += 40;
  }
  for(i = 0; i < n; i++) for(j = 0; j < n; j++) dark += m[i][j];
  score += Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5) * 10;
  return score;
}

function formatBits(mask){
  // EC level M is 00; then 15 bits BCH-protected and XORed with 0x5412.
  var data = (0 << 3) | mask, rem = data;
  for(var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function place(text, forceMask){
  var enc = encode(text);
  var built = build(enc.version, enc.bytes);
  var n = built.n, best = null;

  for(var mask = 0; mask < 8; mask++){
    if(forceMask != null && mask !== forceMask) continue;
    var m = built.m.map(function(row){ return row.slice(); });
    for(var r = 0; r < n; r++) for(var c = 0; c < n; c++)
      if(!built.reserved[r][c] && MASKS[mask](r, c)) m[r][c] ^= 1;

    /* The fifteen format bits are placed MOST significant first — j is the
       placement position, not the bit number, so the bit itself is counted
       down from 14. Getting this backwards produces a code whose finder
       patterns a scanner locates perfectly and whose contents it then cannot
       read at all, which is a maddening thing to debug and the reason this
       file is checked against an independent decoder. */
    var fmt = formatBits(mask);
    for(var j = 0; j < 15; j++){
      var bit = (fmt >> (14 - j)) & 1;
      // copy one, wrapped around the top-left finder
      if(j < 6)        m[8][j] = bit;
      else if(j === 6) m[8][7] = bit;
      else if(j === 7) m[8][8] = bit;
      else if(j === 8) m[7][8] = bit;
      else             m[14 - j][8] = bit;
      // copy two, split between the other two corners so that losing one
      // corner of a printed card does not lose the format
      if(j < 7) m[n - 1 - j][8] = bit;      // stops short of the dark module
      else      m[8][n - 15 + j] = bit;
    }
    if(enc.version >= 7){
      var vi = VINFO[enc.version];
      for(var k = 0; k < 18; k++){
        var vb = (vi >> k) & 1, rr = Math.floor(k / 3), cc = k % 3;
        m[n - 11 + cc][rr] = vb;
        m[rr][n - 11 + cc] = vb;
      }
    }
    var p = penalty(m, n);
    if(!best || p < best.p) best = { p: p, m: m, mask: mask };
  }
  return { matrix: best.m, size: n, version: enc.version, mask: best.mask };
}

/* ── public ───────────────────────────────────────────────────────────── */
var QR = {};

QR.matrix = function(text, forceMask){
  var r = place(String(text), forceMask);
  return r.matrix.map(function(row){ return row.map(function(v){ return v === 1; }); });
};

/* An SVG rather than a canvas: it prints at the resolution of the printer
   rather than the resolution of the screen, and a Health Passport card is
   something people print. The quiet zone is four modules, as specified —
   without it many scanners simply will not see the code. */
QR.svg = function(text, opts){
  opts = opts || {};
  var r = place(String(text));
  var n = r.size, quiet = opts.quiet == null ? 4 : opts.quiet;
  var total = n + quiet * 2;
  var px = opts.size || 240;
  var dark = opts.dark || '#000000', light = opts.light || '#FFFFFF';

  var d = [];
  for(var y = 0; y < n; y++){
    var x = 0;
    while(x < n){
      if(!r.matrix[y][x]){ x++; continue; }
      var run = 0;
      while(x + run < n && r.matrix[y][x + run]) run++;
      d.push('M' + (x + quiet) + ' ' + (y + quiet) + 'h' + run + 'v1h-' + run + 'z');
      x += run;
    }
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px +
    '" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges" ' +
    'role="img" aria-label="' + (opts.label || 'QR code') + '">' +
    '<rect width="' + total + '" height="' + total + '" fill="' + light + '"/>' +
    '<path fill="' + dark + '" d="' + d.join('') + '"/></svg>';
};

if(typeof module !== 'undefined' && module.exports) module.exports = QR;
global.QR = QR;
})(typeof window !== 'undefined' ? window : this);
