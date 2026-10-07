import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Plain .mjs, shared with the plain-node scripts that never see tsx.
import { posixRelative } from "../scripts/repo-path.mjs";

import { hashLimiterKey } from "../lib/db/intake-limiter.ts";
import { scrubFreeText } from "../lib/log/scrub.ts";
import { REPLY_TO_MAX_CHARS, isReplyToShaped } from "../lib/feedback/shape.ts";
import {
  FEEDBACK_MAX_CHARS,
  FEEDBACK_SURFACES,
  isFeedbackSurface,
  feedbackContext,
  feedbackHref,
} from "../lib/feedback/shape.ts";
import {
  classifyFeedbackSubmission,
  classifySubmission,
  intakeLimits,
} from "../lib/signal/intake-limits.ts";

/**
 * The personal address is gone from everything a browser can see, and the in-app form keeps its promises: its own
 * store, joining nothing, scrubbed before storage, rate-limited in its own counter space, and never silently
 * succeeding into a void.
 */

const ROOT = process.cwd();

test("report links round-trip the card, ZIP and public record, with bounds and no invented ZIP", () => {
  const context = { about: "Cochise supervisors & meetings", zip: "85635", recordId: "cochise:supervisors" };
  const url = new URL(feedbackHref(context), "https://example.org");
  assert.equal(url.searchParams.get("about"), context.about);
  assert.equal(url.searchParams.get("zip"), "85635");
  assert.equal(url.searchParams.get("recordId"), context.recordId);
  assert.deepEqual(feedbackContext({}), { about: null, zip: null, recordId: null });
  assert.equal(feedbackContext({ zip: "85635-1234" }).zip, null);
  assert.equal(feedbackContext({ about: "x".repeat(100) }).about?.length, 80);
});

/** The address, assembled rather than written, so this file is not itself a hit. */
const ADDRESS = ["seanj22", "gmail.com"].join("@");

/*
 * The only exemption: the outbound User-Agent to upstream services carries a contact address (courteous-client
 * rule). It is server-only, and it has one home so no route copies the literal.
 */
const SERVER_ONLY_ALLOWED = new Set(["lib/geo/outbound-agent.ts"]);

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
      const rel = posixRelative(ROOT, file);
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
 * Reads the built client chunks, because a string can reach a bundle by a route the source scan does not cover.
 * When `.next/static` is absent the check skips by name rather than passing.
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
      hits.push(posixRelative(ROOT, file));
    }
  }
  assert.deepEqual(hits, [], `the address reached the client bundle: ${hits.join(", ")}`);
});

