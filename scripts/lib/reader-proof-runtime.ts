import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import { refreshNhSeatHolders } from "../../lib/ballot/seat-holders.ts";
import { refreshVotingSitesFromPromoted } from "../../lib/ballot/voting-sites-server.ts";
import {
  refreshAzPimaFinanceFromPromoted,
} from "../../lib/control-plane/campaign-finance/held-records.ts";
import {
  refreshBallotNavigationFromPromoted,
  refreshCampaignSitesFromPromoted,
  refreshCommentAccessFromPromoted,
  refreshVenueResolutionsFromPromoted,
} from "../../lib/civic-data/curated-reader-read-model.ts";
import {
  refreshAzBallotFromPromoted,
  refreshCandidateCorpusFromPromoted,
  refreshCandidateProfilesFromPromoted,
  refreshNhBallotFromPromoted,
} from "../../lib/civic-data/manual-read-models.ts";
import { refreshOfficeholderStatementsFromPromoted } from "../../lib/corpus/data-plane.ts";
import {
  HELD_MEETING_PARTITIONS,
  MEETING_PARTITION_CONTRACTS,
  RETIRED_MEETING_PARTITIONS_WITHOUT_HOLD,
} from "../../lib/civic-data/meeting-partitions.ts";
import { pdcV2CanonicalMeetingFactEvidence } from "../../lib/civic-data/store.ts";
import {
  STATE_CAMPAIGN_FINANCE_SOURCES,
  type StateCampaignFinanceJurisdiction,
} from "../../lib/funding/data-plane.ts";
import {
  refreshStateMoneyFromPromoted,
  stateMoneyReadState,
} from "../../lib/funding/state-snapshot.ts";
import { refreshFundingFromPromoted } from "../../lib/funding/snapshot.ts";
import {
  readMeetingsProjection,
  requireReaderProofMeetingsProjection,
  type ReaderProofMeetingsExpectedAuthority,
} from "../../lib/meetings/snapshot.ts";
import { readerProofMeetingPinAdmission } from "../../lib/meetings/proof-pin.ts";
import {
  readerClosureExecutionAuthorityAdmission,
  readerClosureExecutionAuthorityPaths,
  readerClosureReadConnectionIdentity,
  readerSourceFingerprint,
  readReaderEvidence,
  validateReaderProductionClosureReceipt,
  type ReaderClosureExecutionAuthorityEvidence,
  type ReaderClosureReceipt,
} from "../../lib/holdings/reader-census.ts";
import {
  admitReaderExecutionAuthorityArchivedSupport,
  PDC_V2_POST_IMPORT_MEETING_PARTITIONS,
  PDC_V2_ZERO_LKG_MEETING_PARTITIONS,
  type ReaderExecutionAuthorityArchivedSupportAdmission,
} from "../../lib/holdings/reader-execution-authority.ts";
import { refreshExecutiveActionsFromPromoted } from "../../lib/officials/executive-actions.ts";
import { refreshFederalDirectoryFromPromoted } from "../../lib/officials/federal-directory-read-model.ts";
import { refreshOutcomeSnapshotFromPromoted } from "../../lib/outcomes/store.ts";
import { refreshRegistryRuntimeFromPromoted } from "../../lib/registry/runtime-read-model.ts";
import { refreshEverydayRoutingFromPromoted } from "../../lib/routing/everyday-data-plane.ts";
import { readNjMorrisFiling } from "../../lib/sources/ballot-nj-morris/index.ts";
import { refreshPrlFromPromoted } from "../../lib/sources/prl/snapshot.ts";
import { refreshFederalKeyVotesFromPromoted } from "../../lib/votes/key-votes-projection.ts";
import { refreshFederalVotesFromPromoted } from "../../lib/votes/snapshot.ts";

