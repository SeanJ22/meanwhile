/** Read-only comparison of the parent reads changed by RN-01. Credentials are supplied as private files. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const [lane, mode, readerFile, cpFile, importsFile] = process.argv.slice(2);
if (!["routine", "publish-now"].includes(lane!) || !["before", "after"].includes(mode!) || !readerFile || !cpFile) throw Error("usage: routine|publish-now before|after reader-url-file cp-url-file [before-entry-source]");
process.env.DATABASE_URL = readFileSync(readerFile, "utf8").trim();
const { neon } = await import("@neondatabase/serverless");
const reader = neon(process.env.DATABASE_URL), cp = neon(readFileSync(cpFile, "utf8").trim());
// Both supplied credentials must be production read-only roles; enforce it independently for every statement.
const query = (client: typeof reader) => async (text: string, params: readonly unknown[] = []) => {
  if (!/^\s*(?:SELECT|WITH)\b/i.test(text)) throw Error("READ_ONLY_QUERY_REQUIRED");
  const rows = await client.transaction([client.query("SET TRANSACTION READ ONLY"), client.query("SET LOCAL statement_timeout='5s'"), client.query(text, [...params])]);
  return rows[2] as Record<string, unknown>[];
};
const rq = query(reader), cq = query(cp);
const source = readFileSync(importsFile ?? "scripts/routine-civic-data-runner.mts", "utf8");
const ast = ts.createSourceFile("parent.mts", source, ts.ScriptTarget.Latest, true);
for (const declaration of ast.statements.filter(ts.isImportDeclaration)) {
  if (declaration.importClause?.isTypeOnly || !ts.isStringLiteral(declaration.moduleSpecifier)) continue;
  const specifier = declaration.moduleSpecifier.text;
  await import(specifier.startsWith(".") ? pathToFileURL(resolve("scripts", specifier)).href : specifier);
}
if (lane === "routine" && mode === "after") await import("./scout-browse.mts");
const { recordParentMemory } = await import("../lib/civic-data/parent-memory.ts");
const { PostgresRoutineDataStore } = await import("../lib/civic-data/store.ts");
const { createPgRepositories } = await import("../lib/control-plane/repository/pg-store.ts");
const { cartonOffices } = await import("../lib/facts/carton-import.ts");
const { registeredStates } = await import("../lib/facts/entities.ts");
const { readRegistryRuntimePrior } = await import("../lib/registry/runtime-data-plane.ts");
const { REGISTRY_STATES } = await import("../lib/civic-data/state-scopes.ts");
const { readWorkerPublicationItems, readPublicationAdmission } = await import("../lib/civic-data/publish-now.ts");
const { readHeldInputs, readHeldPointerTimes } = await import("../lib/civic-data/worker-held-elections.ts");
const { readCompletedWorkerResultsOf } = await import("../lib/control-plane/repository/worker-completion.ts");
const store = new PostgresRoutineDataStore(), now = new Date().toISOString();
let payloadReads = 0, resultPages = 0, itemCount = 0;
const before = recordParentMemory(`${lane}:${mode}`, "before-inputs");
if (lane === "routine") {
  const states = registeredStates(process.cwd());
  for (const state of mode === "before" ? states : states.slice(0, 1)) {
    if (mode === "before") { await readRegistryRuntimePrior(store, now, state); payloadReads++; }
    else await cartonOffices(rq, () => { payloadReads++; return readRegistryRuntimePrior(store, now, state); }, state);
  }
} else {
  const repos = await createPgRepositories(readFileSync(cpFile, "utf8").trim(), now, { skipBootstrap: true });
  const shared = await readHeldPointerTimes(cq, async (recordClass, scope) => (await store.readPromotionIdentity(recordClass, scope))?.promotedAt ?? null,
    REGISTRY_STATES, (recordClass, scopes) => store.readPromotionIdentities(recordClass, scopes));
  const items = await readWorkerPublicationItems(cq), held = await readHeldInputs(cq, shared, items);
  itemCount = items.length;
  const readCompleted = async (ids: readonly string[]) => { resultPages++; return readCompletedWorkerResultsOf(repos, ids); };
  await readPublicationAdmission(items, readCompleted, now, held);
  if (mode === "before") await readPublicationAdmission(items, readCompleted, now, held);
}
const after = recordParentMemory(`${lane}:${mode}`, "after-inputs");
console.log(JSON.stringify({ lane, mode, before, after, peakRssBytes: process.resourceUsage().maxRSS * 1024, payloadReads, resultPages, itemCount }));
