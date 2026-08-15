import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { BODY_ROSTERS } from "../lib/registry/body-rosters.ts";
import { STATEWIDE_EXECUTIVES } from "../lib/officials/statewide-executives.ts";
import { allOfficialRows } from "../lib/officials/tier-grouping.ts";
import { coverageAt } from "../lib/registry/server.ts";

/**
 * M61 (2026-08-15) — party renders wherever it is held, and is never held
 * without a record.
 *
 * The author's report: Kelly Ayotte read "Republican" on the ballot and
 * nothing at all on the who-governs card. Two surfaces, one person, two
 * different answers — and the standing rule is that party renders in its
 * colour everywhere it appears. The cause was not the render: every
 * officials surface goes through one `Holder` component that draws
 * `partyLabel`. The three governors' rows carried `partyLabel: null` on
 * purpose, because a governor's own office page does not print a party.
 *
 * The fix is to hold the fact, from the record that does state it — the
 * election authority's certified filing, the same class of record the
 * ballot surface already cites, and for two of the three governors
 * literally the same document. So these guards hold three things:
 *
 *   1. a party never ships without the record it was read from;
 *   2. the two surfaces cannot drift apart again — where a ballot filing
 *      and an officeholder row describe the same office, they must agree,
 *      and cite the same filing;
 *   3. a null party is a STATED fact, not an absence: every roster says
 *      whether its seats are partisan, so "nothing rendered" can be read.
 */

const ROOT = join(import.meta.dirname, "..");

const ZIPS: Record<string, [number, number]> = {
  "85701": [32.21696, -110.971],
  "85641": [32.04903, -110.62291],
  "07866": [40.95499, -74.48801],
  "03255": [43.31403, -72.02455],
};

test("M61: every governor carries a party, and the record it came from", () => {
  assert.equal(STATEWIDE_EXECUTIVES.length, 3, "the denominator: three governors");

  for (const exec of STATEWIDE_EXECUTIVES) {
    const { partyLabel } = exec.holder;
    assert.ok(
      partyLabel,
      `${exec.holder.name}: no party — the who-governs card would render nothing beside a ballot that says otherwise`,
    );
    assert.ok(
      exec.partySourceUrl && /^https:\/\//.test(exec.partySourceUrl),
      `${exec.holder.name}: party "${partyLabel}" with no source record`,
    );
    assert.ok(
      exec.partySourceOrg && exec.partySourceOrg.length > 8,
      `${exec.holder.name}: party source has no publishing organisation`,
    );
    // The office's own page is not a party source — it does not state one.
    // Citing it would be dressing an inference as a record.
    assert.notEqual(
      exec.partySourceUrl,
      exec.sourceUrl,
      `${exec.holder.name}: cites the office page for party, which does not publish it`,
    );
  }
});

/**
 * The two-surfaces invariant. This is the defect stated as a test: the
 * ballot and the who-governs card may not disagree about a person's party,
 * and where both hold one they must be reading the same filing.
 */
test("M61: the ballot and the officeholder row agree about party", () => {
  const files = ["nh-merrimack-2026.json", "az-pima-2026.json", "nj-morris-2026.json"];
  const candidacies: Array<{
    familyName: string;
    givenName: string;
    partyLabel: string | null;
    contestId: string;
    provenance: { sourceUrl: string };
  }> = [];
  for (const f of files) {
    const parsed = JSON.parse(
      readFileSync(join(ROOT, "data", "ballot", f), "utf8"),
    ) as { candidacies?: typeof candidacies };
    candidacies.push(...(parsed.candidacies ?? []));
  }
  assert.ok(candidacies.length > 20, `only ${candidacies.length} candidacies loaded`);

  let compared = 0;
  for (const exec of STATEWIDE_EXECUTIVES) {
    const family = exec.holder.name.split(" ").pop()!;
    const match = candidacies.find(
      (c) => c.familyName === family && /governor/i.test(c.contestId),
    );
    if (!match) continue; // no governor's race on this state's 2026 ballot
    compared++;
    assert.equal(
      exec.holder.partyLabel,
      match.partyLabel,
      `${exec.holder.name}: card says "${exec.holder.partyLabel}", ballot says "${match.partyLabel}"`,
    );
    // Same person, same fact, same filing — not two independent typings
    // that happen to agree today.
    assert.equal(
      exec.partySourceUrl,
      match.provenance.sourceUrl,
      `${exec.holder.name}: the two surfaces cite different records for the same fact`,
    );
  }
  assert.ok(
    compared >= 2,
    `only ${compared} governors could be cross-checked against a ballot filing — the join broke`,
  );
});

test("M61: every roster states whether its seats carry a party", () => {
  assert.ok(BODY_ROSTERS.length >= 12, `only ${BODY_ROSTERS.length} rosters`);
  for (const roster of BODY_ROSTERS) {
    assert.ok(
      ["PARTISAN", "NONPARTISAN", "UNDETERMINED"].includes(roster.partisanship),
      `${roster.bodyId}: no partisanship recorded`,
    );
    // A settled answer has to cite what settled it; UNDETERMINED is the
    // honest open state and cites nothing by definition.
    if (roster.partisanship !== "UNDETERMINED") {
      assert.ok(
        roster.partisanshipSourceUrl,
        `${roster.bodyId}: claims ${roster.partisanship} with no record`,
      );
    }
    // And a member may not carry a party on a body we have called
    // nonpartisan, nor carry one without its own record.
    for (const member of roster.members) {
      if (member.partyLabel) {
        assert.notEqual(
          roster.partisanship,
          "NONPARTISAN",
          `${member.name}: party on a body recorded as nonpartisan`,
        );
        assert.ok(
          member.partySourceUrl,
          `${member.name}: party "${member.partyLabel}" with no source record`,
        );
      }
    }
  }
});

