import type { OfficeType } from "../officials/office-blurbs.ts";

/**
 * The routing map: topic domain → who can actually act, in escalation order. Curated and cited, never
 * inferred: each route names the body and office types that hold the power, with the statutory basis.
 *
 * Party never enters routing: `tests/routing.test.ts` asserts no route references party. A topic with no
 * mapped route returns the honest gap; a mapped route at a point where we hold no body or roster names
 * the general body that owns the topic.
 */

/** Which registry division types a routing step's body lives under. */
export type BodyTarget = "municipal" | "county" | "school_district";

/**
 * Per-division truth for a step, rendered only to readers whose own coverage includes that division, so
 * one jurisdiction's fact never reaches another's readers. The topic-template sibling of
 * `DIVISION_OFFICE_BLURBS`.
 */
export interface DivisionWhy {
  /** The division this copy belongs to. Full OCD id, never a name. */
  divisionOcdId: string;
  why: string;
  /** Where this division-specific claim was read, when it differs. */
  basis?: string;
}

export interface RouteStep {
  /** The kind of body that owns this step, in registry terms. */
  bodyTarget: BodyTarget | null;
  /** The office to talk to, in office-blurb terms (3d keys). */
  officeType: OfficeType | null;
  /**
   * Why this step, in the product's plain register. Jurisdiction-neutral, always: a shared template names
   * no place outside the reader's own. Place-specific truth goes in `divisionWhy`. Guarded in
   * `tests/jurisdiction-content.test.ts`.
   */
  why: string;
  /** Overrides for readers whose coverage includes the named division. */
  divisionWhy?: readonly DivisionWhy[];
}

export interface TopicRoute {
  id: string;
  label: string;
  /** Phrases a reader might use. */
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
        why: "Many library systems are county-run or county-funded, and in some places the county board doubles as the library district's own board — so the county board can act where the city cannot.",
        divisionWhy: [
          {
            divisionOcdId: "ocd-division/country:us/state:az/county:pima",
            why: "Here the library system is a county library district, and the county Board of Supervisors sits as its board — so the county board can act where the city cannot.",
            basis:
              "Pima County Board of Supervisors agenda, 2026-08-11, which convenes the Board as the Library District board (D19)",
          },
        ],
      },
    ],
    basis: "Municipal charters and county library-district statutes",
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
    id: "trash-recycling",
    label: "Trash and recycling",
    examples: [
      "missed garbage pickup",
      "recycling schedule",
      "bulk trash",
      "illegal dumping",
    ],
    steps: [
      {
        bodyTarget: "municipal",
        officeType: "city-council",
        why: "Inside a city or borough, trash and recycling are a city service — the service line fixes a missed pickup fastest, and your council member answers for the service.",
      },
      {
        bodyTarget: "county",
        officeType: "county-commissioner",
        why: "Outside city limits, collection is often private or county-coordinated — the county board sets what's offered.",
      },
    ],
    basis: "Municipal charters and sanitation ordinances; county solid-waste authority",
  },
  {
    id: "water-sewer",
    label: "Water and sewer",
    examples: [
      "water main break",
      "sewer backup",
      "water bill question",
      "no water pressure",
    ],
    steps: [
      {
        bodyTarget: "municipal",
        officeType: "city-council",
        why: "Where the city runs the water utility, the utility's own line handles leaks and bills — the council votes its rates.",
      },
      {
        bodyTarget: "county",
        officeType: "county-commissioner",
        why: "Sewer systems are often county-run; the county board oversees the wastewater utility.",
      },
    ],
    basis: "Municipal utility charters; county wastewater statutes",
  },
  {
    id: "noise",
    label: "Noise complaints",
    examples: ["loud music at night", "construction noise", "noisy neighbors"],
    steps: [
      {
        bodyTarget: "municipal",
        officeType: "city-council",
        why: "Noise rules are city ordinances — the police non-emergency line handles tonight's noise; your council member owns the ordinance itself.",
      },
      {
        bodyTarget: "county",
        officeType: "county-commissioner",
        why: "Outside city limits the sheriff responds, under rules the county board sets.",
      },
    ],
    basis: "Municipal noise ordinances; county code and sheriff authority",
  },
  {
    id: "animals",
    label: "Animals and pets",
    examples: [
      "stray dog",
      "barking dog next door",
      "dog license",
      "found a cat",
    ],
    steps: [
      {
        bodyTarget: "county",
        officeType: "county-commissioner",
        why: "Animal care and control usually runs at the county level — one shelter and field service for the whole area.",
      },
      {
        bodyTarget: "municipal",
        officeType: "city-council",
        why: "Some towns keep their own animal control officer and license dogs at town hall.",
      },
    ],
    basis: "County animal-control statutes; municipal licensing ordinances",
  },
  {
    id: "parks",
    label: "Parks and playgrounds",
    examples: [
      "broken playground equipment",
      "park maintenance",
      "pool hours",
      "reserve a pavilion",
    ],
    steps: [
      {
        bodyTarget: "municipal",
        officeType: "city-council",
        why: "City parks are a city department — its own line handles maintenance and reservations, and the council votes its budget.",
      },
      {
        bodyTarget: "county",
        officeType: "county-commissioner",
        why: "Regional parks and trails belong to the county park system.",
      },
    ],
    basis: "Municipal charters; county park district statutes",
  },
  {
    id: "snow-removal",
    label: "Snow removal",
    examples: ["street not plowed", "plow damage", "ice on the road"],
    steps: [
      {
        bodyTarget: "municipal",
        officeType: "city-council",
        why: "The town's road crew plows town roads — the public-works or highway line is the fastest call.",
      },
      {
        bodyTarget: "county",
        officeType: "county-commissioner",
        why: "County roads are the county crew's; numbered state routes are the state's.",
      },
    ],
    basis: "Municipal public-works charters; county and state highway statutes",
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
