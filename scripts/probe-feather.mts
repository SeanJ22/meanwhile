/** Which build is live, read off the effect's own numbers at 03255 z4. */
import { chromium } from "playwright";

const BASE = (process.env.SHOOT_BASE_URL ?? "https://sparkwtp.netlify.app").replace(/\/$/, "");
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
  colorScheme: "light",
});
await context.addInitScript(() => {
  try {
    sessionStorage.setItem(
      "wtp.approximate_location",
      JSON.stringify({ zip: "03255", savedAt: new Date().toISOString() }),
    );
    localStorage.setItem("wtp.tutorial_seen", "1");
    localStorage.setItem("wtp.theme", "light");
  } catch {
    /* still runs */
  }
});
const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForTimeout(12_000);
await page.evaluate(() =>
  (window as unknown as { __wtpZoomOut?: (n?: number) => void }).__wtpZoomOut?.(6),
);
await page.waitForTimeout(5000);

const out = await page.evaluate(() => {
  const blurs = Array.from(document.querySelectorAll("svg.state-focus-art feGaussianBlur")).map(
    (b) => b.getAttribute("stdDeviation"),
  );
  const shadow = document.querySelector('svg.state-focus-art g path[fill="#000000"]');
  const maskPath = document.querySelector("mask path");
  const d = maskPath?.getAttribute("d") ?? "";
  const re = /(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null = re.exec(d);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  while (m) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    m = re.exec(d);
  }
  return {
    zoom: (window as unknown as { __wtpZoom?: () => number }).__wtpZoom?.() ?? NaN,
    blurs,
    shadowTransform: shadow?.getAttribute("transform") ?? null,
    span: Math.min(maxX - minX, maxY - minY),
    bbox: { minX, minY, maxX, maxY },
    hasCamera: typeof (window as unknown as { __wtpCamera?: unknown }).__wtpCamera === "function",
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
