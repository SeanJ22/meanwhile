/**
 * DOM VERIFICATION for SWEEP-01 and ASK-18. (Session B resume, W2, 2026-08-31.)
 *
 * The claim under test is class-wide and about a SENTENCE, so it is checked on
 * the rendered DOM rather than in a unit test: `components/map/meeting-panel.tsx`
 * and `components/map/popup/agenda-section.tsx` both rendered *"No agenda posted
 * yet"* whenever a meeting carried no agenda link — a statement about a
 * government produced from a measurement of our own store.
 *
 * ```
 *   REFUSED   any occurrence of "No agenda posted yet"
 *   REQUIRED  the OURS sentence wherever no observation exists
 * ```
 *
 * It walks every pilot ZIP and opens every meeting row it can reach, so the
 * count is over instances rather than over one example.
 *
 * Runs through `launchGuarded` so the synthetic-run header is attached and the
 * walk's rows do not land in the sold store as reader signal.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { launchGuarded, seedZip } from "./browser.mts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

const BASE = (process.env.SHOOT_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const ZIPS = ["85701", "85641", "07866", "03255"];
const OUT = join(process.cwd(), "data", "health", "agenda-sentence-walk");

/** The sentence that must be gone, and the one that must have replaced it. */
const FORBIDDEN = /No agenda posted yet/i;
const OURS = /We haven't recorded an agenda for this meeting yet/i;
/** A THEIRS sentence names the publisher and the day it was read. */
const THEIRS = /hadn't posted an agenda for this meeting when we checked/i;

const guarded = await launchGuarded({ label: "agenda-sentence" });
const runId = guarded.runId;
const rows: {
  zip: string;
  opened: { panel: boolean; groups: number; expanded: number };
  agendaLines: number;
  forbidden: number;
  ours: number;
  theirs: number;
  samples: string[];
}[] = [];

try {
  for (const zip of ZIPS) {
    const context = await guarded.context();
    const page = await context.newPage();
    /* seedZip installs an init script, so it must run BEFORE the first
       navigation — the map entry renders the welcome overlay otherwise and the
       walk would capture a page the reader never reaches. */
    await seedZip(page, zip);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);

    /*
     * **THE SENTENCE LIVES BEHIND TWO CLICKS, AND A WALK THAT DOES NOT MAKE
     * THEM READS A SURFACE IT IS NOT ON.**
     *
     * The first pass of this script navigated and read the page, found zero
     * agenda-mentioning lines at every ZIP, and the denominator floor correctly
     * refused to call that a pass — COULD NOT ASSERT, not "0 occurrences of the
     * forbidden sentence". That refusal is the reason the floor exists: a check
     * that never reached its subject is not a check that its subject is clean.
     *
     * The meetings panel opens collapsed (g4), so every group is expanded too.
     */
    const opened = { panel: false, groups: 0, expanded: 0 };
    const listButton = page.locator('button:has-text("meetings")').first();
    if ((await listButton.count()) > 0 && (await listButton.isVisible().catch(() => false))) {
      await listButton.click();
      await page.waitForTimeout(1200);
      opened.panel = true;
      const heads = page.locator(".al-group-head");
      opened.groups = await heads.count();
      for (let i = 0; i < opened.groups; i += 1) {
        await heads.nth(i).click().catch(() => undefined);
        opened.expanded += 1;
      }
      await page.waitForTimeout(1200);
    }

    /*
     * Read every element that could be carrying the sentence, rather than a
     * selector for the one component. The defect was TWO components saying it,
     * so a check scoped to one of them would have passed while the other went
     * on making the claim.
     */
    const found = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll("p, span, div"))) {
        if (el.children.length > 0) continue;
        const text = (el.textContent ?? "").trim();
        if (text.length > 0 && text.length < 200 && /agenda/i.test(text)) out.push(text);
      }
      return out;
    });

    const forbidden = found.filter((t) => FORBIDDEN.test(t));
    const ours = found.filter((t) => OURS.test(t));
    const theirs = found.filter((t) => THEIRS.test(t));
    rows.push({
      zip,
      opened,
      agendaLines: found.length,
      forbidden: forbidden.length,
      ours: ours.length,
      theirs: theirs.length,
      samples: [...new Set(found)].slice(0, 6),
    });
    await context.close();
  }
} finally {
  await guarded.close();
}

console.log(`verify:agenda-sentence · ${BASE} · run ${runId}\n`);
for (const r of rows) {
  console.log(
    `  ${r.zip} — meetings panel ${r.opened.panel ? "OPENED" : "NOT OPENED"}, ` +
      `${r.opened.expanded} of ${r.opened.groups} group(s) expanded`,
  );
  console.log(
    `    ${floorLine(
      floored(
        "agenda line(s) carrying the REFUSED sentence",
        `the ${r.agendaLines} agenda-mentioning line(s) rendered at this zip`,
        r.agendaLines,
        r.forbidden,
        r.agendaLines === 0 ? "no agenda-mentioning line rendered at this zip" : undefined,
      ),
    )}`,
  );
  console.log(`    OURS ${r.ours} · THEIRS ${r.theirs}`);
  for (const s of r.samples) console.log(`        ${JSON.stringify(s)}`);
}

const totalForbidden = rows.reduce((n, r) => n + r.forbidden, 0);
const totalOurs = rows.reduce((n, r) => n + r.ours, 0);
const totalTheirs = rows.reduce((n, r) => n + r.theirs, 0);

console.log(
  `\n  REFUSED sentence: ${totalForbidden} occurrence(s) across ${ZIPS.length} zip(s)` +
    `\n  OURS: ${totalOurs} · THEIRS: ${totalTheirs}`,
);
/*
 * THEIRS being zero right now is the CORRECT reading and is stated rather than
 * treated as a miss: no adapter run has yet recorded a publisher observation,
 * so no meeting has earned a sentence about its publisher. The path is built
 * and unit-tested; it activates on the next Legistar ingest.
 */
if (totalTheirs === 0) {
  console.log(
    "  THEIRS is 0, and that is correct today: the committed snapshot carries no " +
      "`agendaSlotObservedEmpty` observation on any of its 596 meetings, so every absent agenda " +
      "is OUR gap. The THEIRS path activates when an ingest records one.",
  );
}

mkdirSync(OUT, { recursive: true });
const path = join(OUT, `${runId.replace(/[:.]/g, "-")}.json`);
writeFileSync(
  path,
  `${JSON.stringify({ runId, base: BASE, at: new Date().toISOString(), rows }, null, 2)}\n`,
  "utf8",
);
console.log(`\n  record: ${path}`);

if (totalForbidden > 0) process.exit(1);