export const READER_PROOF_RUNTIME_LOADER_IDS = [
  "az-pima-local-finance",
  "registry-runtime-bindings",
  "congress-bulk-roster",
  "candidate-profiles",
  "candidate-corpus",
  "az-sos-ballot",
  "nh-curated-ballot",
  "nj-morris-filing",
  "fec-funding",
  "state-campaign-finance",
  "congress-rollcalls",
  "federal-key-votes",
  "nh-members",
  "voting-sites",
  "prl",
  "officeholder-statements",
  "az-official-actions",
  "pima-legistar-outcomes",
  "comment-access",
  "ballot-navigation",
  "campaign-sites",
  "venue-resolutions",
  "everyday-routing",
  "meeting-partitions",
] as const;

export type ReaderProofRuntimeLoaderId =
  (typeof READER_PROOF_RUNTIME_LOADER_IDS)[number];
export type ReaderProofRuntimeLoaders = Readonly<
  Record<ReaderProofRuntimeLoaderId, () => Promise<string | null>>
>;

function promotedVersion(
  label: string,
  result: { readonly kind: string; readonly metadata: { readonly versionId: string | null }; readonly detail?: string },
): string {
  if (result.kind !== "PROMOTED" || !result.metadata.versionId) {
    throw new Error(
      `${label} Reader proof authority is ${result.kind}:${result.metadata.versionId ?? "none"}${result.detail ? ` (${result.detail})` : ""}.`,
    );
  }
  return result.metadata.versionId;
}

export function readerProofMeetingPartitionIdentity(
  result: Awaited<ReturnType<typeof readMeetingsProjection>>,
  expectedAuthority: ReaderProofMeetingsExpectedAuthority,
): string {
  requireReaderProofMeetingsProjection(result, expectedAuthority);
  if (result.kind !== "PROMOTED") throw new Error("Unreachable meeting Reader proof state.");
  // RULING 290: the standing runner reorganizes meeting data during promotion (dedup, new agenda docs).
  // Aggregate content comparison against the frozen import receipt is not meaningful.
  const actualLegacyMeetingsAggregate = pdcV2CanonicalMeetingFactEvidence([result.value]);
  if (actualLegacyMeetingsAggregate.meetingRowCount === 0) {
    throw new Error("Meeting Reader proof has zero meeting rows.");
  }
  const identity = result.partitions
    .map(({ contractId, kind, versionId, heldFrom }) =>
      `${contractId}|${kind}|${versionId ?? ""}` +
      // A held version is part of what was composed, so it is part of the identity.
      (heldFrom ? `|held:${heldFrom.contractId}@${heldFrom.versionId}` : ""))
    .sort()
    .join("\n");
  return `meeting-partitions:${createHash("sha256").update(identity).digest("hex")}`;
}

