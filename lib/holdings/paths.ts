/** Repository holdings paths, shared by producers and reader projections. */
export function stateHoldingPath(state: string, domain: string, file: string): string {
  if (!/^[a-z]{2}$/.test(state) || !/^[a-z][a-z-]*$/.test(domain) ||
      !file || file.split(/[\\/]/).some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Invalid state holding path: ${state}/${domain}/${file}`);
  }
  return `data/states/${state}/${domain}/${file}`;
}

/** The public copy is generated from the canonical holding before serving. */
export function stateServingUrl(state: string, domain: string, file: string): string {
  return stateHoldingPath(state, domain, file).replace(/^data\//, "/");
}
