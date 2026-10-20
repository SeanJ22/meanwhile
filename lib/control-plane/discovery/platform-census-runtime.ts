import { EMPTY_SPEND } from "../spend-window.ts";
import { neon } from "@neondatabase/serverless";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { FleetSafetyController } from "../fleet-safety.ts";
import { cycleVault, VAULT_DIR } from "../scheduler/vault.ts";
import { websiteSizeFromHoldings } from "../scheduler/host-supervision.ts";
import { REGISTRATION_TARGETS } from "../../registration/publication.ts";
import { acquireProcessSingleton } from "../../civic-data/process-singleton.ts";
import { passDeadlineFromEnv } from "../../ops/independent-runtime-pass.ts";
import { CENSUS_LANE_BUDGET_MS } from "./census-lane.ts";
import type { FieldManualEntry } from "../field-manual.ts";
import type { PlatformRegistrationPage } from "./platform-registration.ts";
import type { DiscoveryRuntime } from "./meetings-discovery-executor.ts";
import { platformRequestPacer } from "./platform-request-pacing.ts";
import { runPlatformCensusPass, ownerPlatformGovernments } from "./platform-census-pass.ts";
import { readPlatformOrders, orderedPlatformGovernments } from "./platform-orders.ts";
import { heldPlatformTenants } from "./platform-enumeration.ts";
import { legistarClientCatalog, dotgovPlatformTenants, dotgovTenantForGovernment, LEGISTAR_CLIENT_CATALOG_URL } from "./platform-catalog.ts";
import { readPlatformDirectory } from "./platform-directory.ts";
import { DOTGOV_CENSUS_URL } from "./platform-census.ts";
import { heldPlatformDirectoryVersion, platformReviewer } from "./platform-reviewer.ts";
import { platformRegistrationNeed } from "./platform-registration.ts";
import { knownRecipes, RECIPE_KIND } from "../../hunt/meetings-recipes.ts";
import { readDiscoveryRouteHints, routeHintEntriesBySubject } from "./route-hints.ts";
import { platformFetch } from "../../doors/platform-http.ts";

