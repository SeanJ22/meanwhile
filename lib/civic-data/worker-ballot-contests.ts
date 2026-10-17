import { consumeStatePublicationRecord, immutableStateValue, reuseStatePublicationRecord } from "./state-publication.ts";
import { parseStateBallotContractId, requireBallotState, stateBallotContractId } from "./state-scopes.ts";
import { recordPublicationFlow } from "./publication-flow.ts";
import { publicationRecordChanges } from "./publication-record-changes.ts";
import { createHash } from "node:crypto";
import type { AutonomousWorkPlan } from "../control-plane/workers/autonomous-plan.ts";
import type { WorkerResultRecord } from "../control-plane/workers/types.ts";
import { linkingPageFrom, section3Contest } from "../control-plane/promotion/section3.ts";
import type { RegistryDivisionMatch } from "./store.ts";
import type { BallotSet, Contest, Candidacy, HeldBallotContest } from "../ballot/types.ts";
import { ballotElectionKey, type GenericBallotProjection } from "../ballot/generic-projection.ts";
import type { ManualProjectionPackage, ManualProjectionPrior } from "./manual-projections.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import { captureIntact, requirePublication, verifiedWorkerRecords } from "./worker-publication-evidence.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { WorkItem } from "../control-plane/work-item.ts";
import type { RoutineDataStore } from "./store.ts";
import { readManualProjectionPrior, manualProjectionCandidate } from "./manual-projections.ts";
import { processRegisteredManualCandidate } from "./promotion.ts";
import { auditPull, capturesForPublication, jobWorkerResults, latestParserResult } from "./worker-publication-evidence.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { mergeWorkerBallotMeasures } from "./worker-ballot-measures.ts";
import { publishOfficialBallotCandidacies } from "./official-candidacy-publication.ts";

const words = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const text = (value: unknown) => typeof value === "string" ? value : "";
const hash = (value: unknown) => createHash("sha256").update(canonicalCivicDataJson(value)).digest("hex").slice(0, 24);
const groupKey = (f: Readonly<Record<string, unknown>>) => canonicalCivicDataJson([words(f.election), words(f.office), words(f.jurisdictionName)]);

