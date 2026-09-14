// Reads what recorder.js collected: per playback the frames shown, the gaps, and what kept the window busy meanwhile;
// per click while stopped, how long until the still frame was drawn.
const r = window.__recorder;
if (!r) return "recorder not installed";
const within = (list, from, to) => list.filter((item) => item.at >= from && item.at <= to);

const starts = r.events.filter((event) => event.what === "soundStart");
const plays = starts.map((start) => {
  const stop = r.events.find((event) => event.what === "soundStop" && event.at > start.at);
  const to = stop ? stop.at : Math.round(performance.now() - r.t0);
  const shown = r.draws.filter((at) => at >= start.at && at <= to);
  const from = (shown[0] ?? start.at) + 500;
  const inside = shown.filter((at) => at >= from);
  const gaps = [];
  for (let at = 1; at < inside.length; at++) {
    const gap = inside[at] - inside[at - 1];
    if (gap > 50) gaps.push(`${Math.round(inside[at] - start.at)}:${Math.round(gap)}`);
  }
  const seconds = Math.max((to - from) / 1000, 0.001);
  return {
    at: start.at,
    seconds: Math.round((to - start.at) / 100) / 10,
    firstFrameMs: shown.length ? Math.round(shown[0] - start.at) : null,
    framesPerSecond: to - from > 1000 ? Math.round(inside.length / seconds) : "too short",
    gapsOver50ms: gaps.length,
    gaps: gaps.slice(0, 12).join(" "),
    lateAnimationFrames: within(r.lateAnimationFrames, start.at, to).map((late) => late.ms).slice(0, 12).join(" "),
    longFrames: within(r.longFrames, start.at, to).slice(0, 6),
    inputs: within(r.events, start.at, to)
      .filter((event) => !event.what.startsWith("sound"))
      .map((event) => `${event.at - start.at}:${event.what}${event.detail ? `(${event.detail})` : ""}`)
      .slice(0, 12)
      .join(" "),
  };
});

const stills = r.events
  .filter((event) => event.what === "pointerdown")
  .map((press) => {
    const drawn = r.draws.find((at) => at > press.at);
    return drawn === undefined ? null : Math.round(drawn - press.at);
  });

const stillTimes = stills.filter((ms) => ms !== null).sort((a, b) => a - b);
const freezes = r.lateAnimationFrames.filter((late) => late.ms > 100);
const verdict = {
  folded: document.getElementById("pictureFrame").hidden,
  freezesOver100ms: freezes.length,
  longestFreezeMs: Math.max(0, ...r.lateAnimationFrames.map((late) => late.ms)),
  freezeMsTotal: freezes.reduce((total, late) => total + late.ms, 0),
  stillMedianMs: stillTimes[Math.floor(stillTimes.length / 2)] ?? null,
  stillMaxMs: stillTimes.at(-1) ?? null,
  pictureGapsWhilePlaying: plays.reduce((total, play) => total + play.gapsOver50ms, 0),
};
// Who was stuck during each freeze: the main process (an IPC round trip stalled), the window's own thread (its timer ran
// late), or neither. A spike counts for a freeze when the two overlap in time.
const overlaps = (spike, freeze) => spike.at <= freeze.at && spike.at + spike.ms >= freeze.at - freeze.ms;
verdict.freezesExplained = freezes.map((freeze) => {
  const ping = (r.pingSpikes ?? []).filter((spike) => overlaps(spike, freeze));
  const timer = (r.timerSpikes ?? []).filter((spike) => overlaps(spike, freeze));
  return {
    at: freeze.at,
    ms: freeze.ms,
    pingStalledMs: Math.max(0, ...ping.map((spike) => spike.ms)),
    windowTimerLateMs: Math.max(0, ...timer.map((spike) => spike.ms)),
  };
});
verdict.pings = r.pings ?? 0;
verdict.pingSpikes = (r.pingSpikes ?? []).map((spike) => `${spike.at}:${spike.ms}`).join(" ");
verdict.timerSpikes = (r.timerSpikes ?? []).map((spike) => `${spike.at}:${spike.ms}`).join(" ");
if (globalThis.__verdictOnly) return verdict;

return {
  verdict,
  recordedSeconds: Math.round(performance.now() - r.t0) / 1000,
  stats: {
    ...r.stats,
    framesUnclosed: r.stats.framesOut - r.stats.framesClosed,
    bitmapsUnclosed: r.stats.bitmapsMade - r.stats.bitmapsClosed,
    decodersMade: r.decoders.size,
    decodersOpen: [...r.decoders].filter((decoder) => decoder.state !== "closed").length,
  },
  plays,
  msFromPressToNextPictureDraw: stills.join(" "),
  lateAnimationFramesTotal: r.lateAnimationFrames.length,
  longestLateAnimationFrames: [...r.lateAnimationFrames].sort((a, b) => b.ms - a.ms).slice(0, 8),
  longestLongFrames: [...r.longFrames].sort((a, b) => b.ms - a.ms).slice(0, 8),
  errors: r.events.filter((event) => event.what === "decoderError"),
  pictureNote: document.getElementById("pictureNote").hidden ? null : document.getElementById("pictureNote").textContent,
  status: document.getElementById("status").textContent,
  visibility: document.visibilityState,
};
