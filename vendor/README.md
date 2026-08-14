# Vendored third-party code

Bundled here rather than pulled from a CDN at runtime, because a Health
Passport page must not make a request to any third party. The token in the
page fragment is a bearer credential; a script loaded from someone else's
server could read it.

| file | package | version | licence | upstream |
|---|---|---|---|---|
| `qrcode-generator-2.0.4.js` | `qrcode-generator` | 2.0.4 | MIT | https://www.npmjs.com/package/qrcode-generator — Kazuhiko Arase, https://www.d-project.com/ |

Copied byte-for-byte from the published tarball's `dist/qrcode.js`. The file
carries its own MIT header; do not edit it. To update, fetch the new tarball,
replace the file, bump the version in this table and in `qr.js`, and re-run
`node /tmp/adm/qr.js`, which decodes the output with OpenCV and diffs the
matrices against segno.

"QR Code" is a registered trademark of DENSO WAVE INCORPORATED.
