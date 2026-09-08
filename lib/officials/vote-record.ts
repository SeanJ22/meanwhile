/** Whether this officeholder id has a supported roll-call store. */
export function hasVoteRecord(id: string): boolean {
  return id.startsWith("congress:") || id.startsWith("plural:");
}
