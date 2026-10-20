import { readerCacheHeaders } from "../lib/reader/cache.ts";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, test } from "node:test";
import { installFundingFixture, recordedFunding } from "./helpers/funding-fixture.ts";

import { RIPCORDS, RIPCORD_NAMES } from "../lib/ripcords.ts";
import {
  aggregateReactions,
  rowsEligibleForAggregation,
} from "../lib/signal/aggregate.ts";
import {
  FUNDING_REACTION_TYPES,
  QUESTION_REWORDINGS,
  SCALE_BREAKS,
  questionForTargetType,
  scaleForTargetType,
} from "../lib/signal/reactions.ts";
import {
  contributorRowsForDisplay,
  getContributorReactionTargetIds,
  getFundingSnapshot,
  getFundingTargetIds,
} from "../lib/funding/snapshot.ts";
import {
  fundingAnswerForTarget,
  plainContributorLabel,
  plainMoney,
  STATE_FUNDING_NOTE,
} from "../lib/funding/display.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";

const ROOT = join(import.meta.dirname, "..");
beforeEach(async () => { await installFundingFixture("AZ"); });
const snapshot = recordedFunding();

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

test("neutrality: no snapshot record grows a scoring key", () => {
  const banned = /"(score|rank|rating|match(?!Report|Routes)|fit|grade|alignment|recommendation)[a-zA-Z]*"\s*:/;
  const raw = readFileSync(join(ROOT, "data", "fec", "fec-2026.json"), "utf8");
  assert.ok(!banned.test(raw), "snapshot carries a scoring-class key");
});

// A join producing identical payloads across distinct keys is presumed broken.

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

test("D40: distinct officials resolve to distinct funding payloads", async () => {
  const kelly = fundingAnswerForTarget("congress:K000377");
  const gallego = fundingAnswerForTarget("congress:G000574");
  const grijalva = fundingAnswerForTarget("congress:G000606");
  for (const [who, answer] of [["Kelly", kelly], ["Gallego", gallego], ["Grijalva", grijalva]] as const) {
    assert.equal(answer.kind, "funding", `${who} lost their funding answer`);
  }
  const bodies = [kelly, gallego, grijalva].map((a) => JSON.stringify(a));
  assert.equal(new Set(bodies).size, 3, "the incident trio shares a payload again");

  const congressKeys: string[] = [], payloads: string[] = [];
  for (const state of ["AZ", "NH", "NJ"]) {
    const holding = await installFundingFixture(state);
    for (const key of holding.candidates.flatMap(row => row.targetKeys).filter(key => key.startsWith("congress:"))) {
      congressKeys.push(key); payloads.push(JSON.stringify(fundingAnswerForTarget(key)));
    }
  }
  assert.equal(
    new Set(payloads).size,
    congressKeys.length,
    "two distinct officials resolve to identical funding payloads",
  );
});

test("D40: no query-keyed API route marks itself publicly cacheable unless the CDN keys on every consumed query parameter", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : /route\.ts$/.test(entry) ? [full] : [];
    });
  const keyedOnEveryParameter: string[] = [];
  const sharedCacheIsPublic = /\bpublic\b/i.test(readerCacheHeaders({})["Cache-Control"] ?? "");
  for (const file of walk(join(ROOT, "app", "api"))) {
    const source = readFileSync(file, "utf8");
    const sharedCache = /\breaderCacheHeaders\s*\(/.test(source) && sharedCacheIsPublic;
    const literalCache = /cache-control["']?\s*:\s*["'][^"']*public/i.test(source);
    if (/searchParams/.test(source) && (sharedCache || literalCache)) {
      const vary = source.match(/"Netlify-Vary":\s*"([^"]+)"/)?.[1];
      assert.ok(vary === "query" || vary?.startsWith("query="), `${file} publicly caches a query response without varying its query`);
      if (vary !== "query") {
        const consumed = [...new Set([
          ...[...source.matchAll(/\.(?:get|getAll|has)\(\s*["']([^"']+)["']/g)].map(match => match[1]),
          ...[...source.matchAll(/\b(?:matching|numeric|numericInRange)\(\s*\w+\s*,\s*["']([^"']+)["']/g)].map(match => match[1]),
        ])].sort();
        assert.ok(consumed.length > 0, `${file} has no identified query parameters`);
        assert.deepEqual(vary!.slice("query=".length).split("|").sort(), consumed,
          `${file} must vary on every parameter its response reads, preventing another target's data from being served (D40)`);
      }
      keyedOnEveryParameter.push(relative(ROOT, file).replaceAll("\\", "/"));
    }
  }
  assert.deepEqual(keyedOnEveryParameter.sort(), ["app/api/agenda/route.ts", "app/api/directory/route.ts", "app/api/meetings/route.ts", "app/api/reader/state/route.ts"], "a new publicly cached query route is a decision to name here");
  const block = readFileSync(join(ROOT, "components", "funding", "funding-block.tsx"), "utf8");
  assert.match(block, /\/api\/funding\/\$\{encodeURIComponent\(holder\.id\)\}/, "funding block must fetch the path-keyed route");
});

test("every ripcord is registered with question, closer, and tracker rows", () => {
  // The list is exact so a new ripcord must pass the checks below.
  assert.deepEqual(RIPCORD_NAMES.sort(), [
    "ripcord.askClassifier",
    "ripcord.askGrounded",
    "ripcord.fecContributorDisplay",
    "ripcord.rateLimits",
    "ripcord.reactionIntake",
  ]);
  for (const name of RIPCORD_NAMES) {
    const ripcord = RIPCORDS[name];
    assert.ok(ripcord.question.length > 20, `${name} has no real question`);
    assert.ok(ripcord.closer.length > 10, `${name} names no closer`);
    assert.ok(ripcord.trackerRows.length > 0, `${name} loses its tracker row`);
  }
  assert.match(RIPCORDS["ripcord.fecContributorDisplay"].closer, /counsel/i);
  assert.ok(RIPCORDS["ripcord.fecContributorDisplay"].trackerRows.includes("D23"));
  for (const name of ["ripcord.rateLimits", "ripcord.reactionIntake"] as const) {
    assert.ok(RIPCORDS[name].trackerRows.includes("T08"));
  }
});

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
  // A funding target accepts only the five-point scale.
  reaction: "LOVE" as const,
  scaleVersion: 2 as const,
  ocdIds: ["ocd-division/country:us/state:az"],
  verificationTier: "ANONYMOUS" as const,
  runClass: "ORGANIC" as const,
};
/** A contributions answer as the write path stamps it today (v3). */
const contributorRow = {
  ...fundingRow,
  targetType: "CONTRIBUTOR_REACTION" as const,
  scaleVersion: 3 as const,
};

/** The same ask, as it was collected before the bump. Never pooled with the above. */
const contributorRowV2 = {
  ...fundingRow,
  targetType: "CONTRIBUTOR_REACTION" as const,
  scaleVersion: 2 as const,
};
const voteRow = {
  ...fundingRow,
  targetType: "FEDERAL_VOTE" as const,
  targetId: "house:119-2:283",
  reaction: "YES" as const,
  scaleVersion: 1 as const,
};

