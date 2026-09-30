/**
 * **EVERY CONTROL, WHAT IT PROMISES, AND WHETHER ANYTHING CAN CARRY IT OUT.**
 *
 * Each v6 control has one entry: its label, whether it is local or whole-system,
 * the rows its preview shows (what it affects, what changes, what it will NOT do,
 * cost, undo), and the words its final "Done" is allowed to use.
 *
 * `gateway` is the honest part. Only kinds whose effect the deployed
 * `/api/admin/action` registry actually performs carry a mapping. Everything else
 * carries a named `dependency` and, outside the sample preview, is shown with a
 * "not connected yet" reason instead of a Send button that would invent success
 * (Codex boundary note, 2026-09-28: "Do not send unsupported v6 action names").
 *
 * PURE.
 */
import type { ActionKind, DecisionSpec, Dependency, Hunt } from "./model.ts";
import { usd } from "./model.ts";

export interface PreviewItem {
  readonly id: string;
  readonly name: string;
  readonly where: string;
}

export interface PreviewContext {
  readonly target: string;
  readonly targetName: string;
  readonly scopeName: string;
  readonly scopeIsCountry: boolean;
  readonly matching?: readonly PreviewItem[];
  readonly hunt?: Hunt | null;
  readonly decision?: DecisionSpec;
  readonly fix?: { readonly id: string; readonly title: string; readonly owner: string; readonly resourcesNow: string; readonly helps: string; readonly needsCode: boolean };
  readonly url?: string;
  /** The words a send-agents instruction carries. */
  readonly words?: string;
  /** The live count, when the server supplies one. */
  readonly waitingCount?: number | null;
  readonly outreachAuthorized: boolean;
}

export interface PreviewOption {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  /** Why this option cannot be chosen, when it cannot. */
  readonly blocked?: string;
  readonly ownWords?: boolean;
}

export interface Preview {
  readonly title: string;
  readonly level: "local" | "global";
  readonly rows: readonly (readonly [string, string])[];
  readonly options?: readonly PreviewOption[];
  readonly items?: readonly PreviewItem[];
  /** A number the owner types (a hunt's lifetime limit). */
  readonly amount?: { readonly label: string; readonly initial: string };
  /** A problem with what was entered, or null. */
  readonly invalid?: (input: { readonly option: string | null; readonly words: string; readonly amount: string; readonly selected: number }) => string | null;
}

/** A deployed registry action that already carries this control out (inputs: contract.ts `actionInput`). */
export interface GatewayMapping {
  readonly type: string;
}

export interface ActionDef {
  readonly kind: ActionKind;
  readonly label: string;
  /** Which permission beyond "can change things" this needs. */
  readonly needs: "owner" | "spend";
  /** What a final Done means, in words that never overclaim. */
  readonly doneWords: string;
  readonly preview: (ctx: PreviewContext) => Preview;
  readonly gateway: GatewayMapping | null;
  readonly dependency: Dependency | null;
}

/* ---------------------------------------------------------- dependencies */

export const DEP = {
  typedPlans: {
    id: "DEP-ACTION-PLANS",
    owner: "Codex (gateway)",
    need: "A typed action in /api/admin/action that carries this out and reports what it changed. The registry has no such action yet, so nothing is sent.",
  },
  resources: {
    id: "DEP-RESOURCE-EXECUTOR",
    owner: "Codex (scheduler and engineering intake)",
    need: "A resource request that the real scheduler or engineering intake accepts, assigns and reports back. Until it exists, no request is sent and nothing is simulated.",
  },
  engineering: {
    id: "DEP-ENGINEERING-TASKS",
    owner: "Codex (engineering-task adapter)",
    need: "An authorized connection to the engineering task tracker that reports created → accepted → implemented → tested → released → workers using it → checked on the public page.",
  },
  readerCheck: {
    id: "DEP-READER-CHECK",
    owner: "Codex (MW-011 reader proof)",
    need: "An action that opens the exact public card and compares it with what was published. The existing “Read this back now” only rereads saved state, so it is not used here.",
  },
  capture: {
    id: "DEP-SAVED-COPY",
    owner: "Codex (exact saved-copy route, default off)",
    need: "The exact saved-copy request route, enabled and deployed. A request receipt alone is not a downloadable copy.",
  },
  huntStart: {
    id: "DEP-HUNT-START",
    owner: "Codex (geography identity)",
    need: "The Census geography identity with its plan version for this place. `expansion.scope.set` needs it, and this screen does not have it yet.",
  },
  paidPause: {
    id: "DEP-PAID-PAUSE",
    owner: "Codex (gateway)",
    need: "A gateway action that pauses only paid research everywhere. Today’s registry can pause all workers, but not paid research on its own.",
  },
  receiptLookup: {
    id: "DEP-RECEIPT-LOOKUP",
    owner: "Codex (gateway)",
    need: "A read-only receipt lookup by action key, so “Check what happened” can ask without sending the action again.",
  },
} as const satisfies Record<string, Dependency>;

