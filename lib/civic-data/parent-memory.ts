/** RSS includes native buffers as well as the JS heap; record both around parent data reads. */
export function recordParentMemory(lane: string, stage: string): ReturnType<typeof process.memoryUsage> {
  const memory = process.memoryUsage();
  console.log(`RCD_PARENT_MEMORY=${JSON.stringify({ lane, stage, pid: process.pid, ...memory })}`);
  return memory;
}
