/**
 * **KEEPS AN OPEN PAGE'S SECTIONS IN STEP WITH WHAT THE BACKEND CAN SERVE.**
 *
 * Driven only by the existing pulse loop (`useLiveConnection` hands every good
 * pulse to `onPulse`). There is no second polling loop and no per-card timer.
 *
 *   not announced          "waiting for the backend" (recoverable, never zero)
 *   announced, new/moved   fetch that one section for the current scope
 *   200 + right contract   live data replaces whatever was shown
 *   401 / 403              access denied: shown, NOT retried until the next
 *                          announcement change or scope change
 *   contract mismatch/409  incompatible version: shown, not retried
 *   network / 404 / 5xx    temporary failure: last good data kept (stale), up to
 *                          3 retries at 2 s, 8 s, 30 s, then wait for the next
 *                          revision change
 *
 * One read per section in flight at a time; a later request supersedes an
 * earlier one, and a response for an old scope or an older request is dropped.
 * Changing scope clears data that belonged to the old scope, so an old headline
 * can never sit on new rows. It never sends an action.
 *
 * PURE apart from the injected fetch and timer.
 */
import { capabilitiesOf, PAGE_LIMIT, PAGED_SECTIONS, sectionContract, SECTION_IDS, type SectionId, type SectionPage, type V6Capabilities } from "./contract.ts";
import type { Dependency, Sourced } from "./model.ts";

export type SyncFetch = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;
export type Schedule = (fn: () => void, ms: number) => () => void;

export const RETRY_DELAYS_MS: readonly number[] = [2_000, 8_000, 30_000];

export interface SectionState {
  readonly phase: "waiting" | "loading" | "live" | "denied" | "incompatible" | "failed";
  readonly data: unknown;
  readonly asOf: string | null;
  readonly revision: string | null;
  readonly missingParts: readonly string[];
  readonly attempts: number;
  readonly page?: SectionPage | null;
}

const WAITING: SectionState = { phase: "waiting", data: null, asOf: null, revision: null, missingParts: [], attempts: 0, page: null };

interface Slot {
  state: SectionState;
  /** Announcement revision the current data (or in-flight read) answers. */
  wanted: string | null;
  seq: number;
  inFlight: AbortController | null;
  retry: (() => void) | null;
  gaveUpAt: string | null;
  /** Server-side search, filters and cursor for a paged section. */
  params: Readonly<Record<string, string>>;
}

export class LiveSync {
  private scope: string;
  private caps: V6Capabilities | null = null;
  private lastRevision: string | null = null;
  private readonly slots = new Map<SectionId, Slot>();
  private readonly listeners = new Set<() => void>();
  private snapshotCache: Readonly<Record<SectionId, SectionState>> | null = null;

  private readonly opts: { readonly scope: string; readonly fetch: SyncFetch; readonly schedule: Schedule };

  constructor(opts: { readonly scope: string; readonly fetch: SyncFetch; readonly schedule: Schedule }) {
    this.opts = opts;
    this.scope = opts.scope;
    for (const id of SECTION_IDS) this.slots.set(id, { state: WAITING, wanted: null, seq: 0, inFlight: null, retry: null, gaveUpAt: null, params: {} });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): Readonly<Record<SectionId, SectionState>> {
    if (!this.snapshotCache) this.snapshotCache = Object.fromEntries([...this.slots].map(([k, v]) => [k, v.state])) as Record<SectionId, SectionState>;
    return this.snapshotCache;
  }

  capabilities(): V6Capabilities | null {
    return this.caps;
  }

  /** The latest pulse revision: the state an action rendered from this page quotes. */
  revision(): string | null {
    return this.lastRevision;
  }

  /** How many section reads are in flight right now (for tests). */
  inFlight(): number {
    return [...this.slots.values()].filter((s) => s.inFlight !== null).length;
  }

  private emit() {
    this.snapshotCache = null;
    for (const fn of this.listeners) fn();
  }

  private set(id: SectionId, next: Partial<SectionState>) {
    const slot = this.slots.get(id)!;
    slot.state = { ...slot.state, ...next };
  }

  /** A new scope: drop the old scope's data and read every announced section again. */
  setScope(scope: string) {
    if (scope === this.scope) return;
    this.scope = scope;
    for (const [id, slot] of this.slots) {
      slot.inFlight?.abort();
      slot.inFlight = null;
      slot.retry?.();
      slot.retry = null;
      slot.wanted = null;
      slot.gaveUpAt = null;
      slot.params = {};
      slot.state = WAITING;
      if (this.caps?.sections[id]) this.read(id);
    }
    this.emit();
  }

