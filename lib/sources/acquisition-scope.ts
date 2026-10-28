import { AsyncLocalStorage } from "node:async_hooks";

/** The source whose acquisition is in progress. Only that source's own requests are its evidence. */
const sourceContext = new AsyncLocalStorage<string>();

export function acquiringSource(): string | undefined {
  return sourceContext.getStore();
}

export function asSourceAcquisition<T>(source: string, operation: () => T): T {
  return sourceContext.run(source, operation);
}

/** A request our own infrastructure makes while a source is in scope (the evidence vault, the runner's read cache) is not that source's acquisition. */
export function outsideSourceAcquisition<T>(operation: () => T): T {
  return sourceContext.exit(operation);
}
