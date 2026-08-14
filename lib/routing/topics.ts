import type { OfficeType } from "../officials/office-blurbs.ts";

/**
 * The routing map — Phase 9's knowledge half (6). Topic domain → who can
 * actually act, in escalation order. Curated and cited, never inferred:
 * each route names the body types and office types that hold the power,
 * with the statutory basis the claim compresses. The chat surface that will
 * sit on top of this is next session's work; nothing here renders yet.
 *
 * **Party can never enter routing.** A route is about which OFFICE holds
 * the power — `tests/routing.test.ts` asserts no route references party
 * and that resolution output is identical however party labels are set.
 *
 * **A07 applies in full**: a topic with no mapped route returns the honest
 * gap, never a guess; a mapped route at a point where we hold no body or
 * roster returns "we don't yet know enough here to route this — here is
 * the general body that owns this topic."
 */

/** Which registry division types a routing step's body lives under. */
export type BodyTarget = "municipal" | "county" | "school_district";

export interface RouteStep {
  /** The kind of body that owns this step, in registry terms. */
  bodyTarget: BodyTarget | null;
  /** The office to talk to, in office-blurb terms (3d keys). */
  officeType: OfficeType | null;
  /** Why this step, in the product's plain register. */
  why: string;
}

export interface TopicRoute {
  id: string;
  label: string;
  /** Phrases a reader might use. Matching is next session's chat work. */
  examples: string[];
  /** Steps in escalation order: who can act fastest first. */
  steps: RouteStep[];
  /** Where this allocation of power is defined. */
  basis: string;
}

export const TOPIC_ROUTES: readonly TopicRoute[] = [
  {
    id: "schools-operations",
    label: "How a school is being run",
    examples: [
      "problem with my kid's school",
      "teacher or principal issue",
      "school bus routes",
    ],
    steps: [
      {
        bodyTarget: "school_district",
        officeType: "superintendent",
        why: "Your superintendent runs the district day to day — staffing, buses, how a school operates.",
      },
      {
        bodyTarget: "school_district",
        officeType: "school-board",
        why: "The board hires and directs the superintendent; go here when the answer is about the rules, not the running.",
      },
    ],
    basis: "State education statutes (district governance)",
  },
  {
    id: "schools-policy",
    label: "What the school district decides",
    examples: [
      "curriculum decision",
      "school closing",
      "district boundaries",
      "school budget",
    ],
    steps: [
      {
        bodyTarget: "school_district",
        officeType: "school-board",
        why: "The board owns district policy, budget, boundaries, and openings and closings.",
      },
      {
        bodyTarget: null,
        officeType: "state-representative",
        why: "School funding formulas and education law are state law — your state representative votes on them.",
      },
    ],
    basis: "State education statutes (board powers)",
  },
  {
    id: "libraries",
    label: "Libraries",
    examples: [
      "they stopped building the library down the road",
      "library hours cut",
      "library funding",
    ],
    steps: [
      {
        bodyTarget: "municipal",
        officeType: "city-council",
        why: "City libraries are city budget lines — your council member votes on them and answers to your part of town.",
      },
      {
        bodyTarget: "county",
        officeType: "county-commissioner",
        why: "Many library systems are county-run or county-funded (in Pima County the county board sits as the Library District board), so the county board can act where the city cannot.",
      },
    ],
    basis:
      "Municipal charters and county library-district statutes; Pima's board-sitting-as-library-district is recorded in the 2026-08-11 agenda (D19)",
  },
  {
    id: "zoning-development",
    label: "What gets built near you",
    examples: [
      "rezoning next door",
      "new development",
      "data center coming",
      "warehouse proposal",
    ],
    steps: [
      {
        bodyTarget: "municipal",
        officeType: "city-council",
        why: "Inside a city, zoning is the council's vote — usually after a planning commission the council appoints.",
      },
      {
        bodyTarget: "county",
        officeType: "county-commissioner",
        why: "Outside city limits, the county board owns land use.",
      },
    ],
    basis: "State zoning enabling statutes; municipal charters",
  },
  {
    id: "roads-local",
    label: "Streets and roads",
    examples: ["pothole", "speeding on my street", "crosswalk", "streetlight out"],
    steps: [
      {
        bodyTarget: "municipal",
        officeType: "city-council",
        why: "City streets are city services — your council member moves service requests fastest.",
      },
      {
        bodyTarget: "county",
        officeType: "county-commissioner",
        why: "Unincorporated roads belong to the county.",
      },
      {
        bodyTarget: null,
        officeType: "state-representative",
        why: "Numbered state routes are the state's — your state representative can push the transportation department.",
      },
    ],
    basis: "Municipal charters; county highway statutes; state DOT authority",
  },
  {
    id: "property-taxes",
    label: "Property taxes",
    examples: ["property tax bill", "assessment too high", "tax rate"],
    steps: [
      {
        bodyTarget: "county",
        officeType: "county-commissioner",
        why: "The county sets its levy and runs the assessor's process the bill comes from.",
      },
      {
        bodyTarget: "school_district",
        officeType: "school-board",
        why: "The biggest slice of most property-tax bills is the school district's budget, which the board votes.",
      },
      {
        bodyTarget: null,
        officeType: "state-representative",
        why: "Assessment rules and caps are state law.",
      },
    ],
    basis: "State property-tax statutes; county and district budget law",
  },
  {
    id: "elections-voting",
    label: "Voting and elections",
    examples: ["polling place", "ballot problem", "voter registration"],
    steps: [
      {
        bodyTarget: "county",
        officeType: "county-commissioner",
        why: "Elections are run at the county level — the recorder or clerk under the county board.",
      },
      {
        bodyTarget: null,
        officeType: "state-representative",
        why: "Election law itself is state law.",
      },
    ],
    basis: "State election codes (county administration)",
  },
  {
    id: "state-law",
    label: "A state law you want changed",
    examples: ["state law", "statewide rule", "state agency not responding"],
    steps: [
      {
        bodyTarget: null,
        officeType: "state-representative",
        why: "Your state representative usually represents the smallest area, so your voice weighs most with them.",
      },
      {
        bodyTarget: null,
        officeType: "state-senator",
        why: "The same bill needs the senate — your state senator is the other half of the vote.",
      },
    ],
    basis: "The state constitution's legislative article",
  },
  {
    id: "federal",
    label: "A federal issue",
    examples: [
      "social security",
      "veterans benefits",
      "immigration case",
      "federal agency stuck",
    ],
    steps: [
      {
        bodyTarget: null,
        officeType: "us-representative",
        why: "Your representative's office does casework — they can push a federal agency on your behalf.",
      },
      {
        bodyTarget: null,
        officeType: "us-senator",
        why: "Senators' offices do the same statewide; go here if the House office stalls.",
      },
    ],
    basis: "U.S. Constitution, Article I; congressional casework practice",
  },
] as const;

export function routeForTopic(topicId: string): TopicRoute | null {
  return TOPIC_ROUTES.find((t) => t.id === topicId) ?? null;
}
