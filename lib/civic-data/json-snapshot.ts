/** Detach JSON data while sharing repeated values inside the snapshot. */
export function jsonSnapshot<T>(value: T): T {
  const copied = new WeakMap<object, unknown>(), active = new WeakSet<object>();
  const copy = (input: unknown, key: string): unknown => {
    if (input && typeof input === "object" && typeof (input as { toJSON?: unknown }).toJSON === "function") {
      input = (input as { toJSON(key: string): unknown }).toJSON(key);
    }
    if (typeof input === "bigint" || typeof input === "object" && input instanceof BigInt) throw new TypeError("BigInt is not JSON-representable");
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number") return Number.isFinite(input) ? input === 0 ? 0 : input : null;
    if (typeof input !== "object") return undefined;
    if (input instanceof Number || input instanceof String || input instanceof Boolean) return copy(input.valueOf(), key);
    if (active.has(input)) throw new TypeError("Circular value is not JSON-representable");
    if (copied.has(input)) return copied.get(input);
    const result: unknown[] | Record<string, unknown> = Array.isArray(input) ? [] : {};
    copied.set(input, result); active.add(input);
    if (Array.isArray(input)) {
      for (let index = 0; index < input.length; index++) (result as unknown[]).push(copy(input[index], String(index)) ?? null);
    } else for (const name of Object.keys(input)) {
      const child = copy((input as Record<string, unknown>)[name], name);
      if (child !== undefined) Object.defineProperty(result, name, { value: child, enumerable: true, writable: true, configurable: true });
    }
    active.delete(input);
    return result;
  };
  const result = copy(value, "");
  if (result === undefined) throw new TypeError("The value is not JSON-representable");
  return result as T;
}
