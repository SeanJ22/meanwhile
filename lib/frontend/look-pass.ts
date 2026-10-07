/**
 * When the commit the live site serves changes, one look pass runs on
 * production: each reader surface at a sampled published ZIP, on a phone and a
 * desktop. Each screen keeps its screenshot and page measurements, and the
 * look reviewer gives it a red or green verdict. A red flag becomes a
 * fix-list item pointing at its screenshot. A deploy's look entry is green
 * only when every screen was reviewed and none is red; this is reporting
 * only and holds back nothing.
 */
import type { PageIssueKind } from "../health/page-metrics.ts";
import type { LookQuestion, LookReviewOutcome } from "./look-review.ts";

/** Phone and desktop, the same sizes the speed pass and the resident tasks use. */
export const LOOK_PROFILES = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;
export type LookProfile = keyof typeof LOOK_PROFILES;

/** The reader surfaces a look pass shoots. Ask is left out: opening it costs a model call. */
export const LOOK_SURFACES = ["home", "ballot", "meetings", "officials"] as const;
export type LookSurface = (typeof LOOK_SURFACES)[number];

const SURFACE_WORDS: Record<LookSurface, string> = {
  home: "home page and map",
  ballot: "ballot page",
  meetings: "meetings list",
  officials: "officials list",
};

export interface LookTarget {
  readonly surface: LookSurface;
  readonly zip: string;
  readonly profile: LookProfile;
}

/** Every surface at every sampled ZIP on both sizes, surfaces first so a short pass still covers each one. */
export function lookTargets(zips: readonly string[], surfaces: readonly LookSurface[] = LOOK_SURFACES): LookTarget[] {
  return zips.flatMap((zip) => surfaces.flatMap((surface) => (Object.keys(LOOK_PROFILES) as LookProfile[]).map((profile) => ({ surface, zip, profile }))));
}

/** A label a person would use, and what the reviewer is told the screen is. */
export function screenLabel(t: LookTarget): string {
  return `${SURFACE_WORDS[t.surface]}, ${t.profile === "phone" ? "phone" : "desktop"} (${LOOK_PROFILES[t.profile].width} wide)`;
}

/** Where a screenshot goes: under the prefix only signed-in Admin can read (lib/photos/store.ts). */
export function lookShotKey(sha: string, at: string, t: LookTarget): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "-");
  return `resident-tasks/look/${at.slice(0, 10)}/${safe(sha.slice(0, 12))}/${t.surface}-${safe(t.zip)}-${t.profile}.png`;
}

/* ------------------------------------------------------------- the pass */

export type ScreenVerdictWord = "red" | "green" | "not reviewed";

export interface LookScreen {
  readonly surface: LookSurface;
  readonly zip: string;
  readonly profile: LookProfile;
  readonly label: string;
  /** Blob key of the screenshot; null when the screen could not be shot. */
  readonly shot: string | null;
  /** Page measurement issues by kind, counted. */
  readonly issues: Partial<Record<PageIssueKind, number>>;
  /** The first measurement sentences, for the fix item and Admin. */
  readonly issueLines: readonly string[];
  /** Why the screen could not be shot, when it could not. */
  readonly failed: string | null;
  readonly verdict: ScreenVerdictWord;
  /** The element a red verdict names. */
  readonly element: string | null;
  readonly answers: Partial<Record<LookQuestion, string>>;
  /** The fix-list item a red flag opened. */
  readonly fixId: string | null;
}

export type LookEntryVerdict = "green" | "red" | "not reviewed";

export interface LookPass {
  /** The commit the live site served when the pass ran. */
  readonly sha: string;
  readonly at: string;
  readonly runId: string;
  readonly zips: readonly string[];
  readonly screens: readonly LookScreen[];
  readonly red: number;
  readonly green: number;
  readonly notReviewed: number;
  /** Why the reviewer did not run, in plain words; null when it ran. */
  readonly reviewerSays: string | null;
  readonly verdict: LookEntryVerdict;
}

export interface ShotScreen {
  readonly target: LookTarget;
  readonly shot: string | null;
  readonly issues: Partial<Record<PageIssueKind, number>>;
  readonly issueLines: readonly string[];
  readonly failed: string | null;
}

const NOT_RUN_WORDS: Record<Extract<LookReviewOutcome, { kind: "NOT_RUN" }>["why"], string> = {
  "no-model": "The look reviewer was not run: no model is set up on the runner.",
  "no-spend-authority": "The look reviewer was not run: the runner could not check the budget.",
  "spend-refused": "The look reviewer was held: the model spending limit set in Admin leaves no room for it, or paid work is paused.",
  "no-screens": "The look reviewer was not run: no screen could be shot.",
  error: "The look reviewer's answer could not be read, so no screen was judged.",
};

/**
 * Join the shots with the reviewer's verdicts. `reviewed` lists the shots that
 * were sent, in order; a screen not sent (it failed to load) is "not reviewed".
 */
