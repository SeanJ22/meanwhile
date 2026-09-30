// Routes added after the bundled meeting fixture was captured. Used only by fixture tests.
import { DERIVED_MEETING_FAMILY_STATES } from "../../lib/civic-data/contracts.ts";
import { derivedMeetingFamilyId } from "../../lib/civic-data/meeting-partitions.ts";
export const POST_FIXTURE_MEETING_PARTITIONS: readonly string[] = [
  // Tucson Unified's own reconfiguration page (official-page events, 2026-09-23).
  "meetings:official-page-events:ocd-division%2Fcountry%3Aus%2Fstate%3Aaz%2Fschool_district%3Atucson_unified_district%23board",
  // Newbury, NH bodies the town iCal never carries, read from their own pages (C9, 2026-09-24).
  "meetings:schedulepage:ocd-division%2Fcountry%3Aus%2Fstate%3Anh%2Fcounty%3Amerrimack%2Fplace%3Anewbury_town%23library-trustees",
  "meetings:schedulepage:ocd-division%2Fcountry%3Aus%2Fstate%3Anh%2Fcounty%3Amerrimack%2Fplace%3Anewbury_town%23energy-committee",
  // Chandler's City Council schedule table (C14, 2026-09-24).
  "meetings:schedulepage:ocd-division%2Fcountry%3Aus%2Fstate%3Aaz%2Fplace%3Achandler%23governing",
  // Holbrook's City Council from the city's own agendas-and-minutes pages (2026-09-25).
  "meetings:document-listing:ocd-division%2Fcountry%3Aus%2Fstate%3Aaz%2Fplace%3Aholbrook%23governing",
  // Winslow's City Council from the city's SuiteOne Media portal (2026-09-25).
  "meetings:suiteone:ocd-division%2Fcountry%3Aus%2Fstate%3Aaz%2Fplace%3Awinslow%23governing",
  // The derived meeting families, one partition per registered state (C16, 2026-09-24; every state since 2026-09-25).
  // Their members are data read from the promoted meeting-source wiring, so this list never changes per reviewed
  // calendar, and it is registration's own state list, never a chosen one.
  ...DERIVED_MEETING_FAMILY_STATES.map((state) => derivedMeetingFamilyId(state)),
];
