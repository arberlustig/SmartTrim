// Reads what recorder.js collected, per sound played: how long from the press to audible sound, how late the picture's
// first new frame came, frames drawn a second and every gap over 34 ms (one refresh late on an 89 Hz screen); per click
// while stopped, how long until the still frame; the picture's memory and ffmpeg runs.
//   node bench/picture-acceptance/cdp.mjs evalfile bench/picture-acceptance/report.js
// Set globalThis.__compact = true first for one line per play.
const r = window.__recorder;
if (!r) return "recorder not installed";
const median = (list) => (list.length ? [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] : null);
const within = (list, from, to) => list.filter((item) => item.at >= from && item.at <= to);
const nowAt = Math.round(performance.now() - r.t0);

const starts = r.events.filter((event) => event.what === "soundStart");
const plays = starts.map((start, index) => {
  const { audibleAt, folded } = start.detail;
  const stop = r.events.find((event) => event.what === "soundStop" && event.at > start.at);
  const to = Math.min(stop ? stop.at : nowAt, starts[index + 1]?.at ?? Number.POSITIVE_INFINITY);
  // What asked for this sound: the last press of a ▶ button, or a click into a waveform, before it.
  const press = r.events.findLast(
    (event) => event.at <= start.at && ((event.what === "click" && event.detail.startsWith("play")) || (event.what === "pointerdown" && event.detail === "waveform")),
  );
  const draws = r.draws.filter((at) => at >= audibleAt && at <= to);
  const steady = draws.filter((at) => at >= audibleAt + 100);
  const gaps = [];
  let longest = 0;
  for (let at = 1; at < steady.length; at++) {
    const gap = steady[at] - steady[at - 1];
    longest = Math.max(longest, gap);
    if (gap > 34) gaps.push(`${Math.round(steady[at] - audibleAt)}:${Math.round(gap)}`);
  }
  const seconds = (to - audibleAt) / 1000;
  return {
    at: start.at,
    folded,
    seconds: Math.round(seconds * 10) / 10,
    pressToSoundMs: press ? Math.round(audibleAt - press.at) : null,
    pressedBy: press ? press.detail : null,
    // The first frame drawn once the sound is audible; the frame due at its very start may already stand there.
    firstNewFrameMs: draws.length ? Math.round(draws[0] - audibleAt) : null,
    framesPerSecond: seconds > 1 ? Math.round(steady.length / (seconds - 0.1)) : null,
    gapsOver34ms: gaps.length,
    longestGapMs: Math.round(longest),
    gaps: gaps.slice(0, 12).join(" "),
    lateAnimationFrames: within(r.lateAnimationFrames, audibleAt, to).map((late) => late.ms).join(" "),
  };
});

// A click into a waveform while nothing plays puts the still frame there. Timed from the release, which is when the
// window moves the Playhead; a release more than 4 px from its press was a drag, and a click followed by a sound within
// two seconds was a jump, not a still.
const playingAt = (at) =>
  starts.some((start) => {
    const stop = r.events.find((event) => event.what === "soundStop" && event.at > start.at);
    return at >= start.at && at <= (stop ? stop.at : nowAt);
  });
const stills = r.events
  .filter((event) => event.what === "pointerup" && event.detail.where === "waveform" && event.detail.travel < 4)
  .filter((release) => !playingAt(release.at) && !starts.some((start) => start.at > release.at && start.at < release.at + 2000))
  .map((release) => {
    const drawn = r.draws.find((at) => at > release.at && at < release.at + 5000);
    return drawn === undefined ? null : Math.round(drawn - release.at);
  })
  .filter((ms) => ms !== null);

const state = await window.smarttrim.pictureState();
const runs = state.ok ? state.value.runs : [];
const withPicture = plays.filter((play) => !play.folded);
const summary = {
  plays: plays.length,
  foldedPlays: plays.length - withPicture.length,
  playsWithGapsOver34ms: withPicture.filter((play) => play.gapsOver34ms > 0).length,
  longestGapMs: Math.max(0, ...withPicture.map((play) => play.longestGapMs)),
  firstNewFrameMsMedian: median(withPicture.map((play) => play.firstNewFrameMs).filter((ms) => ms !== null)),
  firstNewFrameMsMax: Math.max(0, ...withPicture.map((play) => play.firstNewFrameMs ?? 0)),
  pressToSoundMsMedianWithPicture: median(withPicture.map((play) => play.pressToSoundMs).filter((ms) => ms !== null)),
  pressToSoundMsMedianFolded: median(plays.filter((play) => play.folded).map((play) => play.pressToSoundMs).filter((ms) => ms !== null)),
  stills: stills.length,
  stillMsMedian: median(stills),
  stillMsMax: stills.length ? Math.max(...stills) : null,
  windowFreezesOver100ms: r.lateAnimationFrames.filter((late) => late.ms > 100).length,
  longestWindowFreezeMs: Math.max(0, ...r.lateAnimationFrames.map((late) => late.ms)),
  pingSpikes: r.pingSpikes.map((spike) => `${spike.at}:${spike.ms}`).join(" "),
  pictureMegabytes: state.ok ? Math.round(state.value.heldBytes / 1e6) : state.message,
  visibility: document.visibilityState,
};
const runLines = runs.map(
  (run) =>
    `${run.onProcessor ? "processor" : "graphics card"} ${run.made}/${run.toFrame - run.fromFrame} frames, first after ${run.firstFrameMs} ms, ${run.ms ? Math.round((run.made * 1000) / run.ms) : "?"}/s${run.stopped ? ", stopped" : ""}${run.running ? ", running" : ""}`,
);
if (globalThis.__compact) {
  return {
    summary,
    plays: plays.map(
      (play) =>
        `${play.folded ? "folded " : ""}sound ${play.pressToSoundMs} first ${play.firstNewFrameMs} fps ${play.framesPerSecond} gaps>34 ${play.gapsOver34ms} longest ${play.longestGapMs}`,
    ),
  };
}
return { summary, plays, stillMs: stills.join(" "), runs: runLines.slice(-20), longestLongFrames: [...r.longFrames].sort((a, b) => b.ms - a.ms).slice(0, 6) };
