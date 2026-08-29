/**
 * **THE ONE TEST ROUTE FACTORY.** (2026-08-28. RULING 103.)
 *
 * `tests/method-claims.test.ts` and `tests/method-projection.test.ts` both need
 * a minimal, valid `MethodRoute` to build synthetic stores out of, and both had
 * written the same eleven lines — which `tests/duplicate-implementations.test.ts`
 * catches by design and refuses.
 *
 * The shared version lives here rather than in `lib/method/`, because it is a
 * fixture and a fixture that ships in the library is a shape production code can
 * accidentally depend on. It is deliberately NOT a `*.test.ts` file: the runner
 * globs those, and a module of helpers that declares no tests would report as an
 * empty suite.
 *
 * It stays minimal on purpose. A test that needs a route with outcomes, claims,
 * sub-branches or a retirement passes them through `over`, so the fixture never
 * becomes a second source of truth about what a route is.
 */

import type { MethodRoute } from "../lib/method/knowledge.ts";
import { unknownApplicability } from "../lib/method/portability.ts";

/** The date every synthetic fixture is stamped with. `pnpm stamp`, 2026-08-28. */
export const FIXTURE_ON = "2026-08-28";

export function testRoute(
  id: string,
  over: Partial<MethodRoute> = {},
): Omit<MethodRoute, "learnedAtVersion"> {
  return {
    id,
    title: id,
    tier: "A1",
    fields: ["meeting"],
    applicability: unknownApplicability("test route"),
    outcomes: [],
    subBranches: [],
    origin: "test",
    learnedOn: FIXTURE_ON,
    ...over,
  };
}
