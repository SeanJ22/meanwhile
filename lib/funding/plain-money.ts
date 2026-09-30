/**
 * "$4.2 million", "$657,000", "$325" — rounded the way people say money.
 *
 * Its own module so the client money view (components/funding) and the
 * server display projection (lib/funding/display.ts) share ONE rounding rule
 * without the client importing the server data plane.
 */
export function plainMoney(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    const millions = amount / 1_000_000;
    const rounded = millions >= 10 ? Math.round(millions) : Math.round(millions * 10) / 10;
    return `$${rounded} million`;
  }
  if (abs >= 10_000) return `$${(Math.round(amount / 1000) * 1000).toLocaleString("en-US")}`;
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}
