import { stateFromRegistryRuntimeContractId, type StateRegistryContractId } from "./state-scopes.ts";
import { parseStateBallotContractId, type StateBallotContractId, type StateBallotFamily } from "./state-scopes.ts";
import type { ResolvedScope } from "../control-plane/expansion/membership.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS, type ManualProductionContractId } from "./manual-contracts.ts";
import { federalDirectoryStateOf, type FederalDirectoryContractId } from "../officials/federal-directory-data-plane.ts";

type ManualProducerMode = "DIRECT_SOURCE" | "VERIFIED_WORKER_RESULT" | "EXISTING_DERIVED" | "SCOPED_ADAPTER_OWED";
interface Rule { readonly mode: ManualProducerMode; readonly state?: string; readonly reason: string }
const RULES = {
  "candidate-campaign-sites-derived": { mode: "EXISTING_DERIVED", reason: "Verified campaign sources publish to their state through the standing derived-source child." },
  "campaign-finance": { mode: "VERIFIED_WORKER_RESULT", reason: "Complete saved door bytes and filed candidate/office/cycle/jurisdiction identities publish through normal Slide; unmatched rows remain work." },
  "government-budgets": { mode: "VERIFIED_WORKER_RESULT", reason: "Official adopted budgets, amendments and government-specific legal responsibility use the normal saved-evidence worker and Slide." },
  "special-district-boundaries": { mode: "VERIFIED_WORKER_RESULT", reason: "Registered saved GIS polygons bind to the held government key and exact body, without a model or guessed territory." },
  "public-records": { mode: "VERIFIED_WORKER_RESULT", reason: "Source-worded kind and title publish with their exact jurisdiction and saved source sentence." },
  "plain-english-translations": { mode: "VERIFIED_WORKER_RESULT", reason: "Every sentence is supported by the original official text and checked independently under the existing budget dial." },
  "ballot-contests": { mode: "VERIFIED_WORKER_RESULT", reason: "Each verified candidate on the saved official list publishes with its exact contest; incomplete listings retain other held candidates." },
  "congress-bulk-roster": { mode: "DIRECT_SOURCE", reason: "Each place's members of Congress, acquired from the registered national directory source." },
  "registry-runtime": { mode: "VERIFIED_WORKER_RESULT", reason: "Normal worker roster publication runs once it meets the section 3 standard; the audit follows and repairs what it finds." },
  "congress-rollcalls": { mode: "DIRECT_SOURCE", reason: "National recent roll calls acquired from their registered public source." },
  "federal-key-votes": { mode: "DIRECT_SOURCE", reason: "Reviewed national key-vote selection has an executable official acquisition." },
  "candidate-profiles": { mode: "SCOPED_ADAPTER_OWED", reason: "Plain code that builds candidate profiles from their saved source records is still owed; the projection command takes a prepared input." },
  "candidate-corpus": { mode: "SCOPED_ADAPTER_OWED", reason: "Plain code that builds the candidate publication corpus from saved primary publications is still owed; the projection command takes a prepared input." },
  "officeholder-statements": { mode: "SCOPED_ADAPTER_OWED", reason: "Plain code that builds attributed statements from saved primary publications is still owed; the projection command takes a prepared input." },
  "jurisdiction-operational-reference": { mode: "SCOPED_ADAPTER_OWED", reason: "The legacy reviewed AZ/NH/NJ reference remains a separate multi-state version and is not implied by the original Arizona Send." },
  "jurisdiction-operational-reference-az": { mode: "DIRECT_SOURCE", state: "AZ", reason: "The AZ-only reviewed jurisdiction reference applies to every Send that reaches Arizona and keeps the older three-state version separate." },
  "az-sos-campaign-finance": { mode: "DIRECT_SOURCE", state: "AZ", reason: "The standing Arizona collector acquires native statewide financial identities and their actual filing periods from its official source." },
  "nh-sos-campaign-finance": { mode: "DIRECT_SOURCE", state: "NH", reason: "The standing New Hampshire collector acquires native statewide financial identities and their actual filing periods from its official source." },
  "nj-elec-campaign-finance": { mode: "DIRECT_SOURCE", state: "NJ", reason: "The standing New Jersey collector acquires native statewide financial identities and their actual filing periods from its official source." },
  "az-pima-local-finance": { mode: "SCOPED_ADAPTER_OWED", state: "AZ", reason: "The adapter covers Pima County only; Arizona state membership alone does not establish Pima applicability." },
  "voting-sites": { mode: "DIRECT_SOURCE", reason: "The automatic pass starts at chief election offices and follows official doors with generic readers. Saved polling-door worker results use the same publication pointer." },
  "prl": { mode: "DIRECT_SOURCE", reason: "The licensed national PRL archive is acquired and attributed for every Send, like any national source (the licence covers every place)." },
  "prl-archives": { mode: "DIRECT_SOURCE", reason: "The known licensed PRL datasets refresh through the shared service; completed native-person partitions serve every place." },
  "az-official-actions": { mode: "SCOPED_ADAPTER_OWED", state: "AZ", reason: "Plain code that builds Arizona official actions from their saved sources is still owed; the promotion command takes a prepared projection." },
  "official-filings": { mode: "VERIFIED_WORKER_RESULT", reason: "Normal worker output publishes once it meets the section 3 standard; audits run afterward and repair what they find." },
  stances: { mode: "VERIFIED_WORKER_RESULT", reason: "A quote the saved page holds, with its date and topic, publishes once it meets the section 3 standard; audits run afterward and repair what they find." },
  "ballot-navigation": { mode: "VERIFIED_WORKER_RESULT", reason: "Normal worker output publishes once it meets the section 3 standard; audits run afterward and repair what they find." },
  "campaign-sites": { mode: "EXISTING_DERIVED", reason: "The separate derived campaign-site routine verifies current publications and promotes its reader projection." },
  "member-offices": { mode: "EXISTING_DERIVED", reason: "The daily member-office refresh reuses held official and Open States people projections and their original source receipts." },
  "venue-resolutions": { mode: "EXISTING_DERIVED", reason: "Existing venue references remain available to adapters. New Census points publish with each meeting and its fact-store location through scripts/ingest.ts." },
  "meeting-body-crosswalk": { mode: "EXISTING_DERIVED", reason: "The existing meeting source-wiring session owns the normal held meeting/body binding and publication path." },
  "everyday-routing": { mode: "VERIFIED_WORKER_RESULT", reason: "Normal worker output publishes once it meets the section 3 standard; audits run afterward and repair what they find." },
} as const satisfies Record<Exclude<ManualProductionContractId, StateBallotContractId | StateRegistryContractId | FederalDirectoryContractId> | StateBallotFamily | "registry-runtime" | "congress-bulk-roster", Rule>;

