export const tableWords = (value: string) => value.split(",").map(table => ({ civic_data_payload_parts: "Published record parts", civic_data_promotions: "Published records",
    civic_data_candidates: "Record versions", civic_data_candidate_events: "Publication history", civic_data_clock_versions: "Source update times", owner_flag: "Flagged facts",
    fact: "Facts", source_copy: "Saved sources", socket: "Connection", query: "Database query" }[table.split(":")[0]] ?? table.replace(/\.m?[jt]s$/, "").replaceAll(/[_:-]+/g, " "))).join(", ");
