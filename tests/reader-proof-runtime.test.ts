import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  READER_PROOF_RUNTIME_LOADER_IDS,
  deployedReaderRuntimeTreeUnchanged,
  loadReaderProofMeetingsExpectedAuthority,
  normalDocumentaryMergeOverAuthority,
  readerProofMeetingPartitionIdentity,
  requireReaderProofAuthorityHeadBinding,
  requireReaderProofAuthorityReadConnection,
  readerProofMeetingsAuthorityFromImport,
  requiredPreparedReaderProofMeetingsAuthority,
  runReaderProofRuntimeLoaders,
  type ReaderProofRuntimeLoaders,
} from "../scripts/lib/reader-proof-runtime.ts";
import type {
  ReaderExecutionAuthorityArchivedSupportAdmission,
} from "../lib/holdings/reader-execution-authority.ts";
import {
  readerClosureReadConnectionIdentity,
  type ReaderClosureExecutionAuthorityEvidence,
} from "../lib/holdings/reader-census.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { pdcV2CanonicalMeetingFactEvidence } from "../lib/civic-data/store.ts";
import {
  readSnapshot,
  requireReaderProofMeetingsProjection,
  type ReaderProofMeetingsExpectedAuthority,
} from "../lib/meetings/snapshot.ts";

function loaders(
  override: Partial<ReaderProofRuntimeLoaders> = {},
  calls: string[] = [],
): ReaderProofRuntimeLoaders {
  return Object.fromEntries(READER_PROOF_RUNTIME_LOADER_IDS.map((id) => [
    id,
    override[id] ?? (async () => {
      calls.push(id);
      return `${id}:promoted`;
    }),
  ])) as unknown as ReaderProofRuntimeLoaders;
}

test("documentary Reader proof initializes every required promoted authority exactly once", async () => {
  const calls: string[] = [];
  const results = await runReaderProofRuntimeLoaders(loaders({}, calls));
  assert.deepEqual([...calls].sort(), [...READER_PROOF_RUNTIME_LOADER_IDS].sort());
  assert.deepEqual(results.map(({ id }) => id), READER_PROOF_RUNTIME_LOADER_IDS);
  assert.ok(results.every(({ versionId }) => versionId.endsWith(":promoted")));
  assert.equal(READER_PROOF_RUNTIME_LOADER_IDS.includes("az-state-rollcalls" as never), false);
  assert.equal(READER_PROOF_RUNTIME_LOADER_IDS.includes("nh-state-rollcalls" as never), false);
  assert.equal(READER_PROOF_RUNTIME_LOADER_IDS.includes("nj-state-rollcalls" as never), false);
});

test("documentary Reader proof rejects an absent or failed required authority", async () => {
  await assert.rejects(
    runReaderProofRuntimeLoaders(loaders({ "candidate-corpus": async () => null })),
    /candidate-corpus Reader proof authority has no promoted version/,
  );
  await assert.rejects(
    runReaderProofRuntimeLoaders(loaders({
      "registry-runtime-bindings": async () => {
        throw new Error("STORE_UNREACHABLE");
      },
    })),
    /STORE_UNREACHABLE/,
  );
});

test("documentary Reader meeting authority fails closed before explicit phase admission", () => {
  assert.throws(
    () => loadReaderProofMeetingsExpectedAuthority(process.cwd(), {}),
    /READER_EXECUTION_AUTHORITY_EVIDENCE is required/,
  );
  assert.throws(
    () => requiredPreparedReaderProofMeetingsAuthority(),
    /requested before strict runtime preparation/,
  );
});

test("Reader proof authority binds the actual read-only connection without exposing it", () => {
  const connection = "postgresql://readonly_reader:secret-one@ep-proof-pooler.example.test/civic";
  const identity = readerClosureReadConnectionIdentity(connection);
  const evidence = {
    store: {
      endpointIdentitySha256: identity.endpointIdentitySha256,
      databaseIdentitySha256: identity.databaseIdentitySha256,
      schemaIdentitySha256: identity.schemaIdentitySha256,
    },
    readOnly: { roleIdentitySha256: identity.roleIdentitySha256 },
  } as unknown as Pick<ReaderClosureExecutionAuthorityEvidence, "store" | "readOnly">;
  assert.doesNotThrow(() => requireReaderProofAuthorityReadConnection(evidence, connection));
  assert.throws(
    () => requireReaderProofAuthorityReadConnection(
      evidence,
      "postgresql://readonly_reader:secret-two@ep-other.example.test/civic",
    ),
    /connection identity differs/,
  );
  assert.throws(
    () => requireReaderProofAuthorityReadConnection(evidence, undefined),
    /active read-only DATABASE_URL/,
  );
});

