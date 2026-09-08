import assert from "node:assert/strict";
import test from "node:test";
import { keyVotesAskProof } from "../scripts/lib/reader-ask-key-votes-proof.ts";
import { keyVoteEvidenceFor } from "../lib/ask/key-votes.ts";
import { keyVotesForMember } from "../lib/votes/key-votes-reader.ts";

const subject = { kind: "PERSON" as const, id: "congress:K000377", name: "Mark Kelly" };

test("every current federal official's key-vote answer preserves all exact source maps, entries and linked summaries through real POST", async () => {
  const result = await keyVotesAskProof();
  assert.equal(result.proofs.length, 539);
  assert.deepEqual(result.proofs.filter((proof) => proof.status !== "PROVEN").map((proof) => ({ id: proof.subjectId, missing: proof.missing, entries: proof.missingEntries, bills: proof.missingBills, unexpected: proof.unexpectedKeys })), []);
  assert.equal(new Set(result.proofs.flatMap((proof) => proof.expectedEntryIds)).size, result.keyEntryCount);
  assert.equal(new Set(result.proofs.flatMap((proof) => proof.expectedNativePositionKeys)).size, result.nativePositionMapCount);
  assert.equal(new Set(result.proofs.flatMap((proof) => proof.expectedBillUrls)).size, result.billSummaryCount);
});

test("key-vote identity, missing position, physical-roll deduplication and conflicting position controls fail closed", async () => {
  const unknown = await keyVoteEvidenceFor(subject, ["congress:Z999999"]);
  assert.equal(unknown.records.length, 0);
  const selected = await keyVotesForMember(subject.id);
  const first = selected.rows.find((row) => row.positions[0] && row.refs[0]?.url)!;
  const noPosition = await keyVoteEvidenceFor(subject, [subject.id], async () => ({ ...selected, rows: [{ ...first, positions: [null] }] }));
  assert.ok(noPosition.records.every((record) => record.kind !== "KEY_VOTE_POSITION"));
  assert.ok(noPosition.gaps.some((gap) => /does not establish that they did not vote/.test(gap.statement)));
  const duplicate = await keyVoteEvidenceFor(subject, [subject.id], async () => ({ ...selected, rows: [first, { ...first, entry: { ...first.entry, id: "other-held-question" } }] }));
  const positions = duplicate.records.filter((record) => record.kind === "KEY_VOTE_POSITION");
  assert.equal(positions.length, 1);
  assert.equal(positions[0].keyVote?.positionKeys.length, 2);
  const conflict = await keyVoteEvidenceFor(subject, [subject.id], async () => ({ ...selected, rows: [first, { ...first, positions: [first.positions[0] === "YES" ? "NO" : "YES"] }, first] }));
  assert.ok(conflict.records.every((record) => record.kind !== "KEY_VOTE_POSITION"));
  assert.equal(conflict.denominators.keyVoteIdentityConflicts, 1);
  const unavailable = await keyVoteEvidenceFor(subject, [subject.id], async () => { throw new Error("Missing required position map"); });
  assert.equal(unavailable.records.length, 0);
  assert.equal(unavailable.denominators.keyVoteLoaderFailures, 1);
  assert.ok(unavailable.gaps.every((gap) => gap.whose === "OURS"));
});
