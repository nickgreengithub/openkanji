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

// 开 -- the mark the page wears in its top left corner, drawn rather than set
// in a font: an icon has to be right at sixteen pixels, where a typeface's
// tapered strokes turn to grey mush, and a build that reaches for a font is a
// build that needs one installed.
//
// Four strokes, in units of the icon's width, each a quadrilateral so the
// third can lean the way it does when it is written: two horizontals, a leg
// that slants out to the left, and a leg that drops straight.
const S = 0.088;                  // stroke
const SHAPES = [
  // the upper horizontal, shorter than the one under it
  [[0.240, 0.265], [0.760, 0.265], [0.760, 0.265 + S], [0.240, 0.265 + S]],
  // the lower horizontal, the widest thing in the mark
  [[0.100, 0.500], [0.900, 0.500], [0.900, 0.500 + S], [0.100, 0.500 + S]],
  // the left leg, which starts above the lower horizontal and leans out
  // through it -- the crossing is what makes this 开 and not 示
  [[0.385, 0.385], [0.385 + S, 0.385], [0.240 + S, 0.860], [0.240, 0.860]],
  // and the right one, straight down through the same bar
  [[0.660, 0.385], [0.660 + S, 0.385], [0.660 + S, 0.860], [0.660, 0.860]],
];

// Point in a convex quad: on the same side of all four edges. Sampled four by
// four to a pixel, because a mark this small lives or dies on its edges.
const inside = (q, x, y) => {
  let neg = false, pos = false;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4];
    const d = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (d < 0) neg = true; else if (d > 0) pos = true;
    if (neg && pos) return false;
  }
  return true;
};

const cover = (x, y, size) => {
  let n = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const px = (x + (sx + 0.5) / 4) / size, py = (y + (sy + 0.5) / 4) / size;
      if (SHAPES.some((q) => inside(q, px, py))) n++;
    }
  }
  return n / 16;
};

const png = (size) => {
  const row = size * 3 + 1;
  const raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    raw[y * row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const a = cover(x, y, size);
      const at = y * row + 1 + x * 3;
      for (let c = 0; c < 3; c++) raw[at + c] = Math.round(TEAL[c] + (WHITE[c] - TEAL[c]) * a);
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
  const strokes = SHAPES.map((q) =>
    '<polygon points="' + q.map(([x, y]) => (x * 512).toFixed(1) + "," + (y * 512).toFixed(1)).join(" ") + '" fill="#fff"/>').join("");
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0891b2"/>' + strokes + "</svg>\n";
};

// The tab icon for everything that will not take the SVG -- Safari before 17,
// and every browser's own guess at /favicon.ico when nothing is declared.
// Three sizes in one file, each a PNG, which every browser since Vista reads.
const ico = (sizes) => {
  const imgs = sizes.map((n) => png(n));
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const dir = sizes.map((n, i) => {
    const e = Buffer.alloc(16);
    e[0] = n >= 256 ? 0 : n; e[1] = n >= 256 ? 0 : n;
    e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(imgs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += imgs[i].length;
    return e;
  });
  return Buffer.concat([head, ...dir, ...imgs]);
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
    "favicon.ico": ico([16, 32, 48]),
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
