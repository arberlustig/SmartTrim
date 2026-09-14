// Tells apart who is stuck during a freeze. Every 25 ms the window asks the main process for nothing (readFrames with
// no frames: a pure IPC round trip), and a 10 ms timer measures how late the window's own thread runs. Stored on the
// recorder's time axis; report.js pairs them with the freezes. Install after recorder.js, once per page load.
const r = window.__recorder;
if (!r) return "recorder not installed";
if (r.pinging) return "already pinging";
r.pinging = true;
r.pingSpikes = [];
r.timerSpikes = [];
r.pings = 0;
const tabId = globalThis.__tabId ?? 1;
const at = () => Math.round(performance.now() - r.t0);

(async () => {
  while (r.pinging) {
    const sent = performance.now();
    await window.smarttrim.readFrames(tabId, []);
    const roundTrip = performance.now() - sent;
    r.pings += 1;
    if (roundTrip > 50) r.pingSpikes.push({ at: Math.round(sent - r.t0), ms: Math.round(roundTrip) });
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
})();

(async () => {
  while (r.pinging) {
    const asked = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const lateBy = performance.now() - asked - 10;
    if (lateBy > 40) r.timerSpikes.push({ at: Math.round(asked - r.t0), ms: Math.round(lateBy) });
  }
})();
return `pinging at ${at()} ms`;
