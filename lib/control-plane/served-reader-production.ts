import { readDerivedCampaignSites } from "../civic-data/derived-campaign-sites.ts";
import { lowestZipForDivision, lowestZipsForDivisions } from "../place-map/reader.ts";
import { canonicalContestId, canonicalCandidacyId } from "../hunt/candidate-universe.ts";
import { readGenericBallotProjection } from "../ballot/generic-projection.ts";
import { collectServedReader } from "./served-reader-collector.ts";
import type { ServedReaderReadback } from "./served-reader.ts";
import { observeCampaignControls } from "./campaign-reader-controls.ts";
import { launchGuarded } from "../../scripts/browser.mts";
import type { Site } from "../../scripts/site.mts";
import { PUBLIC_SITE_ORIGIN } from "../ops/origins.ts";
import { PostgresRoutineDataStore } from "../civic-data/store.ts";
import type { WorkItem } from "./work-item.ts";
import { collectWorkerRosterReadback, collectWorkerManualReadback, observePublishedRoster, observePublishedFilings, observePublishedManual } from "./worker-reader-readback.ts";

/** Where one page visit goes: the runner's copy of this release, or the live site while the day's allowance lasts. Neither: the visit does not happen. */
async function visitOrigin(site: Site, runId: string): Promise<string> {
  const visit = await site.next({ runId, writes: false });
  if (!visit) throw new Error("no runner copy of this release and the live allowance is spent");
  return visit.origin;
}

export async function collectPublishedCampaignReadback(state: string, now: string, site: Site): Promise<ServedReaderReadback> {
  const derived = await readDerivedCampaignSites(state);
  if (derived.kind !== "PROMOTED") return { checkedAt: now, witnesses: [],
    errors: derived.kind === "NOT_RECORDED" ? [] : [`${state} campaign publication readback unavailable: ${derived.kind}.`] };
  if (!derived.value.records.length) return { checkedAt: now, witnesses: [], errors: [] };
  // Use the same canonical identity functions as the workers, from proven ballot values.
  // Do not import the scheduler/Reader UI closure into this plain-Node collector.
  const subjects = new Map<string, { stateCode: string; ocdId: string }>();
  const result = await readGenericBallotProjection(state);
  if (result.kind === "PROMOTED") for (const authority of Object.values(result.value.ballots)) {
    const stateCode = authority.election.state;
    const cycle = Number(authority.election.date.slice(0, 4));
    if (!stateCode || !Number.isInteger(cycle)) continue;
    for (const ballot of [authority, { contests: authority.contests, candidacies: authority.filingCandidacies ?? [] }]) {
      if (!Array.isArray(ballot?.contests) || !Array.isArray(ballot?.candidacies)) continue;
      const contests = new Map(ballot.contests.map(c => [c.id, c]));
      for (const c of ballot.candidacies) {
        const contest = contests.get(c.contestId);
        if (contest) subjects.set(canonicalCandidacyId(canonicalContestId(stateCode, cycle, contest), c.familyName, c.givenName), { stateCode, ocdId: contest.ocdId });
      }
    }
  }
  const destinations = new Map<string, string>();
  const lowest = await lowestZipsForDivisions(state,[...new Set(derived.value.records.flatMap(record=>subjects.get(record.candidacyId)?.ocdId??[]))],{stateFallback:true});
  for (const record of derived.value.records) {
    const subject = subjects.get(record.candidacyId);
    if (!subject) continue;
    const zip = lowest.get(subject.ocdId);
    if (zip) destinations.set(record.candidacyId, `${PUBLIC_SITE_ORIGIN}/ballot?zip=${zip}`);
  }
  // Campaign links deliberately live behind Battlecard → Sources. Serialized RSC props are not a public witness.
  // This existing-runner browser is isolated from the owner's signed-in session and never submits Ask or Send.
  const browserEnv = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined &&
    /^(path|systemroot|windir|temp|tmp|userprofile|localappdata|appdata|home|playwright_browsers_path)$/i.test(key))) as Record<string, string>;
  const browser = await launchGuarded({ label: "publication-readback", headless: true, env: browserEnv });
  const deadline = setTimeout(() => { void browser.close().catch(() => undefined); }, 75_000);
  try {
    const report = await collectServedReader({ records: derived.value.records, versionId: derived.projection.versionId, destinations, now,
      read: async url => {
        const page = await browser.page();
        page.setDefaultTimeout(3000);
        try {
          const response = await page.goto(url.replace(PUBLIC_SITE_ORIGIN, await visitOrigin(site, browser.runId)), { waitUntil: "domcontentloaded", timeout: 15_000 });
          const { openedLinks, failures } = await observeCampaignControls(page, derived.value.records.filter(r => destinations.get(r.candidacyId) === url));
          return { status: response?.status() ?? 0, html: await page.content(), openedLinks, failures };
        } finally { await page.close(); }
      } });
    return { ...report, syntheticRunId: browser.runId };
  } finally { clearTimeout(deadline); await browser.close(); }
}