export function readerProofMeetingsAuthorityFromImport(
  admission: ReaderExecutionAuthorityArchivedSupportAdmission,
): ReaderProofMeetingsExpectedAuthority {
  const registered = new Set(MEETING_PARTITION_CONTRACTS.map(({ id }) => id));
  // A partition retired by a proved cutover (RETIRED_MEETING_ROUTES) is carried
  // by its registered successor for the same body, so the import's disposition
  // for the retired identity is the authority the successor inherits: a
  // promoted body stays promoted, and losing it remains a hard failure. An
  // import that named both identities is a duplicate and is refused below.
  const successorOf = new Map(HELD_MEETING_PARTITIONS.map(({ id, successorId }) => [id, successorId]));
  // A partition retired beside a successor that was already wired for the same
  // body (RETIRED_MEETING_ROUTES `successorAlreadyWired`) hands nothing on: the
  // import names the successor's own disposition, which stays the body's
  // authority. The retired identity still counts in the frozen import's
  // denominator, and then leaves the authority.
  const retiredWithoutHold = new Map(RETIRED_MEETING_PARTITIONS_WITHOUT_HOLD.map(({ id, successorId }) => [id, successorId]));
  const dispositions = admission.dispositionSet.map((row) =>
    successorOf.has(row.contractId) ? { ...row, contractId: successorOf.get(row.contractId)! } : row
  );
  const unexpected = dispositions.filter(({ contractId }) =>
    contractId.startsWith("meetings:") && !registered.has(contractId) && !retiredWithoutHold.has(contractId)
  );
  if (unexpected.length) {
    throw new Error("Reader phase import names an unregistered meeting partition.");
  }
  const importedRows = dispositions.filter(({ contractId }) => registered.has(contractId) || retiredWithoutHold.has(contractId));
  const importedById = new Map(importedRows.map((row) => [row.contractId, row]));
  if (importedById.size !== importedRows.length) {
    throw new Error("Reader phase import duplicates a meeting partition disposition.");
  }
  // Partitions registered after the frozen import are outside its universe:
  // NOT_RECORDED in this authority until routine promotion gains them.
  const postImport = new Set(PDC_V2_POST_IMPORT_MEETING_PARTITIONS.filter((id) => registered.has(id)));
  if (importedRows.some(({ contractId }) => postImport.has(contractId))) {
    throw new Error("Reader phase import claims a meeting partition registered after it.");
  }
  if (
    admission.zeroMeetingPartitionsRefused !== PDC_V2_ZERO_LKG_MEETING_PARTITIONS ||
    importedRows.length !== registered.size + retiredWithoutHold.size - PDC_V2_ZERO_LKG_MEETING_PARTITIONS - postImport.size
  ) {
    throw new Error("Reader phase import meeting partition denominator differs from the permanent 83/41 authority.");
  }
  for (const [retiredId, successorId] of retiredWithoutHold) {
    if (importedById.has(retiredId) && !importedById.has(successorId)) {
      throw new Error("Reader phase import promoted a retired meeting partition whose wired successor it does not carry.");
    }
  }
  const promotedById = new Map([...importedById].filter(([id]) => registered.has(id)));
  const partitions = MEETING_PARTITION_CONTRACTS.map(({ id }) => {
    const promoted = promotedById.get(id);
    return promoted
      ? { contractId: id, kind: "PROMOTED" as const, versionId: promoted.versionId }
      : { contractId: id, kind: "NOT_RECORDED" as const, versionId: null };
  });
  return {
    meetingPartitionsWithLkg: promotedById.size,
    meetingPartitionsWithoutLkg: partitions.length - promotedById.size,
    legacyMeetingsAggregate: admission.legacyMeetingsAggregate,
    partitions,
  };
}

const READER_EXECUTION_AUTHORITY_EVIDENCE_ENV = "READER_EXECUTION_AUTHORITY_EVIDENCE";
const EXACT_GIT_HEAD = /^[0-9a-f]{40}$/;
const PRODUCTION_CLOSURE_RECEIPT = "docs/evidence/reader-last-mile-final-closure-receipt.json";

interface ReaderProofRuntimeOptions {
  /**
   * Post-merge production readback is the sole lifecycle where the executing
   * checkout may be a descendant of the documentary authority head. The
   * caller must name the provider-confirmed deployed merge exactly.
   */
  readonly deployedCommit?: string;
}

export function requireReaderProofAuthorityReadConnection(
  evidence: Pick<ReaderClosureExecutionAuthorityEvidence, "store" | "readOnly">,
  connection: string | undefined,
): void {
  if (!connection?.trim()) {
    throw new Error("Reader proof requires the active read-only DATABASE_URL.");
  }
  const actual = readerClosureReadConnectionIdentity(connection);
  if (
    evidence.store.endpointIdentitySha256 !== actual.endpointIdentitySha256 ||
    evidence.store.databaseIdentitySha256 !== actual.databaseIdentitySha256 ||
    evidence.store.schemaIdentitySha256 !== actual.schemaIdentitySha256 ||
    evidence.readOnly.roleIdentitySha256 !== actual.roleIdentitySha256
  ) {
    throw new Error("Reader proof connection identity differs from the selected execution authority.");
  }
}

