import { AsyncLocalStorage } from "node:async_hooks";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { Query } from "../facts/publish.ts";

/** The connections the reader's own functions read through while one state's answers are composed from its copy. */
export interface StateSeam { readonly reader: ReadOnlyQuery; readonly facts: Query }

const slot = Symbol.for("meanwhile.reader.state-seam");
const host = globalThis as typeof globalThis & { [slot]?: AsyncLocalStorage<StateSeam> };
const seam = host[slot] ??= new AsyncLocalStorage<StateSeam>();

export const currentStateSeam = (): StateSeam | undefined => seam.getStore();
export const withStateSeam = <T>(value: StateSeam, read: () => T): T => seam.run(value, read);
