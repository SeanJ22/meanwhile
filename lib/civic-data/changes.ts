import { createHash } from "node:crypto";

import { agendaContentGroups, type AgendaContentRow } from "../meetings/agenda-content.ts";
import { stateMoneyRecordKey } from "../funding/state-money.ts";
import type {
  CivicRecordMember,
  RoutineCandidate,
  RoutineChangeSet,
  RoutineRecordClass,
} from "./types.ts";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function textKey(value: unknown, keys: readonly string[]): string | null {
  const row = object(value);
  if (!row) return null;
  for (const key of keys) {
    const candidate = row[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }
  return null;
}

function keyed(prefix: string, values: readonly unknown[], keys: readonly string[]): CivicRecordMember[] {
  return values.map((record) => {
    const key = textKey(record, keys);
    // A row position is not a durable civic identity: inserting an unrelated
    // sibling would silently rename every later member. Leave the key invalid
    // so the promotion validator refuses the candidate before computing a
    // delta or moving the pointer.
    return { key: key === null ? "" : `${prefix}:${key}`, record };
  });
}

function keyedObservations(prefix: string, values: readonly unknown[], keys: readonly string[]): CivicRecordMember[] {
  const observations = values.map((record) => {
    const subject = textKey(record, keys) ?? "unkeyed";
    const digest = createHash("sha256").update(canonicalCivicDataJson(record)).digest("hex");
    return { base: `${prefix}:${subject}:${digest}`, record };
  }).sort((left, right) => {
    const byBase = left.base.localeCompare(right.base);
    return byBase || canonicalCivicDataJson(left.record).localeCompare(canonicalCivicDataJson(right.record));
  });
  const occurrences = new Map<string, number>();
  return observations.map(({ base, record }) => {
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return { key: `${base}:occurrence-${occurrence}`, record };
  });
}

/** A sitting's held agenda is one civic record keyed by the sitting, holding each distinct content read; a re-fetch of the same words changes nothing. */
export function agendaDocumentRecordKey(document: { readonly meetingId: string }): string {
  return `agenda-document:${document.meetingId}`;
}

function agendaDocumentMembers(values: readonly unknown[]): CivicRecordMember[] {
  const byMeeting = new Map<string, Record<string, unknown>[]>();
  const unkeyed: CivicRecordMember[] = [];
  for (const value of values) {
    const row = object(value);
    const meetingId = textKey(row, ["meetingId"]);
    // No sitting, no durable identity: the empty key makes the validator
    // refuse the candidate rather than guess which record this row belongs to.
    if (row === null || meetingId === null) {
      unkeyed.push({ key: "", record: value });
      continue;
    }
    byMeeting.set(meetingId, [...(byMeeting.get(meetingId) ?? []), row]);
  }
  const retrievedAt = (row: Record<string, unknown>) => typeof row.retrievedAt === "string" ? row.retrievedAt : "";
  const idOf = (row: Record<string, unknown>) => typeof row.id === "string" ? row.id : "";
  return [
    ...[...byMeeting].map(([meetingId, rows]) => {
      const earliestFirst = [...rows].sort((left, right) =>
        retrievedAt(left).localeCompare(retrievedAt(right)) || idOf(left).localeCompare(idOf(right)));
      const versions = agendaContentGroups(earliestFirst as unknown as AgendaContentRow[])
        .map((group) => group[0] as unknown as Record<string, unknown>);
      return { key: agendaDocumentRecordKey({ meetingId }), record: { id: meetingId, meetingId, versions } };
    }),
    ...unkeyed,
  ];
}

/** Facts decide a change; observation stamps such as `collectedAt` stay on the record but never decide it. */
export function civicRecordFacts(recordClass: RoutineRecordClass, member: CivicRecordMember): unknown {
  if (recordClass === "MEETING" && member.key.startsWith("meeting:")) {
    return withoutProvenanceStamps(member.record, ["collectedAt"]);
  }
  if (recordClass === "STATE_LEGISLATOR" && member.key.startsWith("member:")) {
    return withoutProvenanceStamps(member.record, ["collectedAt", "verifiedAt"]);
  }
  if (recordClass === "STATE_ROLL_CALL" && member.key.startsWith("roll:")) {
    const roll = object(member.record);
    if (roll === null) return member.record;
    const { retrievedAt: _retrievedAt, ...facts } = roll;
    return facts;
  }
  if (recordClass === "VOTING_SITE" && member.key.startsWith("jurisdiction:")) {
    const row = object(member.record);
    if (row === null) return member.record;
    const { collectedAt: _collectedAt, ...facts } = row;
    return facts;
  }
  if (recordClass === "STATE_CAMPAIGN_FINANCE") {
    const row = object(withoutProvenanceStamps(member.record, ["collectedAt", "verifiedAt"]));
    if (row === null) return member.record;
    const { checkedAt: _checkedAt, ...facts } = row;
    return facts;
  }
  if (recordClass === "CURATED_READER_RECORD") {
    const row = object(member.record);
    if (row?.kind === "SOCRATA_DATASET" || row?.kind === "EPA_FACILITY") {
      const { capturedAt: _capturedAt, ...facts } = row;
      return facts;
    }
    const value = object(row?.value);
    if (row?.kind === "ELECTION_FIELD" && value) {
      const { verifiedAt: _verifiedAt, collectedAt: _collectedAt, ...facts } = value;
      return { ...row, value: facts };
    }
  }
  return member.record;
}

function withoutProvenanceStamps(record: unknown, stamps: readonly string[]): unknown {
  const row = object(record);
  const provenance = object(row?.provenance);
  if (row === null || provenance === null) return record;
  const factualProvenance = Object.fromEntries(Object.entries(provenance).filter(([key]) => !stamps.includes(key)));
  return { ...row, provenance: factualProvenance };
}

export function civicRecordsFor(recordClass: RoutineRecordClass, payload: unknown): readonly CivicRecordMember[] {
  const root = object(payload) ?? {};
  switch (recordClass) {
    case "FEC_FUNDING":
      return keyed("candidate", array(root.candidates), ["fecCandidateId", "id"]);
    case "STATE_LEGISLATOR":
      return (array(root.members).length > 0
        ? array(root.members)
        : array(object(root.roster)?.officeholders)
      ).map((record, index) => {
        const row = object(record) ?? {};
        const identity = typeof row.id === "string" && row.id
          ? row.id
          : [row.chamber, row.seatNo, row.district].filter((part) => typeof part === "string" && part).join(":");
        return { key: `member:${identity || `row-${index}`}`, record };
      });
    case "STATE_ROLL_CALL":
      return [
        ...keyed("roll", array(root.rollCalls), ["id", "officialRollCallId", "rollCallId"]),
        ...array(root.positions).map((record, index) => {
          const row = object(record) ?? {};
          const roll = textKey(row, ["rollCallId", "officialRollCallId"]);
          const person = textKey(row, ["officeholderId", "officialPersonId"]);
          return { key: `position:${roll && person ? `${roll}:${person}` : `row-${index}`}`, record };
        }),
      ];
    case "STATE_LEGISLATOR_VOTES":
      // One record class, one per-state fan-out contract, two payload shapes:
      // a per-legislator record keys each of that member's positions (bounded
      // by the member's tenure, never the chamber), and the per-state session
      // marker the runner's clock reads keys its own watermark. Only the
      // per-legislator record carries positions.
      return typeof root.officeholderId === "string" && root.officeholderId
        ? array(root.positions).map((record, index) => {
            const row = object(record) ?? {};
            const roll = textKey(row, ["rollCallId", "officialRollCallId"]);
            return { key: `position:${root.officeholderId as string}:${roll ?? `row-${index}`}`, record };
          })
        : [{ key: `session-marker:${textKey(root, ["jurisdiction"]) ?? "state"}`, record: root }];
    case "FEDERAL_ROLL_CALL": {
      const snapshot = object(root.snapshot) ?? root;
      const billSummaries = object(root.billSummaries) ?? {};
      const summaries = object(billSummaries.summaries) ?? {};
      return [
        {
          key: "projection:roll-window",
          record: {
            congress: snapshot.congress,
            session: snapshot.session,
            window: snapshot.window,
            identifierMatch: snapshot.identifierMatch,
          },
        },
        { key: "projection:bill-summary-note", record: billSummaries.note ?? null },
        ...keyed("roll", array(snapshot.votes), ["id"]),
        ...array(snapshot.positions).map((record, index) => {
          const row = object(record) ?? {};
          const roll = textKey(row, ["voteId"]);
          const person = textKey(row, ["officeholderId"]);
          return { key: `position:${roll && person ? `${roll}:${person}` : `row-${index}`}`, record };
        }),
        ...Object.entries(summaries).map(([billUrl, record]) => ({
          key: `bill-summary:${billUrl}`,
          record: { billUrl, ...(object(record) ?? {}) },
        })),
        ...array(billSummaries.pending).map((record, index) => ({
          key: `bill-summary-pending:${textKey(record, ["billUrl"]) ?? `row-${index}`}`,
          record,
        })),
      ].sort((left, right) => left.key.localeCompare(right.key));
    }
    case "FEDERAL_KEY_VOTE": {
      const snapshot = object(root.snapshot) ?? {};
      const positions = object(root.positions);
      const maps = object(positions?.positions);
      return [
        { key: "projection:selection-criteria", record: snapshot.criteria ?? null },
        { key: "projection:position-coverage-note", record: positions?.note ?? null },
        ...keyed("entry", array(snapshot.entries), ["id"]),
        ...array(snapshot.misses).map((record, index) => {
          const row = object(record) ?? {};
          const id = textKey(row, ["id"]);
          const chamber = textKey(row, ["chamber"]);
          return { key: `selection-miss:${id && chamber ? `${id}:${chamber}` : `row-${index}`}`, record };
        }),
        ...keyed("law-miss", array(snapshot.lawMisses), ["id"]),
        ...Object.entries(maps ?? {}).map(([key, record]) => ({ key: `positions:${key}`, record })),
      ].sort((left, right) => left.key.localeCompare(right.key));
    }
    case "FEDERAL_DIRECTORY": {
      const roster = object(root.roster) ?? {};
      const directory = object(root.directory) ?? {};
      const byMember = object(directory.byMember) ?? {};
      const committees = object(directory.committees) ?? {};
      return [
        ...keyed("officeholder", array(roster.officeholders), ["id"]),
        ...array(roster.divisions).map((record, index) => {
          const row = object(record) ?? {};
          const person = textKey(row, ["officeholderId"]);
          const division = textKey(row, ["ocdId"]);
          return { key: `division:${person && division ? `${person}:${division}` : `row-${index}`}`, record };
        }),
        ...Object.entries(byMember).map(([key, record]) => ({ key: `directory:${key}`, record })),
        ...Object.entries(committees).map(([key, record]) => ({ key: `committee:${key}`, record })),
      ].sort((left, right) => left.key.localeCompare(right.key));
    }
    case "REGISTRY_RUNTIME_BINDING": {
      const registry = object(root.registry) ?? {};
      const statewideExecutives = array(root.statewideExecutives);
      const officialCandidacies = object(root.officialCandidacies) ?? {};
      const officialPhotos = object(root.officialPhotos) ?? {};
      const rosterPhotos = object(root.rosterPhotos) ?? {};
      return [
        ...keyed("division", array(registry.divisions), ["ocdId"]),
        ...keyed("body", array(registry.bodies), ["id"]),
        ...statewideExecutives.map((record, index) => {
          const row = object(record) ?? {};
          const holder = object(row.holder);
          return { key: `statewide-executive:${textKey(holder, ["id"]) || `row-${index}`}`, record };
        }),
        ...keyed("official-photo", array(officialPhotos.photos), ["officeholderId"]),
        ...array(officialCandidacies.rows).map((record, index) => {
          const row = object(record) ?? {};
          const holder = object(row.holder);
          return { key: `official-candidacy:${textKey(holder, ["id"]) || `row-${index}`}`, record };
        }),
        ...Object.entries(rosterPhotos).map(([key, record]) => ({ key: `roster-photo:${key}`, record })),
      ].sort((left, right) => left.key.localeCompare(right.key));
    }
    case "VOTING_SITE":
      return array(root.jurisdictions).flatMap((record, index) => {
        const jurisdiction = object(record) ?? {};
        const ocdId = textKey(jurisdiction, ["ocdId"]) ?? `row-${index}`;
        const { sites: _sites, ...metadata } = jurisdiction;
        return [
          { key: `jurisdiction:${ocdId}`, record: metadata },
          ...array(jurisdiction.sites).map((site, siteIndex) => ({
            key: `site:${ocdId}:${textKey(site, ["id"]) ?? `row-${siteIndex}`}`,
            record: site,
          })),
        ];
      }).sort((left, right) => left.key.localeCompare(right.key));
    case "PRL_PROFILE":
      return keyed("profile", array(root.profiles), ["bioguideId"])
        .sort((left, right) => left.key.localeCompare(right.key));
    case "CENSUS_REFERENCE":
      return [
        ...keyed("zcta", array(root.zcta), ["code"]),
        ...keyed("state", array(root.state), ["code"]),
      ];
    case "CENSUS_GEOGRAPHY": {
      // One civic record per geography instance (a grouping), carrying its ZCTA
      // overlaps. Keyed by type + plan/version + Census GEOID — never row order.
      const members: CivicRecordMember[] = [];
      for (const scope of array(root.scopes)) {
        const s = object(scope);
        if (!s) continue;
        const type = typeof s.type === "string" ? s.type : "";
        const version = typeof s.version === "string" ? s.version : "";
        for (const grouping of array(s.groupings)) {
          const g = object(grouping);
          const geoid = g && typeof g.geoid === "string" ? g.geoid : "";
          members.push({
            key: type && version && geoid ? `geography:${type}:${version}:${geoid}` : "",
            record: grouping,
          });
        }
      }
      return members.sort((left, right) => left.key.localeCompare(right.key));
    }
    case "REGISTRATION": {
      // One civic record per Census division and per registered body. A
      // division is keyed by its OCD id and Census GEOID together, because the
      // committed geometry already gives one id to two school districts; a body
      // by its id. The records carry the reference's build date, never the
      // run's clock, so an unchanged month compares equal.
      const divisions = array(root.divisions).map((record) => {
        const row = object(record);
        const ocdId = row && typeof row.ocdId === "string" ? row.ocdId : "";
        const geoid = row && typeof row.geoid === "string" ? row.geoid : "";
        return { key: ocdId && geoid ? `division:${ocdId}|${geoid}` : "", record };
      });
      return [...divisions, ...keyed("body", array(root.bodies), ["id"]), ...keyed("government", array(root.governments), ["id"])].sort((left, right) => left.key.localeCompare(right.key));
    }
    case "MEETING":
      return [
        ...keyed("meeting", array(root.meetings), ["id"]),
        ...agendaDocumentMembers(array(root.agendaDocuments)),
      ];
    case "BALLOT_FILING": {
      const ballot = object(root.ballot) ?? root;
      const contacts = object(root.contacts);
      return [
        ...keyed("contest", array(ballot.contests), ["id"]),
        ...keyed("candidacy", array(ballot.candidacies), ["id"]),
        ...keyed("measure", array(ballot.measures), ["id"]),
        ...keyed("removal", array(ballot.removals), ["id"]),
        ...array(ballot.absences).map((record, index) => {
          const row = object(record) ?? {};
          const identity = [textKey(row, ["ocdId"]), textKey(row, ["statement"])].filter(Boolean).join(":");
          return { key: `absence:${identity || `row-${index}`}`, record };
        }),
        ...keyed("contact", array(contacts?.contacts ?? root.contacts), ["id", "candidacyId", "candidateId"]),
      ];
    }
    case "BALLOT_CANDIDACY": {
      if (root.kind === "ballot-contests") return Object.values(object(root.ballots) ?? {}).flatMap(ballot => civicRecordsFor("BALLOT_CANDIDACY", { ballot }));
      const ballot = object(root.ballot) ?? root;
      const lineup = object(root.generalLineup);
      const analyses = object(root.measureAnalyses);
      const filings = object(root.candidateFilings);
      const identities = object(root.identityRegistry);
      const reconciliation = object(root.lineupReconciliation);
      return [
        ...keyed("contest", array(ballot.contests), ["id"]),
        ...keyed("candidacy", array(ballot.candidacies), ["id"]),
        ...keyed("measure", array(ballot.measures), ["id", "contestId"]),
        ...keyed("measure-record", array(ballot.measureRecords), ["contestId"]),
        ...array(ballot.absences).map((record, index) => {
          const row = object(record) ?? {};
          const identity = [textKey(row, ["ocdId"]), textKey(row, ["statement"])].filter(Boolean).join(":");
          return { key: `absence:${identity || `row-${index}`}`, record };
        }),
        ...keyed("certified-lineup", array(lineup?.contests), ["contestId"]),
        ...keyed("measure-analysis", array(analyses?.analyses), ["contestId"]),
        ...keyed("filing-contest", array(filings?.contests), ["id"]),
        ...keyed("filing-candidacy", array(filings?.candidacies), ["id"]),
        ...keyed("identity-contest", array(identities?.contests), ["identityId"]),
        ...keyed("identity-candidate", array(identities?.candidates), ["identityId"]),
        ...keyed("lineup-reconciliation", array(reconciliation?.rows), ["cardKey", "canonicalCandidacyId"]),
      ];
    }
    case "CANDIDATE_PROFILE": {
      const cards = object(object(root.cards)?.cards) ?? {};
      const links = object(object(root.links)?.links) ?? {};
      const cardHunts = array(object(root.cards)?.hunts);
      const linkHunts = array(object(root.links)?.hunts);
      return [
        ...Object.entries(cards).map(([key, record]) => ({ key: `card:${key}`, record })),
        ...Object.entries(links).map(([key, record]) => ({ key: `links:${key}`, record })),
        ...keyedObservations("card-hunt", cardHunts, ["key", "name"]),
        ...keyedObservations("link-hunt", linkHunts, ["key", "name"]),
      ].sort((left, right) => left.key.localeCompare(right.key));
    }
    case "CANDIDATE_PUBLICATION":
      return [
        { key: "projection:attempted-candidate-denominator", record: root.attempted ?? null },
        ...keyed("document", array(root.documents), ["id"]),
        ...array(root.failures).map((record, index) => {
          const row = object(record) ?? {};
          const identity = [textKey(row, ["candidateKey"]), textKey(row, ["documentUrl"])].filter(Boolean).join(":");
          return { key: `failure:${identity || `row-${index}`}`, record };
        }),
      ];
    case "OFFICEHOLDER_STATEMENT":
      return keyed("statement", array(root.snapshots), ["id"]);
    case "PRL_ARCHIVE":
      return Object.entries(object(root.datasets) ?? {}).map(([key, record]) => ({ key: `dataset:${key}`, record })).sort((a, b) => a.key.localeCompare(b.key));
    case "STATE_EXECUTIVE_ACTION":
      return [
        { key: "projection:note", record: root.note },
        { key: "projection:source", record: root.source },
        { key: "projection:denominator:executive", record: root.denominator },
        { key: "projection:denominator:legislative", record: root.legislative },
        ...keyed("action", array(root.actions), ["id"]),
      ].sort((left, right) => left.key.localeCompare(right.key));
    case "MEETING_OUTCOME":
      return array(root.sittings).flatMap((value, sittingIndex) => {
        const sitting = object(value) ?? {};
        const meetingId = textKey(sitting, ["meetingId"]) ?? `row-${sittingIndex}`;
        return [
          {
            key: `sitting:${meetingId}`,
            record: {
              meetingId: sitting.meetingId,
              bodyId: sitting.bodyId,
              eventId: sitting.eventId,
              startsAt: sitting.startsAt,
              extraction: sitting.extraction,
              extractionNote: sitting.extractionNote,
              publication: sitting.publication,
              minutesPointer: sitting.minutesPointer,
              routesWalked: sitting.routesWalked,
              publicationObservations: sitting.publicationObservations,
              ...(sitting.minutesDocument !== undefined ? { minutesDocument: sitting.minutesDocument } : {}),
              // A held failed minutes read and its bytes: a change to it is a change.
              ...(sitting.failedMinutesRead !== undefined ? { failedMinutesRead: sitting.failedMinutesRead } : {}),
            },
          },
          ...array(sitting.agenda).map((record, index) => ({ key: `agenda:${meetingId}:${textKey(record, ["eventItemId"]) ?? `row-${index}`}`, record })),
          ...array(sitting.outcomes).map((record, index) => ({ key: `outcome:${meetingId}:${textKey(record, ["eventItemId"]) ?? `row-${index}`}`, record })),
          ...array(sitting.rollCalls).map((record, index) => ({ key: `roll-call:${meetingId}:${textKey(record, ["eventItemId"]) ?? `row-${index}`}`, record })),
        ];
      }).sort((left, right) => left.key.localeCompare(right.key));
    case "FEDERAL_CIVIC_RECORD":
      return [
        { key: "projection:cursor", record: root.cursor ?? null },
        { key: "projection:counts", record: root.counts ?? null },
        ...keyed("federal", array(root.records), ["id"]),
      ].sort((a, b) => a.key.localeCompare(b.key));
    case "CURATED_READER_RECORD":
      return keyed("curated-reader", [...array(root.records), ...(root.kind === "open-data" ? [...array(root.reports),...array(root.partitions)] : [])], ["id"])
        .sort((left, right) => left.key.localeCompare(right.key));
    case "STATE_CAMPAIGN_FINANCE":
      return array(root.records).map((record, index) => {
        const row = object(record) ?? {};
        return {
          key: stateMoneyRecordKey({
            jurisdiction: textKey(row, ["jurisdiction"]) ?? "unknown",
            electionYear: textKey(row, ["electionYear"]) ?? "unknown",
            committeeId: textKey(row, ["committeeId"]),
            targetKeys: array(row.targetKeys).filter((value): value is string => typeof value === "string"),
            filingState: textKey(row, ["filingState"]) ?? "unknown",
          }, index),
          record,
        };
      }).sort((a, b) => a.key.localeCompare(b.key));
    case "LOCAL_CAMPAIGN_FINANCE": {
      const held = object(root.held) ?? {};
      const transactions = object(root.transactions) ?? {};
      return [
        ...keyed("committee", array(held.committeeRegisterCountyPortal), ["portalFilerId"]),
        ...keyed("filing", array(held.filingsIndexed), ["filingId"]),
        ...array(transactions.contributions).map((record, index) => ({
          key: `contribution:${textKey(record, ["DocumentFilingId"]) ?? "unknown"}:${index}`,
          record,
        })),
        ...array(transactions.distributions).map((record, index) => ({
          key: `distribution:${textKey(record, ["DocumentFilingId"]) ?? "unknown"}:${index}`,
          record,
        })),
      ].sort((a, b) => a.key.localeCompare(b.key));
    }
    case "DOTGOV_REFERENCE":
      return keyed("domain", array(root.domains), ["domain"]);
    case "OPERATIONAL_REFERENCE": {
      const registries = object(root.registries) ?? {};
      return Object.values(registries).flatMap((value) => {
        const registry = object(value) ?? {};
        return keyed("jurisdiction", array(registry.jurisdictions), ["id"]);
      });
    }
  }
}

export function canonicalCivicDataJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalCivicDataJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalCivicDataJson(child)}`)
    .join(",")}}`;
}

