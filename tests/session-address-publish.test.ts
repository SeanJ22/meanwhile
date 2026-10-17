import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { relative } from "node:path";

import { ROOT, sourceFilesUnder } from "./read-code.ts";

/**
 * `localStorage` fires a `storage` event in every OTHER tab and never in the
 * tab that performed the write, so a write must publish to its own tab's
 * listeners. The reader's own interaction in one tab is asserted in
 * `scripts/walk-all.mts` against a rendered build.
 */

/** A localStorage that behaves like the browser's, for one test. */
function fakeWindow() {
  const items = new Map<string, string>();
  const handlers = new Set<() => void>();
  return {
    items,
    handlers,
    window: {
      localStorage: {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
        removeItem: (key: string) => void items.delete(key),
      },
      // Deliberately NOT wired to `setItem`. The browser does not fire a
      // `storage` event in the tab that wrote, and a stub that did would
      // hide the defect.
      addEventListener: (_type: string, fn: () => void) => void handlers.add(fn),
      removeEventListener: (_type: string, fn: () => void) => void handlers.delete(fn),
    },
  };
}

test("a same-tab write notifies the session-address subscribers", async () => {
  const stub = fakeWindow();
  const priorWindow = Reflect.get(globalThis, "window");
  Reflect.set(globalThis, "window", stub.window);

  try {
    const { writeSessionAddress, clearSessionAddress, subscribeToSessionAddress, readSessionAddress } =
      await import("../lib/geo/session-address.ts");

    let notifications = 0;
    const unsubscribe = subscribeToSessionAddress(() => {
      notifications += 1;
    });

    writeSessionAddress({
      zip: "85641",
      contestIds: [],
      divisionIds: ["ocd-division/country:us/state:az/sldl:17"],
      splitLevels: [],
      streetLabel: "South Bear Table Tank Drive",
    });

    assert.equal(
      notifications,
      1,
      "writeSessionAddress must publish to same-tab subscribers — localStorage will not",
    );
    assert.equal(
      readSessionAddress()?.divisionIds[0],
      "ocd-division/country:us/state:az/sldl:17",
      "and the value it published is the value it stored",
    );

    clearSessionAddress();
    assert.equal(
      notifications,
      2,
      "clearSessionAddress must publish too — a reader widening back to the ZIP is a change",
    );

    unsubscribe();
    writeSessionAddress({
      zip: "85641",
      contestIds: [],
      divisionIds: [],
      splitLevels: [],
      streetLabel: "somewhere else",
    });
    assert.equal(notifications, 2, "an unsubscribed surface stops hearing");
  } finally {
    if (priorWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Reflect.set(globalThis, "window", priorWindow);
  }
});

test("no module keeps a listener set that nothing ever publishes", () => {
  /*
   * Comments are NOT stripped away here — the declaration and the publication
   * are both code — but the match is anchored on the assignment so prose about
   * a listener set cannot satisfy or trip it.
   */
  const files = [
    ...sourceFilesUnder([".ts", ".tsx"], "hooks"),
    ...sourceFilesUnder([".ts", ".tsx"], "components"),
    ...sourceFilesUnder([".ts", ".tsx"], "lib"),
  ];

  const declaration = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*new Set<\(\)\s*=>\s*void>\(\)/g;
  const orphans: string[] = [];
  let swept = 0;

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(declaration)) {
      swept += 1;
      const name = match[1];
      /*
       * Three publication shapes: a set handed to the shared `publishToListeners`
       * is published exactly as much as one iterated in place.
       */
      const iterated =
        new RegExp(`for\\s*\\(\\s*const\\s+\\w+\\s+of\\s+\\[?\\.{0,3}${name}\\]?\\s*\\)`).test(source) ||
        new RegExp(`${name}\\.forEach\\s*\\(`).test(source) ||
        new RegExp(`publishToListeners\\s*\\(\\s*${name}\\s*\\)`).test(source);
      if (!iterated) orphans.push(`${relative(ROOT, file)} declares ${name}`);
    }
  }

  // A guard that swept nothing reports green without having looked.
  assert.ok(swept >= 7, `the sweep found only ${swept} listener set(s); it should see every one`);
  assert.deepEqual(
    orphans,
    [],
    `a listener set that is never iterated can never notify anyone: ${orphans.join("; ")}`,
  );
});


test("the exact address and scope remain on the device across days and tab closure until Forget", async () => {
  const stub = fakeWindow();
  const prior = Reflect.get(globalThis, "window");
  Reflect.set(globalThis, "window", stub.window);
  try {
    const { SESSION_ADDRESS_KEY, readSessionAddress, writeSessionAddress, clearSessionAddress } = await import("../lib/geo/session-address.ts");
    stub.items.set(SESSION_ADDRESS_KEY, JSON.stringify({ zip: "43215", contestIds: ["old"], resolvedAt: new Date().toISOString() }));
    assert.equal(readSessionAddress(), null);
    const typed = "123  W Congress St, Tucson, AZ 85701";
    const divisions = ["ocd-division/country:us/state:az/cd:7", "ocd-division/country:us/state:az/sldu:20",
      "ocd-division/country:us/state:az/sldl:20", "ocd-division/country:us/state:az/county:pima",
      "ocd-division/country:us/state:az/place:tucson", "ocd-division/country:us/state:az/school_district:tucson_unified"];
    writeSessionAddress({ zip: "85701", streetLabel: typed, divisionIds: divisions,
      divisionLabels: ["Congressional District 7", "Pima County"], splitLevels: [], contestIds: ["inside"], excludedContestIds: ["outside"] });
    assert.deepEqual(readSessionAddress()?.excludedContestIds, ["outside"]);
    assert.equal(readSessionAddress()?.streetLabel, typed);
    assert.deepEqual(readSessionAddress()?.divisionIds, divisions);
    const saved = JSON.parse(stub.items.get(SESSION_ADDRESS_KEY)!);
    stub.items.set(SESSION_ADDRESS_KEY, JSON.stringify({ ...saved, resolvedAt: "2020-01-01T00:00:00Z" }));
    assert.equal(readSessionAddress()?.streetLabel, typed, "a new UTC day cannot forget the address");
    // A newly opened tab has a new window and the same device-local storage.
    Reflect.set(globalThis, "window", { ...fakeWindow().window, localStorage: stub.window.localStorage });
    assert.equal(readSessionAddress()?.streetLabel, typed);
    assert.deepEqual(readSessionAddress()?.divisionIds, divisions);
    assert.doesNotMatch(stub.items.get(SESSION_ADDRESS_KEY)!, /\b(?:lat|lng|coordinates)\b/);
    clearSessionAddress();
    assert.equal(readSessionAddress(), null);
    assert.equal(stub.items.has(SESSION_ADDRESS_KEY), false);
  } finally {
    if (prior === undefined) Reflect.deleteProperty(globalThis, "window"); else Reflect.set(globalThis, "window", prior);
  }
});
