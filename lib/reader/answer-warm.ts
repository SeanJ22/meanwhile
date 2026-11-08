import type { Query } from "../facts/publish.ts";
import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import { answerPath } from "./answer.ts";
import { serverReaderValue } from "./memory.ts";
import { readZipRow } from "./zip3.ts";

/**
 * After the lane publishes, and after the Eastern day rolls (which moves every key), the busiest ZIPs' new answers are asked for once, so the CDN
 * holds them before a reader comes and the first reader does not wait for the assembly. Each asked answer is one function run that the first
 * reader would otherwise have caused, so only ZIPs people actually open cost nothing extra; the cap bounds what the others cost.
 *
 * WARM_ZIPS: the ZIPs warmed are the busiest by entity page_priority. 300 is a few percent of the ZIPs and is meant to be most of the visits.
 * WARM_PER_HOUR: a day roll warms all 300 in two hours, busiest first; a page change warms only the ZIPs whose key moved. At most 3,600 runs a day,
 * about 300 plus the changed keys among the 300 on an ordinary one.
 */
export const WARM_ZIPS = 300, WARM_PER_HOUR = 150, WARM_PER_TURN = 3;
const LIST_EVERY_MS = 30 * 60_000, HOUR_MS = 3_600_000, NOTHING_NEW_MS = 60_000;

export interface WarmDeps {
  readonly facts: Query;
  readonly store: ReaderArtifactStore;
  /** The public origin whose CDN is warmed. */
  readonly origin: string;
  readonly now?: () => number;
  readonly fetch?: typeof fetch;
  readonly log?: (line: string) => void;
}

const memory = serverReaderValue("answer-warm", () => ({ warmed: new Map<string, string>(), hour: { start: 0, count: 0 }, zips: [] as string[], listedAt: 0, restUntil: 0 }));

/** Asks for the new answers of the busiest ZIPs, a few at a time within the hour's cap. Returns how many it asked for. */
export async function warmAnswersTurn(deps: WarmDeps): Promise<number> {
  const now = (deps.now ?? Date.now)(), ask = deps.fetch ?? fetch;
  if (now - memory.hour.start >= HOUR_MS) memory.hour = { start: now, count: 0 };
  if (memory.hour.count >= WARM_PER_HOUR || now < memory.restUntil) return 0;
  if (!memory.zips.length || now - memory.listedAt >= LIST_EVERY_MS) {
    memory.zips = (await deps.facts(`SELECT substr(id,5) AS zip FROM entity WHERE id ~ '^zip:[0-9]{5}$' ORDER BY page_priority DESC,id LIMIT $1`, [WARM_ZIPS])).map(row => String(row.zip));
    memory.listedAt = now;
  }
  let asked = 0;
  const files = new Map<string, Promise<Awaited<ReturnType<typeof readZipRow>>>>();
  for (const zip of memory.zips) {
    if (asked >= WARM_PER_TURN || memory.hour.count >= WARM_PER_HOUR) break;
    const row = await readZipRow(deps.store, zip, files);
    if (!row?.point || memory.warmed.get(zip) === row.key) continue;
    memory.hour.count++; asked++;
    try {
      const response = await ask(new URL(answerPath(zip, row.key), deps.origin), { headers: { "accept-encoding": "br" }, signal: AbortSignal.timeout(20_000) });
      await response.arrayBuffer();
      if (response.ok) memory.warmed.set(zip, row.key); else deps.log?.(`Answer warm: ${zip} answered ${response.status}`);
    } catch (error) { deps.log?.(`Answer warm: ${zip} could not be asked for (${error instanceof Error ? error.message : String(error)})`); }
  }
  // When every busy ZIP's answer has been asked for, the store is looked at again in a minute, not on every turn.
  if (!asked) memory.restUntil = now + NOTHING_NEW_MS;
  return asked;
}

/** Lets go of what the warm step remembers. */
export function closeAnswerWarm(): void {
  Object.assign(memory, { warmed: new Map(), hour: { start: 0, count: 0 }, zips: [], listedAt: 0, restUntil: 0 });
}
