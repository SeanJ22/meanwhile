const OMIT = Symbol("omit");
const durable = new WeakSet<object>();

/** Makes a value its own JSON form in place and freezes it, so it is checked and stored without a copy.
 * Undefined fields go, toJSON applies, non-finite numbers become null; a frozen value that needs a change is copied. */
export function freezeDurableJson<T>(value: T): T {
  const result = settle(value, false, new Set());
  if (result === OMIT) throw new TypeError("The value is not representable as JSON.");
  return result as T;
}

function settle(raw: unknown, inArray: boolean, path: Set<object>): unknown {
  const value = raw !== null && typeof (raw as { toJSON?: unknown } | undefined)?.toJSON === "function" ? (raw as { toJSON(): unknown }).toJSON() : raw;
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return inArray ? null : OMIT;
  if (typeof value === "bigint") throw new TypeError("A BigInt value is not representable as JSON.");
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || typeof value !== "object" || durable.has(value)) return value;
  if (path.has(value)) throw new TypeError("A circular value is not representable as JSON.");
  path.add(value);
  let target = value as Record<string, unknown>;
  const write = (key: string, next: unknown) => {
    if (target === value && Object.isFrozen(value)) target = (Array.isArray(value) ? [...value] : { ...value }) as Record<string, unknown>;
    if (next === OMIT) delete target[key]; else target[key] = next;
  };
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const next = settle(value[index], true, path);
      if (next !== value[index] || !(index in value)) write(String(index), next);
    }
  } else {
    for (const key of Object.keys(value)) {
      const child = (value as Record<string, unknown>)[key], next = settle(child, false, path);
      if (next !== child) write(key, next);
    }
  }
  path.delete(value);
  Object.freeze(target);
  durable.add(target);
  return target;
}
