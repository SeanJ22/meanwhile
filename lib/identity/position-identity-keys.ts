import { ReaderPersonIdentityError } from "./reader-person.ts";

interface PositionIdentityReaders {
  /** The registry bridge and rosters; the one projection every subject needs. */
  readonly refreshRegistry: () => Promise<unknown>;
  readonly refreshFederal: () => Promise<unknown>;
  readonly refreshBallot: () => Promise<unknown>;
  /** Registry rows tying this subject to a holder or candidacy, after the refresh. */
  readonly relatedAuthorities: (subject: string) => { readonly federal: boolean; readonly ballot: boolean };
  readonly personKeys: (subject: string) => string[];
}

export async function positionIdentityKeys(subject: string, readers: PositionIdentityReaders): Promise<string[]> {
  try {
    await readers.refreshRegistry();
  } catch {
    return [subject];
  }
  let related: { federal: boolean; ballot: boolean };
  try {
    related = readers.relatedAuthorities(subject);
  } catch {
    return [subject];
  }
  const federal = subject.startsWith("congress:") || related.federal;
  const ballot = related.ballot;
  const refreshes = await Promise.allSettled([
    federal ? readers.refreshFederal() : Promise.resolve(),
    ballot ? readers.refreshBallot() : Promise.resolve(),
  ]);
  const incomplete = refreshes.some((result) => result.status === "rejected");
  try {
    return readers.personKeys(subject);
  } catch (error) {
    if (!incomplete && error instanceof ReaderPersonIdentityError) throw error;
    return [subject];
  }
}
