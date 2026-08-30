/**
 * **TYPED APPLICABILITY, POPULATED FROM EVIDENCE — NEVER FROM VIBES.**
 * (2026-08-30. NH287.)
 *
 * ## The defect this closes, measured
 *
 * At method version 61 the canonical store held 122 routes. Every one carried
 * `portability: UNKNOWN` — a valid resting state — and 120 of them stated ZERO
 * typed constraint dimensions: no states, no government types, no platforms,
 * no publishers. Meanwhile 61 of those routes carried recorded OUTCOMES naming
 * the jurisdiction they were actually walked in, ten carried typed claims with
 * provenance, and dozens carried the hosts they were proven against in their
 * own recorded text. The evidence existed; nothing had ever moved it into the
 * typed fields the applicability matcher reads. So `gradeApplicability` was
 * asked "does this route fit here?" about routes that had answered part of the
 * question already, in a field it does not read.
 *
 * ## What a populated dimension MEANS, and what it may never do
 *
 * A dimension written by this module is a RECORD OF WHERE THE ROUTE WAS PROVEN
 * — the same semantics `Applicability.states` has always had — never a
 * declaration of confinement. Under `gradeApplicability` (2026-08-30) an
 * evidence dimension that disagrees with a jurisdiction DEMOTES a proof to
 * OFFERED_UNPROVEN and never excludes; only a portability class that CLAIMS a
 * dimension as its bound can exclude on it. That is what makes this population
 * safe: it can stop a school-district technique reading as PROVEN for a
 * county, and it cannot stop that technique being offered to the county as an
 * experiment.
 *
 * ## The rules, all of them mechanical
 *
 *   - **states**: from `outcomes` with `outcome: "YIELDED"` only. The
 *     jurisdiction string is mapped to a USPS state code when it IS one
 *     (`az`) or is prefixed by one (`az-pima-85641` → `az`). A string that
 *     maps to no state (`pilot-counties`) proves nothing and writes nothing.
 *     ZERO / FAILED / BLOCKED walks never populate: they are knowledge about
 *     an attempt, not proof the route applies (RULING 88, RULING 182).
 *   - **platforms**: from a vendor host recorded in the route's own record
 *     (a URL or bare host whose registrable domain is a known platform
 *     domain), from a typed claim `provenance.vendors` entry, or from a
 *     platform token in the route's own id — the name its author gave the
 *     mechanism. Never from free prose word-matching: a discipline that
 *     DISCUSSES Novus is not a Novus route.
 *   - **publishers**: hosts recorded in the route's own record that are NOT
 *     vendor platform hosts — the first-party surfaces the route was proven
 *     against. Template hosts (`{tenant}.…`) are platform evidence, not
 *     publishers.
 *   - **governmentTypes**: ONLY from an OCD division id present in the
 *     record's evidence (`…/county:pima`, `…/school_district:…`). At
 *     2026-08-30 the store's evidence contains ZERO OCD ids, so this rule
 *     writes nothing today — an honest gap, named in the report, never papered
 *     over by inferring a government type from a vendor's market or a prose
 *     sentence.
 *   - **kind**: `RETRIEVAL` when the record itself names a retrieval
 *     mechanism (a URL, a recorded host, or a platform token in the id).
 *     `REASONING_DISCIPLINE` is NEVER written here — the absence of a URL is
 *     evidence about the record, not about the route.
 *
 * ## What this module refuses to touch
 *
 *   - **`portability` is never changed.** Earned promotion has its own path
 *     (`pnpm method:promote-portability`) with its own bars, and a populator
 *     that also promoted would be a second authority on reach.
 *   - **Nothing is ever removed or overwritten.** Every merge is a set union
 *     with what the store already holds; an existing `kind` is kept.
 *   - **The version does not bump.** This is an amendment: it adds no avenue,
 *     so it must not mechanically reopen every conclusion (same rule as
 *     `lib/method/amend.ts`).
 *
 * Every write goes through `writeMethodStore` — the one governed write path —
 * and every written value is reported with the evidence line that proved it.
 * Time is a parameter; nothing here reads a clock.
 */

import { readMethodStore, writeMethodStore } from "./candidate.ts";
import type { MethodKnowledge, MethodRoute, RouteKind } from "./knowledge.ts";

/** USPS state codes, lowercase — the store's jurisdiction vocabulary. */
export const STATE_CODES: readonly string[] = [
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "dc", "fl", "ga", "hi", "id",
  "il", "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms", "mo",
  "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa",
  "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy",
];

/**
 * Vendor platform registrable domains → the platform vocabulary
 * `Applicability.platforms` uses. WHAT THE PROJECT KNOWS NOW — never complete
 * (adding a vendor here is adding knowledge, not editing a cap).
 */
