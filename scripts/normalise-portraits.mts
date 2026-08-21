/**
 * **THE COMMITTED PORTRAITS, SWEPT FOR SIZE** (built 2026-08-21, NH Hunt 4
 * item 2 — the class sweep behind one named instance).
 *
 * ```
 * pnpm portraits:normalise            # report only
 * pnpm portraits:normalise --write    # resample the ones over the cap
 * ```
 *
 * ## The named instance, and its 40 siblings
 *
 * `ship:candidate` put a 2.7 MB portrait on a card during this session's own
 * first run. Fixing that one call site is not a fix for the class: a sweep of
 * `public/candidates` and `public/officials` found **41 committed portraits
 * over 600 KB, the largest 15 MB** — every one of them something a reader's
 * phone is asked to download to see a face on a card. Reader friction is a
 * defect with the standing of a wrong number, and 15 MB is not a rounding
 * error.
 *
 * The shared code path is fixed in `scripts/transcode-image.mts`, so nothing
 * new arrives oversized. This is the sweep of what arrived before it.
 *
 * ## What it will and will not do
 *
 * **It never changes a filename.** Every one of these files is referenced by
 * URL from a card, a registry row or a report, and a renamed portrait is a
 * broken image — so a `.jpg` is written back as a JPEG and a `.png` as a PNG.
 * Where the two disagree with the bytes, that is REPORTED and skipped rather
 * than silently corrected, because correcting it means updating every
 * reference and that is a change with a blast radius this script should not
 * make on its own.
 *
 * **It never crops, rotates or retouches.** The only transform is a scale to
 * the long-edge cap. The picture stays the picture.
 *
 * Counts are printed always: files walked, files over the cap, files rewritten,
 * bytes before and after. A run that rewrites nothing says so.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { pathToFileURL } from "node:url";

import { launchGuarded } from "./browser.mts";
import { kindOf, PORTRAIT_MAX_BYTES, PORTRAIT_MAX_EDGE } from "./transcode-image.mts";

const WRITE = process.argv.includes("--write");
const DIRS = ["public/candidates", "public/officials"];

interface Candidate {
  path: string;
  bytes: number;
  ext: string;
}

const oversized: Candidate[] = [];
let walked = 0;
for (const dir of DIRS) {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    console.log(`  ${dir} — not present, skipped`);
    continue;
  }
  for (const name of entries) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (!stat.isFile()) continue;
    const ext = extname(name).toLowerCase();
    if (ext !== ".jpg" && ext !== ".jpeg" && ext !== ".png") continue;
    walked += 1;
    if (stat.size > PORTRAIT_MAX_BYTES) oversized.push({ path, bytes: stat.size, ext });
  }
}

oversized.sort((a, b) => b.bytes - a.bytes);
console.log(
  `\nportraits:normalise — walked ${walked} image(s), ` +
    `${oversized.length} over the ${Math.round(PORTRAIT_MAX_BYTES / 1024)} KB cap\n`,
);

if (oversized.length === 0) {
  console.log("  nothing over the cap. Reported rather than assumed.");
  process.exit(0);
}

let rewritten = 0;
let skipped = 0;
let before = 0;
let after = 0;

if (!WRITE) {
  for (const item of oversized) {
    console.log(`  ${String(Math.round(item.bytes / 1024)).padStart(6)} KB  ${item.path}`);
    before += item.bytes;
  }
  console.log(
    `\n  ${oversized.length} file(s), ${Math.round(before / 1024 / 1024)} MB total. ` +
      "Re-run with --write to resample them.",
  );
  process.exit(0);
}

const browser = await launchGuarded({ label: "portraits-normalise" });
try {
  const page = await browser.page({ viewport: { width: 800, height: 800 } });
  for (const item of oversized) {
    before += item.bytes;
    const raw = readFileSync(item.path);
    const kind = kindOf(raw);
    const wantJpeg = item.ext === ".jpg" || item.ext === ".jpeg";
    if ((wantJpeg && kind !== "jpeg") || (item.ext === ".png" && kind !== "png")) {
      console.log(`  SKIP     ${item.path} — extension says ${item.ext} but the bytes are ${kind}`);
      skipped += 1;
      after += item.bytes;
      continue;
    }
    await page.goto(pathToFileURL(item.path).toString(), { waitUntil: "load", timeout: 45_000 });
    await page.waitForFunction(
      "(() => { const i = document.querySelector('img'); return i && i.complete; })()",
      undefined,
      { timeout: 45_000 },
    );
    const dims = (await page.evaluate(
      "(() => { const i = document.querySelector('img'); return i ? { w: i.naturalWidth, h: i.naturalHeight } : { w: 0, h: 0 }; })()",
    )) as { w: number; h: number };
    if (!dims.w || !dims.h) {
      console.log(`  SKIP     ${item.path} — the browser read no pixels; a FAILED decode, not an empty file`);
      skipped += 1;
      after += item.bytes;
      continue;
    }
    const scale = Math.min(1, PORTRAIT_MAX_EDGE / Math.max(dims.w, dims.h));
    const width = Math.max(1, Math.round(dims.w * scale));
    const height = Math.max(1, Math.round(dims.h * scale));
    const mime = wantJpeg ? "image/jpeg" : "image/png";
    const dataUrl = (await page.evaluate(
      `(() => {
        const img = document.querySelector('img');
        const canvas = document.createElement('canvas');
        canvas.width = ${width};
        canvas.height = ${height};
        canvas.getContext('2d').drawImage(img, 0, 0, ${width}, ${height});
        return canvas.toDataURL('${mime}', 0.85);
      })()`,
    )) as string;
    const encoded = Buffer.from(dataUrl.split(",")[1] ?? "", "base64");
    if (encoded.length === 0) {
      console.log(`  SKIP     ${item.path} — encoder returned zero bytes; a FAILED transcode`);
      skipped += 1;
      after += item.bytes;
      continue;
    }
    if (encoded.length >= item.bytes) {
      console.log(
        `  SKIP     ${item.path} — re-encoding produced ${Math.round(encoded.length / 1024)} KB, ` +
          `no better than the ${Math.round(item.bytes / 1024)} KB already committed`,
      );
      skipped += 1;
      after += item.bytes;
      continue;
    }
    writeFileSync(item.path, encoded);
    rewritten += 1;
    after += encoded.length;
    console.log(
      `  REWROTE  ${item.path}  ${dims.w}x${dims.h} -> ${width}x${height}, ` +
        `${Math.round(item.bytes / 1024)} KB -> ${Math.round(encoded.length / 1024)} KB`,
    );
  }
} finally {
  await browser.close();
}

console.log(
  `\n  over the cap ${oversized.length}  rewritten ${rewritten}  skipped ${skipped}  ` +
    `${Math.round(before / 1024 / 1024)} MB -> ${Math.round(after / 1024 / 1024)} MB`,
);
