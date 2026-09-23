/**
 * **EVERY BODY WE WATCH, AS THE DESIGN DRAWS IT.** (Admin redesign,
 * 2026-09-23 — Fleet · Now, the body list and the opened body.)
 *
 * A body we watch is a public body with a registered meeting source (one
 * routine meeting contract per source and body). For each one this projects
 * the facts the production data plane actually records — its current
 * published version, its last reads, the typed Reader readback, the last 24
 * hours — onto the design's six standing questions:
 *
 * ```
 *   Don't have yet     how many meetings exist that we do not hold: nothing
 *                      measures it, so it is the named unknown
 *   Confirmed right    meetings the last successful read re-confirmed
 *   Has gaps           past meetings in the version we hold with no agenda —
 *                      neither a link nor an attached document
 *   Changed            records added, revised or removed in the last 24 hours
 *   Reader can see     meetings in a version the typed Reader read back
 *   Disagrees          no cross-source check exists: the named unknown
 * ```
 *
 * Nothing here is estimated. A body whose last read failed shows what it
 * last held beside the failure; a body never read says so; a count that
 * cannot be taken is `null` and the page prints its reason. Every sentence is
 * generated from the figures beside it.
 *
 * PURE: rows in, views out; the only clock is `nowIso`.
 */

export type BodyStatus = "WORKING" | "NEEDS ATTENTION" | "STUCK" | "NOT READ YET";
export type ViewTone = "teal" | "gold" | "amber" | "cyan" | "slate" | "stone";
export type FigureTone = "text" | "muted" | "gold" | "amber" | "teal" | "accent";

/** The contract facts the model needs (a structural subset of a meeting partition contract). */
export interface WatchedContract {
  readonly id: string;
  readonly scope: string;
  readonly bodyId: string;
  readonly ocdId: string | null;
  readonly meetingSource: string;
  readonly jurisdiction: string | null;
  readonly publishingOrg: string | null;
  readonly sourceUrl: string | null;
  readonly verifiedAt: string | null;
  readonly cadence: {
    readonly description: string;
    readonly defaultEveryMs: number;
    /** Absent when the cadence never changes. */
    readonly phases?: readonly { readonly through: string; readonly everyMs: number }[];
  };
  readonly retry: { readonly afterMs: number; readonly description: string };
}

export interface VersionFacts {
  readonly scope: string;
  readonly versionId: string;
  readonly promotedAt: string;
  readonly meetings: number;
  readonly fresh: number | null;
  readonly carried: number | null;
  readonly docs: number;
  /** Meetings already held with neither an agenda link nor an attached agenda document. */
  readonly noAgendaLink: number;
  /** Meetings still ahead with no agenda yet: not a gap, agendas post shortly before a sitting. */
  readonly noAgendaAhead: number;
  readonly upcoming: number;
  readonly furthestAhead: string | null;
  readonly bodyName: string | null;
  readonly jurisdiction: string | null;
  readonly outcome: "CHANGED" | "UNCHANGED" | null;
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
  readonly held: number;
}

export interface AttemptFacts {
  readonly scope: string;
  readonly candidateId: string;
  readonly state: string;
  readonly failureCode: string | null;
  readonly failureDetail: string | null;
  readonly acquisitionSucceeded: boolean;
  readonly attemptedAt: string;
}

export interface ReadbackFacts {
  readonly candidateId: string;
  readonly at: string;
  readonly passed: boolean;
}

/** A source's latest version that changed what readers are served, with its own events. */
export interface ChangeFacts {
  readonly scope: string;
  readonly versionId: string;
  readonly retrievedAt: string;
  readonly promotedAt: string | null;
  readonly validatedAt: string | null;
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
  readonly held: number;
  readonly meetingsAdded: number;
  readonly named: readonly { readonly title: string | null; readonly startsAt: string | null }[];
  /** Optional: a reading taken before changed meetings were named. */
  readonly meetingsChanged?: number;
  readonly changedNamed?: readonly { readonly title: string | null; readonly startsAt: string | null }[];
}

export interface DayFacts {
  readonly scope: string;
  readonly reads: number;
  readonly gotIn: number;
  readonly versions: number;
  readonly changedVersions: number;
  /** Reads that got in but found the source listing no meetings. Optional: a reading taken before it was counted. */
  readonly cannotTell?: number;
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
}

export interface BodyStoreFacts {
  readonly asOf: string;
  readonly versions: readonly VersionFacts[];
  readonly attempts: readonly AttemptFacts[];
  readonly readbacks: readonly ReadbackFacts[];
  readonly day: readonly DayFacts[];
  /** Each source's latest changing version; null (or absent, in a reading taken before it was read) when it was not read. */
  readonly changes?: readonly ChangeFacts[] | null;
}