export const PLATFORM_DOMAINS: Readonly<Record<string, string>> = {
  "legistar.com": "legistar",
  "granicus.com": "granicus",
  "civicplus.com": "civicplus",
  "civicclerk.com": "civicclerk",
  "boarddocs.com": "boarddocs",
  "boardbook.org": "boardbook",
  "novusagenda.com": "novusagenda",
  "highbond.com": "diligent",
  "diligent.com": "diligent",
  "apptegy.com": "apptegy",
  "thrillshare.com": "apptegy",
  "onbase.com": "hyland",
  "iqm2.com": "granicus",
  "getstreamline.com": "streamline",
  "arcgis.com": "arcgis",
};

/**
 * Host-shaped tokens that are TECHNOLOGY NAMES, not surfaces anything serves
 * records from. "ASP.NET" lowercased matches the host regex and would be
 * recorded as a publisher by a rule that cannot read intent. Named, not
 * inferred: each entry here was found in an actual dry run and rejected for a
 * stated reason.
 */
export const NOT_HOSTS: readonly string[] = [
  "asp.net", // the web framework, named in prose about ViewState mechanics
  "w3.org", // spec references
  "schema.org", // markup vocabulary references
  "example.com", // illustrative placeholders
];

/** Platform tokens a route id can carry. Matched on id SEGMENTS, never prose. */
export const PLATFORM_ID_TOKENS: Readonly<Record<string, string>> = {
  legistar: "legistar",
  granicus: "granicus",
  civicplus: "civicplus",
  civicclerk: "civicclerk",
  boarddocs: "boarddocs",
  boardbook: "boardbook",
  novusagenda: "novusagenda",
  apptegy: "apptegy",
  streamline: "streamline",
  diligent: "diligent",
  hyland: "hyland",
};

const URL_RE = /https?:\/\/[^\s"'<>)\],]+/g;
/** A bare hostname. TLD set kept to what civic publishers actually use. */
const HOST_RE = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:gov|org|com|net|us|edu)\b/g;
/** An OCD division id, e.g. ocd-division/country:us/state:az/county:pima. */
const OCD_RE = /ocd-division\/country:us(?:\/[a-z_]+:[a-z0-9_.~-]+)+/g;

/** One evidence-backed value: what to write, and the line that proved it. */
export interface EvidencedValue {
  readonly value: string;
  /** WHICH evidence proved it — quotable in the per-route report. */
  readonly because: string;
}

export interface RouteEvidence {
  readonly routeId: string;
  readonly states: readonly EvidencedValue[];
  readonly governmentTypes: readonly EvidencedValue[];
  readonly platforms: readonly EvidencedValue[];
  readonly publishers: readonly EvidencedValue[];
  /** `RETRIEVAL` with its proof, or null: NOT proven, which is not DISCIPLINE. */
  readonly kind: EvidencedValue | null;
}

/** The state code a recorded outcome jurisdiction proves, or null. */
export function stateOfJurisdiction(jurisdiction: string): string | null {
  const j = jurisdiction.toLowerCase();
  if (STATE_CODES.includes(j)) return j;
  const prefix = j.slice(0, 2);
  if (j.length > 2 && j[2] === "-" && STATE_CODES.includes(prefix)) return prefix;
  return null;
}

/** The platform a host proves, matching on registrable-domain suffix. */
export function platformOfHost(host: string): string | null {
  const h = host.toLowerCase();
  for (const [domain, platform] of Object.entries(PLATFORM_DOMAINS)) {
    if (h === domain || h.endsWith(`.${domain}`)) return platform;
  }
  return null;
}

/**
 * The government type an OCD division id proves: the type of its LAST segment
 * (the division the id identifies), e.g. `county`, `place`, `school_district`.
 */
export function governmentTypeOfOcdId(ocdId: string): string | null {
  const segments = ocdId.split("/").slice(2); // drop "ocd-division", "country:us"
  const last = segments[segments.length - 1];
  if (!last) return null;
  const type = last.split(":")[0];
  if (!type || type === "state") return null;
  return type;
}

interface RecordText {
  readonly where: string;
  readonly text: string;
}

/**
 * The record texts a dimension may be derived from. Deliberately NOT the whole
 * record: sub-branch reasons and non-YIELDED outcome notes describe failures,
 * and a host named in a failure is not a surface the route was proven against.
 */
function evidenceTexts(r: MethodRoute): RecordText[] {
  const out: RecordText[] = [
    { where: "applicability.note", text: r.applicability.note || "" },
    { where: "origin", text: r.origin || "" },
  ];
  for (const o of r.outcomes) {
    if (o.outcome === "YIELDED" && o.note) {
      out.push({ where: `outcome YIELDED ${o.jurisdiction} ${o.walkedOn}`, text: o.note });
    }
  }
  for (const c of r.claims ?? []) {
    out.push({ where: `claim ${c.id}`, text: c.statement || "" });
    if (c.provenance?.artifact) {
      out.push({ where: `claim ${c.id} provenance.artifact`, text: c.provenance.artifact });
    }
  }
  return out;
}

