/**
 * **IS THERE A GRADUATED METHOD FOR THIS ROUTE?**
 * (Session B, W3.4, 2026-08-30.)
 *
 * The dispatch rule is one line — *deterministic code where a graduated method
 * exists, a bounded model worker otherwise* — and it is only as good as its
 * answer to this question. A `startsWith("legistar:")` would be a rule about
 * string prefixes wearing a rule about knowledge, so the answer is read from
 * the field manual, which is the project's own record of what it knows how to
 * walk. A route id present there as a learned route is a route this project
 * has learned; absent is absent.
 *
 * ## A finding this exposes, recorded rather than papered over
 *
 * The meeting corpus identifies a row's origin by `provenance.sourceOrg` — a
 * PUBLISHER ("Pima County") — and the method store identifies a route by a
 * method id ("party-county-directory"). **There is no mapping between them
 * today**, so every meetings obligation resolves UNGRADUATED and dispatches to
 * the bounded worker.
 *
 * That reading is correct and it is not the end state: it means the deterministic
 * lane is currently unreachable for this record class, because nothing joins a
 * publisher to the method that walks it. The digest shows the split, which is
 * how the gap becomes visible instead of being hidden behind a prefix test that
 * happened to answer GRADUATED.
 */

import { readFieldManual, type FieldManualRepos } from "../field-manual.ts";
import { learnedRouteIds } from "../../method/manual-bridge.ts";
import type { MethodMaturity } from "./dispatch.ts";

/**
 * The dispatch rule's input, answered from the FIELD MANUAL (the one store agents
 * read and write live). The manual holds every route the frozen method store held
 * plus every route an agent has written since as a `ROUTE` entry, so a route
 * learned by an agent graduates on the next dispatch with no human step.
 *
 * An unreadable manual, or one with no learned routes at all, THROWS. Either would send every route to
 * the bounded worker, which is a decision nobody made.
 */
export async function methodMaturityFromManual(repos: FieldManualRepos): Promise<MethodMaturity> {
  const read = await readFieldManual(repos);
  if (read.error !== undefined) {
    throw new Error(`the field manual could not be read (${read.error}). This is a FAILED read and is raised rather than treated as an empty manual.`);
  }
  const known = learnedRouteIds(read.store);
  if (known.size === 0) {
    throw new Error("the field manual holds no learned routes. An empty manual would send every route to the bounded worker.");
  }
  return (route) => (route !== null && known.has(route) ? "GRADUATED" : "UNGRADUATED");
}
