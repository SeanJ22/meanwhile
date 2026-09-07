/**
 * **WHAT THE READINESS PANEL READS.** (State Readiness Control Panel, 2026-09-03.)
 *
 * Server-side only. The panel reads a published `ReadinessStateSnapshot` and
 * nothing else — the same discipline as `lib/control-plane/admin-data.ts`: a
 * Netlify standalone bundle cannot read the filesystem or the reader stores, so a
 * publisher WROTE the snapshot to the control plane and this reads it back.
 *
 * Three honest answers, never two collapsed into one:
 *   HELD          the snapshot exists and this is it
 *   NOT_RECORDED  the store is reachable and holds no snapshot for this state yet
 *   UNAVAILABLE   the control plane is not configured, or we could not reach it
 *
 * NOT_RECORDED and UNAVAILABLE are different facts — "this state has not been
 * walked" versus "we could not ask whether it has" — and only one is about the
 * state. This reader is a pure READ: it never writes readiness state, so no admin
 * route can. The panel's on-demand recompute is the publisher script, not a button.
 */
import {
  CONTROL_PLANE_URL_VAR,
  controlPlaneUrlFromEnv,
  createPgRepositories,
} from "../repository/pg-store.ts";
import { assertDurableRepositories } from "../repository/types.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { CAPABILITY_TAXONOMY, US_STATES, stateEntry } from "./catalog.ts";
import { type CapabilityInput, emptyStateSnapshot } from "./compute.ts";
import { READINESS_DERIVATION_CONTRACT, type ReadinessStateSnapshot } from "./model.ts";

export type ReadinessReadOutcome =
  | { readonly kind: "HELD"; readonly snapshot: ReadinessStateSnapshot; readonly source: string }
  | { readonly kind: "NOT_RECORDED"; readonly detail: string; readonly source: string }
  /**
   * A snapshot exists but was produced under a SUPERSEDED derivation contract
   * (CC-F6) — a legacy hand-authored record still at rest in production. It is
   * quarantined: its old cells are never trusted, and it renders "REQUIRES
   * REPUBLISH" until the instrument-derived publisher overwrites it. A pure
   * read: production is never contacted-for-write or mutated.
   */
  | {
      readonly kind: "REQUIRES_REPUBLISH";
      readonly detail: string;
      readonly source: string;
      readonly snapshotContract: string | null;
      /** The current contract, so the page can show what the record must become. */
      readonly currentContract: string;
      /**
       * What IS on record about the quarantined snapshot (ADM-1, 9.4.26): its
       * publish time, publisher and SHA, and the store's own revision and
       * write time. Its CELLS are still never rendered; these are facts about
       * the record, and they are what tells the operator whether a republish
       * has happened since and what to run.
       */
      readonly legacy: {
        readonly publishedAt: string | null;
        readonly publisher: string | null;
        readonly publishedFromSha: string | null;
        readonly revision: number | null;
        readonly updatedAt: string | null;
      };
      /** The exact command that clears the state, and who runs it unattended. */
      readonly clearedBy: {
        readonly command: string;
        readonly unattended: string;
      };
    }
  | { readonly kind: "UNAVAILABLE"; readonly detail: string };

/** How a quarantined readiness record is cleared. One place, quoted by the page. */
export const READINESS_REPUBLISH_COMMAND = "pnpm readiness:publish";
export const READINESS_REPUBLISH_UNATTENDED =
  "the standing runner republishes the console after every cycle while it is running";

/**
 * Classify a read row against the current derivation contract (CC-F6). PURE: no
 * fs/db/clock — so a test can pin the quarantine without a control plane. A
 * snapshot is trusted (HELD) ONLY when its marker strictly equals the current
 * contract; absent or older marker → REQUIRES_REPUBLISH; a null row → NOT_RECORDED.
 * `persisted` carries the store's revision and write time when the caller has them.
 */
export function readinessRowOutcome(
  value: ReadinessStateSnapshot | null,
  source: string,
  stateName: string,
  persisted: { readonly revision: number; readonly updatedAt: string } | null = null,
): ReadinessReadOutcome {
  if (value === null) {
    return {
      kind: "NOT_RECORDED",
      detail:
        `The control plane is reachable and holds no readiness snapshot for ${stateName} yet. ` +
        "That is a fact about our record, not a claim that the state is empty.",
      source,
    };
  }
  const contract = (value as { readonly derivationContract?: unknown }).derivationContract;
  if (contract !== READINESS_DERIVATION_CONTRACT) {
    const loose = value as {
      readonly publishedAt?: unknown;
      readonly publisher?: unknown;
      readonly publishedFromSha?: unknown;
    };
    const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
    return {
      kind: "REQUIRES_REPUBLISH",
      snapshotContract: typeof contract === "string" ? contract : null,
      currentContract: READINESS_DERIVATION_CONTRACT,
      detail:
        `A readiness snapshot for ${stateName} exists but was produced under a superseded ` +
        `derivation contract (${typeof contract === "string" ? contract : "no contract marker"}). ` +
        "It must be republished under the current instrument-derived contract before its cells " +
        "can be trusted — its old values are not shown.",
      source,
      legacy: {
        publishedAt: str(loose.publishedAt),
        publisher: str(loose.publisher),
        publishedFromSha: str(loose.publishedFromSha),
        revision: persisted?.revision ?? null,
        updatedAt: persisted?.updatedAt ?? null,
      },
      clearedBy: { command: READINESS_REPUBLISH_COMMAND, unattended: READINESS_REPUBLISH_UNATTENDED },
    };
  }
  return { kind: "HELD", snapshot: value, source };
}

