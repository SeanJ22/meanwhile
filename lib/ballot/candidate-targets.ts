import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getGeneralLineup } from "./general-lineup.ts";

/**
 * The set of candidate ids a CANDIDATE reaction may target (3d) — every
 * candidacy id in the committed ballot files plus every certified-lineup
 * nominee key (`<contestId>|<name>`). The write path checks against this
 * set the way vote reactions check the votes snapshot: the surface only
 * renders the control on real candidates, so anything else is a client bug
 * or a probe, and it fails closed.
 */

const BALLOT_FILES = [
  "nj-morris-2026.json",
  "az-pima-2026.json",
  "nh-merrimack-2026.json",
];

let cache: Set<string> | null = null;

export function getCandidateTargetIds(): Set<string> {
  if (cache) return cache;
  const ids = new Set<string>();
  for (const file of BALLOT_FILES) {
    const data = JSON.parse(
      readFileSync(join(process.cwd(), "data", "ballot", file), "utf8"),
    ) as { candidacies?: { id: string }[] };
    for (const c of data.candidacies ?? []) ids.add(c.id);
  }
  const lineup = getGeneralLineup();
  for (const contest of lineup?.contests ?? []) {
    for (const nominee of contest.nominees) {
      ids.add(`${contest.contestId}|${nominee.name}`);
    }
  }
  if (ids.size === 0) {
    throw new Error("candidate target set is empty — refusing to validate against nothing");
  }
  cache = ids;
  return ids;
}
