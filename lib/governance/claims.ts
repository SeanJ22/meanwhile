/**
 * Semantic claims — the rule slots that may hold exactly one active value.
 *
 * ## Why a text sweep cannot do this job
 *
 * Two paragraphs of `CLAUDE.md` say:
 *
 *   "Every session ends by running `pnpm walk:all` against production."
 *   "Every walk, every screenshot and every card check runs against a local
 *    production build. `walk:all` loses its production mode entirely."
 *
 * They contradict absolutely. They share almost no words. Both are bolded, both
 * carry an adoption stamp, and both read as law. **No amount of grepping finds
 * that**, which is RULING 110's wrong-form search: the sweep looks for the
 * letters rather than the shape, and a contradiction has no letters of its own.
 *
 * A semantic key is a NAMED SLOT. `verification.target` can hold `production`
 * or `local-production-build`, and the moment two ACTIVE records claim
 * different values for it the validator fails by name. The conflict stops being
 * something a session might notice and becomes something the build refuses.
 *
 * ## The keys are declared, not discovered
 *
 * A key exists because somebody named a rule slot worth protecting. The list
 * grows; it is never complete, and a contradiction in an undeclared slot is
 * still a contradiction. That is stated rather than hidden — this instrument
 * catches what it has been pointed at, exactly like every other sweep here.
 */

import type { GovernanceRecord, SemanticClaim } from "./schema.ts";
import { CURRENT_STATUSES } from "./schema.ts";

export interface ClaimKeyDef {
  key: string;
  question: string;
  /** The values this slot is allowed to hold. An unlisted value fails. */
  values: readonly string[];
}

/**
 * The declared rule slots.
 *
 * Each one is a question a session has to answer correctly to work, and each
 * one had two simultaneously-live answers in the legacy documents.
 */
export const CLAIM_KEYS: readonly ClaimKeyDef[] = [
  {
    key: "verification.target",
    question: "What does a session verify a change against?",
    values: ["production", "local-production-build"],
  },
  {
    key: "shipping.closeout_path",
    question: "How does a close-out record reach `main`?",
    values: ["separate-unpushed-commits", "gated-closeout-command", "no-separate-push"],
  },
  {
    key: "discovery.absence_standard",
    question: "What earns a recorded absence?",
    values: [
      "two-independent-branches",
      "named-manifest-exhausted",
      "argued-never-counted",
    ],
  },
  {
    key: "discovery.completion_model",
    question: "What makes a discovery workstream complete?",
    values: ["attempt-count", "checklist-end", "bounded-universe-versioned-convergence"],
  },
  {
    key: "discovery.method_growth",
    question: "Is the route manifest ever final?",
    values: ["final", "living-versioned-never-final"],
  },
  {
    key: "rulings.id_namespace",
    question: "Are ruling numbers global or per-brief?",
    values: ["per-brief", "global-immutable"],
  },
  {
    key: "refresh.cadence",
    question: "How often do scheduled refreshes run?",
    values: ["per-source-cron-daily", "orchestrated-daily-per-source-rate"],
  },
  {
    key: "tracker.needs_sean_closure",
    question: "Who may close a Needs Sean row?",
    values: ["author-only", "author-or-answering-ruling"],
  },
  {
    key: "discovery.source_order",
    question: "What is walked first inside Tier A?",
    values: ["tier-a-flat", "body-own-publication-first"],
  },
  {
    key: "governance.amendment_procedure",
    question: "How is a rule amended, and where does the amendment land?",
    values: ["dual-write-claude-and-rulings", "canonical-ledger-and-generated-views"],
  },
  {
    key: "session.stop_standard",
    question: "What legitimately ends a session?",
    values: ["measured-context-threshold", "work-author-or-external-condition"],
  },
  {
    key: "permission.transport_collapse",
    question: "Is a failure to retrieve a permission document a permission verdict?",
    values: ["collapses-to-disallowed", "orthogonal-cannot-tell"],
  },
  {
    key: "session.orchestration_model",
    question: "How does a session run two or more independent authorized workstreams?",
    values: ["serial-single-developer", "independent-work-parallel-by-default"],
  },
  {
    key: "shipping.integration_model",
    question: "Where does parallel work come back together, and what ships?",
    values: ["per-workstream-merge-to-main", "one-owner-combined-head"],
  },
] as const;

const KEY_INDEX = new Map(CLAIM_KEYS.map((k) => [k.key, k]));

export interface ClaimConflict {
  key: string;
  question: string;
  holders: Array<{ id: string; value: string; title: string }>;
}

export interface ClaimIssue {
  id: string;
  rule: string;
  detail: string;
}

/**
 * Two ACTIVE records claiming different values for one key is a contradiction.
 *
 * Records that are SUPERSEDED or HISTORICAL are deliberately excluded: the
 * whole point of the status model is that yesterday's answer stops competing
 * with today's the moment it is marked as retired. That is why the same two
 * `verification.target` paragraphs can both stay in the repository — one of
 * them is history now, and history explains rather than overrides.
 */
export function findClaimConflicts(records: GovernanceRecord[]): ClaimConflict[] {
  const active = records.filter((r) => CURRENT_STATUSES.includes(r.status));
  const byKey = new Map<string, Array<{ id: string; value: string; title: string }>>();
  for (const r of active) {
    for (const c of r.claims) {
      const list = byKey.get(c.key) ?? [];
      list.push({ id: r.id, value: c.value, title: r.title });
      byKey.set(c.key, list);
    }
  }
  const out: ClaimConflict[] = [];
  for (const [key, holders] of byKey) {
    const distinct = new Set(holders.map((h) => h.value));
    if (distinct.size > 1) {
      out.push({
        key,
        question: KEY_INDEX.get(key)?.question ?? "(undeclared key)",
        holders,
      });
    }
  }
  return out;
}

/** A claim on an undeclared key, or holding a value the key does not allow. */
export function validateClaims(records: GovernanceRecord[]): ClaimIssue[] {
  const out: ClaimIssue[] = [];
  for (const r of records) {
    for (const c of r.claims) {
      const def = KEY_INDEX.get(c.key);
      if (!def) {
        out.push({ id: r.id, rule: "undeclared-claim-key", detail: c.key });
        continue;
      }
      if (!def.values.includes(c.value)) {
        out.push({
          id: r.id,
          rule: "claim-value",
          detail: `${c.key} = ${c.value} is not one of ${def.values.join(" | ")}`,
        });
      }
    }
  }
  return out;
}

/** The compiled current answer for every declared key, for the session brief. */
export function currentClaims(records: GovernanceRecord[]): Map<string, SemanticClaim & { by: string }> {
  const out = new Map<string, SemanticClaim & { by: string }>();
  for (const r of records) {
    if (!CURRENT_STATUSES.includes(r.status)) continue;
    for (const c of r.claims) out.set(c.key, { ...c, by: r.id });
  }
  return out;
}