test("live (the shipped state): funding reactions are aggregated like any other", () => {
  const tallies = aggregateReactions([fundingRow, contributorRow, voteRow]);
  assert.equal(tallies.length, 3, "a funding row was filtered while the flag is live");
  const eligible = rowsEligibleForAggregation([fundingRow, contributorRow, voteRow]);
  for (const type of FUNDING_REACTION_TYPES) {
    assert.ok(
      eligible.some((r) => r.targetType === type),
      `${type} was filtered out of a live aggregate`,
    );
  }
});

test("flip: pulling the contributor ripcord empties the display and its write path", () => {
  const withRows = getFundingSnapshot().candidates.find((c) => c.topContributions.length > 0);
  assert.ok(withRows, "no candidate has contributor rows to test with");

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
  // `question` is our own words for the question asked, never anything read off a filing.
  const tallies = aggregateReactions([voteRow]);
  const keys = Object.keys(tallies[0]).sort();
  assert.deepEqual(keys, [
    "n",
    "ocdId",
    "question",
    "scaleVersion",
    "targetId",
    "targetType",
    "tiers",
  ]);

  const funding = aggregateReactions([fundingRow, contributorRow]);
  for (const tally of funding) {
    assert.deepEqual(Object.keys(tally).sort(), keys);
    for (const tier of Object.values(tally.tiers)) {
      for (const column of Object.keys(tier)) {
        assert.match(
          column,
          /^(n|LOVE|LIKE|DISLIKE|HATE|DONT_CARE)$/,
          `a funding tally grew the column ${column}`,
        );
      }
    }
  }
});

/** The subject is a READ that yields the value; naming the variable is not reading it. */
test("runtime routes and cards do not directly read FEC_API_KEY", () => {
  const READ_SHAPES = [/process\s*\.\s*env\s*\.\s*FEC_API_KEY/, /process\s*\.\s*env\s*\[\s*["'`]FEC_API_KEY["'`]\s*\]/];
  const reads = (source: string): boolean => READ_SHAPES.some((shape) => shape.test(source));

  const offenders: string[] = [];
  let scanned = 0;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "node_modules" || entry === ".next") continue;
        walk(full);
      } else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry)) {
        scanned += 1;
        if (reads(readFileSync(full, "utf8"))) offenders.push(full);
      }
    }
  };
  for (const dir of ["app", "components", "lib", "hooks"]) walk(join(ROOT, dir));
  assert.ok(scanned > 100, `the sweep reached only ${scanned} files, so it did not reach the tree`);
  assert.deepEqual(offenders, [], `FEC_API_KEY is READ by runtime code: ${offenders.join(", ")}`);

  // POSITIVE CONTROL: the two real read shapes, and the one legitimate mention.
  assert.ok(reads("const k = process.env.FEC_API_KEY;"));
  assert.ok(reads('const k = process.env["FEC_API_KEY"];'));
  assert.ok(!reads('const NAMES = { "fec-api": ["FEC_API_KEY"] };'), "naming the variable in a presence table is not reading it");
});

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
  const donorSentence = answer.data.sentences.find((s) => s.includes("of individual money"));
  assert.ok(donorSentence, "small-donor share missing");
  assert.match(donorSentence!, /giving \$200 or less/, "the method must be stated in the words");
  // No internal identifier reaches the reader path.
  for (const s of answer.data.sentences) {
    assert.ok(!/FEC_(COMMITTEE|CONTRIBUTOR)/.test(s));
  }
});

test("2a: a candidate's own money is labeled as exactly that, from the FEC fields", () => {
  // The mechanism, not the name: entity CAN or a 13A candidate loan.
  assert.equal(
    plainContributorLabel({ kind: "COMMITTEE_OR_ORGANIZATION", entityType: "CAN", lineNumber: "11D" }),
    "the candidate's own money",
  );
  assert.equal(
    plainContributorLabel({ kind: "COMMITTEE_OR_ORGANIZATION", entityType: null, lineNumber: "13A" }),
    "the candidate's own money",
  );
  assert.equal(plainContributorLabel({ kind: "INDIVIDUAL", entityType: "IND", lineNumber: "11AI" }), null);
  assert.equal(
    plainContributorLabel({ kind: "COMMITTEE_OR_ORGANIZATION", entityType: "PAC", lineNumber: null }),
    "a political action committee",
  );
  // No typing on the row: the honest generic, never a guess.
  assert.equal(
    plainContributorLabel({ kind: "COMMITTEE_OR_ORGANIZATION", entityType: null, lineNumber: null }),
    "committee or organization",
  );

  const butierez = snapshot.candidates.find((c) => c.fecCandidateId === "H4AZ07134");
  assert.ok(butierez, "Butierez left the snapshot — retarget this check");
  const selfRows = butierez.topContributions.filter((r) => r.entityType === "CAN");
  assert.ok(selfRows.length > 0, "Butierez's CAN rows vanished from the snapshot");
  for (const row of selfRows) {
    assert.equal(plainContributorLabel(row), "the candidate's own money");
  }
  // Every CAN row snapshot-wide gets the label — the rule is mechanical.
  for (const candidate of snapshot.candidates) {
    for (const row of candidate.topContributions) {
      if (row.entityType === "CAN") {
        assert.equal(plainContributorLabel(row), "the candidate's own money");
      }
    }
  }
});

test("item 2: contributions group by kind and sort by amount descending, in both groups", async () => {
  const { groupContributions } = await import("../lib/funding/grouping.ts");
  // Every candidate in the snapshot, not one specimen.
  let checked = 0;
  for (const candidate of snapshot.candidates) {
    if (candidate.topContributions.length === 0) continue;
    const groups = groupContributions(candidate.topContributions);
    for (const column of [groups.organizations, groups.individuals]) {
      for (let i = 1; i < column.length; i++) {
        assert.ok(
          column[i - 1].amount >= column[i].amount,
          `${candidate.name}: ${column[i - 1].contributorName} ($${column[i - 1].amount}) sorted above ${column[i].contributorName} ($${column[i].amount})`,
        );
      }
    }
    for (const g of groups.organizations) {
      assert.equal(g.kind, "COMMITTEE_OR_ORGANIZATION");
    }
    for (const g of groups.individuals) assert.equal(g.kind, "INDIVIDUAL");
    checked += 1;
  }
  assert.ok(checked >= 20, `only ${checked} candidates carried rows to check`);
});

