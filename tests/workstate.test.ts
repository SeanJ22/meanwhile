import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { ELIGIBLE_EDGE_VERSION, calibrate, classifyEdge } from "../lib/workstate/eligibility.ts";
import {
  accountCandidates,
  convergenceHolds,
  mayWalk,
  recordPermissionRead,
  type EntityCandidate,
  type PermissionRecord,
  type WorkEdge,
} from "../lib/workstate/types.ts";
import {
  account,
  completion,
  generateHandoff,
  validateWorkstream,
  type Workstream,
} from "../lib/workstate/workstream.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = { today: "2026-08-26", methodVersion: 7, eligibleEdgeVersion: ELIGIBLE_EDGE_VERSION };

function ws(over: Partial<Workstream> = {}): Workstream {
  return {
    id: "test",
    title: "test",
    openedOn: "2026-08-26",
    universe: { authority: "test authority", version: "v1", members: ["a"] },
    items: [{ id: "a", subject: "a", disposition: "INGESTED", children: [], updatedOn: "2026-08-26" }],
    edges: [],
    candidates: [],
    permissions: [],
    cursor: "a",
    unmaterialized: [],
    convergence: {
      convergedAsOf: "2026-08-26",
      methodVersion: 7,
      universeVersion: "v1",
      eligibleEdgeVersion: ELIGIBLE_EDGE_VERSION,
      freshnessDays: 14,
    },
    routesInherited: [],
    routesLearned: [],
    methodVersion: 7,
    ...over,
  };
}

/* ------------------------------------------- THE PERMISSION-IS-NOT-TRANSPORT TEST */

test("THE PERMISSION-IS-NOT-TRANSPORT TEST — client A fails, client B reads, no DISALLOWED is manufactured", () => {
  // Client A cannot retrieve robots.txt. This is the exact shape that cost the
  // descent session multiple hosts, including the tops of two state descents.
  const a = recordPermissionRead({
    host: "gc.nh.gov",
    transport: "TLS_CLIENT_MISMATCH",
    client: "node-fetch",
    checkedOn: "2026-08-26",
    failure: "TLS fingerprint refused before any bytes arrived",
    around: "the General Court's member data downloads",
  });
  assert.equal(a.permission, "CANNOT_TELL", "a transport failure is NEVER a permission verdict");
  assert.notEqual(a.permission, "DISALLOWED");

  const gateA = mayWalk(a);
  assert.equal(gateA.allowed, true, "an unread robots.txt is recorded and never blocks (owner decision 2026-09-25)");
  assert.equal(gateA.recheck, true, "and it stays on the recheck clock");
  assert.match(gateA.reason, /recorded as unread, and not blocking/);

  // Supplying a verdict for a document that was never retrieved is refused
  // outright, because the collapse is one line of plausible code.
  assert.throws(
    () =>
      recordPermissionRead({
        host: "gc.nh.gov",
        transport: "TIMEOUT",
        client: "curl",
        checkedOn: "2026-08-26",
        verdictFromDocument: "DISALLOWED",
      }),
    /was not retrieved cannot have been read/,
  );

  // Client B — a different client, per rung 4 — actually reads it.
  const b = recordPermissionRead({
    host: "gc.nh.gov",
    transport: "REACHABLE",
    client: "curl",
    checkedOn: "2026-08-26",
    rung: 4,
    verdictFromDocument: "ALLOWED",
  });
  assert.equal(b.permission, "ALLOWED");
  assert.equal(mayWalk(b).allowed, true, "escalating the client recovered the host");

  // A genuine disallow is still a different RECORD from an unread one, and
  // neither blocks: robots.txt is recorded, not blocking (owner decision 2026-09-25).
  const disallowed = recordPermissionRead({
    host: "search.example",
    transport: "REACHABLE",
    client: "curl",
    checkedOn: "2026-08-26",
    verdictFromDocument: "DISALLOWED",
  });
  assert.equal(disallowed.permission, "DISALLOWED", "the disallow is recorded as read");
  assert.equal(mayWalk(disallowed).allowed, true, "and does not block the walk");
  assert.match(mayWalk(disallowed).reason, /recorded, and not blocking/);

  // What does block is an access control: a challenge in front of the rules is a wall, never bypassed.
  const challenged = recordPermissionRead({ host: "waf.example", transport: "CHALLENGED", client: "node-fetch", checkedOn: "2026-09-25", failure: "Cloudflare managed challenge" });
  assert.equal(mayWalk(challenged).allowed, false, "a challenge is an access control");
  assert.match(mayWalk(challenged).reason, /never bypassed/);
});

