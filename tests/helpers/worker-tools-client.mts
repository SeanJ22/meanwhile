import { ensureWorkerToolsHost } from "../../scripts/worker-tools-host.mts";
import { browseWithPlaywright } from "../../scripts/scout-browse.mts";
import { readFieldManual, type FieldManualRepos } from "../../lib/control-plane/field-manual.ts";
import { openRuntimeMethod } from "../../lib/method/runtime-manual.ts";

const state = process.argv[2]!;
const inherited = process.env.WTP_WORKER_TOOLS_URL;
const host = await ensureWorkerToolsHost({
  repos: async () => { throw new Error("a worker must not open the parent's repositories"); },
  createBrowser: () => { throw new Error("a worker must not launch its own browser"); },
});
const repos = { fieldManual: { visitSlice: async () => { throw new Error("a worker must not build its own catalog"); } } } as unknown as FieldManualRepos;
const method = await openRuntimeMethod(repos);
try {
  const manual = await readFieldManual(repos, { state, kinds: ["REFERENCE"] });
  if (manual.error) throw new Error(manual.error);
  const floor = await method.floorFor({ jurisdiction: { state }, fields: ["meeting"], adapterRoutes: [] });
  const observation = await browseWithPlaywright({ url: `https://${state}.example.gov/`, timeoutMs: 1000, holder: state });
  process.send?.({ kind: "ready", owned: host.owned, inherited: inherited === process.env.WTP_WORKER_TOOLS_URL,
    version: method.version, routes: floor.routes.map(row => row.routeId), states: manual.store.entries.map(row => row.states),
    finalUrl: observation.finalUrl });
  await new Promise<void>(resolve => process.once("message", () => resolve()));
} finally {
  await method.close();
  await host.close();
  process.disconnect();
}
