import { launchGuarded } from "./browser.mts";
const BASE = "http://localhost:3000";
const guarded = await launchGuarded({ label: "f01-probe103b" });
const context = await guarded.context({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
await context.addInitScript(() => {
  try { sessionStorage.setItem("wtp.approximate_location", JSON.stringify({ zip: "85701", savedAt: new Date().toISOString() })); localStorage.setItem("wtp.tutorial_seen", "1"); } catch {}
});
const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
const out = await page.evaluate(`(() => {
  let n = document.querySelector(".maplibregl-canvas");
  const chain = [];
  while (n && chain.length < 8) {
    const r = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    chain.push({ tag: n.tagName, cls: String(n.className).slice(0, 70), x: Math.round(r.x), w: Math.round(r.width),
      pos: cs.position, ml: cs.marginLeft, pl: cs.paddingLeft, left: cs.left, display: cs.display, grid: cs.gridTemplateColumns });
    n = n.parentElement;
  }
  return chain;
})()`);
console.log(JSON.stringify(out, null, 1));
await guarded.close();
