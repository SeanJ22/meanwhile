/** Tab memory only. Never localStorage, sessionStorage, a cookie, telemetry or a URL. */
let voterAddress: string | undefined;
export function setCivicVoterAddress(address: string | undefined) { voterAddress = address; }
export function civicVoterAddress() { return voterAddress; }
