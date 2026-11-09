import { currentOfficialIdentityStatus, officialIdsForCandidacy, resolvedCandidacyForOfficial } from "../funding/campaign-money.ts";
import { azLineupReconciliation, reconciledCandidacyIdForCard } from "./az-2026.ts";
import { currentRosterMemberReaderDisposition, currentRosterPersonKeys } from "../registry/runtime-read-model.ts";
import { fecPersonKeys } from "../funding/snapshot.ts";
import { candidateCardIdentityUnresolved, candidateKeysForState, heldCandidatePersonKeys } from "../ballot/person-keys.ts";
import { selectedRegistryStates } from "../registry/runtime-read-model.ts";
import { currentReaderSelection } from "../db/reader-route.ts";

type PersonKeys = { status: "RESOLVED" | "DIRECT" | "IDENTITY_UNRESOLVED"; keys: string[] };
const requestKeys = new WeakMap<object, Map<string, PersonKeys>>();

/**
 * Exact committed person relationships; no names participate in reader joins. A request reads one fixed
 * set of projections, so each person resolves once per request however many cards ask about them.
 */
export function readerPersonKeys(subjectId: string): PersonKeys {
  const request = currentReaderSelection();
  if (!request) return resolvePersonKeys(subjectId);
  let held = requestKeys.get(request);
  if (!held) requestKeys.set(request, held = new Map());
  let found = held.get(subjectId);
  if (!found) held.set(subjectId, found = resolvePersonKeys(subjectId));
  return { status: found.status, keys: [...found.keys] };
}

function resolvePersonKeys(subjectId: string): PersonKeys {
  const namedState = /^(?:ballot-)?([a-z]{2})[-:]/i.exec(subjectId)?.[1]?.toUpperCase();
  const states = [...new Set([...selectedRegistryStates(), ...namedState ? [namedState] : []])];
  const unresolvedCard = (key: string) => states.some(state => candidateCardIdentityUnresolved(state, key));
  if (unresolvedCard(subjectId)) return { status: "DIRECT", keys: [subjectId] };
  const rosterIdentity = currentRosterMemberReaderDisposition(subjectId);
  if (rosterIdentity?.state === "IDENTITY_UNRESOLVED") return { status: "IDENTITY_UNRESOLVED", keys: [] };
  if (rosterIdentity?.state === "EXACT_DUPLICATE") return readerPersonKeys(rosterIdentity.canonicalId!);
  if (currentOfficialIdentityStatus(subjectId) === "IDENTITY_UNRESOLVED") return { status: "IDENTITY_UNRESOLVED", keys: [] };
  const keys = new Set<string>();
  const pending = [subjectId];
  while (pending.length) {
    const key = pending.shift()!;
    if (!key || keys.has(key) || unresolvedCard(key)) continue;
    keys.add(key);
    for (const related of currentRosterPersonKeys(key)) if (!keys.has(related)) pending.push(related);
    const namedState = /^(?:ballot-)?([a-z]{2})[-:]/i.exec(key)?.[1]?.toUpperCase();
    for (const state of new Set([...selectedRegistryStates(), ...namedState ? [namedState] : []]))
      for (const alias of [...candidateKeysForState(state, key), ...heldCandidatePersonKeys(state, key)]) if (!keys.has(alias)) pending.push(alias);
    for (const related of fecPersonKeys(key)) if (!keys.has(related)) pending.push(related);
    const isAzCandidacy = key.startsWith("ballot-az-");
    const azRows = isAzCandidacy ? azLineupReconciliation()?.rows ?? [] : [];
    const candidacy = resolvedCandidacyForOfficial(key)?.candidacyId
      ?? (isAzCandidacy ? reconciledCandidacyIdForCard(key) : null);
    if (candidacy && !keys.has(candidacy)) pending.push(candidacy);
    for (const officialId of officialIdsForCandidacy(key)) if (!keys.has(officialId)) pending.push(officialId);
    for (const row of azRows) if (row.outcome === "RECONCILED" && row.canonicalCandidacyId === key && !keys.has(row.cardKey)) pending.push(row.cardKey);
  }
  return { status: keys.size > 1 ? "RESOLVED" : "DIRECT", keys: [...keys].sort() };
}

export class ReaderPersonIdentityError extends Error {
  readonly code = "READER_PERSON_IDENTITY_UNRESOLVED";
  constructor() { super("The supplied identity could not be verified against the current canonical person; no other person's records were attached."); this.name = "ReaderPersonIdentityError"; }
}

export function verifiedReaderPersonKeys(subjectId: string): string[] {
  const identity = readerPersonKeys(subjectId);
  if (identity.status === "IDENTITY_UNRESOLVED") throw new ReaderPersonIdentityError();
  return identity.keys;
}