test("a workstream recording a permission verdict without a successful read fails validation", () => {
  const w = ws({
    permissions: [
      {
        host: "h",
        permission: "DISALLOWED",
        transport: "TIMEOUT",
        rung: null,
        client: "c",
        checkedOn: "2026-08-26",
        failure: "timed out",
      } as PermissionRecord,
    ],
  });
  assert.ok(validateWorkstream(w, NOW).some((i) => i.rule === "transport-became-permission"));
});

test("a robots read answered by a challenge (an access control) keeps the workstream OPEN and never reads as absence", () => {
  const w = ws({
    permissions: [
      recordPermissionRead({ host: "h", transport: "CHALLENGED", client: "c", checkedOn: "2026-08-26", failure: "captcha" }),
    ],
  });
  const v = completion(w, NOW);
  assert.equal(v.workstream, "OPEN");
  assert.ok(v.blockedBy.some((b) => /walling this client by an access control/.test(b)));
});

/* ------------------------------------------------------- THE LEAD-IS-NOT-A-BODY TEST */

test("THE LEAD-IS-NOT-A-BODY TEST — hundreds of candidates, zero promotions, numerator stays zero", () => {
  const candidates: EntityCandidate[] = Array.from({ length: 368 }, (_, i) => ({
    id: `c${i}`,
    state: "ENTITY_CANDIDATE",
    text: `link ${i}`,
    url: `https://example.gov/${i}`,
    fromEdge: `e${i}`,
    jurisdiction: "nj",
    tier: "county",
    discoveredOn: "2026-08-26",
  }));
  const acc = accountCandidates(candidates);
  assert.equal(acc.candidates, 368);
  assert.equal(acc.promoted, 0);
  assert.equal(acc.coverageNumerator, 0, "no candidate count may substitute for the promoted count");
});

test("a promoted body with no registry id is a lead, not a body", () => {
  const w = ws({
    candidates: [
      {
        id: "c1",
        state: "BODY_PROMOTED",
        text: "Board of Selectmen",
        url: "https://x.gov",
        fromEdge: "e1",
        jurisdiction: "nh",
        tier: "town",
        discoveredOn: "2026-08-26",
        evidence: "roster page confirms",
      },
    ],
  });
  assert.ok(validateWorkstream(w, NOW).some((i) => i.rule === "promoted-without-registry-id"));
});

test("a promotion with no evidence, and a rejection with no reason, both fail", () => {
  const base = {
    id: "c1",
    text: "t",
    url: "u",
    fromEdge: "e",
    jurisdiction: "nh",
    tier: "town",
    discoveredOn: "2026-08-26",
  };
  assert.ok(
    validateWorkstream(ws({ candidates: [{ ...base, state: "ENTITY_VERIFIED" } as EntityCandidate] }), NOW).some(
      (i) => i.rule === "promoted-without-evidence",
    ),
  );
  assert.ok(
    validateWorkstream(ws({ candidates: [{ ...base, state: "REJECTED_FALSE_POSITIVE" } as EntityCandidate] }), NOW).some(
      (i) => i.rule === "rejected-without-reason",
    ),
  );
});

test("the detector is CALIBRATED against known false positives, not merely non-zero output", () => {
  // Modelled on the classes the descent session actually found by opening its
  // own output: a job board producing 154 false candidates and a calendar view
  // producing 214. Non-zero output proved nothing about either.
  const labelled = [
    ...Array.from({ length: 154 }, (_, i) => ({
      text: `Apply now: Equipment Operator ${i} — Human Resources`,
      url: `https://county.gov/jobs/${i}`,
      isBody: false,
    })),
    ...Array.from({ length: 214 }, (_, i) => ({
      text: `« Previous  ${i}/12/2026  Next »`,
      url: `https://county.gov/calendar?d=${i}`,
      isBody: false,
    })),
    { text: "Board of County Commissioners", url: "https://county.gov/bocc", isBody: true },
    { text: "Zoning Board of Adjustment", url: "https://town.gov/zba", isBody: true },
    { text: "Ashuelot Pond Dam Precinct", url: "https://nh.gov/precinct", isBody: true },
  ];
  const c = calibrate(labelled);
  assert.equal(c.total, 371);
  assert.equal(c.falsePositivesAdmitted, 0, "the job board and calendar classes must be declined");
  assert.equal(c.truePositivesLost, 0, "and no real body may be lost to the filter");
  assert.ok(c.declinedByReason["not owed: job-board"] >= 154);
  assert.ok(c.declinedByReason["not owed: calendar-navigation"] >= 214);
});

