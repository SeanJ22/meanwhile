import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  APRIL_2024_SENATE_NOTE,
  KEY_VOTES,
  KEY_VOTES_CRITERIA,
  KEY_VOTES_LAWS,
  KEY_VOTES_PEOPLE,
} from "../lib/votes/key-votes.ts";
import {
  getKeyVotesSnapshot,
  keyVoteRowsFor,
} from "../lib/votes/key-votes-rows.ts";

/**
 * B15 — the key votes tracker.
 *
 * The doctrine these guards hold, from the tracker row and the author's
 * order: votes only; published criteria; never aggregated into a score;
 * "no vote exists" and "the other chamber hasn't acted" are first-class
 * honest answers; read-dates on every line; and — the structural one — an
 * entry is a QUESTION that each chamber answered with its OWN roll calls.
 */

const ROOT = process.cwd();

test("the list is the author's: 20 law rows (April 2024 as four siblings) and 16 nominations", () => {
  assert.equal(KEY_VOTES_LAWS.length, 20);
  assert.equal(KEY_VOTES_PEOPLE.length, 16);
  assert.equal(KEY_VOTES.length, 36);
  // The April 2024 package is four siblings because the House voted four
  // separate bills and a member could vote differently on each.
  const april = KEY_VOTES_LAWS.filter((e) => e.siblingGroup === "april-2024");
  assert.equal(april.length, 4);
  // Exactly one entry is marked as not yet law.
  const pending = KEY_VOTES.filter((e) => e.pending);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, "stock-trading-ban");
  // Ids are unique — they key the render and the snapshot join.
  assert.equal(new Set(KEY_VOTES.map((e) => e.id)).size, KEY_VOTES.length);
});

test("the criteria sentence is verbatim and renders ON the surface", () => {
  assert.equal(
    KEY_VOTES_CRITERIA,
    "Major legislation that became law (plus one pending measure, marked), and consequential Senate confirmations, since 2020 — chosen before looking at how anyone voted.",
  );
  const surface = readFileSync(
    join(ROOT, "components", "officials", "key-votes-section.tsx"),
    "utf8",
  );
  assert.ok(
    surface.includes("{KEY_VOTES_CRITERIA}"),
    "the criteria must render on the surface, not merely exist",
  );
});

