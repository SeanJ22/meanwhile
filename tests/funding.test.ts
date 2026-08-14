import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { RIPCORDS, RIPCORD_NAMES, ripcordPulled } from "../lib/ripcords.ts";
import {
  aggregateReactions,
  rowsEligibleForAggregation,
} from "../lib/signal/aggregate.ts";
import { FUNDING_REACTION_TYPES } from "../lib/signal/reactions.ts";
import {
  contributorRowsForDisplay,
  fundingForTarget,
  getContributorReactionTargetIds,
  getFundingSnapshot,
  getFundingTargetIds,
} from "../lib/funding/snapshot.ts";
import {
  fundingAnswerForTarget,
  plainMoney,
  STATE_FUNDING_NOTE,
} from "../lib/funding/display.ts";

/**
 * The FEC funding surface (D34) — the ripcord doctrine's first application,
 * tested at the layers that make it a ripcord rather than a CSS rule:
 * provenance tags on every record, both flags demonstrably functional in
 * both positions, contributor data unreachable from aggregation/export,
 * and the FEC key confined to the fetch script.
 */

const ROOT = join(import.meta.dirname, "..");
const snapshot = getFundingSnapshot();

// ── The snapshot artifact ────────────────────────────────────────────────

test("every snapshot record carries its provenance tag", () => {
  assert.ok(snapshot.candidates.length >= 10, `only ${snapshot.candidates.length} candidates`);
  for (const candidate of snapshot.candidates) {
    assert.equal(candidate.dataClass, "FEC_COMMITTEE");
    assert.ok(candidate.targetKeys.length >= 1, `${candidate.fecCandidateId} answers for nothing`);
    assert.ok(candidate.cycle === snapshot.cycle, `${candidate.fecCandidateId} wears cycle ${candidate.cycle} in a ${snapshot.cycle} snapshot`);
    assert.ok(candidate.provenance.sourceUrl?.startsWith("https://www.fec.gov/"), "provenance must cite the FEC");
    for (const row of candidate.topContributions) {
      assert.equal(row.dataClass, "FEC_CONTRIBUTOR");
      assert.ok(row.amount > 0);
    }
  }
});

test("the match report states its denominators and the absences have reasons", () => {
  const { matchReport } = snapshot;
  assert.ok(matchReport.rosterTotal > 0 && matchReport.ballotTotal > 0);
  assert.ok(matchReport.rosterMatched <= matchReport.rosterTotal);
  assert.ok(matchReport.ballotMatched <= matchReport.ballotTotal);
  for (const absence of snapshot.absences) {
    assert.ok(absence.reason.length > 10, `${absence.targetKey} absence has no reason`);
    assert.ok(absence.checkedAt, `${absence.targetKey} absence undated`);
  }
});

test("the gate: Ciscomani and at least three ballot candidates have funding", () => {
  const ciscomani = fundingForTarget("congress:C001133");
  assert.ok(ciscomani, "Ciscomani has no funding record");
  assert.ok(ciscomani.totals.receipts > 0);
  const ballotBacked = snapshot.candidates.filter((c) =>
    c.targetKeys.some((k) => k.startsWith("ballot-")),
  );
  assert.ok(ballotBacked.length >= 3, `only ${ballotBacked.length} ballot candidates carry funding`);
});

test("snapshot target keys resolve to real app-side ids", () => {
  const roster = JSON.parse(
    readFileSync(join(ROOT, "lib", "registry", "officeholders-us.json"), "utf8"),
  ) as { officeholders: { id: string }[] };
  const rosterIds = new Set(roster.officeholders.map((o) => o.id));
  const ballotIds = new Set<string>();
  for (const file of ["nj-morris-2026.json", "az-pima-2026.json", "nh-merrimack-2026.json"]) {
    const data = JSON.parse(readFileSync(join(ROOT, "data", "ballot", file), "utf8")) as {
      candidacies: { id: string }[];
    };
    for (const c of data.candidacies) ballotIds.add(c.id);
  }
  const lineup = JSON.parse(
    readFileSync(join(ROOT, "data", "ballot", "az-general-lineup-2026.json"), "utf8"),
  ) as { contests: { contestId: string; nominees: { name: string }[] }[] };
  for (const contest of lineup.contests) {
    for (const n of contest.nominees) ballotIds.add(`${contest.contestId}|${n.name}`);
  }
  for (const candidate of snapshot.candidates) {
    for (const key of candidate.targetKeys) {
      assert.ok(
        rosterIds.has(key) || ballotIds.has(key),
        `${candidate.fecCandidateId} claims unknown target ${key}`,
      );
    }
  }
});

