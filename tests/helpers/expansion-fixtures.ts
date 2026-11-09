/**
 * The fixtures the expansion end-to-end tests share (`tests/auto-crosswalk-expansion.test.ts`,
 * `tests/expansion-any-state.test.ts`): a calendar's bytes, a wall-clock start, and the reviewed registry's ids
 * that registration derives against.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { manualProjectionCandidate, type ManualProjectionPackage } from "../../lib/civic-data/manual-projections.ts";
import { processRegisteredManualCandidate } from "../../lib/civic-data/promotion.ts";
import type { MemoryRoutineDataStore } from "../../lib/civic-data/store.ts";
import type { HeldBytes } from "../../lib/control-plane/discovery/auto-crosswalk.ts";
import type { DiscoveryRuntime } from "../../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { curatedReaderSourceClass } from "./curated-reader-source-class.ts";
import { recordedDiscoveryOpen, type RecordedReply } from "./recorded-discovery-open.ts";

const HOUR = 3_600_000;

/** `DTSTART;TZID=America/New_York` a whole number of days after `base` (ms), at a wall-clock hour. */
export function localStart(base: number, days: number, hour: number): string {
  const d = new Date(base + days * 24 * HOUR);
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `${ymd}T${String(hour).padStart(2, "0")}0000`;
}

/** An iCal feed in America/New_York with these events. */
export function ics(events: readonly { uid: string; summary: string; start: string }[]): string {
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-TIMEZONE:America/New_York",
    ...events.flatMap((e) => ["BEGIN:VEVENT", `UID:${e.uid}`, `SUMMARY:${e.summary}`, `DTSTART;TZID=America/New_York:${e.start}`, "END:VEVENT"]),
    "END:VCALENDAR", "",
  ].join("\r\n");
}

/** The reviewed registry's ids, from its committed first seed, as registration derives against them. */
export function reviewedIds(root: string) {
  const registry = JSON.parse(readFileSync(join(root, "lib", "registry", "registry.json"), "utf8")) as { divisions: { ocdId: string }[]; bodies: { id: string; ocdId: string | null }[] };
  return {
    versionId: "cv-reviewed-first-seed",
    divisionIds: new Set(registry.divisions.map((d) => d.ocdId)),
    bodyIds: new Set(registry.bodies.map((b) => b.id)),
    bodyDivisionIds: new Set(registry.bodies.map((b) => b.ocdId).filter((id): id is string => typeof id === "string")),
  };
}

/** A promoted venue-resolutions version: every adapter reading resolves through it (lib/control-plane/discovery/derived-wiring-reading.ts). */
export async function promoteVenues(store: MemoryRoutineDataStore, at: string, address: string, record: Record<string, unknown>): Promise<void> {
  const urls = ["https://public.example.gov/venue", `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${address}&benchmark=Public_AR_Current&format=json`];
  const pkg: ManualProjectionPackage = {
    contractId: "venue-resolutions",
    version: at,
    sourceThrough: at,
    sourceReceipt: {
      contractVersion: 1, reviewedAt: at, reviewedBy: "a reviewing agent session (test)",
      sources: urls.map((url, index) => ({
        requestedUrl: url, finalUrl: url, publisher: "Exact named primary publisher", sourceClass: curatedReaderSourceClass("venue-resolutions"),
        retrievedAt: at, httpStatus: 200, rawHash: String.fromCharCode(97 + index).repeat(64),
        reviewedEvidence: "The exact response bytes and normalized record were reviewed together.",
      })),
    },
    payload: {
      kind: "venue-resolutions",
      records: [{ ...record, sourceId: "test-source", addressSourceUrl: urls[0], coordinateSourceUrl: urls[1], verifiedAt: at } as never],
    },
  };
  const outcome = await processRegisteredManualCandidate(store, "venue-resolutions", manualProjectionCandidate(pkg), at);
  assert.equal(outcome.candidate.state, "PROMOTED", outcome.candidate.failureDetail ?? "");
}

/** A free-walk runtime that replays recorded replies and keeps every vaulted body in the returned map, one second apart from `walkAt`. */
export function vaultingWalkRuntime(site: Record<string, RecordedReply>, walkAt: string): { vault: Map<string, HeldBytes>; runtime: DiscoveryRuntime } {
  const vault = new Map<string, HeldBytes>();
  let tick = 0;
  return {
    vault,
    runtime: {
      open: recordedDiscoveryOpen(site),
      spaceOut: async () => {},
      vault: async (artifact, body) => {
        vault.set(artifact.id, {
          text: body, sha256: artifact.contentHash.slice("sha256-".length),
          evidence: { kind: "VAULTED_EVIDENCE", artifactId: artifact.id, contentHash: artifact.contentHash, tier: artifact.tier === "SANITIZED_DERIVED" ? "SANITIZED_DERIVED" : "RAW", retrievedAt: artifact.retrievedAt },
        });
        return { stored: true, where: `vault/${artifact.id}`, why: "stored" };
      },
      now: () => new Date(Date.parse(walkAt) + (tick++) * 1000).toISOString(),
      budget: { spent: () => false },
    },
  };
}
