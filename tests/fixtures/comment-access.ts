import { commentAccessFixture } from "./held-record-shapes.ts";
import DATA from "./comment-access.json" with { type: "json" };

/** Each body's held comment rules retain their source, date and original annotations. */
export const COMMENT_ACCESS = commentAccessFixture(DATA.records);
