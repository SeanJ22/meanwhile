import type { RoutineDataStore } from "../../civic-data/store.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import { failedAcquisitionCandidate, normalizedHash, sha256 } from "../../civic-data/candidate-builders.ts";
import { processRegisteredRoutineCandidate } from "../../civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../../civic-data/runner-receipt.ts";
import { federalClient, federalPages, regulationPages, type FederalClientOptions, type FederalPage, type RegulationPageWork } from "./acquire.ts";
import { billIdentity, object, string, normalizeFederalCapture, normalizeFederalCaptureWithRoster } from "./normalize.ts";
import { countFederalFacts, publishFederalPartition, saveFederalSourceCheck } from "./publication.ts";
import { FEDERAL_PARSER_VERSION, FEDERAL_RECORD_CLASS, FEDERAL_SOURCES, federalScope } from "./targets.ts";
import type { FederalCapture, FederalCounts, FederalFact } from "./types.ts";
import { federalCalendarDate } from "./presentation.ts";
import { heldCongressRosterVersions, readLdaRosterVersion } from "./lda-roster.ts";
import { federalPartitionState, unchangedFederalSourceInput } from "./source-hash.ts";
import { ZERO_RELEASE_EVENTS } from "../../civic-data/release.ts";

export interface FederalRefreshOptions extends FederalClientOptions {
  store: RoutineDataStore;
  vault: EvidenceStore;
  /** Tests inject the same exact-ID join the runtime performs against held membership. */
  memberState?: (bioguide: string) => Promise<string | null>;
  doorOutcome?: (ok: boolean, at: string, reason?: string) => Promise<unknown>;
}
const emptyCounts = (): FederalCounts => ({ loaded: 0, joined: 0, unjoined: 0, byState: {} });
/** Congress.gov and govinfo reject ISO timestamps containing fractional seconds. */
export const federalApiTimestamp = (value: string) => new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
function replaceCounts(total: FederalCounts, before: FederalCounts | undefined, after: FederalCounts) {
  for (const key of ["loaded", "joined", "unjoined"] as const) total[key] += after[key] - (before?.[key] ?? 0);
  for (const state of new Set([...Object.keys(before?.byState ?? {}), ...Object.keys(after.byState)])) {
    const row = total.byState[state] ??= { loaded: 0, joined: 0, unjoined: 0 };
    for (const key of ["loaded", "joined", "unjoined"] as const) row[key] += (after.byState[state]?.[key] ?? 0) - (before?.byState[state]?.[key] ?? 0);
  }
  for (const reason of new Set([...Object.keys(before?.unjoinedReasons ?? {}), ...Object.keys(after.unjoinedReasons ?? {})])) {
    const reasons = total.unjoinedReasons ??= {};
    reasons[reason] = (reasons[reason] ?? 0) + (after.unjoinedReasons?.[reason] ?? 0) - (before?.unjoinedReasons?.[reason] ?? 0);
    if (!reasons[reason]) delete reasons[reason];
  }
}

