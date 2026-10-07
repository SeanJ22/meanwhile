/**
 * Overlapping pins fan out. Different buildings close enough to collide on
 * screen spread apart around their shared centre; every pin keeps its own
 * colour and count. Not clustering (which hides pins behind a number) and not
 * coarser grouping (which would merge two buildings into one pin).
 *
 * Screen points in, offsets out, no map and no DOM: every member of a group
 * ends at least `minSeparation` from every other.
 */

export interface ScreenPoint {
  key: string;
  x: number;
  y: number;
}

/**
 * Two dots collide when their centres are closer than this, in CSS pixels.
 * The dot is 14px; 28 leaves a clear gap at every viewport.
 */
export const COLLISION_RADIUS = 28;

/** The radius the fan opens to. Big enough that 40px targets clear each other. */
export const FAN_RADIUS = 46;

/**
 * Groups of keys that overlap each other on screen. Transitive: A over B and
 * B over C puts all three in one group. Single pins are not returned.
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

  // Stable order, so the same collision produces the same fan every time.
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
 * Fan `keys` out around their shared centre: a circle for small groups, a
 * spiral once a circle of `FAN_RADIUS` cannot hold them with a clear gap. The
 * first pin starts at the top and they run clockwise in sorted key order.
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
