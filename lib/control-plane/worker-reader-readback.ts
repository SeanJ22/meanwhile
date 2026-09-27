import { createHash } from "node:crypto";
import type { Page } from "playwright";
import type { WorkItem } from "./work-item.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import type { BodyRoster } from "../registry/body-rosters.ts";
import type { ServedReaderReadback, ServedReaderWitness } from "./served-reader.ts";
import { SERVED_READER_MAX_AGE_MS } from "./served-reader.ts";
import { PUBLIC_SITE_ORIGIN } from "../ops/origins.ts";
import { readerOfficeTitle } from "../officials/reader-office-title.ts";
import { officialFilingIssue, type OfficialFiling } from "../civic-data/official-filings.ts";
import type { CuratedReaderProjection } from "../civic-data/manual-projections.ts";

export interface PublishedRosterRead {
  readonly roster: BodyRoster;
  readonly zip: string;
}
export interface PublishedFilingsRead { readonly filings: readonly OfficialFiling[]; readonly zip: string }
export type PublishedWorkerRead = PublishedRosterRead | PublishedFilingsRead;

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
  const items = input.items.filter(item => (item.autonomousPlan?.publication?.contractId === "official-filings" ||
    item.autonomousPlan?.publication?.contractId === "registry-runtime-bindings" && item.autonomousPlan.contract.recordClass === "OFFICIAL_ROSTER") &&
    item.publicationOutcome?.status !== "HELD" && item.publicationOutcome?.versionId);
  const observations = new Map(prior.filter(w => items.some(item => item.id === w.itemId && item.publicationOutcome?.workerResultId === w.approvalId &&
    item.publicationOutcome.versionId === w.versionId)).map(w => [w.itemId, w]));
  const due = items.filter(item => {
    const prior = observations.get(item.id);
    const age = Date.parse(input.now) - Date.parse(prior?.checkedAt ?? "");
    return !prior || !Number.isFinite(age) || age < 0 || age >= (prior.state === "CONFIRMED" ? SERVED_READER_MAX_AGE_MS : 15 * 60_000);
  })
    .sort((a, b) => (observations.get(a.id)?.checkedAt ?? "").localeCompare(observations.get(b.id)?.checkedAt ?? ""));
  for (const item of due.slice(0, 6)) {
    const outcome = item.publicationOutcome!;
    const base = { itemId: item.id, approvalId: outcome.workerResultId, versionId: outcome.versionId!, readerKey: item.autonomousPlan!.publication!.bodyId,
      url: PUBLIC_SITE_ORIGIN, checkedAt: input.now, responseSha256: null };
    let witness: ServedReaderWitness = { ...base, state: "NOT_OBSERVED", reason: "Exact published roster or Census-backed public destination unavailable." };
    try {
      const candidate = await input.store.readCandidate(outcome.versionId!);
      if (item.autonomousPlan?.publication?.contractId === "official-filings") {
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
      const payload = candidate?.candidate.readModel as RegistryRuntimeReadModel | undefined;
      const body = payload?.registry.bodies.find(body => body.id === base.readerKey);
      const roster = payload?.bodyRosters.find(row => row.bodyId === base.readerKey);
      const zip = body?.ocdId ? await input.zipForDivision(body.ocdId) : null;
      if (roster?.members.length && zip && /^\d{5}$/.test(zip)) {
        const seen = await input.observe({ roster, zip });
        witness = { ...base, state: seen.confirmed ? "CONFIRMED" : "NOT_OBSERVED", reason: seen.reason, responseSha256: seen.responseSha256 };
      }
    } catch { witness = { ...witness, reason: "Published roster readback could not complete; the next publisher cycle retains the unresolved observation." }; }
    observations.set(item.id, witness);
  }
  return { checkedAt: input.now, witnesses: [...observations.values()], errors: due.length > 6 ? [`${due.length - 6} published roster receipt(s) await the next normal readback cycle.`] : [] };
}
