import assert from "node:assert/strict";
import type { BodyRoster } from "../../lib/registry/body-rosters.ts";
import type { CommentAccess } from "../../lib/registry/comment-access-client.ts";

/** JSON widens string literals; all other fields retain the production type contract. */
export function bodyRosterFixture(value: (Omit<BodyRoster, "partisanship"> & { partisanship: string })[]): BodyRoster[] {
  return value.map(row => {
    const { partisanship } = row;
    assert.ok(partisanship === "PARTISAN" || partisanship === "NONPARTISAN" || partisanship === "UNDETERMINED");
    return { ...row, partisanship };
  });
}

export function commentAccessFixture(value: (Omit<CommentAccess, "commentPeriod"> & { commentPeriod: string })[]): CommentAccess[] {
  return value.map(row => {
    const { commentPeriod } = row;
    assert.ok(commentPeriod === "YES" || commentPeriod === "NO" || commentPeriod === "UNKNOWN");
    return { ...row, commentPeriod };
  });
}
