/** Admin's hunting settings. */
import { registerSetting } from "../control-plane/settings.ts";

/** Also send each hunt packet to Exa's research agent, so the two lanes can be compared on the same packets. */
export const EXA_AGENT_LANE_SETTING = "hunting.exaAgent";
registerSetting({
  key: EXA_AGENT_LANE_SETTING, label: "Also send each hunt to Exa's research agent", defaultValue: false,
  readerFacing: false, control: "boolean", validate: (value): value is boolean => typeof value === "boolean",
});
