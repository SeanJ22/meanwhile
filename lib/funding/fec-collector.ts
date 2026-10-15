import { currentFecTransactions, fecId, fecNumber, fecObject, fecSourceObservedAt, fecText, readFecPages, type FecReadPage, type FecRow } from "./fec-api.ts";
import { smallDonorShare } from "./small-donors.ts";
import { fecRegistrationLabel, fecRegistrationTargets, type FecTarget, type FecDiscovery, type FecRegistration } from "./fec-discovery.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import type { ContributionRow, FundingCandidate, SecondHopCommittee } from "./types.ts";
import { isSourceAcquisitionFailure, sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";

export function fecTotalsForPeriod(rows: readonly FecRow[], candidateId: string, cycle: number): FecRow | null {
  const scoped = rows.filter(row => row.cycle === cycle);
  if (scoped.some(row => row.is_election === true || row.election_full === true)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_TWO_YEAR_TOTALS_REQUIRED");
  const nativeField = candidateId.startsWith("C") ? "committee_id" : "candidate_id";
  if (scoped.some(row => row[nativeField] !== undefined && row[nativeField] !== candidateId)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_TOTALS_IDENTITY_INVALID");
  const sorted = scoped.toSorted((a, b) => String(b.coverage_end_date ?? "").localeCompare(String(a.coverage_end_date ?? "")));
  const latest = sorted[0];
  if (!latest) return null;
  const sameDate = sorted.filter(row => String(row.coverage_end_date ?? "") === String(latest.coverage_end_date ?? ""));
  const figures = (row: FecRow) => JSON.stringify([row.receipts, row.disbursements, row.last_cash_on_hand_end_period, row.individual_itemized_contributions, row.individual_unitemized_contributions]);
  if (sameDate.some(row => figures(row) !== figures(latest))) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_TOTALS_AMBIGUOUS");
  return latest;
}

/** National totals do not contain the unitemized line. Preserve it with its own
 * filing date; a bulk individual total never stands in for that line. */
export function projectFecDiscovery(discovery: FecDiscovery, cycle: number, roster?: OfficeholderSet, previous: readonly FundingCandidate[] = []): FundingCandidate[] {
  const totals = new Map<string, FecRow[]>(), held = new Map(previous.map(row => [row.fecCandidateId, row]));
  for (const row of discovery.totals) {
    const id = fecText(row.candidate_id); if (!id) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_TOTALS_IDENTITY_INVALID");
    const rows = totals.get(id) ?? []; rows.push(row); totals.set(id, rows);
  }
  return discovery.registrations.map(registration => {
    const latest = fecTotalsForPeriod(totals.get(registration.candidateId) ?? [], registration.candidateId, cycle);
    return registeredFecCandidate(registration, cycle, latest, fecRegistrationTargets(registration, roster), held.get(registration.candidateId));
  });
}

function registeredFecCandidate(registration: FecRegistration, cycle: number, latest: FecRow | null, targets: readonly FecTarget[], previous?: FundingCandidate): FundingCandidate {
  const held = previous?.cycle === cycle ? previous : undefined;
  const checkedAt = latest ? fecSourceObservedAt(latest) ?? registration.observedAt : held?.provenance.collectedAt ?? registration.observedAt;
  const hasLines = fecNumber(latest?.individual_itemized_contributions) !== null && fecNumber(latest?.individual_unitemized_contributions) !== null;
  const itemized = hasLines ? fecNumber(latest?.individual_itemized_contributions) : held?.totals.individualItemized ?? null;
  const unitemized = hasLines ? fecNumber(latest?.individual_unitemized_contributions) : held?.totals.individualUnitemized ?? null;
  const committees = held?.principalCommitteeIds ?? (registration.principalCommitteeId ? [registration.principalCommitteeId] : held?.principalCommitteeId ? [held.principalCommitteeId] : []);
  const coverage = fecText(latest?.coverage_end_date)?.slice(0, 10) ?? held?.totals.coverageEndDate ?? null;
  return {
    dataClass: "FEC_COMMITTEE", fecCandidateId: registration.candidateId, name: registration.name, state: registration.state,
    office: registration.office, district: registration.district,
    registration: { electionYear: registration.electionYear, label: fecRegistrationLabel(registration), collectedAt: registration.observedAt },
    targetKeys: [...new Set([...targets.map(row => row.targetKey), ...(held?.targetKeys.filter(key => key.startsWith("ballot-")) ?? [])])], matchRoutes: ["native-source-id"],
    principalCommitteeId: committees.length === 1 ? committees[0] : null, principalCommitteeIds: committees, cycle,
    totals: { receipts: latest ? fecNumber(latest.receipts) : held?.totals.receipts ?? null,
      disbursements: latest ? fecNumber(latest.disbursements) : held?.totals.disbursements ?? null,
      cashOnHand: latest ? fecNumber(latest.last_cash_on_hand_end_period ?? latest.cash_on_hand_end_period) : held?.totals.cashOnHand ?? null,
      individualItemized: itemized, individualUnitemized: unitemized, smallDonorShare: smallDonorShare(itemized, unitemized), coverageEndDate: coverage,
      ...(hasLines ? { smallDonorCoverageEndDate: coverage, smallDonorCollectedAt: checkedAt } : held ? {
        smallDonorCoverageEndDate: held.totals.smallDonorCoverageEndDate ?? held.totals.coverageEndDate,
        smallDonorCollectedAt: held.totals.smallDonorCollectedAt ?? held.provenance.collectedAt } : {}) },
    topContributions: held?.topContributions.map(row => ({ ...row, sourceObservedAt: row.sourceObservedAt ?? held.provenance.collectedAt })) ?? [],
    provenance: { sourceUrl: `https://www.fec.gov/data/candidate/${registration.candidateId}/?cycle=${cycle}`,
      sourceOrg: "Federal Election Commission", collectedAt: checkedAt, verifiedAt: checkedAt },
    acquisition: { totalsComplete: latest !== null || held?.acquisition?.totalsComplete === true,
      contributionsComplete: false, checkedAt },
  };
}

/** The filing's own two individual lines, never a subtraction from other totals. */
export async function collectFecSmallDonorLines(candidate: FundingCandidate, read: FecReadPage, observedAt: () => string): Promise<FundingCandidate> {
  const latest = fecTotalsForPeriod(await readFecPages(read, `/candidate/${candidate.fecCandidateId}/totals/`, { cycle: candidate.cycle, election_full: false }), candidate.fecCandidateId, candidate.cycle);
  if (!latest) return candidate;
  const itemized = fecNumber(latest.individual_itemized_contributions), unitemized = fecNumber(latest.individual_unitemized_contributions);
  if (itemized === null || unitemized === null) return candidate;
  return { ...candidate, totals: { ...candidate.totals, individualItemized: itemized, individualUnitemized: unitemized,
    smallDonorShare: smallDonorShare(itemized, unitemized), smallDonorCoverageEndDate: fecText(latest.coverage_end_date)?.slice(0, 10) ?? null,
    smallDonorCollectedAt: fecSourceObservedAt(latest) ?? observedAt() } };
}

/** A contributing committee's own books remain a distinct source scope. */
export async function collectFecCommittee(input: { committeeId: string; cycle: number; read: FecReadPage; observedAt: () => string }): Promise<SecondHopCommittee> {
  const { committeeId: id, cycle, read } = input;
  if (!/^C\d{8}$/.test(id)) throw new Error("FEC_COMMITTEE_ID_INVALID");
  const details = await readFecPages(read, `/committee/${id}/`, {});
  if (details.length !== 1 || details[0].committee_id !== id || !fecText(details[0].name)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_COMMITTEE_IDENTITY_INVALID");
  const detail = details[0];
  const latest = fecTotalsForPeriod(await readFecPages(read, `/committee/${id}/totals/`, { cycle }), id, cycle);
  const rows = await readFecPages(read, "/schedules/schedule_a/", { committee_id: id,
    two_year_transaction_period: cycle, is_individual: false, sort: "-contribution_receipt_amount" }, true);
  const observedAt = input.observedAt();
  return { dataClass: "FEC_CONTRIBUTOR", committeeId: id, name: fecText(detail.name)!,
    committeeType: fecText(detail.committee_type), organizationType: fecText(detail.organization_type),
    designation: fecText(detail.designation), cycle, receipts: fecNumber(latest?.receipts),
    topContributions: fecOrganizationRows(rows, id).sort((a, b) => b.amount - a.amount).slice(0, 5), provenance: {
      sourceUrl: `https://www.fec.gov/data/committee/${id}/?cycle=${cycle}`, sourceOrg: "Federal Election Commission",
      collectedAt: observedAt, verifiedAt: observedAt,
    } };
}

/** Named organization amounts only; private individuals stay in source evidence. */
export function fecOrganizationRows(rows: readonly FecRow[], committeeId: string): ContributionRow[] {
  const entities = new Set(["CCM", "COM", "ORG", "PAC", "PTY"]);
  return currentFecTransactions(rows, committeeId).flatMap(row => {
    const entity = fecText(row.entity_type), line = fecText(row.line_number), amount = fecNumber(row.contribution_receipt_amount), name = fecText(row.contributor_name);
    if (!entity || !entities.has(entity) || !line || !(line.startsWith("11") || line === "12") || amount === null || !name) return [];
    const contributor = fecObject(row.contributor);
    return [{ dataClass: "FEC_CONTRIBUTOR", kind: "COMMITTEE_OR_ORGANIZATION", contributorName: name,
      amount, receiptDate: fecText(row.contribution_receipt_date)?.slice(0, 10) ?? null,
      city: null, state: fecText(row.contributor_state), entityType: entity, lineNumber: line,
      committeeType: fecText(contributor?.committee_type), organizationType: fecText(contributor?.organization_type),
      designation: fecText(contributor?.designation), contributorCommitteeId: /^C\d{8}$/.test(String(row.contributor_id)) ? String(row.contributor_id) : null,
      transactionId: fecText(row.transaction_id), filingId: fecId(row.sub_id),
      sourceUrl: `https://www.fec.gov/data/receipts/?committee_id=${committeeId}`,
      ...(fecSourceObservedAt(row) ? { sourceObservedAt: fecSourceObservedAt(row) } : {}),
    } satisfies ContributionRow];
  });
}

export async function collectFecCandidate(input: {
  candidateId: string; cycle: number; targets: readonly FecTarget[]; read: FecReadPage;
  observedAt: () => string; previous?: FundingCandidate;
  /** Supplied paged totals avoid another per-person totals request during receipt enrichment. */
  totals?: FecRow;
}): Promise<{ candidate: FundingCandidate | null; gaps: string[] }> {
  const { candidateId: id, cycle, read, previous } = input;
  if (!/^[HS]\d[A-Z]{2}\d{5}$/.test(id) || !input.targets.length) throw new Error("FEC_NATIVE_CANDIDATE_REQUIRED");
  const totals = input.totals ?? fecTotalsForPeriod(await readFecPages(read, `/candidate/${id}/totals/`, { cycle, election_full: false }), id, cycle);
  if (!totals) return { candidate: null, gaps: [`No candidate totals returned for ${id}, ${cycle}; previous evidence retained.`] };
  const checkedAt = fecSourceObservedAt(totals) ?? input.observedAt();
  const receipts = fecNumber(totals.receipts), disbursements = fecNumber(totals.disbursements), cash = fecNumber(totals.last_cash_on_hand_end_period ?? totals.cash_on_hand_end_period);
  if ([receipts, disbursements, cash].every(value => value === null)) return { candidate: null, gaps: [`${id}: no numeric filed total for ${cycle}.`] };
  const gaps: string[] = [], committeeIds: string[] = [];
  let contributionsComplete = true, contributions: ContributionRow[] = [];
  try {
    const committees = await readFecPages(read, `/candidate/${id}/committees/`, { cycle });
    for (const row of committees) {
      if (Array.isArray(row.candidate_ids) && !row.candidate_ids.includes(id)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_COMMITTEE_CANDIDATE_MISMATCH");
      if (!/^C\d{8}$/.test(String(row.committee_id))) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_COMMITTEE_ID_INVALID");
      if (row.designation === "P" || row.designation === "A") committeeIds.push(String(row.committee_id));
    }
    for (const committeeId of [...new Set(committeeIds)]) {
      const rows = await readFecPages(read, "/schedules/schedule_a/", { committee_id: committeeId,
        two_year_transaction_period: cycle, is_individual: false, sort: "-contribution_receipt_amount" }, true);
      contributions.push(...fecOrganizationRows(rows, committeeId));
    }
  } catch (error) {
    if (!isSourceAcquisitionFailure(error)) throw error;
    contributionsComplete = false;
    gaps.push(`${id}: committee/receipt acquisition incomplete; independently verified totals published.`);
    contributions = previous?.cycle === cycle ? previous.topContributions.map(row => ({ ...row,
      sourceObservedAt: row.sourceObservedAt ?? previous.provenance.collectedAt })) : [];
  }
  const itemized = fecNumber(totals.individual_itemized_contributions), unitemized = fecNumber(totals.individual_unitemized_contributions);
  const exactCommitteeIds = contributionsComplete ? [...new Set(committeeIds)] : previous?.cycle === cycle
    ? previous.principalCommitteeIds ?? (previous.principalCommitteeId ? [previous.principalCommitteeId] : []) : [...new Set(committeeIds)];
  const target = input.targets[0];
  return { gaps, candidate: {
    dataClass: "FEC_COMMITTEE", fecCandidateId: id, name: target.displayName, state: target.state, office: target.office,
    district: target.district, targetKeys: [...new Set([`fec:${id}`, ...input.targets.map(row => row.targetKey)])], matchRoutes: ["native-source-id"],
    ...(previous?.registration ? { registration: previous.registration } : {}),
    principalCommitteeId: exactCommitteeIds.length === 1 ? exactCommitteeIds[0] : null, principalCommitteeIds: exactCommitteeIds,
    cycle, totals: { receipts, disbursements, cashOnHand: cash, individualItemized: itemized, individualUnitemized: unitemized,
      smallDonorShare: smallDonorShare(itemized, unitemized), coverageEndDate: fecText(totals.coverage_end_date)?.slice(0, 10) ?? null },
    topContributions: contributions.sort((a, b) => b.amount - a.amount).slice(0, 5),
    provenance: { sourceUrl: `https://www.fec.gov/data/candidate/${id}/?cycle=${cycle}`, sourceOrg: "Federal Election Commission", collectedAt: checkedAt, verifiedAt: checkedAt },
    acquisition: { totalsComplete: true, contributionsComplete, checkedAt },
  } };
}
