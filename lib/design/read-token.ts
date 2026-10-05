/** Resolve the same theme tokens for canvas and WebGL that CSS uses. */
export function readDesignToken(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) throw new Error(`Design token ${name} is not declared`);
  return value;
}