test("a detector cannot pass on false positives alone", () => {
  const allNoise = Array.from({ length: 500 }, (_, i) => ({
    text: `Careers — apply now ${i}`,
    url: `https://x.gov/jobs/${i}`,
    isBody: false,
  }));
  const c = calibrate(allNoise);
  assert.equal(c.eligible, 0, "a threshold must not be satisfiable entirely with known false positives");
});

/* --------------------------------------------------------- eligible edges bound it */

test("an eligible edge advances an owed question; site chrome does not enlarge the graph", () => {
  assert.equal(classifyEdge({ text: "Planning Board", url: "https://t.gov/pb" }).eligible, true);
  assert.equal(classifyEdge({ text: "Meeting Agendas", url: "https://t.gov/agendas" }).eligible, true);

  const chrome = classifyEdge({ text: "Skip to main content", url: "https://t.gov/#main" });
  assert.equal(chrome.eligible, false);
  assert.ok(chrome.reason.length > 0, "a decline always names its reason");

  const offTopic = classifyEdge({ text: "Weather forecast", url: "https://weather.example/" });
  assert.equal(offTopic.eligible, false, "a government page does not make every hyperlink owed");
});

test("an ineligible edge must say why it does not enlarge the graph", () => {
  const w = ws({
    edges: [
      {
        id: "e1",
        url: "u",
        text: "t",
        parent: null,
        state: "nh",
        tier: "town",
        level: "town",
        disposition: "DISCOVERED",
        discoveredOn: "2026-08-26",
        eligible: false,
      } as WorkEdge,
    ],
  });
  assert.ok(validateWorkstream(w, NOW).some((i) => i.rule === "ineligible-without-reason"));
});

/* ------------------------------------------------ completion is derived, not typed */

test("an item may not be terminal while a required child is open", () => {
  const w = ws({
    universe: { authority: "t", version: "v1", members: ["parent", "child"] },
    items: [
      { id: "parent", subject: "parent", disposition: "INGESTED", children: ["child"], updatedOn: "2026-08-26" },
      { id: "child", subject: "child", disposition: "IN_PROGRESS", children: [], updatedOn: "2026-08-26" },
    ],
  });
  assert.ok(validateWorkstream(w, NOW).some((i) => i.rule === "complete-with-open-child"));
  assert.equal(completion(w, NOW).workstream, "OPEN");
});

test("a required child may not disappear", () => {
  const w = ws({
    items: [{ id: "a", subject: "a", disposition: "INGESTED", children: ["ghost"], updatedOn: "2026-08-26" }],
  });
  assert.ok(validateWorkstream(w, NOW).some((i) => i.rule === "missing-child"));
});

test("a BLOCKED route keeps the workstream OPEN and is never an absence", () => {
  const w = ws({
    universe: { authority: "t", version: "v1", members: ["a"] },
    items: [
      {
        id: "a",
        subject: "a",
        disposition: "BLOCKED_CURRENTLY",
        children: [],
        updatedOn: "2026-08-26",
        blockerReason: "captcha wall around the clerk's minutes portal",
      },
    ],
  });
  const v = completion(w, NOW);
  assert.equal(v.workstream, "OPEN");
  assert.ok(v.blockedBy.some((b) => /blocked route is never a factual absence/.test(b)));
});

test("an unnamed blocker, and an undated recheck, are refused", () => {
  assert.ok(
    validateWorkstream(
      ws({ items: [{ id: "a", subject: "a", disposition: "BLOCKED_CURRENTLY", children: [], updatedOn: "2026-08-26" }] }),
      NOW,
    ).some((i) => i.rule === "unnamed-blocker"),
  );
  assert.ok(
    validateWorkstream(
      ws({ items: [{ id: "a", subject: "a", disposition: "RECHECK_DUE", children: [], updatedOn: "2026-08-26" }] }),
      NOW,
    ).some((i) => i.rule === "recheck-undated"),
  );
});

test("every universe member gets exactly one disposition", () => {
  const w = ws({
    universe: { authority: "t", version: "v1", members: ["a", "b", "c"] },
    items: [
      { id: "a", subject: "a", disposition: "INGESTED", children: [], updatedOn: "2026-08-26" },
      { id: "a2", subject: "a", disposition: "INGESTED", children: [], updatedOn: "2026-08-26" },
    ],
  });
  const acc = account(w);
  assert.deepEqual(acc.unaccounted, ["b", "c"]);
  assert.deepEqual(acc.doubleAccounted, ["a"]);
  const v = completion(w, NOW);
  assert.equal(v.workstream, "OPEN");
  assert.ok(v.blockedBy.some((b) => /have no disposition/.test(b)));
});

