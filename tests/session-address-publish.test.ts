import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { relative } from "node:path";

import { ROOT, sourceFilesUnder } from "./read-code.ts";

/**
 * **WGH-22 — THE WRITE MUST ANNOUNCE ITSELF.**
 *
 * Fourth appearance of one defect (WGH-12 and WGH-15 on 8/28, WGH-22 on 8/30,
 * falsified again by the owner on production on 8/31). Every previous pass
 * corrected what the panel DERIVED from the session address. The derivation was
 * right each time. The notification never happened.
 *
 * ## The seam
 *
 * `sessionStorage` fires a `storage` event in every OTHER tab and never in the
 * tab that performed the write. `hooks/use-resolved-location.ts` held its own
 * `Set<() => void>` and handed it to `subscribeToStorage`; the two writers live
 * in `lib/geo/session-address.ts` and could not see that set, so NOTHING ever
 * iterated it. The only notification the hook could receive was the cross-tab
 * event, which by specification never arrives in the tab a reader is using.
 *
 * The address control still re-rendered — it had just made the request and held
 * the answer in its own state — so the banner read "State House District 17"
 * while the who-governs panel two components away went on rendering the
 * ZIP-level District 19 it had read at mount.
 *
 * ## Why these tests and not the ones that already passed
 *
 * Three instruments certified this defect fixed while it was live:
 *
 * 1. A unit test whose fixture hand-built a `CoverageSummary` whose `divisions`
 *    carried 17 while its `seats` did not — a shape the real derivation cannot
 *    emit, because `summarizeCoverage` derives seats BY FILTERING divisions.
 * 2. A sweep row closed against check id `rq:wgh-22-panel-seats`, which does not
 *    exist on disk. The gate required a non-empty string and never asked whether
 *    it named anything.
 * 3. The walk block in `scripts/walk-all.mts`, which wrote the scope into
 *    `sessionStorage` and then HAND-DISPATCHED a synthetic `storage` event. It
 *    measured every step downstream of the notification while supplying the
 *    notification itself — the one thing the product does not do.
 *
 * So the first test below asserts the notification, which is the fact all three
 * missed, and it fails against the previous code. The second generalises it: a
 * listener set that nothing publishes is the defect class, and it is now
 * refused across the tree rather than in the one file that had it.
 *
 * The reader's own interaction — typed into the prompt in ONE tab, no seeded
 * storage and no synthetic event — is asserted in `scripts/walk-all.mts` against
 * a rendered build, because that is the only place a real tab exists.
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
      // reproduce false verification #3 inside the unit suite.
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

    /*
     * The whole defect, in one assertion. Before the fix this is 0: the value
     * landed in storage and every mounted surface reading it was told nothing.
     */
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
   * The class, swept rather than listed. `use-resolved-location.ts` was the one
   * instance; this is what stops the next storage-backed hook from being the
   * second. Comments are NOT stripped away here — the declaration and the
   * publication are both code — but the match is anchored on the assignment so
   * prose about a listener set cannot satisfy or trip it.
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
       * Three publication shapes, and the third arrived with the class audit
       * (2026-08-31): the hand-written loop moved into `publishToListeners`, so
       * a set handed to the shared publisher is published exactly as much as
       * one iterated in place. Accepting it is not a loosening — the sweep
       * still refuses a set that goes nowhere, which is the whole assertion.
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
