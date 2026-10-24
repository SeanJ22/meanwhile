import { refreshLegistarMembers } from "../lib/sources/legistar/members-refresh.ts";
import { readerFactDb } from "../lib/facts/db.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { neon } from "@neondatabase/serverless";
import { assignment } from "./cli-args.mts";
import { recordLegistarMemberFailure } from "../lib/sources/legistar/members-tasks.ts";
import { sanitizedErrorDiagnostic } from "../lib/ops/error-diagnostic.ts";

prepareProductionCivicDataWrite();
const slug = assignment(process.argv, "legistar-client");
if (!slug || !/^[a-z0-9_-]+$/.test(slug)) throw new Error("LEGISTAR_MEMBERS_CLIENT_MISSING");
const connection = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
if (!connection) throw new Error("LEGISTAR_MEMBERS_DOORS_UNAVAILABLE");
const [admin] = await neon(connection).query(`SELECT jsonb_build_object('settings', jsonb_build_object(
  'facts.freshnessHours', value #> '{settings,facts.freshnessHours}',
  'facts.retryMinutes', value #> '{settings,facts.retryMinutes}')) AS value FROM cp_admin_config WHERE id = 'current'`);
const facts = readerFactDb();
try {
const result = await refreshLegistarMembers({ facts, now: new Date().toISOString(), slug, clocks: factClocks(admin?.value ?? null) });
console.log(JSON.stringify(result));
console.log("RCD_RECEIPT=" + JSON.stringify({ source: `legistar-members:${slug}`, candidateId: result.versionId,
  acquisitionSucceeded: true, state: "PROMOTED", decision: "GOOD", promotedVersion: result.versionId,
  lastKnownGoodVersion: result.versionId, confirmedAt: result.checkedAt, structuralReleaseContract: ZERO_RELEASE_EVENTS,
  delivered: { records: result.records, gaps: result.gaps.length + result.blanks, gapReasons: { LEGISTAR_MEMBERS_BODY_UNBOUND: result.gaps.length, ...result.blankReasons } } }));
} catch (error) {
  const detail = sanitizedErrorDiagnostic(error);
  console.error(detail);
  const receipt = await recordLegistarMemberFailure(facts.query, `legistar-members:${slug}`, new Date().toISOString(), detail);
  console.log("RCD_RECEIPT=" + JSON.stringify(receipt));
  process.exitCode = 2;
}
