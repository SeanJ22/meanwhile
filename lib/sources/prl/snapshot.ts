import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shareSentence } from "./index.ts";
import { PRL_CATEGORIES, PRL_RHETORIC_ATTRIBUTION, type PrlMemberProfile, type PrlSnapshot } from "./types.ts";

export interface PrlReaderProfile {
  subjectId: string;
  bioguideId: string;
  statementCount: number;
  measuredAt: string;
  readAt: string;
  categories: { id: string; sentence: string }[];
  attribution: typeof PRL_RHETORIC_ATTRIBUTION;
  sourceUrl: string;
}

/** Explicit allowlist: no raw source object, ranks, or ideology can reach a reader. */
export function projectPrlProfile(profile: PrlMemberProfile, snapshot: Pick<PrlSnapshot, "fetchedAt" | "sourceUrl" | "attribution">): PrlReaderProfile | null {
  if (!/^[A-Z]\d{6}$/.test(profile.bioguideId) || !Number.isInteger(profile.statementCount) || profile.statementCount <= 0) return null;
  if (snapshot.attribution.citation !== PRL_RHETORIC_ATTRIBUTION.citation || !snapshot.sourceUrl || !snapshot.fetchedAt) return null;
  const categories = PRL_CATEGORIES.flatMap(category => {
    const value = profile.shares[category.key];
    if (value === null || !Number.isFinite(value) || value < 0 || value > 100) return [];
    const sentence = shareSentence(profile, category.key);
    return sentence ? [{ id: category.key, sentence }] : [];
  });
  return { subjectId: `congress:${profile.bioguideId}`, bioguideId: profile.bioguideId,
    statementCount: profile.statementCount, measuredAt: profile.measuredAt,
    readAt: snapshot.fetchedAt, categories, attribution: PRL_RHETORIC_ATTRIBUTION, sourceUrl: snapshot.sourceUrl };
}

let cache: PrlSnapshot | null = null;
export function prlProfileForSubject(subjectId: string): PrlReaderProfile | null {
  const bioguide = /^congress:([A-Z]\d{6})$/.exec(subjectId)?.[1];
  if (!bioguide) return null;
  // Failure propagates to 503. An unavailable deployed holding is not no profile.
  cache ??= JSON.parse(readFileSync(join(process.cwd(), "data", "prl", "prl-profiles.json"), "utf8")) as PrlSnapshot;
  if (cache.formatVersion !== 1 || !Array.isArray(cache.profiles)) throw new Error("Invalid normalized PRL snapshot");
  const matches = cache.profiles.filter(profile => profile.bioguideId === bioguide);
  if (matches.length > 1) throw new Error(`Ambiguous normalized PRL identity ${bioguide}`);
  return matches[0] ? projectPrlProfile(matches[0], cache) : null;
}
