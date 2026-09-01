/**
 * The brand's raster assets, rendered rather than drawn by hand — ITEM J.
 *
 *   pnpm build && pnpm exec tsx scripts/brand-assets-0901.mts
 *
 * Produces `app/apple-icon.png` (180×180) and `app/opengraph-image.png`
 * (1200×630). Both are Next metadata-file conventions: the framework emits
 * the tags for them without any code, which is why they are static files and
 * not an `ImageResponse` route.
 *
 * ## Why Playwright and not an SVG rasteriser
 *
 * The OG image carries the WORDMARK, and the wordmark is EB Garamond 500. A
 * rasteriser has no access to that face — `next/font` downloads it at build
 * time and drops it in `.next/static/media`, unnamed and content-hashed. So
 * this script finds the file the build actually produced, mounts it through a
 * `file://` `@font-face`, and screenshots the result. What ships is the same
 * face the site serves, not a lookalike.
 *
 * The browser comes from `launchGuarded` like every other browser in this
 * repo: a raw context leaks `x-wtp-synthetic-run` to third parties on unload.
 *
 * ## Why the colours are literal in here
 *
 * An OG image is fetched by a crawler with no stylesheet and no theme. It has
 * ONE form, and that form is the dark palette. The literals are pinned to
 * `globals.css` by `tests/brand-identity.test.ts` for `app/icon.svg`; this
 * script reads them out of the stylesheet at render time so it cannot drift
 * at all.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { launchGuarded } from "./browser.mts";

const ROOT = process.cwd();
const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8");

/** Read one token out of the DARK block — the block anchored at a line start. */
function darkToken(name: string): string {
  const at = css.indexOf("\n:root {");
  if (at < 0) throw new Error("no :root block at a line start");
  const block = css.slice(at, css.indexOf("\n}", at));
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(block);
  if (!m) throw new Error(`could not read ${name} out of the dark block`);
  return m[1];
}

const BG = darkToken("--bg");
const MARK = darkToken("--accent-state");
const TEXT = darkToken("--text");
const MUTED = darkToken("--text-muted");

/**
 * Every `@font-face` this build emitted for EB Garamond, with its `src`
 * rewritten to a `file://` URL.
 *
 * The font files are content-hashed and split by unicode subset, so there is
 * no single file to point at and no name to guess. Reading them out of the
 * BUILT stylesheet is the only way to be sure the OG image uses the same
 * bytes the site serves — and a woff2's name table is compressed, so scanning
 * the files themselves finds nothing.
 *
 * Zero faces is thrown on rather than fallen back from: a fallback serif
 * would render an OG image that is not the wordmark, and it would look fine.
 */
function garamondFaces(): { css: string; files: string[] } {
  const chunks = join(ROOT, ".next", "static", "chunks");
  const media = join(ROOT, ".next", "static", "media");
  const faces: string[] = [];
  const files: string[] = [];

  for (const name of readdirSync(chunks).filter((f) => f.endsWith(".css"))) {
    const sheet = readFileSync(join(chunks, name), "utf8");
    for (const m of sheet.matchAll(/@font-face\{[^}]*\}/g)) {
      const block = m[0];
      if (!block.includes("EB Garamond")) continue;
      const src = /url\(\.\.\/media\/([^)]+)\)/.exec(block);
      if (!src) continue;
      const file = join(media, src[1]);
      files.push(src[1]);
      faces.push(
        block
          .replace("EB Garamond", "EB Garamond Local")
          .replace(src[0], `url(${JSON.stringify(pathToFileURL(file).href)})`),
      );
    }
  }

  if (faces.length === 0) {
    throw new Error(
      `no EB Garamond @font-face in ${chunks} — the font did not reach the build. ` +
        "Run pnpm build first.",
    );
  }
  return { css: faces.join("\n"), files };
}

