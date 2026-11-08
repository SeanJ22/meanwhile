import type { StateResultFeed } from "@/lib/election-results/feed-types";

export interface ResultChoice {
  id: string;
  aliases?: readonly string[];
  name: string;
}

export type ResultSlotProps =
  | { kind: "contest"; id: string; aliases?: readonly string[]; title: string; ocdId: string; voteFor: number | null; choices: readonly ResultChoice[] }
  | { kind: "candidate"; id: string; aliases?: readonly string[]; contestId: string; incumbent: boolean }
  | { kind: "measure"; id: string; aliases?: readonly string[]; measureId?: string; measureAliases?: readonly string[]; title: string; ocdId: string }
  | { kind: "summary" };

export type ResultFeedResponse = { available: boolean } & Pick<StateResultFeed, "state" | "facts"> & Partial<StateResultFeed>;
export type ResultViewProps = ResultSlotProps & { feed: ResultFeedResponse };
