import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "./read-code.ts";
import {
  DISPOSITIONS,
  PERMISSION_STATES,
  TERMINAL_DISPOSITIONS,
  TRANSPORT_STATES,
} from "../lib/workstate/types.ts";

/**
 * **THE NEW HAMPSHIRE ROUTE FRONTIER, GUARDED AS A HANDOFF.** (Session C,
 * 2026-08-31, Part F.)
 *
 * `data/hunt/nh-remaining-routes.json` exists to be READ BY ANOTHER LANE and
 * turned into autonomous obligations. That makes it a handoff, and a handoff
 * that drifts from the vocabularies the rest of the system enforces is a
 * handoff that registers obligations nothing can adjudicate.
 *
 * So the guards here are about SAFETY and SHAPE, and two of them are about the
 * things this repository has actually got wrong before:
 *
 * - **A stated count must equal the rows it counts.** A denominator written by
 *   hand beside a list is a denominator that will disagree with the list.
 * - **A blocked or unwalked route may never wear a finished face.** RULING 184
 *   and the `TERMINAL_DISPOSITIONS` split: counting a blocker as done is
 *   precisely how a blocker becomes a reported absence.
 */

const FILE = join(ROOT, "data", "hunt", "nh-remaining-routes.json");

interface RouteDescriptor {
  routeId: string;
  domain: string;
  host: string;
  entryUrl: string;
  method: string;
  accessMechanism: string;
  recordClass: string;
  permission: string;
  transport: string;
  disposition: string;
  whyItMatters: string;
  sourceOfRecord?: string;
  blocker?: string;
  permissionBasis?: string;
}

interface Frontier {
  formatVersion: number;
  recordedAt: string;
  jurisdiction: string;
  denominators: {
    routesDescribed: number;
    ofWhichMoneyDomain: number;
    namedBlockers: number;
    ofWhichGenuinelyExternal: number;
  };
  permissionMeasurements: {
    url: string;
    readAt: string;
    transport: string;
    http: number | null;
    finding: string;
  }[];
  routes: RouteDescriptor[];
  namedBlockers: { blockerId: string; route: string; isExternal: boolean; precisely: string }[];
  notRoutes: { id: string; why: string }[];
}

function frontier(): Frontier {
  return JSON.parse(readFileSync(FILE, "utf8")) as Frontier;
}

test("the NH route frontier is the shape another lane can register from", () => {
  const f = frontier();
  assert.equal(f.formatVersion, 1);
  assert.equal(f.jurisdiction, "NH");
  assert.match(f.recordedAt, /^\d{4}-\d{2}-\d{2}$/, "every date comes from pnpm stamp");
  assert.ok(f.routes.length > 0, "a frontier describing no route is a failed enumeration");

  const ids = new Set<string>();
  for (const r of f.routes) {
    assert.ok(r.routeId, "every route is named");
    assert.equal(ids.has(r.routeId), false, `${r.routeId} appears twice`);
    ids.add(r.routeId);
    for (const field of ["host", "entryUrl", "method", "recordClass", "accessMechanism", "whyItMatters"] as const) {
      assert.ok(r[field], `${r.routeId}: ${field} is required — an unnamed route cannot become an obligation`);
    }
  }
});

test("every route speaks the vocabularies the rest of the system enforces", () => {
  for (const r of frontier().routes) {
    assert.ok(
      (DISPOSITIONS as readonly string[]).includes(r.disposition),
      `${r.routeId}: disposition "${r.disposition}" is not in lib/workstate/types.ts DISPOSITIONS`,
    );
    assert.ok(
      (PERMISSION_STATES as readonly string[]).includes(r.permission),
      `${r.routeId}: permission "${r.permission}" is not in PERMISSION_STATES`,
    );
    assert.ok(
      (TRANSPORT_STATES as readonly string[]).includes(r.transport),
      `${r.routeId}: transport "${r.transport}" is not in TRANSPORT_STATES`,
    );
  }
});

