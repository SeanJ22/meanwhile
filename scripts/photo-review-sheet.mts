/**
 * `pnpm photo:sheet` — THE STANDING PORTRAIT REVIEW SHEET. (`R54`, Sean's
 * standing order, built 2026-08-24.)
 *
 * ## What Sean asked for, in his words
 *
 * One generated image — or a short set — holding **every pending portrait,
 * numbered**, dropped into the Drive mirror whenever anything is pending, and
 * **regenerated rather than hand-kept**. From then on he approves photos by
 * glancing at Drive and replying with numbers.
 *
 * ## Why this is a mechanism and not a job
 *
 * A portrait is the one thing in this product a machine cannot finally judge.
 * Every rung before this one exists to put a picture in front of a person who
 * can say yes or no — and until today the last step was a session writing
 * PROSE about images he could not see, in a tracker row, one row per hunt.
 * `NH78` sat that way from 2026-08-23 with all seven portraits sourced and
 * eyeballed; `NH30` from 2026-08-21; `NH65` from 2026-08-22.
 *
 * **Prose cannot do this job.** *A clean solo head-and-shoulders portrait on a
 * plain ground* is a true sentence about a picture, and it is not the picture.
 *
 * ## The numbering IS the interface
 *
 * Every pending portrait gets an index printed large on its tile. He replies
 * "1, 3, 4 yes, 2 no" and a session records exactly that. The sheet states the
 * date it was generated, so a reply can always be tied to the sheet it answers.
 *
 * ## When there is nothing pending
 *
 * It says so, and it still writes the sheet. **An empty queue is a fact worth
 * seeing** — it is the difference between "nothing is waiting for you" and
 * "the generator did not run", and those two must never look alike. That is
 * the same reason a check that could not RUN is reported apart from one that
 * FAILED (RULING 24).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";

import { officialPhotoForPerson } from "../lib/photos/person.ts";
import { reviewFor, stagedAwaitingReview } from "../lib/photos/review.ts";
import { launchGuarded } from "./browser.mts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const MIRROR = process.env.WTP_MIRROR ?? "G:/My Drive/we-the-people";
const OUT_DIR = join(ROOT, "docs", "photo-review");
const TODAY = today();

const personKey = (name: string): string =>
  name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(JR|SR|II|III|IV)\b\.?/g, "")
    .replace(/[^A-Z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

interface Pending {
  index: number;
  name: string;
  url: string;
  where: string;
}

const pending: Pending[] = [];

const cards = JSON.parse(
  readFileSync(join(ROOT, "data", "ballot", "candidate-cards-2026.json"), "utf8"),
) as { cards: Record<string, { photoUrl: string | null }> };

for (const [key, card] of Object.entries(cards.cards)) {
  const tail = key.split(":").pop() ?? "";
  const name =
    (key.includes("|") ? key.split("|").pop() : tail.split("-").reverse().join(" ")) ?? "";
  const official = officialPhotoForPerson(name);
  const url = official?.url ?? card.photoUrl;
  if (!url) continue;
  if (reviewFor(personKey(name), url).state !== "PENDING") continue;
  pending.push({ index: pending.length + 1, name, url, where: "candidate card" });
}

/*
 * STAGED PORTRAITS, WHICH HAD NO CHANNEL HERE UNTIL 2026-08-25 — NJ22.
 *
 * The loop above asks which portraits ON A CARD are unapproved. That is the
 * right question for one already written onto a card, and it means a portrait a
 * hunt FOUND and correctly refused to ship was invisible to the author: the only
 * way onto this sheet was to do the thing the rule forbids.
 *
 * `pnpm door2` found six on sitting officials' own municipal .gov pages, four
 * of them new, and shipped none. The sheet then showed three pending, none of
 * them his.
 *
 * A staged row carries WHERE it was found and WHY it matched, so a wrong face is
 * arguable rather than asserted — and it is still not approval and still not
 * rendering. `photoMayRender` is untouched.
 */
for (const staged of stagedAwaitingReview()) {
  if (pending.some((x) => x.url === staged.url)) continue;
  pending.push({
    index: pending.length + 1,
    name: staged.name,
    url: staged.url,
    where: `STAGED · ${staged.door.split(" — ")[0]} · ${staged.foundOn}`,
  });
}

console.log(`portrait review sheet — ${pending.length} pending`);
console.log(`  of which STAGED (found, not shipped): ${pending.filter((x) => x.where.startsWith("STAGED")).length}`);

