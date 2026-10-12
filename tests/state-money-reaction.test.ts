import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { validReactionTargetsFor } from "../app/api/reactions/targets.ts";

const KEY = "ballot-az-pima:state-house-19|David Gowan";

function readers(opts: { stateKnown: boolean }) {
  const calls: string[] = [];
  return {
    calls,
    value: {
      candidateTargets: async () => new Set<string>(),
      provisionTargets: () => new Set<string>(),
      refreshFunding: async () => { calls.push("fec"); },
      fundingTargets: () => new Set(["H0AZ01234"]),
      refreshStateMoney: async (state: string) => { calls.push(`state:${state}`); },
      stateMoneyTargets: (id: string) => (opts.stateKnown ? new Set([id]) : new Set<string>()),
      contributorTargets: () => new Set<string>(),
      refreshVotes: async () => {},
      voteTargets: () => new Set<string>(),
    },
  };
}

test("state and local money reactions: a candidacy key with a held committee is a valid funding-reaction target", async () => {
  const held = readers({ stateKnown: true });
  const valid = await validReactionTargetsFor("FUNDING_TOTAL_REACTION", KEY, held.value);
  assert.ok(valid.has(KEY), "the state candidacy key was refused");
  assert.deepEqual(held.calls, ["state:AZ"], "it opened the FEC authority, or no state authority");

  // A key the state's money does not hold is refused, not accepted by default.
  const unknown = readers({ stateKnown: false });
  assert.ok(!(await validReactionTargetsFor("FUNDING_TOTAL_REACTION", KEY, unknown.value)).has(KEY));

  // An FEC candidate id keeps its own path and never opens the state authority.
  const fec = readers({ stateKnown: true });
  assert.ok((await validReactionTargetsFor("FUNDING_TOTAL_REACTION", "H0AZ01234", fec.value)).has("H0AZ01234"));
  assert.deepEqual(fec.calls, ["fec"]);
});

test("state and local money reactions: the section carries the same control as the federal money cards", () => {
  const section = readFileSync(join(process.cwd(), "components", "funding", "state-money-section.tsx"), "utf8");
  assert.match(section, /targetType="FUNDING_TOTAL_REACTION"/);
  assert.match(section, /How do you feel about how this campaign is funded\?/);
  // Only where there is money to feel something about.
  assert.match(section, /filingState === "FILED" \|\| r\.filingState === "REGISTERED_NO_ACTIVITY_REPORTED"/);
});
