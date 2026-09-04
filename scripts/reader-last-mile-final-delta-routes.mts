import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { campaignMoneyApiAnswer, resolvedCandidacyForOfficial } from "../lib/funding/campaign-money.ts";
import { getFundingSnapshot } from "../lib/funding/snapshot.ts";
import { stateMoneySources } from "../lib/funding/state-snapshot.ts";
import type { StateMoneySnapshot } from "../lib/funding/state-money.ts";
import officialBridge from "../lib/funding/official-candidacies.json" with { type: "json" };
import { ROSTER_READER_DISPOSITIONS } from "../lib/registry/body-rosters.ts";
import { getOutcomeSnapshot } from "../lib/outcomes/store.ts";
import { meetingReaderRecords } from "../lib/meetings/reader-records.ts";

const base = process.env.SHOOT_BASE_URL ?? "http://localhost:3210";
assert.match(new URL(base).hostname, /^(localhost|127\.0\.0\.1)$/);
const outputPath = process.env.READER_PROOF_OUTPUT ?? "docs/evidence/reader-last-mile-final-delta-routes.json";
const proofSourcesPath = process.env.READER_PROOF_SOURCES;
assert.ok(proofSourcesPath, "The frozen final census source fingerprint is required");
const exactHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const records: unknown[] = [];

async function get(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${base}${path}`, { headers: { "x-wtp-synthetic-run": "reader-last-mile-final-delta" } });
  assert.equal(response.status, 200, `${path}: ${response.status} ${await response.clone().text()}`);
  return await response.json() as Record<string, unknown>;
}

const stateTargets = stateMoneySources().flatMap((file) => {
  const match = /^state-money-([a-z]{2})-\d{4}\.json$/.exec(file); assert.ok(match);
  return (JSON.parse(readFileSync(`data/states/${match[1]}/funding/${file}`, "utf8")) as StateMoneySnapshot).records.flatMap((record) => record.targetKeys);
});
const funding = getFundingSnapshot();
const moneyTargets = [...new Set([
  ...stateTargets,
  ...officialBridge.rows.filter((row) => row.status === "RESOLVED").map((row) => row.holder.id),
  ...ROSTER_READER_DISPOSITIONS.filter((row) => row.state !== "READER_ELIGIBLE").map((row) => row.sourceId),
  ...funding.candidates.flatMap((row) => row.targetKeys),
  ...funding.absences.map((row) => row.targetKey),
  "ballot-az-pima:governor|Katie Hobbs",
  "unresolved:Katie Hobbs",
])].sort();

for (let start = 0; start < moneyTargets.length; start += 8) {
  const batch = moneyTargets.slice(start, start + 8);
  records.push(...await Promise.all(batch.map(async (target) => {
    const expected = campaignMoneyApiAnswer(target);
    const actual = await get(`/api/funding/${encodeURIComponent(target)}`);
    assert.deepEqual(actual, JSON.parse(JSON.stringify(expected)), target);
    return { surface: "funding/state-money", target, payload: actual, payloadSha256: hash(actual) };
  })));
}

for (const sitting of getOutcomeSnapshot().sittings) {
  const expected = meetingReaderRecords(sitting.meetingId, sitting.bodyId ?? undefined);
  const actual = await get(`/api/agenda?meetingId=${encodeURIComponent(sitting.meetingId)}`);
  assert.deepEqual(actual.records, expected, sitting.meetingId);
  assert.equal(actual.documentCount, (actual.documents as unknown[]).length);
  records.push({ surface: "agenda/map", meetingId: sitting.meetingId, bodyId: sitting.bodyId, expected: expected.counts, returned: (actual.records as typeof expected).counts, status: expected.status, payloadSha256: hash(actual) });
}

const hobbsCandidacy = "ballot-az-pima:governor:hobbs-katie";
assert.equal(resolvedCandidacyForOfficial("statewide:az/governor")?.candidacyId, hobbsCandidacy);
const hobbsOfficial = campaignMoneyApiAnswer("statewide:az/governor");
const hobbsCard = campaignMoneyApiAnswer("ballot-az-pima:governor|Katie Hobbs");
assert.equal(hobbsOfficial.kind, "state");
assert.equal(hobbsCard.kind, "state");
assert.deepEqual(hobbsOfficial.data.records, hobbsCard.data.records, "Official and ballot aliases must return the same canonical state-money records");
assert.equal(hobbsOfficial.data.resolvedTargetKey, hobbsCandidacy);
assert.equal(hobbsCard.data.resolvedTargetKey, hobbsCandidacy);
const hobbsJson = JSON.stringify(hobbsOfficial);
assert.ok(hobbsJson.includes(hobbsCandidacy));
const unresolved = campaignMoneyApiAnswer("unresolved:Katie Hobbs");
assert.ok(!JSON.stringify(unresolved).includes(hobbsCandidacy), "An unresolved identity cannot inherit Katie Hobbs finance");
const opponentTarget = stateTargets.find((target) => target.includes("governor") && !target.includes("hobbs"));
assert.ok(opponentTarget, "A wrong-person negative control needs another held governor candidacy");
const opponent = campaignMoneyApiAnswer(opponentTarget);
assert.ok(!JSON.stringify(opponent).includes(hobbsCandidacy), "Another candidate cannot inherit Katie Hobbs finance");

const output = {
  exactHead,
  buildId,
  base,
  sourceHashes: JSON.parse(readFileSync(proofSourcesPath, "utf8")),
  execution: "Only the post-checkpoint funding and outcomes HTTP seams were re-executed against the frozen local production build and compared with canonical selectors.",
  denominator: { moneyTargets: moneyTargets.length, outcomeSittings: getOutcomeSnapshot().sittings.length },
  negativeIdentity: { hobbsCandidacy, officialTarget: "statewide:az/governor", ballotTarget: "ballot-az-pima:governor|Katie Hobbs", officialResolution: hobbsOfficial.data.resolution, ballotResolution: hobbsCard.data.resolution, unresolvedTarget: "unresolved:Katie Hobbs", opponentTarget, result: "PASS" },
  records,
};
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ exactHead, buildId, ...output.denominator, negativeIdentity: output.negativeIdentity }, null, 2));
