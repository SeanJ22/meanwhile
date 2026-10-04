import { ReaderPersonIdentityError } from "./reader-person.ts";

/**
 * CA-13 · A topic chip answers on the first click.
 *
 * The person keys a chip needs come from projections that load lazily. Refresh
 * every projection the subject's chain can touch, then resolve. When one of
 * those projections could not be read, the missing bridge is a fact about
 * what we hold, not about the person: the subject resolves to its own key and
 * the statements held under that key still answer. A refusal is kept only for a
 * conflict found with every needed projection in hand.
 */
export interface PositionIdentityReaders {
  /** The registry bridge and rosters; the one projection every subject needs. */
  readonly refreshRegistry: () => Promise<unknown>;
  readonly refreshFederal: () => Promise<unknown>;
  readonly refreshAz: () => Promise<unknown>;
  /** Registry rows tying this subject to a holder or candidacy, after the refresh. */
  readonly relatedAuthorities: (subject: string) => { readonly federal: boolean; readonly az: boolean };
  readonly personKeys: (subject: string) => string[];
}

export async function positionIdentityKeys(subject: string, readers: PositionIdentityReaders): Promise<string[]> {
  try {
    await readers.refreshRegistry();
  } catch {
    return [subject];
  }
  let related: { federal: boolean; az: boolean };
  try {
    related = readers.relatedAuthorities(subject);
  } catch {
    return [subject];
  }
  const federal = subject.startsWith("congress:") || related.federal;
  const az = subject.startsWith("ballot-az-") || subject.startsWith("statewide:az/") || related.az;
  const refreshes = await Promise.allSettled([
    federal ? readers.refreshFederal() : Promise.resolve(),
    az ? readers.refreshAz() : Promise.resolve(),
  ]);
  const incomplete = refreshes.some((result) => result.status === "rejected");
  try {
    return readers.personKeys(subject);
  } catch (error) {
    if (!incomplete && error instanceof ReaderPersonIdentityError) throw error;
    return [subject];
  }
}
