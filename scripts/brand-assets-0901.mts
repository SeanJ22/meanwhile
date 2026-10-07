/**
 * The brand's raster assets, rendered rather than drawn by hand.
 *
 *   pnpm build && pnpm exec tsx scripts/brand-assets-0901.mts
 *
 * Produces `app/apple-icon.png` (180×180), `app/opengraph-image.png`
 * (1200×630) and `app/favicon.ico`, as Next metadata-file conventions.
 *
 * The OG wordmark is EB Garamond 500, which `next/font` drops content-hashed
 * into `.next/static/media`, so this finds the built font files, mounts them
 * through a `file://` `@font-face`, and screenshots the result in a guarded
 * browser (`launchGuarded`). An OG image has one form, the dark palette; its
 * colours are read out of `globals.css` at render time.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
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
 * rewritten to a `file://` URL. Read from the BUILT stylesheet because the
 * files are content-hashed and split by subset. Zero faces throws: a fallback
 * serif would render a wordmark that is not the wordmark.
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

/**
 * The mark as a PNG, encoded by hand rather than screenshotted. Next refuses
 * the build unless a PNG-encoded `.ico` entry is RGBA, and Chromium encodes an
 * opaque page without alpha. The mark is two solid rectangles, so colour type
 * 6, one filter-0 scanline per row, deflated — byte-identical on every machine.
 */
function markPng(size: number): Buffer {
  const inset = Math.round((size * 3) / 16);
  const rgb = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const ground = rgb(BG);
  const square = rgb(MARK);

  /* One filter byte (0 = None) then width×RGBA per row. */
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      const inSquare = x >= inset && x < size - inset && y >= inset && y < size - inset;
      const [r, g, b] = inSquare ? square : ground;
      const at = rowStart + 1 + x * 4;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
      raw[at + 3] = 255;
    }
  }

  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // PNG integers are BIG-endian
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // colour type 6 = RGBA — the whole point of this function
  ihdr.writeUInt8(0, 10); // deflate
  ihdr.writeUInt8(0, 11); // adaptive filtering
  ihdr.writeUInt8(0, 12); // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
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

  /* ── favicon.ico: Next lists it ahead of `icon.svg`, so it must carry the
     mark too. Three PNG-encoded sizes at `app/icon.svg`'s proportions. */
  const icoEntries = [16, 32, 48].map((size) => ({ size, png: markPng(size) }));

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(icoEntries.length, 4);
  let offset = 6 + icoEntries.length * 16;
  const dir: Buffer[] = [];
  for (const e of icoEntries) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(e.size === 256 ? 0 : e.size, 0);
    entry.writeUInt8(e.size === 256 ? 0 : e.size, 1);
    entry.writeUInt8(0, 2); // palette size — 0 for true colour
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(e.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += e.png.length;
    dir.push(entry);
  }
  const ico = Buffer.concat([header, ...dir, ...icoEntries.map((e) => e.png)]);
  writeFileSync(join(ROOT, "app", "favicon.ico"), ico);
  console.log(`  ok  app/favicon.ico  ${icoEntries.map((e) => e.size).join("/")}  ${ico.length} bytes`);

  /* ── the Open Graph card: the wordmark lockup, nothing else. No map and no
     photograph, which would imply a place or an endorsing government. */
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

  await ogCtx.close();
  await browser.close();

  const bytes = readFileSync(ogPath).length;
  console.log(`  ok  app/opengraph-image.png  1200×630  ${bytes} bytes`);
}

await main();
