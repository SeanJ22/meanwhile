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

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  fieldManualEntryId,
  readFieldManual,
  writeFieldManual,
  type FieldManualEntry,
  type FieldManualOutcome,
  type FieldManualRole,
} from "../lib/control-plane/field-manual.ts";
import { leadLine, researchDocEntries, splitMarkdownDocument } from "../lib/method/research-docs.ts";
import { defaultPlaybookEntries } from "../lib/control-plane/playbooks.ts";
import { MANIFEST_ROUTES } from "../lib/hunt/branch-manifest.ts";
import { platformFingerprintEntries } from "../lib/control-plane/platform-fingerprints.ts";
import { DESCENT_SEEDS } from "../lib/hunt/descent-seeds.ts";
import { COVERAGE_AUDITS } from "../lib/registry/coverage-audit.ts";
import { LEGISTAR_CLIENTS } from "../lib/sources/legistar/client-registry.ts";
import { INSITE_TENANTS } from "../lib/sources/legistar-insite/tenant-registry.ts";
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

const PLATFORM_TOKENS: readonly [RegExp, string][] = [
  [/legistar[- ]?insite/i, "legistar-insite"], [/legistar/i, "legistar"], [/civicclerk/i, "civicclerk"],
  [/civicplus/i, "civicplus"], [/granicus/i, "granicus"], [/novus\s?agenda|novus/i, "novusagenda"],
  [/boardbook/i, "boardbook"], [/primegov/i, "primegov"], [/onbase|hyland/i, "onbase"],
  [/apptegy|thrillshare/i, "apptegy"], [/diligent/i, "diligent"], [/revize/i, "revize"], [/escribe/i, "escribe"],
];
/** Vendor platforms named in a heading or line. A platform hint sharpens a platform-scoped query and never hides an entry from the scout path, which does not filter on it. */
function platformHints(text: string): string[] {
  const out = new Set<string>();
  for (const [re, id] of PLATFORM_TOKENS) if (re.test(text)) out.add(id);
  return [...out];
}

/* ------------------------------------------------------------- importers --- */