/**
 * The render rule, held against real committed data at every demo zip: a
 * holder who has a party must arrive at the surface carrying it. The
 * surfaces all draw from `allOfficialRows`, so this is the last point where
 * a party could be dropped before the component sees it.
 */
for (const [zip, [lat, lng]] of Object.entries(ZIPS)) {
  test(`M61: no officeholder loses a held party on the way to the surface at ${zip}`, async () => {
    const coverage = await coverageAt(lat, lng, 1);
    const rows = allOfficialRows(coverage);
    assert.ok(rows.length > 0, `${zip}: no rows at all`);

    // The governor is on every one of these surfaces, and is the row the
    // author caught rendering bare.
    const governor = rows.find((r) => r.holder.officeTitle === "Governor");
    assert.ok(governor, `${zip}: no governor on the officials surface`);
    assert.ok(
      governor.holder.partyLabel,
      `${zip}: ${governor.holder.name} reaches the surface with no party — the reported defect`,
    );

    // Nobody arrives with an empty-string party, which would render as a
    // stray separator and read as a data error.
    for (const row of rows) {
      assert.notEqual(
        row.holder.partyLabel,
        "",
        `${zip}: ${row.holder.name} carries an empty party string`,
      );
    }

    // Stated with its denominator so a future drop is visible as a number.
    const held = rows.filter((r) => r.holder.partyLabel).length;
    assert.ok(
      held >= 4,
      `${zip}: only ${held} of ${rows.length} rows carry a party — the join has regressed`,
    );
  });
}

/* ------------------------------------------------------- M62 (2026-08-15) --- */

/**
 * The certified-results rung. M61 established that a roster must SAY whether
 * its seats carry a party; M62 went and read the party off the record that
 * states it, for every curated jurisdiction. These guards hold the shape of
 * that answer so it cannot decay into the thing it replaced — a party that
 * looks sourced because a URL is present.
 */

/** Anything a party may NOT be read from, however convenient. */
const FORBIDDEN_PARTY_SOURCES = [
  "democrats.org",
  "gop.com",
  "democraticparty",
  "republicanparty",
  "ballotpedia.org",
  "wikipedia.org",
  "vote411.org",
  "facebook.com",
  "twitter.com",
  "x.com",
];

test("M62: no curated roster is left UNDETERMINED, and each cites what settled it", () => {
  const undetermined = BODY_ROSTERS.filter((r) => r.partisanship === "UNDETERMINED");
  assert.deepEqual(
    undetermined.map((r) => r.bodyId),
    [],
    `${undetermined.length} roster(s) still UNDETERMINED — M62 walked all twelve`,
  );

  // Stated with its denominator, so a roster added without a partisanship
  // finding shows up as a number rather than slipping in as a default.
  const settled = BODY_ROSTERS.filter((r) => r.partisanshipSourceUrl).length;
  assert.equal(
    settled,
    BODY_ROSTERS.length,
    `only ${settled} of ${BODY_ROSTERS.length} rosters cite a partisanship record`,
  );
});

test("M62: every party on a curated local is dated and read from an election authority", () => {
  let held = 0;
  let members = 0;

  for (const roster of BODY_ROSTERS) {
    for (const member of roster.members) {
      members++;
      if (!member.partyLabel) continue;
      held++;

      assert.ok(
        member.partySourceUrl?.startsWith("https://"),
        `${member.name}: party with no https record`,
      );
      // A record without a read date cannot be aged, and an undated claim is
      // how a stale party survives an election.
      assert.ok(
        /^\d{4}-\d{2}-\d{2}$/.test(member.partyCollectedAt ?? ""),
        `${member.name}: party with no collectedAt`,
      );
      assert.ok(
        (member.partySourceOrg ?? "").length > 10,
        `${member.name}: party with no publishing body named`,
      );

      const url = (member.partySourceUrl ?? "").toLowerCase();
      for (const bad of FORBIDDEN_PARTY_SOURCES) {
        assert.ok(
          !url.includes(bad),
          `${member.name}: party read from ${bad} — certified results or silence`,
        );
      }
    }
  }

  // The denominator, printed on every run: 30 of 71 on 2026-08-15, the rest
  // split between nonpartisan seats and two appointed vacancies. A drop here
  // means a party stopped shipping; a jump means one arrived unreviewed.
  console.log(`\n  party  ${held} of ${members} curated local member(s) carry a party\n`);
  assert.ok(
    held >= 30,
    `only ${held} of ${members} curated local members carry a party — M62 landed 30`,
  );
});

test("M62: an appointed member on a partisan body renders no party", () => {
  // Both were found by the hunt, not reported: Pima's District 5 was won in
  // 2024 by someone else and filled by Board appointment, and Rockaway's
  // at-large president holds a seat certified to a different name. Neither
  // has a certified result naming a party, so neither may carry one — this
  // is the exact place a plausible guess would be most tempting.
  const appointed = ["roster:pima#5", "roster:rockaway#1"];
  for (const id of appointed) {
    const member = BODY_ROSTERS.flatMap((r) => r.members).find((m) => m.id === id);
    assert.ok(member, `${id} is gone from the rosters — update this guard with it`);
    assert.ok(
      !member.partyLabel,
      `${member.name}: carries a party with no certified result behind it`,
    );
  }
});
