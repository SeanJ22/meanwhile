/**
 * Preloaded into a child process (`--import`) by `withPromotedFixturesInChildren`: installs the registry
 * runtime on that process's own reader edge before its entry module runs, so a forked worker reads the
 * same promoted registry the parent test installed. A child process shares no async context with its parent.
 *
 * On Node 24 an IPC `message` callback does not run in the context the preload entered, so each `message`
 * listener runs inside the installed edge explicitly.
 */
import { currentReaderAuthorityEdge, withReaderAuthorityEdge } from "../../lib/registry/runtime-edge.ts";
import { installRegistryRuntime } from "./promoted-fixtures.ts";

await installRegistryRuntime();

const edge = currentReaderAuthorityEdge();
type Listener = (...args: unknown[]) => void;
for (const method of ["on", "once", "addListener", "prependListener", "prependOnceListener"] as const) {
  const original = process[method].bind(process) as (event: string | symbol, listener: Listener) => NodeJS.Process;
  (process as unknown as Record<string, unknown>)[method] = (event: string | symbol, listener: Listener) =>
    original(event, event === "message" ? (...args: unknown[]) => withReaderAuthorityEdge(edge, () => listener(...args)) : listener);
}
