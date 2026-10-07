/**
 * Per-state answers to common mover questions. Each answer states the law in
 * one or two plain sentences cited to an official source, never characterizing
 * it.
 */

export interface AreaFact {
  topic: string;
  question: string;
  answer: string;
  sourceUrl: string;
  sourceOrg: string;
  /** How the URL was verified — "fetched <date>" or the recorded wall. */
  verification: string;
}

export interface AreaFactSet {
  state: string;
  stateName: string;
  facts: AreaFact[];
}

const FETCHED = "fetched 2026-08-14";
const AZ_FETCHED = "fetched 2026-08-23";
const NH_WALL =
  "NH state hosts 403 non-browser clients; page title verified in a real browser 2026-08-14";

export const AREA_FACTS: AreaFactSet[] = [
  {
    state: "NJ",
    stateName: "New Jersey",
    facts: [
      {
        topic: "marijuana",
        question: "Is marijuana legal?",
        answer:
          "Yes — adults 21 and over can buy and possess cannabis, sold at state-licensed dispensaries. Using it in public or driving under its influence remains illegal.",
        sourceUrl: "https://www.nj.gov/cannabis/",
        sourceOrg: "New Jersey Cannabis Regulatory Commission",
        verification: FETCHED,
      },
      {
        topic: "school-vaccinations",
        question: "What vaccinations do schools require?",
        answer:
          "Children need a set of routine immunizations to attend school or child care; New Jersey allows medical and religious exemptions with documentation.",
        sourceUrl: "https://www.nj.gov/health/cd/imm_requirements/",
        sourceOrg: "New Jersey Department of Health",
        verification: FETCHED,
      },
      {
        topic: "firearms",
        question: "What are the basics of carrying a firearm?",
        answer:
          "Carrying a handgun requires a Permit to Carry issued through the State Police, with training and application requirements; buying any firearm requires a purchaser identification card or pistol purchase permit.",
        sourceUrl: "https://njsp.njoag.gov/concealed-carry-permit/",
        sourceOrg: "New Jersey State Police",
        verification: FETCHED,
      },
      {
        topic: "income-tax",
        question: "Is there a state income tax?",
        answer:
          "Yes — New Jersey has a graduated state income tax on wages and other income, filed with the Division of Taxation.",
        sourceUrl: "https://www.nj.gov/treasury/taxation/",
        sourceOrg: "New Jersey Division of Taxation",
        verification: FETCHED,
      },
      {
        topic: "vehicle",
        question: "How long do I have to transfer my license and registration?",
        answer:
          "Within 60 days of moving in, or before your current license and registration expire — whichever comes first — through the Motor Vehicle Commission.",
        sourceUrl: "https://www.nj.gov/mvc/drivertopics/movetonj.htm",
        sourceOrg: "New Jersey Motor Vehicle Commission",
        verification: FETCHED,
      },
      {
        topic: "voter-registration",
        question: "How do I register to vote, and by when?",
        answer:
          "Register online, by mail, or in person at least 21 days before an election. New Jersey mails every registered voter information about voting options each election.",
        sourceUrl: "https://www.nj.gov/state/elections/voter-registration.shtml",
        sourceOrg: "New Jersey Division of Elections",
        verification: FETCHED,
      },
      {
        topic: "property-tax",
        question: "How do property taxes work?",
        answer:
          "Property taxes are set and billed by your municipality and fund schools, county, and local services. The state's ANCHOR program pays a property-tax relief benefit to eligible homeowners and renters.",
        sourceUrl: "https://www.nj.gov/treasury/taxation/anchor/",
        sourceOrg: "New Jersey Division of Taxation",
        verification: FETCHED,
      },
      {
        topic: "hunting-fishing",
        question: "Am I allowed to hunt or fish?",
        answer:
          "Yes, with a licence. New Jersey law requires a licence to hunt or trap at any age, and " +
          "anyone over 16 needs one to fish the state's fresh waters with a rod and line. Saltwater " +
          "fishing is registered separately rather than licensed.",
        sourceUrl: "https://law.justia.com/codes/new-jersey/title-23/section-23-3-1/",
        sourceOrg: "New Jersey Revised Statutes 23:3-1 (Licence for hunting, fishing, trapping)",
        verification: FETCHED,
      },
      {
        topic: "abortion",
        question: "What is the law on abortion?",
        answer:
          "New Jersey law states a fundamental right to choose whether to carry a pregnancy, to " +
          "give birth, or to end one. The Freedom of Reproductive Choice Act sets no time limit " +
          "and requires no waiting period.",
        sourceUrl: "https://law.justia.com/codes/new-jersey/title-10/section-10-7-2/",
        sourceOrg: "New Jersey Revised Statutes 10:7-2 (Freedom of Reproductive Choice Act)",
        verification: FETCHED,
      },
    ],
  },
  {
    state: "NH",
    stateName: "New Hampshire",
    facts: [
      {
        topic: "marijuana",
        question: "Is marijuana legal?",
        answer:
          "Recreational marijuana is not legal. Possessing three-quarters of an ounce or less is a civil violation (a fine, not a crime), and a state-run therapeutic cannabis program serves qualifying patients.",
        sourceUrl:
          "https://www.dhhs.nh.gov/programs-services/population-health/therapeutic-cannabis",
        sourceOrg: "New Hampshire Department of Health and Human Services",
        verification: NH_WALL,
      },
      {
        topic: "school-vaccinations",
        question: "What vaccinations do schools require?",
        answer:
          "Children need routine immunizations to enroll in school or child care; New Hampshire allows medical and religious exemptions with documentation.",
        sourceUrl:
          "https://www.dhhs.nh.gov/programs-services/disease-prevention/nh-immunization-program/immunization-guidance-schools",
        sourceOrg: "New Hampshire Department of Health and Human Services",
        verification: NH_WALL,
      },
      {
        topic: "firearms",
        question: "What are the basics of carrying a firearm?",
        answer:
          "New Hampshire allows anyone who may legally own a handgun to carry it openly or concealed without a license. An optional pistol/revolver license exists, mainly for carrying in other states that honor it.",
        sourceUrl:
          "https://www.nhsp.dos.nh.gov/our-services/justice-information-bureau/permits-and-licensing/pistol-and-revolver-licensing",
        sourceOrg: "New Hampshire State Police",
        verification: NH_WALL,
      },
      {
        topic: "income-tax",
        question: "Is there a state income tax?",
        answer:
          "No — New Hampshire does not tax wages, and its separate tax on interest and dividends was repealed effective 2025. There is also no state sales tax.",
        sourceUrl: "https://www.revenue.nh.gov/",
        sourceOrg: "New Hampshire Department of Revenue Administration",
        verification: NH_WALL,
      },
      {
        topic: "vehicle",
        question: "How long do I have to register my car and get a license?",
        answer:
          "New residents have 60 days after establishing residency to register vehicles and get a New Hampshire driver's license. Registration runs through your town clerk plus the DMV.",
        sourceUrl:
          "https://www.dmv.nh.gov/vehicles-boats-or-titles/vehicle-registrations/new-resident-new-hampshire",
        sourceOrg: "New Hampshire Division of Motor Vehicles",
        verification: NH_WALL,
      },
      {
        topic: "voter-registration",
        question: "How do I register to vote, and by when?",
        answer:
          "Register with your town or city clerk ahead of time, or at the polls on election day itself. Bring proof of who you are, your age, your citizenship, and where you live.",
        sourceUrl: "https://www.sos.nh.gov/elections/register-vote",
        sourceOrg: "New Hampshire Secretary of State",
        verification: NH_WALL,
      },
      {
        topic: "property-tax",
        question: "How do property taxes work?",
        answer:
          "Property taxes are the main way New Hampshire towns and schools are funded, set town by town; the annual town meeting votes the budget that drives the rate. Credits and exemptions (veterans, elderly, disabled) run through your town.",
        sourceUrl: "https://www.revenue.nh.gov/",
        sourceOrg: "New Hampshire Department of Revenue Administration",
        verification: NH_WALL,
      },
      {
        topic: "hunting-fishing",
        question: "Am I allowed to hunt or fish?",
        answer:
          "Yes, with a licence. New Hampshire law says nobody may fish, hunt or trap in the state " +
          "without first getting a valid licence, and it has to be carried while you are doing it. " +
          "The same chapter sets out the exceptions, including some for young people.",
        sourceUrl: "https://www.gencourt.state.nh.us/rsa/html/XVIII/214/214-1.htm",
        sourceOrg: "New Hampshire RSA 214:1 (Licence Required)",
        verification: FETCHED,
      },
      {
        topic: "abortion",
        question: "What is the law on abortion?",
        answer:
          "New Hampshire allows abortion up to 24 weeks of pregnancy. From 24 weeks a provider may " +
          "not perform one except in a medical emergency, and must first determine the likely " +
          "gestational age. There is no time limit written into state law before that point.",
        sourceUrl: "https://www.gencourt.state.nh.us/rsa/html/XXX/329/329-44.htm",
        sourceOrg: "New Hampshire RSA 329:44 (Fetal Life Protection Act — Prohibition)",
        verification: FETCHED,
      },
    ],
  },
  {
    state: "AZ",
    stateName: "Arizona",
    facts: [
      {
        topic: "marijuana",
        question: "Is marijuana legal?",
        answer:
          "Yes — adults 21 and over can buy and possess cannabis, sold at state-licensed dispensaries regulated by the health department. Public use and driving under its influence remain illegal.",
        sourceUrl: "https://www.azdhs.gov/licensing/marijuana/index.php",
        sourceOrg: "Arizona Department of Health Services",
        verification: FETCHED,
      },
      {
        topic: "school-vaccinations",
        question: "What vaccinations do schools require?",
        answer:
          "Children need routine immunizations to attend school or child care; Arizona allows medical and personal-belief exemptions with the state form.",
        sourceUrl:
          "https://www.azdhs.gov/preparedness/epidemiology-disease-control/immunization/index.php",
        sourceOrg: "Arizona Department of Health Services",
        verification: FETCHED,
      },
      {
        topic: "firearms",
        question: "What are the basics of carrying a firearm?",
        answer:
          "Adults 21 and over who may legally own a firearm can carry it openly or concealed without a permit. An optional concealed-weapons permit exists, mainly for other states' recognition and certain locations.",
        sourceUrl: "https://www.azdps.gov/services/public/cwp",
        sourceOrg: "Arizona Department of Public Safety",
        verification: FETCHED,
      },
      {
        topic: "income-tax",
        question: "Is there a state income tax?",
        answer:
          "Yes — Arizona has a flat state income tax on wages and other income, filed with the Department of Revenue.",
        sourceUrl: "https://azdor.gov/individuals",
        sourceOrg: "Arizona Department of Revenue",
        verification: FETCHED,
      },
      {
        topic: "vehicle",
        question: "How long do I have to register my car and get a license?",
        answer:
          "Arizona expects new residents to get an Arizona license and register their vehicles promptly once residency is established — there is no fixed grace period, so the Motor Vehicle Division is an early errand.",
        sourceUrl: "https://azdot.gov/mvd",
        sourceOrg: "Arizona Department of Transportation, Motor Vehicle Division",
        verification: FETCHED,
      },
      {
        topic: "voter-registration",
        question: "How do I register to vote, and by when?",
        answer:
          "Register online or by mail at least 29 days before an election. Arizona voters show identification at the polls.",
        sourceUrl: "https://azsos.gov/elections/voters",
        sourceOrg: "Arizona Secretary of State",
        verification: FETCHED,
      },
      {
        topic: "property-tax",
        question: "How do property taxes work?",
        answer:
          "Property taxes are billed by your county and fund schools, county, city, and district services; state law limits how fast a home's taxable value can grow, and qualifying seniors can apply to freeze their valuation.",
        sourceUrl: "https://azdor.gov/business/property-tax",
        sourceOrg: "Arizona Department of Revenue",
        verification: FETCHED,
      },
      {
        topic: "hunting-fishing",
        question: "Am I allowed to hunt or fish?",
        answer:
          "Yes, with a licence. Arizona Game and Fish requires anyone 10 or older — resident or " +
          "not — to hold a valid licence to take wildlife, fish included. People who live in " +
          "Arizona pay less for one than visitors do.",
        sourceUrl:
          "https://www.azgfd.com/hunting/hunt-draw-and-licenses/hunting-licenses/",
        sourceOrg: "Arizona Game and Fish Department",
        verification: AZ_FETCHED,
      },
      {
        topic: "abortion",
        question: "What is the law on abortion?",
        answer:
          "Arizona's constitution gives every person a fundamental right to abortion. Before the " +
          "point a treating health professional judges the fetus could survive outside the womb, " +
          "the state may restrict it only for a compelling health reason. After that point, it " +
          "may not block an abortion that professional judges necessary to protect the pregnant " +
          "person's life or health.",
        sourceUrl: "https://www.azleg.gov/const/2/8_1.htm",
        sourceOrg: "Arizona State Legislature — Constitution, Article 2 § 8.1",
        verification: AZ_FETCHED,
      },
    ],
  },
];

export function areaFactsForState(state: string): AreaFactSet | null {
  return AREA_FACTS.find((s) => s.state === state.toUpperCase()) ?? null;
}
