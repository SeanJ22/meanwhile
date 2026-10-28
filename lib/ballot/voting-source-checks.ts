import type { PublishedSourceCheck } from "../civic-data/source-checks.ts";
import { pageAddress } from "../doors/page-doors.ts";
import type { VotingSource, VotingSitesFile } from "./voting-sites.ts";

const address = (url: string) => pageAddress(url)?.url ?? url;
const mapChanged = <T>(rows: readonly T[] | undefined, change: (row: T) => T): T[] | undefined => {
  if (!rows) return undefined;
  const mapped = rows.map(change);
  return mapped.some((row, index) => row !== rows[index]) ? mapped : rows as T[];
};

/** Check times are a reader overlay; the immutable source evidence and its capture dates stay intact. */
export function votingSourceCheckOverlay(file: VotingSitesFile, checks: readonly PublishedSourceCheck[], wholeCheckedAt?: string): VotingSitesFile {
  const current = checks.filter(check => file.sourceHashes?.[check.sourceKey] === check.rawHash && Number.isFinite(Date.parse(check.checkedAt)));
  if (!current.length && !wholeCheckedAt) return file;
  const jurisdictions = mapChanged(file.jurisdictions, jurisdiction => {
    const observed = new Map<string, string>();
    for (const check of current.filter(check => check.jurisdictionIds.includes(jurisdiction.ocdId))) for (const url of check.sourceUrls) {
      const key = address(url), prior = observed.get(key);
      if (!prior || Date.parse(check.checkedAt) > Date.parse(prior)) observed.set(key, check.checkedAt);
    }
    const source = (held: VotingSource): VotingSource => {
      const at = [observed.get(address(held.url)), wholeCheckedAt].filter((value): value is string => value !== undefined)
        .sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1);
      return at && Date.parse(at) > (Date.parse(held.checkedAt ?? "") || 0) ? { ...held, checkedAt: at } : held;
    };
    const sourced = <T extends { source: VotingSource }>(row: T): T => {
      const next = source(row.source); return next === row.source ? row : { ...row, source: next };
    };
    const sources = mapChanged(jurisdiction.sources, source), rules = mapChanged(jurisdiction.rules, sourced);
    const boundaries = mapChanged(jurisdiction.boundaries, sourced), publication = jurisdiction.publication ? sourced(jurisdiction.publication) : undefined;
    const sites = mapChanged(jurisdiction.sites, site => {
      const sources = mapChanged(site.sources, source), schedules = mapChanged(site.schedules, sourced);
      const assignments = mapChanged(site.assignments, sourced), rules = mapChanged(site.rules, sourced);
      return sources === site.sources && schedules === site.schedules && assignments === site.assignments && rules === site.rules ? site
        : { ...site, sources, schedules, assignments, rules };
    })!;
    return sources === jurisdiction.sources && rules === jurisdiction.rules && boundaries === jurisdiction.boundaries && publication === jurisdiction.publication && sites === jurisdiction.sites
      ? jurisdiction : { ...jurisdiction, sources, rules, boundaries, publication, sites };
  })!;
  return jurisdictions === file.jurisdictions ? file : { ...file, jurisdictions };
}