test("item 2: sums equal the parts, and no filing is lost in a collapse", async () => {
  const { groupContributions } = await import("../lib/funding/grouping.ts");
  let collapsedSeen = 0;
  for (const candidate of snapshot.candidates) {
    const rows = candidate.topContributions;
    if (rows.length === 0) continue;
    const groups = groupContributions(rows);
    const all = [...groups.organizations, ...groups.individuals];
    // Nothing dropped: every filing appears in exactly one group.
    assert.equal(
      all.reduce((n, g) => n + g.filings.length, 0),
      rows.length,
      `${candidate.name}: filings lost or duplicated in the grouping`,
    );
    // Compared in cents: these are IEEE doubles.
    const cents = (n: number) => Math.round(n * 100);
    for (const g of all) {
      assert.equal(
        cents(g.amount),
        cents(g.filings.reduce((sum, f) => sum + f.amount, 0)),
        `${candidate.name}: ${g.contributorName}'s summed amount is not the sum of its filings`,
      );
      assert.equal(g.count, g.filings.length);
      if (g.count > 1) collapsedSeen += 1;
    }
    // And the whole column still adds to the whole input.
    assert.equal(
      cents(all.reduce((n, g) => n + g.amount, 0)),
      cents(rows.reduce((n, r) => n + r.amount, 0)),
    );
  }
  assert.ok(collapsedSeen > 0, "no collapsed row anywhere — the fold never ran");
});

test("item 2: the five Booker Victory Fund lines collapse to one row typed as transfers", async () => {
  const { groupContributions } = await import("../lib/funding/grouping.ts");
  const booker = snapshot.candidates.find((c) => c.fecCandidateId === "S4NJ00185");
  assert.ok(booker, "Booker left the snapshot — retarget this check");
  const groups = groupContributions(booker.topContributions);
  const fund = groups.organizations.find((g) =>
    g.contributorName.includes("BOOKER VICTORY FUND"),
  );
  assert.ok(fund, "the Booker Victory Fund rows are gone");
  assert.ok(fund.count > 1, "the repeated filings did not fold");
  // Transfers stay transfers: the noun comes off FEC form line 12, never
  // off a guess about what a joint fundraiser's money means.
  assert.equal(fund.countNoun, "transfers");
  for (const filing of fund.filings) assert.equal(filing.lineNumber, "12");
  assert.equal(
    fund.amount,
    fund.filings.reduce((n, f) => n + f.amount, 0),
  );
  // It leads its column — the reader's question is who spent the most.
  assert.equal(groups.organizations[0].key, fund.key);
});

test("item 3: the hop renders only for committee-typed rows, never for individuals", async () => {
  await installFundingFixture("NJ");
  const { groupContributions } = await import("../lib/funding/grouping.ts");
  const { secondHopForGroups } = await import("../lib/funding/snapshot.ts");
  const booker = snapshot.candidates.find((c) => c.fecCandidateId === "S4NJ00185");
  assert.ok(booker);
  const groups = groupContributions(booker.topContributions);
  const hop = secondHopForGroups(groups);
  const fund = groups.organizations.find((g) =>
    g.contributorName.includes("BOOKER VICTORY FUND"),
  )!;
  assert.ok(hop[fund.contributorCommitteeId!], "the fund's own books are missing");

  // An individual's row can carry a CONDUIT committee id (a cheque given
  // through ActBlue or an earmarking PAC files with that committee's id
  // attached). That must never open a tea expander: the individual is the
  // donor, and rendering the conduit's donors under their name would be a
  // different claim entirely.
  const withConduit = groups.individuals.filter((g) => g.contributorCommitteeId);
  assert.ok(withConduit.length > 0, "no conduit-id individual to check against");
  for (const individual of withConduit) {
    assert.ok(
      !Object.keys(hop).includes(individual.contributorCommitteeId!) ||
        groups.organizations.some(
          (o) => o.contributorCommitteeId === individual.contributorCommitteeId,
        ),
      "a conduit id reached the hop set through an individual row",
    );
  }
});

test("item 3: hop books are mechanical, attributed, and distinct per committee id", () => {
  const hops = snapshot.secondHop ?? [];
  assert.ok(hops.length >= 20, `only ${hops.length} second-hop committees`);
  const ids = new Set(hops.map((h) => h.committeeId));
  assert.equal(ids.size, hops.length, "a committee id is stored twice");

  // Identical payloads across distinct funds are presumed broken.
  const books = new Map<string, string>();
  for (const hop of hops) {
    const signature = JSON.stringify(
      hop.topContributions.map((r) => [r.contributorName, r.amount]),
    );
    if (hop.topContributions.length === 0) continue;
    const clash = books.get(signature);
    assert.equal(
      clash,
      undefined,
      `${hop.committeeId} and ${clash} carry identical books — distinct keys must produce distinct results`,
    );
    books.set(signature, hop.committeeId);
  }

  for (const hop of hops) {
    assert.equal(hop.dataClass, "FEC_CONTRIBUTOR");
    assert.match(hop.committeeId, /^C\d{8}$/);
    assert.ok(hop.name.length > 0);
    assert.match(
      hop.provenance.sourceUrl ?? "",
      new RegExp(`^https://www\\.fec\\.gov/data/committee/${hop.committeeId}/$`),
      "every hop links to its own committee's FEC page, not the candidate's",
    );
    assert.equal(hop.provenance.sourceOrg, "Federal Election Commission");
    for (const row of hop.topContributions) {
      assert.equal(row.dataClass, "FEC_CONTRIBUTOR");
      assert.ok(row.amount > 0);
    }
  }
});

test("item 3: the tea is only in the button — the panel's own words stay level", () => {
  const source = readFileSync(
    join(ROOT, "components", "funding", "funding-section.tsx"),
    "utf8",
  );
  assert.ok(source.includes("Give me the tea"), "the author's exact label");
  // The panel's heading names the FUND, never relabels its donors as the
  // candidate's.
  assert.ok(source.includes("Who gives to {hop.name}"));
  assert.ok(
    source.includes("not this campaign&apos;s") ||
      source.includes("not this campaign's"),
    "the panel must say whose donors these are not",
  );
  // The allocation note is conditioned on the FILED designation, so a PAC
  // never wears a joint fundraiser's explanation.
  assert.ok(source.includes('hop.designation === "J"'));
  // Nothing in the panel characterizes an organization.
  const panel = source.slice(source.indexOf("function SecondHopPanel"));
  for (const banned of ["-aligned", "affiliate", "progressive group", "conservative group"]) {
    assert.ok(!panel.includes(banned), `the hop panel characterizes: "${banned}"`);
  }
});

test("item 3: pulling the contributor ripcord empties the second hop too", async () => {
  await installFundingFixture("NJ");
  const { groupContributions } = await import("../lib/funding/grouping.ts");
  const { secondHopForGroups } = await import("../lib/funding/snapshot.ts");
  const booker = snapshot.candidates.find((c) => c.fecCandidateId === "S4NJ00185")!;
  const groups = groupContributions(booker.topContributions);
  assert.ok(Object.keys(secondHopForGroups(groups)).length > 0);
  const before = process.env.WTP_RIPCORD_FEC_CONTRIBUTOR_DISPLAY;
  process.env.WTP_RIPCORD_FEC_CONTRIBUTOR_DISPLAY = "pulled";
  try {
    assert.deepEqual(
      secondHopForGroups(groups),
      {},
      "the hop must die with the first-hop display — a pull is a data filter",
    );
  } finally {
    if (before === undefined) delete process.env.WTP_RIPCORD_FEC_CONTRIBUTOR_DISPLAY;
    else process.env.WTP_RIPCORD_FEC_CONTRIBUTOR_DISPLAY = before;
  }
});