/** The runner child admits one government or one directory page per worker and retains only their inventory cursors. */
export async function runNationalPlatformCensus() {
  const root = process.env.WTP_PROJECT_ROOT ?? process.cwd();
  const connection = controlPlaneUrlFromEnv(), readerConnection = process.env.DATABASE_URL;
  if (!connection || !readerConnection) throw new Error("The platform inventory databases are unavailable");
  const singleton = await acquireProcessSingleton("platform-census", 49_375);
  try {
  const now = () => new Date().toISOString(), deadline = Math.min(passDeadlineFromEnv(), Date.now() + CENSUS_LANE_BUDGET_MS);
  const remaining = () => Math.max(0, deadline - Date.now());
  let stopped = false;
  process.on("message", message => { if ((message as { kind?: string })?.kind === "RUNTIME_RELEASE_DRAIN") stopped = true; });
  const ended = () => stopped || remaining() <= 0;
  const repos = await createPgRepositories(connection), control = neon(connection), reader = neon(readerConnection);
  const controlQuery = (sql: string, parameters: readonly unknown[]) => control.query(sql, [...parameters]);
  const query = (sql: string, parameters: readonly unknown[]) => reader.query(sql, [...parameters]);
  const vault = cycleVault(join(root, ...VAULT_DIR)), pace = platformRequestPacer();
  const sizeReaders = new Map<PlatformRegistrationPage, ReturnType<typeof websiteSizeFromHoldings>>();
  const fleet = new FleetSafetyController({ now: now(), spend: EMPTY_SPEND, modelHold: "Plain-code national platform census", websitePacing: repos.websitePacing,
    websiteSize: url => { const values = [...new Map([...sizeReaders.values()].flatMap(read => read(url) ?? []).map(size => [JSON.stringify(size), size])).values()]; return values.length === 1 ? values[0] : null; } });
  const runtime: DiscoveryRuntime = {
    now, spaceOut: async () => {}, vault: vault.put, budget: { spent: ended, remainingMs: () => remaining() },
    open: async input => {
      if (ended()) throw new Error("Platform census reading interrupted");
      await pace(input.url);
      const got = await fleet.guardedOpenBytes("discovery-web", "platform-census", (url, init) => platformFetch(url, {
        ...init, method: input.method ?? "GET", body: input.body, redirect: "manual", signal: AbortSignal.timeout(Math.min(input.timeoutMs, remaining())),
      }), { followRedirects: false })(input);
      return { status: got.status, body: new TextDecoder().decode(got.bytes), bytes: got.bytes.byteLength, contentType: got.contentType,
        location: got.location ?? null, transportError: got.transportError };
    },
  };
    let orders = await readPlatformOrders(controlQuery);
    if (orders.paused) return;
    const catalog = await readPlatformDirectory({ name: "Legistar clients", url: LEGISTAR_CLIENT_CATALOG_URL, repos, runtime, vault,
      validate: body => { for (const _tenant of legistarClientCatalog(body)) void _tenant; } });
    const dotgov = await readPlatformDirectory({ name: "CISA government domains", url: DOTGOV_CENSUS_URL, repos, runtime, vault,
      validate: body => { for (const _tenant of dotgovPlatformTenants(body, "validation")) void _tenant; } });
    const reviewer = platformReviewer(root);
    const [leads] = await controlQuery(`SELECT max(updated_at)::text AS updated,count(*)::int AS count FROM cp_field_manual
      WHERE value->>'kind'='MEETINGS_TENANT_LEAD' AND value->>'source'<>'platform-tenant'`, []);
    const version = createHash("sha256").update(`${catalog?.version ?? "unavailable"}|${dotgov?.version ?? "unavailable"}|${heldPlatformDirectoryVersion(root)}|${JSON.stringify(leads)}|${reviewer}`).digest("hex");
    let portableMethods: Promise<readonly FieldManualEntry[]> | undefined;
    const methods = () => portableMethods ??= repos.fieldManual.select({ everywhere: true, recordClass: "meetings", kinds: [RECIPE_KIND, "PLATFORM_FINGERPRINT"] }).then(read => {
      if (read.error) throw new Error(read.error);
      return read.store.entries;
    });
    const states = REGISTRATION_TARGETS.map(target => target.state.toLowerCase());
    const report = await runPlatformCensusPass({ repos, query, states, now, stopped: ended, reviewer,
      ownerSubjects: async () => { orders = await readPlatformOrders(controlQuery); if (orders.paused) stopped = true; return orders.subjects; },
      ownerGovernments: subjects => orderedPlatformGovernments(controlQuery, query, subjects),
      tenantFor: page => dotgov ? dotgovTenantForGovernment(dotgov.body, dotgov.sourceVersion, platformRegistrationNeed(page)!) : undefined,
      retryGovernments: async function* () {
        let after = "";
        for (;;) {
          const [row] = await controlQuery(`SELECT id,value #>> '{payload,jurisdictionId}' AS subject FROM cp_field_manual
            WHERE value->>'source'='platform-government' AND value->>'kind'='PLATFORM_CENSUS_CHECK' AND id>$1
              AND value #>> '{payload,nextCheck}' <= $2
              AND value #>> '{payload,jurisdictionId}' IS NOT NULL ORDER BY id LIMIT 1`, [after, now()]);
          if (!row) return;
          after = String(row.id);
          yield* ownerPlatformGovernments(query, [String(row.subject)]);
        }
      },
      catalog: { version, runtime, tenants: async function* (after) {
        let index = 0;
        const seen = new Set<string>();
        const savedLeads = async function* () {
          let after = "";
          for (;;) {
            const [row] = await controlQuery(`SELECT id,value->>'url' AS url,value->>'title' AS name,value->'platforms'->>0 AS platform,
              value->'states'->>0 AS state,value->>'source' AS source FROM cp_field_manual WHERE id>$1
                AND value->>'kind'='MEETINGS_TENANT_LEAD' AND value->>'source'<>'platform-tenant'
                AND value->>'url' IS NOT NULL ORDER BY id LIMIT 1`, [after]);
            if (!row) return; after = String(row.id);
            const state = String(row.state ?? "").toUpperCase();
            yield { platform: String(row.platform ?? "platform"), url: String(row.url), name: String(row.name), state: /^[A-Z]{2}$/.test(state) ? state : null, source: String(row.source) };
          }
        };
        for (const source of [catalog ? legistarClientCatalog(catalog.body) : [], savedLeads(), heldPlatformTenants(root), dotgov ? dotgovPlatformTenants(dotgov.body, dotgov.sourceVersion) : []]) for await (const tenant of source) {
          const key = tenant.platform === "legistar" ? new URL(tenant.url).hostname : tenant.url;
          if (seen.has(key)) continue; seen.add(key);
          if (index++ >= after) yield tenant;
        }
      } },
      runtimeFor: async page => {
        const size = websiteSizeFromHoldings([page.government.state], root);
        sizeReaders.set(page, size);
        const need = platformRegistrationNeed(page)!;
        const [shared, local, priorAttempts] = await Promise.all([
          methods(), controlQuery(`SELECT value FROM cp_field_manual WHERE (value #>> '{payload,jurisdictionId}'=$1 OR value #>> '{payload,subjectId}'=$1)
            AND value->>'kind' IN ('SCOUT_DISCOVERY','ROUTE','GOVERNMENT_WEBSITE','NCES_WEBSITE','PLATFORM_CENSUS_DOMAIN')`, [need.jurisdictionId]),
          repos.discoveryAttempts.readRecent(need.jurisdictionId, 1),
        ]);
        const entries = [...new Map([...shared, ...local.map(row => row.value as FieldManualEntry)].map(entry => [entry.id, entry])).values()];
        const routeHints = await readDiscoveryRouteHints(repos, need, routeHintEntriesBySubject(entries));
        return { ...runtime, websiteSize: size, recipes: knownRecipes(entries), fingerprints: entries.filter(entry => entry.kind === "PLATFORM_FINGERPRINT"),
          routeHints, priorAttempts, maxRequestsPerWalk: Number.MAX_SAFE_INTEGER };
      },
      finishedGovernment: page => { sizeReaders.delete(page); },
      onGovernment: result => {
        console.log(`PLATFORM_GOVERNMENT ${JSON.stringify(result)}`);
      },
    });
    console.log(`PLATFORM_CENSUS ${JSON.stringify(report)}`);
  } finally { await singleton.release(); }
}
