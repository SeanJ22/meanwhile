import type { SeatHolder } from "../officials/lookup.ts";
import type { RosterReaderGap } from "./body-rosters.ts";
import type { CoverageSummary, CoveredBody } from "./coverage.ts";
import type { ReaderBodyDetail } from "../reader/body-detail.ts";
import { ocdStateCode } from "../ocd/state-of.ts";

/** Client-safe view of a body roster already projected by the server Reader. */
export interface BodyRosterClientProjection {
  readonly members: readonly SeatHolder[];
  readonly gaps: readonly RosterReaderGap[];
}

const EMPTY: BodyRosterClientProjection = Object.freeze({ members: [], gaps: [] });
const pending = new Map<string, Promise<ReaderBodyDetail>>();

export function bodyDetailState(body: CoveredBody, fallback?: string | null): string | null {
  return (body.readerState ?? ocdStateCode(body.bodyId) ?? /^government:US-([A-Z]{2}):/i.exec(body.bodyId)?.[1] ??
    /^([a-z]{2}):/i.exec(body.bodyId)?.[1] ?? ocdStateCode(body.ocdId) ??
    body.recipientState ?? fallback ?? null)?.toUpperCase() ?? null;
}

/** One in-flight request per body; subsequent opens can receive a freshly invalidated answer. */
export function loadBodyDetail(state: string, bodyId: string): Promise<ReaderBodyDetail> {
  const key = JSON.stringify([state, bodyId]);
  const existing = pending.get(key);
  if (existing) return existing;
  const url = new URLSearchParams({ state, body: bodyId });
  const read = fetch(`/api/reader/body?${url}`).then(async response => {
    if (!response.ok) throw new Error("The body's information could not be loaded");
    const detail = await response.json() as ReaderBodyDetail;
    if (detail.bodyId !== bodyId || !Array.isArray(detail.roster?.members)) throw new Error("The body's information could not be loaded");
    return detail;
  }).finally(() => { pending.delete(key); });
  pending.set(key, read);
  return read;
}

/** Resolve a selected set of bodies without turning a failed request into an empty roster. */
export async function loadBodyDetails(bodies: readonly CoveredBody[]): Promise<ReadonlyMap<string, ReaderBodyDetail>> {
  return loadBodyReferences(bodies.map(body => ({ bodyId: body.bodyId, state: bodyDetailState(body) })));
}

/** Read named body keys without adding those bodies to a visible coverage list. */
export async function loadBodyReferences(bodies: readonly { bodyId: string; state: string | null }[]): Promise<ReadonlyMap<string, ReaderBodyDetail>> {
  const details = new Map<string, ReaderBodyDetail>();
  let next = 0;
  const worker = async () => {
    while (next < bodies.length) {
      const body = bodies[next++], state = body.state;
      if (!state) continue;
      try { details.set(body.bodyId, await loadBodyDetail(state, body.bodyId)); }
      catch { /* Keep the summary so readers can distinguish unavailable from empty. */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, bodies.length) }, worker));
  return details;
}

export function projectedBodyRoster(
  body: Pick<CoveredBody, "readerRoster"> | null | undefined,
): BodyRosterClientProjection {
  return body?.readerRoster ?? EMPTY;
}

function governingBodyForDivision(body: CoveredBody, ocdId: string): boolean {
  return body.bodyId === `${ocdId}#governing` || body.bodyId === `${ocdId}#board`;
}

/** The local holders already carried on the coverage response for this division. */
export function projectedGoverningHoldersForDivision(
  coverage: CoverageSummary | null | undefined,
  ocdId: string | null,
): SeatHolder[] {
  if (!coverage || !ocdId) return [];
  return coverage.bodies
    .filter((body) => governingBodyForDivision(body, ocdId))
    .flatMap((body) => [...projectedBodyRoster(body).members]);
}

/** Completeness gaps already carried on governing/board bodies for a division. */
export function projectedRosterGapsForDivision(
  coverage: CoverageSummary | null | undefined,
  ocdId: string | null,
): RosterReaderGap[] {
  if (!coverage || !ocdId) return [];
  return coverage.bodies
    .filter((body) => governingBodyForDivision(body, ocdId))
    .flatMap((body) => [...projectedBodyRoster(body).gaps]);
}

/** People named in the unopened list; complete body membership loads on its own key. */
export function projectedRosterPreview(body:Pick<CoveredBody,'readerRoster'|'readerRosterPreview'>):readonly SeatHolder[] {
  return body.readerRosterPreview??body.readerRoster?.members??[];
}

