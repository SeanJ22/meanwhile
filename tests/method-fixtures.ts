/**
 * The one test route factory: a minimal, valid `MethodRoute` for synthetic stores. Not a `*.test.ts` file, so the
 * runner does not report it as an empty suite. A test that needs outcomes, claims, sub-branches or a retirement
 * passes them through `over`.
 */

import type { MethodRoute } from "../lib/method/knowledge.ts";
import { unknownApplicability } from "../lib/method/portability.ts";

/** The date every synthetic fixture is stamped with. */
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
