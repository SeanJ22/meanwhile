/** Remove a venue heading and room directions only for geocoding; retain the published address for readers. */
export function censusAddressQuery(published: string): string {
  const street = /(?:^|[\r\n,;]|\bat\s+)\s*(\d+\s+[a-z][\s\S]*)/i.exec(published)?.[1];
  return (street ?? published).replace(/\s*\([^)]*\)\s*$/, "").trim();
}
