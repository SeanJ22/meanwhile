/** Replay data changes against SELECT-only production exports; all mutations stay in memory. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { mock } from 'node:test';
import { BallotContestMerge } from '../lib/civic-data/worker-ballot-contests.ts';
import { manualProjectionCandidate, readManualProjectionPrior } from '../lib/civic-data/manual-projections.ts';
import { processRegisteredManualCandidate } from '../lib/civic-data/promotion.ts';
import { MemoryRoutineDataStore } from '../lib/civic-data/store.ts';
import { CivicPayloadParts } from '../lib/civic-data/payload-parts.ts';
import { decodeStateCandidate } from '../lib/civic-data/state-publication.ts';
import { canonicalCivicDataHash } from '../lib/civic-data/canonical-hash.ts';
import { runBallotPublication } from './assemble-ballot-package.mts';
import { readerBallotSourcesForDivisions } from '../lib/ballot/reader-sources.ts';
import { readPromotedCivicData } from '../lib/civic-data/read-model.ts';
import { ballotPublicationDue } from '../lib/civic-data/ballot-publication.ts';
import { ballotInputStamp } from '../lib/civic-data/ballot-input.ts';
import { stateBallotScope, type BallotState } from '../lib/civic-data/state-scopes.ts';
import { zipDivisionEntry } from '../lib/geo/zip-division-index.ts';
import type { GenericBallotProjection } from '../lib/ballot/generic-projection.ts';
import type { CandidateVersionRecord, PromotedProjection } from '../lib/civic-data/types.ts';

const root = process.cwd(), snapshotDirectory = resolve(root, '.scratch');
const actualRunAt = new Date().toISOString();
const baselineRevision = process.argv.find(arg => arg.startsWith('--baseline='))?.slice(11) ?? '78f82a232dd1d0545a46835e7716032ff3807425';
const states = (process.argv.find(arg => arg.startsWith('--states='))?.slice(9) ?? 'CA,MA,MI,AK,DE,TX,DC,NE,UT,ME,OR,FL,OH').split(',') as BallotState[];
const now = '2026-10-23T12:00:00.000Z', tomorrow = '2026-10-24T12:00:00.000Z';
mock.timers.enable({ apis: ['Date'], now: Date.parse(now) });
const directory = resolve(root, 'data/ballot/2026-general');
const outputDirectory = resolve(root, '.scratch/bl02-replay');
await mkdir(outputDirectory, { recursive: true });
const baselineDirectory = resolve(outputDirectory, 'original-inputs');
await mkdir(baselineDirectory, { recursive: true });
const report: Record<string, unknown> = { checkedAt: actualRunAt, baselineRevision,
  production: { projectId: 'tiny-hill-13996172', branchId: 'br-delicate-lab-ax02xuo5', branchName: 'production',
    acquisition: 'SELECT-only canonical state reader query, exact candidate and recursive payload parts exported through connected Neon', writes: 0 },
  replay: 'Ordinary state assembler, promotion validation and typed reader in MemoryRoutineDataStore; no production publication',
  upstream: 'BA-01 certified state ballot holdings and official district lists; Census ZIP geography',
  downstream: 'Standing ballot-contests:<state> publisher → canonical state ballot → readerBallotSourcesForDivisions → ballot page',
  clocks: { now, tomorrow }, states: [] };
try {
  const previous = JSON.parse(await readFile('data/ballot/reports/bl02-readonly-replay.json', 'utf8'));
  report.states = previous.states.filter((row: { state: BallotState }) => !states.includes(row.state));
} catch { /* First replay. */ }

