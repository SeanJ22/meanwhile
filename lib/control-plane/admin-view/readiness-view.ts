/**
 * **READINESS, AS THE DESIGN DRAWS IT.** (Admin redesign, 2026-09-23.)
 *
 * Collection status, the five readings and the requirement families, each
 * built from a record the system actually keeps:
 *
 * ```
 *   the grid        the published readiness snapshot: 23 capabilities, each
 *                   checked through five gates (source known → acquired →
 *                   verified → shown to reader → Ask answers), per state
 *   the bodies      the registry (coverage status per body) and the watched
 *                   meeting bodies (their reads, versions and readbacks)
 *   the gates       the pilot health contracts on the owner snapshot — system
 *                   wide, pass or fail, and said to be system wide
 *   the paid lane   the research lane's own state: open, or closed and why
 * ```
 *
 * Five readings, five denominators; none is averaged with another and no
 * sixth number combines them. A lane blocked by its own gate blocks only
 * itself. PURE.
 */
import { CAPABILITY_DOMAINS, type CapabilityDomain, type CapabilityRow, type ReadinessStateSnapshot } from "../readiness/model.ts";
import type { CellState } from "../readiness/gates.ts";
import type { BodyView } from "./bodies.ts";
import type { CoverageCounts } from "./coverage.ts";

export interface LaneLine {
  readonly name: string;
  readonly why: string;
}

export interface CollectionStatus {
  readonly pill: "READY" | "PARTLY READY" | "NOT READY";
  readonly lede: string;
  readonly eligible: readonly LaneLine[];
  readonly blocked: readonly LaneLine[];
}

export interface GridCounts {
  readonly cells: number;
  readonly byState: Readonly<Record<CellState, number>>;
}

export function gridCounts(capabilities: readonly CapabilityRow[]): GridCounts {
  const byState: Record<CellState, number> = { CURRENT: 0, PARTIAL_OR_STALE: 0, NOT_WALKED: 0, ARGUED_ABSENT: 0, BLOCKED: 0, GATED_ON_OPERATOR: 0 };
  let cells = 0;
  for (const c of capabilities) {
    for (const g of c.gates) {
      cells += 1;
      byState[g.state] += 1;
    }
  }
  return { cells, byState };
}

const DOMAIN_WORDS: Readonly<Record<CapabilityDomain, string>> = {
  "Districts and geography": "Districts and boundaries",
  "Officials and offices": "Officials and offices",
  "Elections and ballot": "Elections, candidates and the ballot",
  "Campaign finance": "Campaign finance",
  "Meetings and agendas": "Meetings and agendas",
};

export function collectionStatus(input: {
  readonly snapshot: ReadinessStateSnapshot;
  /** The paid research lane: null when it is open. */
  readonly paidLaneClosedBecause: string | null;
  /** Meeting sources the standing clock reads in this state now (the routine lane), when read. */
  readonly liveMeetingSources: number | null;
}): CollectionStatus {
  const eligible: LaneLine[] = [];
  const blocked: LaneLine[] = [];
  for (const domain of CAPABILITY_DOMAINS) {
    const rows = input.snapshot.capabilities.filter((c) => c.domain === domain);
    if (rows.length === 0) continue;
    const stopping = rows.flatMap((r) => r.gates.filter((g) => g.state === "BLOCKED" || g.state === "GATED_ON_OPERATOR").map((g) => ({ r, g })));
    if (stopping.length > 0) {
      const first = stopping[0];
      blocked.push({
        name: DOMAIN_WORDS[domain],
        why: `${first.r.label}: ${first.g.detail}${stopping.length > 1 ? ` (${stopping.length} checks stop here)` : ""}. This blocks its own lane only.`,
      });
      continue;
    }
    const known = rows.filter((r) => r.gates[0]?.state === "CURRENT" || r.gates[0]?.state === "PARTIAL_OR_STALE").length;
    const acquired = rows.filter((r) => r.gates[1]?.state === "CURRENT" || r.gates[1]?.state === "PARTIAL_OR_STALE").length;
    const live =
      domain === "Meetings and agendas" && input.liveMeetingSources !== null && input.liveMeetingSources > 0
        ? `; the standing clock reads ${input.liveMeetingSources} meeting ${input.liveMeetingSources === 1 ? "source" : "sources"} here now`
        : "";
    eligible.push({
      name: DOMAIN_WORDS[domain],
      why:
        known === 0
          ? `nothing stops it; the published grid records a source for none of its ${rows.length} capabilities yet${live}`
          : `nothing stops it; the published grid records a source for ${known} of ${rows.length} capabilities and ${acquired} acquired${live}`,
    });
  }
  if (input.paidLaneClosedBecause !== null) {
    blocked.push({ name: "Paid research (Scouts)", why: `${input.paidLaneClosedBecause} Plain-code work and routine publication continue.` });
  } else {
    eligible.push({ name: "Paid research (Scouts)", why: "open; it spends only inside the daily ceiling and any geography budget" });
  }
  const pill: CollectionStatus["pill"] = blocked.length === 0 ? "READY" : eligible.length === 0 ? "NOT READY" : "PARTLY READY";
  const lede =
    blocked.length === 0
      ? `Every lane can start. Finishing the checklist is not a condition of starting, and no percentage on this page can overrule a gate that failed.`
      : `${blocked.length === 1 ? "One lane cannot" : `${blocked.length} lanes cannot`} start and ${eligible.length === 1 ? "one can" : `${eligible.length} can`}. Finishing the checklist is not a condition of starting — a local problem stops its own lane and nothing else, and no percentage on this page can overrule a gate that failed.`;
  return { pill, lede, eligible, blocked };
}