export function workerBallotContestsPackage(input: {
  plan: AutonomousWorkPlan; parser: WorkerResultRecord; captures: readonly WorkerPublicationCapture[];
  registry: { payload: { registry: { divisions: readonly RegistryDivisionMatch[] } } } | null; now: string; results?: readonly WorkerResultRecord[]; prior?: ManualProjectionPrior | null;
}): { package: ManualProjectionPackage; heldContests: readonly string[]; changes: ReturnType<typeof publicationRecordChanges> } {
  requirePublication(parseStateBallotContractId(input.plan.publication?.contractId ?? "")?.family === "ballot-contests" && input.plan.contract.schemaVersion === 2, "BALLOT_CONTRACT_UNRESOLVED");
  const checked = verifiedWorkerRecords(input), state = requireBallotState(checked.contract.jurisdiction.state);
  requirePublication(input.plan.publication?.contractId === stateBallotContractId("ballot-contests", state), "BALLOT_STATE_SCOPE_MISMATCH");
  const previousVersionId = input.prior?.versionId ?? null;
  const changes: ReturnType<typeof publicationRecordChanges> = { recordChanges: [], records: { added: 0, changed: 0, reused: 0 } };
  const merge = new BallotContestMerge({ contractId: stateBallotContractId("ballot-contests", state), version: `worker:${input.parser.id}`,
    sourceThrough: input.now, sourceReceipt: checked.sourceReceipt, payload: { kind: "ballot-contests", ballots: {} } }, input.prior ?? null, {
    onContest: (id, value, previous) => {
      const change = publicationRecordChanges({ previousVersionId,
        accepted: [{ recordId: id, readerId: id, value, previous }] });
      changes.recordChanges.push(...change.recordChanges);
      for (const kind of ["added", "changed", "reused"] as const) changes.records[kind] += change.records[kind];
    },
  });
  if (input.plan.contract.recordClass === "BALLOT_MEASURE") {
    const measured = mergeWorkerBallotMeasures({ ...input, checked }, merge);
    return { package: merge.finish(measured.sourceReceipt, measured.sourceThrough), heldContests: measured.heldContests, changes };
  }
  requirePublication(input.plan.contract.recordClass === "BALLOT_CONTEST", "BALLOT_CLASS_MISMATCH");
  const inventory = checked.sourceInventory;
  requirePublication(inventory, "BALLOT_SOURCE_ROWS_MISSING");
  const sourceListComplete = inventory.declaredCount === null || inventory.declaredCount === inventory.rows.length;
  const groups = new Map<string, typeof inventory.rows[number][]>();
  for (const row of inventory.rows) {
    const key = groupKey({ election: row.election?.value, office: row.office?.value, jurisdictionName: row.jurisdictionName?.value });
    const rows = groups.get(key) ?? [];
    rows.push(row); groups.set(key, rows);
  }
  const extractedGroups = new Map<string, typeof checked.extraction.records[number][]>();
  for (const row of checked.extraction.records) {
    const key = groupKey(row.fields), rows = extractedGroups.get(key) ?? [];
    rows.push(row); extractedGroups.set(key, rows);
  }
  const heldContests: string[] = [];
  let accepted = 0;
  const divisionsByLabel = new Map<string, NonNullable<typeof input.registry>["payload"]["registry"]["divisions"][number][]>();
  for (const row of input.registry?.payload.registry.divisions ?? []) if (row.state.toUpperCase() === state) {
    const key = words(row.label), values = divisionsByLabel.get(key) ?? [];
    values.push(row); divisionsByLabel.set(key, values);
  }
  const structured = ["DELIMITED_TEXT", "JSON_RECORDS", "XML_RECORDS"].includes(checked.contract.extraction.format);
  const page = { url: checked.primary.evidence.canonicalUrl, text: checked.primary.evidence.text,
    retrievedAt: checked.primary.observedAt, linkingPage: linkingPageFrom(checked.primary.evidence.canonicalUrl,
      input.captures.filter(captureIntact).map(c => c.evidence)), sourcePolicy: checked.primary.sourcePolicy };
  const pageOffices = structured ? [] : [...new Set(inventory.rows.map(row => text(row.office?.value)))];
  for (const [key, sourceRows] of groups) {
    const listed = sourceRows.map(row => Object.fromEntries(Object.entries(row).map(([name, cell]) => [name, cell.value])));
    const extracted = extractedGroups.get(key) ?? [];
    const f = listed[0];
    const names = listed.map(row => text(row.candidateName));
    const uniqueNames = new Set(names.map(words));
    // Each structured row was replayed from the saved document with its exact election, office and jurisdiction cells.
    const contestPage = structured ? { ...page, text: listed.map(row => Object.values(row).join("\n")).join("\n") } : page;
    const verdict = section3Contest({ page: contestPage, now: input.now, pageOffices, contest: {
      election: text(f.election), office: text(f.office), candidates: names } });
    const divisions = divisionsByLabel.get(words(f.jurisdictionName)) ?? [];
    const verifiedNames = new Set(verdict.verifiedCandidates.map(words));
    const listedCounts = new Map<string, number>(), extractedCounts = new Map<string, number>();
    for (const row of listed) { const name = words(row.candidateName); listedCounts.set(name, (listedCounts.get(name) ?? 0) + 1); }
    for (const row of extracted) { const name = words(row.fields.candidateName); extractedCounts.set(name, (extractedCounts.get(name) ?? 0) + 1); }
    const rows = extracted.filter(row => {
      const name = words(row.fields.candidateName);
      return verifiedNames.has(name) && listedCounts.get(name) === 1 && extractedCounts.get(name) === 1;
    });
    if (!verdict.live || !rows.length || divisions.length !== 1) {
      heldContests.push(`${text(f.election)} / ${text(f.office)} / ${text(f.jurisdictionName)}`); continue;
    }
    const complete = sourceListComplete && names.every(Boolean) && uniqueNames.size === names.length && rows.length === listed.length;
    if (!complete) heldContests.push(`${text(f.election)} / ${text(f.office)} / ${text(f.jurisdictionName)}`);
    const electionId = `${state.toLowerCase()}-${hash([state, text(f.election)])}`;
    const election = { id: electionId, state, name: text(f.election), date: text(rows[0].fields.electionDate) };
    const contestId = `ballot-contest:${hash([state, electionId, text(f.office), divisions[0].ocdId])}`;
    const provenance = { sourceUrl: page.url, sourceOrg: checked.primary.evidence.sourceId, collectedAt: checked.primary.observedAt, verifiedAt: input.now };
    const verified = rows[0].fields;
    const contest: Contest = { id: contestId, electionId, ocdId: divisions[0].ocdId, divisionVintage: divisions[0].sourceDataset,
      title: text(f.office), type: "CANDIDACY", voteFor: typeof verified.voteFor === "number" && verified.voteFor > 0 ? verified.voteFor : null,
      termYears: typeof verified.termYears === "number" ? verified.termYears : null,
      candidateListComplete: complete, scopeNote: complete ? null : "We're working on getting the rest of this candidate list", provenance };
    const candidacies: Candidacy[] = rows.map(row => {
      const value = row.fields;
      return { id: `ballot-candidacy:${hash([contestId, text(value.candidateName)])}`, contestId,
        familyName: text(value.familyName) || text(value.candidateName), givenName: text(value.familyName) ? text(value.givenName) : "",
        partyLabel: text(value.partyLabel) || null, slogan: text(value.slogan) || null,
        incumbent: typeof value.incumbent === "boolean" ? value.incumbent : null, websiteUrl: text(value.websiteUrl) || null, provenance };
    });
    merge.addBallot({ election, contests: [], candidacies: [], measures: [], absences: [] });
    const ballotKey = `${state}:${electionId}`;
    merge.add(ballotKey, "contests", contest);
    if (complete) for (const candidacy of candidacies) merge.add(ballotKey, "candidacies", candidacy);
    accepted++;
  }
  requirePublication(accepted, "NO_VERIFIED_BALLOT_CANDIDATE");
  return { package: merge.finish(), heldContests, changes };
}

