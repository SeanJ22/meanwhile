import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { CompositeSource } from "../lib/sources/composite/index.ts";
import {
  ACCOUNTED,
  ZeroRowExtractionError,
  accountedNormalize,
} from "../lib/sources/normalize-account.ts";
import type { Meeting, ReportingMeetingSource } from "../lib/sources/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = join(ROOT, "lib", "sources");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

const ZERO = {
  placeless: 0,
  unknownVenue: 0,
  unplaceableInTime: 0,
  notConfigured: 0,
};

function meetingOf(id: string): Meeting {
  return {
    id,
    ocdId: null,
    bodyName: "Board",
    title: "Regular Session",
    startsAt: "2026-09-01T23:00:00.000Z",
    timeZone: "America/New_York",
    location: { name: "Town Hall", address: null, lat: 43.3, lng: -72.0 },
    agendaUrl: null,
    jurisdiction: "Newbury, NH",
    status: "SCHEDULED",
    provenance: {
      sourceUrl: null,
      sourceOrg: "test",
      collectedAt: "2026-08-20T00:00:00.000Z",
      verifiedAt: null,
    },
  };
}

test("the factory refuses a non-zero fetch that yielded nothing and dropped nothing", () => {
  assert.throws(
    () =>
      accountedNormalize("ical", [1, 2, 3], {
        meetings: [],
        drops: { ...ZERO },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ZeroRowExtractionError);
      assert.equal(error.source, "ical");
      assert.equal(error.fetched, 3);
      assert.match(error.message, /never an empty calendar/);
      return true;
    },
    "this is the exact shape that emptied Wilmot",
  );
});

test("the three honest empties still pass", () => {
  // Nothing fetched: the upstream had nothing, and the fetch layer judges that.
  assert.equal(
    accountedNormalize("ical", [], { meetings: [], drops: { ...ZERO } })
      .meetings.length,
    0,
  );
  // Fetched and dropped everything, with the reason recorded.
  assert.equal(
    accountedNormalize("civicplus", [1, 2], {
      meetings: [],
      drops: { ...ZERO, notConfigured: 2 },
    }).drops.notConfigured,
    2,
  );
  // Fetched and extracted: one document, many meetings, which is why full
  // input/output accounting is deliberately NOT the invariant.
  assert.equal(
    accountedNormalize("ical", [1], {
      meetings: [meetingOf("ical:a"), meetingOf("ical:b")],
      drops: { ...ZERO },
    }).meetings.length,
    2,
  );
});

/** A file declares that another module owns its accounting with this marker. */
const DELEGATION_MARKER = /@accounting-delegated-to\s+`?([\w./-]+)`?/;

