import { createHash } from "node:crypto";
import { factReader } from "../facts/db.ts";
import { readFactRosters } from "../facts/roster-read.ts";
import { readFactCommentAccess } from "../facts/comment-read.ts";
import type { Page } from "playwright";
import type { WorkItem } from "./work-item.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { BodyRoster } from "../registry/body-rosters.ts";
import type { ServedReaderReadback, ServedReaderWitness } from "./served-reader.ts";
import { SERVED_READER_MAX_AGE_MS } from "./served-reader.ts";
import { PUBLIC_SITE_ORIGIN } from "../ops/origins.ts";
import { readerOfficeTitle } from "../officials/reader-office-title.ts";
import { officialFilingIssue, type OfficialFiling } from "../civic-data/official-filings.ts";
import type { CuratedReaderProjection } from "../civic-data/manual-projections.ts";
import { requiredManualProductionContract } from "../civic-data/manual-contracts.ts";
import { readPromotedCivicData } from "../civic-data/read-model.ts";
import type { CommentAccess } from "../registry/comment-access-client.ts";
import type { BallotNavigationProjectionRecord } from "../civic-data/curated-reader-read-model.ts";
import type { EverydayRoutingContactRecord } from "../routing/everyday.ts";
import { TOPIC_ROUTES } from "../routing/topics.ts";

export interface PublishedRosterRead {
  readonly roster: BodyRoster;
  readonly zip: string;
}
export interface PublishedFilingsRead { readonly filings: readonly OfficialFiling[]; readonly zip: string }
export type PublishedWorkerRead = PublishedRosterRead | PublishedFilingsRead;
export type PublishedManualRead =
  | { readonly kind: "comment-access"; readonly record: CommentAccess; readonly zip: string }
  | { readonly kind: "ballot-navigation"; readonly record: BallotNavigationProjectionRecord; readonly zip: string }
  | { readonly kind: "everyday-routing"; readonly record: EverydayRoutingContactRecord; readonly zip: string };

/** A real page interaction. Ask's server requests are intercepted before they
 * leave this isolated browser; only the deterministic, public contact card is
 * assessed. A client data preload or serialized props cannot pass the check. */
