#!/usr/bin/env tsx

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  fieldManualEntryId,
  writeFieldManual,
  type FieldManualEntry,
  type FieldManualOutcome,
} from "../lib/control-plane/field-manual.ts";
import { platformFingerprintEntries } from "../lib/control-plane/platform-fingerprints.ts";
import { COVERAGE_AUDITS } from "../lib/registry/coverage-audit.ts";
import { LEGISTAR_CLIENTS } from "../lib/sources/legistar/client-registry.ts";
import { INSITE_TENANTS } from "../lib/sources/legistar-insite/tenant-registry.ts";
import { ROUTINE_STATES, routineScopeState } from "../lib/civic-data/state-scope.ts";
import { ensureMeetingDoors } from "../lib/doors/meeting-doors.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
const target = ([...args].find((a) => a.startsWith("--target="))?.slice("--target=".length) ?? "file") as
  | "control-plane"
  | "file"
  | "memory";
const dry = args.has("--dry");

/* ------------------------------------------------------------ extractors --- */

const STATE_RE = /(?:^|[:/\-])state:?([a-z]{2})(?:[:/\-]|$)/i;
function stateOf(...values: (string | null | undefined)[]): string[] {
  const found = new Set<string>();
  for (const v of values) {
    if (!v) continue;
    const m = STATE_RE.exec(v);
    if (m) found.add(m[1]!.toLowerCase());
    // A jurisdiction key like "us-nj" or a plain "nj" leading token.
    const m2 = /\b(az|nh|nj)\b/i.exec(v);
    if (m2) found.add(m2[1]!.toLowerCase());
  }
  return [...found];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function bestOutcome(outcomes: readonly { readonly outcome?: unknown }[] | undefined): FieldManualOutcome {
  if (!outcomes || outcomes.length === 0) return "REFERENCE";
  const set = new Set(outcomes.map((o) => String(o.outcome)));
  if (set.has("YIELDED")) return "YIELDED";
  if (set.has("BLOCKED")) return "BLOCKED";
  if (set.has("FAILED")) return "FAILED";
  if (set.has("ZERO")) return "ZERO";
  return "REFERENCE";
}

function latestDate(...values: (string | null | undefined)[]): string | null {
  const dates = values.filter((v): v is string => typeof v === "string" && /\d{4}-\d{2}-\d{2}/.test(v));
  return dates.length === 0 ? null : dates.sort().at(-1)!;
}

/* ------------------------------------------------------------- importers --- */

const perSource = new Map<string, number>();
function collect(source: string, entries: FieldManualEntry[]): FieldManualEntry[] {
  perSource.set(source, (perSource.get(source) ?? 0) + entries.length);
  return entries;
}

function fromPlatforms(): FieldManualEntry[] {
  return platformFingerprintEntries();
}

function fromCoverageAudits(): FieldManualEntry[] {
  const src = "lib/registry/coverage-audit.ts";
  const entries: FieldManualEntry[] = [];
  for (const audit of COVERAGE_AUDITS) {
    for (const rung of audit.rungs) {
      const hit = rung.outcome === "HIT";
      entries.push({
        id: fieldManualEntryId(src, `${audit.bodyId}:${rung.rung}:${rung.url ?? ""}`),
        role: "SCOUT",
        kind: "BODY_RUNG",
        title: `${rung.rung} on ${audit.bodyId}`,
        summary: `${rung.outcome}${rung.note ? ` — ${rung.note}` : ""}`,
        states: stateOf(audit.bodyId),
        recordClasses: ["meetings"],
        platforms: [],
        outcome: hit ? "YIELDED" : "ZERO",
        url: rung.url ?? null,
        source: src,
        observedAt: latestDate(audit.attemptedAt),
        tier: null,
        payload: { bodyId: audit.bodyId, rung },
      });
    }
  }
  return collect(src, entries);
}

async function fromMethodCandidates(repos: ControlPlaneRepositories): Promise<FieldManualEntry[]> {
  const src = "cp_method_candidates";
  const current = await repos.methodCandidates.read("live");
  if (!current) return collect(src, []);
  const candidates = (current.value as unknown as { candidates?: { proposal?: Record<string, unknown>; lifecycle?: string; submittedAt?: string }[] }).candidates ?? [];
  const entries: FieldManualEntry[] = [];
  for (const c of candidates) {
    // A rejected proposal is still learned knowledge (a door that did not open); keep it as a dead door.
    const p = c.proposal ?? {};
    const outcomeRec = (p.outcome ?? {}) as { jurisdiction?: unknown; outcome?: unknown; note?: unknown };
    const lifecycle = String(c.lifecycle ?? "PROPOSED");
    entries.push({
      id: fieldManualEntryId(src, String(p.id ?? "")),
      role: "SCOUT",
      kind: "SCOUT_CANDIDATE",
      title: String(p.title ?? p.id ?? "scout candidate"),
      summary: `${lifecycle}; ${String(p.note ?? "")}`.slice(0, 300),
      states: stateOf(String(outcomeRec.jurisdiction ?? "")),
      recordClasses: strings(p.fields),
      platforms: [],
      outcome: lifecycle === "REJECTED" ? "FAILED" : bestOutcome([outcomeRec]),
      url: null,
      source: src,
      observedAt: latestDate(String((c as { submittedAt?: unknown }).submittedAt ?? "")),
      tier: typeof p.tier === "string" ? p.tier : null,
      payload: c,
    });
  }
  return collect(src, entries);
}

function fromTenantRegistries(): FieldManualEntry[] {
  const entries: FieldManualEntry[] = [];
  const legistarSrc = "lib/sources/legistar/client-registry.ts";
  for (const c of LEGISTAR_CLIENTS) {
    entries.push({
      id: fieldManualEntryId(legistarSrc, c.bodyId),
      role: "SHARED",
      kind: "VENDOR_TENANT",
      title: `Legistar tenant "${c.slug}" — ${c.jurisdiction}`,
      summary: `bodyId ${c.bodyId} → https://webapi.legistar.com/v1/${c.slug}/events${c.insiteHost ? `; portal ${c.insiteHost}` : ""}`,
      states: stateOf(c.ocdId),
      recordClasses: ["meetings"],
      platforms: ["legistar"],
      outcome: "YIELDED",
      url: `https://webapi.legistar.com/v1/${c.slug}/events`,
      source: legistarSrc,
      observedAt: c.insiteFeed?.observedAt ?? null,
      tier: null,
      payload: { slug: c.slug, ocdId: c.ocdId, bodyId: c.bodyId, jurisdiction: c.jurisdiction, publishingOrg: c.publishingOrg, timeZone: c.timeZone, insiteHost: c.insiteHost ?? null, insiteFeed: c.insiteFeed ?? null },
    });
  }
  const insiteSrc = "lib/sources/legistar-insite/tenant-registry.ts";
  for (const t of INSITE_TENANTS) {
    entries.push({
      id: fieldManualEntryId(insiteSrc, t.bodyId),
      role: "SHARED",
      kind: "VENDOR_TENANT",
      title: `Legistar InSite portal "${t.slug}" — ${t.jurisdiction}`,
      summary: `bodyId ${t.bodyId} → portal https://${t.host}/Calendar.aspx; bodies ${t.bodyNames.join(", ")}`,
      states: stateOf(t.ocdId ?? ""),
      recordClasses: ["meetings"],
      platforms: ["legistar-insite"],
      outcome: "YIELDED",
      url: `https://${t.host}/Calendar.aspx`,
      source: insiteSrc,
      observedAt: null,
      tier: null,
      payload: { slug: t.slug, host: t.host, ocdId: t.ocdId, bodyId: t.bodyId, bodyNames: t.bodyNames, bodyName: t.bodyName, jurisdiction: t.jurisdiction, publishingOrg: t.publishingOrg, timeZone: t.timeZone, clerkScheduleUrl: t.clerkScheduleUrl },
    });
  }
  return collect("vendor-tenant-registries", entries);
}

/** The tier vocabulary table — a tier this product has no word for is a tier it will not look for. One entry per (state, tier) cell. */
function fromTiers(): FieldManualEntry[] {
  const path = "states/TIERS.md";
  let text: string;
  try { text = readFileSync(join(ROOT, path), "utf8"); } catch { return collect(path, []); }
  const stateCols = ["nj", "nh", "az"]; // the table's column order: New Jersey | New Hampshire | Arizona
  const entries: FieldManualEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\|\s*(\d+)\s*·\s*([^|]+?)\s*\|(.+)\|\s*$/.exec(line.trim());
    if (!m) continue;
    const tierNum = m[1]!;
    const tierName = m[2]!.trim();
    const cells = m[3]!.split("|").map((c) => c.replace(/\*\*/g, "").trim());
    cells.slice(0, 3).forEach((cell, i) => {
      if (!cell || cell === "—") return;
      const state = stateCols[i]!;
      entries.push({
        id: fieldManualEntryId(path, `${state}:tier${tierNum}`),
        role: "SHARED",
        kind: "TIER_VOCAB",
        title: `${state.toUpperCase()} tier ${tierNum} — ${tierName}`,
        summary: `${state.toUpperCase()} calls its tier-${tierNum} (${tierName}) bodies: ${cell}`,
        states: [state],
        recordClasses: [],
        platforms: [],
        outcome: "REFERENCE",
        url: null,
        source: path,
        observedAt: "2026-08-26",
        tier: tierNum,
        payload: { state, tier: tierNum, tierName, vocabulary: cell },
      });
    });
  }
  return collect(path, entries);
}