test("the sidebar's Feedback link points at the in-app route, not a mail client", () => {
  /* The claim is the route, not the file: no shell component carries a `mailto:`, and at least one links `/feedback`. */
  const shellFiles = [
    join(ROOT, "components", "shell", "sidebar.tsx"),
    join(ROOT, "components", "map", "map-entry.tsx"),
  ].filter((file) => existsSync(file));
  assert.ok(shellFiles.length > 0, "the map shell corpus is empty — this guard would pass without looking");

  const withMailto = shellFiles.filter((file) => /href="mailto:/.test(readFileSync(file, "utf8")));
  assert.deepEqual(withMailto, [], "no mailto: link may remain in the map shell");

  const linking = shellFiles.filter((file) => /href="\/feedback"/.test(readFileSync(file, "utf8")));
  assert.ok(
    linking.length > 0,
    `no component of the map shell links the in-app /feedback route — checked ${shellFiles.join(", ")}`,
  );
  const transparency = readFileSync(join(ROOT, "app", "transparency", "page.tsx"), "utf8");
  assert.ok(
    !/href="mailto:/.test(transparency),
    "no mailto: link may remain on /transparency",
  );
});

/** The optional reply field stays optional, and the scrub exception never widens to the message body. */
test("R41: blank is the default and a blank submission is not blocked", () => {
  // Shape-level: blank is VALID, so nothing downstream can treat it as an error.
  assert.equal(isReplyToShaped(""), true, "blank must be valid — the field is optional");
  assert.equal(isReplyToShaped("   "), true, "whitespace-only must be valid");

  const form = readFileSync(
    join(ROOT, "components", "feedback", "feedback-form.tsx"),
    "utf8",
  );
  // The submit button may never wait on the reply field being filled. It may
  // only wait on a value the reader actually typed being malformed.
  assert.ok(
    form.includes(
      "const replyMalformed = trimmedReply.length > 0 && !isReplyToShaped(trimmedReply)",
    ),
    "an untouched reply field must never be able to disable the button",
  );
  assert.ok(
    /Your email — optional/.test(form),
    "the optionality must be in the label itself, not in fine print below it",
  );
});

test("R41: the reply address is shape-checked, and the check claims nothing more", () => {
  assert.equal(isReplyToShaped("someone@example.com"), true);
  assert.equal(isReplyToShaped("not an address"), false);
  assert.equal(isReplyToShaped("two@@example.com"), false);
  assert.equal(isReplyToShaped("no-domain@localhost"), false);
  assert.equal(isReplyToShaped("has space@example.com"), false);
  assert.equal(isReplyToShaped(`${"a".repeat(REPLY_TO_MAX_CHARS)}@example.com`), false);
});

test("R41: T09 still scrubs the MESSAGE, and the exception is exactly one field", () => {
  const source = readFileSync(join(ROOT, "lib", "db", "feedback.ts"), "utf8");
  // The message is scrubbed before the insert.
  assert.ok(source.includes("scrubFreeText(raw)"), "the message must still be scrubbed");
  assert.ok(
    source.indexOf("scrubFreeText(raw)") < source.indexOf(".insert(feedback)"),
    "the scrub must still run before the insert",
  );
  // The reply address is stored as typed.
  assert.ok(
    !/scrubFreeText\(\s*(submission\.)?replyTo/.test(source),
    "the reply address is stored as typed; scrubbing it would delete what the reader asked for",
  );
  // The report-context prose fields are scrubbed too.
  assert.match(source, /scrubFreeText\(context.about\)/);
  assert.match(source, /scrubFreeText\(context.recordId\)/);
});

test("R41: the reply address is filled only from its own field, never the message", () => {
  const route = readFileSync(join(ROOT, "app", "api", "feedback", "route.ts"), "utf8");
  // A route deriving an address from the message body would undo the separation.
  assert.ok(
    route.includes("submission.replyTo"),
    "the route must read the reply address from its own field",
  );
  assert.ok(
    !/replyTo:\s*submission\.message/.test(route),
    "the reply address may never be derived from the message body",
  );
  const client = readFileSync(join(ROOT, "lib", "feedback", "client.ts"), "utf8");
  assert.ok(/replyTo/.test(client), "the client must send the field");
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
  /*
   * The thank-you is gated on STORED and nothing else: there is exactly one way in, inside the STORED branch.
   */
  const storedTransitions = form.match(/setState\("stored"\)/g) ?? [];
  assert.equal(
    storedTransitions.length,
    1,
    "there must be exactly one path to the thank-you state",
  );
  const branchAt = form.indexOf('outcome.kind === "STORED"');
  const thanksAt = form.indexOf('setState("stored")');
  assert.ok(branchAt !== -1, "the STORED branch must exist");
  assert.ok(
    thanksAt > branchAt && thanksAt - branchAt < 300,
    "the form may only thank a reader inside the STORED branch",
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
   * The licensed path is lib/signal. The check is on reachability, not the word: what may never appear is a way to
   * read the rows (the write module, or the table out of the schema).
   */
  const files = walk(join(ROOT, "lib", "signal")).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length > 0, "no lib/signal modules found — the scan found nothing");
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const rel = posixRelative(ROOT, file);
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
  const routes = walk(join(ROOT, "app", "api")).filter((f) => f.endsWith("route.ts"));
  for (const route of routes) {
    const source = readFileSync(route, "utf8");
    if (posixRelative(ROOT, route).includes("api/feedback")) continue;
    assert.ok(
      !/db\/feedback/.test(source),
      `${posixRelative(ROOT, route)} reaches the feedback store — only its own route may`,
    );
  }
  // And the feedback route itself only WRITES.
  const own = readFileSync(join(ROOT, "app", "api", "feedback", "route.ts"), "utf8");
  assert.ok(!/export async function GET/.test(own), "the feedback route must not read");
});
