import { launchGuarded } from "./browser.mts";
const BASE = "http://localhost:3000";
const guarded = await launchGuarded({ label: "f01-probe103" });
const context = await guarded.context({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
await context.addInitScript(() => {
  try {
    sessionStorage.setItem("wtp.approximate_location", JSON.stringify({ zip: "85701", savedAt: new Date().toISOString() }));
    localStorage.setItem("wtp.tutorial_seen", "1");
  } catch {}
});
const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
const out = await page.evaluate(`(() => {
  const q = (s) => document.querySelector(s);
  const rect = (s) => { const n = q(s); if (!n) return null; const r = n.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const sb = q(".sidebar");
  return {
    viewport: { w: innerWidth, h: innerHeight },
    sidebar: rect(".sidebar"),
    sidebarScroll: rect(".sidebar-scroll"),
    sidebarComputed: sb ? { height: getComputedStyle(sb).height, maxHeight: getComputedStyle(sb).maxHeight, display: getComputedStyle(sb).display } : null,
    lastChildInScroll: (() => { const s = q(".sidebar-scroll"); if (!s) return null; const last = s.lastElementChild; if (!last) return null; const r = last.getBoundingClientRect(); return { tag: last.tagName, cls: last.className.slice(0,60), bottom: Math.round(r.bottom) }; })(),
    mapCanvas: rect(".maplibregl-canvas") || rect("canvas"),
    mapReset: rect(".map-reset-btn"),
    statsDistricts: (() => { const cards = [...document.querySelectorAll(".stats-bar *")].map(n=>n.textContent||"").filter(t=>/Districts/.test(t)); return cards[0]?.replace(/\s+/g," ").trim().slice(0,60) ?? null; })(),
  };
})()`);
console.log(JSON.stringify(out, null, 1));
await page.screenshot({ path: process.argv[2] ?? "shot.png" });
await guarded.close();
