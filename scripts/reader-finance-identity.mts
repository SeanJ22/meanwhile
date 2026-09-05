/** Offline reconciliation only. Reader code never imports this name matcher. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import { officeIdentity } from "../lib/officials/office-identity.ts";
import { STATEWIDE_EXECUTIVES } from "../lib/officials/statewide-executives.ts";
import { nameParts, namesAgree, namesAgreeLoosely, splitDisplayName } from "../lib/ballot/incumbency.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";
import type { StateMoneySnapshot } from "../lib/funding/state-money.ts";
import { BODY_ROSTERS } from "../lib/registry/body-rosters.ts";

const OUTPUT = "lib/funding/official-candidacies.json";
interface Holder {
  id: string; name: string; officeTitle: string; divisions: string[];
  sourcePath: string; sourceUrl: string | null;
}

export function buildFinanceIdentityBridge() {
  const sources: { path: string; sha256: string }[] = [];
  const read = <T,>(path: string): T => {
    const raw = readFileSync(path, "utf8");
    sources.push({ path, sha256: createHash("sha256").update(raw).digest("hex") });
    return JSON.parse(raw) as T;
  };
  const { globSync } = fs as typeof fs & { globSync(pattern: string): string[] };
  const paths = (pattern: string) => globSync(pattern).map(p => p.replaceAll("\\", "/")).sort();
  const snapshots = paths("data/states/*/funding/state-money-??-????.json").map(p => read<StateMoneySnapshot>(p));
  const personLinks = read<{ rows: { officialId: string; holderName: string; candidacyId: string; holderSourceUrl: string | null; basis: string }[] }>("lib/funding/official-person-candidacy-links.json");
  // The identity graph covers all canonical ballot candidacies. Finance is a
  // consumer of these relationships, never the denominator for who a person is.
  void snapshots;
  const ballots = paths("data/states/*/ballot/*.json").flatMap(path => {
    const set = read<Partial<BallotSet>>(path);
    return Array.isArray(set.contests) && Array.isArray(set.candidacies) && set.election
      ? [{ path, set: set as BallotSet }] : [];
  });
  const holders: Holder[] = [];
  for (const sourcePath of [...paths("data/states/*/officials/officeholders-??.json"), "lib/registry/officeholders-us.json"]) {
    const set = read<OfficeholderSet>(sourcePath);
    for (const h of set.officeholders) holders.push({
      id: h.id, name: h.name, officeTitle: h.officeTitle,
      divisions: set.divisions.filter(d => d.officeholderId === h.id).map(d => d.ocdId).sort(),
      sourcePath, sourceUrl: h.provenance.sourceUrl,
    });
  }
  const executivesPath = "lib/officials/statewide-executives.ts";
  sources.push({ path: executivesPath, sha256: createHash("sha256").update(readFileSync(executivesPath)).digest("hex") });
  for (const e of STATEWIDE_EXECUTIVES) holders.push({
    id: e.holder.id, name: e.holder.name, officeTitle: e.holder.officeTitle,
    divisions: [e.stateOcdId], sourcePath: executivesPath, sourceUrl: e.sourceUrl,
  });
  for (const path of ["lib/registry/body-rosters.ts", "lib/registry/rosters-nj-morris.ts", "lib/registry/cawcd-rosters.ts", "data/states/az/officials/cawcd-rosters.json"]) {
    sources.push({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") });
  }
  for (const roster of BODY_ROSTERS) for (const h of roster.members) holders.push({
    id: h.id, name: h.name, officeTitle: h.officeTitle, divisions: [roster.bodyId.split("#")[0]],
    sourcePath: "lib/registry/body-rosters.ts", sourceUrl: roster.sourceUrl,
  });
  const rows = holders.sort((a, b) => a.id.localeCompare(b.id)).map(holder => {
    const office = officeIdentity(holder.officeTitle);
    const parts = splitDisplayName(holder.name);
    // Accent variants are exact character equivalents, not edit distance or
    // inferred aliases. Reconciliation stays offline and rejects ambiguity.
    const letters = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "");
    const holdingState = /^data\/states\/([a-z]{2})\/officials\//.exec(holder.sourcePath)?.[1];
    const sameState = ballots.flatMap(({ path, set }) => set.candidacies.flatMap(c => {
      const contest = set.contests.find(t => t.id === c.contestId);
      if (!contest || !(holder.divisions.some(d => d.split("/").slice(0, 3).join("/") === contest.ocdId.split("/").slice(0, 3).join("/")) ||
        (holdingState && contest.ocdId.startsWith(`ocd-division/country:us/state:${holdingState}`)))) return [];
      const candidateName = nameParts(letters(c.givenName), letters(c.familyName));
      const holderName = nameParts(letters(parts.givenName), letters(parts.familyName));
      const exactSeat = holder.divisions.includes(contest.ocdId) && office !== null && officeIdentity(contest.title) === office;
      if (!namesAgree(candidateName, holderName) && !(exactSeat && namesAgreeLoosely(candidateName, holderName))) return [];
      return [{ candidacyId: c.id, contestId: c.contestId, contestTitle: contest.title, divisionId: contest.ocdId,
        electionId: set.election.id, candidateName: `${c.givenName} ${c.familyName}`, sourcePath: path, sourceUrl: c.provenance.sourceUrl }];
    }));
    const exactSeat = sameState.filter(c => holder.divisions.includes(c.divisionId) && office !== null && officeIdentity(c.contestTitle) === office);
    const explicit = personLinks.rows.filter(r => r.officialId === holder.id);
    if (explicit.length > 1) throw new Error(`Ambiguous person links for ${holder.id}`);
    const reviewed = explicit[0];
    const reviewedCandidacies = reviewed ? sameState.filter(c => c.candidacyId === reviewed.candidacyId) : [];
    if (reviewed && (reviewed.holderName !== holder.name || reviewed.holderSourceUrl !== holder.sourceUrl || reviewedCandidacies.length !== 1)) {
      throw new Error(`Reviewed person/candidacy link no longer agrees with canonical source identity: ${holder.id}`);
    }
    const unique = [...new Map((reviewed ? reviewedCandidacies : exactSeat).map(c => [c.candidacyId, c])).values()];
    const status = unique.length === 1 ? "RESOLVED" : sameState.length ? "IDENTITY_UNRESOLVED" : "NO_APPLICABLE_CANDIDACY";
    return { holder, status, candidacy: status === "RESOLVED" ? unique[0] : null,
      reason: status === "RESOLVED" ? reviewed?.basis ?? "One held candidacy agrees on canonical division, office identity, and conservative given/family name reconciliation; resolved offline."
        : status === "IDENTITY_UNRESOLVED" ? "A held candidacy may name this officeholder, but exact seat identity or uniqueness is not established. No money attaches."
          : "No held ballot candidacy is resolved to this official. This is not a sourced absence of filings.",
      unresolvedCandidacyIds: status === "IDENTITY_UNRESOLVED" ? sameState.map(c => c.candidacyId).sort() : [],
    };
  });
  return { formatVersion: 1, generatedBy: "corepack pnpm exec tsx scripts/reader-finance-identity.mts", rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", sources: sources.sort((a,b) => a.path.localeCompare(b.path)), rows };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bridge = buildFinanceIdentityBridge();
  const rendered = JSON.stringify(bridge, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if (readFileSync(OUTPUT, "utf8") !== rendered) throw new Error("Official/candidacy finance bridge is stale; regenerate before shipping.");
  } else writeFileSync(OUTPUT, rendered);
  console.log(JSON.stringify({ rows: bridge.rows.length, resolved: bridge.rows.filter(r => r.status === "RESOLVED").length, unresolved: bridge.rows.filter(r => r.status === "IDENTITY_UNRESOLVED").length }));
}
