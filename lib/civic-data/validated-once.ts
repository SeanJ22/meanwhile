/**
 * **AN EDGE VALUE IS VALIDATED ONCE PER VERSION, NOT ONCE PER READ.** (C21,
 * 2026-09-25.)
 *
 * A reader request primes the registry runtime, the federal directory and the
 * curated projections from the edge values it entered, and each prime used to
 * validate the whole value again: about five registry validations per
 * `/api/meetings` request, every one walking every body, roster member and
 * candidacy row of the same immutable object. The edge caches each value per
 * version per process (`lib/meetings/edge-serving.ts`) and never mutates it, so
 * the answer to "is this value valid" cannot change between two primes of the
 * same object at the same version.
 *
 * Keyed by the value OBJECT and the version together: a different object that
 * claims the same version (a test fixture, a refetch after a failure) is
 * validated on its own, and a throw records nothing, so an invalid value keeps
 * failing every prime exactly as before.
 */
const validated = new WeakMap<object, Set<string>>();
let runs = 0;

export function validateOnce(family: string, value: object, versionId: string, validate: () => void): void {
  if (typeof value !== "object" || value === null) {
    // Not an object at all: nothing to key a memo on, and the validator refuses it.
    validate();
    runs += 1;
    return;
  }
  const key = `${family}\u0000${versionId}`;
  const seen = validated.get(value);
  if (seen?.has(key)) return;
  validate();
  runs += 1;
  if (seen) seen.add(key);
  else validated.set(value, new Set([key]));
}

/** How many validations have actually run in this process: the instrument the memo's test counts. */
export function edgeValidationsRun(): number {
  return runs;
}