export async function observePublishedManual(page: Page, input: PublishedManualRead): Promise<{ confirmed: boolean; reason: string; responseSha256: string | null }> {
  try {
    if (input.kind === "ballot-navigation") {
      const response = await page.goto(`${PUBLIC_SITE_ORIGIN}/ballot?zip=${input.zip}`, { waitUntil: "domcontentloaded", timeout: 15_000 });
      if (response?.status() !== 200) throw Error("PUBLIC_HTTP_STATUS");
      const value = input.record.value;
      const label = typeof value.label === "string" ? value.label : null;
      const url = typeof value.url === "string" ? value.url : null;
      if (!label || !url || value.state !== input.record.id.split(":").at(-1)) throw Error("ROUTE_IDENTITY_INVALID");
      const links = page.getByRole("link", { name: label, exact: true });
      const matches = await links.count();
      let visible = false;
      for (let i = 0; i < matches; i++) if (await links.nth(i).isVisible() && await links.nth(i).getAttribute("href") === url) visible = true;
      if (!visible) throw Error("OFFICIAL_ROUTE_NOT_VISIBLE");
      return { confirmed: true, reason: `Public ballot for ZIP ${input.zip}: exact ${input.record.id} label and official destination visible.`, responseSha256: createHash("sha256").update(`${label}\n${url}`).digest("hex") };
    }
    const tour = page.getByRole("button", { name: "Skip the tour", exact: true });
    await page.addLocatorHandler(tour, async () => { await tour.click(); });
    const response = await page.goto(PUBLIC_SITE_ORIGIN, { waitUntil: "domcontentloaded", timeout: 15_000 });
    if (response?.status() !== 200) throw Error("PUBLIC_HTTP_STATUS");
    const coverageResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/meetings" && url.searchParams.get("zip") === input.zip && response.status() === 200;
    });
    void coverageResponse.catch(() => undefined);
    const zip = page.locator(".welcome-overlay input").first();
    await zip.fill(input.zip);
    await zip.press("Enter");
    await page.locator(".welcome-overlay.hidden").waitFor({ state: "attached" });
    const coverage = await (await coverageResponse).json() as { meetings?: { id: string; bodyId?: string; bodyName: string; title: string; status: string; startsAt: string; timeZone: string }[] };
    if (await tour.isVisible()) await tour.click();
    if (input.kind === "everyday-routing") {
      // The normal Ask server path can be paid. Block every Ask request in the
      // browser before entering a question; only the local cited route counts.
      await page.route("**/api/ask/**", route => route.abort());
      const example = TOPIC_ROUTES.find(topic => topic.id === input.record.topicId)?.examples[0];
      if (!example || input.record.zip !== input.zip) throw Error("TOPIC_IDENTITY_INVALID");
      const ask = page.locator("[data-ask-box]").first();
      await ask.fill(example);
      await ask.press("Enter");
      const card = page.locator("[data-ask-panel]").locator("div.rounded-md").filter({ hasText: input.record.contact.body }).first();
      await card.waitFor({ state: "visible", timeout: 10_000 });
      const contact = input.record.contact;
      if (!(await card.innerText()).includes(contact.service) || !(await card.innerText()).includes(contact.sourceOrg)) throw Error("CONTACT_FACT_NOT_VISIBLE");
      if (contact.phone && !(await card.innerText()).includes(contact.phone)) throw Error("CONTACT_PHONE_NOT_VISIBLE");
      if (contact.email && await card.locator(`a[href=${JSON.stringify(`mailto:${contact.email}`)}]`).count() !== 1) throw Error("CONTACT_EMAIL_NOT_VISIBLE");
      if (contact.requestUrl && await card.locator(`a[href=${JSON.stringify(contact.requestUrl)}]`).count() !== 1) throw Error("CONTACT_ROUTE_NOT_VISIBLE");
      if (await card.locator(`a[href=${JSON.stringify(contact.sourceUrl)}]`).count() !== 1) throw Error("CONTACT_SOURCE_NOT_VISIBLE");
      return { confirmed: true, reason: `Public ZIP ${input.zip} Ask local route: ${input.record.topicId} contact and source visible with Ask server requests blocked.`, responseSha256: createHash("sha256").update(await card.innerHTML()).digest("hex") };
    }
    // A comment policy is exposed in a meeting's own public card. Choose one
    // exact unconcluded meeting from the visitor's data solely to operate the
    // search control; the visible card below remains the publication proof.
    const meetings = (coverage.meetings ?? []).filter(meeting => meeting.bodyId === input.record.bodyId && meeting.status !== "CONCLUDED");
    if (meetings.length === 0) throw Error("MEETING_DESTINATION_UNAVAILABLE");
    const { formatMeetingDate } = await import("../map/format.ts");
    const meeting = meetings.find(candidate => (coverage.meetings ?? []).filter(other =>
      other.bodyName === candidate.bodyName && other.title === candidate.title &&
      formatMeetingDate(other) === formatMeetingDate(candidate)).length === 1);
    if (!meeting) throw Error("MEETING_DESTINATION_AMBIGUOUS");
    const search = page.locator("[data-ask-box]").first();
    await search.fill(`${meeting.bodyName} — ${meeting.title}`);
    const meetingRows = page.getByRole("option").filter({ hasText: `${meeting.bodyName} — ${meeting.title}` })
      .filter({ hasText: formatMeetingDate(meeting) });
    if (await meetingRows.count() !== 1) throw Error("MEETING_SEARCH_AMBIGUOUS");
    await meetingRows.click();
    const row = page.locator(`[data-meeting-id=${JSON.stringify(meeting.id)}]`);
    await row.waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
    const heard = (await row.count()) === 1 ? row.locator(".how-to-be-heard") : page.getByRole("dialog").locator(".how-to-be-heard");
    await heard.waitFor({ state: "visible", timeout: 5_000 });
    await heard.locator("summary").click();
    const text = await heard.innerText();
    for (const field of [input.record.commentPeriodDetail, input.record.signup, input.record.writtenComment, input.record.attend, input.record.timeLimit]) {
      if (field && !text.includes(field)) throw Error("COMMENT_RULE_NOT_VISIBLE");
    }
    if (await heard.locator(`a[href=${JSON.stringify(input.record.sourceUrl)}]`).count() !== 1) throw Error("COMMENT_SOURCE_NOT_VISIBLE");
    return { confirmed: true, reason: `Public ZIP ${input.zip} meeting card: exact ${input.record.bodyId} participation rules and source visible.`, responseSha256: createHash("sha256").update(await heard.innerHTML()).digest("hex") };
  } catch {
    return { confirmed: false, reason: `Public ${input.kind} controls did not confirm every exact published fact, identity and source for ZIP ${input.zip}.`, responseSha256: null };
  }
}