/* ----------------------------------------------------------------- words */

const COST_NONE = "None";
const WONT_DEPLOY = "Won’t deploy anything. The fix still has to be built, reviewed and released.";
const MODEL_ORDER = "Haiku 4.5, then Sonnet 5.5, then Opus 5.5";

function localOrGlobal(ctx: PreviewContext): "local" | "global" {
  return ctx.scopeIsCountry ? "global" : "local";
}

function waitingWords(ctx: PreviewContext): string {
  return ctx.waitingCount === undefined || ctx.waitingCount === null
    ? `Waiting work in ${ctx.scopeName}. The exact count comes from the server when you send.`
    : `${ctx.waitingCount.toLocaleString("en-US")} waiting items in ${ctx.scopeName}`;
}

function huntLeft(h: Hunt | null | undefined): string {
  if (!h) return "Paid calls stay inside each hunt’s existing limit. No budget increase.";
  return `Paid calls stay inside the ${h.name}’s existing limit (${usd(Math.max(0, h.limitUsd - h.spentUsd - h.heldUsd))} left). No budget increase.`;
}

/* --------------------------------------------------------------- catalog */

const defs: ActionDef[] = [
  {
    kind: "contain",
    label: "Hide the wrong records from this card",
    needs: "owner",
    doneWords: "Hidden from the card. The public card still has to be checked.",
    preview: (ctx) => ({
      title: `Hide the wrong records from ${ctx.targetName}`,
      level: "local",
      rows: [
        ["Affects", `One association: the link that attaches records from another place to ${ctx.targetName}`],
        ["What changes", "Those records stop showing on this card. They stay published on their own cards."],
        ["Won’t", "Won’t delete any record. Won’t fix the rule that caused it."],
        ["Undo", "Reversible from History. Before and after are both kept."],
        ["Cost", COST_NONE],
      ],
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "uncontain",
    label: "Undo: show those records on the card again",
    needs: "owner",
    doneWords: "Shown again, exactly as before.",
    preview: (ctx) => ({
      title: "Undo hiding the wrong records",
      level: "local",
      rows: [["What changes", `Reattaches the records to ${ctx.targetName}, exactly as before.`], ["Cost", COST_NONE]],
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "recheck",
    label: "Check the public page now",
    needs: "owner",
    doneWords: "Checked. The result is on the trail.",
    preview: (ctx) => ({
      title: `Check the public page for ${ctx.targetName}`,
      level: "local",
      rows: [
        ["Affects", "The exact public card for this result"],
        ["What changes", "Nothing. It opens the card and compares it with what we published."],
        ["Cost", "Free"],
        ["Result", "Match, mismatch (which becomes a stuck item), or no answer"],
      ],
    }),
    gateway: null,
    dependency: DEP.readerCheck,
  },
  {
    kind: "workfirst",
    label: "Put this work first",
    needs: "owner",
    doneWords: "Moved to the front of the line. Nothing new was created.",
    preview: (ctx) => ({
      title: "Put this work first",
      level: "local",
      rows: [
        ["Affects", `1 queued item: ${ctx.targetName}`],
        ["What changes", "Moves it to the front of the line. Creates nothing new."],
        ["Won’t", "Won’t run it early if what it waits on isn’t ready. It runs as soon as it can."],
        ["Cost", "Nothing by itself. It stays within the hunt’s limit."],
      ],
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "fixfirst",
    label: "Move up the list",
    needs: "owner",
    doneWords: "Moved up the engineering list. Nothing was deployed.",
    preview: (ctx) => ({
      title: `Move “${ctx.fix?.title ?? ctx.targetName}” up the engineering list`,
      level: "local",
      rows: [
        ["Affects", `${ctx.fix?.title ?? ctx.targetName}${ctx.fix ? ` (${ctx.fix.owner})` : ""}`],
        ["What changes", "Changes the order engineers work in. Nothing else."],
        ["Won’t", WONT_DEPLOY],
        ["What it helps", ctx.fix?.helps ?? "—"],
      ],
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "stopmethod",
    label: "Stop the failing method",
    needs: "owner",
    doneWords: "Stopped. The requirement is still owed and a repair is scheduled.",
    preview: (ctx) => ({
      title: `Stop the failing method for ${ctx.targetName}`,
      level: "local",
      rows: [
        ["Affects", "1 method on this item"],
        ["What changes", "Stops that method. The requirement stays owed and the item moves to Needs a software fix."],
        ["Won’t", "Won’t give up on the result. Attempts already charged stay charged."],
        ["Cost", "Saves further retries"],
      ],
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "scope-stop",
    label: "Stop failing methods here",
    needs: "owner",
    doneWords: "Stopped where it could be. Each requirement is still owed.",
    preview: (ctx) => ({
      title: `Stop the failing methods on matching items in ${ctx.scopeName}`,
      level: localOrGlobal(ctx),
      rows: [
        ["Affects", `Every item in ${ctx.scopeName} whose method keeps failing on a page format we can’t read. The server finds the full list when you send; the list below is what this page has loaded.`],
        ["What changes", "Stops each failing method. Every requirement stays owed, and each item gets a repair."],
        ["Won’t", "Won’t give up on any result. Attempts already charged stay charged."],
        ["Cost", "Saves further retries"],
      ],
      items: ctx.matching ?? [],
      invalid: ({ selected }) => (selected === 0 ? "Select at least one item." : null),
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "stoprepeats",
    label: "Stop repeats that can’t succeed",
    needs: "owner",
    doneWords: "Stopped the repeats. Every piece of work is still required.",
    preview: () => ({
      title: "Stop retries that repeat the same failing method",
      level: "global",
      rows: [
        ["Affects", "Every matching row in every state. The server counts them when you send."],
        ["What changes", "Stops each repeating method. Every piece of work is still required, and each one gets a repair or goes to engineers."],
        ["Won’t", "Won’t stop rows that are changing method between tries."],
        ["Cost", "Saves further retries"],
      ],
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "decide",
    label: "Decide",
    needs: "owner",
    doneWords: "Decision saved — change pending. The change itself is reported separately.",
    preview: (ctx) => ({
      title: ctx.decision?.question ?? `Decide about ${ctx.targetName}`,
      level: "local",
      rows: [
        ["Scope", "This item only"],
        ["After you decide", "Your decision is saved first. Carrying it out is a separate step, shown on the item. Facts that pass their checks still publish automatically."],
      ],
      options: (ctx.decision?.options ?? []).map((o) => ({
        id: o.id,
        label: o.label,
        note: o.note,
        ownWords: o.ownWords,
        blocked: o.outreach && !ctx.outreachAuthorized ? "Needs outreach permission, which this account doesn’t have. Nothing would be sent." : undefined,
      })),
      invalid: ({ option, words }) => {
        const chosen = ctx.decision?.options.find((o) => o.id === option);
        return chosen?.ownWords && !words.trim() ? "Say what you want in the box." : null;
      },
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "hunt-start",
    label: "Start a hunt here",
    needs: "spend",
    doneWords: "Hunt started. Done means it started, not that it’s finished.",
    preview: (ctx) => ({
      title: `Start a hunt in ${ctx.targetName}`,
      level: "local",
      rows: [
        ["Scope", ctx.targetName],
        ["Creates", "Checklist items for every government body we know of here. Work that already exists is moved, not copied. Shared statewide and national work is reused."],
        ["Spending", "Up to the limit below, in Anthropic use over the hunt’s life, including retries and money set aside for running work. Each call sets money aside before it starts, so work running at the same time can’t overspend."],
        ["Other costs", "Search and other services are tracked separately and add to the combined cost."],
        ["What “done” means", "The hunt has started. It’s finished only when every checklist item is delivered, proven unavailable at the source, or shown not to apply."],
        ["Needs", "Owner role with spending permission"],
      ],
      amount: { label: "Lifetime limit in dollars", initial: "25" },
      invalid: ({ amount }) => {
        const n = Number(amount);
        return !Number.isFinite(n) || n <= 0 ? "Enter a limit above $0." : null;
      },
    }),
    gateway: null,
    dependency: DEP.huntStart,
  },
  {
    kind: "hunt-pause",
    label: "Pause paid work",
    needs: "spend",
    doneWords: "Paused. Calls already running finish and are charged.",
    preview: (ctx) => ({
      title: `Pause paid work for ${ctx.targetName}`,
      level: "local",
      rows: [
        ["Scope", "This hunt only"],
        ["What changes", "No new paid calls for this hunt. Free plain-code work continues. Calls already running finish and are charged."],
        ["Keeps", "The hunt, its proof, its charges and the money set aside."],
      ],
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "hunt-resume",
    label: "Resume paid work",
    needs: "spend",
    doneWords: "Resumed within the remaining limit.",
    preview: (ctx) => ({
      title: `Resume paid work for ${ctx.targetName}`,
      level: "local",
      rows: [["Scope", "This hunt only"], ["What changes", "Paid work starts again, within the remaining limit."]],
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "hunt-limit",
    label: "Change the lifetime limit",
    needs: "spend",
    doneWords: "The new limit is saved. Spending so far is unchanged.",
    preview: (ctx) => {
      const h = ctx.hunt;
      const floor = h ? h.spentUsd + h.heldUsd : 0;
      return {
        title: `Change ${ctx.targetName}’s lifetime limit`,
        level: "local",
        rows: [
          ["Now", h ? `${usd(h.limitUsd)} lifetime · ${usd(floor)} spent or set aside` : "Not read"],
          ["Keeps", "The same hunt, its proof, its charges and the money set aside. Nothing resets."],
          ["Needs", "Owner role with spending permission"],
        ],
        amount: { label: "New lifetime limit in dollars", initial: h ? h.limitUsd.toFixed(2) : "" },
        invalid: ({ amount }) => {
          const n = Number(amount);
          if (!Number.isFinite(n) || n <= 0) return "Enter a limit above $0.";
          return n < floor ? "That’s below what’s already spent or set aside." : null;
        },
      };
    },
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "hunt-stop",
    label: "Stop this hunt",
    needs: "spend",
    doneWords: "Stopped. Money set aside but not used is returned.",
    preview: (ctx) => ({
      title: `Stop ${ctx.targetName}`,
      level: "local",
      rows: [
        ["What changes", "No new work for this hunt. Running calls finish and are charged. Money set aside but not used is returned."],
        ["Keeps", "Everything found stays published. Unfinished checklist items stay listed as missing."],
      ],
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "global-paid",
    label: "Pause all paid research",
    needs: "spend",
    doneWords: "Saved. Paid research pauses at the start of the next round.",
    preview: () => ({
      title: "Pause all paid research everywhere",
      level: "global",
      rows: [
        ["Scope", "Whole system: every hunt, every state"],
        ["What changes", "No new paid AI calls anywhere. Free plain-code work continues. Nothing is lost."],
      ],
    }),
    gateway: null,
    dependency: DEP.paidPause,
  },
  {
    kind: "global-runner-pause",
    label: "Pause all workers",
    needs: "owner",
    doneWords: "Pause saved. The workers stop starting new rounds after the one they are in; this page shows when they have.",
    preview: () => ({
      title: "Pause all workers everywhere",
      level: "global",
      rows: [
        ["Scope", "Whole system"],
        ["What changes", "Tells the workers to stop starting new rounds of work, paid and free."],
        ["Won’t", "Won’t stop work that is already running, and won’t touch the computer they run on."],
        ["Undo", "Let the workers start again."],
      ],
      invalid: ({ words }) => (words.length > 280 ? "Keep the note under 280 characters." : null),
    }),
    gateway: { type: "runner.pause" },
    dependency: null,
  },
  {
    kind: "global-runner-resume",
    label: "Let the workers start again",
    needs: "owner",
    doneWords: "Saved. The workers may start rounds again; it doesn’t start one immediately.",
    preview: () => ({
      title: "Let the workers start new rounds again",
      level: "global",
      rows: [
        ["Scope", "Whole system"],
        ["What changes", "Tells the workers they may start rounds again."],
        ["Won’t", "Won’t start a round immediately."],
      ],
      invalid: ({ words }) => (words.length > 280 ? "Keep the note under 280 characters." : null),
    }),
    gateway: { type: "runner.resume" },
    dependency: null,
  },
  {
    kind: "scope-first",
    label: "Put waiting work here first",
    needs: "owner",
    doneWords: "Moved the waiting work here to the front. Nothing new was created.",
    preview: (ctx) => ({
      title: `Put waiting work in ${ctx.scopeName} first`,
      level: localOrGlobal(ctx),
      rows: [
        ["Affects", waitingWords(ctx)],
        ["What changes", "Moves it to the front. Creates nothing."],
        ["Cost", "Nothing by itself"],
      ],
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "scope-recheck",
    label: "Recheck every public page here",
    needs: "owner",
    doneWords: "Rechecked. Any mismatch is now listed under What’s stuck.",
    preview: (ctx) => ({
      title: `Recheck every published card in ${ctx.scopeName}`,
      level: localOrGlobal(ctx),
      rows: [
        ["Affects", `Every card with published records in ${ctx.scopeName}`],
        ["What changes", "Nothing on the site. Mismatches become stuck items with evidence."],
        ["Cost", "Free"],
      ],
    }),
    gateway: null,
    dependency: DEP.readerCheck,
  },
  {
    kind: "doc-request",
    label: "Open the saved copy",
    needs: "owner",
    doneWords: "Ready. The saved copy is open below.",
    preview: (ctx) => ({
      title: `Open the saved copy of ${ctx.targetName}`,
      level: "local",
      rows: [
        ["What it is", "The exact bytes we saved, not the live page"],
        ["Access", "Private. Opening it is logged."],
      ],
    }),
    gateway: null,
    dependency: DEP.capture,
  },
  {
    kind: "use-url",
    label: "Use this official address",
    needs: "owner",
    doneWords: "Added as an official source. The public page changes only after new records pass their checks.",
    preview: (ctx) => ({
      title: `Use this address as an official source for ${ctx.targetName}`,
      level: "local",
      rows: [
        ["Affects", `The source list for ${ctx.targetName}`],
        ["What changes", `Adds ${ctx.url ? ctx.url : "the address you gave"} as a permitted official source. The workers look there on their next round. Saved evidence is kept.`],
        ["Won’t", "Won’t publish anything until its records pass the checks."],
        ["Cost", "Free to add. Reading it tries plain code first."],
      ],
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "reprocess",
    label: "Reprocess the evidence we already saved",
    needs: "owner",
    doneWords: "Reprocessed. The reader card still has to be checked.",
    preview: (ctx) => ({
      title: `Reprocess saved evidence in ${ctx.scopeName}`,
      level: localOrGlobal(ctx),
      rows: [
        ["Affects", `Saved files already held for ${ctx.scopeName}. No new download.`],
        ["What changes", "Sends them through pulling out facts, checks and publishing again, then checks the reader card."],
        ["Cost", "Plain code first. Any AI calls stay within each hunt’s limit."],
      ],
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "retry-method",
    label: "Try another permitted method",
    needs: "owner",
    doneWords: "Switched where another method exists. The rest went to a software fix.",
    preview: (ctx) => ({
      title: `Try another method for failing items in ${ctx.scopeName}`,
      level: localOrGlobal(ctx),
      rows: [
        ["Affects", `Every item in ${ctx.scopeName} stuck on a method that keeps failing`],
        ["What changes", "Pauses the failing method and tries the next permitted one. Each requirement stays owed."],
        ["If none is left", "The item moves to Needs a software fix, with its evidence."],
      ],
      items: ctx.matching ?? [],
      invalid: ({ selected }) => ((ctx.matching?.length ?? 0) > 0 && selected === 0 ? "Select at least one item." : null),
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "send-agents",
    label: "Send agents",
    needs: "owner",
    doneWords: "Sent. The next runner round puts this first, and its acknowledgement says what it matched and what work it created.",
    preview: (ctx) => ({
      title: `Send agents to ${ctx.targetName || ctx.scopeName}`,
      level: localOrGlobal(ctx),
      rows: [
        ["Affects", ctx.words ? `Work whose name matches: “${ctx.words}”` : `Waiting work in ${ctx.scopeName}`],
        ["What changes", "Tells the fleet where to go next. The runner puts what matches first and records what it matched. Where the words name a state, it also creates the work that state’s registry defines and no clock carries yet, bounded and counted."],
        ["Won’t", "Won’t publish anything or raise any limit. It can’t fix a missing software reader; that needs engineering."],
        ["Cost", "Nothing by itself. Work that needs an AI model waits for the paid lane and stays inside each hunt’s existing limit."],
        ["Undo", "Send it somewhere else. The later instruction is the one the next round reads."],
      ],
    }),
    gateway: { type: "fleet.deployHere" },
    dependency: null,
  },
  {
    kind: "cancel-send",
    label: "Take it back",
    needs: "owner",
    doneWords: "Saved as a request. It turns to Taken back only when the runner records that it stopped carrying it.",
    preview: (ctx) => ({
      title: "Take back a sent instruction",
      level: "global",
      rows: [
        ["Affects", ctx.words ? `The instruction “${ctx.words}”` : ctx.targetName || "The instruction you sent with Deploy fleet here"],
        ["What changes", "The runner stops carrying it: it creates no more work for it, and puts nothing first because of it."],
        ["Won’t", "Won’t undo work it already created or reordered, and won’t pause anything else."],
        ["Cost", "Nothing"],
        ["Undo", "Send the same words again. That is a new instruction."],
      ],
    }),
    gateway: { type: "fleet.cancelDispatch" },
    dependency: null,
  },
  {
    kind: "resume-publish",
    label: "Resume checks and publishing, then recheck the reader card",
    needs: "owner",
    doneWords: "Checks resumed. Published records and reader-card checks are listed separately.",
    preview: (ctx) => ({
      title: `Resume fact checks and publishing in ${ctx.scopeName}`,
      level: localOrGlobal(ctx),
      rows: [
        ["Affects", `Records in ${ctx.scopeName} that were collected but not yet checked or published`],
        ["What changes", "Resumes fact checks and publishing, then checks each exact reader card."],
        ["Cost", "Free: plain code"],
      ],
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "eng-task",
    label: "Create an engineering task",
    needs: "owner",
    doneWords: "Task created. Later stages come only from the tracker.",
    preview: (ctx) => ({
      title: `Create an engineering task for “${ctx.fix?.title ?? ctx.targetName}”`,
      level: "local",
      rows: [
        ["Task", ctx.fix?.title ?? ctx.targetName],
        ["Evidence", "The linked stuck items, the saved evidence and the exact reader observation"],
        ["Done when", "The linked stuck items clear and the exact reader card is checked and matches"],
        ["Owner", ctx.fix?.owner ?? "Engineering"],
      ],
    }),
    gateway: null,
    dependency: DEP.engineering,
  },
  {
    kind: "job-stop",
    label: "Stop this job",
    needs: "owner",
    doneWords: "Stopped after its current step. The requirement stays owed.",
    preview: (ctx) => ({
      title: `Stop “${ctx.targetName}” after its current step`,
      level: "local",
      rows: [
        ["What changes", "The job stops after its current step. Money set aside for it is returned once its last call settles."],
        ["Keeps", "The requirement stays owed, and the job can be picked up again."],
      ],
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "focus",
    label: "Focus more resources here",
    needs: "owner",
    doneWords: "Request accepted. The assignment itself is reported by the workers or engineers.",
    preview: (ctx) => {
      const opts: PreviewOption[] = [
        {
          id: "eng",
          label: "Assign more engineering time",
          note: "Engineers write and release the code fix. Moves back: other work for the same team waits longer. Limits the speed-up: only one engineer changes the same code at a time, so a second person works on tests and review. Cost: no AI spending; it uses engineering time.",
        },
        {
          id: "research",
          label: "Give its waiting research more worker slots",
          note: `Workers find, collect and check information. Moves back: slots come from lower-ranked waiting work in the same area. Limits the speed-up: slots only help work that’s ready to run. Cost: ${huntLeft(ctx.hunt)}`,
        },
        {
          id: "model",
          label: "Allow a stronger AI model for this work",
          note: `Moves up one step in the order ${MODEL_ORDER}, and the reason is saved. Moves back: nothing. Limits the speed-up: it only helps when the cheaper model’s answer failed its check. Cost: each call costs more, inside the same limit. No limit increase.`,
        },
      ];
      return {
        title: `Put more resources on: ${ctx.fix?.title ?? ctx.targetName}`,
        level: "local",
        rows: [
          ["Resources now", ctx.fix ? ctx.fix.resourcesNow : "Not reported by the backend yet"],
          ["Won’t", `Won’t raise any budget, start duplicate jobs, let two people change the same code, reset a limit, or skip a step in the AI model order (${MODEL_ORDER}).`],
          ["Who decides", "The scheduler or engineering intake checks availability, ownership and budget, then accepts, partly accepts or refuses with a reason. This page never assumes it happened."],
        ],
        options: opts,
      };
    },
    gateway: null,
    dependency: DEP.resources,
  },
];

export const ACTIONS: ReadonlyMap<ActionKind, ActionDef> = new Map(defs.map((d) => [d.kind, d]));

export function actionDef(kind: ActionKind): ActionDef {
  const d = ACTIONS.get(kind);
  if (!d) throw new Error(`unknown v6 action kind ${kind}`);
  return d;
}

/** The kinds a real executor can carry out today. */
export function connectedKinds(): readonly ActionKind[] {
  return defs.filter((d) => d.gateway !== null).map((d) => d.kind);
}
