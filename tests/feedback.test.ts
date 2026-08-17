import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";

import { hashLimiterKey } from "../lib/db/intake-limiter.ts";
import { scrubFreeText } from "../lib/log/scrub.ts";
import {
  FEEDBACK_MAX_CHARS,
  FEEDBACK_SURFACES,
  isFeedbackSurface,
} from "../lib/feedback/shape.ts";
import {
  classifyFeedbackSubmission,
  classifySubmission,
  intakeLimits,
} from "../lib/signal/intake-limits.ts";

/**
 * **R40 — the personal email leaves the product; Feedback becomes the in-app
 * form.** 2026-08-17, the author's ruling (1A: in-app; the Google Form is
 * unused).
 *
 * Two halves of one subject, and these guards hold both:
 *
 * 1. The address is gone from everything a browser can see, and STAYS gone.
 * 2. What replaced it keeps its promises — its own store, joining nothing,
 *    scrubbed before storage, rate-limited in its own counter space, and
 *    never silently succeeding into a void.
 */

const ROOT = process.cwd();

/** The address, assembled rather than written, so this file is not itself a hit. */
const ADDRESS = ["seanj22", "gmail.com"].join("@");

/*
 * THE ONE PLACE IT MAY STILL APPEAR, and why.
 *
 * app/api/geocode/route.ts sends it in the OUTBOUND User-Agent to the Census
 * geocoder. CLAUDE.md's courteous-client rule REQUIRES a User-Agent with a
 * contact address, and this is a server route: it is never in the client
 * bundle and no reader can see it. R40's own row scoped it out explicitly.
 * Changing it needs a contact address that still reaches the author, which is
 * the author's call and not this row's.
 */
