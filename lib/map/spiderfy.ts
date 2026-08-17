/**
 * **Overlapping pins fan out** — M19, 2026-08-17, the author's ruling (A:
 * spiderfy).
 *
 * ## The defect
 *
 * Two venues a block apart collide on screen at metro zoom, and the top one
 * intercepts the clicks meant for the other. Playwright named it in Phase 6
 * screenshots — one marker "intercepts pointer events" for another, Pima
 * Association of Governments sitting over its neighbour in downtown Tucson.
 * It is NOT the 40px touch target: it reproduces with that rule scoped to
 * `pointer: coarse`, because the 14px dots themselves overlap.
 *
 * `lib/meetings/venues.ts` already groups meetings by rounded coordinate, so
 * one BUILDING is one pin. This is the other case: different buildings, too
 * close on screen to hit separately.
 *
 * ## Why fan-out rather than clustering
 *
 * The author's ruling, and it is the right one for this product. Clustering
 * replaces pins with a number, which means the reader has to open something
 * before they can see what is there — a click the map used to not need, and
 * reader friction is a defect with the standing of a wrong number. Raising
 * the grouping precision by zoom would MERGE two different governments' venues
 * into one pin, which is worse than either: a merged pin is a claim that two
 * buildings are one place.
 *
 * Fanning out adds nothing and hides nothing. Every pin that was there is
 * still there, still its own colour and its own count, just far enough apart
 * to hit.
 *
 * ## Geometry, and why it is here rather than in the component
 *
 * Screen points in, offsets out, no map and no DOM. The rule this encodes —
 * every member of a group ends up at least `minSeparation` from every other —
 * is the kind that decays silently into "it looks about right on my screen",
 * and a fan that still overlaps is indistinguishable from no fix at all.
 * `tests/spiderfy.test.ts` asserts the separation directly.
 */

export interface ScreenPoint {
  key: string;
  x: number;
  y: number;
}

/**
 * Two dots collide when their centres are closer than this, in CSS pixels.
 *
 * The dot is 14px across, so 14 is the touching distance and anything under
 * it is an overlap. The value is larger on purpose: a pin whose EDGES merely
 * kiss is still a pin a thumb cannot pick between, and the tap target is
 * 40px at `pointer: coarse`. 28 is the diameter at which two dots have a
 * clear gap between them at every viewport.
 */
export const COLLISION_RADIUS = 28;

/** The radius the fan opens to. Big enough that 40px targets clear each other. */
export const FAN_RADIUS = 46;

/**
 * Groups of keys that overlap each other on screen.
 *
 * Transitive by construction: A overlapping B and B overlapping C puts all
 * three in one group even when A and C are far apart, because fanning out
 * only two of them would leave the third sitting under one of the new
 * positions. Single pins are not groups and are not returned — a fan of one
 * is a pin that moved for no reason.
 */
export function findCollisionGroups(
  points: ScreenPoint[],
  radius: number = COLLISION_RADIUS,
): string[][] {
  const parent = new Map<string, string>();
  for (const p of points) parent.set(p.key, p.key);

  const find = (k: string): string => {
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression, so a long chain of near-collinear pins stays cheap.
    let walk = k;
    while (parent.get(walk) !== root) {
      const next = parent.get(walk)!;
      parent.set(walk, root);
      walk = next;
    }
    return root;
  };

  const radiusSq = radius * radius;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      if (dx * dx + dy * dy >= radiusSq) continue;
      const a = find(points[i].key);
      const b = find(points[j].key);
      if (a !== b) parent.set(a, b);
    }
  }

  const groups = new Map<string, string[]>();
  for (const p of points) {
    const root = find(p.key);
    const list = groups.get(root);
    if (list) list.push(p.key);
    else groups.set(root, [p.key]);
  }

  // Stable order, so the same collision produces the same fan every time. A
  // fan that reshuffles between renders is a reader losing the pin they were
  // reaching for.
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => [...g].sort())
    .sort((a, b) => a[0].localeCompare(b[0]));
}

export interface FanOffset {
  key: string;
  /** Screen-pixel offset from the pin's true position. */
  dx: number;
  dy: number;
}

/**
 * Fan `keys` out around their shared centre.
 *
 * A circle for small groups; a spiral once a circle of `FAN_RADIUS` cannot
 * hold them with a clear gap. The spiral is not decoration — at nine venues
 * in one building cluster, a fixed-radius circle puts adjacent pins closer
 * together than they were before the fan, which would be the defect
 * reintroduced by the fix.
 *
 * The first pin starts at the top and they run clockwise, so the order on
 * screen matches the sorted key order and is the same every time.
 */
export function fanOffsets(
  keys: string[],
  radius: number = FAN_RADIUS,
  minSeparation: number = COLLISION_RADIUS,
): FanOffset[] {
  const n = keys.length;
  if (n <= 1) return keys.map((key) => ({ key, dx: 0, dy: 0 }));

  // The radius a circle needs so adjacent pins clear `minSeparation`:
  // chord = 2·r·sin(π/n) ≥ minSeparation.
  const needed = minSeparation / (2 * Math.sin(Math.PI / n));
  const circleRadius = Math.max(radius, needed);

  // Up to eight fit on one comfortable ring; beyond that the ring would grow
  // far enough to drag pins away from where the reader pressed, so it becomes
  // a spiral whose arms are `minSeparation` apart.
  if (n <= 8) {
    return keys.map((key, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      return {
        key,
        dx: round(circleRadius * Math.cos(angle)),
        dy: round(circleRadius * Math.sin(angle)),
      };
    });
  }

  const step = minSeparation * 1.1;
  return keys.map((key, i) => {
    // Archimedean: r grows with the angle, so arc length between successive
    // points stays roughly constant instead of bunching near the centre.
    const angle = Math.sqrt(i + 1) * 2.4;
    const r = radius + (step * angle) / (2 * Math.PI);
    return { key, dx: round(r * Math.cos(angle)), dy: round(r * Math.sin(angle)) };
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
