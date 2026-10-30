import { serverReaderValue } from "./memory.ts";

/** A held part is looked at again, by its version alone, no more often than this; a body is read again only when the version moved. */
const CHECK_MS = 30_000;
/** A part not checked for this long is checked before it is used, so a sleeping server never serves old national facts. */
const MAX_STALE_MS = 5 * 60_000;
/** After a failed check the next call tries again this soon. */
const RETRY_MS = 5_000;

interface Held<T> { readonly value: T; readonly version: string; readonly checkedAt: number }
interface Slot<T> { held: Held<T> | null; working: Promise<Held<T>> | null }
const slots = serverReaderValue("national-shelf-slots", () => new Map<string, Slot<unknown>>());
const parts = serverReaderValue("national-shelf-parts", () => new Map<string, () => Promise<void>>());
const slotOf = <T>(name: string): Slot<T> => {
  let slot = slots.get(name);
  if (!slot) slots.set(name, slot = { held: null, working: null });
  return slot as Slot<T>;
};

/**
 * One part of the national shelf, held in this server's memory. It loads the first time it is asked for, checks its version
 * (one small statement) when it has not for 30 seconds, and reads its body again only when the version has moved. A check that fails
 * keeps serving what is held; a part never loaded fails like any other read.
 */
export function shelfPart<T>(name: string, version: () => Promise<string>, load: () => Promise<T>): { readonly read: () => Promise<T> } {
  const check = (): Promise<Held<T>> => {
    const slot = slotOf<T>(name);
    return slot.working ??= (async () => {
      try {
        // The version is read before the body, so a change that lands while the body loads is seen at the next check.
        const current = await version();
        return slot.held = slot.held?.version === current ? { ...slot.held, checkedAt: Date.now() } : { value: await load(), version: current, checkedAt: Date.now() };
      } finally { slot.working = null; }
    })();
  };
  parts.set(name, async () => { if (slotOf(name).held) await check(); });
  return {
    async read() {
      const slot = slotOf<T>(name), held = slot.held, age = held ? Date.now() - held.checkedAt : Infinity;
      if (!held || age > MAX_STALE_MS) {
        try { return (await check()).value; }
        catch (error) { if (held) return held.value; throw error; }
      }
      if (age > CHECK_MS) {
        slot.held = { ...held, checkedAt: Date.now() - CHECK_MS + RETRY_MS };
        void check().catch(error => console.error(`National shelf: ${name} could not be checked just now; the held copy is served (${error instanceof Error ? error.message : String(error)})`));
      }
      return held.value;
    },
  };
}

/** Checks every part this server holds against its version now. */
export async function refreshNationalShelf(): Promise<void> {
  await Promise.all([...parts.values()].map(refresh => refresh()));
}

/** Empties this server's shelf, so the next read loads everything again. */
export function forgetNationalShelf(): void {
  slots.clear();
}