const observedAt = (value: unknown): number => {
  if (!value || typeof value !== "object") return 0;
  const row = value as Record<string, unknown>;
  const provenance = row.provenance as Record<string, unknown> | undefined;
  const stamp = provenance?.collectedAt ?? row.collectedAt ?? row.writtenAt ?? row.generatedAt ?? row.curatedAt ?? row.generatedOn;
  return typeof stamp === "string" ? Date.parse(stamp) || 0 : 0;
};

function citedBallotSources(payload: GenericBallotProjection, sources: ManualProjectionPackage["sourceReceipt"]["sources"]) {
  type Need = { hashes: Set<string>; times: Set<number>; days: Set<string>; latest: boolean; matched: Set<string> };
  const needed = new Map<string, Need>();
  const cite = (url: unknown, record: Record<string, unknown>) => {
    if (typeof url !== "string" || !url) return;
    const need = needed.get(url) ?? { hashes: new Set<string>(), times: new Set<number>(), days: new Set<string>(), latest: false, matched: new Set<string>() };
    const hash = text(record.rawHash || record.contentHash || (record.sourceHashKind !== "HELD_TEXT" && record.sourceHash)).replace(/^sha256-/, "");
    const stamp = text(record.collectedAt || record.retrievedAt || record.readAt);
    if (/^[a-f0-9]{64}$/.test(hash)) need.hashes.add(hash);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(stamp)) need.days.add(stamp);
    else if (Number.isFinite(Date.parse(stamp))) need.times.add(Date.parse(stamp));
    else need.latest = true;
    needed.set(url, need);
  };
  const pending: unknown[] = [payload];
  while (pending.length) {
    const value = pending.pop();
    if (Array.isArray(value)) { for (const row of value) pending.push(row); continue; }
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    for (const key of ["sourceUrl", "candidacySourceUrl", "citesUrl", "analysisUrl"]) cite(row[key], row);
    if (Array.isArray(row.sourceUrls)) for (const url of row.sourceUrls) cite(url, row);
    const sourceRows = [...Array.isArray(row.sources) ? row.sources : [], row.canvass, row.retrieval];
    for (const source of sourceRows) if (source && typeof source === "object") {
      const record = source as Record<string, unknown>; cite(record.url, record);
    }
    for (const child of Object.values(row)) if (child && typeof child === "object") pending.push(child);
  }
  const versions = new Map<string, typeof sources[number]>();
  for (const source of sources) versions.set(`${source.requestedUrl}\n${source.finalUrl}\n${source.rawHash}`, source);
  const selected = new Set<string>(), latest = new Map<string, typeof sources[number]>();
  const identity = (source: typeof sources[number]) => `${source.finalUrl}\n${source.rawHash}`;
  for (const source of versions.values()) for (const url of new Set([source.requestedUrl, source.finalUrl])) {
    const need = needed.get(url);
    if (!need) continue;
    if (!latest.has(url) || Date.parse(source.retrievedAt) > Date.parse(latest.get(url)!.retrievedAt)) latest.set(url, source);
    const time = Date.parse(source.retrievedAt), day = source.retrievedAt.slice(0, 10);
    for (const [matches, key] of [[need.hashes.has(source.rawHash), `hash:${source.rawHash}`],
      [need.times.has(time), `time:${time}`], [need.days.has(day), `day:${day}`]] as const) {
      if (matches) { selected.add(identity(source)); need.matched.add(key); }
    }
  }
  for (const [url, need] of needed) if (need.latest || [...need.hashes].some(hash => !need.matched.has(`hash:${hash}`)) ||
    [...need.times].some(time => !need.matched.has(`time:${time}`)) || [...need.days].some(day => !need.matched.has(`day:${day}`))) {
    const source = latest.get(url);
    if (source) selected.add(identity(source));
  }
  return [...versions.values()].filter(source => selected.has(identity(source)));
}

