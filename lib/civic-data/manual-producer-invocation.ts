import type { ResolvedScope } from "../control-plane/expansion/membership.ts";
import { ORIGINAL_LIFETIME_HUNT } from "../control-plane/scheduler/hunt-continuation.ts";
import { isTerminalState, type WorkItem } from "../control-plane/work-item.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS, type ManualProductionContractId } from "./manual-contracts.ts";

/** A command's presence in the production registry does not establish that a
 * normal Send has its source inputs, geographic applicability or reviewer
 * evidence. This is the explicit 24-contract bridge for the current Send. */
export type ManualProducerMode = "DIRECT_SOURCE" | "VERIFIED_WORKER_RESULT" | "EXISTING_DERIVED" | "REVIEWED_INPUT" | "SCOPED_ADAPTER_OWED";
interface Rule { readonly mode: ManualProducerMode; readonly state?: string; readonly originalOnly?: boolean; readonly reason: string }
const RULES = {
  "ballot-contests": { mode: "VERIFIED_WORKER_RESULT", reason: "The saved official candidate list passes section 3 and each complete contest publishes with all of its candidates." },
  "congress-bulk-roster": { mode: "DIRECT_SOURCE", reason: "National congressional directory acquired from its registered public source." },
  "registry-runtime-bindings": { mode: "VERIFIED_WORKER_RESULT", reason: "Normal worker roster publication runs once it meets the section 3 standard; the audit follows and repairs what it finds." },
  "congress-rollcalls": { mode: "DIRECT_SOURCE", reason: "National recent roll calls acquired from their registered public source." },
  "federal-key-votes": { mode: "DIRECT_SOURCE", reason: "Reviewed national key-vote selection has an executable official acquisition." },
  "az-sos-ballot": { mode: "REVIEWED_INPUT", state: "AZ", reason: "Projection command requires a separately acquired and reviewed Arizona ballot input." },
  "nh-curated-ballot": { mode: "REVIEWED_INPUT", state: "NH", reason: "Projection command requires a separately acquired and reviewed New Hampshire ballot input." },
  "candidate-profiles": { mode: "REVIEWED_INPUT", reason: "Candidate profiles require current candidate identity and attributable source records." },
  "candidate-corpus": { mode: "REVIEWED_INPUT", reason: "Candidate publication corpus requires verified primary publications and asset bindings." },
  "officeholder-statements": { mode: "REVIEWED_INPUT", reason: "Statements require attributed primary publications, not a source-free projection command." },
  "jurisdiction-operational-reference": { mode: "SCOPED_ADAPTER_OWED", reason: "The legacy reviewed AZ/NH/NJ reference remains a separate multi-state version and is not implied by the original Arizona Send." },
  "jurisdiction-operational-reference-az": { mode: "DIRECT_SOURCE", state: "AZ", originalOnly: true, reason: "An AZ-only reviewed jurisdiction reference uses the exact original 85635 owner Send and keeps the older three-state version separate." },
  "az-sos-campaign-finance": { mode: "DIRECT_SOURCE", state: "AZ", reason: "Arizona statewide campaign-finance acquisition is executable for a selected Arizona Send." },
  "nh-sos-campaign-finance": { mode: "SCOPED_ADAPTER_OWED", state: "NH", reason: "The current projection requires promoted New Hampshire ballot identity and narrows to Merrimack; bind the selected area before invocation." },
  "nj-elec-campaign-finance": { mode: "SCOPED_ADAPTER_OWED", state: "NJ", reason: "The current projection requires promoted New Jersey ballot identity and narrows to Morris; bind the selected area before invocation." },
  "az-pima-local-finance": { mode: "SCOPED_ADAPTER_OWED", state: "AZ", reason: "The adapter covers Pima County only; Arizona state membership alone does not establish Pima applicability." },
  "voting-sites": { mode: "SCOPED_ADAPTER_OWED", reason: "The implemented sources cover Pima, Morris and selected New Hampshire towns, not every selected ZIP." },
  "prl": { mode: "DIRECT_SOURCE", originalOnly: true, reason: "The licensed national PRL archive is acquired and attributed for the original authorized Send." },
  "az-official-actions": { mode: "REVIEWED_INPUT", state: "AZ", reason: "Promotion requires a reviewed action projection, exact source-set receipt and source-through argument." },
  "official-filings": { mode: "VERIFIED_WORKER_RESULT", reason: "Normal worker output publishes once it meets the section 3 standard; audits run afterward and repair what they find." },
  "comment-access": { mode: "VERIFIED_WORKER_RESULT", reason: "Normal worker output publishes once it meets the section 3 standard; audits run afterward and repair what they find." },
  "ballot-navigation": { mode: "VERIFIED_WORKER_RESULT", reason: "Normal worker output publishes once it meets the section 3 standard; audits run afterward and repair what they find." },
  "campaign-sites": { mode: "EXISTING_DERIVED", reason: "The separate derived campaign-site routine verifies current publications and promotes its reader projection." },
  "member-offices": { mode: "EXISTING_DERIVED", reason: "The daily member-office refresh reads every official state roster and Open States file and promotes its reader projection." },
  "venue-resolutions": { mode: "EXISTING_DERIVED", reason: "Each meeting pass matches a newly published address to one exact Census street point and promotes the pin through this pointer itself (lib/meetings/venue-publication.ts); no person reviews it." },
  "meeting-body-crosswalk": { mode: "EXISTING_DERIVED", reason: "The existing meeting source-wiring session owns the normal held meeting/body binding and publication path." },
  "everyday-routing": { mode: "VERIFIED_WORKER_RESULT", reason: "Normal worker output publishes once it meets the section 3 standard; audits run afterward and repair what they find." },
} as const satisfies Record<ManualProductionContractId, Rule>;