const perSource = new Map<string, number>();
function collect(source: string, entries: FieldManualEntry[]): FieldManualEntry[] {
  perSource.set(source, (perSource.get(source) ?? 0) + entries.length);
  return entries;
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
  return platformFingerprintEntries();
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

/**
 * The vendor TENANT registries — the single most reusable thing in the whole
 * inventory and the one that was not even pointed to: a bodyId → tenant slug →
 * exact API URL. Read only the scalar wiring; never the `venues` getter, which
 * resolves against the promoted projection at runtime and is not this seed's to
 * touch.
 */
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

/** The descent RESULTS — the harvested candidate bodies per tier, per state. One entry per tier walked, the whole level (declined doors and all) kept in payload. */
function fromDescentResults(): FieldManualEntry[] {
  const entries: FieldManualEntry[] = [];
  for (const state of ["az", "nh", "nj"]) {
    const path = `states/${state}/descent.json`;
    let doc: { startedOn?: unknown; levels?: unknown };
    try { doc = JSON.parse(readFileSync(join(ROOT, path), "utf8")); } catch { continue; }
    const levels = Array.isArray(doc.levels) ? (doc.levels as Record<string, unknown>[]) : [];
    for (const lvl of levels) {
      const tier = String(lvl.tier ?? "");
      const yielded = Number(lvl.yielded ?? 0);
      const newCand = Number(lvl.candidatesNew ?? 0);
      const vocab = strings(lvl.vocabulary);
      entries.push({
        id: fieldManualEntryId(path, tier),
        role: "SHARED",
        kind: "DESCENT_RESULT",
        title: `${state.toUpperCase()} ${tier} descent${doc.startedOn ? ` (${String(doc.startedOn)})` : ""}`,
        summary: `found ${lvl.found}, followed ${lvl.followed}, yielded ${yielded}, barren ${lvl.barren}; ${newCand} new candidate bodies; vocabulary ${vocab.join("/") || "none"}`,
        states: [state],
        recordClasses: [],
        platforms: [],
        outcome: yielded > 0 ? "YIELDED" : newCand > 0 ? "REFERENCE" : "ZERO",
        url: null,
        source: path,
        observedAt: typeof lvl.walkedOn === "string" ? lvl.walkedOn : (typeof doc.startedOn === "string" ? doc.startedOn : null),
        tier,
        payload: lvl,
      });
    }
  }
  return collect("states/*/descent.json", entries);
}

/** The citation ledger — a proven officeholder source cannot delete a person from a reader's page. One entry per distinct confirming URL, its people kept in payload. */
function fromCitationConfirmations(): FieldManualEntry[] {
  const path = "data/states/nj/hunt/citation-confirmations.json";
  let doc: { rows?: unknown };
  try { doc = JSON.parse(readFileSync(join(ROOT, path), "utf8")); } catch { return collect(path, []); }
  const rows = Array.isArray(doc.rows) ? (doc.rows as Record<string, unknown>[]) : [];
  const byUrl = new Map<string, { url: string; source: string; last: string; persons: { person: string; firstConfirmedOn: string; lastConfirmedOn: string }[] }>();
  for (const r of rows) {
    const url = typeof r.url === "string" ? r.url : "";
    if (!url) continue;
    const person = String(r.person ?? "").replace(/^[\s:*]+/, "").replace(/\s+/g, " ").trim();
    const last = String(r.lastConfirmedOn ?? "");
    const g = byUrl.get(url) ?? { url, source: String(r.source ?? ""), last: "", persons: [] };
    g.persons.push({ person, firstConfirmedOn: String(r.firstConfirmedOn ?? ""), lastConfirmedOn: last });
    if (last > g.last) g.last = last;
    byUrl.set(url, g);
  }
  const entries: FieldManualEntry[] = [];
  for (const g of byUrl.values()) {
    let host = g.url;
    try { host = new URL(g.url).hostname; } catch { /* keep the raw string */ }
    entries.push({
      id: fieldManualEntryId(path, g.url),
      role: "SHARED",
      kind: "CITATION_SOURCE",
      title: `NJ officeholder source — ${host}`,
      summary: `a confirmed source for ${g.persons.length} officeholder(s); last confirmed ${g.last || "?"}`,
      states: ["nj"],
      recordClasses: [],
      platforms: [],
      outcome: "YIELDED",
      url: g.url,
      source: path,
      observedAt: g.last || null,
      tier: null,
      payload: { url: g.url, source: g.source, persons: g.persons },
    });
  }
  return collect(path, entries);
}

/** Every markdown file under a directory, repo-relative with forward slashes. */
function markdownUnder(dir: string): string[] {
  const out: string[] = [];
  let names: import("node:fs").Dirent[];
  try { names = readdirSync(join(ROOT, dir), { withFileTypes: true }); } catch { return out; }
  for (const d of names) {
    const rel = `${dir}/${d.name}`;
    if (d.isDirectory()) out.push(...markdownUnder(rel));
    else if (d.name.endsWith(".md")) out.push(rel);
  }
  return out.sort();
}

/**
 * The research docs, IN FULL: every `states/**` and `docs/detective/` markdown file,
 * each `##`/`###` section its own entry with its whole body in the payload. Not a
 * pointer to the file: the text itself is in the manual every worker reads.
 */
function fromResearchDocs(): FieldManualEntry[] {
  const entries: FieldManualEntry[] = [];
  for (const path of [...markdownUnder("states"), ...markdownUnder("docs/detective")]) {
    let text: string;
    try { text = readFileSync(join(ROOT, path), "utf8"); } catch { continue; }
    const state = /^states\/([a-z]{2})\//.exec(path)?.[1];
    entries.push(...researchDocEntries({ path, text, states: state ? [state] : stateOf(path, text.slice(0, 400)), platformHints }));
  }
  return collect("states/** and docs/detective/ (full text)", entries);
}

/** The ZIP playbook, indexed — every `##`/`###` rung/recipe as a queryable entry (the "what to try for a township clerk" index). The 292 KB of prose stays the pointer entry; the index is what a worker can actually reach. */
function fromPlaybookIndex(): FieldManualEntry[] {
  const path = "docs/zip-playbook.md";
  const src = `${path}#index`;
  let text: string;
  try { text = readFileSync(join(ROOT, path), "utf8"); } catch { return collect(src, []); }
  const entries: FieldManualEntry[] = [];
  for (const sec of splitMarkdownDocument(text).sections) {
    const lead = leadLine(sec.body);
    entries.push({
      id: fieldManualEntryId(src, sec.heading),
      role: "SHARED",
      kind: "PLAYBOOK_RUNG",
      title: sec.heading.slice(0, 200),
      summary: (lead || sec.heading).slice(0, 300),
      states: stateOf(sec.heading, lead),
      recordClasses: [],
      platforms: platformHints(`${sec.heading}\n${lead}`),
      outcome: "REFERENCE",
      url: null,
      source: path,
      observedAt: latestDate(sec.heading, lead),
      tier: null,
      payload: { heading: sec.heading, level: sec.level, lead, doc: path },
    });
  }
  return collect(src, entries);
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
    ...fromManifest(),
    ...fromPlatforms(),
    ...fromDescentSeeds(),
    ...fromCoverageAudits(),
    ...(target === "control-plane" ? await fromMethodCandidates(repos) : []),
    ...fromDocs(),
    ...defaultPlaybookEntries(["SCOUT", "DETECTIVE", "PARSER", "AUDITOR", "ENGINEER", "VALIDATOR"]),
    ...fromTenantRegistries(),
    ...fromTiers(),
    ...fromDescentResults(),
    ...fromCitationConfirmations(),
    ...fromResearchDocs(),
    ...fromPlaybookIndex(),
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

  const written = await writeFieldManual(repos, entries, new Date().toISOString());
  if (written.error) throw new Error(`field-manual-seed: the write failed: ${written.error}`);
  const total = (await readFieldManual(repos)).store.entries.length;
  console.log(`
Wrote cp_field_manual/live (${target}): ${total} entries total (${written.written} offered by this seed).`);
}

await main();
