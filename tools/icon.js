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
// 开 is drawn to fill a square, because a square is the space it is given. The
// first cut was a letterbox -- much wider than tall -- so fitting it meant
// filling the width and leaving air above and below, and a stroke that runs
// the width of a tab icon reads as one that has been cut off however much
// alpha is left in the last column. The legs are longer and start higher; the
// bars are shorter. Same character, and it now sits in the box rather than
// across it.
const SHAPES = [
  // the upper horizontal, shorter than the one under it
  [[0.255, 0.130], [0.745, 0.130], [0.745, 0.130 + S], [0.255, 0.130 + S]],
  // the lower horizontal, the widest thing in the mark
  [[0.115, 0.440], [0.885, 0.440], [0.885, 0.440 + S], [0.115, 0.440 + S]],
  // the left leg: it starts above the lower horizontal and leans out through
  // it -- the crossing is what makes this 开 and not 示
  [[0.380, 0.310], [0.380 + S, 0.310], [0.235 + S, 0.885], [0.235, 0.885]],
  // and the right one, straight down through the same bar
  [[0.645, 0.310], [0.645 + S, 0.310], [0.645 + S, 0.885], [0.645, 0.885]],
];

// A plate needs air around the mark; a mark on nothing needs less, but not
// none. Reaching the edge of the canvas -- or coming within a pixel of it at
// sixteen -- the widest stroke runs into the tab beside it and reads as cut
// off, whatever the alpha channel says. Two clear pixels a side at sixteen. So the bare mark is fitted rather than
// scaled by eye: as large as it goes inside a margin, and centred in the box
// on both axes, which the plate drawing is not (it hangs low, under the room
// the plate leaves for it).
const BOX = SHAPES.flat().reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [1, 1, 0, 0]);
const MARGIN = 0.14;
const fitted = (m) => {
  const w = BOX[2] - BOX[0], h = BOX[3] - BOX[1];
  const k = (1 - 2 * m) / Math.max(w, h);
  const dx = 0.5 - (BOX[0] + w / 2) * k, dy = 0.5 - (BOX[1] + h / 2) * k;
  return SHAPES.map((q) => q.map(([x, y]) => [x * k + dx, y * k + dy]));
};
const BARE = fitted(MARGIN);

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

const cover = (x, y, size, shapes) => {
  let n = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const px = (x + (sx + 0.5) / 4) / size, py = (y + (sy + 0.5) / 4) / size;
      if (shapes.some((q) => inside(q, px, py))) n++;
    }
  }
  return n / 16;
};

// Two kinds of icon come out of the same drawing. One is a plate: a teal
// square with the mark cut out of it in white, which is what a home screen and
// an app launcher want -- they composite a transparent icon onto black. The
// other is the mark alone on nothing, which is what a tab wants, so the browser
// can put it on whatever colour its own furniture is.
const png = (size, ink, plate) => {
  const ch = plate ? 3 : 4;
  const row = size * ch + 1;
  const raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    raw[y * row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const a = cover(x, y, size, plate ? SHAPES : BARE);
      const at = y * row + 1 + x * ch;
      if (plate) for (let c = 0; c < 3; c++) raw[at + c] = Math.round(plate[c] + (ink[c] - plate[c]) * a);
      else { for (let c = 0; c < 3; c++) raw[at + c] = ink[c]; raw[at + 3] = Math.round(a * 255); }
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
  ihdr[9] = plate ? 2 : 6;  // truecolour, with alpha when there is no plate
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

// The mark alone, no plate, and it answers to the browser's theme: ink on a
// light tab strip, white on a dark one. Chrome and Firefox both read a media
// query inside a favicon; anything that does not gets the fill it was given,
// which is the light one, and that is the commoner tab strip.
const svg = () => {
  const strokes = BARE.map((q) =>
    '<polygon points="' + q.map(([x, y]) => (x * 512).toFixed(1) + "," + (y * 512).toFixed(1)).join(" ") + '"/>').join("");
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
    "<style>polygon{fill:#15181c}@media(prefers-color-scheme:dark){polygon{fill:#fff}}</style>" +
    strokes + "</svg>\n";
};

// The tab icon for everything that will not take the SVG -- Safari before 17,
// and every browser's own guess at /favicon.ico when nothing is declared.
// Three sizes in one file, each a PNG, which every browser since Vista reads.
const ico = (sizes, ink, plate) => {
  const imgs = sizes.map((n) => png(n, ink, plate));
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
    // Not the SVG: that one is the bare mark for a tab, and an installed app
    // would composite its transparency onto black.
  ],
}, null, 2) + "\n";

module.exports = {
  files: () => ({
    "manifest.webmanifest": Buffer.from(manifest()),
    "icon.svg": Buffer.from(svg()),
    "icon-192.png": png(192, WHITE, TEAL),
    "icon-512.png": png(512, WHITE, TEAL),
    // The ico is the fallback for anything that will not take the SVG, and an
    // ico cannot answer to a theme. So it is the mark on nothing in the app's
    // own teal, which is legible on a light tab strip and on a dark one --
    // where black would disappear and white would too.
    "favicon.ico": ico([16, 32, 48], TEAL, null),
    // iOS does not read the manifest for the home-screen icon.
    "apple-touch-icon.png": png(180, WHITE, TEAL),
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