export function requireReaderProofAuthorityHeadBinding(input: {
  readonly phase: "REHEARSAL" | "PRODUCTION";
  readonly authorityHead: string;
  readonly currentHead: string;
  readonly deployedCommit?: string;
  readonly authorityIsAncestor?: boolean;
  readonly deployedRuntimeTreeUnchanged?: boolean;
  readonly checkoutClean?: boolean;
  readonly deployedMergeTopologyValid?: boolean;
  readonly productionClosureFailures?: readonly string[];
}): void {
  if (!input.deployedCommit) {
    if (input.authorityHead !== input.currentHead) {
      throw new Error("Reader proof meeting authority does not bind the exact documentary head.");
    }
    return;
  }
  if (!EXACT_GIT_HEAD.test(input.deployedCommit) || input.currentHead !== input.deployedCommit) {
    throw new Error("Reader production readback checkout does not equal the provider-confirmed deployed commit.");
  }
  if (input.phase !== "PRODUCTION") {
    throw new Error("Reader post-merge readback requires PRODUCTION execution authority.");
  }
  if (!input.authorityIsAncestor) {
    throw new Error("Reader production authority head is not an ancestor of the deployed merge.");
  }
  if (!input.deployedMergeTopologyValid) {
    throw new Error("Reader production readback commit is not the normal two-parent merge of documentary E over B.");
  }
  if (!input.checkoutClean) {
    throw new Error("Reader production readback checkout has uncommitted files.");
  }
  if (!input.deployedRuntimeTreeUnchanged) {
    throw new Error("Reader production readback runtime changed after documentary authority proof.");
  }
  if (!Array.isArray(input.productionClosureFailures) || input.productionClosureFailures.length) {
    throw new Error(
      `Reader production closure is not valid at the deployed merge${input.productionClosureFailures?.length ? `: ${input.productionClosureFailures.join("; ")}` : "."}`,
    );
  }
}

