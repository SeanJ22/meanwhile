import type { StatePublicationPrior } from "./state-publication.ts";
import { createHash } from "node:crypto";
import { immutableStateHash, statePublicationRecordHash, statePublicationScope } from "./state-publication.ts";

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
    // Row positions change when siblings are inserted; an empty identity makes validation refuse the candidate.
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
  if (recordClass === "FEDERAL_MONEY" && member.key === "federal-money-checkpoint") {
    const row = object(member.record);
    if (row) { const { lastCompleteAt: _at, refreshStartedAt: _started, ...progress } = row; return progress; }
  }
  if (recordClass === "FEDERAL_MONEY" && member.key.startsWith("federal-money:")) {
    return withoutProvenanceStamps(member.record, ["retrievedAt", "rawHash"]);
  }
  if (recordClass === "CENSUS_REFERENCE") {
    const row = object(member.record), attribution = object(row?.attribution);
    if (row && attribution) {
      const { retrievedAt: _retrievedAt, ...sourceFacts } = attribution;
      return { ...row, attribution: sourceFacts };
    }
  }
  if (recordClass === "MEETING_OUTCOME" && member.key.startsWith("sitting:")) {
    const row = object(member.record), document = object(row?.minutesDocument);
    if (row && document) {
      const { readAt: _readAt, ...facts } = document;
      return { ...row, minutesDocument: facts };
    }
  }
  if (recordClass === "GOOGLE_CIVIC_VOTERINFO") {
    const row = object(member.record);
    if (row === null) return member.record;
    const { checkedAt: _checkedAt, rows, ...facts } = row;
    return { ...facts, rows: array(rows).map(value => {
      const fact = object(value) ?? {};
      return { ...fact, sources: array(fact.sources).map(source => {
        const { collectedAt: _collectedAt, ...attribution } = object(source) ?? {};
        return attribution;
      }) };
    }) };
  }
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
  const fieldSources = object(row.fieldSources);
  return { ...row, provenance: factualProvenance,
    ...(fieldSources ? {fieldSources:Object.fromEntries(Object.entries(fieldSources).map(([field,source])=>[field,
      object(source) ? Object.fromEntries(Object.entries(object(source)!).filter(([key])=>!stamps.includes(key))) : source]))} : {}) };
}