export interface ManualProducerInvocation {
  readonly id: ManualProductionContractId;
  readonly mode: ManualProducerMode;
  /** Current resolved Send receipts whose geography reaches this contract's state. */
  readonly instructionIds: readonly string[];
  /** Only this mode has a normal source task with the current command. */
  readonly commandReady: boolean;
  readonly reason: string;
}

export function manualProducerInvocationMatrix(scopes: readonly ResolvedScope[], now: string,
  items: readonly WorkItem[] = []): readonly ManualProducerInvocation[] {
  const nowMs = Date.parse(now);
  const sends = scopes.filter(scope => scope.kind === "RESOLVED" && scope.zctas.size > 0 &&
    scope.decision.sourceWorkVersion === 1 && scope.decision.receiptId.trim() &&
    Number.isFinite(Date.parse(scope.decision.decidedAt)) && Date.parse(scope.decision.decidedAt) <= nowMs);
  return MANUAL_PRODUCTION_SOURCE_CONTRACTS.map(contract => {
    const rule = RULES[contract.id];
    const applicable = sends.filter(scope => (!('state' in rule) || scope.states.includes(rule.state)) &&
      (!('originalOnly' in rule) || (scope.decision.key === ORIGINAL_LIFETIME_HUNT.key &&
        scope.decision.receiptId === ORIGINAL_LIFETIME_HUNT.receiptId &&
        scope.decision.budgetStartedAt === ORIGINAL_LIFETIME_HUNT.budgetStartedAt &&
        scope.decision.budgetUsd === ORIGINAL_LIFETIME_HUNT.budgetUsd)));
    // State membership is not proof that a county-only or selected-town
    // adapter covers the Send. Those contracts have no executable receipt
    // until a specific source/body geography is bound by normal work.
    const cochiseSourceBound = contract.id === "voting-sites" && applicable.some(scope =>
      scope.decision.key === ORIGINAL_LIFETIME_HUNT.key &&
      scope.decision.receiptId === ORIGINAL_LIFETIME_HUNT.receiptId &&
      scope.decision.budgetStartedAt === ORIGINAL_LIFETIME_HUNT.budgetStartedAt &&
      scope.decision.budgetUsd === ORIGINAL_LIFETIME_HUNT.budgetUsd &&
      items.some(item => item.subject === "az:county:county-of-cochise" && !isTerminalState(item.state) &&
        item.autonomousPlan?.ownerInstructions?.includes(scope.decision.receiptId)));
    const bound = rule.mode === "SCOPED_ADAPTER_OWED" ? cochiseSourceBound ? applicable.filter(scope =>
      scope.decision.receiptId === ORIGINAL_LIFETIME_HUNT.receiptId) : [] : applicable;
    return { id: contract.id, mode: cochiseSourceBound ? "DIRECT_SOURCE" : rule.mode,
      instructionIds: [...new Set(bound.map(scope => scope.decision.receiptId))],
      commandReady: (rule.mode === "DIRECT_SOURCE" && applicable.length > 0) || cochiseSourceBound,
      reason: cochiseSourceBound ? "The exact original Cochise county obligation binds its official 2026 countywide vote-center source; refresh this source only and retain all other proven jurisdictions." : rule.reason };
  });
}