/**
 * The member projection and fact comparison a durable delta was derived under.
 * A delta is re-derived only to verify evidence, and evidence is verified
 * against the contract that wrote it.
 */
export interface CivicChangeContract {
  readonly members: (recordClass: RoutineRecordClass, payload: unknown) => readonly CivicRecordMember[];
  readonly facts: (recordClass: RoutineRecordClass, member: CivicRecordMember) => unknown;
}

export const CIVIC_CHANGE_CONTRACT: CivicChangeContract = {
  members: civicRecordsFor,
  facts: civicRecordFacts,
};

export function rowKeyedCivicRecordsFor(recordClass: RoutineRecordClass, payload: unknown): readonly CivicRecordMember[] {
  if (recordClass !== "MEETING") return civicRecordsFor(recordClass, payload);
  const root = object(payload) ?? {};
  return [
    ...keyed("meeting", array(root.meetings), ["id"]),
    ...keyed("agenda-document", array(root.agendaDocuments), ["id"]),
  ];
}

/** The earlier projection: one member per stored row, compared whole. Pointers written under it are re-proved against it, never against a later contract. */
export const ROW_KEYED_CIVIC_CHANGE_CONTRACT: CivicChangeContract = {
  members: rowKeyedCivicRecordsFor,
  facts: (_recordClass, member) => member.record,
};