const SERVER_ONLY_ALLOWED = new Set([join("app", "api", "geocode", "route.ts")]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test("the author's personal address is gone from every source a browser can reach", () => {
  const hits: string[] = [];
  for (const root of ["app", "components", "hooks", "lib"]) {
    for (const file of walk(join(ROOT, root))) {
      if (!/\.(ts|tsx|js|jsx|css|json)$/.test(file)) continue;
      const rel = relative(ROOT, file);
      if (SERVER_ONLY_ALLOWED.has(rel)) continue;
      if (readFileSync(file, "utf8").includes(ADDRESS)) hits.push(rel);
    }
  }
  assert.deepEqual(
    hits,
    [],
    `the personal address is still in: ${hits.join(", ")} — R40 removed it from ` +
      `the rendered UI and the client-side source, and only the geocoder's ` +
      `outbound User-Agent is exempt`,
  );
});

/**
 * THE BUNDLE HALF, and its honest limitation.
 *
 * The source scan above is the everyday net; this is the one the row asked
 * for, because a string can reach a bundle through a route the source grep
 * does not obviously cover. It reads the BUILT client chunks.
 *
 * **Proven by planting it once** (2026-08-17, R40's own requirement): the
 * address was put back into the sidebar's Feedback link,
 * `pnpm build` was run, and BOTH guards failed — the source scan naming
 * `components/shell/sidebar.tsx` and this one naming
 * `.next/static/chunks/3u-i1b6z-3cuz.js`. The plant was then removed and the
 * build re-run green. A guard nobody has watched fail is a guard nobody
 * should trust, and a bundle scan is exactly the kind that can quietly stop
 * looking at anything.
 *
 * When `.next/static` is absent the check reports that it could not run
 * rather than passing — a check that cannot reach its subject must never
 * print like a passing one. `pnpm handoff --ship` builds before it pushes, so
 * on the path that matters the bundle is always there.
 */
test("the address is in no built client chunk", (t) => {
  const staticDir = join(ROOT, ".next", "static");
  if (!existsSync(staticDir)) {
    t.skip("CANNOT RUN: no .next/static — run pnpm build first (the ship gate does)");
    return;
  }
  const hits: string[] = [];
  for (const file of walk(staticDir)) {
    if (!/\.(js|css|json|txt)$/.test(file)) continue;
    if (readFileSync(file, "utf8").includes(ADDRESS)) {
      hits.push(relative(ROOT, file).split(sep).join("/"));
    }
  }
  assert.deepEqual(hits, [], `the address reached the client bundle: ${hits.join(", ")}`);
});

test("the sidebar's Feedback link points at the in-app route, not a mail client", () => {
  const sidebar = readFileSync(join(ROOT, "components", "shell", "sidebar.tsx"), "utf8");
  assert.ok(!/href="mailto:/.test(sidebar), "no mailto: link may remain in the sidebar");
  assert.ok(
    /href="\/feedback"/.test(sidebar),
    "the sidebar must link to the in-app /feedback route",
  );
  const transparency = readFileSync(join(ROOT, "app", "transparency", "page.tsx"), "utf8");
  assert.ok(
    !/href="mailto:/.test(transparency),
    "no mailto: link may remain on /transparency",
  );
});

test("the transparency page discloses the store in the same commit as the form", () => {
  const page = readFileSync(join(ROOT, "app", "transparency", "page.tsx"), "utf8");
  // The coupling rule: a capture surface and its disclosure ship together.
  assert.ok(/feedback form/i.test(page), "the form must be named on /transparency");
  assert.ok(
    /never enters anything that is\s*\n?\s*aggregated or licensed|aggregated or licensed/i.test(page),
    "the page must say feedback is never aggregated or licensed",
  );
  // And the form page itself carries the disclosure at the point of typing.
  const form = readFileSync(join(ROOT, "app", "feedback", "page.tsx"), "utf8");
  assert.ok(/cannot write back/i.test(form), "the form must say we cannot write back");
  assert.ok(
    /aggregated or licensed/i.test(form),
    "the form must say the message enters nothing licensed",
  );
});

test("the feedback store carries no key, and its limiter counters cannot join reactions'", () => {
  const raw = "abcdef0123456789abcdef0123456789";
  // The two digest spaces are genuinely different values, which is the whole
  // isolation argument: one browser's feedback counter and its reaction
  // counter are two rows nothing can relate.
  assert.notEqual(hashLimiterKey(raw, "reactions"), hashLimiterKey(raw, "feedback"));
  // And the default is unchanged, so the reaction path's existing digests
  // still resolve to the same rows they always did.
  assert.equal(hashLimiterKey(raw), hashLimiterKey(raw, "reactions"));
});

test("the feedback budget is its own — neither path spends the other's", () => {
  const limits = intakeLimits();
  // Six feedback messages a minute is a lot; forty reactions is not. The two
  // classifiers must not be interchangeable, and this is the proof: a count
  // that is fine for reactions is refused for feedback.
  const counters = { minuteCount: 10, dayCount: 10 };
  assert.equal(classifySubmission(counters, limits).kind, "ALLOW");
  assert.equal(classifyFeedbackSubmission(counters, limits).kind, "REFUSE_RATE");

  // Past the soft threshold a message still LANDS, quarantined. A reader with
  // a lot to report is never silently dropped; the author decides.
  const soft = { minuteCount: limits.feedbackPerMinuteSoft + 1, dayCount: 5 };
  const disposition = classifyFeedbackSubmission(soft, limits);
  assert.equal(disposition.kind, "QUARANTINE");

  const daily = { minuteCount: 1, dayCount: limits.feedbackPerDay + 1 };
  assert.equal(classifyFeedbackSubmission(daily, limits).kind, "REFUSE_DAILY");
});

test("T09 runs before storage — the write path scrubs, and it is the only path", () => {
  const source = readFileSync(join(ROOT, "lib", "db", "feedback.ts"), "utf8");
  assert.ok(/scrubFreeText\(raw\)/.test(source), "the message must be scrubbed");
  // Scrubbed BEFORE the insert, not after — read positionally, because the
  // order is the whole guarantee.
  assert.ok(
    source.indexOf("scrubFreeText(raw)") < source.indexOf(".insert(feedback)"),
    "the scrub must run before the insert",
  );
  // The mechanism itself, on the shapes a reader actually types.
  assert.equal(
    scrubFreeText("call me on 603-555-0134 about the Newbury meeting"),
    "call me on [#] about the Newbury meeting",
  );
  assert.equal(scrubFreeText(`write to ${ADDRESS} please`), "write to [#] please");

  // No second writer. A route inserting directly would skip the scrub.
  const route = readFileSync(join(ROOT, "app", "api", "feedback", "route.ts"), "utf8");
  assert.ok(
    !/\.insert\(/.test(route),
    "the route must go through lib/db/feedback.ts, never insert directly",
  );
});

test("a message that is nothing but contact details is refused, not stored empty", () => {
  // The scrub can empty a message. Storing the empty row would record that
  // someone wrote and nothing about what.
  assert.equal(scrubFreeText(ADDRESS), "[#]");
  const source = readFileSync(join(ROOT, "lib", "db", "feedback.ts"), "utf8");
  assert.ok(
    /empty after the scrub/.test(source),
    "the write path must refuse a message the scrub emptied",
  );
  const route = readFileSync(join(ROOT, "app", "api", "feedback", "route.ts"), "utf8");
  assert.ok(
    /after the scrub/.test(route) && /looked like contact details/.test(route),
    "the route must tell the reader WHY, not render a generic failure",
  );
});

test("a submission never silently succeeds into a void", () => {
  const client = readFileSync(join(ROOT, "lib", "feedback", "client.ts"), "utf8");
  // STORED is reachable from exactly one place: a 204.
  const storedReturns = client.match(/kind: "STORED"/g) ?? [];
  assert.equal(
    storedReturns.length,
    2,
    "STORED should appear once in the type and once in the 204 branch",
  );
  assert.ok(
    /response\.status === 204\) return \{ kind: "STORED" \}/.test(client),
    "STORED must be returned only for a 204",
  );
  // A network failure is a NOT_STORED with a sentence, never a swallowed catch.
  assert.ok(/UNREACHABLE/.test(client), "an unreachable server must be told to the reader");

  const form = readFileSync(
    join(ROOT, "components", "feedback", "feedback-form.tsx"),
    "utf8",
  );
  // The thank-you is gated on STORED and on nothing else.
  assert.ok(
    /outcome\.kind === "STORED"\)\s*\{\s*setState\("stored"\)/.test(form),
    "the form may only thank a reader on STORED",
  );
  // And the failure branch keeps the reader's text.
  assert.ok(
    !/setMessage\(""\)[\s\S]{0,120}setState\("failed"\)/.test(form),
    "a failed submission must not clear the reader's text",
  );

  // The route's own outcomes are distinguishable, none of them a bare 200.
  const route = readFileSync(join(ROOT, "app", "api", "feedback", "route.ts"), "utf8");
  for (const status of ["204", "503", "500", "400", "413", "403", "429"]) {
    assert.ok(
      route.includes(`status: ${status}`),
      `the route must be able to answer ${status}`,
    );
  }
  assert.ok(!/status: 200/.test(route), "no 200 — stored is 204 and nothing else");
});

test("the surface enum is closed, and the store's column matches it", () => {
  assert.deepEqual([...FEEDBACK_SURFACES], ["SIDEBAR", "TRANSPARENCY", "COVERAGE"]);
  assert.ok(isFeedbackSurface("SIDEBAR"));
  assert.ok(!isFeedbackSurface("https://example.com/?q=my+address"));
  assert.ok(!isFeedbackSurface(""));
  assert.equal(FEEDBACK_MAX_CHARS, 2000);
});

test("nothing in lib/signal can read the feedback store", () => {
  /*
   * The promise is "never enters anything aggregated or licensed", and the licensed
   * path is lib/signal. This makes it structural rather than a sentence.
   *
   * The check is on REACHABILITY, not on the word: intake-limits.ts
   * legitimately names the feedback form's rate-limit thresholds, and a
   * lexical ban would have to be weakened until it caught nothing. What may
   * never appear is a way to READ the rows — the write module, or the table
   * itself out of the schema.
   */
  const files = walk(join(ROOT, "lib", "signal")).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length > 0, "no lib/signal modules found — the scan found nothing");
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const rel = relative(ROOT, file);
    assert.ok(
      !/from\s+"[^"]*db\/feedback/.test(source),
      `${rel} imports the feedback write path — it must not`,
    );
    assert.ok(
      !/\bfeedback\b(?!Per)/.test(
        // Comments explain the thresholds; code is what can reach a table.
        source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
      ),
      `${rel} names the feedback store in code — it must not`,
    );
  }
});