type MutableRow = Record<string, unknown>;
type BallotRows = {
  ballot: BallotSet;
  rows: Map<string, Map<string, unknown>>;
  incoming: Set<string>;
  complete: Set<string>;
  candidates: Set<string>;
  measures: Set<string>;
  holds: Set<string>;
  seen: Map<string, Set<string>>;
  declared: Map<string, Contest["type"]>;
  beforeTimes: Map<string, number>;
  incomingTimes: Map<string, number>;
};

const rowKey = (field: string, value: unknown): string => {
  const row = value as MutableRow;
  if (field === "coverageNotes" || field === "scopedCoverageNotes" || field.endsWith(".sources")) return canonicalCivicDataJson(value);
  if (field === "absences") return `${row.ocdId}:${row.statement}`;
  if (field === "contacts") return String(row.candidacyId);
  if (field === "measureRecords" || field === "generalLineup.contests" || field === "measureAnalyses.analyses") return String(row.contestId);
  if (field === "lineupReconciliation.rows") return String(row.cardKey);
  return String(row.id);
};

export class BallotContestMerge {
  private readonly input: ManualProjectionPackage;
  private readonly checkAuthority: boolean;
  private readonly onContest?: (id: string, value: unknown, previous: Contest | undefined) => void;
  private readonly states = new Map<string, BallotRows>();
  private readonly official = new Set<string>();
  private readonly priorSources: ManualProjectionPackage["sourceReceipt"]["sources"];
  private readonly currentAuthorities = new Map<string, string>();
  private readonly priorAuthorities = new Map<string, string>();

