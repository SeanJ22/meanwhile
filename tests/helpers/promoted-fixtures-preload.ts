import { fixturePlaceMapQuery } from "./place-map.ts";
import { installPlaceMapQuery } from "../../lib/place-map/reader.ts";
installPlaceMapQuery(fixturePlaceMapQuery());

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
