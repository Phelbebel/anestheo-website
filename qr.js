/* qr.js — the Health Passport QR, drawn locally.
 *
 * WHY LOCAL AT ALL
 * The alternative was an image API: POST the URL, get a PNG back. That URL is
 * the key to a person's medical history. Handing it to a third party — logged,
 * cached, retained under terms nobody read — would undo the point of hashing
 * the token in the database. Nothing about a passport leaves this browser.
 *
 * WHY NOT OUR OWN ENCODER
 * The first version of this file was a hand-written implementation of
 * ISO/IEC 18004. It was wrong three times in ways that were entirely
 * self-consistent and completely invisible without an outside reader: format
 * bits placed least-significant-first, a Reed-Solomon generator stored
 * constant-first while the division expected it monic, and alignment patterns
 * skipped wherever a module was already spoken for — which silently excluded
 * the ones that cross the timing line and broke every version from 7 up.
 * A printed QR is permanent. Maintaining a spec implementation to keep it
 * scannable is not a job this codebase should have.
 *
 * So the encoding is qrcode-generator 2.0.4 by Kazuhiko Arase, MIT licensed,
 * vendored at vendor/qrcode-generator-2.0.4.js and loaded from our own origin.
 * See vendor/README.md. This file is only the adapter: it picks a size, asks
 * for error correction level M, and emits an SVG that prints well.
 *
 * The independent verification stayed. /tmp/adm/qr.js still decodes every
 * generated code with OpenCV and diffs the matrices against segno, because a
 * QR that only our own code agrees with proves nothing — which is exactly how
 * the three bugs above survived.
 *
 * VERIFIED RANGE
 * Payloads up to QR.MAX_BYTES are decoded by an independent decoder in the
 * test suite at every size checked. Past roughly that point the symbols get
 * dense enough that OpenCV reads some and not others, so we cannot demonstrate
 * they scan — and an unscannable printed card is worse than a refused one.
 * A passport link is about 66 bytes, so the limit is some five times what this
 * feature can produce. Raise it only with evidence from /tmp/adm/qr.js.
 *
 *   QR.svg(text, opts) -> an <svg> string, ready to insert or print.
 *   QR.matrix(text)    -> [[bool]] for tests and other renderers.
 */
(function(global){
'use strict';

var QR = {};

/* Error correction level M recovers about 15% of the symbol. A passport card
   lives in a wallet and gets scanned in bad light; L would be smaller and more
   fragile, and Q/H would make the code denser for the same payload. */
QR.EC = 'M';
QR.LIBRARY = 'qrcode-generator 2.0.4 (MIT, Kazuhiko Arase)';
QR.MAX_BYTES = 320;          // the largest payload proved to decode; see above

function encoder(text){
  var lib = global.qrcode;
  if(typeof lib !== 'function')
    throw new Error('QR: vendor/qrcode-generator-2.0.4.js must be loaded before qr.js');

  /* The library defaults to a legacy byte encoder that silently mangles
     characters outside its table — an em dash came back as a space. The
     package ships a UTF-8 override as a separate file; setting it here does
     the same thing without vendoring a second script, and without depending on
     two files being loaded in the right order. Our payload is a pure-ASCII URL
     today, but an encoder that quietly corrupts text is a trap to leave lying
     around. */
  if(lib.stringToBytesFuncs && lib.stringToBytesFuncs['UTF-8'])
    lib.stringToBytes = lib.stringToBytesFuncs['UTF-8'];

  var str = String(text);
  /* Byte length, not character length — a non-ASCII character is more than one
     byte and the limit is about how dense the symbol gets. */
  var bytes = (global.TextEncoder ? new global.TextEncoder().encode(str).length
                                  : unescape(encodeURIComponent(str)).length);
  if(bytes > QR.MAX_BYTES)
    throw new Error('QR: ' + bytes + ' bytes exceeds the ' + QR.MAX_BYTES +
      ' byte range this has been verified to scan at');

  // typeNumber 0 asks the library to choose the smallest version that fits.
  var q = lib(0, QR.EC);
  q.addData(str);
  q.make();
  return q;
}

QR.matrix = function(text){
  var q = encoder(text), n = q.getModuleCount(), out = [];
  for(var r = 0; r < n; r++){
    var row = [];
    for(var c = 0; c < n; c++) row.push(!!q.isDark(r, c));
    out.push(row);
  }
  return out;
};

/* An SVG rather than a canvas: it prints at the resolution of the printer
   rather than the resolution of the screen, and a Health Passport card is
   something people print. Emitted here rather than via the library's own
   createSvgTag so the quiet zone, the accessible label and the colours are
   ours to state explicitly — a scanner needs the four-module margin, and
   without it many simply will not see the code. */
QR.svg = function(text, opts){
  opts = opts || {};
  var m = QR.matrix(text);
  var n = m.length, quiet = opts.quiet == null ? 4 : opts.quiet;
  var total = n + quiet * 2;
  var px = opts.size || 240;
  var dark = opts.dark || '#000000', light = opts.light || '#FFFFFF';
  var label = String(opts.label || 'QR code').replace(/[&<>"]/g, function(c){
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; });

  var d = [];
  for(var y = 0; y < n; y++){
    var x = 0;
    while(x < n){
      if(!m[y][x]){ x++; continue; }
      var run = 0;
      while(x + run < n && m[y][x + run]) run++;
      d.push('M' + (x + quiet) + ' ' + (y + quiet) + 'h' + run + 'v1h-' + run + 'z');
      x += run;
    }
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px +
    '" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges" ' +
    'role="img" aria-label="' + label + '">' +
    '<rect width="' + total + '" height="' + total + '" fill="' + light + '"/>' +
    '<path fill="' + dark + '" d="' + d.join('') + '"/></svg>';
};

if(typeof module !== 'undefined' && module.exports) module.exports = QR;
global.QR = QR;
})(typeof window !== 'undefined' ? window : this);