test("no unworked route wears a finished face, and no permission is asserted without a basis", () => {
  for (const r of frontier().routes) {
    /*
     * RULING 184 and the TERMINAL_DISPOSITIONS split. This file describes what
     * has NOT been done; a terminal disposition here would tell the lane that
     * imports it that the obligation is closed, which is how a blocker becomes
     * a reported absence.
     */
    assert.equal(
      TERMINAL_DISPOSITIONS.includes(r.disposition as (typeof TERMINAL_DISPOSITIONS)[number]),
      false,
      `${r.routeId}: "${r.disposition}" is terminal, and nothing in a frontier file is finished`,
    );
    /*
     * RULING 182: permission and transport are orthogonal. ALLOWED is a claim
     * about a rule somebody published, so it needs the document it was read
     * from. DISALLOWED would need one even more, which is why nothing here
     * carries it without a basis either.
     */
    if (r.permission === "ALLOWED" || r.permission === "DISALLOWED") {
      assert.ok(
        r.permissionBasis && r.permissionBasis.length > 20,
        `${r.routeId}: permission "${r.permission}" states no basis — a permission verdict needs the document it was read from`,
      );
    }
  }
});

test("every stated count equals the rows it counts", () => {
  const f = frontier();
  assert.equal(
    f.denominators.routesDescribed,
    f.routes.length,
    "the stated route count and the route list disagree",
  );
  assert.equal(
    f.denominators.ofWhichMoneyDomain,
    f.routes.filter((r) => r.domain === "MONEY").length,
    "the stated money-domain count and the money-domain rows disagree",
  );
  assert.equal(
    f.denominators.namedBlockers,
    f.namedBlockers.length,
    "the stated blocker count and the blocker list disagree",
  );
  assert.equal(
    f.denominators.ofWhichGenuinelyExternal,
    f.namedBlockers.filter((b) => b.isExternal).length,
    "the stated external-blocker count and the blockers marked external disagree — our own tooling gap is not an external control",
  );
  // A blocker must name a route that exists, or it blocks nothing.
  const ids = new Set(f.routes.map((r) => r.routeId));
  for (const b of f.namedBlockers) {
    assert.ok(ids.has(b.route), `blocker ${b.blockerId} names route ${b.route}, which is not in this file`);
    assert.ok(b.precisely.length > 40, `blocker ${b.blockerId} is not stated precisely`);
  }
  // And a route that names a blocker must have one.
  const blockerIds = new Set(f.namedBlockers.map((b) => b.blockerId));
  for (const r of f.routes) {
    if (r.blocker) {
      assert.ok(blockerIds.has(r.blocker), `${r.routeId} names blocker ${r.blocker}, which is not defined`);
    }
  }
});

test("a permission measurement records what it measured, and never a verdict it did not read", () => {
  const f = frontier();
  assert.ok(f.permissionMeasurements.length > 0, "a permission claim with no measurement behind it is an assertion");
  for (const m of f.permissionMeasurements) {
    assert.match(m.url, /^https:\/\//, "a measurement names the exact document it read");
    assert.match(m.readAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(
      (TRANSPORT_STATES as readonly string[]).includes(m.transport),
      `${m.url}: transport "${m.transport}" is not in TRANSPORT_STATES`,
    );
    /*
     * THE COLLAPSE THIS FILE MUST NOT MAKE. A measurement that did not reach
     * the document may not read as a rule. "Disallow" may appear in a finding
     * only when something was actually retrieved.
     */
    if (m.transport !== "REACHABLE") {
      assert.doesNotMatch(
        m.finding,
        /\bdisallow(s|ed)?\b/i,
        `${m.url}: the document was not retrieved, so the finding may not speak of a rule (RULING 182)`,
      );
    }
  }
});

test("nothing in the frontier file is a credential", () => {
  /*
   * The General Court publishes a read-only account for public use in a public
   * PDF. It is recorded ONCE, in states/nh/sources.md, and a credential is not
   * copied into a second place — CLAUDE.md, and RULING 208's last line.
   */
  const raw = readFileSync(FILE, "utf8");
  for (const shape of [/password\s*[:=]/i, /\bpwd\s*[:=]/i, /publicuser/i, /PublicAccess/, /api[_-]?key\s*[:=]/i]) {
    assert.doesNotMatch(raw, shape, `the frontier file carries something credential-shaped: ${shape}`);
  }
});
