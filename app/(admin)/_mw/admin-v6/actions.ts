/** `gateway` maps the kinds the deployed `/api/admin/action` registry performs; any other control carries a named `dependency`. */
import type { ActionKind, DecisionSpec, Dependency, Hunt } from "./model.ts";
import { usd } from "./model.ts";
import { addableFamilies } from "@/lib/coverage/owed-overlay.ts";
import { RECIPES } from "@/lib/control-plane/data-business/recipes.ts";
import { audienceWords } from "@/lib/control-plane/data-business/types.ts";
import { MODEL_TIERS, tierShortName } from "@/lib/models.ts";

/** A data switch's target is `<recipe>@<audience>`: the number's label and who it is for, in words. */
function switchWords(target: string): { readonly label: string; readonly who: string } {
  const at = target.indexOf("@");
  const id = at < 0 ? target : target.slice(0, at);
  return { label: RECIPES.find((r) => r.id === id)?.label ?? id, who: audienceWords(at < 0 ? "" : target.slice(at + 1)) };
}

export function isZipPlace(target: string): boolean {
  return /^geo:[a-z]{2}\.zcta\.\d{5}$/.test(target);
}

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
  readonly words?: string;
  readonly waitingCount?: number | null;
  readonly outreachAuthorized: boolean;
  readonly payload?: Readonly<Record<string, string>>;
}

export interface PreviewOption {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly blocked?: string;
  readonly ownWords?: boolean;
}

export interface Preview {
  readonly title: string;
  readonly level: "local" | "global";
  readonly rows: readonly (readonly [string, string])[];
  readonly options?: readonly PreviewOption[];
  readonly items?: readonly PreviewItem[];
  readonly amount?: { readonly label: string; readonly initial: string; readonly text?: boolean };
  readonly note?: boolean;
  readonly invalid?: (input: { readonly option: string | null; readonly words: string; readonly amount: string; readonly selected: number }) => string | null;
}

export interface GatewayMapping {
  readonly type: string;
  /** The registry action quotes the rendered state; the executor sends the latest pulse revision. */
  readonly requiresStateVersion?: boolean;
}

export interface ActionDef {
  readonly kind: ActionKind;
  readonly label: string;
  readonly needs: "owner" | "spend";
  readonly doneWords: string;
  readonly preview: (ctx: PreviewContext) => Preview;
  readonly gateway: GatewayMapping | null;
  readonly dependency: Dependency | null;
}

export const DEP = {
  typedPlans: {
    id: "DEP-ACTION-PLANS",
    owner: "Codex (gateway)",
    need: "A typed action in /api/admin/action.",
  },
  resources: {
    id: "DEP-RESOURCE-EXECUTOR",
    owner: "Codex (scheduler and engineering intake)",
    need: "A resource request the scheduler or engineering intake accepts.",
  },
  engineering: {
    id: "DEP-ENGINEERING-TASKS",
    owner: "Codex (engineering-task adapter)",
    need: "A connection to the engineering task tracker.",
  },
  readerCheck: {
    id: "DEP-READER-CHECK",
    owner: "Codex (MW-011 reader proof)",
    need: "An action that opens the public card and compares it with what was published.",
  },
  capture: {
    id: "DEP-SAVED-COPY",
    owner: "Codex (exact saved-copy route, default off)",
    need: "The saved-copy request route.",
  },
  receiptLookup: {
    id: "DEP-RECEIPT-LOOKUP",
    owner: "Codex (gateway)",
    need: "A read-only receipt lookup by action key.",
  },
} as const satisfies Record<string, Dependency>;

const COST_NONE = "None";
const MODEL_ORDER = MODEL_TIERS.map(tierShortName).join(", then ");

function localOrGlobal(ctx: PreviewContext): "local" | "global" {
  return ctx.scopeIsCountry ? "global" : "local";
}

function waitingWords(ctx: PreviewContext): string {
  return ctx.waitingCount === undefined || ctx.waitingCount === null
    ? `Waiting work in ${ctx.scopeName}`
    : `${ctx.waitingCount.toLocaleString("en-US")} waiting items in ${ctx.scopeName}`;
}

function huntLeft(h: Hunt | null | undefined): string {
  return h ? `${usd(Math.max(0, h.limitUsd - h.spentUsd - h.heldUsd))} left in the limit` : "—";
}

