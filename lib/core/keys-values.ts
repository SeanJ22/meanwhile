import { KEY_NAMES } from "./keys-model.ts";

type Environment = Readonly<Record<string, string | undefined>>;
export interface SavedValues {
  readonly values: ReadonlyMap<string, string>;
  readonly openings?: readonly { readonly name: string; readonly version: string; readonly at: string }[];
}
const KEY_STATE = Symbol.for("meanwhile.saved-keys");
const KEY_ENVIRONMENT = Symbol.for("meanwhile.saved-key-environment");
const host = globalThis as typeof globalThis & { [KEY_STATE]?: SavedValues };
const declared = new Set(Object.keys(KEY_NAMES));
// Software CI keeps its existing scoped database transports and per-run GitHub token.
const ciBootstrap = new Set(["WTP_PRODUCTION_DATABASE_URL_READONLY", "WTP_CONTROL_PLANE_DATABASE_URL_READONLY", "WTP_CONTROL_PLANE_POST_DEPLOY_DATABASE_URL", "GH_TOKEN", "GITHUB_TOKEN"]);

export function installSavedValues(next: SavedValues | undefined): SavedValues | undefined {
  const previous = host[KEY_STATE]; host[KEY_STATE] = next; return previous;
}

export const SAVED_DATABASE_SOURCE = "WTP_SAVED_KEYS_DATABASE_SOURCE";
const databaseSources = new Set(["WTP_PRODUCTION_DATABASE_URL_READONLY", "WTP_PRODUCTION_DATABASE_URL_WRITE"]);
export function selectSavedDatabase(source: string | undefined): void {
  if (source !== undefined && !databaseSources.has(source)) throw new Error("Choose a saved database connection.");
  if (source === undefined) delete process.env[SAVED_DATABASE_SOURCE]; else process.env[SAVED_DATABASE_SOURCE] = source;
}
export function storedKeyValue(name: string, injected?: Environment): string | undefined {
  if (typeof window !== "undefined") throw new Error("Saved keys are available only on the server.");
  if (injected && injected !== process.env && Reflect.get(injected, KEY_ENVIRONMENT) !== true) return injected[name];
  if (process.env.GITHUB_ACTIONS === "true" && !process.env.WTP_RUNTIME_MODE && ciBootstrap.has(name)) return process.env[name];
  const source = process.env[SAVED_DATABASE_SOURCE];
  return host[KEY_STATE]?.values.get(name === "DATABASE_URL" && source && databaseSources.has(source) ? source : name);
}

const environment = new Proxy(process.env, {
  get(target, field) {
    if (field === KEY_ENVIRONMENT) return true;
    if (typeof field === "string" && declared.has(field)) return storedKeyValue(field);
    return Reflect.get(target, field);
  },
  has(target, field) {
    if (typeof field === "string" && declared.has(field)) return storedKeyValue(field) !== undefined;
    return Reflect.has(target, field);
  },
  ownKeys(target) {
    const held = host[KEY_STATE];
    return [...new Set([...Object.keys(target).filter(name => !declared.has(name)), ...[...(held?.values.keys() ?? [])].filter(name => declared.has(name)), ...(process.env[SAVED_DATABASE_SOURCE] ? ["DATABASE_URL"] : [])])];
  },
  getOwnPropertyDescriptor(target, field) {
    if (typeof field === "string" && declared.has(field)) {
      const value = storedKeyValue(field);
      return value === undefined ? undefined : { configurable: true, enumerable: true, writable: false, value };
    }
    return Reflect.getOwnPropertyDescriptor(target, field);
  },
});

/** Explicit fixture and admitted child environments remain dependencies, never a host fallback. */
export function storedKeyEnvironment(): NodeJS.ProcessEnv;
export function storedKeyEnvironment<T extends Environment>(injected: T): T;
export function storedKeyEnvironment<T extends Environment>(injected: T | undefined): T | NodeJS.ProcessEnv;
export function storedKeyEnvironment(injected: Environment = process.env): Environment {
  return injected === process.env ? environment : injected;
}
