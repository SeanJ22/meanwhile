/**
 * **A PORTRAIT MADE READABLE, SO RULING 2 CAN ACTUALLY BE OBEYED** (built
 * 2026-08-21, NH Hunt 4 item 2).
 *
 * ```
 * pnpm image:view <image-url-or-file> [<more> …] [--out <dir>] [--width 640]
 * ```
 *
 * RULING 2 says a capture is evidence only once it has been READ AS AN IMAGE,
 * and the photo rule says a portrait is judged by a person looking at it. Both
 * assume the image can be opened. Campaign sites increasingly serve `.webp`
 * and `.avif`, and Squarespace serves WebP bytes under a `.jpg` URL — so the
 * file that arrives is frequently one this session cannot open, and the hunt
 * stops on a format rather than on a fact. `CLAUDE.md` is explicit that the
 * absence of a tool is never a wall, so here is the tool.
 *
 * It renders the image in a browser — the one client that reads every format a
 * browser serves — and writes a PNG the reader can open. The PIXELS ARE NOT
 * JUDGED HERE: this makes a picture openable and nothing else. Whether it is a
 * clean solo portrait of the right person stays a human judgement, exactly as
 * the four-door rule requires.
 *
 * ## What it reports, always
 *
 * Every input prints its outcome: `RENDERED` with the source and natural
 * dimensions, `EMPTY` when the browser loaded nothing (a 404 image is a failed
 * read, never a blank portrait), or `FAILED` with the reason. A run that
 * rendered nothing exits non-zero — a zero-row extraction is a failed
 * extraction, never an empty document.
 *
 * The natural dimensions are printed because they are the one thing a caller
 * cannot see in the downscaled PNG, and a 96×96 avatar upscaled to 640 looks
 * like a portrait until you know it was 96 pixels wide.
 */
import { mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { launchGuarded } from "./browser.mts";

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const outDir = outAt >= 0 ? args[outAt + 1] : ".scratch/img";
const widthAt = args.indexOf("--width");
const width = widthAt >= 0 ? Number(args[widthAt + 1]) : 640;
const inputs = args.filter((a, i) => {
  if (a.startsWith("--")) return false;
  if (outAt >= 0 && i === outAt + 1) return false;
  if (widthAt >= 0 && i === widthAt + 1) return false;
  return true;
});

if (inputs.length === 0) {
  console.error("pnpm image:view <image-url-or-file> [...] [--out <dir>] [--width 640]");
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });

/** A local path becomes a `file://` URL; anything else is passed through. */
function asUrl(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  if (!existsSync(input)) throw new Error(`no such file: ${input}`);
  return pathToFileURL(resolve(input)).toString();
}

function nameFor(input: string, index: number): string {
  const base = input.split(/[/\?]/).filter(Boolean).pop() ?? `image-${index}`;
  return `${String(index + 1).padStart(2, "0")}-${base.replace(/[^A-Za-z0-9._-]/g, "-").slice(-60)}.png`;
}

const browser = await launchGuarded({ label: "image-view" });
let rendered = 0;
try {
  const page = await browser.page({ viewport: { width, height: width } });
  for (const [index, input] of inputs.entries()) {
    const out = join(outDir, nameFor(input, index));
    try {
      const url = asUrl(input);
      /* `goto` rather than an injected <img> on a blank origin: Chromium
       * renders a bare image in its own viewer, which loads `file://` and
       * cross-origin bytes that the injected element is refused. The first
       * build of this tool used `setContent` and reported EMPTY for every
       * input — a tool reporting its own blindness as the document being
       * empty, which is the exact defect this file exists to prevent. */
      await page.goto(url, { waitUntil: "load", timeout: 45_000 });
      await page.waitForFunction(
        "(() => { const i = document.querySelector('img'); return i && i.complete; })()",
        undefined,
        { timeout: 45_000 },
      );
      const dims = (await page.evaluate(
        "(() => { const i = document.querySelector('img'); return i ? { w: i.naturalWidth, h: i.naturalHeight } : { w: 0, h: 0 }; })()",
      )) as { w: number; h: number };
      if (!dims.w || !dims.h) {
        console.log(`EMPTY      ${input} — the browser loaded no pixels; this is a FAILED read, not a blank image`);
        continue;
      }
      await page.setViewportSize({ width, height: Math.max(200, Math.round((width * dims.h) / dims.w)) });
      const element = await page.$("img");
      await element!.screenshot({ path: out });
      rendered += 1;
      console.log(`RENDERED   ${input}\n           natural ${dims.w}x${dims.h} -> ${out}`);
    } catch (error) {
      console.log(`FAILED     ${input} — ${(error as Error).message.split("\n")[0]}`);
    }
  }
} finally {
  await browser.close();
}

console.log(`\n${rendered} of ${inputs.length} rendered (run ${browser.runId})`);
if (rendered === 0) process.exit(1);