export function civicRecordsFor(recordClass: RoutineRecordClass, payload: unknown): readonly CivicRecordMember[] {
  const root = object(payload) ?? {};
  switch (recordClass) {
    case "STATE_BILL":
      return [...keyed("bill", array(root.bills), ["id"]), ...keyed("dataset", array(root.datasets), ["session_id"])];
    case "FEC_FUNDING":
      return [
        ...keyed("candidate", array(root.candidates), ["fecCandidateId", "id"]),
        ...keyed("second-hop", array(root.secondHop), ["committeeId"]),
      ];
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
    case "FEDERAL_MONEY":
      return root.state === "US"
        ? keyed("federal-money-state", array(root.states), ["state"])
        : [...keyed("federal-money", array(root.records), ["id"]),
          ...(root.checkpoint ? [{ key: "federal-money-checkpoint", record: { ...object(root.checkpoint), counts: root.counts } }] : []),
          ...(root.partition ? [{ key: "federal-money-partition", record: { partition: root.partition, children: root.children ?? [],
            counts: root.counts, subtreeCounts: root.subtreeCounts ?? null, childCounts: root.childCounts ?? null } }] : [])];
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
      // A session marker holds the runner watermark; per-legislator payloads hold tenure-bounded positions.
      return typeof root.officeholderId === "string" && root.officeholderId
        ? array(root.positions).map((record, index) => {
            const row = object(record) ?? {};
            const roll = textKey(row, ["rollCallId", "officialRollCallId"]);
            return { key: `position:${root.officeholderId as string}:${roll ?? `row-${index}`}`, record };
          })
        : [{ key: `session-marker:${textKey(root, ["jurisdiction"]) ?? "state"}`, record: root }];
    case "FEDERAL_ROLL_CALL": {
      if (typeof root.officeholderId === "string" && root.officeholderId) return [
        { key: "projection:member-session", record: { officeholderId: root.officeholderId, congress: root.congress, session: root.session } },
        ...keyed("roll", array(root.votes), ["id"]),
        ...array(root.positions).map((record, index) => ({ key: `position:${textKey(record, ["voteId"]) ?? `row-${index}`}:${root.officeholderId as string}`, record })),
      ].sort((left, right) => left.key.localeCompare(right.key));
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
        ...Object.entries(object(root.partyBreakdowns) ?? {}).map(([voteId, record]) => ({ key: `party-breakdown:${voteId}`, record })),
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
        ...keyed("vacancy", array(root.vacancies), ["ocdId"]),
        ...Object.entries(committees).map(([key, record]) => ({ key: `committee:${key}`, record })),
      ].sort((left, right) => left.key.localeCompare(right.key));
    }
    case "REGISTRY_RUNTIME_BINDING": {
      const registry = object(root.registry) ?? {};
      const bodyRosters = array(root.bodyRosters);
      const rosterReaderDispositions = array(root.rosterReaderDispositions);
      const statewideExecutives = array(root.statewideExecutives);
      const officialCandidacies = object(root.officialCandidacies) ?? {};
      const officialPhotos = object(root.officialPhotos) ?? {};
      const rosterPhotos = object(root.rosterPhotos) ?? {};
      return [
        ...keyed("division", array(registry.divisions), ["ocdId"]),
        ...keyed("body", array(registry.bodies), ["id"]),
        ...keyed("body-roster", bodyRosters, ["bodyId"]),
        ...keyed("roster-disposition", rosterReaderDispositions, ["sourceId"]),
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
    case "GOOGLE_CIVIC_VOTERINFO": {
      // Scoped snapshots preserve sources without claiming omitted contests or sites were deleted.
      return [{ key: "google-civic:query-snapshot", record: root }];
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
        ...array(root.geographies).map(record => {
          const row = object(record);
          return { key: `${row?.geography}:${row?.code}`, record };
        }),
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
      // OCD ids can collide for school districts, so a division's identity also includes its Census GEOID.
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
    case "BALLOT_CANDIDACY": {
      return Object.values(object(root.ballots) ?? {}).flatMap(value => {
        const ballot = object(value) ?? {};
        const lineup = object(ballot.generalLineup);
        const analyses = object(ballot.measureAnalyses);
        const reconciliation = object(ballot.lineupReconciliation);
        return [
          ...keyed("contest", array(ballot.contests), ["id"]),
          ...keyed("contest", array(ballot.heldContests), ["id"]),
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
          ...keyed("filing-candidacy", array(ballot.filingCandidacies), ["id"]),
          ...keyed("lineup-reconciliation", array(reconciliation?.rows), ["cardKey", "canonicalCandidacyId"]),
          ...keyed("removal", array(ballot.removals), ["id"]),
          ...keyed("contact", array(ballot.contacts), ["candidacyId"]),
        ];
      });
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

/** sha256 of canonicalCivicDataJson(value), fed as it walks so no whole string is built. */
export function canonicalCivicDataHash(value: unknown): string {
  const hash = createHash("sha256");
  let pending = "";
  const out = (text: string) => { pending += text; if (pending.length > 1 << 20) { hash.update(pending); pending = ""; } };
  const walk = (node: unknown): string | undefined => {
    if (node === null || typeof node !== "object") return JSON.stringify(node);
    if (Array.isArray(node)) {
      out("[");
      for (let index = 0; index < node.length; index++) {
        if (index) out(",");
        const text = index in node ? walk(node[index]) : undefined;
        if (text !== undefined) out(text);
      }
      out("]");
      return "";
    }
    out("{");
    Object.entries(node as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).forEach(([key, child], index) => {
      out(`${index ? "," : ""}${JSON.stringify(key)}:`);
      const text = walk(child);
      out(text === undefined ? "undefined" : text);
    });
    out("}");
    return "";
  };
  const top = walk(value);
  if (top) out(top);
  return hash.update(pending).digest("hex");
}

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

export const ROW_KEYED_CIVIC_CHANGE_CONTRACT: CivicChangeContract = {
  members: rowKeyedCivicRecordsFor,
  facts: (_recordClass, member) => member.record,
};

export function candidateChangeSet(
  candidate: RoutineCandidate,
  previousPayload: unknown | null,
  contract: CivicChangeContract = CIVIC_CHANGE_CONTRACT,
  priorIndex?: StatePublicationPrior,
): RoutineChangeSet {
  // Derive deltas from the Reader projection; caller-supplied members remain evidence to validate.
  const next = contract.members(candidate.recordClass, candidate.readModel);
  const prior = priorIndex ? [...priorIndex.members.values()].map(member => ({ key: member.key, record: member.record })) : previousPayload === null ? [] : contract.members(candidate.recordClass, previousPayload);
  const priorByKey = new Map(prior.map((member) => [member.key, member]));
  const nextByKey = new Map(next.map((member) => [member.key, member.record]));
  const scoped = statePublicationScope(candidate.scope);
  const facts = (member: CivicRecordMember) => scoped ?
    (contract === CIVIC_CHANGE_CONTRACT ? statePublicationRecordHash(candidate.recordClass, member)?.factsHash : undefined) ??
      immutableStateHash(contract.facts(candidate.recordClass, member)) :
    canonicalCivicDataJson(contract.facts(candidate.recordClass, member));
  const added = next
    .filter((member) => !priorByKey.has(member.key))
    .map((member) => ({ key: member.key, before: null, after: member.record }));
  // The persisted before/after stay the exact records; only facts decide.
  const changed = next
    .filter((member) => priorByKey.has(member.key) && (priorIndex?.members.get(member.key)?.factsHash ?? facts(priorByKey.get(member.key)!)) !== facts(member))
    .map((member) => ({ key: member.key, before: priorByKey.get(member.key)?.record ?? null, after: member.record }));
  const removed = prior
    .filter((member) => !nextByKey.has(member.key))
    .map((member) => ({ key: member.key, before: member.record, after: null }));
  if (priorIndex) {
    for (const delta of [...changed, ...removed]) {
      const original = priorIndex.members.get(delta.key)!;
      if (!Object.hasOwn(original, "record")) throw new Error(`STATE_PRIOR_RECORD_RELEASED:${delta.key}`);
      if (immutableStateHash(delta.before) !== original.sha256) throw new Error(`STATE_PRIOR_RECORD_MUTATED:${delta.key}`);
    }
    for (const member of priorIndex.members.values()) delete member.record;
  }
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