  constructor(input: ManualProjectionPackage, prior: ManualProjectionPrior | null, options: {
    checkAuthority?: boolean; onContest?: (id: string, value: unknown, previous: Contest | undefined) => void;
  } = {}) {
    this.input = input; this.checkAuthority = options.checkAuthority === true; this.onContest = options.onContest;
    const partition = parseStateBallotContractId(input.contractId);
    requirePublication(partition?.family === "ballot-contests", "BALLOT_STATE_CONTRACT_REQUIRED");
    this.priorSources = prior?.sourceReceipt?.sources ?? [];
    for (const [sources, target] of [[this.priorSources, this.priorAuthorities], [input.sourceReceipt.sources, this.currentAuthorities]] as const) {
      for (const source of sources) if (source.reviewOutcome !== "BLOCKED" &&
        ["ELECTION_AUTHORITY", "OFFICIAL_PUBLISHER"].includes(source.sourceClass)) {
        target.set(source.requestedUrl, source.publisher); target.set(source.finalUrl, source.publisher);
      }
    }
    for (const source of input.sourceReceipt.sources) if (source.reviewOutcome !== "BLOCKED" && source.httpStatus === 200 &&
      ["ELECTION_AUTHORITY", "OFFICIAL_PUBLISHER"].includes(source.sourceClass) && /^[a-f0-9]{64}$/.test(source.rawHash)) {
      this.official.add(`${source.requestedUrl}\n${source.retrievedAt}`); this.official.add(`${source.finalUrl}\n${source.retrievedAt}`);
    }
    for (const [key, ballot] of Object.entries((prior?.payload as GenericBallotProjection | undefined)?.ballots ?? {})) {
      requirePublication(ballot.election.state === partition.state && key === ballotElectionKey(ballot), "BALLOT_STATE_SCOPE_MISMATCH");
      const mutable = { ...ballot };
      for (const field of ["generalLineup", "measureAnalyses", "lineupReconciliation"] as const)
        if (ballot[field]) (mutable as unknown as MutableRow)[field] = { ...ballot[field] };
      const state: BallotRows = { ballot: mutable, rows: new Map(), incoming: new Set(), complete: new Set(), candidates: new Set(), measures: new Set(), holds: new Set(), seen: new Map(), declared: new Map(), beforeTimes: new Map(), incomingTimes: new Map() };
      for (const [field, value] of Object.entries(ballot)) {
        if (Array.isArray(value)) this.takeRows(state, field, value);
        else if (["generalLineup", "measureAnalyses", "lineupReconciliation"].includes(field) && value) {
          state.beforeTimes.set(field, observedAt(value));
          for (const [name, rows] of Object.entries(value)) if (Array.isArray(rows)) this.takeRows(state, `${field}.${name}`, rows);
        }
      }
      this.states.set(key, state);
    }
    for (const [key, incoming] of Object.entries((input.payload as GenericBallotProjection).ballots)) {
      requirePublication(key === ballotElectionKey(incoming), "BALLOT_STATE_SCOPE_MISMATCH");
      this.addBallot(incoming);
    }
  }

  addBallot(incoming: BallotSet): void {
      const key = ballotElectionKey(incoming), partition = parseStateBallotContractId(this.input.contractId)!;
      requirePublication(incoming.election.state === partition.state, "BALLOT_STATE_SCOPE_MISMATCH");
      const state = this.states.get(key) ?? { ballot: { election: incoming.election } as BallotSet,
        rows: new Map(), incoming: new Set(), complete: new Set(), candidates: new Set(), measures: new Set(), holds: new Set(), seen: new Map(), declared: new Map(), beforeTimes: new Map(), incomingTimes: new Map() };
      requirePublication(!state.ballot.election.date || !incoming.election.date || state.ballot.election.date === incoming.election.date, "BALLOT_ELECTION_DATE_CONFLICT");
      for (const [field, value] of Object.entries(incoming)) {
        if (Array.isArray(value)) { if (!state.rows.has(field)) state.rows.set(field, new Map()); continue; }
        if (value === undefined) continue;
        if (["generalLineup", "measureAnalyses", "lineupReconciliation"].includes(field) && value) {
          const target = state.ballot as unknown as MutableRow, old = target[field] as MutableRow | undefined;
          const fresh = value as MutableRow;
          state.incomingTimes.set(field, observedAt(fresh));
          for (const [name, rows] of Object.entries(fresh)) if (Array.isArray(rows) && !state.rows.has(`${field}.${name}`)) state.rows.set(`${field}.${name}`, new Map());
          const next = old ?? {};
          if (!old || observedAt(fresh) >= observedAt(old)) for (const [name, child] of Object.entries(fresh)) if (!Array.isArray(child)) next[name] = child;
          target[field] = next;
        } else if (field !== "election") (state.ballot as unknown as MutableRow)[field] = value;
      }
      state.ballot.election = { ...incoming.election, date: incoming.election.date || state.ballot.election.date };
      this.states.set(key, state);
  }

  private takeRows(state: BallotRows, field: string, values: unknown[]) {
    const rows = new Map<string, unknown>();
    for (const row of values) rows.set(rowKey(field, row), row);
    state.rows.set(field, rows);
    this.setField(state.ballot, field, []);
  }