export async function observePublishedFilings(page: Page, input: PublishedFilingsRead): Promise<{ confirmed: boolean; reason: string; responseSha256: string | null }> {
  try {
    const response = await page.goto(`${PUBLIC_SITE_ORIGIN}/ballot?zip=${input.zip}`, { waitUntil: "domcontentloaded", timeout: 15_000 });
    if (response?.status() !== 200) throw Error("PUBLIC_HTTP_STATUS");
    const section = page.getByRole("region", { name: "Official filing records", exact: true });
    await section.waitFor({ state: "visible" });
    for (const filing of input.filings) {
      const row = section.locator(`[data-official-filing=${JSON.stringify(filing.id)}]`);
      if (await row.count() !== 1 || !await row.isVisible()) throw Error("FILING_NOT_VISIBLE");
      for (const value of Object.values(filing.facts)) if (!await row.getByText(String(value), { exact: true }).first().isVisible()) throw Error("FILING_FACT_NOT_VISIBLE");
      if (await row.getByRole("link", { name: "Read the official filing", exact: true }).getAttribute("href") !== filing.documentUrl ||
        await row.getByRole("link", { name: "Source", exact: true }).getAttribute("href") !== filing.sourceUrl ||
        !(await row.innerText()).includes(filing.collectedAt.slice(0, 10))) throw Error("FILING_SOURCE_NOT_VISIBLE");
    }
    return { confirmed: true, reason: `Public ballot for ZIP ${input.zip}: every published filing fact, document link, source and read date observed.`,
      responseSha256: createHash("sha256").update(await section.innerHTML()).digest("hex") };
  } catch {
    return { confirmed: false, reason: "Public filing readback could not observe every exact published fact and source; typed storage alone does not establish delivery.", responseSha256: null };
  }
}
/** Real visitor controls, reused from the established roster rendering proof.
 * No API-only or serialized-prop match counts as a public delivery witness. */
export async function observePublishedRoster(page: Page, input: PublishedRosterRead): Promise<{ confirmed: boolean; reason: string; responseSha256: string | null }> {
  let phase = "opening the public map";
  try {
    const tour = page.getByRole("button", { name: "Skip the tour", exact: true });
    await page.addLocatorHandler(tour, async () => { await tour.click(); });
    const response = await page.goto(PUBLIC_SITE_ORIGIN, { waitUntil: "domcontentloaded", timeout: 15_000 });
    if (response?.status() !== 200) throw Error("PUBLIC_HTTP_STATUS");
    phase = `entering ZIP ${input.zip}`;
    // The visitor's own response supplies the display label for the exact
    // canonical body. A roster title is not the map's division/body label.
    // This selects a control only; visible people and citations below remain
    // the publication evidence, never the API response by itself.
    const coverageResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/meetings" && url.searchParams.get("zip") === input.zip && response.status() === 200;
    });
    void coverageResponse.catch(() => undefined);
    const zip = page.locator(".welcome-overlay input").first();
    await zip.fill(input.zip);
    await zip.press("Enter");
    await page.locator(".welcome-overlay.hidden").waitFor({ state: "attached" });
    const coverage = await (await coverageResponse).json() as { coverage?: { bodies?: { bodyId: string; name?: string | null; divisionLabel: string }[] } };
    const body = coverage.coverage?.bodies?.find(body => body.bodyId === input.roster.bodyId);
    if (!body) throw Error("BODY_OUTSIDE_READER_COVERAGE");
    const bodyLabel = body.name ?? body.divisionLabel;
    if (await tour.isVisible()) await tour.click();
    const optional = page.getByRole("button", { name: /No thanks|show me everything|Skip for now/i }).first();
    if (await optional.isVisible()) await optional.click();
    phase = "opening Bodies here";
    const door = page.getByRole("button", { name: "Open the bodies here list", exact: true });
    if (!(await door.isVisible())) await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await door.click();
    phase = `opening ${input.roster.bodyName}`;
    await page.locator(".door-panel").getByRole("button", { name: bodyLabel, exact: true }).click();
    const modal = page.getByRole("dialog", { name: bodyLabel, exact: true });
    const section = modal.locator("button.card-section-header").filter({ has: page.getByText("Who sits on it", { exact: true }) });
    if ((await section.getAttribute("aria-expanded")) !== "true") await section.click();
    const representation = section.locator("..");
    phase = "checking the exact published people and their sources";
    const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    for (const member of input.roster.members) {
      const row = representation.locator(`[data-roster-holder=${JSON.stringify(member.id)}]`);
      if (await row.count() !== 1 || !(await row.isVisible())) throw Error("MEMBER_NOT_VISIBLE");
      const text = normalize(await row.innerText());
      if (!text.includes(normalize(member.name)) || !text.includes(normalize(readerOfficeTitle(member.officeTitle)))) throw Error("MEMBER_FACTS_NOT_VISIBLE");
      const source = member.membershipSource?.sourceUrl ?? input.roster.sourceUrl;
      if (await row.locator(`a[href=${JSON.stringify(source)}]`).count() !== 1) throw Error("MEMBER_SOURCE_NOT_VISIBLE");
    }
    return { confirmed: true, reason: `Public map → ZIP ${input.zip} → Bodies here → ${input.roster.bodyName} → Who sits on it: every published member, office and source observed.`,
      responseSha256: createHash("sha256").update(await representation.innerHTML()).digest("hex") };
  } catch {
    return { confirmed: false, reason: `Public roster readback failed while ${phase}; typed storage alone does not establish public delivery.`, responseSha256: null };
  }
}

