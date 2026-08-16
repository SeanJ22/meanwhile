import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * THE .GOV REGISTRY SNAPSHOT (item 9, 2026-08-16).
 *
 * A LINK LADDER RUNG: where a government might publish. The 693 domains CISA
 * itself types as election offices are the named rung for ballot and
 * candidate-filing hunts.
 *
 * **The boundary is the important half, and it is what these guards mostly
 * hold.** CLAUDE.md's coverage rule takes its denominator from the Census of
 * Governments and the official rosters, never from counting our own records
 * — and this file is not one of those enumerations either. A government with
 * no .gov domain is absent from it; one government may hold several domains;
 * a domain is not a body. Counting .gov domains would undercount exactly the
 * bodies hardest to cover, which is the Sunnyside class of miss.
 */

const ROOT = process.cwd();
const SNAPSHOT = JSON.parse(
  readFileSync(join(ROOT, "data", "dotgov", "snapshot.json"), "utf8"),
) as {
  source: { sha: string; url: string; readAt: string; licence: string };
  counts: {
    domains: number;
    electionDomains: number;
    byType: Record<string, number>;
  };
  electionDomains: {
    domain: string;
    type: string;
    organization: string;
    state: string | null;
  }[];
  boundary: string;
};

test("the snapshot states its counts, and they are the counts it holds", () => {
  // An operation that can return nothing is asked what it returned — and the
  // stated N must equal the rows, not merely be present.
  assert.ok(
    SNAPSHOT.counts.domains >= 15_000,
    `${SNAPSHOT.counts.domains} domains is below the thin-guard floor`,
  );
  assert.equal(
    SNAPSHOT.counts.electionDomains,
    SNAPSHOT.electionDomains.length,
    "the stated election count does not equal the rows committed",
  );
  assert.ok(SNAPSHOT.counts.electionDomains >= 500);
  // The per-type histogram sums to the whole file: a type quietly dropped
  // would be a silent truncation wearing a complete-looking summary.
  const summed = Object.values(SNAPSHOT.counts.byType).reduce((a, b) => a + b, 0);
  assert.equal(summed, SNAPSHOT.counts.domains, "the type histogram does not sum");
});

test("the election subset is CISA's own classification, not our name match", () => {
  for (const row of SNAPSHOT.electionDomains) {
    assert.match(
      row.type,
      /election/i,
      `${row.domain} is in the election list with type "${row.type}"`,
    );
    assert.ok(row.domain.endsWith(".gov"), `${row.domain} is not a .gov domain`);
    assert.ok(row.organization.length > 0, `${row.domain} has no registrant`);
  }
  // The registry's own election types, all of them, and nothing invented.
  const types = new Set(SNAPSHOT.electionDomains.map((r) => r.type));
  for (const type of types) {
    assert.ok(
      SNAPSHOT.counts.byType[type] > 0,
      `election type "${type}" is missing from the histogram`,
    );
  }
  // A name match would have caught a city called Election and missed a
  // secretary of state. Spot-check that the list is not a name match: at
  // least one entry's domain does not contain "vote" or "election".
  assert.ok(
    SNAPSHOT.electionDomains.some((r) => !/vote|election/i.test(r.domain)),
    "the list looks like a name match rather than the registry's own type",
  );
});

test("the snapshot is pinned, dated, and licensed on its own face", () => {
  assert.match(SNAPSHOT.source.sha, /^[0-9a-f]{40}$/);
  assert.ok(SNAPSHOT.source.url.includes(SNAPSHOT.source.sha), "the url must pin too");
  assert.match(SNAPSHOT.source.readAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(SNAPSHOT.source.licence, /public domain/i);
});

test("DOMAINS ARE NOT A DENOMINATOR, and the file says so", () => {
  assert.match(SNAPSHOT.boundary, /not an enumeration of governments/i);
  assert.match(SNAPSHOT.boundary, /never use these counts as a coverage denominator/i);

  // And nothing reads it as one. The coverage surfaces take M from the
  // official enumerations; a snapshot import inside them would be the rule
  // broken silently.
  const fetcher = readFileSync(join(ROOT, "scripts", "fetch-dotgov.mts"), "utf8");
  assert.match(fetcher, /Census of Governments/);
  for (const dir of ["lib/registry", "lib/meetings", "components/map"]) {
    const offenders: string[] = [];
    const walk = (path: string) => {
      for (const entry of readdirSync(join(ROOT, path))) {
        const full = join(ROOT, path, entry);
        if (statSync(full).isDirectory()) {
          walk(join(path, entry));
          continue;
        }
        if (!/\.tsx?$/.test(entry)) continue;
        if (/dotgov/i.test(readFileSync(full, "utf8"))) offenders.push(join(path, entry));
      }
    };
    walk(dir);
    assert.deepEqual(
      offenders,
      [],
      `the .gov registry is being read by a coverage surface: ${offenders.join(", ")}`,
    );
  }
});
