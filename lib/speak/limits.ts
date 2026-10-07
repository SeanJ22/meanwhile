/**
 * The Speak cap, in a file the client can import (`lib/db/speak.ts` pulls in
 * `node:crypto` and the database). The write path re-checks it server-side.
 */
export const SPEAK_MAX_CHARS = 2000;
