// Routes added after the bundled meeting fixture was captured. Used only by fixture tests.
import { DERIVED_MEETING_FAMILY_STATES } from "../../lib/civic-data/contracts.ts";
import { derivedMeetingFamilyId } from "../../lib/civic-data/meeting-partitions.ts";
export const POST_FIXTURE_MEETING_PARTITIONS: readonly string[] = [
  "meetings:official-page-events:ocd-division%2Fcountry%3Aus%2Fstate%3Aaz%2Fschool_district%3Atucson_unified_district%23board",
  "meetings:schedulepage:ocd-division%2Fcountry%3Aus%2Fstate%3Anh%2Fcounty%3Amerrimack%2Fplace%3Anewbury_town%23library-trustees",
  "meetings:schedulepage:ocd-division%2Fcountry%3Aus%2Fstate%3Anh%2Fcounty%3Amerrimack%2Fplace%3Anewbury_town%23energy-committee",
  "meetings:schedulepage:ocd-division%2Fcountry%3Aus%2Fstate%3Aaz%2Fplace%3Achandler%23governing",
  "meetings:document-listing:ocd-division%2Fcountry%3Aus%2Fstate%3Aaz%2Fplace%3Aholbrook%23governing",
  "meetings:suiteone:ocd-division%2Fcountry%3Aus%2Fstate%3Aaz%2Fplace%3Awinslow%23governing",
  // One derived meeting family per registered state.
  ...DERIVED_MEETING_FAMILY_STATES.map((state) => derivedMeetingFamilyId(state)),
];
