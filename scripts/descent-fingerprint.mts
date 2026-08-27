/**
 * `pnpm descent:fingerprint` — a measured snapshot of canonical descent and
 * method state.
 *
 * Written for the post-remediation hotfix of 2026-08-26, whose scope explicitly
 * forbids advancing the descent. A hotfix that "improved" the edge counts would
 * have walked something, and the only way to prove it did not is to measure
 * before and after and compare.
 *
 * It reads. It writes nothing but its own output file.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DESCENT_STATES, loadMethodStore, loadWorkstreamFor } from "../lib/workstate/load.ts";
import { aggregateTail, OPEN_DISPOSITIONS } from "../lib/workstate/types.ts";
import { floored } from "../lib/ops/denominator-floor.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface StateFingerprint {
  edges: number;
  outstanding: number;
  /** Digest over every edge id + disposition, in id order. Identity, not size. */
  edgeDigest: string;
  cursor: string | null;
  candidates: number;
  promoted: number;
  permissions: number;
  unmaterialized: number;
  items: number;
}

export interface Fingerprint {
  states: Record<string, StateFingerprint>;
  totals: { edges: number; outstanding: number; candidates: number; promoted: number; unmaterialized: number };
  method: { version: number; routes: number; outcomes: number; byPortability: Record<string, number> };
}

export function fingerprint(root: string = ROOT): Fingerprint {
  const states: Record<string, StateFingerprint> = {};
  const totals = { edges: 0, outstanding: 0, candidates: 0, promoted: 0, unmaterialized: 0 };

  for (const s of DESCENT_STATES) {
    const w = loadWorkstreamFor(root, s);
    if (!w) continue;
    const outstanding = w.edges.filter(
      (e) => e.eligible && OPEN_DISPOSITIONS.includes(e.disposition),
    ).length;
    // IDENTITY, not just count: two runs with the same totals but different
    // edges would be a mutation a count alone cannot see.
    const edgeDigest = createHash("sha256")
      .update(
        [...w.edges]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((e) => `${e.id}:${e.disposition}:${e.eligible ? 1 : 0}`)
          .join("|"),
        "utf8",
      )
      .digest("hex")
      .slice(0, 16);

    const f: StateFingerprint = {
      edges: w.edges.length,
      outstanding,
      edgeDigest,
      cursor: w.cursor,
      candidates: w.candidates.length,
      promoted: w.candidates.filter((c) => c.state === "BODY_PROMOTED").length,
      permissions: w.permissions.length,
      unmaterialized: aggregateTail(w.unmaterialized ?? []).outstandingCount,
      items: w.items.length,
    };
    states[s] = f;
    totals.edges += f.edges;
    totals.outstanding += f.outstanding;
    totals.candidates += f.candidates;
    totals.promoted += f.promoted;
    totals.unmaterialized += f.unmaterialized;
  }

  const k = loadMethodStore(root);
  const byPortability: Record<string, number> = {};
  for (const r of k?.routes ?? []) {
    byPortability[r.applicability.portability] = (byPortability[r.applicability.portability] ?? 0) + 1;
  }

  return {
    states,
    totals,
    method: {
      version: k?.version ?? 0,
      routes: k?.routes.length ?? 0,
      outcomes: (k?.routes ?? []).reduce((n, r) => n + r.outcomes.length, 0),
      byPortability,
    },
  };
}

// The index is checked before it is used. `indexOf` returns -1 when the flag is
// absent, and `argv[-1 + 1]` is `argv[0]` — the node executable — so the
// unflagged form tried to overwrite `node.exe` and died on EPERM. A one-line
// off-by-one that only shows up on the path nobody passes a flag to.
const outAt = process.argv.indexOf("--out");
const out = outAt >= 0 ? process.argv[outAt + 1] : undefined;
const fp = fingerprint(ROOT);

// RULING 159 — a fingerprint of zero states is a broken read, never an empty
// desk, and it would compare equal to any other empty read.
floored("fingerprint states", "data/workstate/*.json", DESCENT_STATES.length, Object.keys(fp.states).length);

if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(fp, null, 2) + "\n", "utf8");
  console.log(`wrote ${out}`);
}

for (const [s, f] of Object.entries(fp.states)) {
  console.log(
    `${s}: ${f.edges} edges (${f.outstanding} outstanding) digest ${f.edgeDigest} · ` +
      `${f.candidates} leads / ${f.promoted} promoted · ${f.unmaterialized} unmaterialized · ${f.permissions} permission record(s)`,
  );
}
console.log(
  `TOTALS ${fp.totals.edges} edges · ${fp.totals.outstanding} outstanding · ` +
    `${fp.totals.candidates} leads · ${fp.totals.promoted} promoted · ${fp.totals.unmaterialized} unmaterialized`,
);
console.log(
  `METHOD v${fp.method.version} · ${fp.method.routes} routes · ${fp.method.outcomes} recorded outcome(s) · ${JSON.stringify(fp.method.byPortability)}`,
);
