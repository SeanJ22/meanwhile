/**
 * **F01-continued items 8 and 9 — the verification, on the four pilot zips.**
 *
 * Item 8: the "my ballot" tally counted measures and not candidates.
 * Item 9: "Clear my picks" removed the card and left the picks below it.
 *
 * This drives a real browser at phone width and reads what a reader would
 * see: how many pick controls the ballot renders, what the tally's own
 * denominator says, what the numerator does with one pick of EACH kind, and
 * whether a clear leaves any pick standing — including after a reload, which
 * is where a suppression living only in React state would show up.
 *
 * **LOCALHOST ONLY, and the refusal is deliberate.** A derived pick comes
 * from a real Yes on the reaction control, and a reaction tap is a WRITE.
 * `walk:all` excludes the write paths by name for exactly this reason. Here
 * the tap is the thing under test, so the script refuses any base URL that is
 * not localhost rather than being careful about it — the local
 * `DATABASE_URL` points at a Neon branch that cannot authenticate, so the
 * POST fails at the driver and nothing lands anywhere, while
 * `rememberReaction` writes the device-local record BEFORE the fetch, which
 * is the half a derived pick is computed from.
 *
 * The one-time disclosure is acknowledged by writing its own device-local key
 * before the first tap. That is not a bypass of consent — it is this script
 * declaring that it is not a reader, and the notice's own behaviour (shown
 * once per device, acknowledged, never again) is pinned by
 * `tests/reactions.test.ts` rather than by this walk.
 *
 *   corepack pnpm exec tsx scripts/verify-picks-f01c.mts
 */
import { launchGuarded } from "./browser.mts";

const BASE = process.env.PICKS_BASE_URL ?? "http://localhost:3000";
if (!/^http:\/\/localhost:/.test(BASE)) {
  console.error(
    `refusing to run against ${BASE}. This walk TAPS A REACTION, which is a\n` +
      "write path, and write paths do not run against production. Point it at\n" +
      "http://localhost:<port> or do not run it.",
  );
  process.exit(2);
}

const ZIPS = ["85701", "85641", "07866", "03255"];
const PHONE = { width: 430, height: 932 };

const browser = await launchGuarded({ label: "f01c-picks" });
let failures = 0;
const summary: string[] = [];