const dataUri = (url: string): string => {
  const local = url.startsWith("/") ? join(ROOT, "public", url.slice(1)) : null;
  if (!local || !existsSync(local)) return url;
  const ext = local.slice(local.lastIndexOf(".") + 1).toLowerCase();
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${readFileSync(local).toString("base64")}`;
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const tiles = pending
  .map(
    (p) =>
      `<figure><div class="n">${p.index}</div>` +
      `<img src="${dataUri(p.url)}" alt="portrait ${p.index}">` +
      `<figcaption><b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.where)}</span></figcaption>` +
      `</figure>`,
  )
  .join("");

const emptyBlock =
  `<div class="empty"><h2>Nothing is waiting for you.</h2>` +
  `<p>Every portrait this product holds has a decision recorded against it.</p>` +
  `<p class="small">This sheet still generated, on purpose — an empty queue and a ` +
  `generator that did not run must never look the same.</p></div>`;

const style = [
  /*
   * `box-sizing` FIRST, and it is not a nicety.
   *
   * The body carried 28px of padding with the default `content-box`, so on the
   * 1180px viewport below the content box was 1180 wide PLUS 56px of padding and
   * the last tile in a row ran off the right edge — its URL clipped mid-word.
   * Read as an image on 2026-08-25, which is the only way anyone would ever have
   * seen it: the file is a valid PNG at a healthy byte count either way.
   *
   * This sheet is the ONLY channel a portrait has to the author. A tile he
   * cannot read is a portrait he cannot judge.
   */
  "*,*::before,*::after{box-sizing:border-box}",
  "body{margin:0;padding:28px;background:#12131a;color:#e8e8ee;",
  "font:15px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif}",
  "h1{font-size:19px;margin:0 0 4px}",
  ".sub{color:#9a9aa8;font-size:13px;margin:0 0 22px}",
  ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:18px}",
  "figure{margin:0;background:#1c1d27;border:1px solid #2c2d3a;border-radius:10px;",
  "overflow:hidden;position:relative}",
  ".n{position:absolute;top:8px;left:8px;z-index:2;background:#f0b429;color:#12131a;",
  "font-weight:700;font-size:16px;min-width:28px;height:28px;border-radius:6px;",
  "display:flex;align-items:center;justify-content:center;padding:0 6px}",
  "img{width:100%;height:250px;object-fit:cover;object-position:center top;display:block;",
  "background:#24252f}",
  /*
   * A URL DOES NOT WRAP UNLESS IT IS TOLD TO, and a staged row's caption is a
   * URL. Without `overflow-wrap`, `https://www.peqtwp.org/243/Township-Council`
   * runs past the tile's right edge and the author reads half an address —
   * which, on the only channel a portrait has to him, is the same as not
   * telling him where it came from.
   */
  "figcaption{padding:9px 11px;font-size:13px;display:flex;flex-direction:column;gap:2px;",
  "overflow-wrap:anywhere;word-break:break-word}",
  "figcaption span{color:#9a9aa8;font-size:11.5px}",
  ".empty{padding:56px 8px}.empty h2{margin:0 0 8px;font-size:17px}",
  ".empty p{margin:0 0 6px;color:#9a9aa8}.small{font-size:12px}",
  "footer{margin-top:26px;color:#9a9aa8;font-size:12px;border-top:1px solid #2c2d3a;",
  "padding-top:12px}",
].join("");

const html =
  `<!doctype html><meta charset="utf-8"><style>${style}</style>` +
  `<h1>Portraits waiting on you — ${TODAY}</h1>` +
  `<p class="sub">${pending.length} pending. Reply with the numbers.</p>` +
  (pending.length > 0 ? `<div class="grid">${tiles}</div>` : emptyBlock) +
  `<footer>Generated by <code>pnpm photo:sheet</code> — regenerated, never hand-kept. ` +
  `A photo renders only once you have approved it; until then the card shows initials, ` +
  `which this product treats as a success. Refusing one image says nothing about whether a ` +
  `correct portrait exists, and the hunt continues either way.</footer>`;

mkdirSync(OUT_DIR, { recursive: true });
const pagePath = join(OUT_DIR, "sheet.html");
writeFileSync(pagePath, html);

/*
 * Opened through the guarded harness, never Playwright directly: every context
 * it hands back declares this run, so nothing this script touches can be read
 * later as reader signal. `page()` and `context()` are deliberately NOT
 * named after Playwright's own methods, so the guard test can refuse the raw
 * ones outright.
 */
const browser = await launchGuarded({ label: "photo-sheet" });
const page = await browser.page({ viewport: { width: 1180, height: 900 } });
await page.goto(`file:///${pagePath.replace(/\\/g, "/")}`);
await page.waitForLoadState("networkidle");

/*
 * A STABLE filename, deliberately. Sean approves photos by glancing at Drive,
 * so what he wants there is THE CURRENT SHEET — not an archive that grows a
 * file a day and makes him work out which one is live. The date is printed
 * inside the image, where it belongs, and git history keeps every version.
 */
const pngPath = join(OUT_DIR, "portraits-pending.png");
await page.screenshot({ path: pngPath, fullPage: true });
await browser.close();

/*
 * RULING 113 — observe the step's product AT THE STEP. A screenshot call that
 * returned without writing a real image would otherwise be discovered by Sean
 * opening an empty file in Drive, which is the worst place to find out.
 */
if (!existsSync(pngPath)) {
  console.error("REFUSED: the screenshot step reported success and wrote no file.");
  process.exit(1);
}
const bytes = readFileSync(pngPath);
if (bytes.length < 1000 || bytes[0] !== 0x89 || bytes[1] !== 0x50) {
  console.error(
    `REFUSED: ${pngPath} is ${bytes.length} byte(s) and does not carry the PNG signature.`,
  );
  process.exit(1);
}
console.log(`  wrote ${pngPath} — ${bytes.length} bytes, real PNG`);

if (existsSync(MIRROR)) {
  const dest = join(MIRROR, "portraits-pending.png");
  copyFileSync(pngPath, dest);
  console.log(`  mirrored to ${dest}`);
} else {
  /*
   * RULING 108 — the repo copy is the PRIMARY output and is never guarded. A
   * mirror failure is a warning about the mirror, never a reason to produce
   * nothing.
   */
  console.log(`  NOTE: no Drive mirror at ${MIRROR} — the repo copy is the primary output.`);
}
