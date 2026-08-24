/**
 * **SEED ONE INVITATION AND ONE LINK INTO THE LOCAL DATABASE**, so the page a
 * candidate lands on can be walked and photographed before it ships.
 * (Overnight depth hunt, 2026-08-23, item 7.)
 *
 * ## Why this exists rather than a screenshot of an error state
 *
 * RULING 77: verify locally, ship once. The questionnaire page's whole
 * behaviour is behind a valid token — without one, every capture is of a
 * refusal, and a session that photographed the refusal and reported the page
 * verified would have reported a step it did not take.
 *
 * ## It REFUSES to run against production, and that is the whole safety story
 *
 * The three questionnaire tables now exist on production. A seeding script that
 * could reach them would be able to put a fabricated invitation in front of a
 * real candidate. So this reads `DATABASE_URL` only, never
 * `WTP_PRODUCTION_DATABASE_URL_WRITE`, and it checks the host it resolved
 * against the production host before writing anything — a check, not a
 * convention, because a convention is what somebody edits at 2am.
 *
 * The candidacy it seeds is a real one from the committed ballot, because the
 * page resolves an id to a name and a fabricated id would exercise only the
 * fallback path — which is the path that matters least.
 *
 *   pnpm questionnaire:seed-local
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { config as loadEnv } from "dotenv";
import { neon } from "@neondatabase/serverless";

import { mintToken } from "../lib/questionnaire/auth.ts";

loadEnv({ path: join(process.cwd(), ".env.local") });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. This seeds the LOCAL branch and nothing else.");
  process.exit(2);
}

const productionUrl = process.env.WTP_PRODUCTION_DATABASE_URL_WRITE ?? "";
const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
};
if (productionUrl && hostOf(url) === hostOf(productionUrl)) {
  console.error(
    "REFUSED — DATABASE_URL resolves to the same host as WTP_PRODUCTION_DATABASE_URL_WRITE.\n" +
      "This script seeds a fabricated invitation and must never reach the database a real\n" +
      "candidate's link would be checked against.",
  );
  process.exit(1);
}

const sql = neon(url);

/** A real candidacy from the committed ballot, so the name resolver is exercised. */
const ballot = JSON.parse(
  readFileSync(join(process.cwd(), "data", "ballot", "nj-morris-2026.json"), "utf8"),
) as {
  contests: { id: string; title: string }[];
  candidacies: { id: string; contestId: string; givenName: string; familyName: string }[];
};
const candidacy = ballot.candidacies.find((c) => c.id.includes("kapner")) ?? ballot.candidacies[0];
const contest = ballot.contests.find((c) => c.id === candidacy.contestId);

const issuedAt = new Date();
const minted = mintToken({ candidacyId: candidacy.id, issuedAt });

await sql`delete from questionnaire_tokens where candidacy_id = ${candidacy.id}`;
await sql`delete from questionnaire_invitations where candidacy_id = ${candidacy.id}`;

await sql`
  insert into questionnaire_invitations
    (candidacy_id, contest_id, email, instrument_version, office_class,
     planned_invited_on, planned_reminders_on, deadline, invited_on, reminded_on,
     contact_source_url, contact_source_org, contact_collected_at)
  values
    (${candidacy.id}, ${candidacy.contestId}, ${"local-seed@example.invalid"}, ${"v1"},
     ${"municipal_governing"}, ${"2026-09-01"}, ${JSON.stringify(["2026-09-08"])}, ${"2026-09-22"},
     ${null}, ${JSON.stringify([])},
     ${"local seed — not a real invitation"}, ${"local seed"}, ${"2026-08-23"})
`;

await sql`
  insert into questionnaire_tokens (token_digest, candidacy_id, issued_at, expires_at, used_at)
  values (${minted.record.tokenDigest}, ${candidacy.id}, ${minted.record.issuedAt}, ${minted.record.expiresAt}, ${null})
`;

console.log(`seeded the LOCAL branch at ${hostOf(url)}`);
console.log(`  candidacy   ${candidacy.id}`);
console.log(`  person      ${candidacy.givenName} ${candidacy.familyName}`);
console.log(`  office      ${contest?.title ?? "(unresolved)"}`);
console.log(`  invitedOn   null — nothing has been sent to anybody`);
console.log(`\n  /questionnaire/${minted.token}`);