export interface ReadingCard {
  readonly key: string;
  readonly name: string;
  /** Null renders the dashed pill with `unknown`. */
  readonly fig: string | null;
  readonly unknown: string;
  readonly tone: "gold" | "text" | "teal";
  readonly unit: string;
  readonly note: string;
  readonly meta: readonly (readonly [string, string])[];
  readonly dashed: boolean;
}

export interface BodyFreshness {
  readonly published: number;
  readonly freshInside: number;
  readonly readBack: number;
}

/** Of the watched bodies with a published version: re-read successfully inside a day, and read back. */
export function bodyFreshness(views: readonly BodyView[], nowIso: string, graceMs = 25 * 3_600_000): BodyFreshness {
  const now = Date.parse(nowIso);
  const published = views.filter((v) => v.records !== null);
  return {
    published: published.length,
    freshInside: published.filter((v) => v.lastSuccessAt !== null && now - Date.parse(v.lastSuccessAt) <= graceMs).length,
    readBack: published.filter((v) => v.readerVisible !== null).length,
  };
}

export function readingCards(input: {
  readonly stateName: string;
  readonly coverage: CoverageCounts | null;
  readonly coverageGap: string | null;
  readonly registryVersion: string | null;
  readonly grid: GridCounts | null;
  readonly contract: string | null;
  readonly freshness: BodyFreshness | null;
  readonly gates: { readonly passing: number; readonly total: number; readonly failing: readonly string[] } | null;
  readonly observedAt: string;
}): ReadingCard[] {
  const c = input.coverage;
  const g = input.grid;
  const f = input.freshness;
  const cards: ReadingCard[] = [
    {
      key: "coverage",
      name: "Coverage",
      fig: c ? `${c.wayIn.toLocaleString("en-US")} of ${c.bodies.toLocaleString("en-US")}` : null,
      unknown: "NOT READ",
      tone: "gold",
      unit: "registered bodies with a way in, for meetings",
      note: c
        ? `${c.neverWalked.toLocaleString("en-US")} have never been walked and ${c.lookedNoRoute.toLocaleString("en-US")} were looked at with no route found — counted apart, never folded in. Other categories carry their own coverage in the requirement grid.`
        : input.coverageGap ?? "The registry could not be read.",
      meta: [
        ["DENOMINATOR", "every registered body in the state: Census of Governments units plus curated bodies"],
        ["SCOPE", `${input.stateName} · all levels`],
        ["SOURCE", input.registryVersion ? `registry ${input.registryVersion.slice(0, 40)}` : "registry not read"],
      ],
      dashed: false,
    },
    {
      key: "completeness",
      name: "Completeness of requirements",
      fig: g ? `${g.byState.CURRENT} of ${g.cells}` : null,
      unknown: "NOT PUBLISHED",
      tone: "gold",
      unit: "requirement checks satisfied and current",
      note: g
        ? `${g.byState.PARTIAL_OR_STALE} are partial or stale, ${g.byState.NOT_WALKED} have never been walked, ${g.byState.BLOCKED} are blocked, ${g.byState.GATED_ON_OPERATOR} wait on you and ${g.byState.ARGUED_ABSENT} are argued absent — each counted apart, never folded in to improve the figure.`
        : "No readiness grid is published for this state yet.",
      meta: [
        ["EXCLUDES", "the system-wide Ask pilot health proofs, reported separately below"],
        ["STANDARD", input.contract ?? "none published"],
      ],
      dashed: false,
    },
    {
      key: "freshness",
      name: "Freshness",
      fig: f && f.published > 0 ? `${f.freshInside} of ${f.published}` : null,
      unknown: f ? "NOTHING PUBLISHED" : "NOT READ",
      tone: "text",
      unit: "published meeting sources re-read inside their daily interval",
      note: "A source never acquired, or last read successfully more than a day ago, never counts as fresh. Families with no freshness rule — government finance and participation — are not measured rather than assumed current.",
      meta: [
        ["NOT MEASURED", "government finance and participation have no rule set"],
        ["OBSERVED", input.observedAt],
      ],
      dashed: false,
    },
    {
      key: "delivery",
      name: "Public delivery",
      fig: f && f.published > 0 ? `${f.readBack} of ${f.published}` : null,
      unknown: "UNKNOWN",
      tone: "teal",
      unit: "published meeting versions the typed Reader read back",
      note:
        "A readback proves the reader's own read model serves that exact version. It is a check of the site, and never proof that a person viewed it. This card counts routine meeting versions; research publication and reader links appear in Work.",
      meta: [
        ["NEVER PROVES", "that a person actually viewed it"],
        ["ITEM", "MW-011 — readback exists for the routine lane"],
      ],
      dashed: !(f && f.published > 0),
    },
    {
      key: "gates",
      name: "Ask pilot health",
      fig: input.gates ? `${input.gates.passing} of ${input.gates.total}` : null,
      unknown: "NOT PUBLISHED",
      tone: "gold",
      unit: "system-wide READER, TRUTH and FRESHNESS proofs passing",
      note: "These three Ask pilot health contracts are the same in every state. Not yet proven means their required evidence is missing; it does not block sending a hunt or control the hunt's paid-work admission or publication. The actual hunt controls and holds appear in Work, Research and Money.",
      meta: input.gates
        ? [...input.gates.failing.map((w) => ["NOT PASSING", w] as const), ["AUTHORITY", "the pilot health contracts on the published owner snapshot"]]
        : [["AUTHORITY", "the owner snapshot was not read"]],
      dashed: false,
    },
  ];
  return cards;
}