export async function refreshFederalSource(options: FederalRefreshOptions) {
  const { source, store, vault } = options, now = options.now ?? (() => new Date().toISOString()), startedAt = now();
  const client = federalClient(options), config = FEDERAL_SOURCES[source];
  async function recordDoor(ok: boolean, at: string, reason?: string) {
    try { await options.doorOutcome?.(ok, at, reason); }
    catch (error) {
      // An operational door write cannot invent an API outage or emit a second source receipt.
      console.error(JSON.stringify({ source, doorOutcomeFailure: error instanceof Error ? error.message : String(error) }));
    }
  }
  const prior = await federalPartitionState(store, source, "national");
  const counts: FederalCounts = structuredClone(prior?.counts ?? emptyCounts());
  const canonicalCounts = await store.readFederalCounts?.(source);
  let countSnapshotComplete = canonicalCounts?.complete ?? false;
  const useCanonicalCounts = (value: FederalCounts) => {
    const joinReadFailures = counts.joinReadFailures;
    Object.assign(counts, value);
    if (!value.unjoinedReasons) delete counts.unjoinedReasons;
    if (joinReadFailures !== undefined) counts.joinReadFailures = joinReadFailures;
  };
  // A hard kill after a native partition write cannot strand the prior national total.
  // Only canonical per-partition count fields are summed; source clocks and held facts are not reopened.
  if (canonicalCounts?.complete) useCanonicalCounts(canonicalCounts.counts);
  let last: Awaited<ReturnType<typeof publishFederalPartition>> | undefined;
  let listing: FederalCapture | undefined;
  const rosterVersions = source === "regulations-gov" || source === "federal-register" ? [] : await heldCongressRosterVersions(store);
  const rosterVersionId = rosterVersions.join("|");
  let congress: ReturnType<typeof readLdaRosterVersion> | undefined;
  const heldCongress = () => congress ??= rosterVersionId ? readLdaRosterVersion(store, vault, rosterVersionId) : Promise.resolve(undefined);
  const memberStates = new Map<string, string | null>();
  const memberState = async (id: string) => {
    if (!memberStates.has(id)) {
      try { memberStates.set(id, options.memberState ? await options.memberState(id) : (await heldCongress())?.members.find(row => row.bioguideId === id)?.state ?? null); }
      catch { memberStates.set(id, null); counts.joinReadFailures = (counts.joinReadFailures ?? 0) + 1; }
    }
    return memberStates.get(id)!;
  };
  async function publish(partition: string, captures: FederalCapture[], facts: FederalFact[], primary = true, completePartition = false,
    replacement: { replaceFilingId?: string; cursor?: string } = {}) {
    const billStates = new Map<string, Awaited<ReturnType<typeof federalPartitionState>>>();
    if (source === "govinfo") for (const billId of new Set(facts.flatMap(row => row.billId ? [row.billId] : []))) {
      billStates.set(billId, await federalPartitionState(store, "congress-api", `bill:${billId}`));
    }
    const dependencyHash = normalizedHash([rosterVersionId, [...billStates].map(([id, state]) => [id, state?.head.versionId ?? null])]);
    const result = await publishFederalPartition({ source, partition, captures, records: facts, store, vault, now: now(), completePartition, ...replacement, countsPrimary: primary,
      dependencyHash, countRecords: async retained => {
        const joined = new Set<string>();
        const states = new Map<string, string>();
        for (const row of retained) {
          if (source === "senate-lda" && row.honoreeJoin?.status === "JOINED" && row.bioguideId) {
            joined.add(row.id); states.set(row.id, row.honoreeJoin.state);
          }
          else if (row.bioguideId) {
            const state = await memberState(row.bioguideId);
            if (state) { joined.add(row.id); states.set(row.id, state); }
          }
          else if (row.kind === "RULE") joined.add(row.id); // Federal jurisdiction covers every state and territory.
          else if (row.billId) {
            if (!billStates.has(row.billId)) billStates.set(row.billId, await federalPartitionState(store, "congress-api", `bill:${row.billId}`));
            const bill = billStates.get(row.billId);
            if (bill && (bill.counts?.loaded ?? 0) > 0) {
              joined.add(row.id);
              const state = Object.entries(bill.counts?.byState ?? {}).find(([key, count]) => key !== "US" && count.loaded > 0)?.[0];
              if (state) states.set(row.id, state);
            }
          }
        }
        return countFederalFacts(retained.map(row => states.has(row.id) ? { ...row, state: states.get(row.id) } : row), joined);
    } });
    if (result.kind === "PUBLISHED") {
      const delta = result.outcome.candidate.candidate.changeSet;
      const changed = [...(delta?.added ?? []), ...(delta?.changed ?? [])].filter(row => row.key.startsWith("federal:")).length;
      if (changed > 0) console.log("RCD_PROGRESS=" + JSON.stringify({ key: result.candidate.id, records: changed }));
    }
    if (primary) {
      const aggregate = !countSnapshotComplete ? await store.readFederalCounts?.(source) : null;
      if (aggregate?.complete) { useCanonicalCounts(aggregate.counts); countSnapshotComplete = true; }
      else if (result.kind === "PUBLISHED") replaceCounts(counts, result.previousCounts, result.counts!);
      last = await publishFederalPartition({ source, partition: "national", captures, records: [], store, vault, now: now(), counts });
    }
    return result;
  }
  async function checkpoint(cursor: string, capture: FederalCapture) {
    listing = capture;
    last = await publishFederalPartition({ source, partition: "national", captures: [capture], records: [], store, vault, now: now(), cursor, counts });
  }
  async function congressBill(row: Record<string, unknown>, sponsored?: FederalCapture, bioguide?: string) {
    const billId = billIdentity(row);
    if (!billId) {
      if (sponsored) await publish(`unjoined:${billId || string(row.number) || "unknown"}`, [sponsored], normalizeFederalCapture(sponsored));
      return;
    }
    const [congress, type, number] = billId.split(":"), route = `${config.url}bill/${congress}/${type}/${number}`;
    const detail = await client.get(route, "bill", { billId });
    const billFacts = normalizeFederalCapture(detail), sponsor = billFacts.find(fact => fact.kind === "BILL")?.bioguideId ?? bioguide;
    // Sponsorship and basic bill facts reach readers before optional text/referrals are read.
    await publish(`bill:${billId}`, [detail], billFacts, !sponsor);
    if (sponsor) await publish(`congress:${sponsor}`, [detail], billFacts);
    const captures: FederalCapture[] = [detail], facts: FederalFact[] = [...billFacts];
    for (const [suffix, kind] of [["committees", "committees"], ["text", "text-versions"]] as const) {
      for await (const page of federalPages(client, source, `${route}/${suffix}?limit=250`, kind, { billId })) {
        captures.push(page.capture); facts.push(...normalizeFederalCapture(page.capture));
        await publish(`bill:${billId}`, captures, facts, false);
        if (sponsor) await publish(`congress:${sponsor}`, captures, facts);
      }
    }
  }
  try {
    const cursor = prior?.cursor;
    if (source === "congress-api") {
      if (!cursor || cursor.startsWith("bootstrap:")) {
        const checkpointData = cursor?.startsWith("bootstrap:") ? JSON.parse(cursor.slice(10)) as { url: string; index: number; pageHash?: string; sponsoredUrl?: string; sponsoredHash?: string; billIndex?: number; through?: string } : null;
        const through = checkpointData?.through ?? startedAt;
        const start = checkpointData?.url ?? `${config.url}member?currentMember=true&limit=250`;
        for await (const page of federalPages(client, source, start, "members")) {
          const pageHash = sha256(page.capture.body), samePage = page.capture.url === checkpointData?.url && checkpointData?.pageHash === pageHash;
          if (!samePage) await checkpoint(`bootstrap:${JSON.stringify({ url: page.capture.url, pageHash, index: 0, through })}`, page.capture);
          for (let index = samePage ? checkpointData!.index : 0; index < page.items.length; index++) {
            const member = page.items[index], bioguide = string(member.bioguideId);
            const memberCapture: FederalCapture = { ...page.capture, body: JSON.stringify({ members: [member] }), context: { bioguideId: bioguide } };
            const memberFacts = normalizeFederalCapture(memberCapture);
            if (!/^[A-Z]\d{6}$/.test(bioguide)) {
              await publish(`unjoined:member:${memberFacts[0].nativeId}`, [memberCapture], memberFacts); continue;
            }
            await publish(`congress:${bioguide}`, [memberCapture], memberFacts);
            const resume = samePage && index === checkpointData!.index ? checkpointData : null;
            for await (const bills of federalPages(client, source, resume?.sponsoredUrl ?? `${config.url}member/${bioguide}/sponsored-legislation?limit=250`, "sponsored", { bioguideId: bioguide })) {
              await publish(`congress:${bioguide}`, [bills.capture], normalizeFederalCapture(bills.capture));
              const sponsoredHash = sha256(bills.capture.body);
              for (let billIndex = bills.capture.url === resume?.sponsoredUrl && resume?.sponsoredHash === sponsoredHash ? resume?.billIndex ?? 0 : 0; billIndex < bills.items.length; billIndex++) {
                await congressBill(bills.items[billIndex], bills.capture, bioguide);
                await checkpoint(`bootstrap:${JSON.stringify({ url: page.capture.url, pageHash, index, sponsoredUrl: bills.capture.url, sponsoredHash, billIndex: billIndex + 1, through })}`, bills.capture);
              }
            }
            await publishFederalPartition({ source, partition: `congress:${bioguide}`, captures: [memberCapture], records: [], store, vault, now: now(), cursor: "sponsored-complete",
              countsPrimary: true, dependencyHash: normalizedHash([rosterVersionId, []]) });
            await checkpoint(`bootstrap:${JSON.stringify({ url: page.capture.url, pageHash, index: index + 1, through })}`, page.capture);
          }
          if (page.next) await checkpoint(`bootstrap:${JSON.stringify({ url: page.next, index: 0, through })}`, page.capture);
          listing = page.capture;
        }
        if (!listing) throw new Error("Congress.gov member enumeration returned no source page.");
        await checkpoint(`updates:${through}`, listing);
      } else {
        // The roster changes independently of bill updates. A newly seated member gets their whole
        // sponsorship history; an interrupted history has no completion cursor and remains owed.
        for await (const page of federalPages(client, source, `${config.url}member?currentMember=true&limit=250`, "members")) {
          for (const member of page.items) {
            const bioguide = string(member.bioguideId), partition = `congress:${bioguide}`;
            const memberCapture: FederalCapture = { ...page.capture, body: JSON.stringify({ members: [member] }), context: { bioguideId: bioguide } };
            if (!/^[A-Z]\d{6}$/.test(bioguide)) {
              const invalid = normalizeFederalCapture(memberCapture);
              await publish(`unjoined:member:${invalid[0].nativeId}`, [memberCapture], invalid);
              continue;
            }
            await publish(partition, [memberCapture], normalizeFederalCapture(memberCapture));
            const held = await federalPartitionState(store, source, partition);
            if (held?.cursor === "sponsored-complete") continue;
            for await (const bills of federalPages(client, source, `${config.url}member/${bioguide}/sponsored-legislation?limit=250`, "sponsored", { bioguideId: bioguide })) {
              await publish(partition, [bills.capture], normalizeFederalCapture(bills.capture));
              for (const bill of bills.items) await congressBill(bill, bills.capture, bioguide);
            }
            await publishFederalPartition({ source, partition, captures: [memberCapture], records: [], store, vault, now: now(), cursor: "sponsored-complete",
              countsPrimary: true, dependencyHash: normalizedHash([rosterVersionId, []]) });
          }
        }
        const resume = cursor.startsWith("updatesPage:") ? JSON.parse(cursor.slice(12)) as { url: string; index: number; pageHash?: string; through: string } : null;
        const from = federalApiTimestamp(cursor.startsWith("updates:") ? cursor.slice(8) : startedAt);
        const url = resume?.url ?? `${config.url}bill?limit=250&fromDateTime=${encodeURIComponent(from)}&toDateTime=${encodeURIComponent(federalApiTimestamp(startedAt))}&sort=updateDate+asc`;
        for await (const page of federalPages(client, source, url, "bill")) {
          const pageHash = sha256(page.capture.body);
          for (let index = page.capture.url === resume?.url && resume?.pageHash === pageHash ? resume!.index : 0; index < page.items.length; index++) {
            await congressBill(page.items[index]);
            await checkpoint(`updatesPage:${JSON.stringify({ url: page.capture.url, pageHash, index: index + 1, through: resume?.through ?? startedAt })}`, page.capture);
          }
          listing = page.capture;
        }
        if (listing) await checkpoint(`updates:${new Date(Date.parse(resume?.through ?? startedAt) - 1000).toISOString()}`, listing);
      }
    } else if (source === "govinfo") {
      const resume = cursor?.startsWith("govinfoPage:") ? JSON.parse(cursor.slice(12)) as { url: string; through: string; pageHash?: string; index?: number } : null;
      const through = resume?.through ?? startedAt;
      const start = resume?.url ?? (cursor?.startsWith("https:") ? cursor : `${config.url}collections/BILLS/${federalApiTimestamp(cursor || "1993-01-01T00:00:00Z")}?pageSize=100&offsetMark=*`);
      for await (const page of federalPages(client, source, start, "govinfo-summary")) {
        const pageHash = sha256(page.capture.body);
        const firstIndex = page.capture.url === resume?.url && resume?.pageHash === pageHash ? resume?.index ?? 0 : 0;
        await checkpoint(`govinfoPage:${JSON.stringify({ url: page.capture.url, pageHash, through, index: firstIndex })}`, page.capture);
        for (let index = firstIndex; index < page.items.length; index++) {
          const item = page.items[index];
          const packageId = string(item.packageId), summary = await client.get(string(item.packageLink), "govinfo-summary");
          const data = object(JSON.parse(summary.body)), facts = normalizeFederalCapture(summary), billId = facts[0]?.billId;
          const partition = billId ? `bill:${billId}` : `unjoined:${packageId}`;
          await publish(partition, [summary], facts);
          const textUrl = string(object(data.download).txtLink);
          if (textUrl) {
            const text = await client.get(textUrl, "bill-text", { packageId, billId, publishedAt: string(data.dateIssued) });
            await publish(partition, [summary, text], [...facts, ...normalizeFederalCapture(text)]);
          }
          await checkpoint(`govinfoPage:${JSON.stringify({ url: page.capture.url, pageHash, through, index: index + 1 })}`, page.capture);
        }
        // Overlap the completed pass by one second to include equal lastModified timestamps.
        // Catch changes made during a long backfill; the watermark belongs to its first page.
        await checkpoint(page.next ? `govinfoPage:${JSON.stringify({ url: page.next, through })}` : new Date(Date.parse(through) - 1000).toISOString(), page.capture);
      }
    } else if (source === "regulations-gov" || source === "federal-register") {
      const resume = cursor?.startsWith("rulesPage:") ? JSON.parse(cursor.slice(10)) as { today: string; url?: string; pending?: RegulationPageWork[] } : null;
      const today = resume?.today ?? federalCalendarDate(startedAt);
      const pages: AsyncIterable<FederalPage> = source === "regulations-gov" ? regulationPages(client, today, "1900-01-01", today, resume?.pending) : federalPages(client, source,
        resume?.url ?? `${config.url}documents.json?per_page=1000&conditions[comment_date][gte]=${today}&order=oldest&fields[]=document_number&fields[]=title&fields[]=publication_date&fields[]=html_url&fields[]=abstract&fields[]=comments_close_on&fields[]=regulations_dot_gov_info&fields[]=docket_ids`, "rules");
      for await (const page of pages) {
        const current = new URL(page.capture.url);
        const pending = page.continuation ? [{ from: current.searchParams.get("filter[postedDate][ge]")!,
          through: current.searchParams.get("filter[postedDate][le]")!, url: page.capture.url },
          ...page.continuation.pending.slice(page.next ? 1 : 0)] : undefined;
        await checkpoint(`rulesPage:${JSON.stringify({ today, ...(pending ? { pending } : { url: page.capture.url }) })}`, page.capture);
        const facts = normalizeFederalCapture(page.capture);
        // Rule partitions retain expired and withdrawn records for Ask; the reader filters the current clock.
        await publish("rules", [page.capture], facts);
        const remaining = page.continuation?.pending;
        await checkpoint(remaining ? remaining.length ? `rulesPage:${JSON.stringify({ today, pending: remaining })}` : today
          : page.next ? `rulesPage:${JSON.stringify({ today, url: page.next })}` : today, page.capture);
      }
    } else {
      // Posting-date ranges include amended reports; the provider's next links page the full national LD-203 query.
      // Changing people/aliases reopens historical joins; an unchanged directory refresh does not.
      const rosterHash = rosterVersionId ? normalizedHash(rosterVersionId) : null;
      const saved = cursor?.startsWith("lda2:") ? JSON.parse(cursor.slice(5)) as { rosterHash: string | null; url?: string; index?: number; pageHash?: string; filingHash?: string; memberIndex?: number; after?: string; through?: string } : null;
      const resume = saved?.rosterHash === rosterHash ? saved : null;
      const through = resume?.through ?? startedAt;
      // The published maximum is 25. A date filter is required to paginate beyond page one.
      const start = resume?.url ?? `${config.url}contributions/?page_size=25&ordering=dt_posted&filing_dt_posted_after=${encodeURIComponent(resume?.after ?? "2008-01-01T00:00:00Z")}`;
      for await (const page of federalPages(client, source, start, "contributions")) {
        const pageHash = sha256(page.capture.body), samePage = page.capture.url === resume?.url && resume?.pageHash === pageHash;
        for (let index = samePage ? resume!.index ?? 0 : 0; index < page.items.length; index++) {
          const filing = page.items[index];
          const filingId = string(filing.filing_uuid);
          const filingHash = sha256(JSON.stringify(filing));
          const memberIndex = samePage && index === resume!.index && resume!.filingHash === filingHash ? resume!.memberIndex ?? 0 : 0;
          // Save the outstanding filing before its first write; an interrupted fanout remains owed.
          await checkpoint(`lda2:${JSON.stringify({ rosterHash, url: page.capture.url, pageHash, filingHash, index, memberIndex, through })}`, page.capture);
          // Disaggregate the acquired page into its unchanged filing objects. Keeping the entire
          // page in every filing and every checkpoint would multiply its storage by its page size.
          // The complete page is still saved at the page boundary; each filing keeps every source field.
          const capture: FederalCapture = { ...page.capture, body: JSON.stringify({ results: [filing] }), context: rosterVersionId
            ? { filingId, honoreeRosterVersionId: rosterVersionId } : { filingId, honoreeRosterFailure: "No place holds a federal roster; no honoree identity link can be verified." } };
          const partition = filingId ? `filing:${filingId}` : "";
          const input = { source, partition, captures: [capture], completePartition: Boolean(filingId), dependencyHash: normalizedHash([rosterVersionId, []]) };
          const unchanged = filingId ? await unchangedFederalSourceInput(store, input) : null;
          let membersConfirmed = Boolean(unchanged);
          if (unchanged) {
            const state = await federalPartitionState(store, source, partition);
            const members: string[] | null = state?.cursor?.startsWith("honorees:") ? JSON.parse(state.cursor.slice(9)) : null;
            membersConfirmed = Array.isArray(members);
            for (const member of members ?? []) {
              const memberInput = { ...input, partition: `congress:${member}`, completePartition: false, replaceFilingId: filingId };
              const matched = await unchangedFederalSourceInput(store, memberInput);
              if (!matched || !await saveFederalSourceCheck(store, memberInput, matched.head.versionId, matched.sourceUrls)) { membersConfirmed = false; break; }
            }
          }
          if (unchanged && membersConfirmed && await saveFederalSourceCheck(store, input, unchanged.head.versionId, unchanged.sourceUrls)) {
            console.log("FEDERAL_SOURCE_CONFIRMED_UNCHANGED=" + JSON.stringify({ source, partition, sourceKey: unchanged.hash.sourceKey }));
            await checkpoint(`lda2:${JSON.stringify({ rosterHash, url: page.capture.url, pageHash, index: index + 1, through })}`, page.capture);
            continue;
          }
          let roster, rosterFailure;
          try {
            roster = await heldCongress();
            if (!roster) rosterFailure = "No place holds a federal roster; no honoree identity link can be verified.";
          } catch (error) {
            rosterFailure = error instanceof Error ? error.message : String(error);
            counts.joinReadFailures = (counts.joinReadFailures ?? 0) + 1;
          }
          if (!roster) capture.context = { filingId, honoreeRosterFailure: rosterFailure };
          const facts = normalizeFederalCaptureWithRoster(capture, roster);
          const previous = filingId ? await federalPartitionState(store, source, `filing:${filingId}`) : null;
          // Keep cleanup targets in the filing itself so a failed member write can resume safely.
          const priorMembers: string[] = previous?.cursor?.startsWith("honorees:") ? JSON.parse(previous.cursor.slice(9)) : [];
          const legacyRows = previous && !previous.cursor?.startsWith("honorees:")
            ? (await store.readPromotionPayloadFields(FEDERAL_RECORD_CLASS, federalScope(source, `filing:${filingId}`), ["records"]))?.records as FederalFact[] ?? [] : [];
          const members = [...new Set([...priorMembers, ...legacyRows, ...facts]
            .flatMap(row => typeof row === "string" ? [row] : row.bioguideId ? [row.bioguideId] : []))].sort();
          // Retain every filing under its own source-native UUID, even if no recipient ID is published.
          await publish(filingId ? `filing:${filingId}` : `unjoined:${facts[0]?.nativeId}`, [capture], facts, true, Boolean(filingId),
            { cursor: `honorees:${JSON.stringify(members)}` });
          // Failed identity evidence cannot retract an already verified member link. The native filing is live; its fanout stays owed.
          if (rosterVersionId && !roster) throw new Error(`LDA_IDENTITY_EVIDENCE_UNAVAILABLE:${rosterFailure ?? rosterVersionId}`);
          for (let member = memberIndex; member < members.length; member++) {
            const bioguide = members[member];
            await publish(`congress:${bioguide}`, [capture], facts.filter(row => row.bioguideId === bioguide), false, false, { replaceFilingId: filingId });
            await checkpoint(`lda2:${JSON.stringify({ rosterHash, url: page.capture.url, pageHash, filingHash, index, memberIndex: member + 1, through })}`, capture);
          }
          await checkpoint(`lda2:${JSON.stringify({ rosterHash, url: page.capture.url, pageHash, index: index + 1, through })}`, capture);
        }
        await checkpoint(`lda2:${JSON.stringify(page.next ? { rosterHash, url: page.next, index: 0, through }
          : { rosterHash, after: new Date(Date.parse(through) - 1000).toISOString() })}`, page.capture);
      }
    }
    if (!last) throw new Error("Source produced no complete page; prior records remain held.");
    if (last.kind === "PUBLISHED") printSourceRunnerReceipt(source, last.candidate, last.outcome);
    else console.log("RCD_RECEIPT=" + JSON.stringify({ source, candidateId: last.head.versionId, acquisitionSucceeded: true,
      state: "PROMOTED", decision: "GOOD", promotedVersion: last.head.versionId, lastKnownGoodVersion: last.head.lastKnownGoodVersionId,
      structuralReleaseContract: ZERO_RELEASE_EVENTS }));
    await recordDoor(true, now());
    console.log(JSON.stringify({ source, counts, checkedAt: now() }));
    return { ok: true as const, counts, outcome: last.kind === "PUBLISHED" ? last.outcome : null };
  } catch (error) {
    const attemptedAt = now(), reason = error instanceof Error ? error.message : String(error);
    const candidate = failedAcquisitionCandidate({ sourceId: source, recordClass: FEDERAL_RECORD_CLASS, scope: federalScope(source), requestedUrl: config.url,
      attemptedAt, failureDetail: reason, parserVersion: FEDERAL_PARSER_VERSION });
    const outcome = await processRegisteredRoutineCandidate(store, source, candidate, attemptedAt);
    printSourceRunnerReceipt(source, candidate, outcome);
    await recordDoor(false, attemptedAt, reason);
    console.log(JSON.stringify({ source, outage: reason, counts, checkedAt: attemptedAt }));
    return { ok: false as const, reason, counts, outcome };
  }
}