export interface BodyCell {
  readonly key: string;
  readonly label: string;
  readonly value: number | null;
  readonly tone: FigureTone;
  readonly unknown: string;
}

export interface BodyQuestion {
  readonly pill: string;
  readonly tone: ViewTone;
  readonly text: string;
  readonly detail: string;
}

export interface BodyLane {
  readonly name: string;
  readonly pill: string;
  readonly tone: ViewTone;
  readonly counts: string;
  readonly note: string;
}

export interface BodyActivity {
  readonly at: string;
  readonly what: string;
  readonly pill: string;
  readonly tone: ViewTone;
  readonly cost: string;
}

export interface BodyDeadEnd {
  readonly pill: string;
  readonly title: string;
  readonly ruledOut: string | null;
  readonly wouldSettle: string | null;
  readonly whoMoves: string | null;
}

export interface BodyView {
  readonly id: string;
  readonly name: string;
  readonly stateCode: string | null;
  readonly ocdId: string | null;
  readonly status: BodyStatus;
  readonly statusTone: ViewTone;
  readonly summary: string;
  /** At the body's own last read. */
  readonly access: "GOT_IN" | "COULD_NOT" | "NOT_READ";
  readonly cells: readonly BodyCell[];
  readonly questions: readonly BodyQuestion[];
  readonly lanes: readonly BodyLane[];
  readonly schedule: readonly (readonly [string, string])[];
  readonly costs: readonly { readonly pill: string; readonly tone: ViewTone; readonly amount: string; readonly note: string }[];
  readonly deadEnd: BodyDeadEnd | null;
  readonly activity: readonly BodyActivity[];
  readonly escalationNote: string;
  readonly contractIds: readonly string[];
  /** Meetings in the version we hold, or null when nothing was ever published. */
  readonly records: number | null;
  /** Meetings in a version the typed Reader read back. */
  readonly readerVisible: number | null;
  readonly held: number | null;
  readonly noAgendaLink: number | null;
  /** Last 24 hours; null when the body was not read in the window. */
  readonly day: {
    readonly added: number;
    readonly changed: number;
    readonly removed: number;
    readonly reads: number;
    readonly gotIn: number;
    /** Reads that promoted a version with a changed record. */
    readonly changedReads: number;
    /** Reads that promoted a version: with changedReads, the rest confirmed nothing changed. */
    readonly versions: number;
    /** Reads that got in but found the source listing no meetings — they confirm nothing. */
    readonly cannotTell: number;
  } | null;
  readonly lastReadAt: string | null;
  /** The last read that confirmed the data (published or validated) in the seven days read; null when none did. */
  readonly lastSuccessAt: string | null;
  /**
   * Whether a failure to get in cleared by itself, over the reads held (each
   * source's last five in seven days): RECOVERED when a later read got in after
   * one that could not, STILL_FAILING when the latest read could not get in,
   * NO_FAILURE when every read held got in, NOT_READ when none was held.
   */
  readonly recovery: "RECOVERED" | "STILL_FAILING" | "NO_FAILURE" | "NOT_READ";
  /** The version readers are served now: its id, when it was promoted, and the change it carried. */
  readonly current: {
    readonly versionId: string;
    readonly promotedAt: string;
    readonly outcome: "CHANGED" | "UNCHANGED" | null;
    readonly added: number;
    readonly changed: number;
    readonly removed: number;
    readonly held: number;
  } | null;
  /** The typed Reader's readback of that version, when one is recorded. */
  readonly readback: { readonly at: string; readonly passed: boolean } | null;
  /** A ZIP whose readers are served this body, for the public destination. */
  readonly publicZip: string | null;
  /**
   * The latest version that changed what readers are served, with its trail:
   * the source and when it was read, what changed, when it validated and was
   * promoted, and when the typed Reader first read it back — plus the version
   * serving readers now, which re-confirmed it when later reads changed
   * nothing. Null when no change is on record for any of the body's sources,
   * or the store was read without its changes.
   */
  readonly lastChange: {
    readonly versionId: string;
    readonly source: string;
    readonly sourceUrl: string | null;
    readonly retrievedAt: string;
    readonly promotedAt: string | null;
    readonly validatedAt: string | null;
    readonly added: number;
    readonly changed: number;
    readonly removed: number;
    readonly held: number;
    readonly meetingsAdded: number;
    readonly named: readonly { readonly title: string; readonly startsAt: string | null }[];
    readonly meetingsChanged: number;
    readonly changedNamed: readonly { readonly title: string; readonly startsAt: string | null }[];
    /** The first passing readback of that version, else its latest. */
    readonly readback: { readonly at: string; readonly passed: boolean } | null;
    /** The version of the same source readers are served now, and its latest readback. */
    readonly servedNow: {
      readonly versionId: string;
      readonly promotedAt: string;
      readonly readback: { readonly at: string; readonly passed: boolean } | null;
    } | null;
  } | null;
  /** Whether the change history was read at all: false means `lastChange` is unknown, not absent. */
  readonly changeRead: boolean;
}