export interface FamilyRow {
  readonly code: string;
  readonly name: string;
  readonly counts: string;
  readonly pill: string;
  readonly tone: "teal" | "cyan" | "gold" | "amber" | "slate";
}

const FAMILY_CODE: Readonly<Record<CapabilityDomain, string>> = {
  "Districts and geography": "GEO",
  "Officials and offices": "GOV",
  "Elections and ballot": "ELE",
  "Campaign finance": "FIN",
  "Meetings and agendas": "MTG",
};

/**
 * The requirement families: the five capability domains, each counted over its
 * gate checks. Only each state's code and capability rows are read, so a grid
 * (the snapshot without its ZIP rows) is enough.
 */
export function familyRows(snapshots: readonly Pick<ReadinessStateSnapshot, "state" | "capabilities">[]): FamilyRow[] {
  return CAPABILITY_DOMAINS.map((domain) => {
    const perState = snapshots.map((s) => {
      const rows = s.capabilities.filter((c) => c.domain === domain);
      const g = gridCounts(rows);
      return { state: s.state.toUpperCase(), g };
    });
    const total = perState.reduce(
      (acc, p) => ({
        cells: acc.cells + p.g.cells,
        current: acc.current + p.g.byState.CURRENT,
        blocked: acc.blocked + p.g.byState.BLOCKED,
        gated: acc.gated + p.g.byState.GATED_ON_OPERATOR,
        walked: acc.walked + (p.g.cells - p.g.byState.NOT_WALKED),
      }),
      { cells: 0, current: 0, blocked: 0, gated: 0, walked: 0 },
    );
    const counts =
      perState.length === 1
        ? `${total.current} of ${total.cells} checks satisfied`
        : perState.map((p) => `${p.state} ${p.g.byState.CURRENT} of ${p.g.cells}`).join(" · ");
    let pill = "WORKING";
    let tone: FamilyRow["tone"] = "teal";
    if (total.gated > 0) {
      pill = "NEEDS YOUR DECISION";
      tone = "amber";
    } else if (total.blocked > 0) {
      pill = "BLOCKED";
      tone = "gold";
    } else if (total.walked === 0) {
      pill = "NOT STARTED";
      tone = "slate";
    } else if (total.current < total.cells) {
      pill = "WORKING";
      tone = "cyan";
    }
    return { code: FAMILY_CODE[domain], name: DOMAIN_WORDS[domain], counts, pill, tone };
  });
}
