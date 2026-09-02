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
    values: [
      "per-source-cron-daily",
      "orchestrated-daily-per-source-rate",
      "derived-from-reader-impact-and-change-rate",
    ],
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
  {
    key: "method.claim_integrity",
    question: "What happens to a route when a conclusion drawn from it turns out to be false?",
    values: ["untyped-prose-rewritten-in-place", "typed-classes-with-required-provenance"],
  },
  {
    key: "guard.evidence_standard",
    question: "What may an instrument rest its own verdict on?",
    values: ["declared-input-trusted", "checked-evidence-only"],
  },
  {
    key: "orchestration.denominator",
    question: "What counts as the number of workstreams a session ran?",
    values: ["execution-branch-count", "declared-logical-workstreams-reconciled"],
  },
  {
    key: "method.inheritance_interface",
    question: "What does a later session actually inherit from the method store?",
    values: ["raw-route-prose", "typed-current-claim-projection"],
  },
  {
    key: "schema.migration_mutability",
    question: "May a migration that has already been established be edited?",
    values: ["editable-in-place", "immutable-append-only"],
  },
  {
    key: "sources.tenant_identity",
    question: "What authorizes the body identity a serving source adapter publishes under?",
    values: ["adapter-may-mint", "registry-is-the-authority"],
  },
  /*
   * The four acquisition slots (RULING 205-208, 2026-08-29).
   *
   * Each one's REFUSED value is the reading a session actually arrived at
   * before the doctrine was written down, which is why the slot is worth
   * declaring: none of these is a straw man.
   *
   *   route-disposition-closes    a blocked host closed the agenda obligation
   *   representation-is-the-record  a vendor PDF URL WAS the record's identity
   *   first-success-wins          a 200 from the API ended the route portfolio
   *   blocks-until-answered       NEEDS SEAN read as permission to stop
   */
  {
    key: "acquisition.obligation_closure",
    question: "What closes an obligation to acquire a public civic record?",
    values: ["route-disposition-closes", "acquired-evidenced-or-human-route"],
  },
  {
    key: "acquisition.record_identity",
    question: "Is a vendor URL or API object the public record, or a representation of it?",
    values: ["representation-is-the-record", "government-record-with-representations"],
  },
  {
    key: "acquisition.representation_coverage",
    question: "Does one successful route discharge the others for the same owed record?",
    values: ["first-success-wins", "every-material-representation"],
  },
  {
    key: "escalation.access_request",
    question: "What happens to the work while an access escalation to the author is open?",
    values: ["blocks-until-answered", "parallel-never-blocking"],
  },
  {
    key: "sources.held_artifact_retention",
    question:
      "What happens to public-record text already held when its route is later found disallowed?",
    values: ["purge-on-disallow", "keep-and-use-with-replacement-obligation"],
  },
  {
    key: "reader.health_contract",
    question: "What is the top-line health contract of the reader dimension?",
    values: ["none-declared", "answerability-suite-with-typed-diagnostics"],
  },
  {
    key: "truth.control_standard",
    question: "How is answer truthfulness measured after activation?",
    values: ["pre-activation-test-pass", "permanent-unannounced-control-set"],
  },
  {
    key: "scheduler.orchestration",
    question: "Does the freshness scheduler build on an external orchestration service?",
    values: ["external-orchestration-service", "existing-control-plane-interfaces"],
  },
  {
    key: "project.abstraction_investment",
    question: "When is new multi-project abstraction built?",
    values: ["speculatively-ahead-of-need", "second-project-first"],
  },
  {
    key: "activation.external_workflows",
    question: "May agents execute external workflows such as records requests and communications?",
    values: ["level-5-planned", "removed-from-architecture"],
  },
  {
    key: "status.claim_standard",
    question: "How is a current capability or readiness claim recorded?",
    values: ["hand-asserted", "generated-with-proving-check"],
  },
  {
    key: "health.pilot_rollup",
    question: "What makes the pilot read healthy?",
    values: ["any-single-contract", "three-contracts-one-rollup"],
  },
  {
    key: "freshness.clock_authority",
    question: "What is the authoritative freshness clock?",
    values: ["github-scheduled-workflows", "runtime-scheduler-derived-due"],
  },
  {
    key: "governance.constitution_view",
    question: "Where does the autonomous-system constitution live?",
    values: ["hand-maintained-document", "generated-view-of-the-ledger"],
  },
  {
    key: "scheduler.persistence_provider",
    question: "Which persistence provider holds Level-2 scheduling authority?",
    values: ["filesystem-provider", "postgres-provider-neutral-interfaces"],
  },
  {
    key: "session.completion_denominator",
    question: "What decides when a session's scoped work is finished?",
    values: ["finite-stated-at-start", "whatever-the-session-discovers"],
  },
  {
    key: "session.discovered_defect_routing",
    question: "Where does a defect discovered mid-session go?",
    values: [
      "frontier-unless-falsifies-or-regresses",
      "into-the-current-session",
    ],
  },
  {
    key: "session.human_gated_status",
    question: "Is a row awaiting a human decision open executable work?",
    values: [
      "needs-owner-terminal-not-open-executable",
      "counted-as-open",
    ],
  },
  {
    key: "rendering.address_scope",
    question: "Once a reader confirms an address, what scope do ZIP-scoped surfaces show?",
    values: ["address-scope-replaces-zip-scope", "zip-scope-with-annotations"],
  },
  {
    key: "rendering.excluded_entity_label",
    question:
      "May a governing-entities surface display an entity the address ruled out, labelled as not the reader's?",
    values: ["prohibited-out-of-scope-not-annotated", "kept-and-labelled"],
  },
  {
    key: "session.discretion_scope",
    question: "What may a session decide for itself?",
    values: [
      "implementation-and-ordering-never-the-contract",
      "including-what-counts-as-done",
    ],
  },
  {
    key: "session.capacity_end_output",
    question: "What does a session report when capacity ends with work owed?",
    values: [
      "unfinished-session-with-resume-point-and-named-items",
      "complete-with-a-rationale",
    ],
  },
  {
    key: "obligation.completion_boundary",
    question: "When does an acquisition obligation close?",
    values: [
      "reader-surface-or-honest-gap-not-the-vault",
      "when-evidence-reaches-the-vault",
    ],
  },
  {
    key: "obligation.promotion_tail",
    question: "How far does the acquisition pipeline run without an operator?",
    values: [
      "automatic-through-staged-shipping-carries-last-mile",
      "halts-at-vaulted-bytes",
    ],
  },
  {
    key: "report.lead_order",
    question: "What does a session report lead with?",
    values: [
      "reader-then-unattended-then-owner-then-infrastructure",
      "infrastructure-counts-first",
    ],
  },
  {
    key: "collection.aggregate_only_scope",
    question: "What does aggregate-only constrain?",
    values: [
      "exposure-boundary-not-storage-at-rest",
      "storage-at-rest-as-well",
    ],
  },
  {
    key: "escalation.entry_requirement",
    question: "What must a row carry before it may enter NEEDS_SEAN?",
    values: [
      "machine-predicate-or-explicit-not-verifiable-with-card",
      "nothing-beyond-a-title",
    ],
  },
  {
    key: "escalation.reconciliation_cadence",
    question: "How often is a NEEDS_SEAN blocker predicate rechecked?",
    values: [
      "rechecked-every-generation-auto-resolves",
      "when-a-session-happens-to-look",
    ],
  },
  {
    key: "interface.definition_form",
    question: "How is an interface between two lanes defined?",
    values: [
      "one-shared-typed-schema-both-sides-validate",
      "a paragraph each side reads separately",
    ],
  },
  {
    key: "interface.compatibility_evidence",
    question: "What proves two lanes' halves actually fit?",
    values: [
      "real-producer-output-into-real-consumer",
      "a fixture each side agrees with",
    ],
  },
  {
    key: "acquisition.denominator_authority",
    question: "What defines the acquisition denominator?",
    values: [
      "source-authority-universe",
      "the currently enabled reader location",
    ],
  },
  {
    key: "acquisition.new_location_cost",
    question: "What may activating a new reader location require?",
    values: [
      "zero-new-external-hunt-for-already-owed-records",
      "a fresh source hunt per location",
    ],
  },
  {
    key: "enrichment.keying",
    question: "What is candidate enrichment keyed to?",
    values: [
      "canonical-statewide-candidate-universe",
      "the currently visible zip",
    ],
  },
  {
    key: "model.switch_rule",
    question: "What earns a switch away from the incumbent synthesis model?",
    values: [
      "every-required-question-measured-and-held",
      "no question degraded relative to the incumbent",
    ],
  },
  {
    key: "model.verdict_emitters",
    question: "How many functions may emit a SwitchVerdict?",
    values: [
      "exactly-one-canonical-emitter",
      "any analysis that computes one",
    ],
  },
  {
    key: "tracker.person_description_amend_path",
    question:
      "How does a later session correct an earlier session's false description of a named person?",
    values: [
      "recorded-supersession-preserving-the-original-text",
      "editing the row in place",
    ],
  },
  {
    key: "labeling.population_scope",
    question:
      "What earns an obligation, registry, corpus or report line the label 'statewide' or 'source-universe'?",
    values: [
      "acquired-source-authority-universe",
      "a statewide-shaped key over whatever population is held",
    ],
  },
  {
    key: "shipping.promotion_path",
    question: "How does a verified head reach production?",
    values: ["staging-first-then-promotion", "integrated-head-merges-to-main"],
  },
  {
    key: "session.efficiency_law",
    question:
      "How does a session spend effort — is the SESSION EFFICIENCY LAW (docs/governance/session-efficiency.md) in force verbatim?",
    values: ["adopted-verbatim", "not-adopted"],
  },
  {
    key: "session.credential_custody",
    question:
      "When a provider masks a new or rotated credential, where must an owner-accessible copy exist, and when?",
    values: ["owner-copy-before-install", "provider-only"],
  },
  {
    key: "activation.standing_level",
    question:
      "At which activation level may the standing autonomous system operate without session-by-session owner authorization?",
    values: [
      "none",
      "level-1-research",
      "level-2-verified-promotion",
      "level-3-broad-publication",
      "level-4-automatic-publishing",
    ],
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