export function lookPass(input: {
  readonly sha: string; readonly at: string; readonly runId: string;
  readonly shots: readonly ShotScreen[];
  readonly reviewed: readonly ShotScreen[];
  readonly outcome: LookReviewOutcome;
}): LookPass {
  const verdictFor = new Map<ShotScreen, { verdict: "red" | "green"; element: string | null; answers: Record<LookQuestion, string> }>();
  if (input.outcome.kind === "REVIEWED") input.reviewed.forEach((s, i) => { const v = (input.outcome as Extract<LookReviewOutcome, { kind: "REVIEWED" }>).screens[i]; if (v) verdictFor.set(s, v); });
  const screens: LookScreen[] = input.shots.map((s) => {
    const v = verdictFor.get(s);
    return {
      surface: s.target.surface, zip: s.target.zip, profile: s.target.profile, label: screenLabel(s.target),
      shot: s.shot, issues: s.issues, issueLines: s.issueLines.slice(0, 5), failed: s.failed,
      verdict: v ? v.verdict : "not reviewed", element: v?.element ?? null, answers: v?.answers ?? {}, fixId: null,
    };
  });
  const red = screens.filter((s) => s.verdict === "red").length;
  const green = screens.filter((s) => s.verdict === "green").length;
  const notReviewed = screens.length - red - green;
  return {
    sha: input.sha, at: input.at, runId: input.runId,
    zips: [...new Set(input.shots.map((s) => s.target.zip))],
    screens, red, green, notReviewed,
    reviewerSays: input.outcome.kind === "NOT_RUN" ? NOT_RUN_WORDS[input.outcome.why] : null,
    verdict: red > 0 ? "red" : notReviewed > 0 || screens.length === 0 ? "not reviewed" : "green",
  };
}

/** Should a pass run now? Only when the served commit is known and has no look entry yet. */
export function lookOwed(servedSha: string | null, looked: ReadonlySet<string>): boolean {
  return servedSha !== null && /^[0-9a-f]{7,40}$/i.test(servedSha) && !looked.has(servedSha);
}

/* -------------------------------------------------------- the fix list */

export interface LookFixAdd {
  readonly where: string;
  readonly says: string;
}

/**
 * One fix-list item per red element on a surface and size. The fix list keys
 * items by where and what, so the same red seen on the next deploy is the same
 * item, and a red that comes back after a fix is marked as come back.
 */
export function lookFixAdds(pass: LookPass): { screen: LookScreen; add: LookFixAdd }[] {
  return pass.screens.filter((s) => s.verdict === "red").map((screen) => ({
    screen,
    add: {
      where: `The live site: the ${screen.label}`,
      says: `Looks wrong to the look reviewer: ${screen.element ?? "the screen"}.${screen.issueLines.length ? ` The page measurements also found: ${screen.issueLines.slice(0, 2).join(" ")}` : ""} The screenshot is with this deploy's look check.`,
    },
  }));
}

export function withFixIds(pass: LookPass, ids: ReadonlyMap<LookScreen, string>): LookPass {
  return { ...pass, screens: pass.screens.map((s) => (ids.has(s) ? { ...s, fixId: ids.get(s)! } : s)) };
}

/* ---------------------------------------------------------- Admin's view */

export interface LookScreenView {
  readonly label: string;
  readonly verdict: "Red" | "Green" | "Not reviewed";
  /** The reviewer's lines, or why the screen was not judged. */
  readonly says: string;
  readonly measured: string;
  readonly image: string | null;
  readonly fixId: string | null;
}

export interface LookView {
  /** The commit, for Technical details only. */
  readonly sha: string;
  readonly ran: string;
  readonly verdict: "Green" | "Red" | "Not reviewed";
  readonly summary: string;
  readonly screens: readonly LookScreenView[];
}

const ANSWER_WORDS: Record<LookQuestion, string> = {
  beautiful: "Beautiful?", easy: "Easy?", instant: "Instant?", come_back: "Would they come back?", show_a_friend: "Would they show a friend?",
};

function measuredWords(s: LookScreen): string {
  const n = Object.values(s.issues).reduce((a, b) => a + (b ?? 0), 0);
  if (s.failed) return "—";
  return n === 0 ? "No problems measured." : `${n} ${n === 1 ? "problem" : "problems"} measured: ${s.issueLines.slice(0, 3).join(" ")}`;
}

export function lookView(pass: LookPass | null, imageUrl: (key: string) => string): LookView | null {
  if (!pass) return null;
  const order: Record<ScreenVerdictWord, number> = { red: 0, "not reviewed": 1, green: 2 };
  const screens = [...pass.screens].sort((a, b) => order[a.verdict] - order[b.verdict]).map((s): LookScreenView => ({
    label: s.label,
    verdict: s.verdict === "red" ? "Red" : s.verdict === "green" ? "Green" : "Not reviewed",
    says: s.failed ? `The screen could not be shot: ${s.failed}.`
      : s.verdict === "not reviewed" ? (pass.reviewerSays ?? "Not judged.")
      : [s.verdict === "red" && s.element ? `At fault: ${s.element}.` : null, ...Object.entries(s.answers).map(([q, a]) => `${ANSWER_WORDS[q as LookQuestion]} ${a}`)].filter(Boolean).join(" "),
    measured: measuredWords(s),
    image: s.shot ? imageUrl(s.shot) : null,
    fixId: s.fixId,
  }));
  const total = pass.screens.length;
  const head = pass.verdict === "green" ? `All ${total} screens look right.`
    : pass.verdict === "red" ? `${pass.red} of ${total} screens look wrong; ${pass.green} look right.`
    : `${pass.green} of ${total} screens judged right; ${pass.notReviewed} not judged.`;
  return {
    sha: pass.sha,
    ran: pass.at,
    verdict: pass.verdict === "green" ? "Green" : pass.verdict === "red" ? "Red" : "Not reviewed",
    summary: `${head}${pass.reviewerSays ? ` ${pass.reviewerSays}` : ""}`,
    screens,
  };
}

/** The screenshots each fix-list item opened by a look check points at. */
export function lookShotsByFix(passes: readonly LookPass[], imageUrl: (key: string) => string): Map<string, { label: string; image: string }[]> {
  const out = new Map<string, { label: string; image: string }[]>();
  for (const pass of [...passes].sort((a, b) => b.at.localeCompare(a.at))) {
    for (const s of pass.screens) {
      if (!s.fixId || !s.shot || out.has(s.fixId)) continue;
      out.set(s.fixId, [{ label: s.label, image: imageUrl(s.shot) }]);
    }
  }
  return out;
}
