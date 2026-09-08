/**
 * MTG-11 — ONE THING UP AT A TIME, AND IT REACHES BEYOND CARDS.
 * (2026-08-25, the author's `17-22-03` and `17-23-22`. Second pass on BC-16.)
 *
 * **The reconciliation.** BC-16 (8/25 morning) made two SMALL CARDS exclude
 * each other, in `lib/state/reducer.ts`, and **it did not regress** — opening
 * either still closes the other, asserted below. The verdict is **(b): the
 * predicate is too narrow.** BC-16's exclusion covers card-versus-card and
 * nothing else, and the author's captures show the overlap one layer out: he
 * opens *Where can I vote?* and the eight-meeting Vail card is still sitting on
 * the right, still there in the next capture while he reads a polling address.
 * His arrow marks the meetings card and his words are *clicking anywhere else
 * means the meetings card goes back to not being viewed.*
 *
 * So three controls that take the foreground — **Where can I vote?, Ask, and
 * Change Zip** — dismiss whichever small card is open.
 *
 * ## The MAP-3 exception, which is what makes this delicate
 *
 * Who Governs Here and an area's battlecard appearing TOGETHER on an area
 * click is deliberate. The author says so in as many words — *Sean likes this.
 * It's very clear. Keep it* — and calls out that it is not the overlap defect.
 * Regressing it is a session failure, so it is asserted here rather than
 * assumed.
 *
 * It survives BY CONSTRUCTION: `takeForeground` closes the venue and district
 * SELECTIONS and is called from exactly three places, none of which runs on an
 * area click. Nothing it does touches the Who Governs Here panel.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { INITIAL_STATE, uiReducer } from "../lib/state/reducer.ts";

const entry = () => readFileSync("components/map/map-entry.tsx", "utf8");

/* -------------------------------------------------------------------------- */
/* BC-16 — unchanged, and asserted so a second pass cannot cost the first      */
/* -------------------------------------------------------------------------- */

test("BC-16: opening a district card still closes an open venue card", () => {
  const withVenue = uiReducer(INITIAL_STATE, { type: "select/venue", key: "v1" });
  assert.equal(withVenue.selectedVenueKey, "v1");
  const then = uiReducer(withVenue, {
    type: "select/district",
    ocdId: "ocd-division/country:us/state:nj/county:morris",
    districtType: "county",
  });
  assert.equal(then.selectedVenueKey, null, "the venue card must close");
  assert.equal(then.selectedDistrictOcdId, "ocd-division/country:us/state:nj/county:morris");
});

test("BC-16: opening a venue card still closes an open district card", () => {
  const withDistrict = uiReducer(INITIAL_STATE, {
    type: "select/district",
    ocdId: "ocd-division/country:us/state:az/county:pima",
    districtType: "county",
  });
  const then = uiReducer(withDistrict, { type: "select/venue", key: "v1" });
  assert.equal(then.selectedDistrictOcdId, null, "the district card must close");
  assert.equal(then.selectedVenueKey, "v1");
});

test("BC-16: closing one card does not silently close the other", () => {
  /* A `null` selection is a CLOSE, not an open. Dismissing one must not
     dismiss both — the clause BC-16 called out explicitly. */
  const both = uiReducer(uiReducer(INITIAL_STATE, { type: "select/venue", key: "v1" }), {
    type: "select/venue",
    key: null,
  });
  assert.equal(both.selectedVenueKey, null);
  assert.equal(both.selectedDistrictOcdId, null);
});

/* -------------------------------------------------------------------------- */
/* MTG-11 — the three foreground controls                                     */
/* -------------------------------------------------------------------------- */

test("MTG-11: dismissal is ONE function, not three copies", () => {
  /*
   * The same reasoning BC-16 gives for living in the reducer: a rule spread
   * across handlers is a rule the handler nobody thought of does not follow.
   * Three inline pairs of dispatches would also be three duplicate
   * implementations (RULING 103).
   */
  const src = entry();
  const fn = /const takeForeground = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[dispatch\]\);/.exec(src);
  assert.ok(fn, "takeForeground is missing from map-entry.tsx");
  assert.match(fn[1], /type: "select\/venue", key: null/, "it must close the venue card");
  assert.match(
    fn[1],
    /type: "select\/district", ocdId: null/,
    "it must close the district card",
  );
});

test("MTG-11: all three foreground controls call it", () => {
  const src = entry();
  const calls = src.match(/takeForeground\(\); \/\/ MTG-11/g) ?? [];
  assert.equal(
    calls.length,
    3,
    `takeForeground is called from ${calls.length} place(s); the author named THREE — ` +
      `Where can I vote?, Ask, and Change Zip. A control that stopped calling it would ` +
      `leave the meetings card sitting behind it, which is MTG-11.`,
  );
});

