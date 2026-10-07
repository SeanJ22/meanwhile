import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  COLLISION_RADIUS,
  FAN_RADIUS,
  fanOffsets,
  findCollisionGroups,
} from "../lib/map/spiderfy.ts";

/**
 * Overlapping pins fan out. After the fan EVERY member of the group is
 * individually reachable, so the separation is asserted at every group size.
 */

test("pins that do not overlap are not a group — a fan of one moves for no reason", () => {
  const spread = [
    { key: "a", x: 0, y: 0 },
    { key: "b", x: 200, y: 0 },
    { key: "c", x: 0, y: 200 },
  ];
  assert.deepEqual(findCollisionGroups(spread), []);
  // And a lone pin is never a group.
  assert.deepEqual(findCollisionGroups([{ key: "a", x: 5, y: 5 }]), []);
  assert.deepEqual(findCollisionGroups([]), []);
});

test("two pins closer than the collision radius are one group", () => {
  const groups = findCollisionGroups([
    { key: "pag", x: 100, y: 100 },
    { key: "neighbour", x: 108, y: 103 },
    { key: "far", x: 400, y: 400 },
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], ["neighbour", "pag"]);
});

test("collision is transitive — a chain is one group, not two overlapping pairs", () => {
  // A–B overlap and B–C overlap, but A and C are 40px apart. Fanning only
  // A and B would leave C sitting under one of the new positions.
  const groups = findCollisionGroups([
    { key: "a", x: 0, y: 0 },
    { key: "b", x: 20, y: 0 },
    { key: "c", x: 40, y: 0 },
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], ["a", "b", "c"]);
});

test("the groups are stable — the same collision fans the same way every time", () => {
  const points = [
    { key: "z", x: 10, y: 10 },
    { key: "m", x: 12, y: 11 },
    { key: "a", x: 11, y: 13 },
  ];
  const first = findCollisionGroups(points);
  const shuffled = findCollisionGroups([points[2], points[0], points[1]]);
  assert.deepEqual(first, shuffled);
  assert.deepEqual(first[0], ["a", "m", "z"]);
});

test("EVERY fanned pin clears every other — the claim, at every group size", () => {
  for (let n = 2; n <= 14; n++) {
    const keys = Array.from({ length: n }, (_, i) => `v${String(i).padStart(2, "0")}`);
    const offsets = fanOffsets(keys);
    assert.equal(offsets.length, n, `group of ${n} lost a pin in the fan`);

    // The fanned positions, as screen points around a shared origin.
    const points = offsets.map((o) => ({ key: o.key, x: o.dx, y: o.dy }));
    const stillColliding = findCollisionGroups(points);
    assert.deepEqual(
      stillColliding,
      [],
      `a group of ${n} still overlaps after fanning: ${JSON.stringify(stillColliding)}`,
    );
  }
});

test("a fan of one is not a fan", () => {
  assert.deepEqual(fanOffsets(["only"]), [{ key: "only", dx: 0, dy: 0 }]);
  assert.deepEqual(fanOffsets([]), []);
});

test("the fan opens far enough to be tappable and not so far it leaves the finger", () => {
  const offsets = fanOffsets(["a", "b", "c"]);
  for (const o of offsets) {
    const distance = Math.hypot(o.dx, o.dy);
    assert.ok(
      distance >= COLLISION_RADIUS,
      `a fanned pin moved only ${distance}px — inside the collision radius`,
    );
    // Three pins fit on the base ring; nothing should be flung across the map.
    assert.ok(distance <= FAN_RADIUS * 1.5, `a fanned pin moved ${distance}px`);
  }
});

test("the pool moves markers by OFFSET, and puts every one of them back", () => {
  // MapLibre owns the marker element's transform and rewrites it every frame,
  // so a CSS transform would be gone by the next render. The offset is
  // re-applied by the library itself, which is what makes a fanned group
  // survive a pan. Source-pinned because the failure is invisible until
  // someone drags the map.
  const pool = readFileSync(join(process.cwd(), "lib", "map", "marker-pool.ts"), "utf8");
  assert.ok(/entry\.marker\.setOffset\(\[dx, dy\]\)/.test(pool), "the fan must use setOffset");
  assert.ok(
    /entry\.marker\.setOffset\(\[0, 0\]\)/.test(pool),
    "putting a pin back must clear its offset",
  );
  assert.ok(
    /export function clearSpiderfy/.test(pool),
    "dismissal needs a way to put every fanned pin back",
  );
  // A removed pin cannot stay in the fanned set, or it accumulates forever.
  assert.ok(
    /pool\.spiderfiedKeys\.delete\(key\)/.test(pool),
    "a venue the data dropped must leave the fanned set",
  );
  assert.ok(
    /pool\.spiderfiedKeys\.clear\(\)/.test(pool),
    "destroying the pool must clear the fanned set",
  );
});

