/**
 * **CAPTURE THE PEOPLE ON A BODY, AS A READER SEES THEM.**
 * (NJ Hunt 6, 2026-08-22. Evidence for item 1: what is RENDERING, not collected.)
 *
 * ```
 * pnpm shoot:officials njhunt6-rockaway-borough --zip 07866 --body "Rockaway"
 * SHOOT_BASE_URL=http://localhost:3100 pnpm shoot:officials <name> --zip <zip> --body <text>
 * ```
 *
 * ## Why a clicking shooter, and why it is parameterised
 *
 * A roster does not render until the reader opens the body on the who-governs
 * card, so `pnpm shoot` — which captures what loads — cannot photograph one.
 * That is precisely the surface this session changed, and RULING 2 is explicit:
 * a capture is evidence only once it has been READ AS AN IMAGE, and a DOM
 * assertion is not a substitute.
 *
 * RULING 76 says a session-dated shooter is worth less than a parameterised
 * one, so this takes the zip and the body rather than hardcoding either.
 *
 * ## It reports what it clicked
 *
 * The row it opened and the names visible afterwards are printed. A capture
 * whose claim does not match its contents is the failure three of NJ Hunt 5's
 * seven captures had, so the shooter states its own evidence rather than
 * leaving the filename to carry the claim.
 */

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { launchGuarded } from "./browser.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(root, "screenshots");
const BASE_URL = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(`--${flag}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const name = process.argv[2];
const zip = arg("zip");
const bodyText = arg("body");
const wait = Number(arg("wait") ?? 8000);
const [width, height] = (arg("viewport") ?? "430x932").split("x").map(Number);

if (!name || !zip || !bodyText) {
  console.error(
    'usage: pnpm shoot:officials <name> --zip 07866 --body "Rockaway" [--viewport 430x932] [--wait 8000]',
  );
  process.exit(2);
}

await mkdir(OUT_DIR, { recursive: true });
const browser = await launchGuarded({ label: "shoot-officials" });
const page = await browser.page({
  viewport: { width, height },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});

/*
 * The map entry renders its welcome overlay for a reader who has named no
 * place, so a `?zip=` alone photographs the overlay. Seeding the same keys the
 * app itself writes is what `pnpm walk:all` does, and it is the only way to
 * capture the surface a returning reader actually sees.
 */
await page.addInitScript(
  ({ zip }: { zip: string }) => {
    try {
      /*
       * **`wtp.approximate_location` is the key, and the name matters.** Seeding
       * `wtp.location` instead leaves the app with no place, so it renders the
       * welcome overlay — and a shooter then photographs the front door while
       * claiming to photograph a government. These are the keys `pnpm walk:all`
       * seeds, which are the ones the app actually reads.
       */
      sessionStorage.setItem(
        "wtp.approximate_location",
        JSON.stringify({ zip, savedAt: new Date().toISOString() }),
      );
      localStorage.setItem("wtp.tutorial_seen", "1");
      localStorage.setItem("wtp.recent_zips", JSON.stringify([zip]));
    } catch {
      // A blocked storage is not a reason to capture nothing; the wait below
      // will refuse rather than photograph the wrong surface.
    }
  },
  { zip },
);

await page.goto(BASE_URL, { waitUntil: "networkidle" });

/*
 * **Wait for the ROW, not for a clock.** The who-governs card is built from a
 * coverage fetch that lands well after `networkidle`, so a fixed sleep is a
 * race: the first run of this shooter refused twice because the card had not
 * arrived yet, which reads exactly like the body being absent. Waiting for the
 * thing we are about to click turns a flake into a fact.
 */
await page
  .waitForFunction(
    (needle: string) => (document.body.innerText ?? "").includes(needle),
    bodyText,
    { timeout: wait + 20_000 },
  )
  .catch(() => undefined);
await page.waitForTimeout(1500);

/**
 * Open the body. Matched on the row's own text so the caller names the body the
 * way a reader sees it, and the row that was clicked is REPORTED — a shooter
 * that silently clicked the wrong row would produce a capture whose claim and
 * contents disagree, which is the exact defect this file's header names.
 */
/*
 * Playwright's own text locator rather than a DOM scan: the row's label is
 * SPLIT ACROSS ELEMENTS — `Denville` and `township` are separate spans — so
 * `innerText.includes(...)` on any single short element finds nothing, and a
 * scan that widens until it matches ends up clicking the map marker behind the
 * card instead. That is exactly how a capture comes to disagree with its claim.
 */
const clicked = await (async (): Promise<string | null> => {
  // --exact for a short label like `Rockaway`, which is a PREFIX of several rows.
  const row = page.getByText(bodyText, { exact: process.argv.includes("--exact") }).first();
  if ((await row.count()) === 0) return null;
  const label = ((await row.innerText().catch(() => "")) || bodyText).replace(/\s+/g, " ").slice(0, 120);
  await row.scrollIntoViewIfNeeded().catch(() => undefined);
  await row.click({ timeout: 15_000 });
  return label;
})();

if (clicked === null) {
  // A refusal that does not say what it DID see is a wall with no rungs listed.
  const seen = await page.evaluate(() =>
    (document.body.innerText ?? "").replace(/\s+/g, " ").slice(0, 900),
  );
  console.error(
    `no row on the who-governs card contains ${JSON.stringify(bodyText)}. ` +
      "Refusing to write a capture that would claim to show a body it does not.\n" +
      `  what the page actually showed: ${seen}`,
  );
  await browser.close();
  process.exit(1);
}

await page.waitForTimeout(2500);

/*
 * The body panel opens with its sections collapsed, so a capture taken here
 * photographs the section HEADINGS — *Who sits on it · 8* — rather than the
 * eight people. The count is a fact about our data; the names are what the
 * reader came for, and what RULING 2 wants read as an image.
 */
const section = arg("open") ?? "Who sits on it";
const opened = await (async (): Promise<string | null> => {
  const target = page.getByText(section, { exact: false }).first();
  if ((await target.count()) === 0) return null;
  await target.scrollIntoViewIfNeeded().catch(() => undefined);
  await target.click({ timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  return section;
})();

const visible = await page.evaluate(() =>
  (document.body.innerText ?? "").replace(/\s+/g, " ").slice(0, 1400),
);

const file = join(OUT_DIR, `${name}.png`);
await page.screenshot({ path: file });

console.log(`${name} → screenshots/${name}.png`);
console.log(`  clicked: ${clicked}`);
console.log(`  section opened: ${opened ?? "(none found)"}`);
console.log(`  page text after opening: ${visible.slice(0, 700)}`);

await browser.close();
