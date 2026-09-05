// Loads the deployed site in WebKit (the engine every iOS browser runs) at
// iPhone size and reports what the page actually did: console output, thrown
// errors, whether the app rendered, and a screenshot.
import { webkit, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const URL_ = process.env.PROBE_URL || "https://openkanji.org/";
mkdirSync("probe", { recursive: true });

const b = await webkit.launch();
const p = await b.newPage({ ...devices["iPhone 13"], hasTouch: true, isMobile: true });
const logs = [];
p.on("console", (m) => logs.push(m.type().toUpperCase() + ": " + m.text().slice(0, 500)));
p.on("pageerror", (e) => logs.push("PAGEERROR: " + String(e.stack || e.message).slice(0, 1500)));
p.on("requestfailed", (r) => logs.push("REQFAIL: " + r.url().slice(0, 120) + " " + (r.failure() || {}).errorText));

let nav = "ok";
try {
  await p.goto(URL_, { waitUntil: "load", timeout: 60000 });
} catch (e) {
  nav = "GOTO FAILED: " + e.message;
}
await p.waitForTimeout(8000);

const state = await p.evaluate(() => {
  const el = (s) => document.querySelector(s);
  const vis = (s) => { const e = el(s); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { w: Math.round(r.width), h: Math.round(r.height), opacity: cs.opacity, display: cs.display, visibility: cs.visibility }; };
  return {
    title: document.title,
    bodyTextStart: (document.body ? document.body.innerText : "").slice(0, 300),
    bodyChildren: document.body ? document.body.children.length : -1,
    okRoot: vis(".ok-root"),
    tiles: document.querySelectorAll(".ok-tile").length,
    cards: document.querySelectorAll(".ok-card").length,
    xdc: document.querySelectorAll("x-dc").length,
    bundlerErr: (el("#__bundler_err") || {}).textContent || null,
    bundlerLoading: (el("#__bundler_loading") || {}).textContent || null,
    bundlerThumb: !!el("#__bundler_thumbnail"),
    scripts: [...document.scripts].map((s) => (s.src || "inline").slice(0, 60)),
    ua: navigator.userAgent,
    features: {
      DecompressionStream: typeof DecompressionStream !== "undefined",
      structuredClone: typeof structuredClone !== "undefined",
      atMethod: typeof Array.prototype.at === "function",
      hasSelector: (() => { try { return CSS.supports("selector(:has(*))"); } catch (e) { return "err"; } })(),
      dvh: (() => { try { return CSS.supports("height", "100dvh"); } catch (e) { return "err"; } })(),
    },
  };
});

const out = { url: URL_, nav, state, logs };
writeFileSync("probe/report.json", JSON.stringify(out, null, 2));
await p.screenshot({ path: "probe/phone.png", fullPage: false });
console.log(JSON.stringify(out, null, 2));
await b.close();
