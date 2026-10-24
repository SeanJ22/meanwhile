import type { ControlPlaneRepositories } from "../repository/types.ts";
import { fieldManualEntryId, newFieldManualEntry, writeFieldManual } from "../field-manual.ts";
import type { DiscoveryRuntime } from "./meetings-discovery-executor.ts";
import { platformRegistrationBinding, platformRegistrationNeed, readPlatformRegistrationPage, type PlatformQuery, type PlatformRegistrationPage } from "./platform-registration.ts";
import { readPlatformGovernment } from "./platform-government.ts";
import { registeredPlatformTenant } from "./platform-catalog.ts";
import type { PlatformTenant } from "./platform-enumeration.ts";
import { governmentStateOf } from "../../registration/listings.ts";

type Repos = Pick<ControlPlaneRepositories, "doors" | "fieldManual" | "discoveryAttempts">;

/** Owner-assigned subjects are exact native identities, aliases, bodies or source-code places, never a list chosen by this lane. */
export async function* ownerPlatformGovernments(query: PlatformQuery, subjects: readonly string[]) {
  for (const subject of subjects) {
    let after = "";
    for (;;) {
    const rows = await query(`SELECT g AS government,p.current_version_id AS "versionId",p.promoted_at AS "promotedAt",c.normalized_hash AS "readModelHash"
      FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id,
        LATERAL jsonb_array_elements(p.payload->'governments') g
      WHERE p.record_class='REGISTRATION' AND ($3::text IS NULL OR p.scope='US-'||$3||':registration:v1')
        AND g->>'id'>$2 AND (g->>'id'=split_part($1,'#',1) OR g->>'jurisdictionId'=$1 OR g->'aliases' ? $1 OR g->'bodyIds' ? $1
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(g->'associations') a WHERE a->>'divisionId'=split_part($1,'#',1)
          OR a->>'divisionId' LIKE split_part($1,'#',1)||'/%'))
      ORDER BY g->>'id' LIMIT 1`, [subject, after, governmentStateOf(subject)?.toUpperCase() ?? null]);
      if (!rows.length) break;
      const page = rows[0] as unknown as PlatformRegistrationPage;
      after = page.government.id;
      yield page;
    }
  }
}