const DAY_MS = 86_400_000;

function ms(iso: string | null | undefined): number {
  return typeof iso === "string" ? Date.parse(iso) : Number.NaN;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** "Newbury, NH — Planning Board". The source's own words, never a name invented from a slug. */
export function bodyDisplayName(contract: WatchedContract, version: VersionFacts | null): string {
  const where = version?.jurisdiction ?? contract.jurisdiction ?? contract.publishingOrg ?? null;
  const what = version?.bodyName ?? suffixWords(contract.bodyId);
  return where ? `${where} — ${what}` : what;
}

function suffixWords(bodyId: string): string {
  const hash = bodyId.lastIndexOf("#");
  const raw = hash >= 0 ? bodyId.slice(hash + 1) : bodyId;
  const words = raw.replace(/[-_]+/g, " ").trim();
  if (words === "" || words === "governing") return "Governing body";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function stateCodeOf(bodyId: string, ocdId: string | null): string | null {
  const m = /state:([a-z]{2})/.exec(ocdId ?? bodyId) ?? /^curated:([a-z]{2})\//.exec(bodyId);
  return m ? m[1] : null;
}

/** The cadence in force at `atMs`: the first phase not yet past, else the default. */
function cadenceMs(c: WatchedContract, atMs: number): number {
  for (const phase of c.cadence.phases ?? []) if (atMs < ms(phase.through)) return phase.everyMs;
  return c.cadence.defaultEveryMs;
}

const FAILED_STATES = new Set([
  "SOURCE_BLOCKED",
  "PARSE_INVALID",
  "IDENTITY_UNRESOLVED",
  "TEMPORAL_INVALID",
  "SEMANTIC_INVALID",
  "HORIZON_UNRESOLVED",
  "DEPENDENT_CONSUMER_INVALID",
  "CANNOT_TELL",
]);

/** What a candidate state means, in the owner's words. */
/**
 * What a read's state means, in the owner's words. The state is the FIRST
 * validation check that did not pass (`failureStateFor` in
 * lib/civic-data/validate.ts); the failure code narrows it where the code is
 * one this page knows.
 */
export function readStateWords(state: string, failureCode: string | null): string {
  switch (state) {
    case "PROMOTED":
      return "read it and published the new version";
    case "VALIDATED":
      return "read it and every check passed";
    case "NORMALIZED":
      return "read it and put it in standard form";
    case "FETCHED":
      return "fetched it";
    case "SOURCE_BLOCKED":
      return failureCode === "SOURCE_RETRIEVAL_FAILED" ? "could not get in: the site refused or failed the request" : "could not get in";
    case "PARSE_INVALID":
      return "got in but could not read the page";
    case "IDENTITY_UNRESOLVED":
      return "got in but could not tell which body a record belongs to";
    case "TEMPORAL_INVALID":
      return "got in but a date or time failed its check";
    case "SEMANTIC_INVALID":
      return "got in but a record failed its meaning check";
    case "HORIZON_UNRESOLVED":
      return "got in but could not tell how far ahead the source publishes";
    case "DEPENDENT_CONSUMER_INVALID":
      return "got in but the reader's view of it failed its check";
    case "CANNOT_TELL":
      /* The absence check: a zero without bounded evidence is not proof of none. */
      return failureCode === "ZERO_IS_NOT_ABSENCE" || failureCode === null
        ? "got in, but the source listed no meetings — and a zero is not proof there are none, so nothing was published"
        : "got in, but the source's evidence that it has no meetings was incomplete, so nothing was published";
    default:
      return `ended ${state.toLowerCase()}`;
  }
}

/** What would settle a failed read: the rule the failing check states, never a guess. */
function wouldSettleWords(state: string, failureCode: string | null, source: string, url: string | null): string {
  const where = url ?? `the ${source}`;
  if (state === "CANNOT_TELL") {
    return `A meeting listed at ${where}, or bounded evidence that the body publishes none there (a complete calendar for a stated period, or an official statement).`;
  }
  if (state === "SOURCE_BLOCKED") return `A read of ${where} that the site answers.`;
  if (state === "PARSE_INVALID") return `A page at ${where} the adapter can read — if the page changed shape, the adapter has to change with it.`;
  return `A read of ${where} whose records pass the ${failureCode ?? state.toLowerCase().replace(/_/g, " ")} check.`;
}

function sourceWords(source: string): string {
  const s = source.toLowerCase();
  const known: Record<string, string> = {
    ical: "calendar feed",
    legistar: "Legistar meeting portal",
    "legistar-insite": "Legistar InSite portal",
    diligent: "Diligent board portal",
    civicplus: "CivicPlus agenda centre",
    clerksboards: "clerk's board page",
    civicclerk: "CivicClerk portal",
    apptegy: "district website",
    onbase: "OnBase agenda site",
    revize: "town website",
    iqm2: "IQM2 portal",
    schedulepage: "schedule page",
  };
  return known[s] ?? `${source} source`;
}

function titled(meetings: readonly { readonly title: string | null; readonly startsAt: string | null }[]): { readonly title: string; readonly startsAt: string | null }[] {
  return meetings.flatMap((m) => (m.title === null ? [] : [{ title: m.title, startsAt: m.startsAt }]));
}

function lastChangeOf(c: WatchedContract, f: ChangeFacts, l: Lookups): NonNullable<BodyView["lastChange"]> {
  const first = l.firstPassByCandidate.get(f.versionId) ?? l.readbackByCandidate.get(f.versionId) ?? null;
  const now = l.versionByScope.get(c.scope) ?? null;
  const nowReadback = now ? l.readbackByCandidate.get(now.versionId) ?? null : null;
  return {
    versionId: f.versionId,
    source: sourceWords(c.meetingSource),
    sourceUrl: c.sourceUrl,
    retrievedAt: f.retrievedAt,
    promotedAt: f.promotedAt,
    validatedAt: f.validatedAt,
    added: f.added,
    changed: f.changed,
    removed: f.removed,
    held: f.held,
    meetingsAdded: f.meetingsAdded,
    named: titled(f.named),
    meetingsChanged: f.meetingsChanged ?? 0,
    changedNamed: titled(f.changedNamed ?? []),
    readback: first ? { at: first.at, passed: first.passed } : null,
    servedNow: now ? { versionId: now.versionId, promotedAt: now.promotedAt, readback: nowReadback ? { at: nowReadback.at, passed: nowReadback.passed } : null } : null,
  };
}

interface BodyGroup {
  readonly bodyId: string;
  readonly contracts: WatchedContract[];
}

export interface BodyModelInput {
  readonly contracts: readonly WatchedContract[];
  readonly store: BodyStoreFacts;
  readonly nowIso: string;
  /** A ZIP whose readers are served this body's division, for the public destination; absent when not known. */
  readonly zipOf?: (ocdId: string | null) => string | null;
}

/** Every watched body, in the order the page lists them: needing attention first, then by name. */
export function buildBodyViews(input: BodyModelInput): BodyView[] {
  const nowMs = ms(input.nowIso);
  const versionByScope = new Map(input.store.versions.map((v) => [v.scope, v]));
  const dayByScope = new Map(input.store.day.map((d) => [d.scope, d]));
  const attemptsByScope = new Map<string, AttemptFacts[]>();
  for (const a of input.store.attempts) {
    const list = attemptsByScope.get(a.scope) ?? [];
    list.push(a);
    attemptsByScope.set(a.scope, list);
  }
  for (const list of attemptsByScope.values()) list.sort((x, y) => ms(y.attemptedAt) - ms(x.attemptedAt));
  const readbackByCandidate = new Map<string, ReadbackFacts>();
  const firstPassByCandidate = new Map<string, ReadbackFacts>();
  for (const r of input.store.readbacks) {
    const held = readbackByCandidate.get(r.candidateId);
    if (!held || ms(held.at) < ms(r.at)) readbackByCandidate.set(r.candidateId, r);
    const first = firstPassByCandidate.get(r.candidateId);
    if (r.passed && (!first || ms(r.at) < ms(first.at))) firstPassByCandidate.set(r.candidateId, r);
  }
  const changeRead = Array.isArray(input.store.changes);
  const changeByScope = new Map((input.store.changes ?? []).map((c) => [c.scope, c]));

  const groups = new Map<string, BodyGroup>();
  for (const c of input.contracts) {
    const g = groups.get(c.bodyId) ?? { bodyId: c.bodyId, contracts: [] };
    g.contracts.push(c);
    groups.set(c.bodyId, g);
  }

  const views = [...groups.values()].map((g) =>
    bodyView(g, { versionByScope, dayByScope, attemptsByScope, readbackByCandidate, firstPassByCandidate, changeByScope, changeRead, nowMs, zipOf: input.zipOf ?? (() => null) }),
  );
  const order: Record<BodyStatus, number> = { STUCK: 0, "NEEDS ATTENTION": 1, "NOT READ YET": 2, WORKING: 3 };
  return views.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
}

interface Lookups {
  readonly versionByScope: ReadonlyMap<string, VersionFacts>;
  readonly dayByScope: ReadonlyMap<string, DayFacts>;
  readonly zipOf: (ocdId: string | null) => string | null;
  readonly attemptsByScope: ReadonlyMap<string, readonly AttemptFacts[]>;
  readonly readbackByCandidate: ReadonlyMap<string, ReadbackFacts>;
  readonly firstPassByCandidate: ReadonlyMap<string, ReadbackFacts>;
  readonly changeByScope: ReadonlyMap<string, ChangeFacts>;
  readonly changeRead: boolean;
  readonly nowMs: number;
}

function bodyView(g: BodyGroup, l: Lookups): BodyView {
  /*
   * A body read through two sources is one body (MW-003). Its standing is
   * taken from the contract holding the newest published version, and the
   * reads and the day are the union of both.
   */
  const withVersion = g.contracts
    .map((c) => ({ c, v: l.versionByScope.get(c.scope) ?? null }))
    .sort((a, b) => ms(b.v?.promotedAt) - ms(a.v?.promotedAt) || a.c.id.localeCompare(b.c.id));
  const primary = withVersion[0];
  const contract = primary.c;
  const version = primary.v;
  const attempts = g.contracts.flatMap((c) => l.attemptsByScope.get(c.scope) ?? []).sort((x, y) => ms(y.attemptedAt) - ms(x.attemptedAt));
  const last = attempts[0] ?? null;
  const lastSuccess = attempts.find((a) => a.acquisitionSucceeded) ?? null;
  const days = g.contracts.map((c) => l.dayByScope.get(c.scope)).filter((d): d is DayFacts => d !== undefined);
  const day =
    days.length === 0
      ? null
      : days.reduce(
          (acc, d) => ({
            added: acc.added + d.added,
            changed: acc.changed + d.changed,
            removed: acc.removed + d.removed,
            reads: acc.reads + d.reads,
            gotIn: acc.gotIn + d.gotIn,
            changedReads: acc.changedReads + d.changedVersions,
            versions: acc.versions + d.versions,
            cannotTell: acc.cannotTell + (d.cannotTell ?? 0),
          }),
          { added: 0, changed: 0, removed: 0, reads: 0, gotIn: 0, changedReads: 0, versions: 0, cannotTell: 0 },
        );
  const readback = version ? l.readbackByCandidate.get(version.versionId) ?? null : null;
  // Across the body's sources, the newest version that changed something readers are served.
  const change =
    g.contracts
      .flatMap((c) => {
        const f = l.changeByScope.get(c.scope);
        return f === undefined ? [] : [{ c, f }];
      })
      .sort((a, b) => ms(b.f.retrievedAt) - ms(a.f.retrievedAt))[0] ?? null;
  const name = bodyDisplayName(contract, version);
  const stateCode = stateCodeOf(g.bodyId, contract.ocdId);

  const lastFailed = last !== null && (!last.acquisitionSucceeded || FAILED_STATES.has(last.state));
  const access: BodyView["access"] = last === null ? "NOT_READ" : last.acquisitionSucceeded ? "GOT_IN" : "COULD_NOT";

  let status: BodyStatus;
  if (last === null && version === null) status = "NOT READ YET";
  else if (version === null) status = "STUCK";
  else if (lastFailed || readback === null || !readback.passed) status = "NEEDS ATTENTION";
  else status = "WORKING";
  const statusTone: ViewTone = status === "WORKING" ? "teal" : status === "STUCK" ? "amber" : status === "NOT READ YET" ? "slate" : "gold";

  const records = version ? version.meetings : null;
  const readerVisible = version && readback?.passed ? version.meetings : null;
  const source = sourceWords(contract.meetingSource);

  /* ---------------------------------------------------------------- summary */
  const parts: string[] = [];
  if (last === null) {
    parts.push(`No read of its ${source} is recorded in the last seven days.`);
  } else {
    parts.push(`Last read ${readStateWords(last.state, last.failureCode)}.`);
  }
  if (version) {
    parts.push(
      `The version we hold lists ${plural(version.meetings, "meeting")}${version.upcoming > 0 ? `, ${plural(version.upcoming, "still ahead", "still ahead")}` : ""}.`,
    );
    if (readback?.passed) parts.push("A reader can open it: the typed Reader read that version back.");
    else if (readback) parts.push("The typed Reader's readback of that version failed, so whether a reader can open it is not confirmed.");
    else parts.push("No readback of that version is recorded, so whether a reader can open it is not confirmed.");
  } else if (last !== null) {
    parts.push("Nothing from this body has ever been published for a reader.");
  }
  if (day && day.added + day.changed + day.removed > 0) {
    parts.push(`In the last 24 hours: ${plural(day.added, "record")} added, ${day.changed.toLocaleString("en-US")} revised, ${day.removed.toLocaleString("en-US")} removed.`);
  }
  const summary = parts.join(" ");

  /* ---------------------------------------------------------------- the six cells */
  const cells: BodyCell[] = [
    { key: "missing", label: "Don't have yet", value: null, tone: "text", unknown: "NOT MEASURED" },
    {
      key: "confirmed",
      label: "Confirmed right",
      value: version && version.fresh !== null && !lastFailed ? version.fresh : null,
      tone: "text",
      unknown: version ? "NOT CONFIRMED" : "NOTHING HELD",
    },
    {
      key: "gaps",
      label: "Has gaps",
      value: version ? version.noAgendaLink : null,
      tone: version && version.noAgendaLink > 0 ? "gold" : "text",
      unknown: "NOTHING HELD",
    },
    {
      key: "changed",
      label: "Changed",
      value: day ? day.added + day.changed + day.removed : null,
      tone: "text",
      unknown: "NOT READ IN 24H",
    },
    { key: "reader", label: "Reader can see", value: readerVisible, tone: "text", unknown: version ? "NOT READ BACK" : "NOTHING PUBLISHED" },
    { key: "disagrees", label: "Disagrees", value: null, tone: "text", unknown: "NOT CHECKED" },
  ];

  /* ---------------------------------------------------------------- the six questions */
  const questions: BodyQuestion[] = [
    {
      pill: "CAN'T TELL",
      tone: "gold",
      text: "Do we have this record at all?",
      detail: version
        ? `${plural(version.meetings, "meeting")} held; how many exist that we do not hold is not measured`
        : "nothing held; how many meetings exist is not measured",
    },
    lastFailed || !version
      ? {
          pill: "CAN'T TELL",
          tone: "gold",
          text: "Is what we hold still correct?",
          detail: last ? `the last read ${readStateWords(last.state, last.failureCode)}` : "not read in seven days",
        }
      : {
          pill: "UP TO DATE",
          tone: "teal",
          text: "Is what we hold still correct?",
          detail:
            version.fresh !== null
              ? `${version.fresh} of ${version.meetings} re-confirmed at the last read`
              : "confirmed at the last read",
        },
    version && version.noAgendaLink > 0
      ? {
          pill: "HAS GAPS",
          tone: "gold",
          text: "Is anything missing from the record we hold?",
          detail: `${plural(version.noAgendaLink, "past meeting")} carry no agenda${version.noAgendaAhead > 0 ? `; ${version.noAgendaAhead} ahead have none yet` : ""}${version.held > 0 ? `; ${version.held} held back by a check` : ""}`,
        }
      : {
          pill: version ? "UP TO DATE" : "NOT STARTED",
          tone: version ? "teal" : "slate",
          text: "Is anything missing from the record we hold?",
          detail: version ? `every past meeting carries an agenda${version.noAgendaAhead > 0 ? `; ${version.noAgendaAhead} ahead have none yet` : ""}${version.held > 0 ? `; ${version.held} held back by a check` : ""}` : "nothing held",
        },
    day === null
      ? { pill: "CAN'T TELL", tone: "gold", text: "Has it changed since we last looked?", detail: "not read in the last 24 hours" }
      : {
          pill: "UP TO DATE",
          tone: "teal",
          text: "Has it changed since we last looked?",
          detail: `${day.added} added, ${day.changed} revised, ${day.removed} removed in 24 hours`,
        },
    !version
      ? { pill: "NOT STARTED", tone: "slate", text: "Can a reader actually see it?", detail: "nothing published" }
      : readback?.passed
        ? { pill: "CONFIRMED", tone: "teal", text: "Can a reader actually see it?", detail: "the typed Reader read the version back" }
        : { pill: "CAN'T TELL", tone: "gold", text: "Can a reader actually see it?", detail: readback ? "the readback failed" : "no readback recorded" },
    { pill: "NOT CHECKED", tone: "slate", text: "Is it consistent with what we hold elsewhere?", detail: "no cross-source check exists for meetings" },
  ];

  /* ---------------------------------------------------------------- lanes */
  const lanes: BodyLane[] = [
    {
      name: "Discovery",
      pill: "IDLE",
      tone: "slate",
      counts: `${g.contracts.length} ${g.contracts.length === 1 ? "source" : "sources"} known`,
      note: `A way in is recorded (${source}), so nothing is left to discover about where this body publishes.`,
    },
    {
      name: "Acquisition",
      pill: last === null ? "NOT READ" : lastFailed && !last.acquisitionSucceeded ? "RETRYING" : "RUNNING",
      tone: last === null ? "slate" : lastFailed && !last.acquisitionSucceeded ? "amber" : "teal",
      counts: day ? `${day.gotIn} of ${day.reads} reads got in · 24h` : "no reads in 24h",
      note: `Runs on the standing runner's clock (${contract.cadence.description}); a failed read is retried ${contract.retry.description}.`,
    },
    {
      name: "Validation",
      pill: last === null ? "IDLE" : FAILED_STATES.has(last.state) && last.acquisitionSucceeded ? "BLOCKED" : "PASSED",
      tone: last === null ? "slate" : FAILED_STATES.has(last.state) && last.acquisitionSucceeded ? "amber" : "teal",
      counts: version ? `${version.held} held back` : "nothing published",
      note: "Every record is checked before it is published; a record that fails a check is held back, never promoted.",
    },
  ];

  /* ---------------------------------------------------------------- when we look */
  const lastLook = last ? `${fmt(last.attemptedAt)} — ${last.acquisitionSucceeded && !lastFailed ? "worked" : readStateWords(last.state, last.failureCode)}` : "No read in the last seven days";
  let nextLook: string;
  if (last === null) nextLook = "Whenever the runner next reaches it — no read is recorded to count from";
  else if (lastFailed) nextLook = `Due ${fmt(new Date(ms(last.attemptedAt) + contract.retry.afterMs).toISOString())} — the retry after a failed read`;
  else {
    const from = lastSuccess ?? last;
    nextLook = `Due ${fmt(new Date(ms(from.attemptedAt) + cadenceMs(contract, l.nowMs)).toISOString())}`;
  }
  const furthest = version?.furthestAhead ? Math.round((ms(version.furthestAhead) - l.nowMs) / DAY_MS) : null;
  const schedule: [string, string][] = [
    ["Last look", lastLook],
    ["Next look", nextLook],
    ["How often", cap(contract.cadence.description)],
    ["Reads that got in", day ? `${day.gotIn} of ${day.reads} in the last 24 hours` : "None in the last 24 hours"],
    [
      "Publishes ahead",
      version === null
        ? "Unknown — nothing has been read from this source"
        : furthest === null
          ? "Lists no dated meeting"
          : furthest >= 0
            ? `Lists meetings through ${fmtDate(version.furthestAhead)} — ${furthest} days ahead`
            : `Lists nothing ahead — its latest meeting was ${fmtDate(version.furthestAhead)}`,
    ],
  ];

  const costs = [
    {
      pill: "FREE",
      tone: "slate" as ViewTone,
      amount: day ? `${plural(day.reads, "read")} · 24h` : "no reads · 24h",
      note: "Meeting reads run plain code on a known route; they never reach a paid model. Their time and requests are real, and are not dollars.",
    },
    {
      pill: "PAID",
      tone: "cyan" as ViewTone,
      amount: "none",
      note: "No paid model work runs on this lane. The database and host it uses are shared with the whole site and are not split per body.",
    },
  ];

  /* ---------------------------------------------------------------- dead end */
  let deadEnd: BodyDeadEnd | null = null;
  if (last !== null && lastFailed) {
    deadEnd = {
      pill: version ? "LAST READ FAILED" : "CANNOT FINISH",
      title: `The last read ${readStateWords(last.state, last.failureCode)}${last.failureDetail ? ` — ${last.failureDetail}` : ""}`,
      ruledOut: null,
      wouldSettle: wouldSettleWords(last.state, last.failureCode, source, contract.sourceUrl),
      whoMoves: `The runner reads it again on its clock (${contract.retry.description} after a failure)${version ? "; the last good version keeps serving meanwhile" : ""}. Nothing else is scheduled to change it.`,
    };
  }

  /* ---------------------------------------------------------------- activity */
  const activity: BodyActivity[] = attempts.slice(0, 5).map((a) => ({
    at: a.attemptedAt,
    what: `Read the ${source} — ${readStateWords(a.state, a.failureCode)}`,
    pill: "NO AI NEEDED",
    tone: "slate",
    cost: "no cost",
  }));

  return {
    id: g.bodyId,
    name,
    stateCode,
    ocdId: contract.ocdId,
    status,
    statusTone,
    summary,
    access,
    cells,
    questions,
    lanes,
    schedule,
    costs,
    deadEnd,
    activity,
    escalationNote: "No model runs on this lane, so nothing here escalates; a failed read records its state and is retried on the clock.",
    contractIds: g.contracts.map((c) => c.id),
    records,
    readerVisible,
    held: version ? version.held : null,
    noAgendaLink: version ? version.noAgendaLink : null,
    day,
    lastReadAt: last?.attemptedAt ?? null,
    lastSuccessAt: attempts.find((a) => a.state === "PROMOTED" || a.state === "VALIDATED")?.attemptedAt ?? null,
    current: version
      ? { versionId: version.versionId, promotedAt: version.promotedAt, outcome: version.outcome, added: version.added, changed: version.changed, removed: version.removed, held: version.held }
      : null,
    readback: readback ? { at: readback.at, passed: readback.passed } : null,
    publicZip: l.zipOf(contract.ocdId),
    lastChange: change === null ? null : lastChangeOf(change.c, change.f, l),
    changeRead: l.changeRead,
    recovery:
      last === null
        ? "NOT_READ"
        : !last.acquisitionSucceeded
          ? "STILL_FAILING"
          : attempts.some((a) => !a.acquisitionSucceeded)
            ? "RECOVERED"
            : "NO_FAILURE",
  };
}

function cap(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

const FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const FMT_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });

function fmt(iso: string | null | undefined): string {
  const t = ms(iso);
  return Number.isFinite(t) ? `${FMT.format(new Date(t))} ET` : "at no recorded time";
}
function fmtDate(iso: string | null | undefined): string {
  const t = ms(iso);
  return Number.isFinite(t) ? FMT_DATE.format(new Date(t)) : "no recorded date";
}

/* ==================================================================== *
 * THE THREE CARDS AT THE TOP OF FLEET · NOW
 * ==================================================================== */

export interface NowFigures {
  readonly bodies: number;
  readonly gotIn: number;
  readonly couldNot: number;
  readonly notRead: number;
  /** Records added / revised / removed across the scope in 24 hours. Null when no body in scope was read. */
  readonly day: { readonly added: number; readonly changed: number; readonly removed: number; readonly bodiesRead: number } | null;
  /** The share of revisions carried by the three bodies with the most, so the page can say where they concentrate. */
  readonly revisionsTopThree: { readonly count: number; readonly bodies: readonly string[] } | null;
  readonly records: number;
  readonly readerVisible: number;
  readonly held: number;
  readonly noAgendaLink: number;
  /** Bodies whose last read failed: their counts are what they last held, so every total over them is a floor. */
  readonly floor: boolean;
}

export function nowFigures(views: readonly BodyView[]): NowFigures {
  const read = views.filter((v) => v.day !== null);
  const day =
    read.length === 0
      ? null
      : read.reduce(
          (acc, v) => ({ added: acc.added + v.day!.added, changed: acc.changed + v.day!.changed, removed: acc.removed + v.day!.removed, bodiesRead: acc.bodiesRead + 1 }),
          { added: 0, changed: 0, removed: 0, bodiesRead: 0 },
        );
  const byRevisions = [...read].sort((a, b) => b.day!.changed - a.day!.changed).slice(0, 3).filter((v) => v.day!.changed > 0);
  return {
    bodies: views.length,
    gotIn: views.filter((v) => v.access === "GOT_IN").length,
    couldNot: views.filter((v) => v.access === "COULD_NOT").length,
    notRead: views.filter((v) => v.access === "NOT_READ").length,
    day,
    revisionsTopThree:
      byRevisions.length === 0 ? null : { count: byRevisions.reduce((n, v) => n + v.day!.changed, 0), bodies: byRevisions.map((v) => v.name) },
    records: views.reduce((n, v) => n + (v.records ?? 0), 0),
    readerVisible: views.reduce((n, v) => n + (v.readerVisible ?? 0), 0),
    held: views.reduce((n, v) => n + (v.held ?? 0), 0),
    noAgendaLink: views.reduce((n, v) => n + (v.noAgendaLink ?? 0), 0),
    floor: views.some((v) => v.access !== "GOT_IN"),
  };
}