test("no entry carries a scoring key, and nothing aggregates them", () => {
  // CLAUDE.md's neutrality rule is stricter than the no-composite-score
  // rule, and this file is where it would be easiest to break.
  const raw = JSON.stringify(KEY_VOTES);
  assert.ok(
    !/"(score|rank|rating|match|fit|grade|alignment|recommendation)"/i.test(raw),
    "a key vote entry grew a scoring key",
  );
  for (const file of ["key-votes.ts", "key-votes-rows.ts"]) {
    const source = readFileSync(join(ROOT, "lib", "votes", file), "utf8");
    assert.ok(
      !/\.(reduce|filter)\([^)]*position\s*===\s*["']YES/.test(source),
      `lib/votes/${file} counts YES votes — that is a score`,
    );
  }
  const surface = readFileSync(
    join(ROOT, "components", "officials", "key-votes-section.tsx"),
    "utf8",
  );
  for (const banned of ["% agree", "score", "grade", "alignment", "rating"]) {
    assert.ok(
      !new RegExp(`>[^<]*${banned}`, "i").test(surface),
      `the key votes surface renders "${banned}"`,
    );
  }
});

test("every explainer is level register, one sentence's worth, and never the title again", () => {
  for (const entry of KEY_VOTES) {
    assert.ok(entry.explainer.length > 40, `${entry.id}: explainer too thin`);
    assert.ok(entry.explainerSource.length > 0, `${entry.id}: no source class`);
    assert.match(entry.explainerReadAt, /^\d{4}-\d{2}-\d{2}$/);
    // The title must not be doing the explaining. A bundle that names only
    // its branding tells the reader nothing.
    const titleWords = entry.title
      .toLowerCase()
      .replace(/[^a-z ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 4);
    const explainer = entry.explainer.toLowerCase();
    const echoed = titleWords.filter((w) => explainer.includes(w));
    assert.ok(
      echoed.length < titleWords.length || titleWords.length === 0,
      `${entry.id}: the explainer is the title again`,
    );
    // Level register on a claim surface: never cute about real money or
    // real people.
    // Word boundaries, not substrings: "instead" contains "tea", and a
    // guard that fails on it is a guard nobody will keep.
    for (const banned of ["tea", "bet", "hang tight", "lol", "wild", "vibes"]) {
      assert.ok(
        !new RegExp(`\\b${banned}\\b`).test(explainer),
        `${entry.id}: playful register on a claim surface ("${banned}")`,
      );
    }
  }
});

test("the chamber rule: a House card never shows a Senate-only entry as a vote", () => {
  const seen = (chamber: "house" | "senate") =>
    keyVoteRowsFor(chamber, () => ({ position: "YES", held: true, breakdown: null }));

  const houseRows = seen("house");
  const senateRows = seen("senate");
  assert.equal(houseRows.length, senateRows.length, "both chambers see every question");

  // Nominations: the Senate has a roll call, the House has a stated note
  // and no vote at all. A blank here would read as "he didn't show up".
  const houseNomination = houseRows.find((r) => r.entry.id === "barrett-scotus")!;
  assert.equal(houseNomination.refs.length, 0);
  assert.equal(houseNomination.note, "The House doesn't vote on nominations.");
  const senateNomination = senateRows.find((r) => r.entry.id === "barrett-scotus")!;
  assert.ok(senateNomination.refs.length > 0, "the Senate roll call is missing");
  assert.equal(senateNomination.note, null);

  // The pending measure: the Senate hasn't acted, and says so.
  const senatePending = senateRows.find((r) => r.entry.id === "stock-trading-ban")!;
  assert.equal(senatePending.refs.length, 0);
  assert.match(senatePending.note ?? "", /hasn't voted on this/);
});

test("all sixteen nominations are verified against the Senate's own record, name AND tally", () => {
  const snapshot = getKeyVotesSnapshot();
  const people = snapshot.entries.filter((e) => e.group === "PEOPLE");
  assert.equal(people.length, 16);
  for (const entry of people) {
    assert.equal(entry.senate.length, 1, `${entry.id}: not exactly one Senate roll call`);
    const ref = entry.senate[0];
    assert.ok(ref.rollNumber > 0, `${entry.id}: roll number never resolved`);
    assert.ok(
      [116, 117, 118, 119].includes(ref.congress),
      `${entry.id}: congress ${ref.congress} is outside the list's window`,
    );
    assert.match(ref.tally ?? "", /^\d+-\d+$/, `${entry.id}: no tally`);
    // A URL cited must have been fetched and verified — and it must be the
    // chamber's own, never an aggregator's.
    assert.match(
      ref.url ?? "",
      /^https:\/\/www\.senate\.gov\/legislative\/LIS\/roll_call_votes\//,
      `${entry.id}: roll call url is not the Senate's own`,
    );
    assert.match(ref.verifiedAt ?? "", /^\d{4}-\d{2}-\d{2}$/, `${entry.id}: no read date`);
    assert.match(ref.question ?? "", /nomination/i, `${entry.id}: not a nomination vote`);
  }
  // Distinct nominations resolve to distinct roll calls — the D40 family.
  const keys = people.map((e) => `${e.senate[0].congress}-${e.senate[0].session}#${e.senate[0].rollNumber}`);
  assert.equal(new Set(keys).size, keys.length, "two nominations share one roll call");
});

test("an unresolved roll call renders OUR gap, never the legislature's", () => {
  const surface = readFileSync(
    join(ROOT, "components", "officials", "key-votes-section.tsx"),
    "utf8",
  );
  // Three different kinds of "no vote here", and they must say three
  // different things. Collapsing the third into the first two would turn a
  // hole in our research into a claim about a legislature.
  assert.ok(surface.includes("We haven't recorded this chamber's vote on this yet"));
  assert.ok(!/gap in our (data|research)/i.test(surface), "F01 6.1: the gap phrasing is struck product-wide");
  assert.ok(surface.includes("{row.note ??"), "the stated note must win over the generic gap line");
  assert.ok(surface.includes("Did not vote"));

  // And the laws that are not resolved yet carry no roll call at all —
  // rather than a plausible number.
  const snapshot = getKeyVotesSnapshot();
  for (const entry of snapshot.entries) {
    for (const ref of [...entry.house, ...entry.senate]) {
      assert.ok(
        ref.rollNumber > 0 && ref.url !== null && ref.verifiedAt !== null,
        `${entry.id}: a roll call is present but unverified — no source, no claim`,
      );
    }
  }
  // Every miss is recorded with its reason, so the remainder is named.
  assert.ok(Array.isArray(snapshot.misses));
  for (const miss of snapshot.misses) {
    assert.ok(miss.reason.length > 20, `${miss.id}: a miss without a reason`);
  }
});

test("the April 2024 group: four rows on a House card, one on a senator's, with the line", () => {
  assert.equal(
    APRIL_2024_SENATE_NOTE,
    "The Senate voted on the four bills as a single package.",
  );
  const house = keyVoteRowsFor("house", () => ({ position: "YES", held: true, breakdown: null }));
  const april = house.filter((r) => r.entry.siblingGroup === "april-2024");
  assert.equal(april.length, 4, "a House member votes on four separate bills");
  // Each is its own question with its own explainer — a member could vote
  // differently on each, and four identical rows would hide that.
  assert.equal(new Set(april.map((r) => r.entry.explainer)).size, 4);
  const surface = readFileSync(
    join(ROOT, "components", "officials", "key-votes-section.tsx"),
    "utf8",
  );
  assert.ok(
    surface.includes('chamber === "senate" && row.entry.siblingGroup === "april-2024"'),
    "the single-package line must render on a senator's card only",
  );
});

/**
 * B17 — the law rows get their roll calls (2026-08-15).
 *
 * B15 left 0 of 20 laws with a verified roll call, for a structural reason:
 * the Senate publishes every vote under the bill's official long title, so a
 * popular-name search over the roll-call lists found nothing. The route that
 * closes it is congress.gov's own record — public laws, then the titles
 * endpoint where the popular names live, then that bill's recorded votes,
 * each carrying the chamber's own URL.
 */
test("B17: the law rows carry roll calls from the chambers' own records", () => {
  const snapshot = getKeyVotesSnapshot();
  const laws = snapshot.entries.filter((e) => e.group === "LAWS");
  assert.equal(laws.length, 20);

  // 19 of 20 since 2026-08-18 (g19), up from 18: the pending stock-trading
  // measure's HOUSE vote was resolved through the House's own roll-call
  // index. That index carries bill numbers and no titles, so searching its
  // text for the subject finds nothing — a fact about the index, not about
  // the House, and the false-miss shape this codebase keeps naming. The
  // measure still has no Senate vote, which is what its card says.
  //
  // The one that remains is the shutdown entry, and it is a real refusal
  // rather than a gap in effort: the 119th carries five appropriations laws
  // and the entry's own title names two things at once — reopening the
  // government and funding the rest of the year. Which law the author means
  // is the author's to say, and the list is closed.
  //
  // Exact, so a regression cannot hide behind "at least".
  const resolved = laws.filter((e) => e.house.length > 0 || e.senate.length > 0);
  assert.equal(resolved.length, 19, resolved.map((e) => e.id).join(", "));
  const unresolved = laws.filter((e) => e.house.length === 0 && e.senate.length === 0);
  assert.deepEqual(unresolved.map((e) => e.id).sort(), ["funding-fight"]);
  for (const entry of unresolved) {
    const miss = snapshot.misses.find((m) => m.id === entry.id);
    assert.ok(miss, `${entry.id}: unresolved with no recorded reason`);
    assert.ok(miss.reason.length > 40, `${entry.id}: the reason must actually explain`);
  }

  for (const entry of resolved) {
    for (const ref of entry.house) {
      assert.ok(ref.rollNumber > 0, `${entry.id} house: no roll number`);
      assert.match(ref.tally ?? "", /^\d+-\d+$/, `${entry.id} house: no tally`);
      assert.match(ref.verifiedAt ?? "", /^\d{4}-\d{2}-\d{2}$/, `${entry.id}: no read date`);
      // The chamber's OWN record, never an aggregator's.
      assert.match(
        ref.url ?? "",
        /^https:\/\/clerk\.house\.gov\//,
        `${entry.id} house: the roll-call url is not the Clerk's own`,
      );
      assertPassageQuestion(entry.id, "house", ref.question);
    }
    for (const ref of entry.senate) {
      assert.ok(ref.rollNumber > 0, `${entry.id} senate: no roll number`);
      assert.match(ref.tally ?? "", /^\d+-\d+$/, `${entry.id} senate: no tally`);
      assert.match(ref.verifiedAt ?? "", /^\d{4}-\d{2}-\d{2}$/, `${entry.id}: no read date`);
      assert.match(
        ref.url ?? "",
        /^https:\/\/www\.senate\.gov\//,
        `${entry.id} senate: the roll-call url is not the Senate's own`,
      );
      assertPassageQuestion(entry.id, "senate", ref.question);
    }
  }

  // The BSCA catch, pinned. The House's vote on the gun law is its June
  // concurrence (234-193), NOT the May passage of its own unrelated version
  // of the same bill number. Reading the entry's "final passage" as the
  // literal words "on passage" picked the wrong one during this build, and
  // this is the assertion that would catch it again.
  const bsca = laws.find((e) => e.id === "bsca");
  assert.equal(bsca?.house[0]?.tally, "234-193");
  assert.match(bsca?.house[0]?.question ?? "", /agree to the Senate amendment/i);

  // Distinct entries resolve to distinct roll calls — the D40 family, per
  // chamber. The four April siblings SHARE the Senate's package vote by
  // construction, which is the one legitimate collision.
  const senateKeys = laws
    .filter((e) => !e.siblingGroup && e.senate.length > 0)
    .map((e) => `${e.senate[0].congress}-${e.senate[0].session}#${e.senate[0].rollNumber}`);
  assert.equal(new Set(senateKeys).size, senateKeys.length, "two laws share a Senate roll call");
  const houseKeys = laws
    .filter((e) => e.house.length > 0)
    .map((e) => `${e.house[0].congress}-${e.house[0].session}#${e.house[0].rollNumber}`);
  assert.equal(new Set(houseKeys).size, houseKeys.length, "two laws share a House roll call");

  // The April siblings: four DIFFERENT House votes on four bills the House
  // actually voted on, and ONE shared Senate vote on the package.
  const april = laws.filter((e) => e.siblingGroup);
  assert.equal(april.length, 4);
  assert.equal(new Set(april.map((e) => e.house[0]?.rollNumber)).size, 4);
  assert.equal(new Set(april.map((e) => e.senate[0]?.rollNumber)).size, 1);
});

/** Passage or concurrence only — a cloture vote is a different question. */
function assertPassageQuestion(id: string, chamber: string, question: string | null) {
  assert.match(
    question ?? "",
    // `agreed?` and bare `concur` deliberately: the chambers write "Senate
    // AGREED to the House amendment" and "Senate CONCURRED in", and a guard
    // that only knew the infinitives would call a real concurrence vote a
    // procedural one.
    /passed|on passage|concur|agreed? to the|suspend the rules/i,
    `${id} ${chamber}: not a passage-type question`,
  );
  assert.ok(
    !/cloture|motion to proceed|motion to table|recommit/i.test(question ?? ""),
    `${id} ${chamber}: a procedural vote is standing in for the law`,
  );
}

/*
 * ITEM 6 (2026-08-16, the author): "When it mattered" appeared to render
 * NOTHING when selected.
 *
 * DIAGNOSED before anything was changed, and the data was never the problem:
 * production's /api/votes serves 36 key votes for a senator — 20 laws, 16
 * people — and all of them reach this component. What the reader saw was the
 * criteria sentence and two CLOSED bars, because both sub-groups defaulted
 * shut at the same size and colour as the pane's own header.
 *
 * Two rules now, and both are guarded here rather than at a screenshot:
 * the pane opens with its content, and its sub-groups read as sub-groups.
 */

test("the key-votes pane opens with its content, not with two closed bars", () => {
  const surface = readFileSync(
    join(ROOT, "components", "officials", "key-votes-section.tsx"),
    "utf8",
  );
  // Every CardSection this file renders opens with the pane. A view the
  // reader just selected must not need two more taps to show anything.
  const sections = surface.match(/<CardSection[\s\S]*?>/g) ?? [];
  assert.ok(sections.length >= 3, "the pane should render its sub-groups");
  for (const section of sections) {
    assert.ok(
      /defaultOpen/.test(section),
      `a key-votes sub-group ships closed:\n${section}`,
    );
    assert.ok(
      /level="sub"/.test(section),
      `a key-votes sub-group is not marked as one:\n${section}`,
    );
  }
});

test("a sub-group is visually a sub-group, and still a thing to click", () => {
  const component = readFileSync(
    join(ROOT, "components", "officials", "card-section.tsx"),
    "utf8",
  );
  assert.ok(
    /data-level=\{level === "sub" \? "sub" : undefined\}/.test(component),
    "the level must reach the DOM or the stylesheet cannot see it",
  );
  const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
  // Indented behind a rule, stepped down in scale — hierarchy in the
  // committed grammar rather than a new affordance language.
  assert.ok(/\.card-section\[data-level="sub"\] \{[^}]*margin-left/.test(css));
  assert.ok(/\.card-section\[data-level="sub"\] \{[^}]*border-left/.test(css));
  assert.ok(
    /\.card-section\[data-level="sub"\] \.card-section-title \{[^}]*font-size/.test(css),
  );
  // The chevron rule stays scoped with `>` — the defect that rotated closed
  // sub-groups' arrows when the parent opened must not come back.
  assert.ok(
    /\.card-section\[data-open\] > \.card-section-header \.card-section-chevron/.test(
      css,
    ),
    "the chevron rotation must stay scoped to a section's own header",
  );
});


/* ══ B15, 2026-08-18 (g19): the coverage floor ══════════════════════════
 *
 * These exist because of a mistake made in this session, and they guard
 * against exactly it.
 *
 * The brief said votes on laws was the named remainder. It was not — an
 * earlier session had already resolved 18 of the 20 law entries against the
 * chambers' own records, and the docblock in lib/votes/key-votes.ts still
 * said otherwise, so a new resolver was written and run against a snapshot
 * nobody had re-read. It "resolved" the four April 2024 siblings to their
 * Senate VEHICLE, which carries no House vote of its own, and wrote that
 * over four correct House roll calls. House coverage went 18 to 16 and the
 * run reported it as a success.
 *
 * A number that can only go up is the cheapest guard there is for that.
 */

test("B15 g19: law coverage never falls below what has already been verified", () => {
  const snapshot = getKeyVotesSnapshot();
  const laws = snapshot.entries.filter((e) => e.group === "LAWS");

  // The author's list is closed. Its size is a fact, not a floor.
  assert.equal(laws.length, 20, "the author's law list changed size");

  const withHouse = laws.filter((e) => e.house.length > 0).length;
  const withSenate = laws.filter((e) => e.senate.length > 0).length;
  const withEither = laws.filter(
    (e) => e.house.length > 0 || e.senate.length > 0,
  ).length;

  // Floors, verified as of 2026-08-18. A run that finds MORE raises these;
  // a run that finds fewer fails here rather than shipping.
  assert.ok(withEither >= 19, `law entries carrying a roll call fell to ${withEither} (floor 19 of 20)`);
  assert.ok(withHouse >= 19, `law entries carrying a HOUSE roll call fell to ${withHouse} (floor 19)`);
  assert.ok(withSenate >= 18, `law entries carrying a SENATE roll call fell to ${withSenate} (floor 18)`);
});

test("B15 g19: every law entry without a roll call says why, in the record", () => {
  const snapshot = getKeyVotesSnapshot();
  const laws = snapshot.entries.filter((e) => e.group === "LAWS");
  const empty = laws.filter((e) => e.house.length === 0 && e.senate.length === 0);

  // Absence is never asserted. An entry with nothing must carry either a
  // recorded miss naming the reason, or a note the reader sees.
  for (const entry of empty) {
    const miss = snapshot.misses.some((m) => m.id === entry.id);
    const note = Boolean(entry.houseNote || entry.senateNote);
    assert.ok(
      miss || note,
      `${entry.id} carries no roll call and no recorded reason — that is an unexplained gap`,
    );
  }
});

test("B15 g19: every recorded roll call carries its tally, its link and its verification date", () => {
  const snapshot = getKeyVotesSnapshot();
  let refs = 0;
  for (const entry of snapshot.entries) {
    for (const ref of [...entry.house, ...entry.senate]) {
      refs++;
      // A ref with no tally has nothing to check the roll call against, and
      // a ref with no verifiedAt is a claim with no date on it.
      assert.ok(ref.tally, `${entry.id} has a roll call with no tally`);
      assert.match(ref.tally, /^\d+-\d+$/, `${entry.id}: tally "${ref.tally}" is not a tally`);
      assert.ok(ref.url, `${entry.id} has a roll call with no official link`);
      assert.match(
        ref.url,
        /^https:\/\/(www\.senate\.gov|clerk\.house\.gov)\//,
        `${entry.id}: a roll call links somewhere that is not a chamber's own site`,
      );
      assert.ok(ref.verifiedAt, `${entry.id} has a roll call with no verification date`);
    }
  }
  // Counted, not merely iterated: an empty loop passes every assertion in
  // it, which is the empty-success shape this repo keeps catching.
  assert.ok(refs >= 53, `only ${refs} roll calls in the snapshot — expected at least 53`);
});

/* ══ B15 closes at 19 of 20, 2026-08-19 (g20) ═══════════════════════════════ */

test("B15 g20: D68's overwrite is repaired — every House ref is distinct and dated", () => {
  const snapshot = getKeyVotesSnapshot();
  const laws = snapshot.entries.filter((e) => e.group === "LAWS");

  // g19 overwrote four verified House roll calls with a Senate vehicle that
  // has no House vote of its own, and the run printed a total that did not
  // move because the entries kept their Senate refs. The symptom to check
  // for is therefore NOT the total: it is two entries pointing at one ref.
  const byRef = new Map<string, string[]>();
  for (const entry of laws) {
    for (const ref of entry.house) {
      const key = ref.url ?? `${ref.congress}/${ref.session}/${ref.rollNumber}`;
      byRef.set(key, [...(byRef.get(key) ?? []), entry.id]);
    }
  }
  for (const [key, ids] of byRef) {
    assert.equal(
      ids.length,
      1,
      `${ids.join(" and ")} share the House roll call ${key} — the D68 shape`,
    );
  }

  // The four April 2024 siblings, by name, each on its own House roll call.
  const april = laws.filter((e) => e.id.startsWith("april-2024-"));
  assert.equal(april.length, 4);
  const rolls = april.map((e) => e.house[0]?.rollNumber).sort((a, b) => (a ?? 0) - (b ?? 0));
  assert.deepEqual(rolls, [145, 146, 151, 152], "an April 2024 House roll call moved");

  // House coverage, exact rather than "at least" — the floor a total hid.
  assert.equal(
    laws.filter((e) => e.house.length > 0).length,
    19,
    "House coverage across the LAWS list",
  );
});

test("B15 g20: the shutdown entry is PARKED by the author, and a run cannot close it", async () => {
  const { PARKED_KEY_VOTES } = await import("../lib/votes/key-votes.ts");

  // A MISS is what a resolver could not find; it invites a better rung. A
  // PARK is the author's decision that no attempt should be made, because
  // the answer is his to give. The two must not be told apart only in prose.
  assert.ok(PARKED_KEY_VOTES["funding-fight"]);
  assert.match(PARKED_KEY_VOTES["funding-fight"], /Skip for now/);
  assert.match(PARKED_KEY_VOTES["funding-fight"], /2026-08-19/);

  const snapshot = getKeyVotesSnapshot();
  for (const id of Object.keys(PARKED_KEY_VOTES)) {
    const entry = snapshot.entries.find((e) => e.id === id);
    assert.ok(entry, `${id} is parked but is not in the list`);
    assert.equal(entry.house.length, 0, `${id}: parked and yet resolved`);
    assert.equal(entry.senate.length, 0, `${id}: parked and yet resolved`);
  }

  /*
   * THE DOOR THE LAST FIX LEFT OPEN. D68's mitigation is fill-only, which
   * protects a chamber that ALREADY has a roll call. A parked entry has
   * none, so fill-only would let the next run write one in — the exact
   * failure the park exists to prevent. The resolver has to skip parked ids
   * before it reaches the fill-only rule, and it has to say so.
   */
  const script = readFileSync(join(ROOT, "scripts", "fetch-law-votes.mts"), "utf8");
  assert.match(script, /PARKED_KEY_VOTES\[entry\.id\]/);
  assert.match(script, /PARKED \$\{entry\.id\}/);
  assert.match(script, /author has PARKED and this run did not touch/);
  const skipAt = script.indexOf("PARKED_KEY_VOTES[entry.id]");
  const fillAt = script.indexOf("const house = fillOnly(");
  assert.ok(
    skipAt > 0 && skipAt < fillAt,
    "the park is checked after fill-only — fill-only cannot protect an empty chamber",
  );
});

test("B15 g20: the parked entry tells the reader what happened, not just that nothing is here", () => {
  const entry = KEY_VOTES_LAWS.find((e) => e.id === "funding-fight");
  assert.ok(entry);

  // The generic gap line is true and vague — it reads as "nobody looked".
  // What happened is a fact about OUR list: the entry names two things and
  // Congress answered with more than one law. Both chambers say so, because
  // the ambiguity is in the question rather than in either chamber's record.
  for (const note of [entry.houseNote, entry.senateNote]) {
    assert.ok(note, "a parked entry with no note falls to the generic line");
    assert.match(note, /more than one appropriations law/);
    assert.match(note, /rather than guessing/);
    // Never a claim about the member.
    assert.doesNotMatch(note, /did not vote|didn't vote|voted against/i);
  }
});
