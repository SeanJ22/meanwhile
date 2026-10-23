/** Share long source links and repeated evidence text within one place answer. */
export function encodeReaderValue(value: Record<string, unknown>): Record<string, unknown> {
  const sources: unknown[] = [], sourceIds = new Map<string, number>();
  const shareSources = (item: unknown): unknown => {
    if (item instanceof Date) return item.toJSON();
    if (Array.isArray(item)) return item.map(shareSources);
    if (!item || typeof item !== "object") return item;
    if ("sourceUrl" in item && ("quote" in item || "collectedAt" in item)) {
      const key = JSON.stringify(item);
      let id = sourceIds.get(key);
      if (id === undefined) { id = sources.length; sourceIds.set(key, id); sources.push(item); }
      return { $readerSource: id };
    }
    return Object.fromEntries(Object.entries(item).map(([key, held]) => [key, shareSources(held)]));
  };
  const shared = shareSources(value) as Record<string, unknown>;
  if (sources.length) shared.readerSources = sources;
  const counts = new Map<string, number>();
  const shapeCounts = new Map<string, number>();
  const count = (item: unknown): void => {
    if (typeof item === "string" && (item.length >= 40 || /^https?:\/\//.test(item))) counts.set(item, (counts.get(item) ?? 0) + 1);
    else if (Array.isArray(item)) item.forEach(count);
    else if (item && typeof item === "object") {
      const keys = Object.keys(item);
      if (keys.length >= 4) { const key = JSON.stringify(keys); shapeCounts.set(key, (shapeCounts.get(key) ?? 0) + 1); }
      Object.values(item).forEach(count);
    }
  };
  count(shared);
  const texts = [...counts].filter(([text, count]) => count > 1 || /^https?:\/\//.test(text)).map(([text]) => text);
  if (!texts.length && !sources.length) return value;
  const ids = new Map(texts.map((text, index) => [text, index]));
  const shapes = [...shapeCounts].filter(([, count]) => count > 1).map(([keys]) => JSON.parse(keys) as string[]);
  const shapeIds = new Map(shapes.map((keys, index) => [JSON.stringify(keys), index]));
  const pack = (item: unknown): unknown => {
    if (typeof item === "string" && ids.has(item)) return { $readerText: ids.get(item) };
    if (Array.isArray(item)) return item.map(pack);
    if (item && typeof item === "object") {
      const shape = shapeIds.get(JSON.stringify(Object.keys(item)));
      if (shape !== undefined) return { $readerObject: [shape, ...Object.values(item).map(pack)] };
      return Object.fromEntries(Object.entries(item).map(([key, held]) => [key, pack(held)]));
    }
    return item;
  };
  return { ...pack(shared) as Record<string, unknown>, readerTexts: texts, readerShapes: shapes };
}

/** Self-contained so the arriving HTML and boundary worker use the same decoder. */
export function decodeReaderValue<T>(value: T): T {
  if (!value || typeof value !== "object" || !("readerTexts" in value)) return value;
  const texts = (value as { readerTexts: unknown }).readerTexts;
  if (!Array.isArray(texts) || !texts.every(text => typeof text === "string")) throw new Error("Invalid reader text dictionary");
  delete (value as { readerTexts?: unknown }).readerTexts;
  const sources = (value as { readerSources?: unknown }).readerSources ?? [];
  if (!Array.isArray(sources)) throw new Error("Invalid reader source dictionary");
  delete (value as { readerSources?: unknown }).readerSources;
  const shapes = (value as { readerShapes?: unknown }).readerShapes ?? [];
  if (!Array.isArray(shapes) || !shapes.every(keys => Array.isArray(keys) && keys.every(key => typeof key === "string"))) throw new Error("Invalid reader object dictionary");
  delete (value as { readerShapes?: unknown }).readerShapes;
  const unpack = (item: unknown): unknown => {
    if (!item || typeof item !== "object") return item;
    if ("$readerObject" in item) {
      const packed = (item as { $readerObject: unknown }).$readerObject;
      if (!Array.isArray(packed) || !Number.isSafeInteger(packed[0]) || packed[0] < 0 || packed[0] >= shapes.length ||
        Object.keys(item).length !== 1 || packed.length !== shapes[packed[0]].length + 1) throw new Error("Invalid reader object reference");
      return Object.fromEntries(shapes[packed[0]].map((key: string, index: number) => [key, unpack(packed[index + 1])]));
    }
    if ("$readerSource" in item) {
      const index = (item as { $readerSource: unknown }).$readerSource;
      if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= sources.length || Object.keys(item).length !== 1)
        throw new Error("Invalid reader source reference");
      return unpack(sources[index]);
    }
    if ("$readerText" in item) {
      const index = (item as { $readerText: unknown }).$readerText;
      if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= texts.length || Object.keys(item).length !== 1)
        throw new Error("Invalid reader text reference");
      return texts[index];
    }
    for (const [key, held] of Object.entries(item)) (item as Record<string, unknown>)[key] = unpack(held);
    return item;
  };
  return unpack(value) as T;
}