const say = (ok: boolean, line: string) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${line}`);
};

const STATED_PICKS = `Array.from(document.querySelectorAll('.reaction-box-prompt'))
  .map((e) => (e.textContent || '').trim())
  .filter((t) => /^Your pick for this race:/.test(t))`;

for (const zip of ZIPS) {
  console.log(`\n── ${zip} ─────────────────────────────────────────`);
  const context = await browser.context({ viewport: PHONE, reducedMotion: "reduce" });
  // The disclosure ack, before any page script runs, so the first tap records
  // rather than parking behind the notice.
  await context.addInitScript(
    "try { window.localStorage.setItem('wtp.reaction_disclosure_ack', '1'); } catch {}",
  );
  const page = await context.newPage();
  await page.goto(`${BASE}/ballot?zip=${zip}`, {
    waitUntil: "domcontentloaded",
    timeout: 180_000,
  });
  await page.waitForTimeout(4_000);

  // ── the denominator, against the rows the page actually renders ─────────
  const controls = await page.locator('[data-kind="pick"]').count();
  console.log(`     pick controls rendered: ${controls}`);
  if (controls === 0) {
    summary.push(`${zip}: no pick controls — nothing to tally`);
    console.log("     (no contests on this ballot — nothing to tally)");
    await context.close();
    continue;
  }

  /*
   * One pick of EACH kind, and they must land in DIFFERENT contests — an
   * explicit pick outranks a derived one within a contest, so putting both in
   * the first contest would resolve to a single pick and a conflict line, and
   * the tally would read 1 while looking exactly like the defect. The
   * explicit tap goes to the LAST pick control (a measure, which has no
   * reaction to derive from) and the Yes to the FIRST candidate reaction box.
   */
  await page.locator('[data-kind="pick"] .reaction-choice').last().click();
  await page.waitForTimeout(1_000);

  // `.reaction-box` without `data-kind="pick"` is the reaction sensor; its
  // Yes is the answer M134 derives a pick from.
  const yes = page
    .locator('.reaction-box:not([data-kind="pick"]) .reaction-choice')
    .filter({ hasText: /^Yes/ });
  const yesCount = await yes.count();
  if (yesCount > 0) {
    await yes.first().click();
    await page.waitForTimeout(1_500);
  }
  console.log(`     candidate Yes controls available: ${yesCount}`);

  const tally = (await page.evaluate(
    `(() => { const e = document.querySelector('[data-pick-tally]'); return e ? { picked: e.getAttribute('data-picked'), pickable: e.getAttribute('data-pickable'), text: (e.textContent || '').trim() } : null; })()`,
  )) as { picked: string; pickable: string; text: string } | null;

  say(tally !== null, `${zip}: the tally renders — ${tally ? tally.text : "ABSENT"}`);
  if (tally) {
    say(
      Number(tally.pickable) === controls,
      `${zip}: denominator ${tally.pickable} equals the ${controls} pick control(s) rendered`,
    );
    const expected = yesCount > 0 ? 2 : 1;
    say(
      Number(tally.picked) >= expected,
      `${zip}: numerator counts ${expected === 2 ? "the explicit AND the derived pick" : "the explicit pick"} — N=${tally.picked}`,
    );
    const rows = (await page.evaluate(
      `document.querySelectorAll('[data-pick-tally] ~ ul > li').length`,
    )) as number;
    say(
      rows === Number(tally.picked),
      `${zip}: stated N (${tally.picked}) equals ${rows} rendered row(s)`,
    );
    summary.push(`${zip}: N=${tally.picked} of M=${tally.pickable}, ${rows} row(s) rendered`);
  }

  // ── item 9: the clear must clear ────────────────────────────────────────
  const statedBefore = (await page.evaluate(`(${STATED_PICKS}).length`)) as number;
  console.log(`     contests STATING a pick before the clear: ${statedBefore}`);

  // Screenshot before believing green — the standing rule. The picks box is
  // scrolled to rather than shot full-page, because what has to be LOOKED at
  // is the tally line and the rows it claims to describe.
  await page.locator("[data-pick-tally]").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `screenshots/f01c-picks-${zip}-before.png` });

  await page.getByRole("button", { name: "Clear my picks" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.waitForTimeout(1_200);

  const afterClear = (await page.evaluate(
    `(() => ({
       card: Boolean(document.querySelector('[data-pick-tally]')),
       stated: (${STATED_PICKS}).length,
       sample: (${STATED_PICKS})[0] || '',
       stored: window.localStorage.getItem('wtp.ballot_picks') || '',
     }))()`,
  )) as { card: boolean; stated: number; sample: string; stored: string };

  say(!afterClear.card, `${zip}: the picks box is gone after clearing`);
  say(
    afterClear.stated === 0,
    `${zip}: no contest still STATES a pick after clearing` +
      (afterClear.stated ? ` — ${afterClear.stated} left, e.g. "${afterClear.sample}"` : ""),
  );

  // ── and it survives a reload, which is where a state-only clear dies ────
  await page.reload({ waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForTimeout(4_000);
  const afterReload = (await page.evaluate(
    `(() => ({
       card: Boolean(document.querySelector('[data-pick-tally]')),
       stated: (${STATED_PICKS}).length,
     }))()`,
  )) as { card: boolean; stated: number };
  await page.screenshot({ path: `screenshots/f01c-picks-${zip}-after.png`, fullPage: true });
  say(!afterReload.card, `${zip}: still cleared after a reload — no picks box`);
  say(
    afterReload.stated === 0,
    `${zip}: still cleared after a reload — ${afterReload.stated} stated pick(s)`,
  );

  await context.close();
}

await browser.close();
console.log("\n── what the four zips reported ──────────────────────────");
summary.forEach((s) => console.log(`  ${s}`));
console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} — ${ZIPS.length} zip(s) walked`,
);
process.exit(failures === 0 ? 0 : 1);