const defs: ActionDef[] = [
  {
    kind: "contain",
    label: "Hide the wrong records from this card",
    needs: "owner",
    doneWords: "Hidden from the card.",
    preview: (ctx) => ({
      title: `Hide the wrong records from ${ctx.targetName}`,
      level: "local",
      rows: [
        ["Affects", `The link that attaches records from another place to ${ctx.targetName}`],
        ["What changes", "Those records stop showing on this card"],
        ["Undo", "From History"],
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
    doneWords: "Shown again.",
    preview: (ctx) => ({
      title: "Undo hiding the wrong records",
      level: "local",
      rows: [["What changes", `Reattaches the records to ${ctx.targetName}`], ["Cost", COST_NONE]],
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "recheck",
    label: "Check the public page now",
    needs: "owner",
    doneWords: "Checked.",
    preview: (ctx) => ({
      title: `Check the public page for ${ctx.targetName}`,
      level: "local",
      rows: [
        ["Affects", "The public card for this result"],
        ["What changes", "Nothing"],
        ["Cost", "Free"],
        ["Result", "Match, mismatch or no answer"],
      ],
    }),
    gateway: null,
    dependency: DEP.readerCheck,
  },
  {
    kind: "workfirst",
    label: "Put this work first",
    needs: "owner",
    doneWords: "Moved to the front.",
    preview: (ctx) => ({
      title: "Put this work first",
      level: "local",
      rows: [
        ["Affects", `1 queued item: ${ctx.targetName}`],
        ["What changes", "Moves it to the front"],
        ["Cost", "Nothing by itself"],
      ],
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "fixfirst",
    label: "Move up the list",
    needs: "owner",
    doneWords: "Moved up.",
    preview: (ctx) => ({
      title: `Move “${ctx.fix?.title ?? ctx.targetName}” up the engineering list`,
      level: "local",
      rows: [
        ["Affects", `${ctx.fix?.title ?? ctx.targetName}${ctx.fix ? ` (${ctx.fix.owner})` : ""}`],
        ["What changes", "Changes the order engineers work in"],
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
    doneWords: "Stopped.",
    preview: (ctx) => ({
      title: `Stop the failing method for ${ctx.targetName}`,
      level: "local",
      rows: [
        ["Affects", "1 method on this item"],
        ["What changes", "Stops that method. The item moves to Needs a software fix."],
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
    doneWords: "Stopped.",
    preview: (ctx) => ({
      title: `Stop the failing methods on matching items in ${ctx.scopeName}`,
      level: localOrGlobal(ctx),
      rows: [
        ["Affects", `Every item in ${ctx.scopeName} whose method keeps failing on a page format we can’t read`],
        ["What changes", "Stops each failing method. Each item gets a repair."],
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
    doneWords: "Stopped.",
    preview: () => ({
      title: "Stop retries that repeat the same failing method",
      level: "global",
      rows: [
        ["Affects", "Every matching row in every state"],
        ["What changes", "Stops each repeating method. Each one gets a repair or goes to engineers."],
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
    doneWords: "Decision saved.",
    preview: (ctx) => ({
      title: ctx.decision?.question ?? `Decide about ${ctx.targetName}`,
      level: "local",
      rows: [
        ["Scope", "This item only"],
      ],
      options: (ctx.decision?.options ?? []).map((o) => ({
        id: o.id,
        label: o.label,
        note: o.note,
        ownWords: o.ownWords,
        blocked: o.outreach && !ctx.outreachAuthorized ? "Needs outreach permission." : undefined,
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
    doneWords: "Hunt started.",
    preview: (ctx) => ({
      title: `Start a hunt in ${ctx.targetName}`,
      level: "local",
      rows: [
        ["Scope", ctx.targetName],
        ["Creates", "Checklist items for every government body we know of here"],
        ["Spending", "Up to the limit below"],
        ["Needs", "Spending permission"],
      ],
      amount: { label: "Lifetime limit in dollars", initial: "25" },
      invalid: ({ amount }) => {
        const n = Number(amount);
        if (!isZipPlace(ctx.target)) return "A hunt starts from a ZIP.";
        return !Number.isFinite(n) || n <= 0 ? "Enter a limit above $0." : null;
      },
    }),
    gateway: { type: "expansion.scope.setMany" },
    dependency: null,
  },
  {
    kind: "hunt-start-many",
    label: "Start many hunts",
    needs: "spend",
    doneWords: "Hunts started.",
    preview: () => ({
      title: "Start many hunts",
      level: "global",
      rows: [
        ["Creates", "A hunt for each ZIP in the list, each with its own budget"],
      ],
    }),
    gateway: { type: "expansion.scope.setMany" },
    dependency: null,
  },
  {
    kind: "leads-send",
    label: "Send research leads",
    needs: "owner",
    doneWords: "Leads received.",
    preview: () => ({
      title: "Send research leads",
      level: "global",
      rows: [
        ["Creates", "One order with a row for each link"],
        ["Spending", "None to test the links"],
      ],
    }),
    gateway: { type: "leads.upload" },
    dependency: null,
  },
  {
    kind: "hunt-pause",
    label: "Pause paid work",
    needs: "spend",
    doneWords: "Paused.",
    preview: (ctx) => ({
      title: `Pause paid work for ${ctx.targetName}`,
      level: "local",
      rows: [
        ["Scope", "This hunt only"],
        ["What changes", "No new paid calls for this hunt"],
      ],
    }),
    gateway: { type: "expansion.scope.budget" },
    dependency: null,
  },
  {
    kind: "hunt-resume",
    label: "Resume paid work",
    needs: "spend",
    doneWords: "Resumed.",
    preview: (ctx) => ({
      title: `Resume paid work for ${ctx.targetName}`,
      level: "local",
      rows: [["Scope", "This hunt only"], ["What changes", "Paid work starts again"]],
    }),
    gateway: { type: "expansion.scope.budget" },
    dependency: null,
  },
  {
    kind: "hunt-limit",
    label: "Change the lifetime limit",
    needs: "spend",
    doneWords: "Limit saved.",
    preview: (ctx) => {
      const h = ctx.hunt;
      const floor = h ? h.spentUsd + h.heldUsd : 0;
      return {
        title: `Change ${ctx.targetName}’s lifetime limit`,
        level: "local",
        rows: [
          ["Now", h ? `${usd(h.limitUsd)} lifetime · ${usd(floor)} spent or set aside` : "—"],
          ["Needs", "Spending permission"],
        ],
        amount: { label: "New lifetime limit in dollars", initial: h ? h.limitUsd.toFixed(2) : "" },
        invalid: ({ amount }) => {
          const n = Number(amount);
          if (!Number.isFinite(n) || n <= 0) return "Enter a limit above $0.";
          return n < floor ? "That’s below what’s already spent or set aside." : null;
        },
      };
    },
    gateway: { type: "expansion.scope.budget" },
    dependency: null,
  },
  {
    kind: "hunt-stop",
    label: "Stop this hunt",
    needs: "spend",
    doneWords: "Stopped.",
    preview: (ctx) => ({
      title: `Stop ${ctx.targetName}`,
      level: "local",
      rows: [
        ["What changes", "No new work for this hunt"],
      ],
    }),
    gateway: { type: "expansion.scope.remove" },
    dependency: null,
  },
  {
    kind: "global-paid",
    label: "Pause all paid research",
    needs: "spend",
    doneWords: "Saved.",
    preview: () => ({
      title: "Pause all paid research everywhere",
      level: "global",
      rows: [
        ["Scope", "Whole system: every hunt, every state"],
        ["What changes", "No new paid AI calls anywhere"],
      ],
    }),
    gateway: { type: "research.pause" },
    dependency: null,
  },
  {
    kind: "global-paid-resume",
    label: "Resume paid research",
    needs: "spend",
    doneWords: "Saved.",
    preview: () => ({
      title: "Let paid research run again everywhere",
      level: "global",
      rows: [
        ["Scope", "Whole system: every hunt, every state"],
        ["What changes", "Paid AI calls may start again"],
      ],
    }),
    gateway: { type: "research.resume" },
    dependency: null,
  },
  {
    kind: "global-runner-pause",
    label: "Pause all workers",
    needs: "owner",
    doneWords: "Pause saved.",
    preview: () => ({
      title: "Pause all workers everywhere",
      level: "global",
      rows: [
        ["Scope", "Whole system"],
        ["What changes", "Workers stop starting new rounds"],
        ["Undo", "Let the workers start again"],
      ],
      invalid: ({ words }) => (words.length > 280 ? "Note is over 280 characters." : null),
    }),
    gateway: { type: "runner.pause" },
    dependency: null,
  },
  {
    kind: "global-runner-resume",
    label: "Let the workers start again",
    needs: "owner",
    doneWords: "Saved.",
    preview: () => ({
      title: "Let the workers start new rounds again",
      level: "global",
      rows: [
        ["Scope", "Whole system"],
        ["What changes", "Workers may start rounds again"],
      ],
      invalid: ({ words }) => (words.length > 280 ? "Note is over 280 characters." : null),
    }),
    gateway: { type: "runner.resume" },
    dependency: null,
  },
  {
    kind: "fix-go",
    label: "Go fix these",
    needs: "owner",
    doneWords: "Sent.",
    preview: () => ({
      title: "Send everything on the fix queue for engineering",
      level: "global",
      rows: [
        ["What changes", "Every item waiting on the fix queue is sent"],
      ],
    }),
    gateway: { type: "decision.record", requiresStateVersion: true },
    dependency: null,
  },
  {
    kind: "global-ceiling",
    label: "Set the daily budget",
    needs: "spend",
    doneWords: "Saved.",
    preview: (ctx) => ({
      title: "Set the most the workers may spend in any rolling 24 hours",
      level: "global",
      rows: [
        ["Scope", "Whole system: every hunt, every state"],
        ["What changes", "The ceiling the workers run under"],
        ["Undo", "From Settings"],
      ],
      amount: { label: "New daily budget in dollars (rolling 24 hours)", initial: ctx.payload?.amount ?? "" },
      invalid: ({ amount }) => {
        const n = Number(amount);
        return amount.trim() === "" || !Number.isFinite(n) || n <= 0 ? "Enter an amount above $0." : null;
      },
    }),
    gateway: { type: "config.setFleetSpendCeiling" },
    dependency: null,
  },
  {
    kind: "global-search-on",
    label: "Turn paid search on",
    needs: "spend",
    doneWords: "Saved.",
    preview: () => ({
      title: "Let the workers use paid search to find meeting sources",
      level: "global",
      rows: [
        ["Scope", "Whole system"],
        ["What changes", "Searching for sources may send paid search requests"],
        ["Costs", "Each request is charged"],
      ],
    }),
    gateway: { type: "config.setDiscoverySearch" },
    dependency: null,
  },
  {
    kind: "global-search-off",
    label: "Turn paid search off",
    needs: "spend",
    doneWords: "Saved.",
    preview: () => ({
      title: "Stop the workers using paid search",
      level: "global",
      rows: [
        ["Scope", "Whole system"],
        ["What changes", "No new paid search requests"],
      ],
    }),
    gateway: { type: "config.setDiscoverySearch" },
    dependency: null,
  },
  {
    kind: "scope-first",
    label: "Put waiting work here first",
    needs: "owner",
    doneWords: "Moved to the front.",
    preview: (ctx) => ({
      title: `Put waiting work in ${ctx.scopeName} first`,
      level: localOrGlobal(ctx),
      rows: [
        ["Affects", waitingWords(ctx)],
        ["What changes", "Moves it to the front"],
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
    doneWords: "Rechecked.",
    preview: (ctx) => ({
      title: `Recheck every published card in ${ctx.scopeName}`,
      level: localOrGlobal(ctx),
      rows: [
        ["Affects", `Every card with published records in ${ctx.scopeName}`],
        ["What changes", "Nothing on the site"],
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
    doneWords: "Ready.",
    preview: (ctx) => ({
      title: `Open the saved copy of ${ctx.targetName}`,
      level: "local",
      rows: [
        ["What it is", "The saved copy"],
        ["Access", "Private"],
      ],
    }),
    gateway: null,
    dependency: DEP.capture,
  },
  {
    kind: "use-url",
    label: "Use this official address",
    needs: "owner",
    doneWords: "Added.",
    preview: (ctx) => ({
      title: `Use this address as an official source for ${ctx.targetName}`,
      level: "local",
      rows: [
        ["Affects", `The source list for ${ctx.targetName}`],
        ["What changes", `Adds ${ctx.url ? ctx.url : "the address you gave"} as an official source`],
        ["Cost", "Free"],
      ],
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "reprocess",
    label: "Reprocess the evidence we already saved",
    needs: "owner",
    doneWords: "Reprocessed.",
    preview: (ctx) => ({
      title: `Reprocess saved evidence in ${ctx.scopeName}`,
      level: localOrGlobal(ctx),
      rows: [
        ["Affects", `Saved files already held for ${ctx.scopeName}`],
        ["What changes", "Pulls out facts, checks and publishes again"],
        ["Cost", "Plain code first"],
      ],
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "retry-method",
    label: "Try another permitted method",
    needs: "owner",
    doneWords: "Switched.",
    preview: (ctx) => ({
      title: `Try another method for failing items in ${ctx.scopeName}`,
      level: localOrGlobal(ctx),
      rows: [
        ["Affects", `Every item in ${ctx.scopeName} stuck on a method that keeps failing`],
        ["What changes", "Pauses the failing method and tries the next permitted one"],
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
    doneWords: "Sent.",
    preview: (ctx) => ({
      title: `Send agents to ${ctx.targetName || ctx.scopeName}`,
      level: localOrGlobal(ctx),
      rows: [
        ["Affects", ctx.words ? `Work whose name matches: “${ctx.words}”` : `Waiting work in ${ctx.scopeName}`],
        ["What changes", "The fleet puts what matches first"],
        ["Cost", "Nothing by itself. A budget below limits what this send may spend."],
        ["Undo", "Send it somewhere else"],
      ],
      amount: { label: "Budget for this send in dollars (optional, rolling 24 hours)", initial: "" },
      invalid: ({ amount }) => {
        if (amount.trim() === "") return null;
        const n = Number(amount);
        return !Number.isFinite(n) || n < 0 ? "Enter an amount of $0 or more, or leave it empty." : null;
      },
    }),
    gateway: { type: "fleet.deployHere" },
    dependency: null,
  },
  {
    kind: "target-set",
    label: "Set the target",
    needs: "owner",
    doneWords: "Saved.",
    preview: (ctx) => ({
      title: `Set a target for ${ctx.targetName || ctx.scopeName}`,
      level: localOrGlobal(ctx),
      rows: [
        ["Scope", ctx.targetName || ctx.scopeName],
        ["What changes", "Records the target for this place"],
        ["Undo", "Clear the target or set another"],
      ],
      amount: { label: "Target percent (1 to 100)", initial: "" },
      invalid: ({ amount }) => {
        const n = Number(amount);
        return amount.trim() === "" || !Number.isFinite(n) || n < 1 || n > 100 ? "Enter a percentage from 1 to 100." : null;
      },
    }),
    gateway: { type: "config.setPlaceTarget" },
    dependency: null,
  },
  {
    kind: "target-clear",
    label: "Clear the target",
    needs: "owner",
    doneWords: "Saved.",
    preview: (ctx) => ({
      title: `Clear the target for ${ctx.targetName || ctx.scopeName}`,
      level: localOrGlobal(ctx),
      rows: [
        ["What changes", "Removes the target"],
        ["Undo", "Set the target again"],
      ],
    }),
    gateway: { type: "config.setPlaceTarget" },
    dependency: null,
  },
  {
    kind: "data-switch-on",
    label: "Switch on",
    needs: "owner",
    doneWords: "Saved.",
    preview: (ctx) => {
      const { label, who } = switchWords(ctx.target);
      return {
        title: `Switch “${label}” on for ${who}`,
        level: "global",
        rows: [
          ["What changes", `${who === "Admin" ? "Admin" : `Anything that reads this number for ${who}`} can read “${label}”.`],
          ["Undo", "Switch it off"],
        ],
      };
    },
    gateway: { type: "config.setDataSwitch" },
    dependency: null,
  },
  {
    kind: "data-switch-off",
    label: "Switch off",
    needs: "owner",
    doneWords: "Saved.",
    preview: (ctx) => {
      const { label, who } = switchWords(ctx.target);
      return {
        title: `Switch “${label}” off for ${who}`,
        level: "global",
        rows: [
          ["What changes", `${who === "Admin" ? "Admin" : `Anything that reads this number for ${who}`} is refused “${label}” from the next read.`],
          ["Undo", "Switch it on again"],
        ],
      };
    },
    gateway: { type: "config.setDataSwitch" },
    dependency: null,
  },
  {
    kind: "cancel-send",
    label: "Take it back",
    needs: "owner",
    doneWords: "Requested.",
    preview: (ctx) => ({
      title: "Take back a sent instruction",
      level: "global",
      rows: [
        ["Affects", ctx.words ? `The instruction “${ctx.words}”` : ctx.targetName ? ctx.targetName : "The instruction you sent with Deploy fleet here"],
        ["What changes", "The runner stops carrying it"],
        ["Cost", "Nothing"],
        ["Undo", "Send the same words again"],
      ],
    }),
    gateway: { type: "fleet.cancelDispatch" },
    dependency: null,
  },
  {
    kind: "order-unschedule",
    label: "Cancel this scheduled order",
    needs: "owner",
    doneWords: "Cancelled.",
    preview: (ctx) => ({
      title: "Cancel a scheduled order",
      level: "global",
      rows: [
        ["Affects", ctx.targetName ? ctx.targetName : "The order you scheduled"],
        ["What changes", "It is never sent"],
        ["Cost", "Nothing"],
        ["Undo", "Send the order again"],
      ],
    }),
    gateway: { type: "orders.unschedule" },
    dependency: null,
  },
  {
    kind: "owed-add",
    label: "Add to what is owed",
    needs: "owner",
    doneWords: "Added.",
    preview: () => ({
      title: "Add to what every place is owed",
      level: "global",
      rows: [
        ["What changes", "The item is owed wherever its family applies, and counts in the score from the next read"],
        ["Cost", "Nothing is started; agents are sent separately"],
        ["Undo", "From the log in Settings"],
      ],
      options: addableFamilies().map((f) => ({ id: f.group, label: f.name, note: "" })),
      amount: { label: "What is owed", initial: "", text: true },
      note: true,
      invalid: ({ option, amount, words }) => option === null ? "Choose a family."
        : amount.trim().length < 4 ? "Say what is owed."
        : words.trim() === "" ? "Give the reason it is owed." : null,
    }),
    gateway: { type: "owed.add" },
    dependency: null,
  },
  {
    kind: "owed-decline",
    label: "Decline",
    needs: "owner",
    doneWords: "Declined.",
    preview: (ctx) => ({
      title: `Decline what was added to ${ctx.targetName}`,
      level: "local",
      rows: [
        ["Affects", ctx.payload?.what ?? "—"],
        ["What changes", "They are no longer owed there. Nothing we hold is deleted"],
        ["Undo", "From the log in Settings"],
      ],
      note: true,
      invalid: ({ words }) => (words.trim() === "" ? "Give the reason." : null),
    }),
    gateway: { type: "owed.decline" },
    dependency: null,
  },
  {
    kind: "owed-undo",
    label: "Undo",
    needs: "owner",
    doneWords: "Undone.",
    preview: (ctx) => ({
      title: "Undo a change to what is owed",
      level: "global",
      rows: [
        ["Undoes", ctx.payload?.what ?? "—"],
        ["What changes", "The next read counts what is owed as it was before"],
      ],
    }),
    gateway: { type: "owed.undo" },
    dependency: null,
  },
  {
    kind: "setting-set",
    label: "Change a setting",
    needs: "owner",
    doneWords: "Saved.",
    preview: (ctx) => {
      const control = ctx.payload?.control ?? "text";
      return {
        title: `Change: ${ctx.payload?.name ?? "—"}`,
        level: "global",
        rows: [
          ["Now", ctx.payload?.now ?? "—"],
          ["What changes", "The new value is saved with when it changed and the value before"],
          ["Undo", "From Settings"],
        ],
        ...(control === "choice"
          ? { options: (JSON.parse(ctx.payload?.choices ?? "[]") as {value:string;label:string}[]).map(choice => ({ id: choice.value, label: choice.label, note: "" })) }
          : control === "boolean"
          ? { options: [{ id: "on", label: "On", note: "" }, { id: "off", label: "Off", note: "" }] }
          : { amount: { label: control === "number" ? "New value" : control === "json" ? "New value (as data)" : "New wording", initial: ctx.payload?.current ?? "", text: control !== "number" } }),
        note: true,
        invalid: ({ amount, option }) => settingValueFromInput(control, amount, option) === undefined
          ? control === "choice" ? "Choose a value." : control === "number" ? "Enter a number." : control === "json" ? "Enter valid data." : control === "boolean" ? null : "Enter the new wording." : null,
      };
    },
    gateway: { type: "config.setSetting" },
    dependency: null,
  },
  {
    kind: "setting-undo",
    label: "Undo",
    needs: "owner",
    doneWords: "Undone.",
    preview: (ctx) => ({
      title: `Undo the last change to: ${ctx.payload?.name ?? "—"}`,
      level: "global",
      rows: [
        ["Now", ctx.payload?.now ?? "—"],
        ["Goes back to", ctx.payload?.valueWords ?? "—"],
      ],
      note: true,
    }),
    gateway: { type: "config.setSetting" },
    dependency: null,
  },
  {
    kind: "resume-publish",
    label: "Resume checks and publishing, then recheck the reader card",
    needs: "owner",
    doneWords: "Resumed.",
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
    doneWords: "Task created.",
    preview: (ctx) => ({
      title: `Create an engineering task for “${ctx.fix?.title ?? ctx.targetName}”`,
      level: "local",
      rows: [
        ["Task", ctx.fix?.title ?? ctx.targetName],
        ["Evidence", "The linked stuck items, the saved evidence and the reader observation"],
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
    doneWords: "Stopped.",
    preview: (ctx) => ({
      title: `Stop “${ctx.targetName}” after its current step`,
      level: "local",
      rows: [
        ["What changes", "The job stops after its current step"],
      ],
    }),
    gateway: null,
    dependency: DEP.typedPlans,
  },
  {
    kind: "focus",
    label: "Focus more resources here",
    needs: "owner",
    doneWords: "Request accepted.",
    preview: (ctx) => {
      const opts: PreviewOption[] = [
        {
          id: "eng",
          label: "Assign more engineering time",
          note: "Cost: engineering time, no AI spending",
        },
        {
          id: "research",
          label: "Give its waiting research more worker slots",
          note: `Cost: ${huntLeft(ctx.hunt)}`,
        },
        {
          id: "model",
          label: "Allow a stronger AI model for this work",
          note: `Moves up one step: ${MODEL_ORDER}`,
        },
      ];
      return {
        title: `Put more resources on: ${ctx.fix?.title ?? ctx.targetName}`,
        level: "local",
        rows: [
          ["Resources now", ctx.fix ? ctx.fix.resourcesNow : "—"],
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

export function connectedKinds(): readonly ActionKind[] {
  return defs.filter((d) => d.gateway !== null).map((d) => d.kind);
}

export function gatewayActionKind(type: string, evidence: { subject?: string; says?: string } = {}): ActionKind | null {
  if (type === "decision.record" && evidence.subject !== "fix-queue") return null;
  const candidates = defs.filter(definition => definition.gateway?.type === type);
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0].kind;
  const says = evidence.says ?? "";
  if (type === "expansion.scope.budget") return /is paused/.test(says) ? "hunt-pause" : /is resumed/.test(says) ? "hunt-resume" : "hunt-limit";
  if (type === "expansion.scope.setMany") return evidence.subject && /^geo:[a-z]{2}\.zcta\./.test(evidence.subject) ? "hunt-start" : "hunt-start-many";
  if (type === "config.setDiscoverySearch") return /\bOFF\b|turned off|is off/i.test(says) ? "global-search-off" : "global-search-on";
  if (type === "config.setPlaceTarget") return /is cleared/.test(says) ? "target-clear" : "target-set";
  if (type === "config.setDataSwitch") return /\bOFF\b|\boff\b/.test(says) ? "data-switch-off" : "data-switch-on";
  if (type === "config.setSetting") return "setting-set";
  return candidates[0].kind;
}

/**
 * A setting's new value from what was typed or chosen, or undefined when it does not parse.
 * The gateway still validates it against the setting's own rules.
 */
export function settingValueFromInput(control: string, amount: string, option: string | null): unknown {
  const typed = amount.trim();
  if (control === "choice") return option ?? undefined;
  if (control === "boolean") return option === "on" ? true : option === "off" ? false : undefined;
  if (control === "number") { const n = Number(typed); return typed !== "" && Number.isFinite(n) ? n : undefined; }
  if (control === "json") { try { return JSON.parse(typed) as unknown; } catch { return undefined; } }
  return typed === "" ? undefined : typed;
}
