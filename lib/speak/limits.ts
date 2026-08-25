/**
 * **BC-11 — the cap, in a file the CLIENT can import.**
 *
 * `lib/db/speak.ts` imports `node:crypto` and the database handle, so a client
 * component that pulled the constant from there would drag the whole write
 * path into the browser bundle. One number, one home, both sides read it —
 * which is the rule the legend/gutter pair in `globals.css` earned the hard
 * way: two rules that must agree on a number may not each hold their own copy.
 *
 * The write path re-checks it server-side regardless. A cap enforced only at
 * the edge is not a cap.
 */
export const SPEAK_MAX_CHARS = 2000;
