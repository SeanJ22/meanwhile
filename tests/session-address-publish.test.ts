import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { relative } from "node:path";

import { ROOT, sourceFilesUnder } from "./read-code.ts";

/**
 * `sessionStorage` fires a `storage` event in every OTHER tab and never in the
 * tab that performed the write, so a write must publish to its own tab's
 * listeners. The reader's own interaction in one tab is asserted in
 * `scripts/walk-all.mts` against a rendered build.
 */

/** A `sessionStorage` that behaves like the browser's, for one test. */
function fakeWindow() {
  const items = new Map<string, string>();
  const handlers = new Set<() => void>();
  return {
    items,
    handlers,
    window: {
      sessionStorage: {
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
      "writeSessionAddress must publish to same-tab subscribers — sessionStorage will not",
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
