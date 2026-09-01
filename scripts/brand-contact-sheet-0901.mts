/**
 * One image holding every capture, so a whole set can be eyeballed in a single
 * look instead of twenty. ITEM J, 2026-09-01.
 *
 *   pnpm exec tsx scripts/brand-contact-sheet-0901.mts <dir> <out.png> [maxWidth]
 */

import { readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { launchGuarded } from "./browser.mts";

const dir = resolve(process.argv[2] ?? "docs/evidence/brand-2026-09-01/after");
const out = resolve(process.argv[3] ?? join(dir, "contact-sheet.png"));
const cell = Number(process.argv[4] ?? 340);

const shots = readdirSync(dir)
  .filter((f) => f.endsWith(".png") && !f.startsWith("contact-sheet"))
  .sort();

if (shots.length === 0) throw new Error(`no captures in ${dir}`);

const cards = shots
  .map(
    (f) => `<figure>
      <img src="data:image/png;base64,${readFileSync(join(dir, f)).toString("base64")}" />
      <figcaption>${basename(f, ".png")}</figcaption>
    </figure>`,
  )
  .join("\n");

const html = `<!doctype html><html><body style="margin:0;background:#6b6b6b;font-family:system-ui">
  <div style="display:grid;grid-template-columns:repeat(3,${cell}px);gap:14px;padding:14px">
    ${cards}
  </div>
  <style>
    figure { margin:0; background:#2b2b2b; border:1px solid #999; }
    img { display:block; width:100%; height:auto; }
    figcaption { color:#fff; font-size:12px; padding:5px 6px; font-family:ui-monospace,monospace; }
  </style>
</body></html>`;

const browser = await launchGuarded({ label: "brand-contact-sheet" });
const ctx = await browser.context({ viewport: { width: cell * 3 + 60, height: 900 } });
const page = await ctx.newPage();
await page.setContent(html);
await page.waitForTimeout(400);
await page.screenshot({ path: out, fullPage: true });
await ctx.close();
await browser.close();
console.log(`  ok  ${out}  (${shots.length} captures)`);