test("MTG-11: Ask dismisses the small card, and only when OPENING", () => {
  const src = entry();
  const toggle = /const onToggleAsk = useCallback\(\(open: boolean\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/.exec(
    src,
  );
  assert.ok(toggle, "the Ask toggle is missing");
  const body = toggle[1];
  assert.match(body, /takeForeground\(\)/, "opening Ask must dismiss the small card");
  /* The early return on close comes FIRST, so closing Ask dismisses nothing. */
  assert.ok(
    body.indexOf("if (!open) return;") < body.indexOf("takeForeground()"),
    "closing Ask must not dismiss anything — the early return has to precede the call",
  );
});

test("MTG-11: the voting control dismisses BEFORE it opens", () => {
  const src = entry();
  const handler = /onClick=\{\(\) => \{\s*takeForeground\(\); \/\/ MTG-11\s*setVotingOpen\(true\);/.exec(
    src,
  );
  assert.ok(
    handler,
    "the Where-can-I-vote control must dismiss the open card and then open the panel",
  );
});

test("LAY-16: every desktop placement reuses one voting control", () => {
  const src = entry();
  assert.equal(
    (src.match(/data-reader-vote-control="true"/g) ?? []).length,
    1,
    "the review placements must move one control, not mount copies",
  );
  assert.equal((src.match(/<VotingSitesPanel\b/g) ?? []).length, 1);
  assert.match(src, /reviewTrailingControl=\{voteInCluster \? voteControl : null\}/);
  assert.match(src, /\{!voteInCluster && voteControl\}/);
});

/* -------------------------------------------------------------------------- */
/* MAP-3 — the deliberate exception, asserted rather than assumed              */
/* -------------------------------------------------------------------------- */

test("MAP-3: an area click still leaves Who Governs Here open", () => {
  /*
   * The author's protected behaviour. Selecting a district is the whole of an
   * area click in this state, and it must not touch anything Who Governs Here
   * reads — the panel has its own open state and this reducer holds no field
   * for it. Asserted by NAME so that adding one and clearing it here would be
   * a visible failure rather than a quiet regression.
   */
  const after = uiReducer(INITIAL_STATE, {
    type: "select/district",
    ocdId: "ocd-division/country:us/state:az/school_district:vail_unified",
    districtType: "school-unified",
  });
  assert.equal(after.selectedDistrictOcdId, "ocd-division/country:us/state:az/school_district:vail_unified");
  for (const key of Object.keys(after)) {
    assert.ok(
      !/wgh|whoGoverns|notice/i.test(key),
      `the ui state has grown \`${key}\`, which looks like Who Governs Here's open state. ` +
        `MAP-3 requires that an area click leave that panel alone — if this field is now ` +
        `what the panel reads, assert here that select/district does not clear it.`,
    );
  }
});

/* -------------------------------------------------------------------------- */
/* WGH-15 — HOME LOCATION IS NOT BROWSING LOCATION                            */
/* -------------------------------------------------------------------------- */

test("WGH-15: selecting a district writes SELECTION and never the reader's home", () => {
  /*
   * The reported screen showed *State House District 17* on the who-governs
   * card and *District 19* on the district popup at the same moment, and the
   * natural suspicion is that browsing had overwritten home. **It had not**,
   * and this is the reducer half of proving it stays that way.
   *
   * The MAP-3 sweep above guards the PANEL's open state. This guards the
   * READER'S LOCATION, which is a different thing living in a different store:
   * `sessionStorage["wtp.session_address_scope"]`, whose only writer is
   * `components/address/address-prompt.tsx`. A field appearing on the ui state
   * that looks like a home location is how the two would start to leak.
   */
  const before = uiReducer(INITIAL_STATE, {
    type: "select/district",
    ocdId: "ocd-division/country:us/state:az/sldl:17",
    districtType: "state-house",
  });
  const after = uiReducer(before, {
    type: "select/district",
    ocdId: "ocd-division/country:us/state:az/sldl:19",
    districtType: "state-house",
  });

  // Browsing to a second district changes ONLY the selection.
  assert.equal(after.selectedDistrictOcdId, "ocd-division/country:us/state:az/sldl:19");
  const moved = Object.keys(after).filter(
    (k) => after[k as keyof typeof after] !== before[k as keyof typeof before],
  );
  assert.deepEqual(
    moved.sort(),
    ["selectedDistrictOcdId"],
    `selecting a district moved ${moved.join(", ")} — only the selection may move`,
  );

  // And no field on this state may look like where the reader LIVES.
  for (const key of Object.keys(after)) {
    assert.ok(
      !/home|address|residen|confirmedDivision|splitLevel/i.test(key),
      `the ui state has grown \`${key}\`, which looks like the reader's HOME location. ` +
        `WGH-15: home lives in sessionStorage with exactly one writer, and the map's ` +
        `selection reducer is not it. A district click may never rewrite where a reader lives.`,
    );
  }
});

test("WGH-15: the map shell reads the home store, and never writes it", () => {
  /*
   * `writeSessionAddress` and `clearSessionAddress` are the only two writers of
   * the reader's home. The map shell renders BOTH surfaces — the who-governs
   * card and the district popup — so it is the one file where a browse action
   * could reach the home store, and it must not.
   */
  const source = entry();
  assert.doesNotMatch(source, /writeSessionAddress/, "the map shell writes the home store");
  assert.doesNotMatch(source, /clearSessionAddress/, "the map shell clears the home store");
});

test("MAP-3: takeForeground does not run on an area click", () => {
  /*
   * The other half. Three call sites, all named, none of them a map click. If
   * a fourth appears on a district or venue handler, MAP-3's two cards stop
   * appearing together.
   */
  const src = entry();
  for (const line of src.split("\n")) {
    if (!line.includes("takeForeground(); // MTG-11")) continue;
    assert.ok(
      !/onDistrict|onVenue|onArea|selectDistrict|selectVenue/.test(line),
      `takeForeground is being called from what looks like an area click: ${line.trim()}`,
    );
  }
  /* And the three sites are the three the author named. */
  const src2 = src.replace(/\r/g, "");
  assert.match(src2, /setVotingOpen\(true\)/, "the voting control is still here");
  assert.match(src2, /setWelcomeRequested\(true\)/, "the change-zip control is still here");
  assert.match(src2, /setAskOpen\(open\)/, "the Ask control is still here");
});