export function candidateChangeSet(
  candidate: RoutineCandidate,
  previousPayload: unknown | null,
  contract: CivicChangeContract = CIVIC_CHANGE_CONTRACT,
): RoutineChangeSet {
  // A caller-supplied member list is evidence to validate, never authority for
  // the durable delta. Derive Admin's exact changed/removed records from the
  // same Reader projection that the canonical pointer will serve.
  const next = contract.members(candidate.recordClass, candidate.readModel);
  const prior = previousPayload === null ? [] : contract.members(candidate.recordClass, previousPayload);
  const priorByKey = new Map(prior.map((member) => [member.key, member]));
  const nextByKey = new Map(next.map((member) => [member.key, member.record]));
  const facts = (member: CivicRecordMember) => canonicalCivicDataJson(contract.facts(candidate.recordClass, member));
  const added = next
    .filter((member) => !priorByKey.has(member.key))
    .map((member) => ({ key: member.key, before: null, after: member.record }));
  // The persisted before/after stay the exact records; only facts decide.
  const changed = next
    .filter((member) => priorByKey.has(member.key) && facts(priorByKey.get(member.key)!) !== facts(member))
    .map((member) => ({ key: member.key, before: priorByKey.get(member.key)?.record ?? null, after: member.record }));
  const removed = prior
    .filter((member) => !nextByKey.has(member.key))
    .map((member) => ({ key: member.key, before: member.record, after: null }));
  const held = (candidate.excludedFacts ?? []).map((fact) => ({
    key: fact.key ?? null,
    code: fact.code,
    detail: fact.detail,
    ...(Object.hasOwn(fact, "record") ? { record: fact.record } : {}),
  }));
  return {
    outcome: added.length + changed.length + removed.length > 0 ? "CHANGED" : "UNCHANGED",
    added,
    changed,
    removed,
    held,
  };
}
