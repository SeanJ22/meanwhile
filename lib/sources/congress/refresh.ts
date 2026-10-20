import type { RoutineDataStore } from "../../civic-data/store.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import { failedAcquisitionCandidate, normalizedHash } from "../../civic-data/candidate-builders.ts";
import { processRegisteredRoutineCandidate } from "../../civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../../civic-data/runner-receipt.ts";
import { federalClient, federalPages, regulationPages, type FederalClientOptions, type FederalPage } from "./acquire.ts";
import { billIdentity, object, string, normalizeFederalCapture, normalizeFederalCaptureWithRoster } from "./normalize.ts";
import { countFederalFacts, publishFederalPartition, readFederalSourceProjection } from "./publication.ts";
import { FEDERAL_PARSER_VERSION, FEDERAL_RECORD_CLASS, FEDERAL_SOURCES, federalScope } from "./targets.ts";
import type { FederalCapture, FederalCounts, FederalFact } from "./types.ts";
import { federalCalendarDate } from "./presentation.ts";
import { readHeldCongressRoster } from "./lda-roster.ts";

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
  const prior = await readFederalSourceProjection(source, "national", { store, bypassCache: true, now: startedAt });
  if (prior.kind === "STORE_UNREACHABLE") throw new Error(prior.detail);
  const counts: FederalCounts = prior.kind === "PROMOTED" ? structuredClone(prior.value.counts ?? emptyCounts()) : emptyCounts();
  let last: Awaited<ReturnType<typeof publishFederalPartition>> | undefined;
  let listing: FederalCapture | undefined;
  let congress: ReturnType<typeof readHeldCongressRoster> | undefined;
  const heldCongress = () => congress ??= readHeldCongressRoster(store, vault, startedAt);
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
    const held = await readFederalSourceProjection(source, partition, { store, bypassCache: true, now: now() });
    if (held.kind === "STORE_UNREACHABLE") throw new Error(held.detail);
    const retained = new Map((!completePartition && held.kind === "PROMOTED" ? held.value.records.filter(row => !replacement.replaceFilingId || row.filingId !== replacement.replaceFilingId) : []).map(row => [row.id, row]));
    for (const row of facts) retained.set(row.id, row);
    const joined = new Set<string>();
    const states = new Map<string, string>();
    for (const row of retained.values()) {
      if (source === "senate-lda" && row.honoreeJoin?.status === "JOINED" && row.bioguideId) {
        joined.add(row.id); states.set(row.id, row.honoreeJoin.state);
      }
      else if (row.bioguideId) {
        const state = await memberState(row.bioguideId);
        if (state) { joined.add(row.id); states.set(row.id, state); }
      }
      else if (row.kind === "RULE") joined.add(row.id); // Federal jurisdiction covers every state and territory.
      else if (row.billId) {
        const bill = await readFederalSourceProjection("congress-api", `bill:${row.billId}`, { store, now: now(), bypassCache: true });
        if (bill.kind === "PROMOTED" && bill.value.records.some(fact => fact.billId === row.billId)) {
          joined.add(row.id);
          const state = bill.value.records.find(fact => fact.billId === row.billId && fact.state)?.state;
          if (state) states.set(row.id, state);
        }
      }
    }
    const nextCounts = countFederalFacts([...retained.values()].map(row => states.has(row.id) ? { ...row, state: states.get(row.id) } : row), joined);
    const result = await publishFederalPartition({ source, partition, captures, records: facts, store, vault, now: now(), counts: nextCounts, completePartition, ...replacement });
    const delta = result.outcome.candidate.candidate.changeSet;
    const changed = [...(delta?.added ?? []), ...(delta?.changed ?? [])].filter(row => row.key.startsWith("federal:")).length;
    if (changed > 0) console.log("RCD_PROGRESS=" + JSON.stringify({ key: result.candidate.id, records: changed }));
    if (primary) {
      replaceCounts(counts, result.previousCounts, nextCounts);
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
    const cursor = prior.kind === "PROMOTED" ? prior.value.cursor : undefined;
    if (source === "congress-api") {
      if (!cursor || cursor.startsWith("bootstrap:")) {
        const checkpointData = cursor?.startsWith("bootstrap:") ? JSON.parse(cursor.slice(10)) as { url: string; index: number; sponsoredUrl?: string; billIndex?: number; through?: string } : null;
        const through = checkpointData?.through ?? startedAt;
        const start = checkpointData?.url ?? `${config.url}member?currentMember=true&limit=250`;
        for await (const page of federalPages(client, source, start, "members")) {
          if (!checkpointData) await checkpoint(`bootstrap:${JSON.stringify({ url: page.capture.url, index: 0, through })}`, page.capture);
          for (let index = page.capture.url === checkpointData?.url ? checkpointData.index : 0; index < page.items.length; index++) {
            const member = page.items[index], bioguide = string(member.bioguideId);
            const memberFacts = normalizeFederalCapture(page.capture).filter(row => row.bioguideId === bioguide);
            if (!/^[A-Z]\d{6}$/.test(bioguide)) {
              const invalid = normalizeFederalCapture({ ...page.capture, body: JSON.stringify({ members: [member] }) });
              await publish(`unjoined:member:${invalid[0].nativeId}`, [page.capture], invalid); continue;
            }
            await publish(`congress:${bioguide}`, [page.capture], memberFacts);
            const resume = page.capture.url === checkpointData?.url && index === checkpointData.index ? checkpointData : null;
            for await (const bills of federalPages(client, source, resume?.sponsoredUrl ?? `${config.url}member/${bioguide}/sponsored-legislation?limit=250`, "sponsored", { bioguideId: bioguide })) {
              await publish(`congress:${bioguide}`, [bills.capture], normalizeFederalCapture(bills.capture));
              for (let billIndex = bills.capture.url === resume?.sponsoredUrl ? resume.billIndex ?? 0 : 0; billIndex < bills.items.length; billIndex++) {
                await congressBill(bills.items[billIndex], bills.capture, bioguide);
                await checkpoint(`bootstrap:${JSON.stringify({ url: page.capture.url, index, sponsoredUrl: bills.capture.url, billIndex: billIndex + 1, through })}`, bills.capture);
              }
            }
            await publishFederalPartition({ source, partition: `congress:${bioguide}`, captures: [page.capture], records: [], store, vault, now: now(), cursor: "sponsored-complete" });
            await checkpoint(`bootstrap:${JSON.stringify({ url: page.capture.url, index: index + 1, through })}`, page.capture);
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
            if (!/^[A-Z]\d{6}$/.test(bioguide)) {
              const invalid = normalizeFederalCapture({ ...page.capture, body: JSON.stringify({ members: [member] }) });
              await publish(`unjoined:member:${invalid[0].nativeId}`, [page.capture], invalid);
              continue;
            }
            const held = await readFederalSourceProjection(source, partition, { store, now: now(), bypassCache: true });
            if (held.kind === "STORE_UNREACHABLE") throw new Error(held.detail);
            await publish(partition, [page.capture], normalizeFederalCapture(page.capture).filter(row => row.bioguideId === bioguide));
            if (held.kind === "PROMOTED" && held.value.cursor === "sponsored-complete") continue;
            for await (const bills of federalPages(client, source, `${config.url}member/${bioguide}/sponsored-legislation?limit=250`, "sponsored", { bioguideId: bioguide })) {
              await publish(partition, [bills.capture], normalizeFederalCapture(bills.capture));
              for (const bill of bills.items) await congressBill(bill, bills.capture, bioguide);
            }
            await publishFederalPartition({ source, partition, captures: [page.capture], records: [], store, vault, now: now(), cursor: "sponsored-complete" });
          }
        }
        const resume = cursor.startsWith("updatesPage:") ? JSON.parse(cursor.slice(12)) as { url: string; index: number; through: string } : null;
        const from = federalApiTimestamp(cursor.startsWith("updates:") ? cursor.slice(8) : startedAt);
        const url = resume?.url ?? `${config.url}bill?limit=250&fromDateTime=${encodeURIComponent(from)}&toDateTime=${encodeURIComponent(federalApiTimestamp(startedAt))}&sort=updateDate+asc`;
        for await (const page of federalPages(client, source, url, "bill")) {
          for (let index = page.capture.url === resume?.url ? resume.index : 0; index < page.items.length; index++) {
            await congressBill(page.items[index]);
            await checkpoint(`updatesPage:${JSON.stringify({ url: page.capture.url, index: index + 1, through: resume?.through ?? startedAt })}`, page.capture);
          }
          listing = page.capture;
        }
        if (listing) await checkpoint(`updates:${new Date(Date.parse(resume?.through ?? startedAt) - 1000).toISOString()}`, listing);
      }
    } else if (source === "govinfo") {
      const resume = cursor?.startsWith("govinfoPage:") ? JSON.parse(cursor.slice(12)) as { url: string; through: string } : null;
      const through = resume?.through ?? startedAt;
      const start = resume?.url ?? (cursor?.startsWith("https:") ? cursor : `${config.url}collections/BILLS/${federalApiTimestamp(cursor || "1993-01-01T00:00:00Z")}?pageSize=100&offsetMark=*`);
      for await (const page of federalPages(client, source, start, "govinfo-summary")) {
        await checkpoint(`govinfoPage:${JSON.stringify({ url: page.capture.url, through })}`, page.capture);
        for (const item of page.items) {
          const packageId = string(item.packageId), summary = await client.get(string(item.packageLink), "govinfo-summary");
          const data = object(JSON.parse(summary.body)), facts = normalizeFederalCapture(summary), billId = facts[0]?.billId;
          const partition = billId ? `bill:${billId}` : `unjoined:${packageId}`;
          await publish(partition, [summary], facts);
          const textUrl = string(object(data.download).txtLink);
          if (textUrl) {
            const text = await client.get(textUrl, "bill-text", { packageId, billId, publishedAt: string(data.dateIssued) });
            await publish(partition, [summary, text], [...facts, ...normalizeFederalCapture(text)]);
          }
        }
        // Overlap the completed pass by one second to include equal lastModified timestamps.
        // Catch changes made during a long backfill; the watermark belongs to its first page.
        await checkpoint(page.next ? `govinfoPage:${JSON.stringify({ url: page.next, through })}` : new Date(Date.parse(through) - 1000).toISOString(), page.capture);
      }
    } else if (source === "regulations-gov" || source === "federal-register") {
      const today = federalCalendarDate(startedAt);
      const pages: AsyncIterable<FederalPage> = source === "regulations-gov" ? regulationPages(client, today) : federalPages(client, source,
        `${config.url}documents.json?per_page=1000&conditions[comment_date][gte]=${today}&order=oldest&fields[]=document_number&fields[]=title&fields[]=publication_date&fields[]=html_url&fields[]=abstract&fields[]=comments_close_on&fields[]=regulations_dot_gov_info&fields[]=docket_ids`, "rules");
      for await (const page of pages) {
        const facts = normalizeFederalCapture(page.capture);
        // Rule partitions retain expired and withdrawn records for Ask; the reader filters the current clock.
        await publish("rules", [page.capture], facts);
        await checkpoint(today, page.capture);
      }
    } else {
      // Posting-date ranges include amended reports; the provider's next links page the full national LD-203 query.
      let roster, rosterFailure;
      try {
        roster = await heldCongress();
        if (!roster) rosterFailure = "No place holds a federal roster; no honoree identity link can be verified.";
      } catch (error) {
        rosterFailure = error instanceof Error ? error.message : String(error);
        counts.joinReadFailures = (counts.joinReadFailures ?? 0) + 1;
      }
      // Changing people/aliases reopens historical joins; an unchanged directory refresh does not.
      const rosterHash = roster ? normalizedHash(roster.members.map(({ bioguideId, names, chamber, state }) => ({ bioguideId, names, chamber, state }))) : null;
      const saved = cursor?.startsWith("lda2:") ? JSON.parse(cursor.slice(5)) as { rosterHash: string | null; url?: string; index?: number; after?: string; through?: string } : null;
      const resume = saved?.rosterHash === rosterHash ? saved : null;
      const through = resume?.through ?? startedAt;
      // The published maximum is 25. A date filter is required to paginate beyond page one.
      const start = resume?.url ?? `${config.url}contributions/?page_size=25&ordering=dt_posted&filing_dt_posted_after=${encodeURIComponent(resume?.after ?? "2008-01-01T00:00:00Z")}`;
      for await (const page of federalPages(client, source, start, "contributions")) {
        for (let index = page.capture.url === resume?.url ? resume.index ?? 0 : 0; index < page.items.length; index++) {
          const filing = page.items[index];
          const filingId = string(filing.filing_uuid);
          // Disaggregate the acquired page into its unchanged filing objects. Keeping the entire
          // page in every filing and every checkpoint would multiply its storage by its page size.
          // The complete page is still saved at the page boundary; each filing keeps every source field.
          const capture: FederalCapture = { ...page.capture, body: JSON.stringify({ results: [filing] }), context: roster
            ? { honoreeRosterVersionId: roster.versionId } : { honoreeRosterFailure: rosterFailure } };
          const facts = normalizeFederalCaptureWithRoster(capture, roster);
          const previous = filingId ? await readFederalSourceProjection(source, `filing:${filingId}`, { store, now: now(), bypassCache: true }) : null;
          if (previous?.kind === "STORE_UNREACHABLE") throw new Error(previous.detail);
          // Keep cleanup targets in the filing itself so a failed member write can resume safely.
          const priorMembers: string[] = previous?.kind === "PROMOTED" && previous.value.cursor?.startsWith("honorees:") ? JSON.parse(previous.value.cursor.slice(9)) : [];
          const members = [...new Set([...priorMembers, ...(previous?.kind === "PROMOTED" ? previous.value.records : []), ...facts]
            .flatMap(row => typeof row === "string" ? [row] : row.bioguideId ? [row.bioguideId] : []))].sort();
          // Retain every filing under its own source-native UUID, even if no recipient ID is published.
          await publish(filingId ? `filing:${filingId}` : `unjoined:${facts[0]?.nativeId}`, [capture], facts, true, Boolean(filingId),
            { cursor: `honorees:${JSON.stringify(members)}` });
          for (const bioguide of members) {
            await publish(`congress:${bioguide}`, [capture], facts.filter(row => row.bioguideId === bioguide), false, false, { replaceFilingId: filingId });
          }
          await checkpoint(`lda2:${JSON.stringify({ rosterHash, url: page.capture.url, index: index + 1, through })}`, capture);
        }
        await checkpoint(`lda2:${JSON.stringify(page.next ? { rosterHash, url: page.next, index: 0, through }
          : { rosterHash, after: new Date(Date.parse(through) - 1000).toISOString() })}`, page.capture);
      }
    }
    if (!last) throw new Error("Source produced no complete page; prior records remain held.");
    printSourceRunnerReceipt(source, last.candidate, last.outcome);
    await recordDoor(true, now());
    console.log(JSON.stringify({ source, counts, checkedAt: now() }));
    return { ok: true as const, counts, outcome: last.outcome };
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