for (const state of states) {
  const file = resolve(snapshotDirectory, `bl02-production-${state.toLowerCase()}-full.json`);
  const bytes = await readFile(file);
  const raw = JSON.parse(bytes.toString())[0];
  assert.equal(raw.proof_valid, true, `${state}: production SQL proof`);
  const parts = new CivicPayloadParts({ existing: async () => [], write: async () => assert.fail('Export decoder is read only'), read: async () => assert.fail('No network reads from replay') });
  const loaded = await parts.loadOwned(raw.roots, raw.parts) as { projection: PromotedProjection<GenericBallotProjection>; candidate: CandidateVersionRecord };
  loaded.candidate.candidate = decodeStateCandidate(loaded.candidate.candidate);
  loaded.candidate.receipt = loaded.projection.receipt;
  assert.equal(canonicalCivicDataHash(loaded.projection.payload), loaded.candidate.candidate.normalization.normalizedHash);
  const store = new MemoryRoutineDataStore();
  // Seed exact exported rows, not newly invented validation receipts.
  (store as unknown as { candidates: Map<string, CandidateVersionRecord> }).candidates.set(loaded.candidate.candidate.id, loaded.candidate);
  (store as unknown as { promotions: Map<string, PromotedProjection> }).promotions.set(loaded.projection.key, loaded.projection);
  const oldEnvironment = { ...process.env };
  Object.assign(process.env, { WTP_RUNTIME_MODE: 'staging', WTP_DB_ROLE: 'local', DATABASE_URL: 'postgresql://replay:replay@memory.invalid/reader',
    WTP_CONTROL_PLANE_DATABASE_URL: 'postgresql://replay:replay@memory.invalid/control' });
  try {
    mock.timers.setTime(Date.parse(now));
    const first = await runBallotPublication({ state, directory, store, now });
    assert.equal(first.report.status, 'PUBLISHED', `${state}: ${first.report.reason}`);
    const scope = stateBallotScope('ballot-contests', state);
    let firstRead = await readPromotedCivicData<GenericBallotProjection>('BALLOT_CANDIDACY', scope, { store, now, bypassCache: true });
    assert.equal(firstRead.kind, 'PROMOTED');
    if (firstRead.kind !== 'PROMOTED') throw Error('Missing replay output');
    const incoming = JSON.parse(await readFile(resolve(directory, `${state.toLowerCase()}.json`), 'utf8'));
    const expectedMembers = Object.entries(incoming.ballots).flatMap(([key, value]: [string, any]) => (value.districtMemberships ?? []).map((row: any) => ({ key, id: row.id, member: row.memberOcdId, district: row.districtOcdId })));
    const missingMembers = (value: GenericBallotProjection) => expectedMembers.filter(expected => !(value.ballots[expected.key] as any)?.districtMemberships?.some((row: any) => row.id === expected.id && row.memberOcdId === expected.member && row.districtOcdId === expected.district));
    const ordinaryMissing = missingMembers(firstRead.value);
    let maintenanceVersion: string | null = null;
    if (ordinaryMissing.length) {
      // Existing explicit data-publication API supports a distinct version when
      // optional ballot metadata changed but record-level facts did not.
      const contractId = `ballot-contests:${state}` as const;
      const prior = await readManualProjectionPrior(contractId, store, now);
      const sourceThrough = [prior?.temporal?.sourceThrough ?? '', ...incoming.sourceReceipt.sources.map((row: any) => row.retrievedAt)].filter(Boolean).sort().at(-1)!;
      const merge = new BallotContestMerge({ contractId, version: prior?.temporal?.version ?? '2026-general', sourceThrough,
        sourceReceipt: { ...incoming.sourceReceipt, reviewedAt: now, reviewedBy: 'BL-02 data maintenance' }, payload: { kind: 'ballot-contests', ballots: incoming.ballots } }, prior, { checkAuthority: true });
      for (const [key, ballot] of Object.entries(incoming.ballots) as [string, any][]) {
        for (const field of ['contests', 'heldContests']) for (const row of ballot[field] ?? []) merge.add(key, field, row);
        for (const [field, rows] of Object.entries(ballot)) {
          if (['contests', 'heldContests'].includes(field)) continue;
          if (Array.isArray(rows)) for (const row of rows) merge.add(key, field, row);
          else if (['generalLineup', 'measureAnalyses', 'lineupReconciliation'].includes(field))
            for (const [child, values] of Object.entries(rows as object)) if (Array.isArray(values)) for (const row of values) merge.add(key, `${field}.${child}`, row);
        }
      }
      const candidate = manualProjectionCandidate(merge.finish());
      const published = await processRegisteredManualCandidate(store, contractId, candidate, now, prior?.versionId, { confirmUnchanged: false });
      assert.ok(published.promoted, published.candidate.failureDetail ?? 'Explicit data update held');
      assert.equal(published.readerReadback?.status, 'PASS', JSON.stringify(published.readerReadback));
      maintenanceVersion = published.promoted.versionId;
      firstRead = await readPromotedCivicData<GenericBallotProjection>('BALLOT_CANDIDACY', scope, { store, now, bypassCache: true });
      assert.equal(firstRead.kind, 'PROMOTED');
      if (firstRead.kind !== 'PROMOTED') throw Error('Missing explicit data update');
    }
    assert.deepEqual(missingMembers(firstRead.value), [], `${state}: every prepared district membership reaches the typed reader`);
    const payload = firstRead.value;
    const beforeIds = new Set(Object.values(loaded.projection.payload.ballots).flatMap(b => [...b.contests, ...b.candidacies, ...b.measures].map(r => r.id)));
    const afterIds = new Set(Object.values(payload.ballots).flatMap(b => [...b.contests, ...b.candidacies, ...b.measures].map(r => r.id)));
    assert.deepEqual([...beforeIds].filter(id => !afterIds.has(id)), []);
    const zips = state === 'CA' ? ['94118'] : state === 'MA' ? ['02601','02133'] : state === 'MI' ? ['48226'] : [];
    const selections = [];
    for (const zip of zips) {
      const indexed = await zipDivisionEntry(zip);
      assert.ok(indexed);
      const sources = await readerBallotSourcesForDivisions(indexed.ids, { store, now, bypassCache: true });
      const ballots = await Promise.all(sources.map(async row => row.source.normalize(await row.source.fetch())));
      const contests = ballots.flatMap(b => b.contests).map(c => ({ id: c.id, title: c.title, ocdId: c.ocdId }));
      if (zip === '94118') {
        assert.ok(contests.some(c => /equalization.*2/i.test(c.title)), '94118: BOE District 2 reaches ordinary reader');
        assert.ok(contests.some(c => /bart.*8/i.test(c.title)), '94118: BART District 8 reaches ordinary reader');
      }
      selections.push({ zip, contests });
    }
    mock.timers.setTime(Date.parse(tomorrow));
    const same = await runBallotPublication({ state, directory, store, now: tomorrow });
    assert.equal(same.report.status, 'PUBLISHED', `${state}: next-day replay ${same.report.reason}`);
    const nextRead = await readPromotedCivicData<GenericBallotProjection>('BALLOT_CANDIDACY', scope, { store, now: tomorrow, bypassCache: true });
    assert.equal(nextRead.kind, 'PROMOTED');
    if (nextRead.kind !== 'PROMOTED') throw Error('Missing next-day output');
    assert.deepEqual(nextRead.value, payload, `${state}: next day retains payload`);
    const stamp = await ballotInputStamp(directory, state);
    const task = `ballot-contests:${state}`;
    const unchangedDue = ballotPublicationDue(task, stamp, same.report, { lastSucceededAt: tomorrow });
    assert.equal(unchangedDue, false, 'The actual scheduler reuses unchanged successful state files');
    const baselineFile = openSync(resolve(baselineDirectory, `${state.toLowerCase()}.json`), 'w');
    try { execFileSync('git', ['show', `${baselineRevision}:data/ballot/2026-general/${state.toLowerCase()}.json`], { cwd: root, stdio: ['ignore', baselineFile, 'pipe'] }); }
    finally { closeSync(baselineFile); }
    const stale = await runBallotPublication({ state, directory: baselineDirectory, store, now: tomorrow });
    const staleRead = await readPromotedCivicData<GenericBallotProjection>('BALLOT_CANDIDACY', scope, { store, now: tomorrow, bypassCache: true });
    const staleEqual = staleRead.kind === 'PROMOTED' && canonicalCivicDataHash(staleRead.value) === canonicalCivicDataHash(payload);
    await writeFile(resolve(outputDirectory, `${state.toLowerCase()}.json`), JSON.stringify({ kind: 'PROMOTED', projection: firstRead.projection,
      candidate: await store.readCandidate(firstRead.projection.versionId) }));
    (report.states as unknown[]).push({ state, snapshotSha256: createHash('sha256').update(bytes).digest('hex'), productionVersion: loaded.projection.versionId,
      exportKind: raw.exportKind ?? 'full-candidate-and-projection', inputSha256: createHash('sha256').update(await readFile(resolve(directory, `${state.toLowerCase()}.json`))).digest('hex'),
      replayVersion: firstRead.projection.versionId, publication: 'PUBLISHED', receiptDecision: firstRead.projection.receipt.decision,
      ordinaryAssemblerMissingMemberships: ordinaryMissing.length, maintenance: maintenanceVersion ? { versionId: maintenanceVersion,
        existingApi: 'processRegisteredManualCandidate(..., {confirmUnchanged:false})', reason: 'Existing record-change detector omits districtMemberships; explicit data replacement carries verified metadata.' } : null,
      expectedMembershipsVerified: expectedMembers.length,
      heldContests: first.report.heldContests, originalIdsLost: 0, selections,
      tomorrow: { unchangedFileScheduled: unchangedDue, forcedOrdinaryReplay: same.report.status, payloadUnchanged: true,
        originalCheckoutReplay: stale.report.status, originalCheckoutPreservesRepair: staleEqual, allRepairedMembershipsRetained: staleRead.kind === 'PROMOTED' && missingMembers(staleRead.value).length === 0,
        originalCheckoutFailure: stale.report.reason },
      outputSha256: canonicalCivicDataHash(payload) });
    console.log(`${state}: ${maintenanceVersion ? 'explicit metadata update' : 'ordinary assembler'} GOOD; ${expectedMembers.length} memberships verified; original-checkout retention=${staleEqual}`);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in oldEnvironment)) delete process.env[key];
    Object.assign(process.env, oldEnvironment);
  }
  await writeFile('data/ballot/reports/bl02-readonly-replay.json', JSON.stringify(report, null, 2) + '\n');
}
mock.timers.reset();