  /**
   * Server-side search, filters or a cursor for one paged section. Reads that
   * one window again; the rest of the population is never fetched.
   */
  setParams(id: SectionId, params: Readonly<Record<string, string>>) {
    const slot = this.slots.get(id)!;
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== ""));
    if (JSON.stringify(clean) === JSON.stringify(slot.params)) return;
    slot.params = clean;
    if (this.caps?.sections[id]) { this.read(id); this.emit(); }
  }

  /** Every successful pulse. Reads only what is announced and has moved. */
  onPulse(pulse: unknown) {
    const rev = (pulse as { revision?: unknown } | null)?.revision;
    this.lastRevision = typeof rev === "string" ? rev : null;
    const caps = capabilitiesOf(pulse);
    this.caps = caps;
    let changed = false;
    for (const [id, slot] of this.slots) {
      const a = caps?.sections[id];
      if (!a) {
        // Withdrawn: keep last good data but say it is no longer being served.
        if (slot.state.phase !== "waiting" && slot.wanted !== null) {
          slot.inFlight?.abort();
          slot.inFlight = null;
          slot.wanted = null;
          this.set(id, { phase: slot.state.data === null ? "waiting" : "failed" });
          changed = true;
        }
        continue;
      }
      if (a.contract !== sectionContract(id)) {
        if (slot.state.phase !== "incompatible") { this.set(id, { phase: "incompatible" }); changed = true; }
        slot.wanted = a.revision;
        continue;
      }
      const moved = slot.wanted !== a.revision;
      if (moved) {
        slot.gaveUpAt = null;
        this.read(id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /** After a lost connection comes back: read every announced section once more. */
  catchUp() {
    for (const [id, slot] of this.slots) {
      if (this.caps?.sections[id] && slot.inFlight === null && slot.state.phase !== "denied" && slot.state.phase !== "incompatible") this.read(id);
    }
    this.emit();
  }

  private read(id: SectionId) {
    const a = this.caps?.sections[id];
    const slot = this.slots.get(id)!;
    if (!a) return;
    slot.retry?.();
    slot.retry = null;
    slot.inFlight?.abort();
    const ctrl = typeof AbortController === "undefined" ? null : new AbortController();
    slot.inFlight = ctrl ?? ({ abort() {} } as AbortController);
    slot.wanted = a.revision;
    const seq = ++slot.seq;
    const scope = this.scope;
    if (slot.state.data === null) this.set(id, { phase: "loading" });
    const q = new URLSearchParams({ scope });
    if (PAGED_SECTIONS.includes(id)) q.set("limit", String(PAGE_LIMIT));
    for (const [k, v] of Object.entries(slot.params)) if (k !== "scope" && k !== "limit") q.set(k, v);
    const url = `${a.href}${a.href.includes("?") ? "&" : "?"}${q.toString()}`;
    void this.opts.fetch(url, { headers: { accept: "application/json" }, signal: ctrl?.signal })
      .then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }))
      .then(({ status, body }) => this.settle(id, seq, scope, status, body))
      .catch(() => this.settle(id, seq, scope, null, null));
  }

  private settle(id: SectionId, seq: number, scope: string, status: number | null, body: unknown) {
    const slot = this.slots.get(id)!;
    if (seq !== slot.seq || scope !== this.scope) return; // superseded or old scope
    slot.inFlight = null;
    if (status === 401 || status === 403) {
      this.set(id, { phase: "denied", attempts: 0 });
      this.emit();
      return;
    }
    const r = body as { contract?: unknown; scope?: unknown; revision?: unknown; asOf?: unknown; data?: unknown; missingParts?: unknown; page?: unknown } | null;
    if (status === 409 || (status === 200 && r && typeof r.contract === "string" && r.contract !== sectionContract(id))) {
      this.set(id, { phase: "incompatible", attempts: 0 });
      this.emit();
      return;
    }
    if (status === 200 && r && r.contract === sectionContract(id) && r.scope === scope && "data" in r) {
      this.set(id, {
        phase: "live",
        data: r.data ?? null,
        asOf: typeof r.asOf === "string" ? r.asOf : null,
        revision: typeof r.revision === "string" ? r.revision : slot.wanted,
        missingParts: Array.isArray(r.missingParts) ? r.missingParts.filter((x): x is string => typeof x === "string") : [],
        attempts: 0,
        page: pageOf(r.page),
      });
      this.emit();
      return;
    }
    // Temporary failure: keep last good data, retry a bounded number of times.
    const attempts = slot.state.attempts + 1;
    this.set(id, { phase: "failed", attempts });
    if (attempts <= RETRY_DELAYS_MS.length) {
      slot.retry = this.opts.schedule(() => { slot.retry = null; if (scope === this.scope) this.read(id); }, RETRY_DELAYS_MS[attempts - 1]);
    } else {
      slot.gaveUpAt = new Date().toISOString();
    }
    this.emit();
  }

  dispose() {
    for (const slot of this.slots.values()) {
      slot.inFlight?.abort();
      slot.retry?.();
    }
    this.listeners.clear();
  }
}

function pageOf(raw: unknown): SectionPage | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as { total?: unknown; nextCursor?: unknown; prevCursor?: unknown };
  return {
    total: typeof p.total === "number" && Number.isFinite(p.total) ? p.total : null,
    nextCursor: typeof p.nextCursor === "string" && p.nextCursor ? p.nextCursor : null,
    prevCursor: typeof p.prevCursor === "string" && p.prevCursor ? p.prevCursor : null,
  };
}

export const WAITING_DEP_SUFFIX = " This part turns on by itself as soon as the backend offers it. You don’t need to reload or change anything.";

/** Turn a section's sync state into what the screens read. */
export function toSourced<T>(state: SectionState, dep: Dependency, fallback: T | null = null): Sourced<T> {
  switch (state.phase) {
    case "live":
      return { state: "live", load: state.missingParts.length ? "partial" : "ready", data: state.data as T, asOf: state.asOf, missingParts: state.missingParts, ...(state.page ? { page: state.page } : {}) };
    case "loading":
      return { state: "live", load: "loading", data: fallback, asOf: null };
    case "failed":
      return state.data !== null
        ? { state: "live", load: "failed", data: state.data as T, asOf: state.asOf, problem: "failed" }
        : { state: "not-connected", load: "failed", data: fallback, asOf: null, dependency: dep, problem: "failed" };
    case "denied":
      return { state: "not-connected", load: "failed", data: null, asOf: null, dependency: dep, problem: "denied" };
    case "incompatible":
      return { state: "not-connected", load: "failed", data: state.data as T | null ?? fallback, asOf: state.asOf, dependency: dep, problem: "incompatible" };
    case "waiting":
    default:
      return { state: "not-connected", load: "ready", data: fallback, asOf: null, dependency: dep, problem: "waiting" };
  }
}