test("Reader proof authority permits a descendant only for an unchanged validated production merge", () => {
  const authorityHead = "a".repeat(40);
  const deployedCommit = "b".repeat(40);
  assert.doesNotThrow(() => requireReaderProofAuthorityHeadBinding({
    phase: "REHEARSAL",
    authorityHead,
    currentHead: authorityHead,
  }));
  assert.throws(() => requireReaderProofAuthorityHeadBinding({
    phase: "REHEARSAL",
    authorityHead,
    currentHead: deployedCommit,
  }), /exact documentary head/);
  assert.doesNotThrow(() => requireReaderProofAuthorityHeadBinding({
    phase: "PRODUCTION",
    authorityHead,
    currentHead: deployedCommit,
    deployedCommit,
    authorityIsAncestor: true,
    deployedRuntimeTreeUnchanged: true,
    checkoutClean: true,
    deployedMergeTopologyValid: true,
    productionClosureFailures: [],
  }));
  assert.throws(() => requireReaderProofAuthorityHeadBinding({
    phase: "REHEARSAL",
    authorityHead,
    currentHead: deployedCommit,
    deployedCommit,
    authorityIsAncestor: true,
    deployedRuntimeTreeUnchanged: true,
    checkoutClean: true,
    deployedMergeTopologyValid: true,
    productionClosureFailures: [],
  }), /requires PRODUCTION/);
  assert.throws(() => requireReaderProofAuthorityHeadBinding({
    phase: "PRODUCTION",
    authorityHead,
    currentHead: deployedCommit,
    deployedCommit,
    authorityIsAncestor: false,
    deployedRuntimeTreeUnchanged: true,
    checkoutClean: true,
    deployedMergeTopologyValid: true,
    productionClosureFailures: [],
  }), /not an ancestor/);
  assert.throws(() => requireReaderProofAuthorityHeadBinding({
    phase: "PRODUCTION",
    authorityHead,
    currentHead: deployedCommit,
    deployedCommit,
    authorityIsAncestor: true,
    deployedRuntimeTreeUnchanged: false,
    checkoutClean: true,
    deployedMergeTopologyValid: true,
    productionClosureFailures: [],
  }), /readback runtime changed/);
  assert.throws(() => requireReaderProofAuthorityHeadBinding({
    phase: "PRODUCTION",
    authorityHead,
    currentHead: deployedCommit,
    deployedCommit,
    authorityIsAncestor: true,
    deployedRuntimeTreeUnchanged: true,
    checkoutClean: false,
    deployedMergeTopologyValid: true,
    productionClosureFailures: [],
  }), /uncommitted files/);
  assert.throws(() => requireReaderProofAuthorityHeadBinding({
    phase: "PRODUCTION",
    authorityHead,
    currentHead: deployedCommit,
    deployedCommit,
    authorityIsAncestor: true,
    deployedRuntimeTreeUnchanged: true,
    checkoutClean: true,
    deployedMergeTopologyValid: false,
    productionClosureFailures: [],
  }), /normal two-parent merge/);
  assert.throws(() => requireReaderProofAuthorityHeadBinding({
    phase: "PRODUCTION",
    authorityHead,
    currentHead: deployedCommit,
    deployedCommit,
    authorityIsAncestor: true,
    deployedRuntimeTreeUnchanged: true,
    checkoutClean: true,
    deployedMergeTopologyValid: true,
    productionClosureFailures: ["fixture closure failure"],
  }), /fixture closure failure/);
  assert.throws(() => requireReaderProofAuthorityHeadBinding({
    phase: "PRODUCTION",
    authorityHead,
    currentHead: deployedCommit,
    deployedCommit,
    authorityIsAncestor: true,
    deployedRuntimeTreeUnchanged: true,
    checkoutClean: true,
    deployedMergeTopologyValid: true,
  }), /closure is not valid/);
});

