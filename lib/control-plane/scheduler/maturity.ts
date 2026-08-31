/**
 * **IS THERE A GRADUATED METHOD FOR THIS ROUTE?**
 * (Session B, W3.4, 2026-08-30.)
 *
 * The dispatch rule is one line — *deterministic code where a graduated method
 * exists, a bounded model worker otherwise* — and it is only as good as its
 * answer to this question. A `startsWith("legistar:")` would be a rule about
 * string prefixes wearing a rule about knowledge, so the answer is read from
 * the method store, which is the project's own record of what it knows how to
 * walk.
 *
 * `data/method/knowledge.json` holds 122 routes at method version 61. A route
 * id present there is a route this project has learned; absent is absent.
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

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { MethodMaturity } from "./dispatch.ts";

/**
 * Every route id the method store holds, or an empty set when there is none.
 *
 * An unreadable store THROWS rather than returning empty: "we could not read
 * what we know" and "we know nothing" are different sentences, and a
 * dispatcher that read the second from the first would send every route to the
 * model worker on a parse error.
 */
export function knownRouteIds(root: string): ReadonlySet<string> {
  const path = join(root, "data", "method", "knowledge.json");
  if (!existsSync(path)) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `the method store at ${path} could not be read (${
        error instanceof Error ? error.message : String(error)
      }). This is a FAILED read and is raised rather than treated as an empty store — an empty ` +
        "store would send every route to the bounded worker, which is a decision nobody made.",
    );
  }
  const routes = (parsed as { routes?: { id?: unknown }[] }).routes ?? [];
  const ids = new Set<string>();
  for (const route of routes) {
    if (typeof route?.id === "string") ids.add(route.id);
  }
  return ids;
}

/** The dispatch rule's input, answered from the method store. */
export function methodMaturityFrom(root: string): MethodMaturity {
  const known = knownRouteIds(root);
  return (route) => (route !== null && known.has(route) ? "GRADUATED" : "UNGRADUATED");
}