/** The lockup, as markup, at whatever size the caller asks for. */
function lockup(faceCss: string, sizePx: number): string {
  const beat = sizePx * 0.18;
  return `
  <style>
    ${faceCss}
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { background: ${BG}; }
    .lockup {
      display: inline-flex;
      align-items: baseline;
      gap: ${sizePx * 0.3}px;
      white-space: nowrap;
      padding: ${beat}px;
      line-height: 1;
    }
    .word {
      font-family: "EB Garamond Local", serif;
      font-weight: 500;
      font-size: ${sizePx}px;
      letter-spacing: ${sizePx * 0.004}px;
      color: ${TEXT};
      line-height: 1;
    }
    .beats { display: inline-block; width: ${(beat * 86) / 18}px; height: ${beat}px; }
  </style>
  <span class="lockup">
    <span class="word">meanwhile</span>
    <svg class="beats" viewBox="0 0 86 18">
      <circle cx="9" cy="9" r="9" fill="${MUTED}" />
      <circle cx="43" cy="9" r="9" fill="${MUTED}" />
      <rect x="68" y="0" width="18" height="18" fill="${MARK}" />
    </svg>
  </span>`;
}

async function main(): Promise<void> {
  const { css: faceCss, files } = garamondFaces();
  console.log(`  EB Garamond → ${files.length} subset file(s)`);

  const browser = await launchGuarded({ label: "brand-assets" });

  /* ── the Apple touch icon: the square alone, no type at all ────────────── */
  const iconCtx = await browser.context({
    viewport: { width: 180, height: 180 },
    deviceScaleFactor: 1,
  });
  const iconPage = await iconCtx.newPage();
  await iconPage.setContent(
    `<!doctype html><html><body style="margin:0;background:${BG}">
       <div style="width:180px;height:180px;background:${BG};display:flex;
                   align-items:center;justify-content:center">
         <div style="width:96px;height:96px;background:${MARK}"></div>
       </div>
     </body></html>`,
  );
  const applePath = join(ROOT, "app", "apple-icon.png");
  await iconPage.screenshot({ path: applePath });
  await iconCtx.close();
  console.log(`  ok  app/apple-icon.png  180×180`);

  /* ── the Open Graph card: the wordmark lockup, nothing else ───────────────
     No photograph and no map. A map behind a civic brand implies the product
     is about a place rather than about records, and a photograph of a
     building implies a specific government endorsed it. */
  const ogCtx = await browser.context({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  const ogPage = await ogCtx.newPage();
  await ogPage.setContent(
    `<!doctype html><html><body>
       <div style="width:1200px;height:630px;background:${BG};display:flex;
                   align-items:center;justify-content:center">
         ${lockup(faceCss, 128)}
       </div>
     </body></html>`,
  );
  await ogPage.evaluate("document.fonts.ready");
  await ogPage.waitForTimeout(400);
  const ogPath = join(ROOT, "app", "opengraph-image.png");
  await ogPage.screenshot({ path: ogPath });

  /* ── the legibility proof: the wordmark at its 18px floor and at 22px ──── */
  for (const theme of [
    { name: "dark", bg: BG, text: TEXT },
    { name: "light", bg: "#f0f2f5", text: "#1a1a2e" },
  ]) {
    for (const size of [18, 22]) {
      const page = await ogCtx.newPage();
      await page.setViewportSize({ width: 420, height: 120 });
      await page.setContent(
        `<!doctype html><html><body>
           <div style="width:420px;height:120px;background:${theme.bg};display:flex;
                       align-items:center;justify-content:center">
             ${lockup(faceCss, size).replace(TEXT, theme.text)}
           </div>
         </body></html>`,
      );
      await page.evaluate("document.fonts.ready");
      await page.waitForTimeout(200);
      const out = join(
        ROOT,
        "docs",
        "evidence",
        "brand-2026-09-01",
        `wordmark-${size}px-${theme.name}.png`,
      );
      await page.screenshot({ path: out, scale: "device" });
      await page.close();
      console.log(`  ok  wordmark-${size}px-${theme.name}.png`);
    }
  }

  await ogCtx.close();
  await browser.close();

  const bytes = readFileSync(ogPath).length;
  console.log(`  ok  app/opengraph-image.png  1200×630  ${bytes} bytes`);
  writeFileSync(
    join(ROOT, "docs", "evidence", "brand-2026-09-01", "assets.txt"),
    [
      `font subset files: ${files.join(", ")}`,
      `--bg ${BG}  --mark(--accent-state) ${MARK}  --text ${TEXT}  --text-muted ${MUTED}`,
      `app/apple-icon.png 180x180`,
      `app/opengraph-image.png 1200x630 ${bytes} bytes`,
      "",
    ].join("\n"),
    "utf8",
  );
}

await main();
