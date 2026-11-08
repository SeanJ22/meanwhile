/** Problems about the runner or the keeper themselves. Nothing downstream is trustworthy while one is open, so they lead the brief. */
export const isLineHealthKey = (key: string): boolean =>
  /^(?:line-keeper:)?(?:stalled-job:|runner-silent$|runner-jobs:|line-keeper-silent$|counts:unread$)/.test(key);
