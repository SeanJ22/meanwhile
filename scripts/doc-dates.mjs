/**
 * Today in `America/Phoenix`, `YYYY-MM-DD`. `toISOString().slice(0, 10)`
 * would read a day ahead after 5pm Phoenix time. `en-CA` is used only because
 * it formats as ISO.
 */
export function today(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
