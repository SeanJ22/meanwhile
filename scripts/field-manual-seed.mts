#!/usr/bin/env tsx
/**
 * **SEED / GROW THE FIELD MANUAL FROM EVERY SCATTERED KNOWLEDGE STORE.**
 * (Owner directive 2026-09-19 — consolidate discovery knowledge into one
 * growing store, without loss.)
 *
 * Reads each machine-readable knowledge store and folds it into the one
 * `cp_field_manual` aggregate as typed, projectable entries whose `payload`
 * keeps the ORIGINAL record verbatim — so nothing is dropped to look tidy. It
 * only ever grows: a re-run refreshes entries in place and never removes one.
 * The big Markdown method-of-record docs (the playbook, the source ladder, the
 * per-state dossiers) are indexed as pointer entries — their full narrative
 * stays version-controlled in git, and the manual now knows they exist and what
 * they cover.
 *
 * Usage (safe by default — writes the LOCAL file provider unless told otherwise):
 *   node --env-file=<main .env.local> --experimental-strip-types \
 *     --import ./scripts/register-test-loader.mjs scripts/field-manual-seed.mts \
 *     [--target=control-plane|file|memory] [--dry]
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  emptyFieldManual,
  fieldManualEntryId,
  upsertEntries,
  type FieldManualEntry,
  type FieldManualOutcome,
  type FieldManualRole,
} from "../lib/control-plane/field-manual.ts";
import { readMethodStore } from "../lib/method/candidate.ts";
import { MANIFEST_ROUTES } from "../lib/hunt/branch-manifest.ts";
import { KNOWN_PLATFORMS } from "../lib/hunt/platform-tenancy.ts";
import { DESCENT_SEEDS } from "../lib/hunt/descent-seeds.ts";
import { COVERAGE_AUDITS } from "../lib/registry/coverage-audit.ts";
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

function fromKnowledge(): FieldManualEntry[] {
  const store = readMethodStore(join(ROOT, "data", "method", "knowledge.json"));
  const src = "data/method/knowledge.json";
  return collect(src, store.routes.map((route) => {
    const r = route as unknown as Record<string, unknown>;
    const applicability = (r.applicability ?? {}) as Record<string, unknown>;
    const outcomes = (r.outcomes as { outcome?: unknown; walkedOn?: unknown }[] | undefined) ?? [];
    return {
      id: fieldManualEntryId(src, String(r.id)),
      role: "SCOUT" as FieldManualRole,
      kind: "ROUTE",
      title: String(r.title ?? r.id),
      summary: `${String(r.kind ?? "RETRIEVAL")}; ${strings(r.fields).join(", ") || "any field"}; ${String((r as { note?: unknown }).note ?? "")}`.slice(0, 300),
      states: strings(applicability.states),
      recordClasses: strings(r.fields),
      platforms: strings(applicability.platforms),
      outcome: bestOutcome(outcomes),
      url: null,
      source: src,
      observedAt: latestDate(store.updatedOn, ...outcomes.map((o) => String(o.walkedOn ?? ""))),
      tier: typeof r.tier === "string" ? r.tier : null,
      payload: route,
    };
  }));
}

function fromManifest(): FieldManualEntry[] {
  const src = "lib/hunt/branch-manifest.ts";
  return collect(src, MANIFEST_ROUTES.map((route) => ({
    id: fieldManualEntryId(src, route.id),
    role: "SCOUT" as FieldManualRole,
    kind: "MANIFEST_BRANCH",
    title: route.what,
    summary: `${route.how} → ${route.yields}`,
    states: stateOf(route.how, route.what, route.through),
    recordClasses: [...route.fields],
    platforms: [],
    outcome: "REFERENCE" as FieldManualOutcome,
    url: null,
    source: src,
    observedAt: null,
    tier: route.tier,
    payload: route,
  })));
}

function fromPlatforms(): FieldManualEntry[] {
  const src = "lib/hunt/platform-tenancy.ts";
  return collect(src, KNOWN_PLATFORMS.map((p) => ({
    id: fieldManualEntryId(src, p.id),
    role: "SHARED" as FieldManualRole,
    kind: "PLATFORM_FINGERPRINT",
    title: `${p.label} tenancy`,
    summary: `a body on ${p.label} is machine-readable; recognise its host by ${String(p.hostPattern)}`,
    states: [],
    recordClasses: ["meetings"],
    platforms: [p.id],
    outcome: "REFERENCE" as FieldManualOutcome,
    url: null,
    source: src,
    observedAt: null,
    tier: null,
    payload: { id: p.id, label: p.label, hostPattern: String(p.hostPattern) },
  })));
}

function fromDescentSeeds(): FieldManualEntry[] {
  const src = "lib/hunt/descent-seeds.ts";
  const entries: FieldManualEntry[] = [];
  for (const [state, seeds] of Object.entries(DESCENT_SEEDS)) {
    for (const seed of seeds) {
      entries.push({
        id: fieldManualEntryId(src, `${state}:${seed.url}`),
        role: "SCOUT",
        kind: "DESCENT_SEED",
        title: `${seed.tier} descent door — ${seed.publisher}`,
        summary: `${seed.why} (control string: ${seed.control})`,
        states: [state.toLowerCase()],
        recordClasses: [],
        platforms: [],
        outcome: "REFERENCE",
        url: seed.url,
        source: src,
        observedAt: null,
        tier: null,
        payload: seed,
      });
    }
  }
  return collect(src, entries);
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

/** Index the big Markdown method-of-record docs as pointers — full text stays in git, never lost. */
function fromDocs(): FieldManualEntry[] {
  const docs: { path: string; kind: string; role: FieldManualRole; states: string[]; title: string }[] = [
    { path: "docs/zip-playbook.md", kind: "PLAYBOOK", role: "SHARED", states: [], title: "The ZIP discovery playbook (lettered A–M ladder, dated rungs and dead doors, definition-of-done)" },
    { path: "docs/source-ladder.md", kind: "PLAYBOOK", role: "SHARED", states: [], title: "The source ladder — per-body evidence: every rung walked, every wall that fell" },
    { path: "docs/branch-manifest.md", kind: "PLAYBOOK", role: "SCOUT", states: [], title: "The branch manifest, question-indexed (candidate field → ordered route ids)" },
    { path: "docs/sources.md", kind: "SOURCE_REGISTER", role: "SHARED", states: [], title: "The global source & credential register (wired/auth/licence)" },
  ];
  for (const state of ["az", "nh", "nj"]) {
    for (const name of ["sources", "NOTES", "tenancy"] as const) {
      docs.push({
        path: `states/${state}/${name}.md`,
        kind: name === "sources" ? "SOURCE_REGISTER" : name === "tenancy" ? "PLATFORM_FINGERPRINT" : "STATE_NOTE",
        role: "SHARED",
        states: [state],
        title: `${state.toUpperCase()} ${name === "NOTES" ? "dossier — jurisdiction-specific walls, vendor quirks, statutes" : name === "sources" ? "source register & filing-officer statute shape" : "platform-tenancy evidence"}`,
      });
    }
  }
  const entries: FieldManualEntry[] = [];
  for (const doc of docs) {
    let bytes = 0;
    let excerpt = "";
    try {
      bytes = statSync(join(ROOT, doc.path)).size;
      excerpt = readFileSync(join(ROOT, doc.path), "utf8").replace(/\s+/g, " ").slice(0, 400);
    } catch {
      continue;
    }
    entries.push({
      id: fieldManualEntryId(doc.path, "doc"),
      role: doc.role,
      kind: doc.kind,
      title: doc.title,
      summary: `method-of-record; read ${doc.path} (${Math.round(bytes / 1024)} KB) — ${excerpt}`.slice(0, 300),
      states: doc.states,
      recordClasses: [],
      platforms: [],
      outcome: "REFERENCE",
      url: doc.path,
      source: doc.path,
      observedAt: null,
      tier: null,
      payload: { path: doc.path, bytes, excerpt },
    });
  }
  return collect("markdown-docs", entries);
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
    ...fromKnowledge(),
    ...fromManifest(),
    ...fromPlatforms(),
    ...fromDescentSeeds(),
    ...fromCoverageAudits(),
    ...(target === "control-plane" ? await fromMethodCandidates(repos) : []),
    ...fromDocs(),
  ];

  // RULING 159 floor: a seed that consolidated NOTHING did not read the stores —
  // an empty field manual is a broken sweep, never a valid state to write.
  if (entries.length === 0) {
    throw new Error(
      "field-manual-seed: the source sweep produced 0 entries. No knowledge store resolved (roots moved, or every reader threw). Refusing to write an empty field manual over a populated one.",
    );
  }

  console.log("Field manual seed — entries built per source:");
  for (const [src, n] of [...perSource.entries()].sort()) console.log(`  ${n.toString().padStart(5)}  ${src}`);
  console.log(`  ${entries.length.toString().padStart(5)}  TOTAL`);

  if (dry) {
    console.log("\n--dry: nothing written.");
    return;
  }

  const now = new Date().toISOString();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await repos.fieldManual.read("live");
    const next = upsertEntries(current?.value ?? emptyFieldManual(), entries, now);
    try {
      if (current === null) await repos.fieldManual.put("live", next, now);
      else await repos.fieldManual.compareAndSet("live", current.revision, next, now);
      console.log(`\nWrote cp_field_manual/live (${target}): ${next.entries.length} entries total.`);
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      console.log(`  retry ${attempt + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

await main();
