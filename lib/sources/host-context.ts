import { AsyncLocalStorage } from "node:async_hooks";

const vendor = new AsyncLocalStorage<string>();
export const currentSourceVendor = (): string | undefined => vendor.getStore();
export function withSourceVendor<T>(name: string | undefined, work: () => T): T {
  return name ? vendor.run(name, work) : work();
}
