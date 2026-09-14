// Tight loop for "the window's own thread is blocked without any script": calls the bridge directly with answers of
// growing size and measures, per call, the round trip and how late a 5 ms timer in the window ran meanwhile. If the
// bridge copying large answers is what blocks the window, the lateness grows with the number of entries.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tabId = globalThis.__tabId ?? 1;
const api = window.smarttrim;
const descriptor = Object.getOwnPropertyDescriptor(window, "smarttrim");

let lastTick = performance.now();
let worstLate = 0;
let ticking = true;
(async () => {
  while (ticking) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const now = performance.now();
    worstLate = Math.max(worstLate, now - lastTick - 5);
    lastTick = now;
  }
})();

async function measure(name, times, call) {
  const runs = [];
  for (let run = 0; run < times; run++) {
    await wait(300);
    worstLate = 0;
    const started = performance.now();
    const answer = await call();
    const roundTripMs = Math.round(performance.now() - started);
    await wait(60);
    runs.push({ roundTripMs, windowLateMs: Math.round(worstLate), ok: answer.ok, size: answer.ok ? sizeOf(answer.value) : answer.message });
  }
  return { name, runs: runs.map((run) => `${run.roundTripMs}ms/late ${run.windowLateMs}ms/${run.size}`).join("  ") };
}

function sizeOf(value) {
  if (Array.isArray(value)) return `${value.length} items`;
  if (value?.pieces) {
    const feed = value.pieces.reduce((total, piece) => total + piece.feed.length, 0);
    const shown = value.pieces.reduce((total, piece) => total + piece.shown.length, 0);
    return `${value.pieces.length} pieces, ${feed} fed, ${shown} shown`;
  }
  if (value?.samples) return `${(value.samples.byteLength / 1e6).toFixed(1)} MB sound`;
  if (value?.feed) return `${value.feed.length} fed`;
  return typeof value;
}

const results = [
  { bridge: { writable: descriptor?.writable, configurable: descriptor?.configurable, frozen: Object.isFrozen(api) } },
];
for (const seconds of [1, 10, 60, 180]) {
  results.push(
    await measure(`picturePlan one piece of ${seconds} s`, 3, () =>
      api.picturePlan(tabId, [{ recordingFromSeconds: 300, recordingToSeconds: 300 + seconds, playedFromSeconds: 0 }]),
    ),
  );
}
const eighty = Array.from({ length: 80 }, (_, piece) => ({
  recordingFromSeconds: 300 + piece * 2.25,
  recordingToSeconds: 300 + piece * 2.25 + 2,
  playedFromSeconds: piece * 2,
}));
results.push(await measure("picturePlan 80 pieces of 2 s", 3, () => api.picturePlan(tabId, eighty)));
results.push(await measure("stillPicture", 3, () => api.stillPicture(tabId, 585.9)));
const plan = await api.picturePlan(tabId, [{ recordingFromSeconds: 300, recordingToSeconds: 302, playedFromSeconds: 0 }]);
const batch = plan.ok ? plan.value.pieces[0].feed.slice(0, 30) : [];
results.push(await measure("readFrames 30 frames", 5, () => api.readFrames(tabId, batch)));
for (const seconds of [10, 60, 180]) {
  results.push(
    await measure(`readExcerpt ${seconds} s (the sound, for comparison)`, 3, () =>
      api.readExcerpt({ tabId, position: 4, fromSeconds: 300, toSeconds: 300 + seconds }),
    ),
  );
}
ticking = false;
return results;
