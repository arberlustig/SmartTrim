// PROTOTYPE report for the JPEG picture (branch prototype/jpeg-picture). Reads what the prototype code in renderer.ts
// logged (window.__proto) and what recorder.js + pings.js collected, per press of ▶.
//   node bench/webcodecs-picture-diagnosis/cdp.mjs evalfile bench/prototype-jpeg-picture/report.js
const p = window.__proto;
const r = window.__recorder;
if (!p) return "prototype log missing";
const t0 = r ? r.t0 : 0;
const rel = (at) => Math.round(at - t0);
const median = (list) => (list.length ? [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] : null);
const presses = p.events.filter((event) => event.what === "press");
const stops = r ? r.events.filter((event) => event.what === "soundStop").map((event) => event.at + t0) : [];

const plays = presses.map((press, at) => {
  const nextPress = presses[at + 1]?.at ?? Number.POSITIVE_INFINITY;
  const events = p.events.filter((event) => event.at >= press.at && event.at < nextPress);
  const scheduled = events.find((event) => event.what === "soundScheduled");
  if (!scheduled) return { at: rel(press.at), sound: false, events: events.map((event) => event.what).join(",") };
  const audibleAt = scheduled.audibleAt;
  const stop = Math.min(stops.find((stopAt) => stopAt > audibleAt) ?? performance.now(), nextPress);
  const draws = p.draws.filter((draw) => draw.at >= audibleAt + 100 && draw.at <= stop);
  const gaps34 = [];
  let gaps50 = 0;
  let longest = 0;
  for (let k = 1; k < draws.length; k++) {
    const gap = draws[k].at - draws[k - 1].at;
    longest = Math.max(longest, gap);
    if (gap > 34) gaps34.push(`${Math.round(draws[k].at - audibleAt)}:${Math.round(gap)}`);
    if (gap > 50) gaps50 += 1;
  }
  const excerpt = events.find((event) => event.what === "excerptArrived");
  const wait = events.find((event) => event.what === "pictureWait");
  const started = events.find((event) => event.what === "pictureStarted");
  const seconds = (stop - audibleAt) / 1000;
  return {
    at: rel(press.at),
    seconds: Math.round(seconds * 10) / 10,
    skipping: scheduled.skipping,
    pieces: scheduled.pieces,
    excerptMs: excerpt ? Math.round(excerpt.at - press.at) : null,
    pictureWaitMs: wait?.ms ?? null,
    pictureReady: wait ? `${wait.ready}/${wait.of}` : null,
    pressToSoundMs: Math.round(audibleAt - press.at),
    pictureStartLagMs: started ? Math.round(started.at - audibleAt) : null,
    drawsPerSecond: seconds > 1 ? Math.round(draws.length / (seconds - 0.1)) : null,
    gapsOver34ms: gaps34.length,
    gapsOver50ms: gaps50,
    longestGapMs: Math.round(longest),
    gaps: gaps34.slice(0, 15).join(" "),
    misses: events.filter((event) => event.what === "miss" && event.at <= stop).length,
    lateAnimationFrames: r
      ? r.lateAnimationFrames
          .filter((late) => late.at + t0 >= audibleAt && late.at + t0 <= stop)
          .map((late) => late.ms)
          .join(" ")
      : null,
  };
});

const sounding = plays.filter((play) => play.sound !== false);
const stills = p.events.filter((event) => event.what === "still").map((event) => event.ms);
const stats = await window.smarttrimPrototype.stats();
// globalThis.__compact = true: one line per play, to compare variants side by side.
if (globalThis.__compact) {
  return {
    plays: sounding.map(
      (play) =>
        `excerpt ${play.excerptMs} wait ${play.pictureWaitMs} sound ${play.pressToSoundMs} lag ${play.pictureStartLagMs} fps ${play.drawsPerSecond} gaps>34 ${play.gapsOver34ms} longest ${play.longestGapMs} misses ${play.misses}`,
    ),
    prepRuns: stats.runs.map(
      (run) => `${run.tuning} ${run.made}/${run.stop - run.from} ${run.framesPerSecond}/s first ${run.firstFrameMs}ms${run.killed ? " stopped" : ""}`,
    ),
    freezesOver100ms: r ? r.lateAnimationFrames.filter((late) => late.ms > 100).map((late) => late.ms).join(" ") : null,
    pingSpikes: r?.pingSpikes?.map((spike) => spike.ms).join(" ") ?? null,
  };
}
return {
  visibility: document.visibilityState,
  summary: {
    plays: sounding.length,
    playsWithGapsOver34ms: sounding.filter((play) => play.gapsOver34ms > 0).length,
    gapsOver34ms: sounding.reduce((sum, play) => sum + play.gapsOver34ms, 0),
    longestGapMs: Math.max(0, ...sounding.map((play) => play.longestGapMs)),
    misses: sounding.reduce((sum, play) => sum + play.misses, 0),
    pictureStartLagMsMedian: median(sounding.map((play) => play.pictureStartLagMs).filter((ms) => ms !== null)),
    pictureStartLagMsMax: Math.max(0, ...sounding.map((play) => play.pictureStartLagMs ?? 0)),
    pictureWaitMsMedian: median(sounding.map((play) => play.pictureWaitMs).filter((ms) => ms !== null)),
    pictureWaitMsMax: Math.max(0, ...sounding.map((play) => play.pictureWaitMs ?? 0)),
    pressToSoundMsMedian: median(sounding.map((play) => play.pressToSoundMs)),
    stills: stills.length,
    stillMsMedian: median(stills),
    stillMsMax: stills.length ? Math.max(...stills) : null,
    windowFreezesOver100ms: r ? r.lateAnimationFrames.filter((late) => late.ms > 100).length : null,
    longestWindowFreezeMs: r ? Math.max(0, ...r.lateAnimationFrames.map((late) => late.ms)) : null,
    pingSpikes: r?.pingSpikes?.map((spike) => `${spike.at}:${spike.ms}`).join(" ") ?? null,
    timerSpikes: r?.timerSpikes?.map((spike) => `${spike.at}:${spike.ms}`).join(" ") ?? null,
  },
  plays: sounding,
  pressesWithoutSound: plays.filter((play) => play.sound === false),
  prepRuns: stats.runs.map(
    (run) =>
      `${run.decoder} ${run.made}/${run.stop - run.from} frames, first after ${run.firstFrameMs} ms, ${run.framesPerSecond}/s${run.killed ? ", stopped" : ""}${run.errors ? `, ERR ${run.errors}` : ""}`,
  ),
  memory: { framesMegabytes: stats.megabytes, frames: stats.frames, processes: stats.processes },
};