test("neutrality: no snapshot record grows a scoring key", () => {
  const banned = /"(score|rank|rating|match(?!Report|Routes)|fit|grade|alignment|recommendation)[a-zA-Z]*"\s*:/;
  const raw = readFileSync(join(ROOT, "data", "fec", "fec-2026.json"), "utf8");
  assert.ok(!banned.test(raw), "snapshot carries a scoring-class key");
});

// ── The uniqueness invariant (D40) ───────────────────────────────────────
// The sibling of the count check: a join or enrichment producing IDENTICAL
// payloads across distinct keys is presumed broken. The match-rate test
// passed while production served every official the same committee's books
// — the rate can be 100% with every match pointing at one row.

test("D40: no two candidates share an FEC id, a committee id, or a target key", () => {
  const fecIds = new Map<string, string>();
  const committeeIds = new Map<string, string>();
  const targetKeys = new Map<string, string>();
  for (const candidate of snapshot.candidates) {
    const prior = fecIds.get(candidate.fecCandidateId);
    assert.ok(!prior, `${candidate.name} and ${prior} share FEC id ${candidate.fecCandidateId}`);
    fecIds.set(candidate.fecCandidateId, candidate.name);
    if (candidate.principalCommitteeId) {
      // A true shared committee (a joint fundraising committee as PCC)
      // would have to be proven from the FEC itself and listed here.
      // Nothing in the snapshot legitimately shares one today.
      const holder = committeeIds.get(candidate.principalCommitteeId);
      assert.ok(
        !holder,
        `${candidate.name} and ${holder} share committee ${candidate.principalCommitteeId} — provable from the FEC or presumed broken`,
      );
      committeeIds.set(candidate.principalCommitteeId, candidate.name);
    }
    for (const key of candidate.targetKeys) {
      const owner = targetKeys.get(key);
      assert.ok(!owner, `target ${key} answers for both ${owner} and ${candidate.name}`);
      targetKeys.set(key, candidate.name);
    }
  }
});

test("D40: distinct officials resolve to distinct funding payloads", () => {
  // The production incident's trio, by name, then the general form.
  const kelly = fundingAnswerForTarget("congress:K000377");
  const gallego = fundingAnswerForTarget("congress:G000574");
  const grijalva = fundingAnswerForTarget("congress:G000606");
  for (const [who, answer] of [["Kelly", kelly], ["Gallego", gallego], ["Grijalva", grijalva]] as const) {
    assert.equal(answer.kind, "funding", `${who} lost their funding answer`);
  }
  const bodies = [kelly, gallego, grijalva].map((a) => JSON.stringify(a));
  assert.equal(new Set(bodies).size, 3, "the incident trio shares a payload again");

  // Every congress-target payload pairwise distinct.
  const congressKeys = snapshot.candidates
    .flatMap((c) => c.targetKeys)
    .filter((k) => k.startsWith("congress:"));
  const payloads = congressKeys.map((k) => JSON.stringify(fundingAnswerForTarget(k)));
  assert.equal(
    new Set(payloads).size,
    congressKeys.length,
    "two distinct officials resolve to identical funding payloads",
  );
});

test("D40: no query-keyed API route marks itself publicly cacheable", () => {
  // The incident's actual mechanism: /api/funding?target=… marked
  // `cache-control: public`, and the CDN's cache key dropped the query
  // string — the first official's body served for every target. A response
  // whose body varies by query string must not enter a shared cache; vary
  // by path instead.
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : /route\.ts$/.test(entry) ? [full] : [];
    });
  for (const file of walk(join(ROOT, "app", "api"))) {
    const source = readFileSync(file, "utf8");
    if (/searchParams/.test(source)) {
      assert.ok(
        !/cache-control["']?\s*:\s*["'][^"']*public/i.test(source),
        `${file} keys its body on a query string AND marks the response public — a shared cache may serve one target's body to all (D40)`,
      );
    }
  }
  // And the funding client asks the path-keyed form.
  const block = readFileSync(join(ROOT, "components", "funding", "funding-block.tsx"), "utf8");
  assert.match(block, /\/api\/funding\/\$\{encodeURIComponent\(holder\.id\)\}/, "funding block must fetch the path-keyed route");
});