test("the feedback table is in the schema, the migration, and no export path", () => {
  const schema = readFileSync(join(ROOT, "lib", "db", "schema.ts"), "utf8");
  assert.ok(/export const feedback = pgTable\(\s*\n?\s*"feedback"/.test(schema));
  const migrations = readdirSync(join(ROOT, "lib", "db", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(ROOT, "lib", "db", "migrations", f), "utf8"))
    .join("\n");
  assert.ok(
    migrations.includes('CREATE TABLE "feedback"'),
    "no migration creates the feedback table — db:generate did not run, or its output is uncommitted",
  );
  // The author's read path exists and is a script, not a route: there is no
  // authenticated admin surface on this product and R40 did not add one.
  assert.ok(
    existsSync(join(ROOT, "scripts", "read-feedback.mts")),
    "the author needs a way to read what readers send",
  );
  const routes = walk(join(ROOT, "app", "api")).filter((f) => f.endsWith("route.ts"));
  for (const route of routes) {
    const source = readFileSync(route, "utf8");
    if (relative(ROOT, route).includes(join("api", "feedback"))) continue;
    assert.ok(
      !/db\/feedback/.test(source),
      `${relative(ROOT, route)} reaches the feedback store — only its own route may`,
    );
  }
  // And the feedback route itself only WRITES.
  const own = readFileSync(join(ROOT, "app", "api", "feedback", "route.ts"), "utf8");
  assert.ok(!/export async function GET/.test(own), "the feedback route must not read");
});