/**
 * Open the control-plane repositories the panel reads from.
 *
 * The control plane is Postgres named by `WTP_CONTROL_PLANE_DATABASE_URL`, exactly
 * as the existing owner control centre reads it — pg only, no filesystem. (An
 * earlier dev fallback to the durable file store was removed: it made Next's file
 * tracer bundle the whole `data/control-plane` directory into the route, and on
 * the deploy an untraced filesystem read would render as honest-looking missing
 * data — the one substitution this product cannot make. Local dev reads the same
 * control plane through `.env.local`.)
 */
export async function openReadinessRepositories(): Promise<
  { readonly ok: true; readonly repos: ControlPlaneRepositories; readonly source: string }
  | { readonly ok: false; readonly detail: string }
> {
  const url = controlPlaneUrlFromEnv();
  if (url === null) {
    return {
      ok: false,
      detail:
        `${CONTROL_PLANE_URL_VAR} is not set in this runtime, so the control plane was never ` +
        "opened. This is a fact about our configuration, not about any state: nothing here has " +
        "been checked and found missing — it has not been checked.",
    };
  }
  try {
    // A pure read: the panel never owns the schema, so it skips the
    // per-request bootstrap replay (ADM-2 — most of the selection lag).
    const repos = await createPgRepositories(url, new Date().toISOString(), { skipBootstrap: true });
    assertDurableRepositories(repos, "the readiness control panel");
    return { ok: true, repos, source: "control plane (Postgres)" };
  } catch (error) {
    return {
      ok: false,
      detail:
        `The control plane named by ${CONTROL_PLANE_URL_VAR} could not be opened ` +
        `(${(error as Error)?.name ?? "error"}). We could not ask, so we are not saying.`,
    };
  }
}

/**
 * Read one state's readiness snapshot. `state` is a two-letter code; a code we do
 * not track returns UNAVAILABLE naming that, not a blank page.
 */
export async function readReadinessSnapshot(state: string): Promise<ReadinessReadOutcome> {
  const entry = stateEntry(state);
  if (entry === null) {
    return { kind: "UNAVAILABLE", detail: `"${state}" is not a state, DC, or territory this panel tracks.` };
  }
  const opened = await openReadinessRepositories();
  if (!opened.ok) return { kind: "UNAVAILABLE", detail: opened.detail };

  try {
    const row = await opened.repos.readinessSnapshots.read(entry.code);
    return readinessRowOutcome(
      row?.value ?? null,
      opened.source,
      entry.name,
      row ? { revision: row.revision, updatedAt: row.updatedAt } : null,
    );
  } catch (error) {
    return {
      kind: "UNAVAILABLE",
      detail: `Reading the readiness snapshot failed (${(error as Error)?.name ?? "error"}). We could not ask.`,
    };
  }
}

/**
 * The honest snapshot for a tracked state with no published readiness record: the
 * whole starting taxonomy, every cell NOT_WALKED, coverage a named gap. This is
 * what "all 50 states load" means for a state we have not walked — not blank, not
 * an error, and not a fake green (acceptance #14). `nowIso` is the render time.
 */
export function unwalkedStateSnapshot(state: string, nowIso: string): ReadinessStateSnapshot {
  const entry = stateEntry(state) ?? { code: state.toLowerCase(), name: state.toUpperCase(), pilot: false };
  const capabilities: CapabilityInput[] = CAPABILITY_TAXONOMY.map((t) => ({
    capabilityId: t.capabilityId,
    domain: t.domain,
    label: t.label,
    level: t.level,
    coverage: {
      covered: 0,
      total: null,
      authority: null,
      contract: `${t.label} coverage`,
      label: "nothing checked yet",
      asOf: null,
      says: "No readiness run has ever measured this state, so nothing is known about this row either way.",
    },
    gates: {},
  }));
  return emptyStateSnapshot({
    state: entry.code,
    stateName: entry.name,
    publishedAt: nowIso,
    publisher: "no readiness run has measured this state; every cell below is rendered as “not checked yet” at read time",
    capabilities,
  });
}

/** The states the selector offers. */
export function readinessStates(): readonly { readonly code: string; readonly name: string; readonly pilot: boolean }[] {
  return US_STATES;
}