// ── The ripcord registry ─────────────────────────────────────────────────

test("both ripcords are registered with question, closer, and tracker rows", () => {
  assert.deepEqual(RIPCORD_NAMES.sort(), [
    "ripcord.fecContributorDisplay",
    "ripcord.fundingReactionsInAggregates",
  ]);
  for (const name of RIPCORD_NAMES) {
    const ripcord = RIPCORDS[name];
    assert.ok(ripcord.question.length > 20, `${name} has no real question`);
    assert.match(ripcord.closer, /counsel/i, `${name} names no closer`);
    assert.ok(ripcord.trackerRows.includes("D23"), `${name} loses its tracker row`);
  }
});

test("ripcord.fundingReactionsInAggregates SHIPS pulled; contributor display ships live", () => {
  assert.equal(RIPCORDS["ripcord.fundingReactionsInAggregates"].pulled, true);
  assert.equal(RIPCORDS["ripcord.fecContributorDisplay"].pulled, false);
});

// ── Flag flips — each ripcord demonstrably functional in both positions ──

function withEnv<T>(name: string, value: string | undefined, fn: () => T): T {
  const prior = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (prior === undefined) delete process.env[name];
    else process.env[name] = prior;
  }
}

const fundingRow = {
  targetType: "FUNDING_TOTAL_REACTION" as const,
  targetId: snapshot.candidates[0]?.fecCandidateId ?? "H0XX00000",
  reaction: "YES" as const,
  ocdIds: ["ocd-division/country:us/state:az"],
  verificationTier: "ANONYMOUS" as const,
};
const contributorRow = { ...fundingRow, targetType: "CONTRIBUTOR_REACTION" as const };
const voteRow = {
  ...fundingRow,
  targetType: "FEDERAL_VOTE" as const,
  targetId: "house:119-2:283",
};

test("pulled (the shipped state): funding reactions are stored-but-never-aggregated", () => {
  const tallies = aggregateReactions([fundingRow, contributorRow, voteRow]);
  assert.equal(tallies.length, 1, "funding rows leaked into aggregation");
  assert.equal(tallies[0].targetType, "FEDERAL_VOTE");
  const eligible = rowsEligibleForAggregation([fundingRow, contributorRow, voteRow]);
  assert.deepEqual(eligible.map((r) => r.targetType), ["FEDERAL_VOTE"]);
  for (const type of FUNDING_REACTION_TYPES) {
    assert.ok(!eligible.some((r) => r.targetType === type));
  }
});

test("flip: closing the aggregates ripcord admits funding reactions (env override)", () => {
  withEnv("WTP_RIPCORD_FUNDING_REACTIONS_IN_AGGREGATES", "live", () => {
    assert.equal(ripcordPulled("ripcord.fundingReactionsInAggregates"), false);
    const tallies = aggregateReactions([fundingRow, voteRow]);
    assert.equal(tallies.length, 2, "closed ripcord should admit funding rows");
  });
  // And back: the committed state still filters.
  assert.equal(ripcordPulled("ripcord.fundingReactionsInAggregates"), true);
});

