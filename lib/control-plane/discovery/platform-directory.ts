import { createHash } from "node:crypto";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { CycleVault } from "../scheduler/vault.ts";
import { DEFAULT_USER_AGENT } from "../scheduler/route-executor.ts";
import { recordAcquisition } from "../evidence/artifact.ts";
import { fieldManualEntryId, newFieldManualEntry, writeFieldManual } from "../field-manual.ts";
import { assertPublicUrl } from "../../hunt/egress.ts";
import type { DiscoveryRuntime } from "./meetings-discovery-executor.ts";

interface Directory { body: string; version: string; sourceVersion: string }

/** A public directory is retained once in the shared vault. A failed refresh keeps its last readable copy. */
export async function readPlatformDirectory(input: {
  name: string; url: string; repos: Pick<ControlPlaneRepositories, "fieldManual">;
  runtime: DiscoveryRuntime; vault: CycleVault; validate: (body: string) => void;
}): Promise<Directory | null> {
  const id = fieldManualEntryId("platform-directory", input.name);
  const row = await input.repos.fieldManual.readNarrowed(id, { payload: ["key", "version", "sourceVersion", "nextCheck"] });
  const previous = (row?.value as { payload?: { key?: string; version?: string; sourceVersion?: string; nextCheck?: string } } | undefined)?.payload;
  const held = async (): Promise<Directory | null> => {
    if (!previous?.key || !previous.version || !previous.sourceVersion) return null;
    const body = await input.vault.readBack(previous.key);
    return body === null ? null : { body, version: previous.version, sourceVersion: previous.sourceVersion };
  };
  if (Date.parse(previous?.nextCheck ?? "") > Date.parse(input.runtime.now())) {
    const cached = await held(); if (cached) return cached;
  }
  try {
    let url = input.url;
    let response: Awaited<ReturnType<DiscoveryRuntime["open"]>> | null = null;
    for (let hop = 0; hop <= 6; hop++) {
      if (input.runtime.budget.spent()) return held();
      assertPublicUrl(url); await input.runtime.spaceOut(new URL(url).hostname);
      response = await input.runtime.open({ url, headers: { "user-agent": DEFAULT_USER_AGENT, accept: "text/csv" }, timeoutMs: 20_000 });
      if (!response.status || response.status < 300 || response.status >= 400 || !response.location) break;
      url = new URL(response.location, url).href;
    }
    if (response?.status !== 200 || response.transportError) throw new Error(`The ${input.name} directory could not be read: ${response?.status ?? response?.transportError}`);
    input.validate(response.body);
    const at = response.retrievedAt ?? input.runtime.now();
    const acquired = recordAcquisition({ canonicalUrl: url, retrievedAt: at, httpStatus: 200, contentType: response.contentType,
      sourceId: "platform-directory", workItemId: input.name, attemptId: `platform-directory:${input.name}:${at}`,
      methodRouteId: "public-customer-directory", permission: "ALLOWED", transport: "REACHABLE" }, response.body);
    const saved = await input.vault.put(acquired.artifact, response.body);
    if (!saved.stored) throw new Error(saved.why);
    const version = createHash("sha256").update(response.body).digest("hex");
    const result = await writeFieldManual(input.repos, [newFieldManualEntry("platform-directory", input.name, {
      role: "SHARED", kind: "PLATFORM_CENSUS_DOMAIN", title: input.name, url: input.url, observedAt: at, outcome: "REFERENCE",
      summary: "Public platform and government directory retained for one-entry-at-a-time matching.", payload: { key: saved.where, version,
        sourceVersion: acquired.artifact.id, nextCheck: new Date(Date.parse(input.runtime.now()) + 12 * 3_600_000).toISOString() },
    })], input.runtime.now());
    if (result.error) throw new Error(result.error);
    return { body: response.body, version, sourceVersion: acquired.artifact.id };
  } catch (error) {
    const saved = await writeFieldManual(input.repos, [newFieldManualEntry("platform-directory-failure", input.name, {
      role: "SHARED", kind: "PLATFORM_CENSUS_RUN", title: input.name, url: input.url, observedAt: input.runtime.now(), outcome: "FAILED",
      summary: error instanceof Error ? error.message : String(error), payload: { lastKnownVersion: previous?.version ?? null },
    })], input.runtime.now());
    if (saved.error) throw new Error(saved.error);
    return held();
  }
}