test("a fully accounted workstream with a holding convergence IS complete", () => {
  const v = completion(ws(), NOW);
  assert.deepEqual(v.blockedBy, []);
  assert.equal(v.workstream, "COMPLETE_AS_OF");
  assert.equal(v.graph, "CONVERGED_AS_OF");
  assert.equal(v.methodVersion, 7, "completion is stamped with the method version it was earned under");
});

/* ------------------------------------------------------------- convergence reopens */

test("convergence reopens on a newer method version, a changed universe, or expired freshness", () => {
  const c = {
    convergedAsOf: "2026-08-01",
    methodVersion: 7,
    universeVersion: "v1",
    eligibleEdgeVersion: ELIGIBLE_EDGE_VERSION,
    freshnessDays: 14,
  };
  const base = { methodVersion: 7, universeVersion: "v1", eligibleEdgeVersion: ELIGIBLE_EDGE_VERSION, today: "2026-08-05" };

  assert.equal(convergenceHolds(c, base).status, "CONVERGED_AS_OF");

  assert.equal(convergenceHolds(c, { ...base, methodVersion: 8 }).status, "EXPANDING");
  assert.match(convergenceHolds(c, { ...base, methodVersion: 8 }).reopenedBy[0], /never walked here/);

  assert.equal(convergenceHolds(c, { ...base, universeVersion: "v2" }).status, "EXPANDING");
  assert.equal(convergenceHolds(c, { ...base, eligibleEdgeVersion: "ee-v2" }).status, "EXPANDING");
  assert.equal(convergenceHolds(c, { ...base, today: "2026-09-01" }).status, "EXPANDING");
});

test("a workstream with no convergence record is EXPANDING, never quietly converged", () => {
  const v = completion(ws({ convergence: null }), NOW);
  assert.equal(v.graph, "EXPANDING");
  assert.ok(v.blockedBy.some((b) => /never been declared converged/.test(b)));
});

/* ---------------------------------------------------- the frontier and the handoff */

test("THE EXACT-FRONTIER TEST — an OPEN workstream without a cursor is a defect", () => {
  const w = ws({
    universe: { authority: "t", version: "v1", members: ["a"] },
    items: [{ id: "a", subject: "a", disposition: "IN_PROGRESS", children: [], updatedOn: "2026-08-26" }],
    cursor: null,
  });
  assert.ok(validateWorkstream(w, NOW).some((i) => i.rule === "lost-cursor"));
});

test("every persisted edge carries a stable id, provenance and a disposition", () => {
  const dup: WorkEdge = {
    id: "e1",
    url: "u",
    text: "t",
    parent: "seed",
    state: "nh",
    tier: "town",
    level: "town",
    disposition: "DISCOVERED",
    discoveredOn: "2026-08-26",
    eligible: true,
  };
  assert.ok(validateWorkstream(ws({ edges: [dup, { ...dup }] }), NOW).some((i) => i.rule === "duplicate-edge-id"));
});

test("the handoff is generated from state and omits no tail", () => {
  const w = ws({
    universe: { authority: "t", version: "v1", members: ["a", "b"] },
    items: [
      { id: "a", subject: "a", disposition: "IN_PROGRESS", children: [], updatedOn: "2026-08-26" },
      {
        id: "b",
        subject: "b",
        disposition: "RECORDS_REQUEST_PENDING",
        children: [],
        updatedOn: "2026-08-26",
        blockerReason: "records request filed 2026-08-20, no response",
      },
    ],
  });
  const h = generateHandoff(w, NOW, "EARLY_HANDOFF");
  assert.equal(h.session, "EARLY_HANDOFF");
  assert.equal(h.workstream, "OPEN");
  assert.equal(h.open.length, 2, "every open child appears — no sampling, no top-N");
  assert.equal(h.blocked.length, 1);
  assert.ok(h.blockedBy.length > 0, "and it says WHY it is not complete");
  assert.equal(h.resumeCursor, "a");
});

/* --------------------------------------------------- the migrated descent workstream */