/* ------------------------------------------------------------------ main --- */

async function main(): Promise<void> {
  const now0 = new Date().toISOString();
  let repos: ControlPlaneRepositories;
  if (target === "control-plane") {
    const url = controlPlaneUrlFromEnv();
    if (!url) throw new Error("field-manual-seed --target=control-plane needs WTP_CONTROL_PLANE_DATABASE_URL (pass --env-file of the main checkout's .env.local)");
    repos = await createPgRepositories(url, now0);
  } else if (target === "memory") {
    repos = createMemoryRepositories();
  } else {
    repos = await createFileRepositories(join(ROOT, ".runtime", "control-plane", "field-manual-seed"));
  }

  const entries: FieldManualEntry[] = [
    ...fromPlatforms(),
    ...fromCoverageAudits(),
    ...(target === "control-plane" ? await fromMethodCandidates(repos) : []),
    ...fromTiers(),
  ];

  // An empty sweep did not read the stores; never write it.
  if (entries.length === 0) {
    throw new Error(
      "field-manual-seed: the source sweep produced 0 entries. No knowledge store resolved (roots moved, or every reader threw). Refusing to write an empty field manual over a populated one.",
    );
  }

  let writtenCount = 0;
  const writeEntries = async (rows: readonly FieldManualEntry[]) => {
    if (dry || rows.length === 0) return;
    const result = await writeFieldManual(repos, rows, new Date().toISOString());
    if (result.error) throw new Error(`field-manual-seed: ${result.error}`);
    writtenCount += result.written;
  };
  await writeEntries(entries);
  const selected = [...args].find(arg => arg.startsWith("--state="))?.slice(8);
  const states = selected ? [routineScopeState(selected)] : ROUTINE_STATES;
  for (const state of states) {
    const doors = await ensureMeetingDoors({ state, repo: repos.doors });
    if (!doors.ready) throw new Error(`field-manual-seed: ${state}: ${doors.reason}`);
    await writeEntries(fromTenantRegistries());
  }
  console.log("Field manual seed — entries built per source:");
  for (const [source, count] of [...perSource.entries()].sort()) console.log(`  ${count.toString().padStart(5)}  ${source}`);
  console.log(dry ? "Dry run: nothing written." : `Wrote ${writtenCount} field manual entries (${target}).`);
}

await main();