test("a press on a stacked pin fans first and selects nothing", () => {
  const canvas = readFileSync(
    join(process.cwd(), "components", "map", "map-canvas.tsx"),
    "utf8",
  );
  // Already fanned → the press is a selection.
  assert.ok(
    /if \(pool\.spiderfiedKeys\.has\(venue\.key\)\) \{\s*onSelectRef\.current\(venue\);/.test(
      canvas,
    ),
    "a press on an already-fanned pin must select it",
  );
  // Not in a stack → selection, exactly as before. A pin that never collides
  // must still open in ONE press; two would be reader friction everywhere to
  // fix a problem that exists in a few places.
  assert.ok(
    /if \(!group\) \{[\s\S]{0,400}onSelectRef\.current\(venue\);/.test(canvas),
    "a pin with no collision must select in one press",
  );
  // In a stack → fan, and nothing is selected on that press.
  assert.ok(
    /applySpiderfy\(pool, fanOffsets\(group\)\);/.test(canvas),
    "a press on a stacked pin must fan the group",
  );
  // Dismissal: the map's own click, and Escape.
  assert.ok(/clearSpiderfy\(pool\);/.test(canvas), "a press on the map must put them back");
  assert.ok(
    /keyEvent\.key === "Escape"\) clearSpiderfy\(pool\)/.test(canvas),
    "Escape must put them back — the explicit control beside the gesture",
  );
});

test("a fanned pin says it moved, and not in a colour that already means something", () => {
  const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
  const rule = css.match(/\.wtp-pin\[data-spiderfied="true"\][\s\S]*?\}/)?.[0] ?? "";
  assert.ok(rule, "a fanned pin needs a visible mark — it is not where its building is");
  // Pin colour already means WHICH LEVEL of government meets there. A second
  // meaning on the same channel would corrupt the first.
  assert.ok(
    !/background|--pin-color|color:/.test(rule),
    "the fanned mark must not use the pin's colour channel",
  );
});

/**
 * The fan has to READ as a spider.
 *
 * Without legs, a spidered pin just looks like it is moving. The halo the test above guards says a pin moved; it
 * cannot say where from, and without a visible origin the fan is
 * indistinguishable from two pins drifting apart.
 */
test("F01 9.3: every fanned pin draws a leg back to a shared anchor", () => {
  const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

  // The leg, and the anchor dot on its far end.
  assert.match(css, /\.wtp-pin\[data-spiderfied="true"\]::before/);
  assert.match(css, /\.wtp-pin\[data-spiderfied="true"\]::after/);
  // Its length and direction are DATA, written per pin by applySpiderfy.
  assert.match(css, /var\(--spider-len/);
  assert.match(css, /rotate\(var\(--spider-angle/);
  // A leg explains; it never takes the tap the fan exists to make possible.
  const legs = css.slice(css.indexOf('.wtp-pin[data-spiderfied="true"]::before'));
  assert.match(legs.slice(0, 900), /pointer-events: none/);
});

test("F01 9.3: applySpiderfy writes the leg geometry, and clearing removes it", async () => {
  const { applySpiderfy, clearSpiderfy } = await import("../lib/map/marker-pool.ts");

  // A stand-in for MapLibre's marker + its element. Only the two surfaces
  // applySpiderfy touches are modelled.
  const make = () => {
    const style = new Map<string, string>();
    return {
      marker: { setOffset: () => {} },
      element: {
        dataset: {} as Record<string, string | undefined>,
        style: {
          setProperty: (k: string, v: string) => style.set(k, v),
          removeProperty: (k: string) => style.delete(k),
        },
        _read: style,
      },
    };
  };

  const a = make();
  const pool = {
    entries: new Map([["a", a]]),
    spiderfiedKeys: new Set<string>(),
  } as unknown as Parameters<typeof applySpiderfy>[0];

  // A pin fanned straight up: dy is negative on screen, so the leg points
  // straight DOWN, back at the anchor — 90 degrees in CSS's coordinate space.
  applySpiderfy(pool, [{ key: "a", dx: 0, dy: -46 }]);
  assert.equal(a.element.dataset.spiderfied, "true");
  assert.equal(a.element._read.get("--spider-len"), "46px");
  assert.equal(a.element._read.get("--spider-angle"), "90deg");

  // Length is the true distance, not a component of it.
  applySpiderfy(pool, [{ key: "a", dx: 3, dy: 4 }]);
  assert.equal(a.element._read.get("--spider-len"), "5px");

  // Putting a pin back takes the leg with it: a stale length would draw a
  // line to a point the pin no longer came from.
  clearSpiderfy(pool);
  assert.equal(a.element.dataset.spiderfied, undefined);
  assert.equal(a.element._read.has("--spider-len"), false);
  assert.equal(a.element._read.has("--spider-angle"), false);
});