test("a surface headed 'contributions' carries only contributions — no offsets, no interest, no loan repayments", () => {
  // Contribution lines only: 11* (individuals, party committees, other
  // political committees, the candidate), 12 (transfers from authorized
  // committees), 13A (a candidate's loan to their own campaign, which
  // renders as exactly that). Money flowing back to a campaign is not
  // somebody funding it.
  const isContribution = (line: string | null) =>
    line !== null && (line.startsWith("11") || line === "12" || line === "13A");

  const offenders: string[] = [];
  for (const candidate of snapshot.candidates) {
    for (const row of candidate.topContributions) {
      if (!isContribution(row.lineNumber) || row.amount <= 0) {
        offenders.push(
          `${candidate.name}: ${row.contributorName} $${row.amount} line ${row.lineNumber}`,
        );
      }
    }
  }
  for (const hop of snapshot.secondHop ?? []) {
    for (const row of hop.topContributions) {
      if (!isContribution(row.lineNumber) || row.amount <= 0) {
        offenders.push(
          `${hop.name}: ${row.contributorName} $${row.amount} line ${row.lineNumber}`,
        );
      }
    }
  }
  assert.deepEqual(offenders, [], "non-contribution receipts reached a contributions surface");
});

// The individual-dollar denominator comes from the filing's two own lines.
test("small-donor money uses individual dollars and the inclusive $200 threshold", async () => {
  const { smallDonorSentence, smallDonorShare } = await import("../lib/funding/display.ts");
  assert.equal(smallDonorShare(150, 175), 175 / 325);
  assert.match(smallDonorSentence(150, 175)!, /\$175 \(54%\) of individual money/);
  assert.match(smallDonorSentence(150, 175)!, /giving \$200 or less in the cycle/);
  assert.match(smallDonorSentence(380, 620)!, /62%/);
  assert.equal(smallDonorSentence(0, 0), null);
  assert.equal(smallDonorSentence(null, 175), null);
  assert.equal(smallDonorSentence(150, null), null);
  assert.equal(smallDonorSentence(-1, 175), null);
  assert.match(smallDonorSentence(1_000_000, 1)!, /under 1%/);
});