/** Same scheduler/publisher, public controls and isolated browser as campaign
 * readbacks. No browser starts unless a worker receipt actually needs a visit. */
export async function collectPublishedWorkerReadback(items: readonly WorkItem[], now: string, previous: ServedReaderReadback | null, site: Site): Promise<ServedReaderReadback> {
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const destinations = new Map<string,Promise<string|null>>();
  try {
    const result = await collectWorkerRosterReadback({ items, now, previous, store: new PostgresRoutineDataStore(),
      zipForDivision: async division => {
        const state = /\/state:([a-z]{2})(?:\/|$)/.exec(division)?.[1]?.toUpperCase();
        if (!state) return null;
        if (!destinations.has(division)) destinations.set(division,lowestZipForDivision(state,division));
        return destinations.get(division)!;
      },
      observe: async input => {
        if (!browser) {
          const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined &&
            /^(path|systemroot|windir|temp|tmp|userprofile|localappdata|appdata|home|playwright_browsers_path)$/i.test(key))) as Record<string, string>;
          browser = await launchGuarded({ label: "worker-publication-readback", headless: true, env });
          deadline = setTimeout(() => { void browser?.close().catch(() => undefined); }, 75_000);
        }
        const context = await browser.context({ viewport: { width: 1280, height: 900 } });
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(3000);
          const origin = await visitOrigin(site, browser.runId);
          return await ("filings" in input ? observePublishedFilings(page, input, origin) : observePublishedRoster(page, input, origin));
        } finally { await context.close(); }
      } });
    return { ...result, ...(browser ? { syntheticRunId: (browser as Awaited<ReturnType<typeof launchGuarded>>).runId } : {}) };
  } finally { if (deadline) clearTimeout(deadline); if (browser) await (browser as Awaited<ReturnType<typeof launchGuarded>>).close(); }
}

/** Same receipt identity as the worker publisher, with only exact accepted
 * manual records visited. The isolated browser blocks Ask server requests. */
export async function collectPublishedManualReaderReadback(items: readonly WorkItem[], now: string, previous: ServedReaderReadback | null, site: Site): Promise<ServedReaderReadback> {
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const destinations = new Map<string,Promise<string|null>>();
  try {
    const result = await collectWorkerManualReadback({ items, now, previous, store: new PostgresRoutineDataStore(),
      zipForDivision: async division => {
        const state = /\/state:([a-z]{2})(?:\/|$)/.exec(division)?.[1]?.toUpperCase();
        if (!state) return null;
        if (!destinations.has(division)) destinations.set(division,lowestZipForDivision(state,division,{stateFallback:true}));
        return destinations.get(division)!;
      },
      observe: async visit => {
        if (!browser) {
          const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined &&
            /^(path|systemroot|windir|temp|tmp|userprofile|localappdata|appdata|home|playwright_browsers_path)$/i.test(key))) as Record<string, string>;
          browser = await launchGuarded({ label: "manual-publication-readback", headless: true, env });
          deadline = setTimeout(() => { void browser?.close().catch(() => undefined); }, 75_000);
        }
        const context = await browser.context({ viewport: { width: 1280, height: 900 } });
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(3000);
          return await observePublishedManual(page, visit, await visitOrigin(site, browser.runId));
        } finally { await context.close(); }
      } });
    return { ...result, ...(browser ? { syntheticRunId: (browser as Awaited<ReturnType<typeof launchGuarded>>).runId } : {}) };
  } finally { if (deadline) clearTimeout(deadline); if (browser) await (browser as Awaited<ReturnType<typeof launchGuarded>>).close(); }
}
