// PROTOTYPE: pings.js of bench/webcodecs-picture-diagnosis, pinging the prototype's empty IPC call instead. Every 25 ms
// an IPC round trip to the main process, and a 10 ms timer measuring how late the window's own thread runs. Install
// after recorder.js, once per page load.
const r = window.__recorder;
if (!r) return "recorder not installed";
if (r.pinging) return "already pinging";
r.pinging = true;
r.pingSpikes = [];
r.timerSpikes = [];
r.pings = 0;

(async () => {
  while (r.pinging) {
    const sent = performance.now();
    await window.smarttrimPrototype.ping();
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
return "pinging";