export function deployedReaderRuntimeTreeUnchanged(
  root: string,
  authorityHead: string,
  currentHead: string,
): boolean {
  try {
    const bootstrapPaths = [
      "scripts/reader-last-mile-production-readback.mts",
      "scripts/lib/reader-proof-runtime.ts",
      "lib/holdings/reader-census.ts",
      "lib/holdings/reader-execution-authority.ts",
      "lib/meetings/snapshot.ts",
      "lib/civic-data/meeting-partitions.ts",
      "next.config.ts",
      "package.json",
      "pnpm-lock.yaml",
      "tsconfig.json",
    ] as const;
    const paths = [...new Set([
      ...bootstrapPaths,
      ...readerSourceFingerprint(root, bootstrapPaths).map(({ path }) => path),
    ])].sort();
    return paths.every((path) => {
      const authorityBlob = execFileSync("git", ["rev-parse", `${authorityHead}:${path}`], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const currentBlob = execFileSync("git", ["rev-parse", `${currentHead}:${path}`], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return authorityBlob === currentBlob;
    });
  } catch {
    return false;
  }
}

export function normalDocumentaryMergeOverAuthority(
  root: string,
  authorityHead: string,
  currentHead: string,
): boolean {
  try {
    const parentsOf = (commit: string) => execFileSync(
      "git",
      ["rev-list", "--parents", "-n", "1", commit],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim().split(/\s+/).slice(1);
    const mergeParents = parentsOf(currentHead);
    return mergeParents.length === 2 && mergeParents.some((parent) => {
      const documentaryParents = parentsOf(parent);
      return documentaryParents.length === 1 && documentaryParents[0] === authorityHead;
    });
  } catch {
    return false;
  }
}

function promotedMeetingIds(authority: ReaderProofMeetingsExpectedAuthority): readonly string[] {
  return authority.partitions
    .filter(({ kind }) => kind === "PROMOTED")
    .map(({ contractId }) => contractId)
    .sort();
}

/** Load one explicitly selected, immutable phase receipt; never infer phase from file presence. */
function loadReaderProofMeetingsExpectedAuthorityFor(
  root: string,
  environment: Readonly<Record<string, string | undefined>>,
  options: ReaderProofRuntimeOptions = {},
): ReaderProofMeetingsExpectedAuthority {
  const evidencePath = environment[READER_EXECUTION_AUTHORITY_EVIDENCE_ENV]?.trim();
  if (!evidencePath) {
    throw new Error(`${READER_EXECUTION_AUTHORITY_EVIDENCE_ENV} is required for documentary Reader proof.`);
  }
  const admittedEvidence = readerClosureExecutionAuthorityAdmission(root, evidencePath);
  const exactHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  requireReaderProofAuthorityReadConnection(admittedEvidence.evidence, environment.DATABASE_URL);
  let authorityIsAncestor: boolean | undefined;
  let deployedRuntimeTreeUnchanged: boolean | undefined;
  let checkoutClean: boolean | undefined;
  let deployedMergeTopologyValid: boolean | undefined;
  let productionClosureFailures: readonly string[] | undefined;
  if (options.deployedCommit) {
    try {
      execFileSync(
        "git",
        ["merge-base", "--is-ancestor", admittedEvidence.evidence.exactHead, exactHead],
        { cwd: root, stdio: "ignore" },
      );
      authorityIsAncestor = true;
    } catch {
      authorityIsAncestor = false;
    }
    deployedRuntimeTreeUnchanged = deployedReaderRuntimeTreeUnchanged(
      root,
      admittedEvidence.evidence.exactHead,
      exactHead,
    );
    checkoutClean = execFileSync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      { cwd: root, encoding: "utf8" },
    ).trim() === "";
    deployedMergeTopologyValid = normalDocumentaryMergeOverAuthority(
      root,
      admittedEvidence.evidence.exactHead,
      exactHead,
    );
    try {
      const receipt = JSON.parse(
        readReaderEvidence(root, PRODUCTION_CLOSURE_RECEIPT).toString("utf8"),
      ) as ReaderClosureReceipt;
      productionClosureFailures = validateReaderProductionClosureReceipt(
        root,
        receipt,
        environment.DATABASE_URL!,
        PRODUCTION_CLOSURE_RECEIPT,
      );
    } catch {
      productionClosureFailures = ["production closure receipt is missing or unreadable"];
    }
  }
  requireReaderProofAuthorityHeadBinding({
    phase: admittedEvidence.evidence.phase,
    authorityHead: admittedEvidence.evidence.exactHead,
    currentHead: exactHead,
    deployedCommit: options.deployedCommit,
    authorityIsAncestor,
    deployedRuntimeTreeUnchanged,
    checkoutClean,
    deployedMergeTopologyValid,
    productionClosureFailures,
  });
  const admittedSupport = admitReaderExecutionAuthorityArchivedSupport(
    admittedEvidence.evidence,
    readReaderEvidence(root, admittedEvidence.supportPaths[0]!),
    readReaderEvidence(root, admittedEvidence.supportPaths[1]!),
  );
  const expected = readerProofMeetingsAuthorityFromImport(admittedSupport);
  if (admittedEvidence.evidence.phase === "PRODUCTION") {
    const rehearsalPath = readerClosureExecutionAuthorityPaths("REHEARSAL").authority;
    const rehearsalEvidence = readerClosureExecutionAuthorityAdmission(root, rehearsalPath);
    try {
      execFileSync(
        "git",
        ["merge-base", "--is-ancestor", rehearsalEvidence.evidence.exactHead, exactHead],
        { cwd: root, stdio: "ignore" },
      );
    } catch {
      throw new Error("Reader production meeting authority is not descended from documentary rehearsal P.");
    }
    const rehearsalSupport = admitReaderExecutionAuthorityArchivedSupport(
      rehearsalEvidence.evidence,
      readReaderEvidence(root, rehearsalEvidence.supportPaths[0]!),
      readReaderEvidence(root, rehearsalEvidence.supportPaths[1]!),
    );
    const rehearsalExpected = readerProofMeetingsAuthorityFromImport(rehearsalSupport);
    if (
      JSON.stringify(expected.legacyMeetingsAggregate) !==
      JSON.stringify(rehearsalExpected.legacyMeetingsAggregate)
    ) {
      throw new Error("Reader production meeting aggregate differs from documentary rehearsal A.");
    }
    if (JSON.stringify(promotedMeetingIds(expected)) !== JSON.stringify(promotedMeetingIds(rehearsalExpected))) {
      throw new Error("Reader production meeting membership differs from documentary rehearsal A.");
    }
  }
  return expected;
}

export function loadReaderProofMeetingsExpectedAuthority(
  root = process.cwd(),
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ReaderProofMeetingsExpectedAuthority {
  return loadReaderProofMeetingsExpectedAuthorityFor(root, environment);
}

/**
 * **Proof priming reads each family once per process, proved in full (R29, 2026-09-25).**
 *
 * The non-meeting families are read through the ordinary proven read model,
 * not `bypassCache`. Proof strength is unchanged: a proof executor is a fresh
 * process, so its read model holds nothing yet, and each family's first read
 * here fetches the pointer and its candidate and runs the full promotion proof
 * (`promotionProofIssue`), exactly as a bypassing read does. What changes is
 * everything after that first read. Concurrent readers of one scope share the
 * one in-flight read instead of each downloading it, and a later read of an
 * unmoved pointer (after the 30-second scope cache expires, in an executor that
 * runs for minutes) asks only the pointer's identity and is served from the
 * proof this process made; a pointer that moved is fetched and proved again.
 * Bypassing skipped both, so a long executor re-downloaded every family whole
 * after each expiry. Priming was 77% of a proof's 6-7 GB transfer.
 *
 * The meeting partitions keep `bypassCache`: the pinned meeting read is the
 * proof harness's own contract (lib/meetings/proof-pin.ts).
 */
function productionLoaders(
  meetingAuthority: ReaderProofMeetingsExpectedAuthority,
): ReaderProofRuntimeLoaders {
  const proven = {} as const;
  const bypass = { bypassCache: true } as const;
  return {
    "az-pima-local-finance": () => refreshAzPimaFinanceFromPromoted(proven),
    "registry-runtime-bindings": () => refreshRegistryRuntimeFromPromoted(proven),
    "congress-bulk-roster": () => refreshFederalDirectoryFromPromoted(proven),
    "candidate-profiles": () => refreshCandidateProfilesFromPromoted(proven),
    "candidate-corpus": () => refreshCandidateCorpusFromPromoted(proven),
    "az-sos-ballot": () => refreshAzBallotFromPromoted(proven),
    "nh-curated-ballot": () => refreshNhBallotFromPromoted(proven),
    "nj-morris-filing": async () => promotedVersion(
      "nj-morris-filing",
      await readNjMorrisFiling(proven),
    ),
    "fec-funding": () => refreshFundingFromPromoted(proven),
    "state-campaign-finance": async () => {
      await refreshStateMoneyFromPromoted(proven);
      const versions = (Object.keys(STATE_CAMPAIGN_FINANCE_SOURCES) as StateCampaignFinanceJurisdiction[])
        .sort()
        .map((state) => promotedVersion(
        `${state} state campaign finance`,
        stateMoneyReadState(state),
      ));
      return versions.join(",");
    },
    "congress-rollcalls": () => refreshFederalVotesFromPromoted(proven),
    "federal-key-votes": () => refreshFederalKeyVotesFromPromoted(proven),
    "nh-members": async () => promotedVersion(
      "nh-members",
      await refreshNhSeatHolders(proven),
    ),
    "voting-sites": () => refreshVotingSitesFromPromoted(proven),
    "prl": () => refreshPrlFromPromoted(proven),
    "officeholder-statements": () => refreshOfficeholderStatementsFromPromoted(proven),
    "az-official-actions": () => refreshExecutiveActionsFromPromoted(proven),
    "pima-legistar-outcomes": () => refreshOutcomeSnapshotFromPromoted(proven),
    "comment-access": () => refreshCommentAccessFromPromoted(proven),
    "ballot-navigation": () => refreshBallotNavigationFromPromoted(proven),
    "campaign-sites": () => refreshCampaignSitesFromPromoted(proven),
    "venue-resolutions": () => refreshVenueResolutionsFromPromoted(proven),
    "everyday-routing": () => refreshEverydayRoutingFromPromoted(proven),
    "meeting-partitions": async () => readerProofMeetingPartitionIdentity(
      await readMeetingsProjection(bypass),
      meetingAuthority,
    ),
  };
}

/**
 * Run the complete promoted-data prerequisite set for documentary Reader
 * proof. Every required authority is strict: NOT_RECORDED, BOOTSTRAP, store
 * failure, or a null version rejects the proof process. Official state-roll
 * pointers are intentionally absent from this list because their retired
 * LegiScan aggregate is research-only and a missing official pointer is an
 * explicit source-scoped current state.
 */
export async function runReaderProofRuntimeLoaders(
  loaders: ReaderProofRuntimeLoaders,
): Promise<readonly { readonly id: ReaderProofRuntimeLoaderId; readonly versionId: string }[]> {
  const results = await Promise.all(READER_PROOF_RUNTIME_LOADER_IDS.map(async (id) => ({
    id,
    versionId: await loaders[id](),
  })));
  return results.map(({ id, versionId }) => {
    if (!versionId) throw new Error(`${id} Reader proof authority has no promoted version.`);
    return { id, versionId };
  });
}

let preparation: Promise<readonly { readonly id: ReaderProofRuntimeLoaderId; readonly versionId: string }[]> | null = null;
let preparedMeetingAuthority: ReaderProofMeetingsExpectedAuthority | null = null;
let preparationKey: string | null = null;

export function requiredPreparedReaderProofMeetingsAuthority(): ReaderProofMeetingsExpectedAuthority {
  if (!preparedMeetingAuthority) {
    throw new Error("Reader proof meeting authority was requested before strict runtime preparation.");
  }
  return preparedMeetingAuthority;
}

/** One strict, process-local initialization shared by every proof stage. */
function prepareReaderProofRuntimeFor(options: ReaderProofRuntimeOptions): Promise<
  readonly { readonly id: ReaderProofRuntimeLoaderId; readonly versionId: string }[]
> {
  const nextKey = options.deployedCommit ?? "DOCUMENTARY_EXACT_HEAD";
  if (preparationKey !== null && preparationKey !== nextKey) {
    throw new Error("Reader proof runtime cannot change authority lifecycle after preparation.");
  }
  if (!preparation) {
    try {
      // A pin the harness asked for but the reader refused would silently put
      // this process back on live, mixed-version meeting reads. Refuse it here.
      const pinAdmission = readerProofMeetingPinAdmission(process.env);
      if (pinAdmission.state === "REFUSED") {
        throw new Error(`Reader proof meeting pin was requested but refused: ${pinAdmission.reason}.`);
      }
      const authority = loadReaderProofMeetingsExpectedAuthorityFor(process.cwd(), process.env, options);
      preparationKey = nextKey;
      preparation = runReaderProofRuntimeLoaders(productionLoaders(authority)).then((result) => {
        preparedMeetingAuthority = authority;
        return result;
      }).catch((error) => {
        preparation = null;
        preparedMeetingAuthority = null;
        preparationKey = null;
        throw error;
      });
    } catch (error) {
      preparation = null;
      preparedMeetingAuthority = null;
      preparationKey = null;
      throw error;
    }
  }
  return preparation;
}

export function prepareReaderProofRuntime(): Promise<
  readonly { readonly id: ReaderProofRuntimeLoaderId; readonly versionId: string }[]
> {
  return prepareReaderProofRuntimeFor({});
}

export function prepareReaderProductionReadbackRuntime(deployedCommit: string): Promise<
  readonly { readonly id: ReaderProofRuntimeLoaderId; readonly versionId: string }[]
> {
  return prepareReaderProofRuntimeFor({ deployedCommit });
}
