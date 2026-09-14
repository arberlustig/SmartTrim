// Checks the fast picturePlanOf against the slow reference on the real the long Recording index, and times both.
import { videoIndexOf } from "file:///C:/Users/user/source/repos/SmartTrim/src/video/videoIndex.ts";
import { picturePlanOf, stillFrameOf } from "file:///C:/Users/user/source/repos/SmartTrim/src/video/picturePlan.ts";
import { picturePlanOf as referencePlanOf } from "./picturePlanReference.ts";

const index = await videoIndexOf("G:/Streams/long-recording.mp4");
const lastSeconds = index.frames.reduce((latest, frame) => Math.max(latest, frame.pts), 0) / index.timescale;

// A fixed stream of pseudo-random numbers, so a failure can be run again.
let seed = 12345;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const dense = Array.from({ length: 80 }, (_, piece) => ({
  recordingFromSeconds: 1300 + piece * 2.25,
  recordingToSeconds: 1300 + piece * 2.25 + 2,
  playedFromSeconds: piece * 2,
}));
const scattered = Array.from({ length: 300 }, () => {
  const from = random() * lastSeconds;
  return { recordingFromSeconds: from, recordingToSeconds: from + random() * 5, playedFromSeconds: random() * 100 };
});
const stills = Array.from({ length: 300 }, () => {
  const at = random() * lastSeconds;
  return { recordingFromSeconds: at, recordingToSeconds: at, playedFromSeconds: 0 };
});

const summary = (plans: ReturnType<typeof picturePlanOf>) =>
  JSON.stringify(plans.map((plan) => ({ feed: plan.feed.map((frame) => frame.position), shown: plan.shown })));

let differing = 0;
for (const [name, pieces] of [["dense", dense], ["scattered", scattered], ["stills", stills]] as const) {
  const started = performance.now();
  const fast = picturePlanOf(index, pieces);
  const fastMs = performance.now() - started;
  const referenceStarted = performance.now();
  const reference = referencePlanOf(index, pieces);
  const referenceMs = performance.now() - referenceStarted;
  const same = pieces.filter((_, at) => summary([fast[at]!]) === summary([reference[at]!])).length;
  differing += pieces.length - same;
  if (same !== pieces.length) {
    const at = pieces.findIndex((_, piece) => summary([fast[piece]!]) !== summary([reference[piece]!]));
    console.log("first difference", pieces[at], summary([fast[at]!]).slice(0, 400), summary([reference[at]!]).slice(0, 400));
  }
  console.log(`${name}: ${same} of ${pieces.length} equal; fast ${fastMs.toFixed(1)} ms, reference ${referenceMs.toFixed(0)} ms`);
}
const stillStarted = performance.now();
stillFrameOf(index, 5000.5);
console.log(`one still frame: ${(performance.now() - stillStarted).toFixed(2)} ms; ${differing} pieces differ in all`);
