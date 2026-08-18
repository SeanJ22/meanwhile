/**
 * R41 — the optional reply field (2026-08-17, the author's ruling A).
 *
 * The row's own walk checks, in its own script because two of the three
 * WRITE a real feedback row. The standing suite excludes write-path checks by
 * name (`scripts/walk-all.mts`, `EXCLUDED`), and R41 joins that list rather
 * than quietly becoming the first exception to it.
 *
 * The three checks the row demands:
 *
 *  1. **a blank submit succeeds** — the field is optional, so leaving it alone
 *     must be the effortless default all the way through to a 204;
 *  2. **an address stores in the feedback store only** — read back through the
 *     production read handle, and asserted absent from the other stores;
 *  3. **the join check passes** — `tests/db-schema.test.ts` proves the column
 *     cannot exist elsewhere in the SCHEMA; this proves it does not exist
 *     elsewhere in the DATABASE, which is a different claim and the one a
 *     migration could have broken.
 *
 * Both probe rows are SYNTHETIC-marked with this run's id and are named in the
 * session report. They are LEFT IN PLACE deliberately — the author's queue
 * shows them as declared automated, and deleting them would remove the only
 * standing evidence that a reply address round-trips.
 *
 * `WTP_RUN_ID=<label> pnpm tsx scripts/walk-r41.mts` (SHOOT_BASE_URL to aim it)
 */
import { chromium } from "playwright";
import { join } from "node:path";

import { config as loadEnv } from "dotenv";
import { neon } from "@neondatabase/serverless";

import { syntheticRunHeaders } from "../lib/db/run-marker.ts";

loadEnv({ path: join(process.cwd(), ".env.local") });

const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";
const OUT = "C:/Users/seanj/dev/we-the-people/screenshots";
const HEADERS = syntheticRunHeaders();
const RUN_ID = process.env.WTP_RUN_ID ?? null;

const results: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function cannotRun(name: string, why: string) {
  results.push(`CANNOT-RUN ${name} — ${why}`);
}

if (!RUN_ID) {
  // C05: an undeclared automated run lands as ORGANIC in the store we sell.
  // This script writes, so it refuses rather than contaminating it.
  console.error(
    "walk-r41: WTP_RUN_ID is not set. This script WRITES to the feedback store, and an " +
      "undeclared write is indistinguishable from a reader. Refusing.",
  );
  process.exit(1);
}

const browser = await chromium.launch();

