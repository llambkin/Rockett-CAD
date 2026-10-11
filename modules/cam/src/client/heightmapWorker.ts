import { simulateJob } from "./heightmap.js";

self.addEventListener("message", ({ data }) => {
  try {
    const done = simulateJob(data);
    const { heights, cutBy } = done.map;
    const transfer = [heights.buffer, cutBy.buffer];
    if ("gouged" in done.check) transfer.push(done.check.gouged.buffer);
    self.postMessage(done, { transfer });
  } catch (error) {
    self.postMessage({ error }, { transfer: [] });
  }
});
