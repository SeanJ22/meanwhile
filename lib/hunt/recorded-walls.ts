/**
 * Hosts that wall this client by a real access control on their pages (a
 * 401/403, a bot challenge, a login), recorded once so a wall does not cost a
 * request per walk. Never listed for a robots.txt line. Not requested at all,
 * robots.txt included. Data only.
 */
export const RECORDED_WALLS: readonly { readonly host: string; readonly why: string }[] = [];