test("held federal cards show the authorized small-donor dollar share without a size floor", async () => {
  for (const key of ["ballot-nh-merrimack:us-house-2:nicholson-dan", "congress:B001288"]) {
    await installFundingFixture(key.startsWith("ballot-nh-") ? "NH" : "NJ");
    const answer = fundingAnswerForTarget(key);
    assert.equal(answer.kind, "funding");
    if (answer.kind !== "funding") continue;
    const line = answer.data.sentences.find(sentence => /of individual money/.test(sentence));
    assert.ok(line && /%/.test(line));
    assert.doesNotMatch(answer.data.concentrationSentences.join(" "), /%|not the whole|don't sort|don't give a district|single biggest/i);
    assert.doesNotMatch(answer.data.typeConcentrationSentences.join(" "), /%|don't sort|we picked/i);
  }
});

/** The note says where the money is and that its absence here is not a claim that none was raised. */
test("the state-systems note is a stated gap, never silence pretending coverage", () => {
  assert.match(STATE_FUNDING_NOTE, /state campaign-finance systems/);
  assert.doesNotMatch(
    STATE_FUNDING_NOTE,
    /not a statement/i,
    "no disclaimer line on a reader surface",
  );
  assert.doesNotMatch(STATE_FUNDING_NOTE, /gap in our (data|research)/i);
  assert.doesNotMatch(
    STATE_FUNDING_NOTE,
    /we (?:have not|haven't|haven’t) wired/i,
    "no progress report about our own pipeline on a reader surface",
  );
});

test("funding reaction target ids validate against the snapshot", () => {
  const ids = getFundingTargetIds();
  assert.ok(ids.has("H2AZ02360"), "Ciscomani's FEC id missing from the target set");
  assert.ok(!ids.has("congress:C001133"), "target ids are FEC candidate ids, not roster ids");
});

test("the FEC acquisition script has no tracked writer and is reachable only through the standing routine contract", () => {
  const script = readFileSync(join(ROOT, "scripts", "fetch-fec.mts"), "utf8");
  assert.match(script, /if \(!promote\)/);
  assert.match(script, /fecFundingCandidate\(/);
  assert.match(script, /processRegisteredRoutineCandidate\(store, contractId, candidate, new Date\(\)\.toISOString\(\)\)/);
  assert.doesNotMatch(script, /writeStampStable|writeFile(?:Sync)?|absolutePath:\s*OUT|--allow-shrink|findShrinkRegressions/);

  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(manifest.scripts["fec:fetch"], undefined);
  assert.equal(manifest.scripts["fec:promote"], undefined);
  assert.ok(
    Object.values(manifest.scripts).every((command) => !command.includes("scripts/fetch-fec.mts")),
    "the standing routine adapter regained a direct package door",
  );
  assert.deepEqual(
    requiredRoutineContract("fec-funding:AZ").acquisitionAdapter.command,
    ["scripts/fetch-fec.mts", "--promote", "--state=AZ"],
  );
});

/** Say what kind of money a committee is, derived only from what the committee itself filed. */
test("item 6: every FEC code in our snapshot maps, or falls to the honest default", async () => {
  const { committeeTypeLabelFor, COMMITTEE_TYPE_LABELS } = await import(
    "../lib/funding/committee-types.ts"
  );
  const snapshot = JSON.parse(
    readFileSync(join(process.cwd(), "data", "fec", "fec-2026.json"), "utf8"),
  ) as { candidates: { topContributions: Record<string, string | null>[] }[] };
  const rows = snapshot.candidates.flatMap((c) => c.topContributions);
  assert.ok(rows.length > 0, "the snapshot has contribution rows to check");

  const allowed = new Set(COMMITTEE_TYPE_LABELS.map((l) => l.label));
  let typed = 0;
  let untyped = 0;
  for (const row of rows) {
    const filed = {
      committeeType: row.committeeType ?? null,
      organizationType: row.organizationType ?? null,
      designation: row.designation ?? null,
    };
    const label = committeeTypeLabelFor(filed);
    if (!filed.committeeType && !filed.organizationType && !filed.designation) {
      // Nothing filed: the derivation must NOT invent a type.
      assert.equal(
        label,
        null,
        `a row with no filed typing must produce no type label (${JSON.stringify(filed)})`,
      );
      untyped++;
      continue;
    }
    assert.ok(
      label,
      `filed typing ${JSON.stringify(filed)} produced no label — every code maps or falls to the default`,
    );
    assert.ok(
      allowed.has(label.label),
      `"${label.label}" is not in COMMITTEE_TYPE_LABELS — no label may render that is not in the table`,
    );
    typed++;
  }
  // Denominators, stated: a silently empty audit is not a passing audit.
  assert.ok(
    typed > 0,
    `${typed} typed and ${untyped} untyped rows — the snapshot carries no committee typing at all, so this test proved nothing`,
  );
});

test("item 6: an unknown code never invents a label — it falls to the honest generic", async () => {
  const { committeeTypeLabelFor } = await import(
    "../lib/funding/committee-types.ts"
  );
  // A code the FEC does not publish, and one it does but we do not map.
  for (const committeeType of ["ZZ", "E", "C", "I", "D"]) {
    const label = committeeTypeLabelFor({
      committeeType,
      organizationType: null,
      designation: null,
    });
    assert.equal(
      label?.id,
      "organization",
      `committee type ${committeeType} must fall to the honest generic, not a guess`,
    );
  }
  // Nothing filed at all produces nothing at all.
  assert.equal(
    committeeTypeLabelFor({
      committeeType: null,
      organizationType: null,
      designation: null,
    }),
    null,
  );
});

test("item 6: the designation wins over the committee type where it is the more specific fact", async () => {
  const { committeeTypeLabelFor } = await import(
    "../lib/funding/committee-types.ts"
  );
  // A joint fundraising committee files as committee type S or N; its designation must win.
  assert.equal(
    committeeTypeLabelFor({
      committeeType: "S",
      organizationType: null,
      designation: "J",
    })?.id,
    "joint-fundraiser",
  );
  assert.equal(
    committeeTypeLabelFor({
      committeeType: "N",
      organizationType: null,
      designation: "J",
    })?.id,
    "joint-fundraiser",
  );
  // A leadership PAC also files as a qualified PAC.
  assert.equal(
    committeeTypeLabelFor({
      committeeType: "Q",
      organizationType: null,
      designation: "D",
    })?.id,
    "leadership-pac",
  );
  // A separate segregated fund is typed by the organization behind it.
  for (const [org, id] of [
    ["C", "pac-corporation"],
    ["L", "pac-labor"],
    ["T", "pac-trade-association"],
    ["M", "pac-membership"],
    ["V", "pac-cooperative"],
    ["W", "pac-no-capital-stock"],
  ] as const) {
    assert.equal(
      committeeTypeLabelFor({
        committeeType: "Q",
        organizationType: org,
        designation: "B",
      })?.id,
      id,
      `ORG_TP ${org} types the PAC by its connected organization`,
    );
  }
  // A PAC with no connected-organization category stays honestly generic.
  assert.equal(
    committeeTypeLabelFor({
      committeeType: "N",
      organizationType: null,
      designation: "U",
    })?.id,
    "pac",
  );
  // Independent-expenditure-only is the super PAC.
  assert.equal(
    committeeTypeLabelFor({
      committeeType: "O",
      organizationType: null,
      designation: "U",
    })?.id,
    "super-pac",
  );
});

test("item 6: every label carries two plain sentences and a verified FEC source, and characterizes nobody", async () => {
  const { COMMITTEE_TYPE_LABELS } = await import(
    "../lib/funding/committee-types.ts"
  );
  const ids = new Set<string>();
  for (const entry of COMMITTEE_TYPE_LABELS) {
    assert.ok(!ids.has(entry.id), `duplicate label id ${entry.id}`);
    ids.add(entry.id);
    // Two sentences, per the brief. Counting terminators is enough here
    // because none of the copy uses an abbreviation with a period.
    const sentences = entry.explainer
      .split(/(?<=[.!?])\s+/)
      .filter((s) => s.trim().length > 0);
    assert.equal(
      sentences.length,
      2,
      `${entry.id}: the explainer is two sentences, not ${sentences.length}`,
    );
    assert.ok(
      /^https:\/\/www\.fec\.gov\//.test(entry.sourceUrl),
      `${entry.id}: the explainer cites the FEC's own page`,
    );
    // The organizations-as-filed rule, in the explainers too: a type label
    // says what a committee IS, never what it is for or who it favors.
    for (const banned of [
      "affiliate",
      "aligned",
      "progressive",
      "conservative",
      "liberal",
      "right-wing",
      "left-wing",
      "dark money",
      "special interest",
      "influence-peddl",
    ]) {
      assert.ok(
        !entry.explainer.toLowerCase().includes(banned) &&
          !entry.label.toLowerCase().includes(banned),
        `${entry.id}: "${banned}" characterizes rather than states what was filed`,
      );
    }
  }
  assert.ok(
    COMMITTEE_TYPE_LABELS.length >= 10,
    `only ${COMMITTEE_TYPE_LABELS.length} labels — the table is too thin to have replaced the undifferentiated one`,
  );
});

test("item 6: nothing is ever typed from a committee's NAME", async () => {
  const src = readFileSync(
    join(process.cwd(), "lib", "funding", "committee-types.ts"),
    "utf8",
  );
  // The derivation reads three filed fields and nothing else.
  const body = src.slice(src.indexOf("export function committeeTypeLabelFor"));
  assert.ok(body.length > 200, "the derivation was found and read");
  // Plain substrings, not regexes: `new RegExp("includes(")` throws instead of checking.
  for (const banned of [
    "contributorName",
    ".name",
    ".includes(",
    ".test(",
    ".match(",
    ".toLowerCase(",
  ]) {
    assert.ok(
      !body.includes(banned),
      `the derivation must not inspect names or strings (found "${banned}")`,
    );
  }
  // And it reads exactly the three filed fields.
  for (const field of ["committeeType", "organizationType", "designation"]) {
    assert.ok(body.includes(field), `the derivation reads ${field}`);
  }
});

test("no committed snapshot claims to have been read on a day that has not happened", async () => {
  // After 5pm Arizona time UTC has already rolled over, so scripts call stamp(), never toISOString().
  const { stamp } = await import("../scripts/stamp.mts");
  const today = stamp();

  const dates: { where: string; date: string }[] = [];
  for (const c of snapshot.candidates) {
    dates.push({ where: `candidate ${c.fecCandidateId}`, date: c.provenance.collectedAt });
    dates.push({ where: `candidate ${c.fecCandidateId}`, date: c.provenance.verifiedAt ?? today });
  }
  for (const h of snapshot.secondHop ?? []) {
    dates.push({ where: `hop ${h.committeeId}`, date: h.provenance.collectedAt });
  }
  for (const a of snapshot.absences) {
    dates.push({ where: `absence ${a.targetKey}`, date: a.checkedAt });
  }

  const future = dates.filter((d) => d.date > today);
  assert.deepEqual(
    future.map((d) => `${d.where}: ${d.date}`),
    [],
    `provenance dates later than ${today} (America/Phoenix)`,
  );

  // Comments stripped first: the file explains the trap by quoting it, and
  // a scan that reads prose would fail on the explanation.
  const fetchScript = readFileSync(join(ROOT, "scripts", "fetch-fec.mts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/.test(fetchScript),
    "record observations must come from the source evidence, not a new day stamp",
  );
  assert.ok(fetchScript.includes("acquired.sourceObservedAt"));
});

/* One ask per object, and two provably distinct sensors that never pool. */

test("the two funding asks are two sensors, at the write path and the aggregate", () => {
  // 1. Different target types and different scale versions.
  assert.notEqual(fundingRow.targetType, contributorRow.targetType);
  assert.notEqual(
    scaleForTargetType("FUNDING_TOTAL_REACTION").version,
    scaleForTargetType("CONTRIBUTOR_REACTION").version,
  );

  // 2. Different questions, per target type.
  assert.equal(
    questionForTargetType("FUNDING_TOTAL_REACTION"),
    "How do you feel about how this campaign is funded?",
  );
  assert.equal(
    questionForTargetType("CONTRIBUTOR_REACTION"),
    "How do you feel about these contributions?",
  );

  // 3. Separate aggregate buckets — same target id, same division, same
  //    version, still two tallies, each labelled with its own question.
  const tallies = aggregateReactions([fundingRow, contributorRow]);
  assert.equal(tallies.length, 2, "two funding asks pooled into one tally");
  const totals = tallies.find((t) => t.targetType === "FUNDING_TOTAL_REACTION");
  const contributors = tallies.find((t) => t.targetType === "CONTRIBUTOR_REACTION");
  assert.ok(totals && contributors);
  assert.equal(totals.n, 1);
  assert.equal(contributors.n, 1);
  assert.notEqual(totals.question, contributors.question);
  assert.equal(contributors.question, "How do you feel about these contributions?");

  // 3b. Pre-bump contributions rows are a third tally, labelled with the wording they were collected under.
  const withOld = aggregateReactions([fundingRow, contributorRow, contributorRowV2]);
  assert.equal(withOld.length, 3, "a pre-bump contributions row pooled with a post-bump one");
  const stale = withOld.find(
    (t) => t.targetType === "CONTRIBUTOR_REACTION" && t.scaleVersion === 2,
  );
  assert.ok(stale, "the pre-bump contributions rows vanished from the aggregate");
  assert.equal(
    stale.question,
    "How do you feel about how this campaign is funded?",
    "a v2 row was relabelled with a wording it never saw",
  );

  // 4. The store cannot merge them either: the upsert's conflict target
  //    carries targetType alongside the key and the id.
  const writePath = readFileSync(
    join(process.cwd(), "lib", "db", "reactions.ts"),
    "utf8",
  );
  assert.ok(
    /target: \[reactions\.reactionKeyHash, reactions\.targetType, reactions\.targetId\]/.test(
      writePath,
    ),
    "the upsert must key on targetType, or one browser's two answers overwrite each other",
  );
});

test("the contributions rewording is recorded, and the author's version bump with it", () => {
  const rewording = QUESTION_REWORDINGS.find(
    (r) => r.targetType === "CONTRIBUTOR_REACTION",
  );
  assert.ok(rewording, "the contributions rewording must be on the record");
  assert.equal(rewording.date, "2026-08-16");
  assert.equal(rewording.to, questionForTargetType("CONTRIBUTOR_REACTION"));
  assert.notEqual(rewording.from, rewording.to);

  // `.find` on the target type alone would return the 2026-08-15 break,
  // which lists BOTH funding types — the bump is the one that lands on v3.
  const bump = SCALE_BREAKS.find(
    (b) => b.targetTypes.includes("CONTRIBUTOR_REACTION") && b.to === 3,
  );
  assert.ok(bump, "the author's version bump must be filed as a scale break");
  assert.equal(bump.date, "2026-08-16");
  assert.equal(bump.from, 2);
  assert.equal(bump.to, 3);
  assert.equal(
    bump.to,
    scaleForTargetType("CONTRIBUTOR_REACTION").version,
    "the break's target version and the live scale disagree",
  );
  assert.ok(bump.why.length > 40, "a scale break without a reason is a mystery");
});

/** A contribution row with only the fields a test cares about set. */
function row(
  overrides: Partial<import("../lib/funding/types.ts").ContributionRow>,
): import("../lib/funding/types.ts").ContributionRow {
  return {
    dataClass: "FEC_CONTRIBUTOR",
    kind: "INDIVIDUAL",
    contributorName: "SOMEBODY, A",
    amount: 100,
    receiptDate: "2026-01-01",
    city: null,
    state: null,
    entityType: null,
    lineNumber: "11AI",
    committeeType: null,
    organizationType: null,
    designation: null,
    contributorCommitteeId: null,
    ...overrides,
  };
}

/* Where the money came from: computed over the five biggest committee gifts plus the five biggest individual gifts, which is not the campaign's book. */

test("D06: the sentences state their base before they state any figure", async () => {
  const { concentrationOf, concentrationSentences } = await import(
    "../lib/funding/concentration.ts"
  );
  const rows = [
    row({ kind: "COMMITTEE_OR_ORGANIZATION", amount: 5000, state: "AZ" }),
    row({ kind: "INDIVIDUAL", amount: 1000, state: "NY" }),
  ];
  const concentration = concentrationOf(rows, "AZ");
  assert.ok(concentration);
  const sentences = concentrationSentences(concentration, "Arizona");

  // The base comes FIRST — every number after it is a share of it.
  assert.match(sentences[0], /listed above/i);
  assert.doesNotMatch(sentences.join(" "), /not the whole|%/i);

  // It never claims to be the largest contributions overall.
  for (const sentence of sentences) {
    assert.doesNotMatch(
      sentence,
      /\d+ largest contributions this campaign reported/i,
      `a sentence still describes the base as the N largest: ${sentence}`,
    );
  }
});

test("D06: a small non-zero share never renders as zero", async () => {
  const { shareWords } = await import("../lib/funding/concentration.ts");

  // "0%" beside "across 2 of them" would be a contradiction.
  assert.equal(shareWords(31_000, 2_916_000), "1%", "1.06% is 1%, not 'under'");
  assert.equal(shareWords(11_000, 2_916_000), "under 1%");
  assert.equal(shareWords(1, 1_000_000), "under 1%");
  // A true zero is still zero — the rule fixes rounding, not arithmetic.
  assert.equal(shareWords(0, 2_916_000), "0%");
  assert.equal(shareWords(999_999, 1_000_000), "over 99%");
  assert.equal(shareWords(1_000_000, 1_000_000), "100%");
  assert.equal(shareWords(500_000, 1_000_000), "50%");
});

test("D06: no district is claimed from a filing that gives only a state", async () => {
  const { concentrationOf, concentrationSentences } = await import(
    "../lib/funding/concentration.ts"
  );
  const concentration = concentrationOf(
    [row({ amount: 1000, state: "AZ" }), row({ amount: 1000, state: "NY" })],
    "AZ",
  );
  assert.ok(concentration);
  const sentences = concentrationSentences(concentration, "Arizona").join(" ");

  // A congressional district is a ballot fact a filing's zip cannot resolve.
  assert.match(sentences, /Filed from inside Arizona: \$1,000/);
  assert.doesNotMatch(sentences, /don't give a district|%/i);
  assert.doesNotMatch(sentences, /in-district|out-of-district|their district/i);
});

test("D06: nothing is sorted into an industry, and the org split is dollars not a share", async () => {
  const { concentrationOf, concentrationSentences } = await import(
    "../lib/funding/concentration.ts"
  );
  const concentration = concentrationOf(
    [
      row({ kind: "COMMITTEE_OR_ORGANIZATION", amount: 10_000, state: "AZ" }),
      row({ kind: "INDIVIDUAL", amount: 2_000, state: "AZ" }),
    ],
    "AZ",
  );
  assert.ok(concentration);
  const sentences = concentrationSentences(concentration, "Arizona").join(" ");

  // No industry taxonomy: the FEC publishes none, and third-party ones are excluded.
  assert.doesNotMatch(sentences, /industry|sector|interest group|lobby/i);
  assert.doesNotMatch(sentences, /don't sort donors|%/i);

  // The two groups are fetched as separate top-fives, so a percentage
  // between them would be a percentage of a base we chose. Dollars only.
  assert.match(sentences, /\$10,000 came from committees/);
  assert.match(sentences, /\$2,000 came from individual people/);
});

test("D06: an unknown state has no geography sentence or invented zero", async () => {
  const { concentrationOf, concentrationSentences } = await import(
    "../lib/funding/concentration.ts"
  );
  const concentration = concentrationOf([row({ amount: 500, state: null })], null);
  assert.ok(concentration);
  assert.equal(concentration.hasGeography, false);
  const sentences = concentrationSentences(concentration, null).join(" ");
  assert.doesNotMatch(sentences, /working on getting|Filed from inside|Filed from outside/);
  assert.doesNotMatch(sentences, /\b0% of/);
});

test("D06: nothing to compute over renders nothing, not a row of zeros", async () => {
  const { concentrationOf } = await import("../lib/funding/concentration.ts");
  assert.equal(concentrationOf([], "AZ"), null);
  assert.equal(concentrationOf([row({ amount: 0, state: "AZ" })], "AZ"), null);
});

test("D06: planted contributor-level data reaches no sold aggregate", async () => {
  // Contributor-level data must never enter the aggregation path that produces anything sold (52 U.S.C. 30111(a)(4)).
  const planted = {
    targetType: "CONTRIBUTOR_REACTION" as const,
    targetId: "S6AZ00253",
    reaction: "HATE" as const,
    scaleVersion: 3 as const,
    ocdIds: ["ocd-division/country:us/state:az"],
    verificationTier: "ANONYMOUS" as const,
    runClass: "ORGANIC" as const,
    // Everything a contributor row carries, handed straight to the
    // aggregator the way a careless read path would hand it over.
    contributorName: "PLANTED-CONTRIBUTOR-SENTINEL-g19, JANE",
    amount: 3300,
    city: "BETHESDA",
    state: "MD",
    employer: "PLANTED-EMPLOYER-SENTINEL-g19",
    freeText: "PLANTED-VERBATIM-SENTINEL-d06",
  };

  const tallies = aggregateReactions([
    planted as unknown as Parameters<typeof aggregateReactions>[0][number],
  ]);
  const serialized = JSON.stringify(tallies);

  for (const sentinel of [
    "PLANTED-CONTRIBUTOR-SENTINEL-g19",
    "PLANTED-EMPLOYER-SENTINEL-g19",
    "PLANTED-VERBATIM-SENTINEL-d06",
    "BETHESDA",
    "3300",
  ]) {
    assert.doesNotMatch(
      serialized,
      new RegExp(sentinel),
      `a sold aggregate carried ${sentinel}`,
    );
  }

  // The target ID survives — that is the point of a tally, and it is an
  // FEC CANDIDATE id (public, and the campaign's own), never a contributor.
  assert.match(serialized, /S6AZ00253/);

  // And the exclusion is structural, not a filter: the concentration
  // module, which is the only new reader-facing consumer of contributor
  // rows, is never imported by the aggregation layer.
  const aggregateSource = readFileSync(
    join(process.cwd(), "lib/signal/aggregate.ts"),
    "utf8",
  );
  assert.doesNotMatch(aggregateSource, /funding\/concentration/);
  assert.doesNotMatch(aggregateSource, /concentrationOf/);
});

/* Concentration by the FEC's own entity typing, never an industry taxonomy. */

test("D06 g20: bands come from the FEC's filed typing, and cross no sampled base", async () => {
  const { typeConcentrationOf, typeConcentrationSentences } = await import(
    "../lib/funding/type-concentration.ts"
  );
  const concentration = typeConcentrationOf([
    // A trade association's PAC: committee type N, org type T.
    row({
      kind: "COMMITTEE_OR_ORGANIZATION",
      contributorName: "SOME TRADE ASSOCIATION PAC",
      amount: 10_000,
      committeeType: "N",
      organizationType: "T",
    }),
    // A labor PAC: committee type Q, org type L.
    row({
      kind: "COMMITTEE_OR_ORGANIZATION",
      contributorName: "SOME UNION PAC",
      amount: 4_000,
      committeeType: "Q",
      organizationType: "L",
    }),
    // An individual — must never appear in a band.
    row({ kind: "INDIVIDUAL", contributorName: "SOMEBODY, A", amount: 99_000 }),
  ]);
  assert.ok(concentration);

  // Committee side only: the two lists are separately sampled top-fives.
  assert.equal(concentration.totalAmount, 14_000);
  assert.equal(concentration.contributionCount, 2);
  assert.equal(concentration.bandCount, 2);
  assert.equal(concentration.bands[0].id, "pac-trade-association");
  assert.equal(concentration.bands[0].amount, 10_000);
  assert.equal(concentration.bands[1].id, "pac-labor");

  const sentences = typeConcentrationSentences(concentration).join(" ");
  assert.match(sentences, /\$10,000 from a PAC connected to a trade association/);
  assert.match(sentences, /\$4,000 from a PAC connected to a labor union/);
  assert.doesNotMatch(sentences, /99,000/);
  // Never an industry, and it says so rather than leaving the reader to
  // assume these categories are one.
  assert.doesNotMatch(sentences, /don't sort donors|%/i);
});

test("D06 g20: a filing with no typing is a named gap, not the generic organization", async () => {
  const { typeConcentrationOf, UNFILED_BAND_ID } = await import(
    "../lib/funding/type-concentration.ts"
  );
  const concentration = typeConcentrationOf([
    row({
      kind: "COMMITTEE_OR_ORGANIZATION",
      contributorName: "UNTYPED COMMITTEE",
      amount: 2_500,
      committeeType: null,
      organizationType: null,
      designation: null,
    }),
  ]);
  assert.ok(concentration);
  // An absent typing is the filing's gap, never "an organization".
  assert.equal(concentration.bands[0].id, UNFILED_BAND_ID);
  assert.match(concentration.bands[0].label, /filing doesn't state its type/i);
});

test("D06 g20: no committee money renders nothing, not an empty category list", async () => {
  const { typeConcentrationOf } = await import(
    "../lib/funding/type-concentration.ts"
  );
  assert.equal(typeConcentrationOf([]), null);
  assert.equal(
    typeConcentrationOf([row({ kind: "INDIVIDUAL", amount: 500 })]),
    null,
    "an all-individual list has no committee base — a zero row would read as a claim",
  );
});

test("D06 g20: every band label comes from the one author-reviewable table", async () => {
  const { typeConcentrationOf, UNFILED_BAND_ID } = await import(
    "../lib/funding/type-concentration.ts"
  );
  const { COMMITTEE_TYPE_LABELS } = await import(
    "../lib/funding/committee-types.ts"
  );
  const { NON_TABLE_BAND_IDS } = await import("../lib/funding/labels.ts");
  const allowed = new Set<string>(COMMITTEE_TYPE_LABELS.map((l) => l.id));
  for (const id of NON_TABLE_BAND_IDS) allowed.add(id);
  assert.ok(allowed.has(UNFILED_BAND_ID));

  // Every committee type and organization type the FEC publishes, so a new
  // band cannot appear without appearing in the table first.
  const codes = "HSPNQOUVWXYZDEIC".split("");
  const orgTypes = [null, "C", "L", "M", "T", "V", "W"];
  const designations = [null, "A", "B", "D", "J", "P", "U"];
  const rows = [];
  for (const committeeType of codes) {
    for (const organizationType of orgTypes) {
      for (const designation of designations) {
        rows.push(
          row({
            kind: "COMMITTEE_OR_ORGANIZATION",
            amount: 100,
            committeeType,
            organizationType,
            designation,
          }),
        );
      }
    }
  }
  const concentration = typeConcentrationOf(rows);
  assert.ok(concentration);
  for (const band of concentration.bands) {
    assert.ok(
      allowed.has(band.id),
      `band ${band.id} is not in COMMITTEE_TYPE_LABELS — a label reached a reader from outside the table`,
    );
  }
  // And the parts equal the whole: no row silently dropped out of a band.
  const summed = concentration.bands.reduce((s, b) => s + b.amount, 0);
  assert.equal(summed, concentration.totalAmount);
  const counted = concentration.bands.reduce((s, b) => s + b.count, 0);
  assert.equal(counted, concentration.contributionCount);
});

test("D06 g20: the type bands reach no sold aggregate either", async () => {
  const aggregateSource = readFileSync(
    join(process.cwd(), "lib/signal/aggregate.ts"),
    "utf8",
  );
  assert.doesNotMatch(aggregateSource, /type-concentration/);
  assert.doesNotMatch(aggregateSource, /typeConcentrationOf/);
});

test("D06 g20: the candidate's own money is never typed as an untyped committee", async () => {
  const { typeConcentrationOf, typeConcentrationSentences, OWN_MONEY_BAND_ID } =
    await import("../lib/funding/type-concentration.ts");

  // A candidate's loan files as entity CAN on line 13A, on the FEC's non-individual side; it is their own money.
  const concentration = typeConcentrationOf([
    row({
      kind: "COMMITTEE_OR_ORGANIZATION",
      contributorName: "WILLIAMS, LILY TANG",
      amount: 80_000,
      entityType: "CAN",
      lineNumber: "13A",
    }),
    row({
      kind: "COMMITTEE_OR_ORGANIZATION",
      contributorName: "SOME PAC",
      amount: 5_000,
      committeeType: "N",
      organizationType: "C",
    }),
  ]);
  assert.ok(concentration);
  const own = concentration.bands.find((b) => b.id === OWN_MONEY_BAND_ID);
  assert.ok(own, "the candidate's own money has no band of its own");
  assert.equal(own.amount, 80_000);
  assert.match(own.label, /the candidate's own money/i);

  const sentences = typeConcentrationSentences(concentration).join(" ");
  assert.doesNotMatch(sentences, /filing doesn't state its type/i);
  // And it reads as English: the own-money band is the money, not a source.
  assert.match(sentences, /\$80,000 was the candidate's own money/);
});

test("D06 g20: the FEC's entity typing answers where committee typing is absent", async () => {
  const { typeConcentrationOf } = await import(
    "../lib/funding/type-concentration.ts"
  );

  // ORG, COM and CCM rows carry no committee_type; the FEC's entity typing answers for them.
  const concentration = typeConcentrationOf([
    row({
      kind: "COMMITTEE_OR_ORGANIZATION",
      contributorName: "ACTBLUE",
      amount: 7_000,
      entityType: "ORG",
      lineNumber: "11AI",
    }),
    row({
      kind: "COMMITTEE_OR_ORGANIZATION",
      contributorName: "CAMDEN COUNTY REPUBLICAN COMMITTEE",
      amount: 500,
      entityType: "COM",
      lineNumber: "11C",
    }),
    row({
      kind: "COMMITTEE_OR_ORGANIZATION",
      contributorName: "VOTE VDO",
      amount: 825,
      entityType: "CCM",
      lineNumber: "11AI",
    }),
  ]);
  assert.ok(concentration);
  const ids = concentration.bands.map((b) => b.id).sort();
  assert.deepEqual(ids, ["entity-ccm", "entity-com", "entity-org"]);
  for (const band of concentration.bands) {
    assert.doesNotMatch(
      band.label,
      /doesn't state its type/i,
      `${band.id} was rendered as an unfiled gap despite carrying an FEC entity type`,
    );
  }
});

test("D06 g20: the band ladder and the row suffix are one derivation", async () => {
  const { contributorBand, plainContributorLabel } = await import(
    "../lib/funding/labels.ts"
  );
  // The suffix is the ladder's own label, so the two cannot come apart.
  const cases = [
    { kind: "COMMITTEE_OR_ORGANIZATION", entityType: "CAN", lineNumber: "13A" },
    { kind: "COMMITTEE_OR_ORGANIZATION", entityType: "ORG", lineNumber: "11AI" },
    { kind: "COMMITTEE_OR_ORGANIZATION", entityType: "COM", lineNumber: "11C" },
    {
      kind: "COMMITTEE_OR_ORGANIZATION",
      entityType: "PAC",
      lineNumber: "11C",
      committeeType: "N",
      organizationType: "L",
    },
    { kind: "INDIVIDUAL", entityType: "IND", lineNumber: "11AI" },
  ] as const;
  for (const c of cases) {
    const band = contributorBand(row({ ...c }));
    const suffix = plainContributorLabel(row({ ...c }));
    if (band === null) {
      assert.equal(suffix, null, `${c.entityType}: band says none, suffix says ${suffix}`);
    } else {
      assert.equal(
        suffix,
        band.label,
        `${c.entityType}: the suffix and the band disagree about the same row`,
      );
    }
  }
});