/** A slice resumes each state's inventory position. Background states take turns, so a restart cannot strand the tail of the country. */
export async function runPlatformCensusPass(input: {
  repos: Repos;
  query: PlatformQuery;
  states: readonly string[];
  ownerSubjects: () => Promise<readonly string[]>;
  ownerGovernments?: (subjects: readonly string[]) => AsyncGenerator<PlatformRegistrationPage>;
  retryGovernments?: () => AsyncGenerator<PlatformRegistrationPage>;
  runtimeFor: (page: PlatformRegistrationPage) => DiscoveryRuntime | Promise<DiscoveryRuntime>;
  tenantFor?: (page: PlatformRegistrationPage) => PlatformTenant | undefined;
  finishedGovernment?: (page: PlatformRegistrationPage) => void;
  catalog?: { version: string; tenants: (after: number) => AsyncGenerator<PlatformTenant>; runtime: DiscoveryRuntime };
  stopped: () => boolean;
  now: () => string;
  reviewer: string;
  concurrency?: number;
  onGovernment?: (report: { government: string; state: string; doors: number; requests: number; held: number }) => void;
}) {
  let failed = false;
  const checked = new Set<string>();
  const run = async (page: PlatformRegistrationPage, tenant?: PlatformTenant) => {
    const need = platformRegistrationNeed(page);
    const key = `${need?.jurisdictionId}|${tenant?.url ?? "website"}`;
    if (!need || checked.has(key)) return true;
    checked.add(key);
    const marker = await input.repos.fieldManual.readNarrowed(fieldManualEntryId("platform-government", need.jurisdictionId), { payload: ["nextCheck", "registrationVersion", "reviewer", "checkedCalendars"] });
    const previous = marker?.value as { payload?: { nextCheck?: string; registrationVersion?: string; reviewer?: string; checkedCalendars?: Record<string, string> } } | undefined;
    if (!tenant && previous?.payload?.reviewer === input.reviewer && previous.payload.registrationVersion === page.versionId && Date.parse(previous.payload.nextCheck ?? "") > Date.parse(input.now())) return true;
    let runtime: DiscoveryRuntime | undefined;
    try {
      runtime = await input.runtimeFor(page);
      const got = await readPlatformGovernment({ need, registered: platformRegistrationBinding(page), repos: input.repos,
        runtime, query:input.query, reviewer: input.reviewer, tenant: tenant ?? input.tenantFor?.(page),
        checkedCalendars: previous?.payload?.reviewer === input.reviewer && previous.payload.registrationVersion === page.versionId ? previous.payload.checkedCalendars : undefined });
      input.onGovernment?.({ government: need.jurisdictionId, state: need.stateCode, doors: got.doors.length, requests: got.attempt.requestCount, held: got.review.held.length });
      return !runtime.budget.spent();
    } catch (error) {
      if (input.stopped() || runtime?.budget.spent()) return false;
      const saved = await writeFieldManual(input.repos, [newFieldManualEntry("platform-government", need.jurisdictionId, {
        role: "SHARED", kind: "PLATFORM_CENSUS_CHECK", title: need.name, states: [need.stateCode.toLowerCase()], observedAt: input.now(), outcome: "FAILED",
        summary: error instanceof Error ? error.message : String(error), payload: { jurisdictionId: need.jurisdictionId, reviewer: input.reviewer, registrationVersion: page.versionId,
          nextCheck: new Date(Date.parse(input.now()) + 12 * 3_600_000).toISOString() },
      })], input.now());
      if (saved.error) throw new Error(saved.error);
      return true;
    } finally { input.finishedGovernment?.(page); }
  };
  const catalogRow = input.catalog && await input.repos.fieldManual.readNarrowed(fieldManualEntryId("platform-catalog-position", "national"), { payload: ["index", "version", "nextCheck"] });
  const catalogSaved = catalogRow?.value as { payload?: { index?: number; version?: string; nextCheck?: string } } | undefined;
  let catalogIndex = catalogSaved?.payload?.version === input.catalog?.version ? catalogSaved?.payload?.index ?? 0 : 0;
  let catalogComplete = catalogSaved?.payload?.version === input.catalog?.version && Date.parse(catalogSaved?.payload?.nextCheck ?? "") > Date.parse(input.now());
  const tenants = input.catalog?.tenants(catalogIndex);
  let catalogNextIndex = catalogIndex, catalogEndIndex = Number.POSITIVE_INFINITY, backgroundAdmissions = 0;
  const completedCatalog = new Set<number>();
  let catalogSaves = Promise.resolve();
  const finishCatalog = (position: number, end: boolean) => {
    catalogSaves = catalogSaves.then(async () => {
      if (end) catalogEndIndex = Math.min(catalogEndIndex, position);
      else completedCatalog.add(position);
      while (completedCatalog.delete(catalogIndex)) catalogIndex++;
      catalogComplete = catalogIndex >= catalogEndIndex;
      const saved = await writeFieldManual(input.repos, [newFieldManualEntry("platform-catalog-position", "national", {
        role: "SHARED", kind: "PLATFORM_CENSUS_RUN", title: "National platform directories", outcome: "REFERENCE", observedAt: input.now(),
        summary: catalogComplete ? "Directory pass completed; unresolved publishers remain open work." : `${catalogIndex} directory entries checked.`,
        payload: { index: catalogComplete ? 0 : catalogIndex, version: input.catalog!.version,
          nextCheck: catalogComplete ? new Date(Date.parse(input.now()) + 12 * 3_600_000).toISOString() : null },
      })], input.now());
      if (saved.error) throw new Error(saved.error);
    });
    return catalogSaves;
  };
  const catalogWork = async () => {
    if (!input.catalog || !tenants) return;
    const position = catalogNextIndex++;
    const next = await tenants.next();
    if (next.done) { await finishCatalog(position, true); return; }
    else {
      const tenant = next.value;
      const marker = await input.repos.fieldManual.readNarrowed(fieldManualEntryId("platform-tenant", tenant.url), { payload: ["nextCheck", "version"] });
      const previous = marker?.value as { payload?: { nextCheck?: string; version?: string } } | undefined;
      if (!(previous?.payload?.version === input.catalog.version && Date.parse(previous?.payload?.nextCheck ?? "") > Date.parse(input.now()))) {
        let summary: string, outcome: "YIELDED" | "BLOCKED" | "FAILED";
        try {
          const matches = await registeredPlatformTenant(input.query, tenant, input.catalog.runtime);
          if (matches.length === 1) { if (!await run(matches[0], tenant)) return; summary = `Matched ${matches[0].government.name} to its registered government; its calendar was checked.`; outcome = "YIELDED"; }
          else { summary = matches.length ? "The publisher matches several registered governments; the connection remains open work." : "The publisher's registered government has not been resolved; the connection remains open work."; outcome = "BLOCKED"; }
        } catch (error) { if (input.stopped()) return; summary = error instanceof Error ? error.message : String(error); outcome = "FAILED"; }
        if (input.stopped()) return;
        const saved = await writeFieldManual(input.repos, [newFieldManualEntry("platform-tenant", tenant.url, {
          role: "SHARED", kind: "MEETINGS_TENANT_LEAD", title: tenant.name ?? new URL(tenant.url).hostname, url: tenant.url,
          states: tenant.state ? [tenant.state.toLowerCase()] : [], platforms: [tenant.platform], recordClasses: ["meetings"],
          observedAt: input.now(), outcome, summary, payload: { source: tenant.source, version: input.catalog.version, nextCheck: new Date(Date.parse(input.now()) + 12 * 3_600_000).toISOString() },
        })], input.now());
        if (saved.error) throw new Error(saved.error);
      }
      await finishCatalog(position, false);
    }
  };
  let ownerSignature = "", ownerSequence: AsyncGenerator<PlatformRegistrationPage> | null = null;
  const nextOwner = async () => {
    const subjects = await input.ownerSubjects();
    const signature = JSON.stringify(subjects);
    if (signature !== ownerSignature) { ownerSignature = signature; ownerSequence = input.ownerGovernments?.(subjects) ?? ownerPlatformGovernments(input.query, subjects); }
    if (!ownerSequence) return null;
    const next = await ownerSequence.next();
    return next.done ? null : next.value;
  };
  const cursors = new Map<string, { index: number; versionId: string | null; complete: boolean; busy: boolean }>();
  for (const state of input.states) {
    const row = await input.repos.fieldManual.readNarrowed(fieldManualEntryId("platform-census-position", state.toLowerCase()), { payload: ["index", "versionId", "nextCheck"] });
    const value = row?.value as { payload?: { index?: number; versionId?: string; nextCheck?: string } } | undefined;
    cursors.set(state, { index: value?.payload?.index ?? 0, versionId: value?.payload?.versionId ?? null,
      busy: false, complete: Date.parse(value?.payload?.nextCheck ?? "") > Date.parse(input.now()) });
  }
  let statePosition = 0;
  let admissions = 0, retriesComplete = !input.retryGovernments;
  const retries = input.retryGovernments?.();
  const nextRetry = async () => {
    if (!retries || retriesComplete) return null;
    const next = await retries.next();
    if (next.done) retriesComplete = true;
    return next.done ? null : next.value;
  };
  const work = async () => {
    while (!input.stopped() && !failed) {
      const owner = await nextOwner();
      if (input.stopped()) return;
      if (owner) { await run(owner); continue; }
      if (admissions++ % 5 === 0) { const retry = await nextRetry(); if (retry) { await run(retry); continue; } }
      if (tenants && !catalogComplete && catalogNextIndex < catalogEndIndex && (backgroundAdmissions++ % 5 !== 4 || [...cursors.values()].every(cursor => cursor.complete || cursor.busy))) {
        await catalogWork();
        continue;
      }
      let state: string | undefined;
      for (let n = 0; n < input.states.length; n++) {
        const candidate = input.states[statePosition++ % input.states.length];
        const cursor = cursors.get(candidate)!;
        if (!cursor.complete && !cursor.busy) { state = candidate; cursor.busy = true; break; }
      }
      if (input.stopped()) return;
      if (!state) { const retry = await nextRetry(); if (retry) { await run(retry); continue; } return; }
      const cursor = cursors.get(state)!;
      try {
      let page = await readPlatformRegistrationPage(input.query, state, cursor.index);
      if (cursor.versionId && ((!page && cursor.index > 0) || (page && cursor.versionId !== page.versionId))) {
        const first = await readPlatformRegistrationPage(input.query, state, 0);
        if (first && first.versionId !== cursor.versionId) {
        cursor.index = 0;
        page = first;
        }
      }
      let nextCheck: string | null = null;
      if (!page) {
        cursor.index = 0;
        cursor.complete = true;
        nextCheck = new Date(Date.parse(input.now()) + 12 * 3_600_000).toISOString();
      } else {
        if (!await run(page)) return;
        cursor.index++;
        cursor.versionId = page.versionId;
      }
      const saved = await writeFieldManual(input.repos, [newFieldManualEntry("platform-census-position", state.toLowerCase(), {
        role: "SHARED", kind: "PLATFORM_CENSUS_RUN", title: `${state.toUpperCase()} meeting platforms`, states: [state.toLowerCase()],
        observedAt: input.now(), outcome: "REFERENCE", summary: cursor.complete ? "Inventory pass completed; source doors keep their own refresh schedules." : `${cursor.index} government positions checked.`,
        payload: { index: cursor.index, versionId: cursor.versionId, nextCheck },
      })], input.now());
      if (saved.error) throw new Error(saved.error);
      } finally { cursor.busy = false; }
    }
  };
  const completed = await Promise.allSettled(Array.from({ length: input.concurrency ?? 4 }, () => work().catch(error => { failed = true; throw error; })));
  const failure = completed.find(result => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return { governmentsChecked: checked.size };
}