test("THE HANDOFF MIGRATION TEST — the descent migrates as EARLY_HANDOFF / OPEN / EXPANDING", () => {
  const dir = join(ROOT, "data", "workstate");
  if (!existsSync(dir)) return;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "migration-summary.json");
  assert.ok(files.length >= 3, "nj, az and nh must all have migrated");

  for (const f of files) {
    const w = JSON.parse(readFileSync(join(dir, f), "utf8")) as Workstream;
    const now = { today: "2026-08-26", methodVersion: 0, eligibleEdgeVersion: ELIGIBLE_EDGE_VERSION };
    const h = generateHandoff(w, now, "EARLY_HANDOFF");

    // Amended 2026-08-27. The preceding descent session preserved its state
    // well AND stopped while executable brief items remained, with neither an
    // author stop nor an external condition. Those are two independent facts,
    // and the earliest three-state model could only express the first. Its
    // persistence quality stays a positive fact; it does not make the stopping
    // decision correct.
    assert.equal(h.session, "EARLY_HANDOFF", `${f}: preservation quality is not permission to stop`);
    assert.equal(h.workstream, "OPEN", `${f}: the workstream remains open`);
    assert.equal(h.graph, "EXPANDING", `${f}: the graph is still expanding`);

    /*
     * THE INVARIANT IS THAT A LEAD IS NOT A BODY — never that there are no
     * bodies.
     *
     * This read `promoted === 0` and `coverageNumerator === 0` when it was
     * written, because at that moment nothing in the repository could perform
     * the promotion transition and zero was the honest measurement. The
     * descent-resume session built that path and promoted 667 bodies across
     * the three states, every one of them from a page that was fetched and a
     * control that held.
     *
     * Pinning the zero would have made the guard fire on the first session
     * that did the work it was guarding — so what is pinned instead is the
     * relationship RULING 183 actually cares about: the coverage numerator is
     * the promoted count and NOTHING else, promoted bodies never exceed the
     * leads they came from, and a promoted row always carries the registry id
     * that makes it a body rather than a label.
     */
    assert.ok(h.candidates.candidates > 0, `${f}: the leads are all persisted`);
    assert.equal(
      h.candidates.coverageNumerator,
      h.candidates.promoted,
      `${f}: the coverage numerator is the promoted count and nothing else`,
    );
    assert.ok(
      h.candidates.promoted <= h.candidates.candidates,
      `${f}: more bodies than leads means something was counted twice`,
    );
    for (const c of w.candidates) {
      if (c.state === "BODY_PROMOTED") {
        assert.ok(c.bodyId, `${f}: ${c.id} is promoted with no registry id — that is a lead`);
        assert.ok(c.evidence, `${f}: ${c.id} is promoted with no evidence`);
      }
    }

    // The remainder is explicit rather than implicit.
    assert.ok(h.resumeCursor, `${f}: an exact cursor exists`);
    assert.ok(h.blocked.length > 0, `${f}: the unrecoverable legacy frontier is a NAMED blocker`);
    assert.match(
      h.blocked.map((b) => b.reason).join(" "),
      /never persisted/,
      `${f}: and it says the legacy format never wrote the edges down`,
    );
    assert.deepEqual(validateWorkstream(w, now), [], `${f}: the migrated workstream must validate`);
  }
});

test("the migrated frontier does not need seeds to name what it already knows", () => {
  const p = join(ROOT, "data", "workstate", "nj.json");
  if (!existsSync(p)) return;
  const w = JSON.parse(readFileSync(p, "utf8")) as Workstream;
  assert.ok(w.edges.length > 100, "edges are persisted individually, not as a count");
  for (const e of w.edges.slice(0, 50)) {
    assert.ok(e.id, "every edge has a stable id");
    assert.ok(e.parent !== undefined, "every edge names where it came from");
    assert.ok(e.disposition, "every discovered source has a disposition");
  }
});

/* ============================================================== */
/* THE AGGREGATE-TAIL GUARD                                        */
/* ============================================================== */

/**
 * The 3,900-versus-1,614 accounting.
 *
 * Two different populations. **1,614** eligible edges are persisted and
 * resumable — real, addressable, individually named on disk. **3,900** edges
 * the legacy final pass queued, of which only the COUNT survived.
 *
 * Adding them claims 3,900 addresses the repository does not have. Reporting
 * only 1,614 discards work a previous session genuinely did. Both are refused.
 */

