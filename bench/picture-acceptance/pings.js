// Tells apart who is stuck while the window freezes. Every 25 ms the window asks the main process how the picture is
// doing (a small IPC round trip), and a 10 ms timer measures how late the window's own thread runs. Install after
// recorder.js, once per page load; report.js lists the spikes.
const r = window.__recorder;
if (!r) return "recorder not installed";
if (r.pinging) return "already pinging";
r.pinging = true;

(async () => {
  while (r.pinging) {
    const sent = performance.now();
    await window.smarttrim.pictureState();
    const roundTrip = performance.now() - sent;
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
return "pinging";
