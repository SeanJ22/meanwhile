/**
 * "$4.2 million", "$657,000", "$325": rounded the way people say money. One
 * rule shared by the client money view and the server display projection.
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