  private setField(ballot: BallotSet, field: string, value: unknown) {
    const [head, tail] = field.split(".");
    const target = ballot as unknown as MutableRow;
    if (tail) (target[head] as MutableRow)[tail] = value;
    else target[head] = value;
  }

  add(key: string, field: string, value: unknown): void {
    const state = this.states.get(key);
    requirePublication(state, "BALLOT_STATE_SCOPE_MISMATCH");
    const rows = state.rows.get(field) ?? new Map<string, unknown>();
    state.rows.set(field, rows);
    const id = rowKey(field, value), row = value as MutableRow;
    const seen = state.seen.get(field) ?? new Set<string>();
    if (["contests", "heldContests", "candidacies", "filingCandidacies", "measures", "measureRecords", "contacts",
      "generalLineup.contests", "measureAnalyses.analyses", "lineupReconciliation.rows"].includes(field)) {
      requirePublication(!seen.has(id), "BALLOT_INPUT_IDENTITY_DUPLICATED"); seen.add(id); state.seen.set(field, seen);
    }
    if (field === "contests" || field === "heldContests") {
      const contest = value as Contest;
      state.declared.set(id, contest.type ?? "CANDIDACY");
      const old = state.rows.get("contests")?.get(id) as Contest | undefined;
      const hold = state.rows.get("heldContests")?.get(id) as HeldBallotContest | undefined;
      const previous = old ?? hold;
      if (previous && observedAt(previous) > observedAt(contest)) return;
      const complete = contest.candidateListComplete === true && this.official.has(`${contest.provenance.sourceUrl}\n${contest.provenance.collectedAt}`);
      const held = field === "heldContests" || contest.type !== "MEASURE" && !complete;
      if (held && old?.candidateListComplete === true) return;
      if (this.checkAuthority && previous && this.priorAuthorities.get(previous.provenance.sourceUrl ?? "") !==
        this.currentAuthorities.get(contest.provenance.sourceUrl ?? "")) throw new Error("Contest authority conflicts with the published ballot.");
      if (held) {
        const holds = state.rows.get("heldContests") ?? new Map();
        const next = immutableStateValue(field === "heldContests" ? value : { id: contest.id, electionId: contest.electionId,
          ocdId: contest.ocdId, title: contest.title, provenance: contest.provenance, reason: "The official candidate list hasn't been fully checked." });
        consumeStatePublicationRecord(previous, next);
        holds.set(id, next);
        state.rows.set("heldContests", holds); state.rows.get("contests")?.delete(id); state.holds.add(id);
      } else {
        this.onContest?.(id, value, old);
        const next = reuseStatePublicationRecord(old, row) ?? immutableStateValue(old ? { ...old, ...row } : row);
        consumeStatePublicationRecord(previous, next);
        rows.set(id, next); state.incoming.add(id);
        if (complete) state.complete.add(id);
        state.rows.get("heldContests")?.delete(id);
      }
      return;
    }
    const contestId = String(row.contestId);
    if (["candidacies", "measures", "measureRecords"].includes(field)) {
      requirePublication(state.declared.has(contestId), "BALLOT_INPUT_CONTEST_MISSING");
      requirePublication(field === "candidacies" ? state.declared.get(contestId) !== "MEASURE" : state.declared.get(contestId) === "MEASURE", "BALLOT_INPUT_CONTEST_TYPE_MISMATCH");
    }
    if (field === "candidacies" || field === "filingCandidacies") {
      requirePublication(!state.seen.get(field === "candidacies" ? "filingCandidacies" : "candidacies")?.has(id), "BALLOT_INPUT_IDENTITY_DUPLICATED");
    }
    if (["candidacies", "measures", "measureRecords"].includes(field) && !state.incoming.has(contestId)) return;
    if (field === "candidacies") state.candidates.add(id);
    const old = rows.get(id);
    const parent = field.split(".")[0];
    if (old && (observedAt(value) || state.incomingTimes.get(parent) || 0) < (observedAt(old) || state.beforeTimes.get(parent) || 0)) return;
    if (field === "measures") state.measures.add(contestId);
    const next = reuseStatePublicationRecord(old, value) ?? immutableStateValue(field === "candidacies" && old ? { ...old as object, ...row } : value);
    consumeStatePublicationRecord(old, next);
    rows.set(id, next);
  }

