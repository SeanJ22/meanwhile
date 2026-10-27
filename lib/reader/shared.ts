/** Repeated values travel once. References are expanded at the reader boundary. */
export function shareReaderValues<T extends object>(value: T): T & { readerShared: unknown[]; readerKeys: string[][] } {
  const counts = new Map<string, number>();
  const objectKeys = new WeakMap<object, string>();
  const key = (value: unknown): string => {
    if (!value || typeof value !== "object" && typeof value !== "string") return "";
    if (typeof value === "object" && objectKeys.has(value)) return objectKeys.get(value)!;
    const text = JSON.stringify(value), bounded = text.length <= 65_536 ? text : "";
    if (typeof value === "object") objectKeys.set(value, bounded);
    return bounded;
  };
  const count = (value: unknown) => {
    const text = key(value);
    if (text.length > 16) counts.set(text, (counts.get(text) ?? 0) + 1);
    if (Array.isArray(value)) value.forEach(count);
    else if (value && typeof value === "object") Object.values(value).forEach(count);
  };
  count(value);
  const shared: unknown[] = [], indexes = new Map<string, number>();
  const pack = (value: unknown, root = false): unknown => {
    const text = key(value), repeated = !root && (counts.get(text) ?? 0) > 1;
    if (repeated && indexes.has(text)) return { $r: indexes.get(text) };
    const packed = Array.isArray(value) ? value.map(item => pack(item))
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([name, item]) => [name, pack(item)])) : value;
    if (!repeated) return packed;
    const index = shared.length;
    indexes.set(text, index); shared.push(packed);
    return { $r: index };
  };
  const packed = { ...pack(value, true) as T, readerShared: shared };
  const entries = (value: object) => Object.entries(value).filter(([, item]) => item !== undefined && typeof item !== "function" && typeof item !== "symbol");
  // Member and citation rows repeat their field names even when every value differs.
  const shapes = new Map<string, number>();
  const countShapes = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(countShapes); return; }
    const own = entries(value), shape = JSON.stringify(own.map(([name]) => name));
    if (shape.length > 20) shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
    own.forEach(([, item]) => countShapes(item));
  };
  countShapes(packed);
  const layouts: string[][] = [], layoutIndexes = new Map<string, number>();
  const fields = (value: unknown, root = false): unknown => {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(item => fields(item));
    const own = entries(value), names = own.map(([name]) => name), shape = JSON.stringify(names), values = own.map(([, item]) => fields(item));
    if (!root && (shapes.get(shape) ?? 0) > 1) {
      let index = layoutIndexes.get(shape);
      if (index === undefined) { index = layouts.length; layouts.push(names); layoutIndexes.set(shape, index); }
      return { $o: [index, ...values] };
    }
    return Object.fromEntries(names.map((name, index) => [name, values[index]]));
  };
  return { ...fields(packed, true) as T & { readerShared: unknown[] }, readerKeys: layouts };
}

/** Self-contained so the pre-hydration reader can use the same decoder. */
export function expandReaderValues<T>(input: T): T {
  if (!input || typeof input !== "object" || !("readerShared" in input) || !Array.isArray(input.readerShared)) return input;
  const shared = input.readerShared as unknown[], resolved = new Map<number, unknown>();
  const layouts = "readerKeys" in input && Array.isArray(input.readerKeys) ? input.readerKeys as string[][] : [];
  const expand = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    if (!Array.isArray(value) && Object.keys(value).length === 1 && "$o" in value && Array.isArray(value.$o)) {
      const [index, ...values] = value.$o, names = layouts[index];
      if (!Number.isInteger(index) || !names || values.length !== names.length) throw new Error("Invalid reader fields");
      return Object.fromEntries(names.map((name, at) => [name, expand(values[at])]));
    }
    if (!Array.isArray(value) && Object.keys(value).length === 1 && "$r" in value) {
      const index = value.$r;
      if (!Number.isInteger(index) || Number(index) < 0 || Number(index) >= shared.length) throw new Error("Invalid reader reference");
      if (!resolved.has(Number(index))) resolved.set(Number(index), expand(shared[Number(index)]));
      return resolved.get(Number(index));
    }
    return Array.isArray(value) ? value.map(expand)
      : Object.fromEntries(Object.entries(value).filter(([name]) => name !== "readerShared" && name !== "readerKeys").map(([name, item]) => [name, expand(item)]));
  };
  return expand(input) as T;
}
