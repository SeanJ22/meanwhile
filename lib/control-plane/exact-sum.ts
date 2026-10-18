/** Shewchuk's partials (Python's math.fsum): the exactly rounded total in any order, and a subtraction undoes an addition.
 * Non-finite inputs are counted, so the value is what a plain sum of them gives. */
export interface ExactSum {
  readonly p: number[];
  nan?: number;
  pinf?: number;
  ninf?: number;
}

export const exactSum = (): ExactSum => ({ p: [] });

function grow(partials: number[], value: number): void {
  let x = value;
  let i = 0;
  for (let j = 0; j < partials.length; j += 1) {
    let y = partials[j]!;
    if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
    const hi = x + y;
    const lo = y - (hi - x);
    if (lo !== 0) partials[i++] = lo;
    x = hi;
  }
  partials.length = i;
  partials.push(x);
}

function count(sum: ExactSum, value: number, by: number): void {
  const key = Number.isNaN(value) ? "nan" : value > 0 ? "pinf" : "ninf";
  sum[key] = (sum[key] ?? 0) + by;
  if (sum[key] === 0) delete sum[key];
}

export function addExact(sum: ExactSum, value: number): void {
  if (Number.isFinite(value)) grow(sum.p, value);
  else count(sum, value, 1);
}

export function subtractExact(sum: ExactSum, value: number): void {
  if (Number.isFinite(value)) grow(sum.p, -value);
  else count(sum, value, -1);
}

export function mergeExact(into: ExactSum, from: ExactSum): void {
  for (const part of from.p) grow(into.p, part);
  for (const key of ["nan", "pinf", "ninf"] as const) if (from[key]) into[key] = (into[key] ?? 0) + from[key]!;
}

export function exactValue(sum: ExactSum): number {
  if ((sum.nan ?? 0) > 0 || ((sum.pinf ?? 0) > 0 && (sum.ninf ?? 0) > 0)) return Number.NaN;
  if ((sum.pinf ?? 0) > 0) return Number.POSITIVE_INFINITY;
  if ((sum.ninf ?? 0) > 0) return Number.NEGATIVE_INFINITY;
  const p = sum.p;
  let n = p.length;
  if (n === 0) return 0;
  let hi = p[--n]!;
  let lo = 0;
  while (n > 0) {
    const x = hi;
    const y = p[--n]!;
    hi = x + y;
    lo = y - (hi - x);
    if (lo !== 0) break;
  }
  /* Round half to even across the remaining partials, as fsum does. */
  if (n > 0 && ((lo < 0 && p[n - 1]! < 0) || (lo > 0 && p[n - 1]! > 0))) {
    const y = lo * 2;
    const x = hi + y;
    if (y === x - hi) hi = x;
  }
  return hi;
}