function hostOfUrl(url: string): string | null {
  const m = /^https?:\/\/([^/:?#]+)/.exec(url);
  if (!m) return null;
  const host = m[1].toLowerCase();
  // A template host ({tenant}.legistar.com) identifies the PLATFORM, never a
  // publisher; strip the template label and keep what is concrete.
  if (host.includes("{") || host.includes("<")) {
    const concrete = host.replace(/^[^.]*[{<][^.]*\./, "");
    return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(concrete) ? concrete : null;
  }
  return host;
}

/**
 * Derive every typed value this route's own record proves. Pure; reads no
 * file, writes nothing, and returns the proof beside each value.
 */
export function deriveRouteEvidence(r: MethodRoute): RouteEvidence {
  const states = new Map<string, string>();
  const governmentTypes = new Map<string, string>();
  const platforms = new Map<string, string>();
  const publishers = new Map<string, string>();
  let kind: EvidencedValue | null = null;
  const keep = (m: Map<string, string>, value: string, because: string): void => {
    if (!m.has(value)) m.set(value, because);
  };

  // states — YIELDED outcomes only.
  for (const o of r.outcomes) {
    if (o.outcome !== "YIELDED") continue;
    const state = stateOfJurisdiction(o.jurisdiction);
    if (state) {
      keep(states, state, `YIELDED in "${o.jurisdiction}" on ${o.walkedOn}`);
    }
  }

  // hosts recorded in the route's own record.
  const hosts = new Map<string, string>(); // host -> where
  for (const { where, text } of evidenceTexts(r)) {
    for (const url of text.match(URL_RE) ?? []) {
      const host = hostOfUrl(url);
      if (host && !NOT_HOSTS.includes(host) && !hosts.has(host)) {
        hosts.set(host, `${where}: ${url}`);
      }
    }
    for (const bare of text.toLowerCase().match(HOST_RE) ?? []) {
      if (!NOT_HOSTS.includes(bare) && !hosts.has(bare)) {
        hosts.set(bare, `${where}: host ${bare}`);
      }
    }
    // governmentTypes — OCD ids in evidence, where present.
    for (const ocd of text.match(OCD_RE) ?? []) {
      const type = governmentTypeOfOcdId(ocd);
      if (type) keep(governmentTypes, type, `${where}: ${ocd}`);
    }
  }

  for (const [host, where] of hosts) {
    const platform = platformOfHost(host);
    if (platform) keep(platforms, platform, where);
    else keep(publishers, host, where);
    if (!kind) kind = { value: "RETRIEVAL", because: `record names a retrieval surface (${where})` };
  }

  // platforms — typed claim provenance vendors.
  for (const c of r.claims ?? []) {
    for (const vendor of c.provenance?.vendors ?? []) {
      keep(platforms, vendor.toLowerCase(), `claim ${c.id} provenance.vendors`);
    }
  }

  // platforms + kind — a platform token in the route's OWN id.
  for (const segment of r.id.toLowerCase().split("-")) {
    const platform = PLATFORM_ID_TOKENS[segment];
    if (platform) {
      keep(platforms, platform, `route id names the platform ("${segment}")`);
      if (!kind) {
        kind = { value: "RETRIEVAL", because: `route id names a vendor surface ("${segment}")` };
      }
    }
  }

  const list = (m: Map<string, string>): EvidencedValue[] =>
    [...m].map(([value, because]) => ({ value, because })).sort((a, b) => a.value.localeCompare(b.value));
  return {
    routeId: r.id,
    states: list(states),
    governmentTypes: list(governmentTypes),
    platforms: list(platforms),
    publishers: list(publishers),
    kind,
  };
}

export interface DimensionAddition {
  readonly dimension: "states" | "governmentTypes" | "platforms" | "publishers" | "kind";
  readonly value: string;
  readonly because: string;
}

export interface RoutePlan {
  readonly routeId: string;
  /** Values NOT already present. Empty means the route is already typed. */
  readonly additions: readonly DimensionAddition[];
  /** Evidence found but already recorded — reported so a re-run reads honest. */
  readonly alreadyTyped: number;
}

export interface TypedApplicabilityPlan {
  /** The prospective store. Identical to the input when nothing was added. */
  readonly knowledge: MethodKnowledge;
  /** Every route examined — the denominator. */
  readonly considered: number;
  readonly routePlans: readonly RoutePlan[];
  /** Routes whose record proved NOTHING new. Counted, never hidden. */
  readonly unchanged: number;
  /** Routes still carrying no `kind` — the named classification gap. */
  readonly kindUnclassified: readonly string[];
}

/**
 * Plan the population. Pure and idempotent: values already present produce no
 * addition, so a second run over its own output plans zero additions.
 */
export function planTypedApplicability(k: MethodKnowledge): TypedApplicabilityPlan {
  const routePlans: RoutePlan[] = [];
  const kindUnclassified: string[] = [];

  const routes = k.routes.map((r) => {
    const evidence = deriveRouteEvidence(r);
    const additions: DimensionAddition[] = [];
    let alreadyTyped = 0;

    const merge = (
      dimension: "states" | "governmentTypes" | "platforms" | "publishers",
      current: readonly string[],
      found: readonly EvidencedValue[],
    ): string[] => {
      const next = [...current];
      for (const f of found) {
        if (next.includes(f.value)) {
          alreadyTyped += 1;
          continue;
        }
        next.push(f.value);
        additions.push({ dimension, value: f.value, because: f.because });
      }
      return next;
    };

    const a = r.applicability;
    const states = merge("states", a.states, evidence.states);
    const governmentTypes = merge("governmentTypes", a.governmentTypes, evidence.governmentTypes);
    const platforms = merge("platforms", a.platforms, evidence.platforms);
    const publishers = merge("publishers", a.publishers, evidence.publishers);

    let kind = r.kind;
    if (!kind && evidence.kind) {
      kind = evidence.kind.value as RouteKind;
      additions.push({ dimension: "kind", value: evidence.kind.value, because: evidence.kind.because });
    } else if (r.kind && evidence.kind) {
      alreadyTyped += 1;
    }
    if (!kind) kindUnclassified.push(r.id);

    routePlans.push({ routeId: r.id, additions, alreadyTyped });
    if (additions.length === 0) return r;
    return {
      ...r,
      ...(kind ? { kind } : {}),
      applicability: { ...a, states, governmentTypes, platforms, publishers },
    };
  });

  const changed = routePlans.filter((p) => p.additions.length > 0).length;
  return {
    knowledge: changed > 0 ? { ...k, routes } : k,
    considered: k.routes.length,
    routePlans,
    unchanged: k.routes.length - changed,
    kindUnclassified,
  };
}

export interface TypedApplicabilityRunOptions {
  /** ISO date, from `pnpm stamp`. */
  readonly stamp: string;
  /** **Default false.** Without it the run prints what it WOULD write and exits. */
  readonly write?: boolean;
}

export interface TypedApplicabilityRunResult {
  readonly plan: TypedApplicabilityPlan;
  readonly written: boolean;
  readonly lines: readonly string[];
}

/**
 * Read, plan, report per route WITH the proving evidence, and write only on an
 * explicit `write` — through `writeMethodStore`, the one governed write path,
 * with the version this run read as its precondition. The version is NOT
 * bumped: this is an amendment, and an amendment adds no avenue.
 */
export function runTypedApplicability(
  storePath: string,
  options: TypedApplicabilityRunOptions,
): TypedApplicabilityRunResult {
  const k = readMethodStore(storePath);
  const plan = planTypedApplicability(k);
  const lines: string[] = [];

  lines.push(`method version           ${k.version}   (an amendment adds no avenue and bumps nothing)`);
  lines.push(`routes considered        ${plan.considered}`);
  for (const p of plan.routePlans) {
    if (p.additions.length === 0) continue;
    lines.push(`  ${p.routeId}`);
    for (const a of p.additions) {
      lines.push(`      ${a.dimension.padEnd(15)} += ${a.value.padEnd(24)} because ${a.because}`);
    }
  }
  const changed = plan.considered - plan.unchanged;
  lines.push(`routes gaining typed evidence   ${changed}`);
  lines.push(`routes with nothing new proven  ${plan.unchanged}   (evidence absent or already recorded — never guessed at)`);
  lines.push(
    `kind UNCLASSIFIED               ${plan.kindUnclassified.length}   — no retrieval mechanism in the record; ` +
      "NOT asserted to be disciplines. Classification is a deliberate later act.",
  );

  if (changed === 0) {
    lines.push("nothing to write — every value the evidence proves is already in the store");
    return { plan, written: false, lines };
  }
  if (!options.write) {
    lines.push("");
    lines.push("DRY RUN — nothing written. Re-run with --write to apply.");
    return { plan, written: false, lines };
  }

  const receipt = writeMethodStore(storePath, plan.knowledge, {
    expectedVersion: k.version,
    stamp: options.stamp,
  });
  lines.push("");
  lines.push(
    `written to ${receipt.path}   —  ${changed} route(s) typed, ${receipt.bytes} bytes, ` +
      `method version ${receipt.version} (unchanged: population learns no route)`,
  );
  return { plan, written: true, lines };
}