  finish(sourceReceipt = this.input.sourceReceipt, sourceThrough = this.input.sourceThrough): ManualProjectionPackage {
    const ballots: Record<string, BallotSet> = {};
    for (const [key, state] of this.states) {
      const candidates = state.rows.get("candidacies") ?? new Map();
      for (const [id, value] of candidates) {
        const row = value as Candidacy;
        if (state.holds.has(row.contestId) || state.complete.has(row.contestId) && !state.candidates.has(id)) {
          consumeStatePublicationRecord(value, null); candidates.delete(id);
        }
      }
      for (const field of ["contacts", "filingCandidacies"]) for (const [id, row] of state.rows.get(field) ?? []) {
        if (field === "contacts" && state.seen.get(field)?.has(id)) requirePublication(candidates.has(id) || state.seen.get("candidacies")?.has(id), "BALLOT_INPUT_CONTACT_CANDIDATE_MISSING");
        if (field === "contacts" ? !candidates.has(String((row as MutableRow).candidacyId)) : candidates.has(id)) {
          consumeStatePublicationRecord(row, null); state.rows.get(field)!.delete(id);
        }
      }
      for (const field of ["measures", "measureRecords"]) for (const [id, value] of state.rows.get(field) ?? []) {
        const row = value as MutableRow, contestId = String(row.contestId);
        const contest = state.rows.get("contests")?.get(contestId) as Contest | undefined;
        const url = field === "measures" ? (row.provenance as MutableRow).sourceUrl : row.sourceUrl;
        if (!state.seen.get(field)?.has(id) && state.incoming.has(contestId) &&
          (state.measures.has(contestId) || contest?.measureTextUrl !== url)) {
          consumeStatePublicationRecord(value, null); state.rows.get(field)!.delete(id);
        }
      }
      for (const field of ["contests", "candidacies", "measures", "absences"]) if (!state.rows.has(field)) state.rows.set(field, new Map());
      for (const [field, rows] of state.rows) { this.setField(state.ballot, field, [...rows.values()]); rows.clear(); }
      ballots[key] = state.ballot;
    }
    const payload: GenericBallotProjection = { kind: "ballot-contests", ballots };
    this.states.clear();
    return { ...this.input, sourceThrough, payload, sourceReceipt: { ...sourceReceipt,
      sources: citedBallotSources(payload, [...this.priorSources, ...sourceReceipt.sources]) } };
  }
}