test("deployed Reader runtime closure admits documentary-only descendants and rejects source drift", (t) => {
  const root = mkdtempSync(join(tmpdir(), "reader-runtime-tree-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path: string, value: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), value);
  };
  write("scripts/reader-last-mile-production-readback.mts", 'import "./lib/reader-proof-runtime.ts";\n');
  write("scripts/lib/reader-proof-runtime.ts", 'import "../../lib/holdings/reader-census.ts";\n');
  write("lib/holdings/reader-census.ts", 'import "./reader-execution-authority.ts";\n');
  write("lib/holdings/reader-execution-authority.ts", "export const authority = true;\n");
  write("lib/meetings/snapshot.ts", "export const meetings = true;\n");
  write("lib/civic-data/meeting-partitions.ts", "export const partitions = true;\n");
  write("next.config.ts", "export default {};\n");
  write("package.json", '{"private":true}\n');
  write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  write("tsconfig.json", '{"compilerOptions":{"moduleResolution":"bundler"}}\n');
  write("docs/evidence/reader-last-mile-production-authority.json", "{}\n");
  write("docs/repo-inventory.md", "B\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init");
  git("config", "user.name", "Reader Proof Test");
  git("config", "user.email", "reader-proof@example.invalid");
  git("config", "core.autocrlf", "false");
  git("add", ".");
  git("commit", "-m", "B");
  const b = git("rev-parse", "HEAD");
  git("branch", "main", b);
  write("docs/evidence/reader-last-mile-production-authority.json", '{"phase":"PRODUCTION"}\n');
  write("docs/repo-inventory.md", "E\n");
  git("add", ".");
  git("commit", "-m", "E");
  const e = git("rev-parse", "HEAD");
  assert.equal(deployedReaderRuntimeTreeUnchanged(root, b, e), true);
  assert.equal(normalDocumentaryMergeOverAuthority(root, b, e), false);
  git("checkout", "main");
  git("merge", "--no-ff", e, "-m", "M");
  const m = git("rev-parse", "HEAD");
  assert.equal(normalDocumentaryMergeOverAuthority(root, b, m), true);
  assert.equal(deployedReaderRuntimeTreeUnchanged(root, b, m), true);
  git("checkout", "-b", "tsconfig-drift");
  write("tsconfig.json", '{"compilerOptions":{"moduleResolution":"node"}}\n');
  git("add", ".");
  git("commit", "-m", "tsconfig drift");
  assert.equal(deployedReaderRuntimeTreeUnchanged(root, b, git("rev-parse", "HEAD")), false);
  git("checkout", "main");
  write("scripts/lib/reader-proof-runtime.ts", 'import "../../lib/holdings/reader-census.ts";\nexport const changed = true;\n');
  git("add", ".");
  git("commit", "-m", "runtime drift");
  const changed = git("rev-parse", "HEAD");
  assert.equal(deployedReaderRuntimeTreeUnchanged(root, b, changed), false);
});

type MeetingProofInput = Parameters<typeof requireReaderProofMeetingsProjection>[0];
type MeetingReadback = Extract<MeetingProofInput, { kind: "PROMOTED" }>["partitions"][number];

function frozenMeetingAuthority(): ReaderProofMeetingsExpectedAuthority {
  const frozen = readSnapshot();
  assert.ok(frozen, "the bundled frozen trusted-LKG meetings snapshot is present");
  const aggregate = pdcV2CanonicalMeetingFactEvidence([frozen]);
  const partitions = MEETING_PARTITION_CONTRACTS.map((partition) => {
    const promoted = frozen.meetings.some((meeting) =>
      meeting.bodyId === partition.bodyId && meeting.id.startsWith(`${partition.meetingSource}:`)
    );
    return {
      contractId: partition.id,
      kind: promoted ? "PROMOTED" as const : "NOT_RECORDED" as const,
      versionId: promoted ? `${partition.id}:trusted-lkg-test-version` : null,
    };
  });
  return {
    meetingPartitionsWithLkg: partitions.filter(({ kind }) => kind === "PROMOTED").length,
    meetingPartitionsWithoutLkg: partitions.filter(({ kind }) => kind === "NOT_RECORDED").length,
    legacyMeetingsAggregate: {
      factSha256: aggregate.sha256,
      meetingRowCount: aggregate.meetingRowCount,
      agendaDocumentRowCount: aggregate.agendaDocumentRowCount,
    },
    partitions,
  };
}

function frozenImportAdmission(): ReaderExecutionAuthorityArchivedSupportAdmission {
  const dispositionSet = frozenMeetingAuthority().partitions
    .filter(({ kind }) => kind === "PROMOTED")
    .map(({ contractId, versionId }) => ({
      contractId,
      candidateId: versionId!,
      disposition: "PROMOTED_ABSENT_POINTER" as const,
      versionId: versionId!,
      readerReadback: "PASS" as const,
    }));
  return {
    importerCodeSha: "a".repeat(40),
    dispositionSet,
    zeroMeetingPartitionsRefused: 41,
    dispositionSetSha256: "b".repeat(64),
    legacyMeetingsAggregate: frozenMeetingAuthority().legacyMeetingsAggregate,
  };
}

test("meeting proof derives the exact 83/41 authority from admitted import membership", () => {
  const authority = readerProofMeetingsAuthorityFromImport(frozenImportAdmission());
  // 124 imported (83 promoted / 41 zero-LKG) + 1 registered after the import
  // (PDC_V2_POST_IMPORT_MEETING_PARTITIONS), NOT_RECORDED until the runner gains it.
  assert.equal(authority.partitions.length, 125);
  assert.equal(authority.meetingPartitionsWithLkg, 83);
  assert.equal(authority.meetingPartitionsWithoutLkg, 42);
  assert.deepEqual(authority, frozenMeetingAuthority());

  const admission = frozenImportAdmission();
  assert.throws(
    () => readerProofMeetingsAuthorityFromImport({
      ...admission,
      dispositionSet: admission.dispositionSet.slice(1),
    }),
    /denominator differs from the permanent 83\/41 authority/,
  );
  assert.throws(
    () => readerProofMeetingsAuthorityFromImport({
      ...admission,
      zeroMeetingPartitionsRefused: 42,
    }),
    /denominator differs from the permanent 83\/41 authority/,
  );
  assert.throws(
    () => readerProofMeetingsAuthorityFromImport({
      ...admission,
      dispositionSet: [
        ...admission.dispositionSet,
        {
          contractId: "meetings:unexpected:partition",
          candidateId: "unexpected-version",
          disposition: "PROMOTED_ABSENT_POINTER",
          versionId: "unexpected-version",
          readerReadback: "PASS",
        },
      ],
    }),
    /unregistered meeting partition/,
  );
});

function meetingProofInput(
  partitions: readonly MeetingReadback[] = frozenMeetingAuthority().partitions.map((expected) => {
    const partition = MEETING_PARTITION_CONTRACTS.find(({ id }) => id === expected.contractId)!;
    return {
      contractId: partition.id,
      source: partition.meetingSource,
      bodyId: partition.bodyId,
      scope: partition.scope,
      kind: expected.kind,
      versionId: expected.versionId,
      detail: expected.kind === "PROMOTED" ? null : "No frozen LKG pointer was imported.",
    };
  }),
  value = readSnapshot()!,
): MeetingProofInput {
  return {
    kind: "PROMOTED",
    value,
    metadata: {} as never,
    partitions,
    detail: "83/124 proof-valid source/body partitions composed",
  };
}

test("meeting proof identity binds all promoted and intentional no-LKG partitions independent of readback order", () => {
  const expected = frozenMeetingAuthority();
  const input = meetingProofInput();
  assert.equal(input.kind, "PROMOTED");
  if (input.kind !== "PROMOTED") return;
  assert.equal(input.partitions.length, 125);
  assert.equal(input.partitions.filter(({ kind }) => kind === "PROMOTED").length, 83);
  assert.equal(input.partitions.filter(({ kind }) => kind === "NOT_RECORDED").length, 42);
  assert.equal(expected.meetingPartitionsWithLkg, 83);
  assert.equal(expected.meetingPartitionsWithoutLkg, 42);
  assert.equal(requireReaderProofMeetingsProjection(input, expected), input.value);
  const identity = readerProofMeetingPartitionIdentity(input, expected);
  const reversed = meetingProofInput([...input.partitions].reverse());
  assert.equal(reversed.kind, "PROMOTED");
  if (reversed.kind !== "PROMOTED") return;
  assert.equal(
    requireReaderProofMeetingsProjection(
      reversed,
      { ...expected, partitions: [...expected.partitions].reverse() },
    ),
    reversed.value,
  );
  assert.equal(readerProofMeetingPartitionIdentity(reversed, expected), identity);
});

test("meeting proof identity rejects incomplete, ambiguous, or unreadable partition authority", () => {
  const expected = frozenMeetingAuthority();
  const input = meetingProofInput();
  assert.equal(input.kind, "PROMOTED");
  if (input.kind !== "PROMOTED") return;
  const rows = [...input.partitions];
  const changed = (index: number, patch: Partial<MeetingReadback>) => rows.map((row, rowIndex) =>
    rowIndex === index ? { ...row, ...patch } as MeetingReadback : row
  );

  assert.throws(
    () => requireReaderProofMeetingsProjection(input, undefined as never),
    /expected phase-import authority was not provided/,
  );
  assert.throws(() => requireReaderProofMeetingsProjection(meetingProofInput(rows.slice(1)), expected), /missing, duplicate, or unexpected/);
  assert.throws(() => requireReaderProofMeetingsProjection(meetingProofInput(changed(rows.length - 1, { contractId: rows[0]!.contractId })), expected), /missing, duplicate, or unexpected/);
  assert.throws(() => requireReaderProofMeetingsProjection(meetingProofInput(changed(rows.length - 1, { contractId: "unexpected-meeting-contract" })), expected), /missing, duplicate, or unexpected/);
  const promotedIndex = rows.findIndex(({ kind }) => kind === "PROMOTED");
  const notRecordedIndex = rows.findIndex(({ kind }) => kind === "NOT_RECORDED");
  assert.notEqual(promotedIndex, -1);
  assert.notEqual(notRecordedIndex, -1);
  assert.throws(() => requireReaderProofMeetingsProjection(meetingProofInput(changed(promotedIndex, { versionId: null })), expected), /promoted meeting partition has no version/);
  // RULING 290: a different versionId on a promoted partition is allowed (runner advances versions).
  assert.equal(requireReaderProofMeetingsProjection(meetingProofInput(changed(promotedIndex, { versionId: "runner-advanced-version" })), expected), input.value);
  // RULING 290 history note: a GAIN (import NOT_RECORDED -> now PROMOTED = a runner-promoted new
  // meeting) is ACCEPTED and counted; the census proves the gained partition (counts follow the
  // gain: 84 promoted / 40 not-recorded against the frozen 83/41).
  assert.equal(requireReaderProofMeetingsProjection(meetingProofInput(changed(notRecordedIndex, { kind: "PROMOTED", versionId: "runner-promoted-gain" })), expected), input.value);
  assert.throws(() => requireReaderProofMeetingsProjection(meetingProofInput(changed(notRecordedIndex, { versionId: "forged-version" })), expected), /NOT_RECORDED meeting partition names a version/);
  assert.throws(() => requireReaderProofMeetingsProjection(meetingProofInput(changed(notRecordedIndex, { kind: "BOOTSTRAP" })), expected), /meeting partition is BOOTSTRAP/);
  assert.throws(() => requireReaderProofMeetingsProjection(meetingProofInput(changed(notRecordedIndex, { kind: "STORE_UNREACHABLE" })), expected), /meeting partition is STORE_UNREACHABLE/);
  assert.throws(() => requireReaderProofMeetingsProjection({ kind: "BOOTSTRAP", value: {} as never, metadata: {} as never, detail: "fixture" }, expected), /Meeting Reader proof authority is BOOTSTRAP/);
  assert.throws(
    () => requireReaderProofMeetingsProjection(
      meetingProofInput(changed(promotedIndex, { kind: "NOT_RECORDED", versionId: null })),
      expected,
    ),
    /regressed from the phase import authority: expected PROMOTED, got NOT_RECORDED/,
  );

  const swapped = rows.map((row, index) => {
    if (index === promotedIndex) return { ...row, kind: "NOT_RECORDED" as const, versionId: null };
    if (index === notRecordedIndex) return { ...row, kind: "PROMOTED" as const, versionId: `${row.contractId}:forged-swap` };
    return row;
  });
  assert.equal(swapped.filter(({ kind }) => kind === "PROMOTED").length, expected.meetingPartitionsWithLkg);
  assert.equal(swapped.filter(({ kind }) => kind === "NOT_RECORDED").length, expected.meetingPartitionsWithoutLkg);
  // A swap keeps the 83/41 counts but disguises a LOSS with a compensating gain; the loss is
  // still a hard failure (a promoted partition may not lose its LKG), even though the gain alone
  // would now be accepted.
  assert.throws(
    () => requireReaderProofMeetingsProjection(meetingProofInput(swapped), expected),
    /regressed from the phase import authority/,
  );

  // RULING 290: runner reorganizes data during promotion; aggregate comparison dropped.
  // Zero meetings still fails.
  const emptyMeetings = { ...input.value, meetings: [] };
  assert.throws(
    () => readerProofMeetingPartitionIdentity(
      meetingProofInput(input.partitions, emptyMeetings),
      expected,
    ),
    /zero meeting rows/,
  );
  // RULING 290: different SHA and row counts are allowed (runner reorganizes data).
  assert.ok(readerProofMeetingPartitionIdentity(input, {
    ...expected,
    legacyMeetingsAggregate: {
      ...expected.legacyMeetingsAggregate,
      factSha256: "c".repeat(64),
    },
  }));
  assert.ok(readerProofMeetingPartitionIdentity(input, {
    ...expected,
    legacyMeetingsAggregate: {
      ...expected.legacyMeetingsAggregate,
      meetingRowCount: expected.legacyMeetingsAggregate.meetingRowCount + 1,
    },
  }));
  assert.ok(readerProofMeetingPartitionIdentity(input, {
    ...expected,
    legacyMeetingsAggregate: {
      ...expected.legacyMeetingsAggregate,
      agendaDocumentRowCount: expected.legacyMeetingsAggregate.agendaDocumentRowCount + 1,
    },
  }));
  assert.throws(
    () => readerProofMeetingPartitionIdentity(input, {
      ...expected,
      legacyMeetingsAggregate: {
        ...expected.legacyMeetingsAggregate,
        meetingRowCount: 0,
      },
    }),
    /expected legacy aggregate authority is invalid/,
  );
  assert.throws(
    () => readerProofMeetingPartitionIdentity(input, {
      ...expected,
      legacyMeetingsAggregate: {
        ...expected.legacyMeetingsAggregate,
        agendaDocumentRowCount: 0,
      },
    }),
    /expected legacy aggregate authority is invalid/,
  );
});

test("exact documentary producers do not reopen reviewed first-seed or stale proof artifacts", () => {
  const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  assert.doesNotMatch(source("scripts/lib/reader-ask-corpus-proof.ts"), /reader-last-mile-ask-after\.json/);
  assert.doesNotMatch(source("scripts/lib/reader-ask-officials-proof.ts"), /\bBODY_ROSTERS\b/);
  assert.doesNotMatch(source("scripts/reader-last-mile-render.mts"), /\bBODY_ROSTERS\b/);
  assert.doesNotMatch(source("scripts/lib/reader-body-render-proof.ts"), /lib\/registry\/registry\.json/);
  assert.doesNotMatch(source("scripts/reader-last-mile-routes.mts"), /data\/congress-legislators\/directory\.json|PRODUCTION_OFFICEHOLDER_ROSTER_FILES|\bSTATEWIDE_EXECUTIVES\b|\bROSTER_READER_DISPOSITIONS\b/);
  assert.doesNotMatch(source("scripts/reader-last-mile-final-delta-routes.mts"), /\bROSTER_READER_DISPOSITIONS\b/);
  assert.doesNotMatch(source("lib/holdings/reader-census.ts"), /\brosterMemberReaderDisposition\b|rosters\.BODY_ROSTERS/);

  const productionEntrypoint = "scripts/reader-last-mile-production-readback.mts";
  const descendantCallsites: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(new URL(`../${directory}/`, import.meta.url), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (/\.(?:ts|tsx|mts|mjs)$/.test(path) && path !== "scripts/lib/reader-proof-runtime.ts") {
        if (/\bprepareReaderProductionReadbackRuntime\s*\(/.test(source(path))) descendantCallsites.push(path);
      }
    }
  };
  visit("scripts");
  assert.deepEqual(descendantCallsites, [productionEntrypoint]);
});
