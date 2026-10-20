import { startWorkerToolsHost } from "../lib/control-plane/workers/process-pool.ts";
import { sharedScoutBrowser } from "./scout-browse.mts";

type HostInput = Parameters<typeof startWorkerToolsHost>[0];
export interface WorkerToolsHandle {
  readonly owned: boolean;
  close(): Promise<void>;
}

/** Parents own the tools; every descendant inherits their authenticated address. */
export async function ensureWorkerToolsHost(input: {
  repos: HostInput["repos"] | (() => Promise<HostInput["repos"]>);
  createBrowser?: typeof sharedScoutBrowser;
  startHost?: typeof startWorkerToolsHost;
}): Promise<WorkerToolsHandle> {
  if (process.env.WTP_WORKER_TOOLS_URL) return { owned: false, close: async () => {} };
  const repos = typeof input.repos === "function" ? await input.repos() : input.repos;
  const browser = (input.createBrowser ?? sharedScoutBrowser)();
  let host: Awaited<ReturnType<typeof startWorkerToolsHost>>;
  try {
    // Calling the RPC client here would send the request back to this same host.
    host = await (input.startHost ?? startWorkerToolsHost)({ repos, browse: browser.browse });
  } catch (error) {
    await browser.close();
    throw error;
  }
  let closing: Promise<void> | null = null;
  return { owned: true, close: () => closing ??= (async () => {
    try { await host.close(); }
    finally { await browser.close(); }
  })() };
}
