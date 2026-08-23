/**
 * **THE SIX PORTRAITS, READ AS IMAGES, IN ONE LOOK.** (NJ Hunt 4 item 5,
 * 2026-08-22. RULING 2, RULING 55, and the photo rule's composition standards.)
 *
 * ```
 * pnpm nj:portraits          # download, build the sheet, shoot it
 * ```
 *
 * RULING 2 makes a capture evidence only once it has been READ AS AN IMAGE, and
 * the photo rule's composition standards — a clean solo portrait, the
 * unambiguous sole subject, never a banner, a wordmark, a group shot or an
 * event candid — are a judgement nothing automated can make. `pnpm sheet`
 * already builds a contact sheet out of `screenshots/`; this does the same for
 * REMOTE portrait URLs a hunt proposed, so six faces are judged in one look
 * rather than six.
 *
 * It downloads nothing into the repo. The images are inlined as `data:` URIs in
 * a throwaway page under the scratch directory; committing a portrait happens
 * later, through `pnpm ship:candidate`, which strips EXIF and normalises the
 * file. **Nothing here approves anything** — RULING 55 leaves that with the
 * author, and this only makes the looking possible.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { launchGuarded } from "./browser.mts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "screenshots");
const AS_OF = today();

interface FieldsFile {
  roster: {
    candidacyId: string;
    name: string;
    pageUrl: string;
    imageUrl: string | null;
    imageScope: string | null;
  }[];
}

const fields = JSON.parse(
  readFileSync(join(ROOT, "data", "hunt", "nj-hunt4-fields.json"), "utf8"),
) as FieldsFile;

const wanted = new Map<string, FieldsFile["roster"][number]>();
for (const f of fields.roster) if (f.imageUrl && !wanted.has(f.candidacyId)) wanted.set(f.candidacyId, f);

if (wanted.size === 0) {
  console.error("No portrait was proposed. That is a failed read of the fields file, not an empty one.");
  process.exit(1);
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const cells: string[] = [];
let downloaded = 0;
let failed = 0;
for (const row of wanted.values()) {
  const url = row.imageUrl!.replace(/&#0?38;/g, "&");
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Referer: row.pageUrl } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get("content-type") ?? "image/jpeg";
    downloaded++;
    cells.push(
      `<figure><img src="data:${type};base64,${buf.toString("base64")}" alt="">` +
        `<figcaption><b>${row.name}</b><br>${(buf.length / 1024).toFixed(0)} KB · ${type}<br>` +
        `<span class="u">${url.replace(/</g, "&lt;").slice(0, 110)}</span></figcaption></figure>`,
    );
  } catch (e) {
    failed++;
    cells.push(
      `<figure class="wall"><div class="x">could not be read</div>` +
        `<figcaption><b>${row.name}</b><br>${(e as Error).message}<br>` +
        `<span class="u">${url.replace(/</g, "&lt;").slice(0, 110)}</span></figcaption></figure>`,
    );
  }
}

const html = `<!doctype html><meta charset="utf-8"><style>
body{background:#fff;color:#111;font:13px/1.4 system-ui,sans-serif;margin:0;padding:16px}
h1{font-size:15px;margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
figure{margin:0;border:1px solid #ccc;padding:8px;background:#fafafa}
img{display:block;width:100%;height:260px;object-fit:contain;background:#fff}
.wall .x{height:260px;display:grid;place-items:center;background:#fee;color:#900}
figcaption{margin-top:6px;font-size:11px}
.u{color:#666;word-break:break-all}
</style><h1>NJ Hunt 4 — portraits proposed on ${AS_OF} (${downloaded} read, ${failed} could not be read)</h1>
<div class="grid">${cells.join("")}</div>`;

mkdirSync(OUT_DIR, { recursive: true });
const page = join(OUT_DIR, "nj-hunt4-portraits.html");
writeFileSync(page, html, "utf8");

const guarded = await launchGuarded({ label: "nj-hunt4-portraits" });
const p = await guarded.page({ viewport: { width: 1100, height: 900 } });
await p.goto(`file:///${page.replace(/\\/g, "/")}`);
await p.waitForLoadState("networkidle");
const shot = join(OUT_DIR, "nj-hunt4-portraits.png");
await p.screenshot({ path: shot, fullPage: true });
await guarded.close();

console.log(
  `portrait sheet — ${wanted.size} proposed · ${downloaded} downloaded and drawn · ${failed} could not be read`,
);
console.log(`  wrote ${shot}`);
