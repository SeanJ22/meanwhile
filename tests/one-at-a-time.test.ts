import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { INITIAL_STATE, uiReducer } from "../lib/state/reducer.ts";

const entry = () => readFileSync("components/map/map-entry.tsx", "utf8");

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
  // A null selection is a close, not an open.
  const both = uiReducer(uiReducer(INITIAL_STATE, { type: "select/venue", key: "v1" }), {
    type: "select/venue",
    key: null,
  });
  assert.equal(both.selectedVenueKey, null);
  assert.equal(both.selectedDistrictOcdId, null);
});

test("MTG-11: dismissal is ONE function, not three copies", () => {
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

// All three foreground controls open through `openPopup`, the single call site of `takeForeground`.
const openPopupBody = () => {
  const src = entry().replace(/\r/g, "");
  const start = src.indexOf("const openPopup = useCallback(");
  assert.ok(start >= 0, "openPopup is missing from map-entry.tsx");
  const end = src.indexOf("\n    [pop, closePop, closeCard, takeForeground],", start);
  assert.ok(end > start, "openPopup's body could not be delimited");
  return src.slice(start, end);
};

test("MTG-11: all three foreground controls go through one opener", () => {
  const src = entry();
  const calls = src.match(/takeForeground\(\);/g) ?? [];
  assert.equal(calls.length, 1, "takeForeground has exactly one call site: openPopup");
  assert.match(openPopupBody(), /takeForeground\(\);/);
  const cluster = readFileSync("components/shell/pill-cluster.tsx", "utf8");
  for (const pop of ["zip", "vote", "ask"]) {
    assert.ok(cluster.includes(`onOpenPop("${pop}")`), `the ${pop} control opens through onOpenPop`);
  }
});

test("MTG-11: re-pressing a control closes its popup and dismisses nothing else", () => {
  const body = openPopupBody();
  const close = body.indexOf("if (pop === next)");
  const dismiss = body.indexOf("takeForeground()");
  assert.ok(close >= 0 && dismiss > close, "the toggle-close returns before anything is dismissed");
});

test("MTG-11: a popup closes the card BEFORE it opens", () => {
  const body = openPopupBody();
  const closeCard = body.indexOf("closeCard()");
  const open = body.indexOf("setPop(next)");
  assert.ok(closeCard >= 0 && open > closeCard, "the card closes, then the popup opens");
});

test("MAP-3: an area click still leaves Who Governs Here open", () => {
  // The panel has its own open state; this reducer must hold no field for it.
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

test("WGH-15: selecting a district writes SELECTION and never the reader's home", () => {
  // Home location lives in localStorage with one writer; the ui state must not grow a field for it.
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
        `WGH-15: home lives in localStorage with exactly one writer, and the map's ` +
        `selection reducer is not it. A district click may never rewrite where a reader lives.`,
    );
  }
});

test("WGH-15: the map shell reads the home store, and never writes it", () => {
  // The map shell renders both surfaces, so it is where a browse action could reach the home store.
  const source = entry();
  assert.doesNotMatch(source, /writeSessionAddress/, "the map shell writes the home store");
  assert.doesNotMatch(source, /clearSessionAddress/, "the map shell clears the home store");
});

test("MAP-3: takeForeground does not run on an area click", () => {
  const src = entry();
  for (const line of src.split("\n")) {
    if (!line.includes("takeForeground();")) continue;
    assert.ok(
      !/onDistrict|onVenue|onArea|selectDistrict|selectVenue/.test(line),
      `takeForeground is being called from what looks like an area click: ${line.trim()}`,
    );
  }
  /* And the three foreground controls are still here, as the popups. */
  const src2 = src.replace(/\r/g, "");
  assert.ok(src2.includes(`{pop === "vote" && (`), "the voting control is still here");
  assert.ok(src2.includes(`{pop === "zip" && (`), "the change-zip control is still here");
  assert.ok(src2.includes(`{pop === "ask" &&`), "the Ask control is still here");
});
