#!/usr/bin/env tsx
/**
 * `pnpm sheet <dir> <out.png> [--filter=<substring>]` — **many staged images,
 * one look.**
 *
 * RULING 2 says a capture is evidence only once it has been READ AS AN IMAGE,
 * and the photo rule says nothing ships without the eyeball pass. Both are
 * about a human — or a session — actually looking, and looking at fifty-five
 * files one at a time is how a pass gets skipped.
 *
 * So this lays them out on a numbered grid with each file's name under it. One
 * image, one read, every staged candidate visible at once, and the numbers are
 * what a refusal or an approval refers to.
 *
 * **It decides nothing.** It draws. Composition, identity and the four doors
 * are judgements about a real person's face and this makes no part of them.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { launchGuarded } from "./browser.mts";

const [dirArg, outArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!dirArg || !outArg) {
  console.error("usage: pnpm sheet <dir> <out.png> [--filter=<substring>]");
  process.exit(2);
}
const filter = (process.argv.find((a) => a.startsWith("--filter=")) ?? "").slice("--filter=".length);

const dir = resolve(dirArg);
const out = resolve(outArg);
const files = readdirSync(dir)
  .filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f))
  .filter((f) => (filter ? f.includes(filter) : true))
  .sort();

if (files.length === 0) {
  console.error(`sheet · CANNOT RUN — no image files in ${dir}${filter ? ` matching "${filter}"` : ""}.`);
  process.exit(2);
}

/*
 * **THE IMAGES ARE INLINED, NOT LINKED.**
 *
 * The first version pointed each `<img>` at a `file://` URL and the sheet
 * photographed sixteen empty boxes: a page built with `setContent` has an
 * opaque origin, and `file://` is cross-origin to it. The decode counter is
 * what caught that — it reported `0 decoded to a real image` rather than
 * writing a plausible-looking PNG of nothing, which is the whole reason it
 * counts rather than assuming.
 */
const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

const cells = files
  .map((f, i) => {
    const ext = (f.split(".").pop() ?? "").toLowerCase();
    const src = `data:${MIME[ext] ?? "application/octet-stream"};base64,${readFileSync(join(dir, f)).toString("base64")}`;
    /* The label is the FILE NAME, not a prettified one. A sheet whose captions
       have been tidied cannot be used to name which file to refuse. */
    return `<figure><span class="n">${i + 1}</span><img src="${src}" alt=""><figcaption>${f
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")}</figcaption></figure>`;
  })
  .join("\n");

const COLUMNS = 5;
const html = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; background: #111; color: #eee; font: 11px/1.35 ui-sans-serif, system-ui, sans-serif; }
  h1 { font-size: 15px; margin: 14px 16px 4px; }
  p.sub { margin: 0 16px 12px; color: #999; }
  .grid { display: grid; grid-template-columns: repeat(${COLUMNS}, 1fr); gap: 10px; padding: 0 16px 20px; }
  figure { margin: 0; background: #1b1b1b; border: 1px solid #333; border-radius: 6px; padding: 6px; position: relative; }
  .n { position: absolute; top: 4px; left: 6px; background: #000c; padding: 1px 5px; border-radius: 4px; font-weight: 700; }
  img { display: block; width: 100%; height: 190px; object-fit: contain; background: #000; }
  figcaption { margin-top: 5px; color: #bbb; word-break: break-all; font-size: 9px; }
</style>
<h1>Staged portraits — ${files.length} image(s)</h1>
<p class="sub">${dir}${filter ? ` · filter "${filter}"` : ""}. Nothing here has been approved; this is the pool to look at.</p>
<div class="grid">${cells}</div>`;

const browser = await launchGuarded({ label: "contact-sheet" });
const page = await browser.page({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
/* Every image decoded before the shot, or the sheet photographs empty boxes —
 * a capture that reports success with its product unchecked (RULING 113). */
const decoded = (await page.evaluate(`(async () => {
  const imgs = Array.from(document.images);
  await Promise.all(imgs.map(i => i.decode().catch(() => null)));
  return imgs.filter(i => i.naturalWidth > 0).length;
})()`)) as number;
mkdirSync(dirname(out), { recursive: true });
await page.screenshot({ path: out, fullPage: true });
await browser.close();

console.log(`sheet · ${files.length} file(s) laid out, ${decoded} decoded to a real image`);
if (decoded < files.length) {
  console.log(`  ${files.length - decoded} did NOT decode and appear as empty cells — they are not readable images.`);
}
console.log(`  wrote ${out}${existsSync(out) ? "" : "  (MISSING — the screenshot did not land)"}`);