test("every adapter routes its normalize result through the factory", () => {
  const files = walk(SOURCES);
  assert.ok(files.length >= 12, `swept ${files.length} source files`);

  const implementors: string[] = [];
  const routed: string[] = [];
  /** `[file, the module it delegates its accounting to]`. */
  const delegated: [string, string][] = [];
  for (const file of files) {
    const rel = relative(ROOT, file).split(sep).join("/");
    const text = readFileSync(file, "utf8");
    // The contract's own definition and the composite (which CONSUMES the
    // results rather than producing one) are not implementors.
    if (rel === "lib/sources/types.ts") continue;
    if (rel.endsWith("normalize-account.ts")) continue;
    if (rel.endsWith("composite/index.ts")) continue;
    if (!/normalizeWithDrops[(:,]/.test(text)) continue;
    if (!/normalizeWithDrops\s*[(:]|normalizeWithDrops,/.test(text)) continue;
    implementors.push(rel);
    // Routed means the result carries the brand: branded here, or returned by a declared delegate that brands.
    if (text.includes("accountedNormalize(")) routed.push(rel);
    else {
      const declared = DELEGATION_MARKER.exec(text);
      if (declared) delegated.push([rel, declared[1]]);
    }
  }

  const declaredDelegators = delegated.map(([f]) => f);
  assert.deepEqual(
    implementors.filter((f) => !routed.includes(f) && !declaredDelegators.includes(f)),
    [],
    "an adapter producing a normalize result without the factory and without declaring a delegate",
  );

  // A declared delegate must itself be an implementor that brands, or the
  // declaration is a way of pointing at nothing.
  for (const [file, target] of delegated) {
    const base = target.split("/").pop()?.replace(/\.ts$/, "") ?? target;
    const resolved = routed.find((r) => r.includes(base));
    assert.ok(
      resolved,
      `${file} declares @accounting-delegated-to ${target}, and no branding implementor answers to that name`,
    );
  }
  // Stated N equals the rows actually swept.
  assert.ok(
    implementors.length >= 12,
    `expected every wired adapter plus the legistar wrapper; found ${implementors.length}: ${implementors.join(", ")}`,
  );
});

test("nothing hand-attaches the brand to route around the factory", () => {
  const files = walk(join(ROOT, "lib")).concat(
    walk(join(ROOT, "app")),
    walk(join(ROOT, "scripts")).filter((f) => f.endsWith(".ts")),
  );
  assert.ok(files.length > 100, `swept ${files.length} files`);

  const offenders: string[] = [];
  for (const file of files) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (rel.endsWith("normalize-account.ts")) continue;
    const text = readFileSync(file, "utf8");
    if (/\[ACCOUNTED\]\s*:/.test(text)) offenders.push(rel);
    if (/Symbol\.for\(\s*["']wtp\.normalize\.accounted/.test(text)) {
      offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], "the brand is attached outside the factory");
});

test("the composite turns the refusal into JOB, so the run goes red", async () => {
  const liar: ReportingMeetingSource<unknown> = {
    name: "liar",
    fetch: async () => [1, 2, 3],
    normalize: () => [],
    normalizeWithDrops: (raw) =>
      accountedNormalize("liar", raw, { meetings: [], drops: { ...ZERO } }),
    upsert: async (m) => ({ inserted: 0, updated: m.length }),
  };

  const composite = new CompositeSource([liar]);
  const merged = composite.normalize(
    await composite.fetch({ lat: 43.3, lng: -72.0, radiusKm: 40 }),
  );

  assert.equal(merged.length, 0);
  const report = composite.lastReport?.children.find((c) => c.source === "liar");
  assert.equal(report?.ok, false);
  assert.equal(report?.failure, "JOB", "our parser, our bug, red run");
  assert.equal(report?.fetched, 3);
  assert.match(String(report?.error), /zero-row extraction/);
});

test("the brand is a real runtime symbol on a returned result", () => {
  const result = accountedNormalize("ical", [1], {
    meetings: [meetingOf("ical:a")],
    drops: { ...ZERO },
  });
  assert.equal(
    (result as unknown as Record<symbol, unknown>)[ACCOUNTED],
    true,
  );
});

test("A-002 · every adapter's normalize declares logicalInput", () => {
  const files = walk(SOURCES);
  const missing: string[] = [];
  const callers: string[] = [];

  for (const file of files) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (rel.endsWith("normalize-account.ts")) continue;
    const text = readFileSync(file, "utf8");
    // Comment lines are stripped first: a doc block may name the factory without calling it.
    const code = text
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join("\n");
    if (!code.includes("accountedNormalize(")) continue;
    callers.push(rel);
    if (!/logicalInput\s*:/.test(code)) missing.push(rel);
  }

  assert.ok(callers.length >= 12, `only ${callers.length} adapters swept — this would pass without looking`);
  assert.deepEqual(
    missing,
    [],
    "an adapter still reports COULD_NOT_ASSERT by omission rather than by decision",
  );
});

/** `clerksboards` cannot count "Meets as required" sittings, so it alone passes `null`. */
test("A-002 · COULD_NOT_ASSERT is used in exactly the place that cannot count", () => {
  const files = walk(SOURCES);
  const nullers: string[] = [];
  for (const file of files) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (rel.endsWith("normalize-account.ts")) continue;
    const text = readFileSync(file, "utf8");
    if (/logicalInput\s*:[^,\n]*\bnull\b/.test(text)) nullers.push(rel);
  }
  assert.deepEqual(nullers, ["lib/sources/clerksboards/index.ts"]);
});
