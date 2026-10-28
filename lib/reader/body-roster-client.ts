import type { CoveredBody } from "../registry/coverage.ts";
import { readReaderJson } from "./bootstrap.ts";

type Roster = NonNullable<CoveredBody["readerRoster"]>;
const requests = new Map<string, { promise: Promise<Roster>; expires: number }>();

/** A shared roster has one pending request and one cached answer, even on several body cards. */
export function loadReaderBodyRoster(body: CoveredBody): Promise<Roster> {
  if (body.readerRoster) return Promise.resolve(body.readerRoster);
  const hash = body.rosterRef;
  if (!hash) return Promise.resolve({ members: [], gaps: [], officePhone: null });
  const key = `${body.bodyId}:${hash}`;
  const prior = requests.get(key);
  if (prior && prior.expires > Date.now()) return prior.promise;
  const params = new URLSearchParams({body:body.bodyId});
  const promise = fetch(`/api/reader/roster?${params}`, { headers: { accept: "application/json" } }).then(async response => {
    if (!response.ok) throw new Error(`Roster request failed: ${response.status}`);
    const roster = await readReaderJson<Roster>(response);
    if (requests.get(key)?.promise === promise) requests.set(key, { promise, expires: Date.now() + 30_000 });
    return roster;
  }).catch(error => { if (requests.get(key)?.promise === promise) requests.delete(key); throw error; });
  requests.set(key, { promise, expires: Date.now() + 300_000 });
  return promise;
}
