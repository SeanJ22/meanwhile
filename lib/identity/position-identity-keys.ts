import { ReaderPersonIdentityError } from "./reader-person.ts";

/**
 * A topic chip answers on the first click: every projection the subject's
 * chain can touch is refreshed, then the person keys are resolved. When one
 * could not be read, the subject resolves to its own key and the statements
 * held under it still answer. A refusal is kept only for a conflict found with
 * every needed projection in hand.
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
