#!/usr/bin/env node
// The icons and the manifest, so the site can be installed to a home screen.
//
// A browser tab always costs its own chrome -- on iOS an address bar at the
// bottom and a toolbar under it, which together take about a fifth of the
// screen before the keyboard has even opened. A page cannot hide those. What
// it can do is be installable: added to the home screen, the same page runs
// with no browser furniture at all, which is where the room for a typing
// round comes from.
//
// The icon is drawn here rather than committed as a binary: a teal square
// with the gate of 開 in white, which is the same mark the page boots with.
// No dependencies -- a PNG is a header, a palette-free bitmap, and a CRC.

const zlib = require("zlib");

const TEAL = [8, 145, 178];
const WHITE = [255, 255, 255];

// 日 -- the frame and its rail, in units of the icon's width, as [x, y, w, h].
const S = 0.078;                  // stroke
const A = 0.21, B = 0.79;         // the frame's edges
const BARS = [
  [A, A, B - A, S],                       // top
  [A, B - S, B - A, S],                   // bottom
  [A, A, S, B - A],                       // left
  [B - S, A, S, B - A],                   // right
  [A, (A + B) / 2 - S / 2, B - A, S],     // the rail across the middle
];

const png = (size) => {
  const row = size * 3 + 1;
  const raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    raw[y * row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const on = BARS.some(([bx, by, bw, bh]) =>
        x >= bx * size && x < (bx + bw) * size && y >= by * size && y < (by + bh) * size);
      const c = on ? WHITE : TEAL;
      const at = y * row + 1 + x * 3;
      raw[at] = c[0]; raw[at + 1] = c[1]; raw[at + 2] = c[2];
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // 8 bits per channel
  ihdr[9] = 2;  // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const svg = () => {
  const bars = BARS.map(([x, y, w, h]) =>
    '<rect x="' + (x * 512) + '" y="' + (y * 512) + '" width="' + (w * 512) + '" height="' + (h * 512) + '" fill="#fff"/>').join("");
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0891b2"/>' + bars + "</svg>\n";
};

const manifest = () => JSON.stringify({
  name: "OpenKanji",
  short_name: "OpenKanji",
  description: "The two thousand commonest Japanese words, one set of twenty at a time.",
  start_url: "/",
  scope: "/",
  // The whole point: installed, the page runs without the browser's own bars.
  display: "standalone",
  orientation: "portrait",
  background_color: "#f4f4f1",
  theme_color: "#f4f4f1",
  lang: "en",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
  ],
}, null, 2) + "\n";

module.exports = {
  files: () => ({
    "manifest.webmanifest": Buffer.from(manifest()),
    "icon.svg": Buffer.from(svg()),
    "icon-192.png": png(192),
    "icon-512.png": png(512),
    // iOS does not read the manifest for the home-screen icon.
    "apple-touch-icon.png": png(180),
  }),
};

if (require.main === module) {
  const fs = require("fs");
  const path = require("path");
  const out = path.join(__dirname, "..", "dist");
  fs.mkdirSync(out, { recursive: true });
  for (const [name, data] of Object.entries(module.exports.files())) {
    fs.writeFileSync(path.join(out, name), data);
    console.log("  " + name + " (" + data.length + " bytes)");
  }
}
