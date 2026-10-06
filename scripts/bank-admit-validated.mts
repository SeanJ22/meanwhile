/** Bank maintenance through the normal provider. River runs the deployed path.
 * @freshness-reads-here: the command records its execution time; offer/source
 * observation dates are preserved separately by bank-candidate-admission.
 * Does not bootstrap schema, start research, change budgets, or acquire facts.
 */
import { createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { candidateCounts } from "../lib/method/candidate.ts";
import { admitValidatedBankCandidates } from "../lib/control-plane/bank-candidate-admission.ts";

const connection = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
if (!connection) throw new Error("WTP_CONTROL_PLANE_DATABASE_URL_REQUIRED");
const stamp = new Date().toISOString();
const repos = await createPgRepositories(connection, stamp, { skipBootstrap: true });
if (process.argv.includes("--apply")) {
  const report = await admitValidatedBankCandidates({ repos, stamp });
  console.log(JSON.stringify({ stamp, ...report }));
} else {
  const row = await repos.methodCandidates.read("live");
  if (!row) throw new Error("METHOD_CANDIDATE_STORE_UNREADABLE");
  console.log(JSON.stringify({ stamp, mode: "read-only", counts: candidateCounts(row.value) }));
}