/** Fill the form and submit, returning the HTTP status and the rendered state. */
async function submit(message: string, replyTo: string | null) {
  const context = await browser.newContext({
    extraHTTPHeaders: HEADERS,
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/feedback`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(1500);

  const input = page.locator("[data-feedback-input]");
  if (!(await input.isVisible().catch(() => false))) {
    await context.close();
    return null;
  }
  await input.fill(message);

  const reply = page.locator("[data-feedback-reply]");
  const replyPresent = await reply.isVisible().catch(() => false);
  if (replyTo !== null && replyPresent) await reply.fill(replyTo);

  const status = await Promise.all([
    page
      .waitForResponse((r) => r.url().includes("/api/feedback"), { timeout: 20_000 })
      .then((r) => r.status())
      .catch(() => -1),
    page.getByRole("button", { name: /Send it/i }).click(),
  ]).then(([s]) => s);

  await page.waitForTimeout(1200);
  const after = (await page.evaluate(`(() => ({
    thanked: /Got it/i.test(document.body.innerText || ""),
    body: (document.body.innerText || "").slice(0, 4000),
    error: (document.querySelector("[data-feedback-error]") || {}).textContent || null,
  }))()`)) as { thanked: boolean; body: string; error: string | null };

  return { status, after, page, context, replyPresent };
}

const stamp = new Date().toISOString();
const REPLY_ADDRESS = `r41-walk-${Date.now().toString(36)}@example.invalid`;

// ── 1. The field exists, is labelled optional, and is empty on arrival ───
{
  const context = await browser.newContext({
    extraHTTPHeaders: HEADERS,
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/feedback`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(1500);

  const state = (await page.evaluate(`(() => {
    const field = document.querySelector("[data-feedback-reply]");
    if (!field) return { present: false };
    const label = field.id ? document.querySelector('label[for="' + field.id + '"]') : null;
    const button = [...document.querySelectorAll("button")]
      .find((b) => /Send it/i.test(b.textContent || ""));
    return {
      present: true,
      value: field.value,
      label: label ? (label.textContent || "").trim() : null,
      placeholder: field.getAttribute("placeholder"),
      required: field.hasAttribute("required"),
      buttonDisabledWhileBlank: button ? button.disabled : null,
      pageSaysReplyIsConditional:
        /only write back if you fill in the optional email box/i.test(document.body.innerText || ""),
    };
  })()`)) as {
    present: boolean;
    value?: string;
    label?: string | null;
    placeholder?: string | null;
    required?: boolean;
    buttonDisabledWhileBlank?: boolean | null;
    pageSaysReplyIsConditional?: boolean;
  };

  if (!state.present) {
    check("the optional reply field renders on /feedback", false, "no [data-feedback-reply]");
  } else {
    check("the optional reply field renders on /feedback", true, `label=${JSON.stringify(state.label)}`);
    check("it arrives blank — blank is the default", state.value === "", `value=${JSON.stringify(state.value)}`);
    check(
      "the optionality is in the label itself",
      /optional/i.test(state.label ?? ""),
      `label=${JSON.stringify(state.label)}`,
    );
    check("the field is not required", state.required === false, `required=${state.required}`);
    check(
      "the page states a reply depends on the field, rather than promising none",
      state.pageSaysReplyIsConditional === true,
      `sentence found: ${state.pageSaysReplyIsConditional}`,
    );
  }
  await page.screenshot({ path: join(OUT, "r41-form-blank.png") });
  await context.close();
}

// ── 2. A BLANK submit succeeds ──────────────────────────────────────────
{
  const outcome = await submit(
    `R41 walk probe (blank reply) ${stamp} — synthetic, from scripts/walk-r41.mts. Not a reader.`,
    null,
  );
  if (!outcome) {
    cannotRun("a blank submit succeeds", "no input on /feedback");
  } else if (outcome.status === 204) {
    check("a blank submit succeeds", true, `HTTP 204, ${stamp}`);
    check("only a stored submission is thanked", outcome.after.thanked, "the thank-you rendered");
    check(
      "a blank submit is told plainly that no reply is possible",
      /no address, so there is no way for us to write back/i.test(outcome.after.body),
      "the confirmation names the blank case",
    );
    await outcome.page.screenshot({ path: join(OUT, "r41-blank-stored.png") });
  } else if (outcome.status === 503) {
    cannotRun("a blank submit succeeds", "this runtime has no DATABASE_URL — no store to land in");
  } else {
    check("a blank submit succeeds", false, `HTTP ${outcome.status}, ${JSON.stringify(outcome.after.error)}`);
  }
  if (outcome) await outcome.context.close();
}

// ── 3. An address submits, and the confirmation says a reply is possible ─
{
  const outcome = await submit(
    `R41 walk probe (with reply address) ${stamp} — synthetic, from scripts/walk-r41.mts. Not a reader.`,
    REPLY_ADDRESS,
  );
  if (!outcome) {
    cannotRun("an address submits and is acknowledged", "no input on /feedback");
  } else if (!outcome.replyPresent) {
    cannotRun("an address submits and is acknowledged", "the reply field did not render");
  } else if (outcome.status === 204) {
    check("an address submits", true, `HTTP 204, ${REPLY_ADDRESS}`);
    check(
      "the confirmation says a reply is possible, and only then",
      /a reply is possible/i.test(outcome.after.body),
      "the confirmation names the address case",
    );
    await outcome.page.screenshot({ path: join(OUT, "r41-reply-stored.png") });
  } else if (outcome.status === 503) {
    cannotRun("an address submits", "this runtime has no DATABASE_URL — no store to land in");
  } else {
    check("an address submits", false, `HTTP ${outcome.status}, ${JSON.stringify(outcome.after.error)}`);
  }
  if (outcome) await outcome.context.close();
}

await browser.close();

// ── 4. Where the address landed, read from the database itself ──────────
{
  const connection = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
  const local = process.env.DATABASE_URL;
  const targetingProduction = !BASE.includes("localhost");
  const readVia = targetingProduction ? connection : local;
  const readName = targetingProduction
    ? "WTP_PRODUCTION_DATABASE_URL_READONLY"
    : "DATABASE_URL";

  if (!readVia) {
    // Never zero, never silence: a check that could not RUN is reported as
    // such, because an unreadable store must not print like an empty one.
    cannotRun(
      "the address stores in the feedback store only",
      `${readName} is not set, so there is no handle to read the store back with`,
    );
  } else {
    const sql = neon(readVia);
    try {
      const rows = (await sql`
        select reply_to, run_class, run_id from feedback
        where reply_to = ${REPLY_ADDRESS}
      `) as { reply_to: string; run_class: string; run_id: string | null }[];
      check(
        "the address stored, unscrubbed and exactly as typed",
        rows.length === 1 && rows[0].reply_to === REPLY_ADDRESS,
        `${rows.length} row(s), reply_to=${JSON.stringify(rows[0]?.reply_to ?? null)}`,
      );
      check(
        "the probe row is marked as ours, not as a reader",
        rows[0]?.run_class === "SYNTHETIC",
        `run_class=${rows[0]?.run_class}, run_id=${rows[0]?.run_id}`,
      );

      // The blank submit stored NULL rather than an empty string — a "" would
      // be a value where the reader gave none, which is a render default
      // manufacturing a claim one layer down.
      const blanks = (await sql`
        select count(*)::int as n from feedback
        where run_id = ${RUN_ID} and reply_to is null
      `) as { n: number }[];
      check(
        "a blank submit stored NULL, not an empty string",
        blanks[0].n >= 1,
        `${blanks[0].n} row(s) from this run carry a null reply_to`,
      );

      /*
       * THE JOIN CHECK, against the live database rather than the schema.
       * `reply_to` must exist on `feedback` and on no other table — the
       * n-stores rule as a property of what is actually deployed.
       */
      const carriers = (await sql`
        select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'reply_to'
        order by table_name
      `) as { table_name: string }[];
      const names = carriers.map((c) => c.table_name);
      check(
        "reply_to exists on the feedback store and nowhere else in the database",
        names.length === 1 && names[0] === "feedback",
        `carriers: ${names.length === 0 ? "(none)" : names.join(", ")}`,
      );
    } catch (error) {
      cannotRun(
        "the address stores in the feedback store only",
        (error as Error).message.slice(0, 140),
      );
    }
  }
}

console.log(`\nR41 walk — ${BASE}  run_id=${RUN_ID}\n`);
for (const line of results) console.log("  " + line);
const failed = results.filter((r) => r.startsWith("FAIL")).length;
const could = results.filter((r) => r.startsWith("CANNOT-RUN")).length;
console.log(
  `\n${results.length - failed - could} pass · ${failed} fail · ${could} could not run\n` +
    `Probe rows written (SYNTHETIC, run_id=${RUN_ID}): 2 feedback rows — one blank reply, ` +
    `one carrying ${REPLY_ADDRESS}. Both left in place as standing evidence.\n`,
);
process.exitCode = failed === 0 ? 0 : 1;