/** Bounded work on the existing publisher cycle; older observations retain
 * their real age. Newly published or oldest-unchecked receipts go first. */
export async function collectWorkerRosterReadback(input: {
  items: readonly WorkItem[]; store: Pick<RoutineDataStore, "readCandidate">; now: string;
  previous: ServedReaderReadback | null;
  zipForDivision: (division: string) => Promise<string | null>;
  observe: (input: PublishedWorkerRead) => Promise<Awaited<ReturnType<typeof observePublishedRoster>>>;
}): Promise<ServedReaderReadback> {
  const prior = input.previous?.witnesses ?? [];
  const roster = (item: WorkItem) => item.autonomousPlan?.publication?.contractId === "registry-runtime-bindings" && item.autonomousPlan.contract.recordClass === "OFFICIAL_ROSTER";
  const versionOf = (item: WorkItem) => item.publicationOutcome?.versionId ?? (roster(item) ? item.publicationOutcome?.workerResultId ?? null : null);
  const items = input.items.filter(item => (item.autonomousPlan?.publication?.contractId === "official-filings" || roster(item)) &&
    item.publicationOutcome?.status !== "HELD" && versionOf(item));
  const observations = new Map(prior.filter(w => items.some(item => item.id === w.itemId && item.publicationOutcome?.workerResultId === w.approvalId &&
    versionOf(item) === w.versionId)).map(w => [w.itemId, w]));
  const due = items.filter(item => {
    const prior = observations.get(item.id);
    const age = Date.parse(input.now) - Date.parse(prior?.checkedAt ?? "");
    return !prior || !Number.isFinite(age) || age < 0 || age >= (prior.state === "CONFIRMED" ? SERVED_READER_MAX_AGE_MS : 15 * 60_000);
  })
    .sort((a, b) => (observations.get(a.id)?.checkedAt ?? "").localeCompare(observations.get(b.id)?.checkedAt ?? ""));
  for (const item of due.slice(0, 6)) {
    const outcome = item.publicationOutcome!;
    const base = { itemId: item.id, approvalId: outcome.workerResultId, versionId: versionOf(item)!, readerKey: item.autonomousPlan!.publication!.bodyId,
      url: PUBLIC_SITE_ORIGIN, checkedAt: input.now, responseSha256: null };
    let witness: ServedReaderWitness = { ...base, state: "NOT_OBSERVED", reason: "Exact published roster or Census-backed public destination unavailable." };
    try {
      if (item.autonomousPlan?.publication?.contractId === "official-filings") {
        const candidate = await input.store.readCandidate(outcome.versionId!);
        const payload = candidate?.candidate.readModel as CuratedReaderProjection | undefined;
        const filings = payload?.kind === "official-filings" ? payload.records.filter(row => row.bodyId === base.readerKey) as unknown as OfficialFiling[] : [];
        if (filings.length && filings.every(row => officialFilingIssue(row) === null)) {
          const observations = [];
          for (const division of [...new Set(filings.map(row => row.ocdId))]) {
            const zip = await input.zipForDivision(division);
            if (!zip || !/^\d{5}$/.test(zip)) throw Error("FILING_PUBLIC_DESTINATION_UNRESOLVED");
            const seen = await input.observe({ filings: filings.filter(row => row.ocdId === division), zip });
            observations.push({ ...seen, url: `${PUBLIC_SITE_ORIGIN}/ballot?zip=${zip}` });
          }
          const confirmed = observations.every(seen => seen.confirmed);
          witness = { ...base, url: observations[0].url, state: confirmed ? "CONFIRMED" : "NOT_OBSERVED",
            reason: observations.map(seen => seen.reason).join(" "),
            responseSha256: confirmed ? createHash("sha256").update(JSON.stringify(observations.map(seen => seen.responseSha256))).digest("hex") : null };
        }
        observations.set(item.id, witness);
        continue;
      }
      const facts = factReader();
      const held = facts ? (await readFactRosters(facts, [base.readerKey])).rosters[0] : undefined;
      const ocdId = /^(ocd-division\/[^#]+)#/.exec(base.readerKey)?.[1] ?? null;
      const zip = ocdId ? await input.zipForDivision(ocdId) : null;
      if (held?.members.length && zip && /^\d{5}$/.test(zip)) {
        const seen = await input.observe({ roster: held, zip });
        witness = { ...base, state: seen.confirmed ? "CONFIRMED" : "NOT_OBSERVED", reason: seen.reason, responseSha256: seen.responseSha256 };
      }
    } catch { witness = { ...witness, reason: "Published roster readback could not complete; the next publisher cycle retains the unresolved observation." }; }
    observations.set(item.id, witness);
  }
  return { checkedAt: input.now, witnesses: [...observations.values()], errors: due.length > 6 ? [`${due.length - 6} published roster receipt(s) await the next normal readback cycle.`] : [] };
}

/** Worker publication receipts for the three curated public-help families.
 * Exact accepted record IDs and the current promoted version are required;
 * old or merely staged records never acquire a served-reader witness. */
export async function collectWorkerManualReadback(input: {
  items: readonly WorkItem[]; store: Pick<RoutineDataStore, "readCandidate">; now: string;
  previous: ServedReaderReadback | null;
  zipForDivision: (division: string) => Promise<string | null>;
  observe: (input: PublishedManualRead) => Promise<Awaited<ReturnType<typeof observePublishedManual>>>;
  currentVersion?: (contractId: "everyday-routing" | "ballot-navigation") => Promise<string | null>;
}): Promise<ServedReaderReadback> {
  const contracts = new Set(["comment-access", "everyday-routing", "ballot-navigation"]);
  // Comment rules are facts: their published reading names them, with no partition version.
  const versionOf = (item: WorkItem) => item.autonomousPlan?.publication?.contractId === "comment-access"
    ? item.publicationOutcome?.workerResultId ?? null : item.publicationOutcome?.acceptedRecordIds?.length ? item.publicationOutcome.versionId ?? null : null;
  const items = input.items.filter(item => item.autonomousPlan?.publication && contracts.has(item.autonomousPlan.publication.contractId) &&
    item.publicationOutcome?.status !== "HELD" && versionOf(item));
  const prior = new Map((input.previous?.witnesses ?? []).filter(w => items.some(item => item.id === w.itemId &&
    item.publicationOutcome?.workerResultId === w.approvalId && versionOf(item) === w.versionId)).map(w => [w.itemId, w]));
  const due = items.filter(item => {
    const old = prior.get(item.id);
    const age = Date.parse(input.now) - Date.parse(old?.checkedAt ?? "");
    return !old || !Number.isFinite(age) || age < 0 || age >= (old.state === "CONFIRMED" ? SERVED_READER_MAX_AGE_MS : 15 * 60_000);
  }).sort((a, b) => (prior.get(a.id)?.checkedAt ?? "").localeCompare(prior.get(b.id)?.checkedAt ?? ""));
  for (const item of due.slice(0, 6)) {
    const outcome = item.publicationOutcome!;
    const contractId = item.autonomousPlan!.publication!.contractId as "comment-access" | "everyday-routing" | "ballot-navigation";
    const base = { itemId: item.id, approvalId: outcome.workerResultId, versionId: versionOf(item)!, readerKey: item.autonomousPlan!.publication!.bodyId,
      url: PUBLIC_SITE_ORIGIN, checkedAt: input.now, responseSha256: null };
    let witness: ServedReaderWitness = { ...base, state: "NOT_OBSERVED", reason: "Exact accepted records have no current public control readback." };
    if (contractId === "comment-access") {
      try {
        const facts = factReader();
        const [rule] = facts ? await readFactCommentAccess(facts, [base.readerKey]) : [];
        const zip = rule?.ocdId ? await input.zipForDivision(rule.ocdId) : null;
        if (!rule || !zip) throw Error("PUBLIC_DESTINATION_UNRESOLVED");
        const seen = await input.observe({ kind: "comment-access", record: rule, zip });
        witness = { ...base, state: seen.confirmed ? "CONFIRMED" : "NOT_OBSERVED", reason: seen.reason, responseSha256: seen.responseSha256 };
      } catch { witness = { ...witness, reason: "The body's live comment rules or their public destination could not be established." }; }
      prior.set(item.id, witness);
      continue;
    }
    try {
      const currentVersion = input.currentVersion ? await input.currentVersion(contractId) : await (async () => {
        const contract = requiredManualProductionContract(contractId);
        const current = await readPromotedCivicData<CuratedReaderProjection>(contract.recordClass, contract.scope);
        return current.kind === "PROMOTED" ? current.metadata.versionId : null;
      })();
      const candidate = await input.store.readCandidate(outcome.versionId!);
      const payload = candidate?.candidate.readModel as CuratedReaderProjection | undefined;
      const ids = outcome.acceptedRecordIds ?? [];
      const rows = payload?.kind === contractId ? payload.records.filter(row => ids.includes(row.id)) : [];
      if (currentVersion !== outcome.versionId ||
        !payload || rows.length !== ids.length || new Set(ids).size !== ids.length) throw Error("MANUAL_VERSION_OR_ROWS_UNRESOLVED");
      const seen: { confirmed: boolean; reason: string; responseSha256: string | null }[] = [];
      for (const row of rows) {
        let visit: PublishedManualRead | null = null;
        if (contractId === "everyday-routing") {
          const contact = row as unknown as EverydayRoutingContactRecord;
          if (contact.kind === "CONTACT" && contact.contact?.verification === "PAGE_FETCHED" && /^\d{5}$/.test(contact.zip))
            visit = { kind: "everyday-routing", record: contact, zip: contact.zip };
        } else {
          const route = row as unknown as BallotNavigationProjectionRecord;
          const state = route.value?.state;
          const zip = typeof state === "string" ? await input.zipForDivision(`ocd-division/country:us/state:${state.toLowerCase()}`) : null;
          if ((route.kind === "POLLING_PLACE_LINK" || route.kind === "REGISTRATION_LINK") && zip) visit = { kind: "ballot-navigation", record: route, zip };
        }
        if (!visit) throw Error("PUBLIC_DESTINATION_UNRESOLVED");
        seen.push(await input.observe(visit));
      }
      const confirmed = seen.length === ids.length && seen.every(row => row.confirmed);
      witness = { ...base, state: confirmed ? "CONFIRMED" : "NOT_OBSERVED", reason: seen.map(row => row.reason).join(" "),
        responseSha256: confirmed ? createHash("sha256").update(JSON.stringify(seen.map(row => row.responseSha256))).digest("hex") : null };
    } catch { witness = { ...witness, reason: `Current ${contractId} version, accepted record identity or exact public destination could not be established.` }; }
    prior.set(item.id, witness);
  }
  return { checkedAt: input.now, witnesses: [...prior.values()], errors: due.length > 6 ? [`${due.length - 6} curated publication receipt(s) await the next normal reader cycle.`] : [] };
}
