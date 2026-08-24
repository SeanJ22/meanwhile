/**
 * `pnpm sheet <dir> [--filter=<substring>] [--out=<png>]` — a numbered contact
 * sheet from a directory of staged images.
 *
 * **A portrait is judged by being LOOKED AT** (RULING 2: a capture is evidence
 * only once it has been read as an image). Reading twenty files one at a time
 * is twenty reads; one sheet is one. The tile carries the candidate key, so a
 * verdict can be written against the right person rather than the right
 * position in a list.
 *
 * Parameterised rather than dated, per RULING 76 — a shooter that takes a
 * directory and a filter is worth more than the eleventh `sheet-<date>.mts`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { launchGuarded } from "./browser.mts";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: pnpm sheet <dir> [--filter=sub] [--out=file.png]");
  process.exit(1);
}
const filter = process.argv.find((a) => a.startsWith("--filter="))?.split("=")[1] ?? "";
const out =
  process.argv.find((a) => a.startsWith("--out="))?.split("=")[1] ??
  join(process.cwd(), "docs", "photo-review", "contact-sheet.png");

const files = readdirSync(dir)
  .filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f))
  .filter((f) => (filter ? f.includes(filter) : true))
  .sort();

if (files.length === 0) {
  console.error(`CANNOT RUN: no images in ${dir}${filter ? ` matching ${filter}` : ""}.`);
  process.exit(1);
}

const mimeOf = (f: string): string =>
  /\.png$/i.test(f) ? "image/png" : /\.webp$/i.test(f) ? "image/webp" : "image/jpeg";

const tiles = files
  .map((f, i) => {
    const b64 = readFileSync(join(dir, f)).toString("base64");
    const label = f.replace(/\.(jpe?g|png|webp|gif)$/i, "").replace(/_/g, " ");
    return (
      `<figure><div class="n">${i + 1}</div>` +
      `<img src="data:${mimeOf(f)};base64,${b64}">` +
      `<figcaption>${label.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</figcaption></figure>`
    );
  })
  .join("");

const style =
  "body{margin:0;padding:20px;background:#0f1016;color:#e8e8ee;font:12px ui-sans-serif,system-ui,sans-serif}" +
  ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}" +
  "figure{margin:0;background:#1a1b24;border:1px solid #2c2d3a;border-radius:8px;overflow:hidden;position:relative}" +
  ".n{position:absolute;top:6px;left:6px;z-index:2;background:#f0b429;color:#12131a;font-weight:700;" +
  "font-size:14px;min-width:24px;height:24px;border-radius:5px;display:flex;align-items:center;" +
  "justify-content:center;padding:0 5px}" +
  "img{width:100%;height:270px;object-fit:contain;display:block;background:#000}" +
  "figcaption{padding:6px 8px;font-size:10.5px;color:#b8b8c6;word-break:break-all;line-height:1.35}";

const html =
  `<!doctype html><meta charset="utf-8"><style>${style}</style>` +
  `<div class="grid">${tiles}</div>`;

mkdirSync(join(process.cwd(), "docs", "photo-review"), { recursive: true });
const pagePath = join(process.cwd(), "docs", "photo-review", "contact-sheet.html");
writeFileSync(pagePath, html);

const browser = await launchGuarded({ label: "contact-sheet" });
const page = await browser.page({ viewport: { width: 1280, height: 900 } });
await page.goto(`file:///${pagePath.split("\\").join("/")}`);
await page.waitForLoadState("networkidle");
await page.screenshot({ path: out, fullPage: true });
await browser.close();

// RULING 113 — observe the product at the step.
if (!existsSync(out)) {
  console.error("REFUSED: the screenshot step reported success and wrote no file.");
  process.exit(1);
}
const bytes = readFileSync(out);
if (bytes.length < 1000 || bytes[0] !== 0x89 || bytes[1] !== 0x50) {
  console.error(`REFUSED: ${out} is ${bytes.length} byte(s) and is not a PNG.`);
  process.exit(1);
}
console.log(`contact sheet — ${files.length} image(s) → ${out} (${bytes.length} bytes)`);
files.forEach((f, i) => console.log(`  ${String(i + 1).padStart(3)}  ${f}`));