test("an unmaterialized obligation is counted, never resumable, and never complete", () => {
  const w = ws({
    unmaterialized: [
      {
        id: "nj:final-pass-tail",
        count: 1986,
        source: "states/nj/descent.json finalPassNewLinks",
        why: "the legacy descent persisted counts and no edges",
        discharge: "re-walk nj from the persisted frontier",
        recordedOn: "2026-08-26",
      },
    ],
  });

  // It holds the workstream OPEN even when everything else is terminal.
  const v = completion(w, NOW);
  assert.equal(v.workstream, "OPEN");
  assert.ok(v.blockedBy.some((b) => /unmaterialized obligation/.test(b)));

  // And it does NOT join the resumable edge count.
  const h = generateHandoff(w, NOW, "EARLY_HANDOFF");
  assert.equal(h.discoveredNotProcessed.length, 0, "an obligation has no addresses to resume");
  assert.equal(h.unmaterialized.outstanding, 1986);
  assert.match(h.unmaterialized.detail[0], /OPEN; discharge by:/);
});

test("the aggregate tail across all three states is 3,900 and is reported apart", () => {
  const dir = join(ROOT, "data", "workstate");
  if (!existsSync(dir)) return;
  const expected: Record<string, number> = { nj: 1986, az: 1143, nh: 771 };
  let tail = 0;
  let resumable = 0;
  for (const [state, count] of Object.entries(expected)) {
    const p = join(dir, `${state}.json`);
    if (!existsSync(p)) continue;
    const w = JSON.parse(readFileSync(p, "utf8")) as Workstream;
    const h = generateHandoff(
      w,
      { today: "2026-08-26", methodVersion: 0, eligibleEdgeVersion: ELIGIBLE_EDGE_VERSION },
      "EARLY_HANDOFF",
    );
    assert.equal(h.unmaterialized.outstanding, count, `${state}: the historical count is preserved exactly`);
    tail += h.unmaterialized.outstanding;
    resumable += h.discoveredNotProcessed.length;
  }
  assert.equal(tail, 3900, "every historical obligation is preserved, to the edge");

  /*
   * THE RESUMABLE COUNT IS A FLOOR, NOT A CONSTANT.
   *
   * This read `assert.equal(resumable, 1614)` — the number the migration
   * measured — and it began failing the first time a session DISCOVERED
   * something: the descent-resume session walked Morris County's own boards
   * directory on 2026-08-26 and persisted 24 new edges, which is the frontier
   * doing exactly what RULING 181 built it to do.
   *
   * What that ruling actually protects is that the frontier is never REBUILT
   * from seeds, and a rebuild shows up as the count FALLING. So the floor is
   * asserted and growth is allowed. The historical tail above stays an
   * equality, because that number may not move without a recovery walk
   * accounting for it.
   */
  assert.ok(
    resumable >= 1614,
    `the resumable frontier fell from 1,614 to ${resumable} — a frontier was rebuilt from seeds rather than resumed`,
  );
  assert.ok(resumable > 0, "and it is the real, addressable count");
  assert.notEqual(tail + resumable, resumable, "the two are never collapsed into one number");
});

test("an obligation may not be silently dropped, discharged without a count, or double-counted", () => {
  const base = {
    id: "x:tail",
    count: 100,
    source: "s",
    why: "w",
    discharge: "d",
    recordedOn: "2026-08-26",
  };

  // Every field is required, because a count with no addresses cannot defend
  // itself — nothing downstream would notice it vanishing.
  for (const [field, broken] of [
    ["obligation-without-count", { ...base, count: 0 }],
    ["obligation-without-source", { ...base, source: "" }],
    ["obligation-without-cause", { ...base, why: "" }],
    ["obligation-without-discharge", { ...base, discharge: "" }],
  ] as const) {
    const issues = validateWorkstream(ws({ unmaterialized: [broken] }), NOW);
    assert.ok(issues.some((i) => i.rule === field), `expected ${field}`);
  }

  // A discharge that does not say how many real edges it produced is a tail
  // decided away rather than recovered.
  assert.ok(
    validateWorkstream(
      ws({ unmaterialized: [{ ...base, dischargedOn: "2026-09-01" }] }),
      NOW,
    ).some((i) => i.rule === "discharge-without-count"),
  );

  // A legitimate discharge passes, and stops holding the workstream open.
  const discharged = ws({
    unmaterialized: [{ ...base, dischargedOn: "2026-09-01", dischargedCount: 97 }],
  });
  assert.deepEqual(validateWorkstream(discharged, NOW), []);
  assert.ok(
    !completion(discharged, NOW).blockedBy.some((b) => /unmaterialized/.test(b)),
    "a discharged obligation stops blocking",
  );
});
