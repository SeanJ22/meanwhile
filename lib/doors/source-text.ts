/** PostgreSQL JSONB cannot represent NUL. Keep source bytes intact and clean only
 * decoded values before they enter door records, source notes or projections. */
export function sourceTextWithoutNuls<T>(value: T): T {
  if (typeof value === "string") return value.replace(/\u0000/g, "") as T;
  if (Array.isArray(value)) return value.map(sourceTextWithoutNuls) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key.replace(/\u0000/g, ""), sourceTextWithoutNuls(child)])) as T;
  }
  return value;
}