export interface ManualProducerInvocation {
  readonly id: ManualProductionContractId;
  readonly mode: ManualProducerMode;
  /** Current resolved Send receipts whose geography reaches this contract's state. */
  readonly instructionIds: readonly string[];
  /** Only DIRECT_SOURCE has a normal source task with the current command. */
  readonly commandReady: boolean;
  readonly reason: string;
}

/** CH-11: a producer applies by the Send's geography, never by one receipt. */
export function manualProducerInvocationMatrix(scopes: readonly ResolvedScope[], now: string): readonly ManualProducerInvocation[] {
  const nowMs = Date.parse(now);
  const sends = scopes.filter(scope => scope.kind === "RESOLVED" && scope.zctas.size > 0 &&
    scope.decision.sourceWorkVersion === 1 && scope.decision.receiptId.trim() &&
    Number.isFinite(Date.parse(scope.decision.decidedAt)) && Date.parse(scope.decision.decidedAt) <= nowMs);
  return MANUAL_PRODUCTION_SOURCE_CONTRACTS.map(contract => {
    const stateContract = parseStateBallotContractId(contract.id);
    const registryState = stateFromRegistryRuntimeContractId(contract.id), directoryState = federalDirectoryStateOf(contract.id);
    const rule = RULES[registryState ? "registry-runtime" : directoryState ? "congress-bulk-roster" : stateContract?.family ?? contract.id as keyof typeof RULES];
    const state = registryState ?? directoryState ?? stateContract?.state ?? ("state" in rule ? rule.state : null);
    const applicable = sends.filter(scope => !state || scope.states.includes(state));
    return { id: contract.id, mode: rule.mode,
      instructionIds: [...new Set(applicable.map(scope => scope.decision.receiptId))],
      commandReady: rule.mode === "DIRECT_SOURCE" && applicable.length > 0,
      reason: rule.reason };
  });
}
