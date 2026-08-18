/**
 * One image out of many, so a whole pass can be judged in a single look.
 *
 *   pnpm sheet after-04 after-05 after-6c      # by filename prefix
 *
 * Builds an HTML grid of `data:` URIs with a caption per cell and shoots it
 * full-page. Twenty screenshots reviewed in one look instead of twenty.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchGuarded } from "./browser.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(root, "screenshots");

const prefixes = process.argv.slice(2);
if (prefixes.length === 0) {
  console.error("usage: pnpm sheet <filename-prefix…>");
  process.exit(1);
}

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".png"))
  .filter((f) => prefixes.some((p) => f.startsWith(p)))
  .sort();

if (files.length === 0) {
  console.error(`no screenshots match ${prefixes.join(", ")}`);
  process.exit(1);
}

const cells = files
  .map((f) => {
    const b64 = readFileSync(join(DIR, f)).toString("base64");
    return `<figure><img src="data:image/png;base64,${b64}"><figcaption>${f}</figcaption></figure>`;
  })
  .join("");

const html = `<!doctype html><meta charset="utf-8"><style>
body{background:#111;color:#eee;font:12px system-ui;margin:0;padding:12px;
  display:grid;grid-template-columns:repeat(${Math.min(files.length, 4)},1fr);gap:12px}
figure{margin:0}
img{width:100%;border:1px solid #444;display:block}
figcaption{padding:4px 0;font-family:ui-monospace,monospace;font-size:11px}
</style>${cells}`;

const browser = await launchGuarded({ label: "contact-sheet" });
const page = await browser.page({ viewport: { width: 1600, height: 900 } });
await page.setContent(html);
await page.waitForTimeout(500);
const out = join(DIR, "contact-sheet.png");
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`${files.length} shot(s) → ${out}`);
