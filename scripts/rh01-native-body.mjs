/** Observe native CLI exhaustion without changing its workload or source code. */
export function observeNativeBody(script, source) {
  if (script === "platform-census-runner.mts") {
    const expected = "const states = REGISTRATION_TARGETS.map(target => target.state.toLowerCase());";
    if (!source.includes(expected) || !source.includes("await singleton.release();")) throw Error("RH01 native platform census lifecycle did not match");
    // Per-state native output supplies the actual phases. This marker is after
    // both loops and their finally block, including normal not-due decisions.
    return source + '\nconsole.log("RH01_PLATFORM_CENSUS_RESULT " + JSON.stringify({exhausted:true,stopped,states}));\n';
  }
  if (script === "split-federal-people.mts") {
    const publication = "await processRegisteredManualCandidate(";
    const terminal = "if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();";
    if (!source.includes(publication) || !source.includes(terminal)) throw Error("RH01 native federal split lifecycle did not match");
    source = source.replaceAll(publication, "await rhFederalSplitPublish(");
    source = `let rhFederalSplitRequested=0,rhFederalSplitSettled=0;
      async function rhFederalSplitPublish(...args) {
        rhFederalSplitRequested++;
        const result=await processRegisteredManualCandidate(...args);
        rhFederalSplitSettled++;
        return result;
      }\n` + source;
    return source.replace(terminal, `if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
      await main();
      console.log("RH01_FEDERAL_SPLIT_RESULT " + JSON.stringify({exhausted:true,requested:rhFederalSplitRequested,settled:rhFederalSplitSettled}));
    }`);
  }
  throw Error(`RH01 native body observer is not registered: ${script}`);
}