export async function publishWorkerBallotContestsResults(input: {
  repos: ControlPlaneRepositories; store: RoutineDataStore; workItemIds: readonly string[]; now: string;
  readCapture: (id: string, results: readonly WorkerResultRecord[]) => Promise<WorkerPublicationCapture>;
}) {
  const report: { workItemId: string; outcome: NonNullable<WorkItem["publicationOutcome"]> }[] = [];
  for (const id of [...new Set(input.workItemIds)]) {
    const { results, readCapture } = await jobWorkerResults(input.repos, [id], input.readCapture);
    const item = (await input.repos.workItems.mustRead(id)).value, plan = item.autonomousPlan;
    const parser = latestParserResult(results, id);
    if (!parser || parseStateBallotContractId(plan?.publication?.contractId ?? "")?.family !== "ballot-contests" || !plan) continue;
    const pull = auditPull(results, parser);
    if (item.publicationOutcome?.workerResultId === parser.id && item.publicationOutcome.sourceObservedAt && item.publicationOutcome.recovery !== "PUBLISHER" &&
      item.publicationOutcome.status !== "PARTIALLY_PUBLISHED" &&
      !(pull && pull.at > item.publicationOutcome.at)) { report.push({ workItemId: id, outcome: item.publicationOutcome }); continue; }
    let outcome: NonNullable<WorkItem["publicationOutcome"]>;
    let candidateId: string | null = null, versionId: string | null = null, verified = false;
    try {
      requirePublication(parser.result.role === "PARSER", "PARSER_RESULT_UNRESOLVED");
      const captures = await capturesForPublication({ ...input, readCapture, workItemId: id, primaryId: parser.result.artifactId, results });
      if (plan.contract.schemaVersion === 2 && plan.contract.recordClass === "BALLOT_MEASURE") {
        const urls = new Set(parser.result.records.map(row => row.fields.textUrl).filter((url): url is string => typeof url === "string" && url.startsWith("https://")));
        const held = (await input.repos.artifacts.read(id)).filter(row => urls.has(row.canonicalUrl) && !row.partial)
          .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
        const capturedIds = new Set(captures.map(capture => capture.evidence.artifactId));
        const fetched = await Promise.all(held.filter(row => !capturedIds.has(row.artifactId))
          .map(row => readCapture(row.artifactId, results).catch(() => null)));
        captures.push(...fetched.filter((capture): capture is WorkerPublicationCapture => capture !== null));
      }
      let prior = await readManualProjectionPrior(plan.publication!.contractId as ManualProjectionPackage["contractId"], input.store, input.now);
      const priorVersionId = prior?.versionId ?? null;
      const checked = workerBallotContestsPackage({ plan, parser, captures, now: input.now, results, prior,
        registry: { payload: { registry: { divisions: await input.store.readRegistryDivisions(
          parseStateBallotContractId(plan.publication!.contractId)!.state, parser.result.records.map(row => text(row.fields.jurisdictionName))) } } } });
      prior = null;
      const merged = checked.package, changes = checked.changes;
      const contestIds = changes.recordChanges.map(row => row.recordId);
      const candidate = manualProjectionCandidate(merged);
      candidateId = candidate.id; verified = true;
      const published = await processRegisteredManualCandidate(input.store, checked.package.contractId, candidate, input.now, priorVersionId);
      if (published.candidate.receipt?.decision === "GOOD") await recordPublicationFlow(input.repos, published.candidate.candidate.id,
        { workerResultId: parser.id, stage: "CHECKED", records: contestIds.length, changedRecords: changes.records.added + changes.records.changed, versionId: null }, input.now);
      requirePublication(published.promoted && published.readerReadback?.status === "PASS", `BALLOT_READER_HELD:${published.candidate.failureDetail ?? published.candidate.state}`);
      versionId = published.promoted.versionId;
      requirePublication(plan.contract.schemaVersion === 2, "BALLOT_CONTRACT_UNRESOLVED");
      const state = plan.contract.jurisdiction.state.toUpperCase();
      await publishOfficialBallotCandidacies({ store: input.store, now: input.now, sourceReceipt: merged.sourceReceipt,
        ballots: Object.values((merged.payload as GenericBallotProjection).ballots).filter(ballot => ballot.election.state === state) });
      await recordPublicationFlow(input.repos, published.candidate.candidate.id,
        { workerResultId: parser.id, stage: "LIVE", records: contestIds.length, changedRecords: published.confirmed ? 0 : changes.records.added + changes.records.changed, versionId }, input.now);
      outcome = { at: input.now, workerResultId: parser.id, status: checked.heldContests.length ? "PARTIALLY_PUBLISHED" : "PUBLISHED",
        code: published.confirmed ? "VERIFIED_RESULT_REUSED" : "VERIFIED_BALLOT_FACTS_PUBLISHED", candidateId, versionId,
        detail: `${contestIds.length} official contest(s) published with ${plan.contract.recordClass === "BALLOT_MEASURE" ? "each independently verified measure fact" : "independently verified candidates"}; ${checked.heldContests.length} source or text gap(s) remain owed: ${checked.heldContests.join("; ")}.`,
        ...changes, sourceObservedAt: captures[0]?.observedAt, sourceArtifactId: captures[0]?.evidence.artifactId,
        acceptedRecordIds: contestIds, ...(checked.heldContests.length ? { recovery: "WORKER" as const } : {}) };
    } catch (error) {
      const detail = sanitizedErrorDiagnostic(error);
      outcome = { at: input.now, workerResultId: parser.id, status: "HELD", code: detail.split(":")[0], detail,
        recovery: verified ? "PUBLISHER" : "WORKER", candidateId, versionId };
    }
    const latest = await input.repos.workItems.mustRead(id);
    await input.repos.workItems.compareAndSet(id, latest.revision, { ...latest.value, publicationOutcome: outcome }, input.now);
    report.push({ workItemId: id, outcome });
  }
  return report;
}