test("flip: pulling the contributor ripcord empties the display and its write path", () => {
  const withRows = snapshot.candidates.find((c) => c.topContributions.length > 0);
  assert.ok(withRows, "no candidate has contributor rows to test with");

  // Live (the shipped state): rows flow to display, write targets exist.
  assert.ok(contributorRowsForDisplay(withRows).length > 0);
  assert.ok(getContributorReactionTargetIds().size > 0);
  const live = fundingAnswerForTarget(withRows.targetKeys[0]);
  assert.equal(live.kind, "funding");
  assert.ok(live.kind === "funding" && live.data.contributorsShown);

  // Pulled: the SAME calls return nothing — a filter, not a hunt.
  withEnv("WTP_RIPCORD_FEC_CONTRIBUTOR_DISPLAY", "pulled", () => {
    assert.equal(contributorRowsForDisplay(withRows).length, 0);
    assert.equal(getContributorReactionTargetIds().size, 0);
    const pulled = fundingAnswerForTarget(withRows.targetKeys[0]);
    assert.ok(pulled.kind === "funding" && !pulled.data.contributorsShown);
    assert.ok(
      pulled.kind === "funding" && pulled.data.contributors.length === 0,
      "contributor rows escaped the pulled ripcord",
    );
    // Committee totals are unaffected — the pull is surgical.
    assert.ok(pulled.kind === "funding" && pulled.data.sentences.length > 0);
  });
});

// ── FEC_CONTRIBUTOR unreachable from aggregation/export ──────────────────

test("the aggregation layer never imports the funding corpus", () => {
  for (const file of readdirSync(join(ROOT, "lib", "signal"))) {
    const source = readFileSync(join(ROOT, "lib", "signal", file), "utf8");
    assert.ok(
      !/from\s+["'].*funding/.test(source),
      `lib/signal/${file} imports funding data — contributor rows must be unreachable from aggregation`,
    );
  }
});

test("aggregate output can never carry a contributor name", () => {
  // Structural: the tally shape is counts keyed by division and target id.
  const tallies = aggregateReactions([voteRow]);
  const keys = Object.keys(tallies[0]).sort();
  assert.deepEqual(keys, ["n", "ocdId", "targetId", "targetType", "tiers"]);
});

// ── The key stays in the fetch script ────────────────────────────────────

test("no runtime code reads FEC_API_KEY — fetch script only", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "node_modules" || entry === ".next") continue;
        walk(full);
      } else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry)) {
        if (readFileSync(full, "utf8").includes("FEC_API_KEY")) offenders.push(full);
      }
    }
  };
  for (const dir of ["app", "components", "lib", "hooks"]) walk(join(ROOT, dir));
  assert.deepEqual(offenders, [], `FEC_API_KEY reachable from runtime code: ${offenders.join(", ")}`);
});

// ── The plain register ───────────────────────────────────────────────────

test("plainMoney speaks the way people do", () => {
  assert.equal(plainMoney(6_172_867), "$6.2 million");
  assert.equal(plainMoney(40_775_023), "$41 million");
  assert.equal(plainMoney(657_711), "$658,000");
  assert.equal(plainMoney(325), "$325");
});

test("the funding sentences name the cycle and the small-donor method", () => {
  const answer = fundingAnswerForTarget("congress:C001133");
  assert.equal(answer.kind, "funding");
  if (answer.kind !== "funding") return;
  assert.match(answer.data.sentences[0], /raised .* in the 2025–26 election cycle/);
  const donorSentence = answer.data.sentences.find((s) => s.includes("small donors"));
  assert.ok(donorSentence, "small-donor share missing");
  assert.match(donorSentence!, /under \$200/, "the method must be stated in the words");
  // No internal identifier reaches the reader path.
  for (const s of answer.data.sentences) {
    assert.ok(!/FEC_(COMMITTEE|CONTRIBUTOR)/.test(s));
  }
});

test("the state-systems note is a stated gap, never silence pretending coverage", () => {
  assert.match(STATE_FUNDING_NOTE, /state campaign-finance systems/);
  assert.match(STATE_FUNDING_NOTE, /gap in our data/);
});

test("funding reaction target ids validate against the snapshot", () => {
  const ids = getFundingTargetIds();
  assert.ok(ids.has("H2AZ02360"), "Ciscomani's FEC id missing from the target set");
  assert.ok(!ids.has("congress:C001133"), "target ids are FEC candidate ids, not roster ids");
});

// ── The transparency coupling ────────────────────────────────────────────

test("the transparency page discloses funding data and the aggregate exclusion", () => {
  const page = readFileSync(join(ROOT, "app", "transparency", "page.tsx"), "utf8");
  assert.match(page, /Campaign money/);
  assert.match(page, /Federal\s+Election\s+Commission/);
  assert.match(page, /excluded\s+from\s+anything\s+licensed/);
});
