/**
 * One image out of many, so a whole pass can be judged in a single look.
 *
 *   pnpm sheet after-04 after-05 after-6c      # by filename prefix
 *   pnpm sheet --dir=<path> --out=<file> kean bennett   # any directory
 *
 * Builds an HTML grid of `data:` URIs with a caption per cell and shoots it
 * full-page. Twenty screenshots reviewed in one look instead of twenty.
 *
 * `--dir` was added 2026-08-23 for the campaign-portrait pass, which stages
 * candidate images OUTSIDE the repo — RULING 20 keeps portraits out of git, so
 * a sheet that could only read `screenshots/` could not look at them at all,
 * and RULING 2 makes a capture evidence only once it has been READ AS AN IMAGE.
 * Parameterising the tool that already existed is what RULING 76 asks for in
 * place of an eleventh dated script.
 *
 * JPEG and WebP are read too, for the same pass: a campaign site serves what
 * it serves, and a PNG-only reader would silently look at a fraction of the
 * staged images and report a complete review.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchGuarded } from "./browser.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dirArg = args.find((a) => a.startsWith("--dir="))?.slice("--dir=".length);
const outArg = args.find((a) => a.startsWith("--out="))?.slice("--out=".length);
const DIR = dirArg ?? join(root, "screenshots");

const prefixes = args.filter((a) => !a.startsWith("--"));
const files = readdirSync(DIR)
  .filter((f) => /.(png|jpe?g|webp)$/i.test(f) && !f.startsWith("contact-sheet"))
  .filter((f) => prefixes.length === 0 || prefixes.some((p) => f.includes(p)))
  .sort();

if (files.length === 0) {
  console.error(`no screenshots match ${prefixes.join(", ")}`);
  process.exit(1);
}

const cells = files
  .map((f) => {
    const bytes = readFileSync(join(DIR, f));
    const type = /.png$/i.test(f)
      ? "image/png"
      : /.webp$/i.test(f)
        ? "image/webp"
        : "image/jpeg";
    return (
      `<figure><img src="data:${type};base64,${bytes.toString("base64")}">` +
      `<figcaption>${f}<br>${(bytes.length / 1024).toFixed(0)} KB</figcaption></figure>`
    );
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
const out = outArg ?? join(DIR, "contact-sheet.png");
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`${files.length} shot(s) → ${out}`);
